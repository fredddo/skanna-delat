// Små vektor- och matrisfunktioner (arrayer [x, y, z]; matriser 4×4 kolumnvis som i WebGL).

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
export const vmin = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
export const vmax = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const NOLL = Object.freeze([0, 0, 0]);
export const TOM_LO = () => [Infinity, Infinity, Infinity];
export const TOM_HI = () => [-Infinity, -Infinity, -Infinity];

/** Vymatris ur kamerans läge och dess högra/upp/bakåt-axlar. */
export function vyMatris(pos, r, u, b) {
  return new Float32Array([
    r[0], u[0], b[0], 0,
    r[1], u[1], b[1], 0,
    r[2], u[2], b[2], 0,
    -dot(r, pos), -dot(u, pos), -dot(b, pos), 1,
  ]);
}

export function perspektiv(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function ortografisk(halvH, aspect, near, far) {
  const w = halvH * aspect, nf = 1 / (near - far);
  return new Float32Array([1 / w, 0, 0, 0, 0, 1 / halvH, 0, 0, 0, 0, 2 * nf, 0, 0, 0, (far + near) * nf, 1]);
}

export function matMul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

/** "#RRGGBB" → [r, g, b] i 0–1; ogiltig text ger reserv. */
export function hexFarg(h, reserv = [0.6, 0.64, 0.68]) {
  if (typeof h !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(h.trim())) return reserv;
  const s = h.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
}

export function blanda(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

export function cssFarg(c) { return `rgb(${c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(",")})`; }
