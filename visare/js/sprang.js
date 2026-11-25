// Sprängvy och flytt – exakt port av app/3DVerktyg.swift (synlig, sprangGrupp, explodeVector, synligaMatt, placeLeaves).
// Ren logik: ger förskjutningen per blad (kropp/del) i modellens ram (mm).
import { gruppNyckel } from "./trad.js";
import { add, len, mul, NOLL, sub } from "./vektor.js";

/** Bladet syns: varken delen, dess förälder eller bladet självt är släckt. */
export function synlig(modell, leaf, dolda) {
  const f = modell.delAv.get(leaf.del)?.foralder;
  if (f && dolda.has(f)) return false;
  return !dolda.has(leaf.del) && !dolda.has(leaf.id);
}

/** Sprängvyns enhet: en barndel under en hopfälld förälder följer föräldern; en hopfälld dels kroppar hålls ihop;
 *  kroppar under en hopfälld komponentgrupp följer gruppen; annars bladet självt. */
export function sprangGrupp(modell, leaf, utfallda) {
  const f = modell.delAv.get(leaf.del)?.foralder;
  if (f && !utfallda.has(f)) return f;
  if (leaf.multi && !utfallda.has(leaf.del)) return leaf.del;
  for (let d = 1; d <= leaf.grupp.length; d++) {
    const k = gruppNyckel(leaf.del, leaf.grupp.slice(0, d));
    if (!utfallda.has(k)) return k;
  }
  return leaf.id;
}

/** Riktning från de synliga objektens mitt; avståndet växer med hur långt ut gruppen ligger. */
export function explodeVector(arSynlig, mitt, centrum, storlek, t) {
  if (!arSynlig || !(storlek > 0)) return NOLL;
  const d = sub(mitt, centrum);
  const l = len(d);
  if (!(l > 1e-3)) return NOLL;
  const rel = Math.min(1, l / storlek);
  return mul(d, (t * storlek * (0.4 + 0.5 * rel)) / l);
}

/** Mitt och "radie" för de synliga bladen (reserv: hela modellens mitt och radie). */
export function synligaMatt(modell, dolda) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const leaf of modell.blad) {
    if (!synlig(modell, leaf, dolda)) continue;
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], leaf.lo[a]); hi[a] = Math.max(hi[a], leaf.hi[a]); }
  }
  if (!isFinite(lo[0])) return { centrum: modell.center, storlek: modell.radie };
  return { centrum: lo.map((x, i) => (x + hi[i]) / 2), storlek: Math.max(len(sub(hi, lo)) / 2, 1) };
}

/**
 * Bladens förskjutning vid sprängvyns grad t (0 = ihop, 1 = isär):
 *   vanlig flytt + t · (automatisk riktning + egen sprängflytt).
 * lage = {dolda: Set, utfallda: Set, t, flytt: Map(id → [x,y,z]), sprangFlytt: Map(id → [x,y,z])}
 * Ger Map(leafId → [x,y,z]).
 */
export function placeraBlad(modell, lage) {
  const { dolda, utfallda, t } = lage;
  const off = (id) => lage.flytt?.get(id) || NOLL;
  const spr = (id) => lage.sprangFlytt?.get(id) || NOLL;
  const { centrum, storlek } = synligaMatt(modell, dolda);
  const grupper = new Map();
  for (const leaf of modell.blad) {
    if (!synlig(modell, leaf, dolda)) continue;
    const g = sprangGrupp(modell, leaf, utfallda);
    const b = grupper.get(g) || { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    for (let a = 0; a < 3; a++) { b.lo[a] = Math.min(b.lo[a], leaf.lo[a]); b.hi[a] = Math.max(b.hi[a], leaf.hi[a]); }
    grupper.set(g, b);
  }
  const ut = new Map();
  for (const leaf of modell.blad) {
    const g = grupper.get(sprangGrupp(modell, leaf, utfallda));
    const mitt = g ? g.lo.map((x, i) => (x + g.hi[i]) / 2) : leaf.center;
    const e = explodeVector(synlig(modell, leaf, dolda), mitt, centrum, storlek, t);
    let p;
    if (leaf.multi) p = add(add(add(off(leaf.del), mul(spr(leaf.del), t)), e), add(off(leaf.id), mul(spr(leaf.id), t)));
    else p = add(e, add(off(leaf.del), mul(spr(leaf.del), t)));
    ut.set(leaf.id, p);
  }
  return ut;
}

/** Början på en dragning (som beginItemDrag): vilken nyckel som flyttas och dess startvärde. */
export function borjaDra(modell, leaf, lage, helaDelen = false) {
  const hela = helaDelen || sprangGrupp(modell, leaf, lage.utfallda) === leaf.del;
  const nyckel = hela ? leaf.del : leaf.id;
  const karta = lage.t > 0 ? lage.sprangFlytt : lage.flytt;
  return { nyckel, sprang: lage.t > 0, start: karta.get(nyckel) || NOLL, total: NOLL };
}

/** Ett steg i dragningen: varldsDelta = rörelsen i världen (mm) för musens rörelse. I sprängvyn delas med t,
 *  så att flytten skalar med reglaget (följer med ihop/isär). Ändrar lage.flytt/sprangFlytt. */
export function dra(drag, varldsDelta, lage) {
  const t = lage.t;
  drag.total = add(drag.total, mul(varldsDelta, 1 / (t > 0 ? Math.max(t, 0.05) : 1)));
  const v = add(drag.start, drag.total);
  (drag.sprang ? lage.sprangFlytt : lage.flytt).set(drag.nyckel, v);
  return v;
}
