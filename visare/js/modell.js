// Paketets delar → visarens modell: delar, kroppar (blad/"leaves" som i app/3DVerktyg.swift), ytor, kanter och nät.
// Allt i modellens ram: mm, Z upp. Ren logik utan DOM/WebGL.
import { harledKanter } from "./kanter.js";
import { blanda, cross, hexFarg, len, sub, TOM_HI, TOM_LO } from "./vektor.js";

/** Kroppens färg (som PartSpec.kroppsfarg i appen): egen färg, annars delens för kropp 0, sedan ljusare/mörkare. */
export function kroppsfarg(delFarg, n, egen) {
  if (egen && /^#?[0-9a-fA-F]{6}$/.test(egen)) return hexFarg(egen);
  if (n === 0) return delFarg;
  const steg = 0.12 * ((Math.floor((n + 1) / 2) - 1) % 3 + 1);
  return n % 2 === 1 ? blanda(delFarg, [1, 1, 1], steg) : blanda(delFarg, [0, 0, 0], steg);
}

/** Kroppsnummer per yta när filen saknar "kropp": union-find över ytor som delar hörnpunkter (0,01 mm). */
function kropparUrHorn(ytor) {
  const parent = ytor.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  const ga = new Map(), gb = new Map();
  ytor.forEach((f, i) => {
    for (let k = 0; k < f.v.length; k += 3) {
      const a = `${Math.round(f.v[k] * 100)},${Math.round(f.v[k + 1] * 100)},${Math.round(f.v[k + 2] * 100)}`;
      const b = `${Math.floor(f.v[k] * 100)},${Math.floor(f.v[k + 1] * 100)},${Math.floor(f.v[k + 2] * 100)}`;
      if (ga.has(a)) union(i, ga.get(a)); else ga.set(a, i);
      if (gb.has(b)) union(i, gb.get(b)); else gb.set(b, i);
    }
  });
  const nummer = new Map();
  ytor.forEach((_, i) => { const r = find(i); if (!nummer.has(r)) nummer.set(r, nummer.size); });
  ytor.forEach((f, i) => { f.kropp = nummer.get(find(i)); });
}

function tal(a) { return Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === "number" && isFinite(x)) ? a : null; }

/** Gör ett ritbart nät av en lista ytor (alla i samma kropp). Plana ytor får ytans normal, krökta mjuka normaler. */
export function byggNat(ytor) {
  let nv = 0, nt = 0;
  for (const f of ytor) { nv += f.v.length / 3; nt += f.t.length / 3; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), yta = new Float32Array(nv);
  const idx = new Uint32Array(nt * 3), triYta = new Int32Array(nt);
  let vo = 0, to = 0;
  for (const f of ytor) {
    const n = f.v.length / 3;
    pos.set(f.v, vo * 3);
    for (let i = 0; i < n; i++) yta[vo + i] = f.id;
    const plan = f.normal && f.typ === "plan";
    for (let k = 0; k + 2 < f.t.length; k += 3) {
      const a = f.t[k], b = f.t[k + 1], c = f.t[k + 2];
      if (a >= n || b >= n || c >= n) continue;
      idx[to * 3] = vo + a; idx[to * 3 + 1] = vo + b; idx[to * 3 + 2] = vo + c;
      triYta[to] = f.id;
      to++;
      if (!plan) {
        const pa = [f.v[3 * a], f.v[3 * a + 1], f.v[3 * a + 2]];
        const cr = cross(sub([f.v[3 * b], f.v[3 * b + 1], f.v[3 * b + 2]], pa), sub([f.v[3 * c], f.v[3 * c + 1], f.v[3 * c + 2]], pa));
        for (const v of [a, b, c]) { nor[(vo + v) * 3] += cr[0]; nor[(vo + v) * 3 + 1] += cr[1]; nor[(vo + v) * 3 + 2] += cr[2]; }
      }
    }
    for (let i = 0; i < n; i++) {
      const o = (vo + i) * 3;
      if (plan) { nor[o] = f.normal[0]; nor[o + 1] = f.normal[1]; nor[o + 2] = f.normal[2]; continue; }
      const l = Math.hypot(nor[o], nor[o + 1], nor[o + 2]) || 1;
      nor[o] /= l; nor[o + 1] /= l; nor[o + 2] /= l;
    }
    vo += n;
  }
  return { pos, nor, yta, idx: to * 3 === idx.length ? idx : idx.slice(0, to * 3), triYta: to === triYta.length ? triYta : triYta.slice(0, to) };
}

function kantLinjer(kanter) {
  let n = 0;
  for (const e of kanter) n += (e.pts.length - 1) * 6;
  const ut = new Float32Array(n);
  let o = 0;
  for (const e of kanter) for (let i = 1; i < e.pts.length; i++) { ut.set(e.pts[i - 1], o); ut.set(e.pts[i], o + 3); o += 6; }
  return ut;
}

/**
 * paket (version 1) → {
 *   namn, fran, brevlada, enhet,
 *   delar: [{id, namn, farg, foralder, roll, beskrivning, dold, nat, ytor: Map, kroppar: [{n, namn, grupp, farg}], blad: [id]}],
 *   blad (leaves): [{id, del, body, multi, namn, grupp, lo, hi, center, farg, kantFarg, ytIds, kanter, nat, linjer}],
 *   lo, hi, center, radie
 * }
 */
export function byggModell(paket) {
  const delar = [], blad = [];
  const sedda = new Set();
  for (const d of paket.delar || []) {
    if (!d || typeof d.id !== "string" || sedda.has(d.id)) continue;
    sedda.add(d.id);
    const farg = hexFarg(d.farg);
    const del = {
      id: d.id, namn: typeof d.namn === "string" && d.namn ? d.namn : d.id, farg, fargText: d.farg,
      foralder: typeof d.foralder === "string" && d.foralder ? d.foralder : null,
      roll: d.roll || null, beskrivning: typeof d.beskrivning === "string" ? d.beskrivning : null, dold: !!d.dold,
      nat: false, ytor: new Map(), kroppar: [], blad: [],
    };
    delar.push(del);
    if (d.nat && Array.isArray(d.nat.v) && Array.isArray(d.nat.t)) {
      del.nat = true;
      const yta = { id: -1, typ: "nät", v: d.nat.v, t: d.nat.t, normal: null };
      const nat = byggNat([yta]);
      nat.triYta.fill(-1);
      const { lo, hi } = granser(d.nat.v);
      if (!isFinite(lo[0])) continue;
      const leaf = nyttBlad(del.id, del.id, null, del.namn, lo, hi, farg, [], [], nat);
      del.blad.push(leaf.id); blad.push(leaf);
      continue;
    }
    // ytor
    const ytor = [];
    let harKropp = true;
    for (const f of Array.isArray(d.ytor) ? d.ytor : []) {
      if (!f || !Array.isArray(f.v) || !Array.isArray(f.t) || f.v.length < 9 || f.t.length < 3) continue;
      if (!Number.isInteger(f.kropp)) harKropp = false;
      ytor.push({
        id: f.id, typ: typeof f.typ === "string" ? f.typ : "yta", area: typeof f.area === "number" ? f.area : yttArea(f.v, f.t),
        centrum: tal(f.centrum), normal: tal(f.normal), radie: typeof f.radie === "number" ? f.radie : null,
        kropp: Number.isInteger(f.kropp) ? f.kropp : 0, v: f.v, t: f.t,
      });
    }
    if (!ytor.length) continue;
    if (!harKropp) kropparUrHorn(ytor);
    for (const f of ytor) del.ytor.set(f.id, f);
    const namngivna = new Map((Array.isArray(d.kroppar) ? d.kroppar : []).filter((k) => k && Number.isInteger(k.id)).map((k) => [k.id, k]));
    const perKropp = new Map();
    for (const f of ytor) { if (!perKropp.has(f.kropp)) perKropp.set(f.kropp, []); perKropp.get(f.kropp).push(f); }
    const nummer = [...perKropp.keys()].sort((a, b) => a - b);
    // kanter
    const kroppAvYta = new Map(ytor.map((f) => [f.id, f.kropp]));
    const hornKropp = new Map();
    for (const f of ytor) for (let k = 0; k < f.v.length; k += 3) hornKropp.set(qn(f.v[k], f.v[k + 1], f.v[k + 2]), f.kropp);
    let kanter = [];
    for (const e of Array.isArray(d.kanter) ? d.kanter : []) {
      if (!e || !Array.isArray(e.p) || e.p.length < 6) continue;
      const pts = [];
      for (let i = 0; i + 2 < e.p.length; i += 3) pts.push([e.p[i], e.p[i + 1], e.p[i + 2]]);
      const ytorE = Array.isArray(e.ytor) ? e.ytor : [];
      const kb = ytorE.map((y) => kroppAvYta.get(y)).find((x) => x !== undefined);
      let l = typeof e.langd === "number" ? e.langd : 0;
      if (typeof e.langd !== "number") for (let i = 1; i < pts.length; i++) l += len(sub(pts[i], pts[i - 1]));
      kanter.push({ id: e.id, typ: e.typ || "spline", langd: l, radie: typeof e.radie === "number" ? e.radie : null,
        centrum: tal(e.centrum), pts, ytor: ytorE, kropp: kb ?? hornKropp.get(qn(...pts[0])) ?? 0 });
    }
    if (!kanter.length) kanter = harledKanter(ytor);
    const multi = nummer.length > 1;
    for (const b of nummer) {
      const k = namngivna.get(b) || {};
      const kropp = { n: b, namn: typeof k.namn === "string" && k.namn ? k.namn : `Kropp ${b + 1}`,
        grupp: Array.isArray(k.grupp) ? k.grupp.filter((g) => typeof g === "string") : [], farg: k.farg || null };
      del.kroppar.push(kropp);
      const fs = perKropp.get(b);
      let lo = TOM_LO(), hi = TOM_HI();
      for (const f of fs) { const g = granser(f.v); lo = lo.map((x, i) => Math.min(x, g.lo[i])); hi = hi.map((x, i) => Math.max(x, g.hi[i])); }
      const id = multi ? `${del.id}#${b}` : del.id;
      const kf = kroppsfarg(farg, multi ? b : 0, kropp.farg);
      const leaf = nyttBlad(id, del.id, multi ? b : null, kropp.namn, lo, hi, kf, fs.map((f) => f.id),
        kanter.filter((e) => !multi || e.kropp === b), byggNat(fs));
      leaf.grupp = multi ? kropp.grupp : [];
      del.blad.push(id); blad.push(leaf);
    }
  }
  let lo = TOM_LO(), hi = TOM_HI();
  for (const l of blad) { lo = lo.map((x, i) => Math.min(x, l.lo[i])); hi = hi.map((x, i) => Math.max(x, l.hi[i])); }
  if (!isFinite(lo[0])) { lo = [-50, -50, -50]; hi = [50, 50, 50]; }
  const center = lo.map((x, i) => (x + hi[i]) / 2);
  return {
    namn: typeof paket.namn === "string" && paket.namn ? paket.namn : "Modell",
    fran: typeof paket.fran === "string" && paket.fran ? paket.fran : null,
    brevlada: typeof paket.brevlada === "string" && paket.brevlada ? paket.brevlada : null,
    enhet: paket.enhet || "mm",
    delar, blad, lo, hi, center,
    radie: Math.max(len(sub(hi, lo)) / 2, 1),
    delAv: new Map(delar.map((d) => [d.id, d])),
    bladAv: new Map(blad.map((l) => [l.id, l])),
  };
}

function qn(x, y, z) { return `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`; }

function granser(v) {
  const lo = TOM_LO(), hi = TOM_HI();
  for (let i = 0; i + 2 < v.length; i += 3) for (let a = 0; a < 3; a++) {
    if (v[i + a] < lo[a]) lo[a] = v[i + a];
    if (v[i + a] > hi[a]) hi[a] = v[i + a];
  }
  return { lo, hi };
}

function yttArea(v, t) {
  let s = 0;
  for (let k = 0; k + 2 < t.length; k += 3) {
    const p = (i) => [v[3 * i], v[3 * i + 1], v[3 * i + 2]];
    s += len(cross(sub(p(t[k + 1]), p(t[k])), sub(p(t[k + 2]), p(t[k])))) / 2;
  }
  return s;
}

function nyttBlad(id, del, body, namn, lo, hi, farg, ytIds, kanter, nat) {
  return {
    id, del, body, multi: id !== del, namn, lo, hi, center: lo.map((x, i) => (x + hi[i]) / 2), grupp: [],
    farg, kantFarg: blanda(farg, [0, 0, 0], 0.35), ytIds, kanter, nat, linjer: kantLinjer(kanter), bvh: null,
  };
}
