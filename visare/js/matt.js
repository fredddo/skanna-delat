// Mätning: fästpunkter (hörn, kantändar, kantmitt, cirkelcentrum, ytcentrum), närmaste punkt på en kant, avstånd
// och ytinformation. Som snapCandidates/measureSnap i app/3DVerktyg.swift. Ren logik.
import { add, len, sub } from "./vektor.js";

/** Decimalkomma och äkta minustecken (mm() i appen). */
export function tal(x, d = 1) {
  return x.toFixed(d).replace(".", ",").replace("-", "−").replace(/^−(0,0*)$/, "$1");
}

/** Bladets fästpunkter i modellens koordinater: [{typ, p, kant?, yta?}]. */
export function fastpunkter(leaf, del) {
  const ut = [];
  for (const e of leaf.kanter) {
    const a = e.pts[0], b = e.pts[e.pts.length - 1];
    ut.push({ typ: "hörn", p: a, kant: e.id });
    if (len(sub(b, a)) > 1e-3) ut.push({ typ: "hörn", p: b, kant: e.id });
    let l = 0;
    for (let i = 1; i < e.pts.length; i++) l += len(sub(e.pts[i], e.pts[i - 1]));
    let acc = 0;
    for (let i = 1; i < e.pts.length; i++) {
      const s = len(sub(e.pts[i], e.pts[i - 1]));
      if (acc + s >= l / 2) {
        const k = s > 0 ? (l / 2 - acc) / s : 0;
        ut.push({ typ: "kantmitt", p: e.pts[i - 1].map((x, j) => x + (e.pts[i][j] - x) * k), kant: e.id });
        break;
      }
      acc += s;
    }
    if ((e.typ === "cirkel" || e.typ === "båge") && e.centrum) ut.push({ typ: "cirkelcentrum", p: e.centrum, kant: e.id });
  }
  if (del) for (const id of leaf.ytIds) {
    const f = del.ytor.get(id);
    if (f && f.centrum) ut.push({ typ: "ytcentrum", p: f.centrum, yta: id });
  }
  return ut;
}

/**
 * Kandidater nära skärmpunkten m, sorterade på avstånd i px.
 * blad: [{leaf, forskjutning, punkter}], projicera(p) → [x, y, djup] | null.
 */
export function fastKandidater(blad, projicera, m, maxPx) {
  const ut = [];
  for (const { leaf, forskjutning: f, punkter } of blad) {
    for (const k of punkter) {
      const v = add(k.p, f);
      const s = projicera(v);
      if (!s) continue;
      const d = Math.hypot(s[0] - m[0], s[1] - m[1]);
      if (d <= maxPx) ut.push({ ...k, leaf, lokal: k.p, varld: v, px: d });
    }
  }
  return ut.sort((a, b) => a.px - b.px);
}

/** Närmaste punkt på någon kant inom maxPx (i skärmen): [{leaf, kant, lokal, varld, px}] sorterat. */
export function kantKandidater(blad, projicera, m, maxPx) {
  const ut = [];
  for (const { leaf, forskjutning: f } of blad) {
    for (const e of leaf.kanter) {
      let bast = null;
      let sp = projicera(add(e.pts[0], f));
      for (let i = 1; i < e.pts.length; i++) {
        const sq = projicera(add(e.pts[i], f));
        if (sp && sq) {
          const vx = sq[0] - sp[0], vy = sq[1] - sp[1];
          const l2 = vx * vx + vy * vy;
          const s = l2 > 0 ? Math.max(0, Math.min(1, ((m[0] - sp[0]) * vx + (m[1] - sp[1]) * vy) / l2)) : 0;
          const d = Math.hypot(sp[0] + vx * s - m[0], sp[1] + vy * s - m[1]);
          // perspektivet gör s i skärmen ≈ s i världen för korta segment
          if (!bast || d < bast.px) bast = { px: d, p: e.pts[i - 1].map((x, j) => x + (e.pts[i][j] - x) * s) };
        }
        sp = sq;
      }
      if (bast && bast.px <= maxPx) ut.push({ typ: "på kanten", leaf, kant: e.id, lokal: bast.p, varld: add(bast.p, f), px: bast.px });
    }
  }
  return ut.sort((a, b) => a.px - b.px);
}

/** Mätpunkt under pekaren: fästpunkt inom snapPx, annars en kant inom kantPx (synliga, inte skymda), annars null. */
export function matFaste(blad, projicera, m, skymd, { snapPx = 5, kantPx = 8 } = {}) {
  for (const c of fastKandidater(blad, projicera, m, snapPx).slice(0, 4)) if (!skymd(c.varld)) return c;
  for (const c of kantKandidater(blad, projicera, m, kantPx).slice(0, 4)) if (!skymd(c.varld)) return c;
  return null;
}

/** Avstånd och komponenter mellan två punkter (mm). */
export function matt(a, b) {
  const d = sub(b, a);
  return { avstand: len(d), dx: d[0], dy: d[1], dz: d[2] };
}

const TYPNAMN = { plan: "Plan yta", cylinder: "Cylinder", kon: "Kon", "sfär": "Sfär", torus: "Torus", "nät": "Nät" };

/** Ytans info som rader [rubrik, värde]. */
export function ytInfo(f) {
  const rader = [["Yta", TYPNAMN[f.typ] || (f.typ ? f.typ[0].toUpperCase() + f.typ.slice(1) : "Yta")]];
  if (typeof f.area === "number") rader.push(["Area", `${tal(f.area, f.area < 100 ? 2 : 1)} mm²`]);
  if (typeof f.radie === "number") {
    rader.push(["Radie", `${tal(f.radie, 2)} mm`]);
    rader.push(["Diameter", `⌀ ${tal(2 * f.radie, 2)} mm`]);
  }
  if (f.typ === "plan" && f.normal) rader.push(["Normal", f.normal.map((x) => tal(x, 2)).join("  ")]);
  return rader;
}

/** Kantens info som rader. */
export function kantInfo(e) {
  const typ = { linje: "Rak kant", cirkel: "Cirkel", "båge": "Båge", spline: "Kurva", kurva: "Kurva" }[e.typ] || "Kant";
  const rader = [["Kant", typ], ["Längd", `${tal(e.langd, 2)} mm`]];
  if (typeof e.radie === "number") { rader.push(["Radie", `${tal(e.radie, 2)} mm`]); rader.push(["Diameter", `⌀ ${tal(2 * e.radie, 2)} mm`]); }
  return rader;
}
