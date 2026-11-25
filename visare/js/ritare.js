// Egen WebGL2-ritare: skuggade ytor (ytans normal för plana ytor, mjuka normaler för krökta), kantlinjer ur "kanter",
// markering av vald del och yta. Inga externa bibliotek.
import { add, mul, norm } from "./vektor.js";

const VS_YTA = `#version 300 es
in vec3 aPos; in vec3 aNor; in float aYta;
uniform mat4 uVP; uniform vec3 uOff;
out vec3 vNor; out vec3 vPos; flat out float vYta;
void main() {
  vec3 p = aPos + uOff;
  vPos = p; vNor = aNor; vYta = aYta;
  gl_Position = uVP * vec4(p, 1.0);
}`;

const FS_YTA = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vPos; flat in float vYta;
uniform vec3 uFarg, uKam, uBak, uLjus, uAccent;
uniform int uOrto;
uniform float uMarkerad, uValdYta, uAlfa;
out vec4 ut;
void main() {
  vec3 n = normalize(vNor);
  vec3 v = uOrto == 1 ? uBak : normalize(uKam - vPos);
  if (dot(n, v) < 0.0) n = -n;
  float d = max(dot(n, uLjus), 0.0);
  float fyll = max(dot(n, v), 0.0);
  float himmel = 0.5 + 0.5 * n.z;
  vec3 h = normalize(uLjus + v);
  float glans = pow(max(dot(n, h), 0.0), 48.0) * 0.22;
  vec3 c = uFarg;
  if (uMarkerad > 0.5) c = mix(c, uAccent, 0.30);
  if (abs(vYta - uValdYta) < 0.5) c = mix(c, uAccent, 0.65);
  vec3 col = c * (0.22 + 0.13 * himmel + 0.50 * d + 0.18 * fyll) + vec3(glans);
  ut = vec4(col, uAlfa);
}`;

const VS_LINJE = `#version 300 es
in vec3 aPos;
uniform mat4 uVP; uniform vec3 uOff;
void main() { gl_Position = uVP * vec4(aPos + uOff, 1.0); }`;

const FS_LINJE = `#version 300 es
precision highp float;
uniform vec4 uFarg;
out vec4 ut;
void main() { ut = uFarg; }`;

function kompilera(gl, typ, kod) {
  const s = gl.createShader(typ);
  gl.shaderSource(s, kod);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, kompilera(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, kompilera(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("program: " + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export class Ritare {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("webgl2");
    this.gl = gl;
    this.buffrar = new Map();
    this.init();
  }

  init() {
    const gl = this.gl;
    this.yta = program(gl, VS_YTA, FS_YTA);
    this.linje = program(gl, VS_LINJE, FS_LINJE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  /** Lägger modellens blad i GPU-buffrar. */
  laddaModell(modell) {
    const gl = this.gl;
    for (const b of this.buffrar.values()) { gl.deleteVertexArray(b.vao); gl.deleteVertexArray(b.lvao); b.bufs.forEach((x) => gl.deleteBuffer(x)); }
    this.buffrar.clear();
    for (const leaf of modell.blad) {
      const bufs = [];
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const attr = (prog, namn, data, storlek) => {
        const loc = gl.getAttribLocation(prog, namn);
        const b = gl.createBuffer(); bufs.push(b);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, storlek, gl.FLOAT, false, 0, 0); }
      };
      attr(this.yta.p, "aPos", leaf.nat.pos, 3);
      attr(this.yta.p, "aNor", leaf.nat.nor, 3);
      attr(this.yta.p, "aYta", leaf.nat.yta, 1);
      const ib = gl.createBuffer(); bufs.push(ib);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, leaf.nat.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      let lvao = null;
      if (leaf.linjer.length) {
        lvao = gl.createVertexArray();
        gl.bindVertexArray(lvao);
        attr(this.linje.p, "aPos", leaf.linjer, 3);
        gl.bindVertexArray(null);
      }
      this.buffrar.set(leaf.id, { vao, lvao, n: leaf.nat.idx.length, nl: leaf.linjer.length / 3, bufs });
    }
  }

  /** Anpassar ritytan till elementets storlek (CSS-px × enhetens pixeltäthet, högst 2). */
  storlek() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  /**
   * opt: {modell, kamera, forskjutning: Map, synlig(leaf), markerade: Set(leafId), valdYta: {leaf, yta} | null,
   *       bakgrund: [r,g,b], accent: [r,g,b], kantAlfa}
   */
  rita(opt) {
    const gl = this.gl;
    const { w, h } = this.storlek();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = opt.bakgrund;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { vp, bas } = opt.kamera.matriser(w, h);
    const ljus = norm(add(add(bas.bak, mul(bas.upp, 0.55)), mul(bas.hoger, -0.35)));
    const synliga = opt.modell.blad.filter((l) => opt.synlig(l));

    // ytor
    const Y = this.yta;
    gl.useProgram(Y.p);
    gl.uniformMatrix4fv(Y.u.uVP, false, vp);
    gl.uniform3fv(Y.u.uKam, bas.pos);
    gl.uniform3fv(Y.u.uBak, bas.bak);
    gl.uniform3fv(Y.u.uLjus, ljus);
    gl.uniform3fv(Y.u.uAccent, opt.accent);
    gl.uniform1i(Y.u.uOrto, opt.kamera.orto ? 1 : 0);
    gl.uniform1f(Y.u.uAlfa, 1);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    for (const leaf of synliga) {
      const b = this.buffrar.get(leaf.id);
      if (!b || !b.n) continue;
      gl.uniform3fv(Y.u.uOff, opt.forskjutning.get(leaf.id) || [0, 0, 0]);
      gl.uniform3fv(Y.u.uFarg, leaf.farg);
      gl.uniform1f(Y.u.uMarkerad, opt.markerade.has(leaf.id) ? 1 : 0);
      gl.uniform1f(Y.u.uValdYta, opt.valdYta && opt.valdYta.leaf === leaf.id && opt.valdYta.yta !== null ? opt.valdYta.yta : -1e9);
      gl.bindVertexArray(b.vao);
      gl.drawElements(gl.TRIANGLES, b.n, gl.UNSIGNED_INT, 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // kantlinjer
    const L = this.linje;
    gl.useProgram(L.p);
    gl.uniformMatrix4fv(L.u.uVP, false, vp);
    for (const leaf of synliga) {
      const b = this.buffrar.get(leaf.id);
      if (!b || !b.lvao) continue;
      gl.uniform3fv(L.u.uOff, opt.forskjutning.get(leaf.id) || [0, 0, 0]);
      const c = opt.markerade.has(leaf.id) ? opt.accent.map((x) => x * 0.7) : leaf.kantFarg;
      gl.uniform4f(L.u.uFarg, c[0], c[1], c[2], 1);
      gl.bindVertexArray(b.lvao);
      gl.drawArrays(gl.LINES, 0, b.nl);
    }
    gl.bindVertexArray(null);
  }
}
