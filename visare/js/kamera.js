// Kretsande kamera som i appen (app/ModelView.swift): Z upp, yaw/pitch runt en målpunkt, 34° lodrät synvinkel,
// raka standardvyer ortografiskt. Ren logik: matriser, projektion och strålar för en vy med bredd × höjd (CSS-px).
import { add, cross, dot, len, mul, norm, ortografisk, perspektiv, sub, vyMatris, matMul } from "./vektor.js";

export const FOV = 34 * Math.PI / 180;
const HALV = FOV / 2;

export const STANDARDVYER = {
  // namn: [yaw, pitch]; Topp/Botten har skärmens upp = ±Y (yaw −π/2)
  "Topp": [-Math.PI / 2, Math.PI / 2],
  "Botten": [-Math.PI / 2, -Math.PI / 2],
  "+X": [0, 0], "−X": [Math.PI, 0], "+Y": [Math.PI / 2, 0], "−Y": [-Math.PI / 2, 0],
  "Persp": [-0.6, 0.6],
};
export const VYNAMN = { "Topp": "Uppifrån", "Botten": "Underifrån", "+X": "Från +X", "−X": "Från −X", "+Y": "Från +Y", "−Y": "Från −Y" };

export class Kamera {
  constructor() {
    this.yaw = -0.6; this.pitch = 0.6; this.dist = 200;
    this.target = [0, 0, 0];
    this.orto = null;          // namnet på en rak vy (visas ortografiskt) eller null
    this.radie = 100;          // modellens storlek, för när/fjärr-planen
  }

  /** Kamerans riktning från målpunkten (dir i appen). */
  riktning() {
    const cp = Math.cos(this.pitch);
    return [cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch)];
  }

  /** {pos, hoger, upp, bak}: bak pekar från målet mot kameran. Upp följer yaw så att rakt uppifrån inte blir odefinierat. */
  bas() {
    const bak = this.riktning();
    const hoger = [-Math.sin(this.yaw), Math.cos(this.yaw), 0];
    const upp = cross(bak, hoger);
    return { pos: add(this.target, mul(bak, this.dist)), hoger, upp, bak };
  }

  narFjarr() {
    const r = Math.max(this.radie, 1);
    if (this.orto) return [-(this.dist + 8 * r), this.dist + 8 * r];
    return [Math.max(this.dist * 0.01, 0.01), this.dist + 8 * r];
  }

  matriser(w, h) {
    const b = this.bas();
    const vy = vyMatris(b.pos, b.hoger, b.upp, b.bak);
    const [n, f] = this.narFjarr();
    const aspect = Math.max(w, 1) / Math.max(h, 1);
    const proj = this.orto ? ortografisk(this.dist * Math.tan(HALV), aspect, n, f) : perspektiv(FOV, aspect, n, f);
    return { vy, proj, vp: matMul(proj, vy), bas: b };
  }

  /** Punkt i världen → [x, y] i CSS-px (origo uppe till vänster) och djup längs blickriktningen; null bakom kameran. */
  projicera(p, w, h) {
    const b = this.bas();
    const d = sub(p, b.pos);
    const z = -dot(d, b.bak);
    if (!this.orto && z <= 1e-6) return null;
    const halvH = this.orto ? this.dist * Math.tan(HALV) : z * Math.tan(HALV);
    const s = (h / 2) / halvH;
    return [w / 2 + dot(d, b.hoger) * s, h / 2 - dot(d, b.upp) * s, z];
  }

  /** Stråle genom skärmpunkten (CSS-px): {o, d} med normerad d. */
  stråle(x, y, w, h) {
    const b = this.bas();
    const k = Math.tan(HALV) / (h / 2);
    const sx = (x - w / 2) * k, sy = (h / 2 - y) * k;
    if (this.orto) {
      const o = add(add(b.pos, mul(b.hoger, sx * this.dist)), mul(b.upp, sy * this.dist));
      return { o: add(o, mul(b.bak, 8 * this.radie)), d: mul(b.bak, -1) };
    }
    return { o: b.pos, d: norm(add(add(mul(b.bak, -1), mul(b.hoger, sx)), mul(b.upp, sy))) };
  }

  /** Världens mm per CSS-px på ett visst djup (för att dra delar i skärmplanet). */
  mmPerPx(djup, h) {
    return (this.orto ? this.dist : Math.max(djup, 1e-3)) * 2 * Math.tan(HALV) / Math.max(h, 1);
  }

  /** Avstånd så att en sfär med radien r syns helt (som fitDistance i appen). */
  passaAvstand(r, w, h) {
    const aspect = Math.max(w, 1) / Math.max(h, 1);
    const hHalv = Math.atan(Math.tan(HALV) * aspect);
    return r / Math.sin(Math.min(HALV, hHalv)) * 1.08;
  }

  passaIn(center, r, w, h) {
    this.target = [...center]; this.dist = this.passaAvstand(r, w, h); this.orto = null;
  }

  standardvy(namn, center, r, w, h) {
    const v = STANDARDVYER[namn];
    if (!v) return false;
    [this.yaw, this.pitch] = v;
    this.target = [...center]; this.dist = this.passaAvstand(r, w, h);
    this.orto = VYNAMN[namn] ? namn : null;
    return true;
  }

  /** Vrid (px). Pitch stannar vid rakt uppifrån/underifrån. */
  vrid(dx, dy) {
    this.orto = null;
    this.yaw -= dx * 0.008;
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch + dy * 0.008));
  }

  /** Panorera (px): det man pekar på följer pekaren. */
  panorera(dx, dy, h) {
    const b = this.bas();
    const k = this.mmPerPx(this.dist, h);
    this.target = add(this.target, add(mul(b.hoger, -dx * k), mul(b.upp, dy * k)));
  }

  /** Zooma med faktor f (< 1 = närmare) mot punkten p i världen (eller målpunkten). */
  zooma(f, p = null) {
    const ny = Math.max(this.radie * 0.002, Math.min(this.radie * 40, this.dist * f));
    const k = ny / this.dist;
    if (p) {
      // håll punkten stilla på skärmen: flytta målet mot p lika mycket som avståndet krymper
      this.target = add(p, mul(sub(this.target, p), k));
    }
    this.dist = ny;
  }

  /** Punkt i målpunktens djupplan under skärmpunkten (för zoom mot pekaren när inget träffas). */
  punktIPlan(x, y, w, h) {
    const s = this.stråle(x, y, w, h);
    const b = this.bas();
    const n = b.bak;
    const den = dot(s.d, n);
    if (Math.abs(den) < 1e-9) return [...this.target];
    const t = dot(sub(this.target, s.o), n) / den;
    return add(s.o, mul(s.d, t));
  }

  avstandTill(p) { return len(sub(p, this.bas().pos)); }
}
