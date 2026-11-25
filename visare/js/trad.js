// Objektträdet som i appen (app/Panel.swift, ObjektPanel): del → barndelar (foralder) → komponentgrupper (kroppens
// "grupp") → kroppar. En del med en enda kropp är en rad. Ren logik: ger en platt lista rader för DOM-koden.

/** Nyckel för en komponentgrupp (samma som UnderObjekt.gruppNyckel i appen). */
export function gruppNyckel(del, sti) { return del + "\u001F" + sti.join("\u001F"); }

function lika(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

/**
 * Rader i ordning. Varje rad: {nyckel, typ: "rubrik"|"del"|"grupp"|"kropp", namn, sub, farg, indrag (nivå),
 *   fallbar, utfalld, ogon: [id …] (vad ögat tänder/släcker), del}
 * utfallda: Set med del-id och gruppnycklar.
 */
export function tradRader(modell, utfallda) {
  const ids = new Set(modell.delar.map((d) => d.id));
  const topp = modell.delar.filter((d) => !d.foralder || !ids.has(d.foralder));
  const refs = topp.filter((d) => d.roll !== "design");
  const designs = topp.filter((d) => d.roll === "design");
  const rader = [];
  const rubriker = refs.length > 0 && designs.length > 0;
  const barnAv = (p) => modell.delar.filter((c) => c.foralder === p.id && c.id !== p.id);

  function delRad(p, indrag) {
    const subs = p.kroppar.length > 1 ? p.kroppar : [];
    const barn = barnAv(p);
    const ute = utfallda.has(p.id);
    const sub = subs.length > 1 ? `${subs.length} kroppar`
      : (barn.length && !ute ? "+ " + barn.map((b) => b.namn).join(", ") : p.beskrivning);
    rader.push({ nyckel: p.id, typ: "del", namn: p.namn, sub, farg: p.farg, indrag, fallbar: subs.length > 1 || barn.length > 0,
      utfalld: ute, ogon: [p.id], del: p.id, barn: barn.length > 0 });
    if (ute && subs.length > 1) gruppTrad(p, [], indrag + 1);
  }

  function gruppTrad(p, sti, indrag) {
    const d = sti.length;
    const inom = p.kroppar.filter((s) => s.grupp.length >= d && lika(s.grupp.slice(0, d), sti));
    const grenar = [];
    for (const s of inom) if (s.grupp.length > d && !grenar.includes(s.grupp[d])) grenar.push(s.grupp[d]);
    for (const g of grenar) {
      const gs = [...sti, g];
      const nyckel = gruppNyckel(p.id, gs);
      const kroppar = p.kroppar.filter((s) => s.grupp.length > d && lika(s.grupp.slice(0, d + 1), gs)).map((s) => `${p.id}#${s.n}`);
      const ute = utfallda.has(nyckel);
      rader.push({ nyckel, typ: "grupp", namn: g, sub: `${kroppar.length} kroppar`, farg: null, indrag, fallbar: true, utfalld: ute,
        ogon: kroppar, del: p.id });
      if (ute) gruppTrad(p, gs, indrag + 1);
    }
    for (const s of inom.filter((s) => s.grupp.length === d)) {
      const id = `${p.id}#${s.n}`;
      rader.push({ nyckel: id, typ: "kropp", namn: s.namn, sub: null, farg: p.farg, indrag, fallbar: false, utfalld: false, ogon: [id], del: p.id });
    }
  }

  function delTrad(p, indrag) {
    delRad(p, indrag);
    if (utfallda.has(p.id)) for (const c of barnAv(p)) delRad(c, indrag + 1);
  }

  if (rubriker && refs.length) rader.push({ nyckel: "#referens", typ: "rubrik", namn: "Referens" });
  for (const p of refs) delTrad(p, 0);
  if (rubriker && designs.length) rader.push({ nyckel: "#konstruktion", typ: "rubrik", namn: "Konstruktion" });
  for (const p of designs) delTrad(p, 0);
  return rader;
}

/** Är raden tänd? Del/kropp: id inte släckt. Grupp: någon av kropparna tänd. */
export function radTand(rad, dolda) {
  if (rad.typ === "grupp") return rad.ogon.some((id) => !dolda.has(id));
  return !dolda.has(rad.nyckel);
}

/** Ögat på en rad: ny mängd släckta. */
export function vaxlaOga(rad, dolda) {
  const ut = new Set(dolda);
  if (rad.typ === "grupp") {
    if (radTand(rad, dolda)) rad.ogon.forEach((id) => ut.add(id)); else rad.ogon.forEach((id) => ut.delete(id));
  } else if (ut.has(rad.nyckel)) ut.delete(rad.nyckel); else ut.add(rad.nyckel);
  return ut;
}

/** Raderna från toppen ner till det valda (som valdStig i appen): delar (med föräldrar), grupper, kroppen. */
export function valdStig(modell, val) {
  if (!val || !val.del) return [];
  const base = val.del;
  const delar = [base];
  const sedda = new Set([base]);
  for (;;) {
    const f = modell.delAv.get(delar[0])?.foralder;
    if (!f || sedda.has(f) || !modell.delAv.has(f)) break;
    delar.unshift(f); sedda.add(f);
  }
  const del = modell.delAv.get(base);
  const obj = val.objekt;
  if (!obj || obj === base || !del || del.kroppar.length <= 1) return delar;
  const s = del.kroppar.find((k) => `${base}#${k.n}` === obj);
  if (!s) return delar;
  return [...delar, ...s.grupp.map((_, i) => gruppNyckel(base, s.grupp.slice(0, i + 1))), obj];
}

/** Den rad som visar det valda: den djupaste i stigen som inte ligger under en ihopfälld nivå. */
export function valdRad(modell, val, utfallda) {
  const stig = valdStig(modell, val);
  if (!stig.length) return null;
  let rad = stig[0];
  for (const k of stig.slice(1)) { if (!utfallda.has(rad)) break; rad = k; }
  return rad;
}

/** Fäll ut trädet ner till det valda (dubbelklick). */
export function fallUtTillValt(modell, val, utfallda) {
  const ut = new Set(utfallda);
  valdStig(modell, val).slice(0, -1).forEach((k) => ut.add(k));
  return ut;
}
