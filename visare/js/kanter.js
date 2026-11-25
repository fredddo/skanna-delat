// Kanter ur ytornas trianglar när ytor.json saknar "kanter" (äldre export) – port av deriveEdges i app/3DData.swift:
// gränser mellan ytor där ytorna möts i en vinkel (≥ 12°), hopkedjade till polylinjer och delade vid skarpa hörn (> 35°).
import { cross, dot, len, norm, sub } from "./vektor.js";

export const HARLEDD_KANT = 1_000_000;

const q = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`;
const qa = (p) => [Math.round(p[0] * 100), Math.round(p[1] * 100), Math.round(p[2] * 100)];
const pt = (v, i) => [v[3 * i], v[3 * i + 1], v[3 * i + 2]];

/** ytor: [{id, v, t, kropp}] (v/t som platta arrayer). Ger [{id, typ, langd, pts, ytor, kropp}]. */
export function harledKanter(ytor) {
  const segs = new Map();
  for (const f of ytor) {
    const n = f.v.length / 3;
    const count = new Map();
    for (let k = 0; k + 2 < f.t.length; k += 3) {
      const a = f.t[k], b = f.t[k + 1], c = f.t[k + 2];
      if (a >= n || b >= n || c >= n) continue;
      const cr = cross(sub(pt(f.v, b), pt(f.v, a)), sub(pt(f.v, c), pt(f.v, a)));
      const tn = len(cr) > 1e-9 ? norm(cr) : [0, 0, 0];
      for (const [x, y] of [[a, b], [b, c], [c, a]]) {
        const key = Math.min(x, y) * 4294967296 + Math.max(x, y);
        const e = count.get(key);
        count.set(key, [(e ? e[0] : 0) + 1, tn]);
      }
    }
    for (const [key, [c, tn]] of count) {
      if (c !== 1) continue;
      const pa = pt(f.v, Math.floor(key / 4294967296)), pb = pt(f.v, key % 4294967296);
      const ka = qa(pa), kb = qa(pb);
      if (ka[0] === kb[0] && ka[1] === kb[1] && ka[2] === kb[2]) continue;
      const mindre = ka[0] < kb[0] || (ka[0] === kb[0] && (ka[1] < kb[1] || (ka[1] === kb[1] && ka[2] < kb[2])));
      const k = mindre ? q(pa) + "|" + q(pb) : q(pb) + "|" + q(pa);
      const s = segs.get(k);
      if (s) { s.n.push(tn); s.faces.push(f.id); } else segs.set(k, { a: pa, b: pb, n: [tn], faces: [f.id], kropp: f.kropp ?? 0 });
    }
  }
  const cosMax = Math.cos(12 * Math.PI / 180);
  const kept = [...segs.values()].filter((s) => s.n.length < 2 || Math.abs(dot(s.n[0], s.n[1])) < cosMax || len(s.n[0]) < 0.5 || len(s.n[1]) < 0.5);
  const adj = new Map();
  kept.forEach((s, i) => {
    for (const k of [q(s.a), q(s.b)]) { if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); }
  });
  const used = new Array(kept.length).fill(false);
  const chains = [];
  function walk(start, v0) {
    let s = kept[start]; used[start] = true;
    const pts = q(s.a) === v0 ? [s.a, s.b] : [s.b, s.a];
    const faces = new Set(s.faces);
    let v = q(pts[1]);
    for (;;) {
      const list = adj.get(v);
      if (!list || list.length !== 2) break;
      const nxt = list.find((i) => !used[i]);
      if (nxt === undefined) break;
      s = kept[nxt]; used[nxt] = true;
      const p = q(s.a) === v ? s.b : s.a;
      pts.push(p); s.faces.forEach((x) => faces.add(x)); v = q(p);
    }
    return { pts, faces, kropp: kept[start].kropp };
  }
  for (const [v, list] of adj) if (list.length !== 2) for (const i of list) if (!used[i]) chains.push(walk(i, v));
  kept.forEach((s, i) => { if (!used[i]) chains.push(walk(i, q(s.a))); });

  const out = [];
  const cosTurn = Math.cos(35 * Math.PI / 180);
  function lagg(pts, faces, kropp) {
    if (pts.length < 2) return;
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += len(sub(pts[i], pts[i - 1]));
    if (l <= 0.05) return;
    const rakt = pts.length === 2 || pts.slice(1, -1).every((p) => len(cross(norm(sub(pts[pts.length - 1], pts[0])), sub(p, pts[0]))) < 0.02);
    out.push({ id: HARLEDD_KANT + out.length, typ: rakt ? "linje" : "kurva", langd: l, radie: null, centrum: null, pts,
      ytor: [...faces].sort((a, b) => a - b), kropp });
  }
  for (const c of chains) {
    let cur = [c.pts[0]];
    for (let i = 1; i < c.pts.length; i++) {
      cur.push(c.pts[i]);
      if (i < c.pts.length - 1) {
        const d1 = sub(c.pts[i], c.pts[i - 1]), d2 = sub(c.pts[i + 1], c.pts[i]);
        if (len(d1) > 1e-6 && len(d2) > 1e-6 && dot(norm(d1), norm(d2)) < cosTurn) { lagg(cur, c.faces, c.kropp); cur = [c.pts[i]]; }
      }
    }
    lagg(cur, c.faces, c.kropp);
  }
  return out;
}
