// Visarens huvudmodul: laddar paketet, kopplar ihop ritaren, kameran, objektträdet, sprängvyn, mätning, flytt och
// kommentarer med sidans DOM. Nyckeln stannar i webbläsaren: inga länkar, bilder eller anrop bär med sig fragmentet.
import { Kamera, VYNAMN } from "./kamera.js";
import { avkodaSvar, brevBlob, brevData, lasLagrat, nyKommentar, skickaBrev, sparaLagrat, svarslank } from "./kommentarer.js";
import { fastpunkter, kantInfo, matFaste, matt, tal, ytInfo } from "./matt.js";
import { byggModell } from "./modell.js";
import { FELTEXT, hamtaPaket, lasFragment, oppnaPaket, saknas, tolkaLank, VisarFel } from "./paket.js";
import { Ritare } from "./ritare.js";
import { borjaDra, dra, placeraBlad, synlig } from "./sprang.js";
import { stralMotModell } from "./stralar.js";
import { fallUtTillValt, radTand, tradRader, valdRad, valdStig, vaxlaOga } from "./trad.js";
import { add, dot, hexFarg, len, mul, sub } from "./vektor.js";

const $ = (id) => document.getElementById(id);
const grov = matchMedia("(pointer: coarse)");
const smal = matchMedia("(max-width: 720px)");
const morkt = matchMedia("(prefers-color-scheme: dark)");

const S = {
  modell: null, ritare: null, kamera: new Kamera(),
  id: null, nyckel: null, nyckelText: null,
  dolda: new Set(), utfallda: new Set(),
  t: 0, flytt: new Map(), sprangFlytt: new Map(), forskjutning: new Map(),
  verktyg: "valj", val: null,
  matning: { a: null, b: null }, hover: null,
  kommentarer: [], lankKommentarer: [], lankFran: null, namn: "",
  ny: null, aktivKommentar: null,
  farger: { bakgrund: [0.9, 0.9, 0.9], accent: [0.12, 0.43, 0.84] },
  fastCache: new Map(),
};

// ---------------------------------------------------------------- start

addEventListener("hashchange", () => location.reload());
start();

async function start() {
  try {
    if (!globalThis.isSecureContext) throw new VisarFel("osaker-sida");
    if (saknas().length) throw new VisarFel("gammal-webblasare");
    const frag = lasFragment(location.hash);
    const { id, nyckel } = tolkaLank(frag);
    S.id = id; S.nyckel = nyckel; S.nyckelText = frag.k;
    laddarText("Hämtar modellen …");
    const blob = await hamtaPaket(id);
    laddarText("Låser upp modellen …");
    const paket = await oppnaPaket(blob, nyckel);
    laddarText("Bygger 3D-vyn …");
    await new Promise((r) => requestAnimationFrame(() => r()));
    S.modell = byggModell(paket);
    try {
      S.ritare = new Ritare($("duk"));
    } catch {
      throw new VisarFel("gammal-webblasare", "Webbläsaren kan inte visa 3D (WebGL 2 saknas eller är avstängt). Prova en annan webbläsare eller slå på hårdvaruacceleration.");
    }
    S.ritare.laddaModell(S.modell);
    for (const d of S.modell.delar) if (d.dold) S.dolda.add(d.id);
    const lagrat = lasLagrat(S.id);
    S.kommentarer = lagrat.kommentarer; S.namn = lagrat.namn;
    $("ditNamn").value = S.namn;
    if (frag.c) {
      try {
        const svar = await avkodaSvar(frag.c);
        S.lankKommentarer = svar.kommentarer; S.lankFran = svar.fran;
      } catch {
        toast("Kommentarerna i länken gick inte att läsa");
      }
    }
    for (const k of S.lankKommentarer) if (k.del) { S.dolda.delete(k.del); if (k.kropp != null) S.dolda.delete(`${k.del}#${k.kropp}`); }
    oppnaVy();
  } catch (e) {
    visaFel(e);
  }
}

function laddarText(t) { $("laddarText").textContent = t; }

function visaFel(e) {
  $("laddar").hidden = true;
  const kod = e instanceof VisarFel ? e.kod : "trasig";
  $("felRubrik").textContent = {
    "borttagen": "Delningen finns inte längre", "ingen-nyckel": "Länken saknar nyckel", "fel-nyckel": "Fel nyckel",
    "gammal-webblasare": "Webbläsaren räcker inte till", "natverk": "Kunde inte hämta modellen", "osaker-sida": "Osäker anslutning",
  }[kod] || "Modellen kunde inte öppnas";
  $("felText").textContent = e instanceof VisarFel ? e.message : FELTEXT.trasig;
  $("fel").hidden = false;
  if (!(e instanceof VisarFel)) console.error(e);
}

function oppnaVy() {
  const m = S.modell;
  document.title = `${m.namn} – Skanna`;
  $("modellNamn").textContent = m.namn;
  $("modellFran").textContent = m.fran ? `Delad av ${m.fran}` : "";
  S.kamera.radie = m.radie;
  lasFarger();
  kopplaHandelser();
  satVerktyg("valj");
  if (!smal.matches) visaPanel("objektpanel", true);
  if (S.lankKommentarer.length) visaPanel("kommentarpanel", true);
  ritaTrad();
  ritaKommentarer();
  $("laddar").hidden = true;
  passaIn(false);
}

// ---------------------------------------------------------------- ritning

let ritBegard = false;
function begar() {
  if (ritBegard) return;
  ritBegard = true;
  requestAnimationFrame(() => { ritBegard = false; ritaNu(); });
}

const synligFn = (leaf) => synlig(S.modell, leaf, S.dolda);
const lage = () => ({ dolda: S.dolda, utfallda: S.utfallda, t: S.t, flytt: S.flytt, sprangFlytt: S.sprangFlytt });

function markerade() {
  const v = S.val;
  if (!v) return new Set();
  if (v.objekt) return new Set([v.objekt]);
  return new Set(S.modell.delAv.get(v.del)?.blad || []);
}

function ritaNu() {
  if (!S.modell) return;
  S.forskjutning = placeraBlad(S.modell, lage());
  S.ritare.rita({
    modell: S.modell, kamera: S.kamera, forskjutning: S.forskjutning, synlig: synligFn, markerade: markerade(),
    valdYta: S.val && S.val.yta != null ? { leaf: S.val.leafId, yta: S.val.yta } : null,
    bakgrund: S.farger.bakgrund, accent: S.farger.accent,
  });
  ritaOverlagg();
}

function lasFarger() {
  const cs = getComputedStyle(document.documentElement);
  S.farger.bakgrund = hexFarg(cs.getPropertyValue("--duk").trim(), [0.91, 0.92, 0.94]);
  S.farger.accent = hexFarg(cs.getPropertyValue("--accent").trim(), [0.12, 0.43, 0.84]);
  begar();
}

function storlek() { const c = $("duk"); return { w: c.clientWidth, h: c.clientHeight }; }
function projicera(p) { const { w, h } = storlek(); return S.kamera.projicera(p, w, h); }
function varldAv(leafId, lokal) { return add(lokal, S.forskjutning.get(leafId) || [0, 0, 0]); }

function traff(x, y) {
  const { w, h } = storlek();
  const s = S.kamera.stråle(x, y, w, h);
  return stralMotModell(S.modell.blad, S.forskjutning, synligFn, s.o, s.d);
}

/** Skyms punkten (i världen) av något närmare kameran? */
function skymd(p) {
  const s = projicera(p);
  if (!s) return true;
  const { w, h } = storlek();
  const r = S.kamera.stråle(s[0], s[1], w, h);
  const tp = dot(sub(p, r.o), r.d);
  const hit = stralMotModell(S.modell.blad, S.forskjutning, synligFn, r.o, r.d, tp);
  return !!hit && hit.t < tp - Math.max(0.05, S.modell.radie * 0.003);
}

// ---------------------------------------------------------------- overlägg: mätning, fästpunkt, nålar

const SVGNS = "http://www.w3.org/2000/svg";
const nalar = new Map();

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function placera(e, s) { e.style.left = `${s[0]}px`; e.style.top = `${s[1]}px`; }

function ritaOverlagg() {
  const svg = $("overlagg"), lager = $("etiketter");
  svg.replaceChildren();
  for (const e of [...lager.children]) if (!e.classList.contains("nal")) e.remove();
  // fästpunkt och kant under pekaren (Mät)
  if (S.hover) {
    if (S.hover.kantPts) {
      const pts = S.hover.kantPts.map((p) => projicera(varldAv(S.hover.leafId, p))).filter(Boolean);
      if (pts.length > 1) {
        const pl = document.createElementNS(SVGNS, "polyline");
        pl.setAttribute("class", "kant");
        pl.setAttribute("points", pts.map((s) => `${s[0].toFixed(1)},${s[1].toFixed(1)}`).join(" "));
        svg.append(pl);
      }
    }
    const s = projicera(varldAv(S.hover.leafId, S.hover.lokal));
    if (s) { const d = el("div", "punkt faste"); placera(d, s); lager.append(d); }
  }
  // mätning
  const { a, b } = S.matning;
  const pa = a && projicera(varldAv(a.leafId, a.lokal)), pb = b && projicera(varldAv(b.leafId, b.lokal));
  if (pa && pb) {
    for (const cls of ["mat-skugga", "mat"]) {
      const l = document.createElementNS(SVGNS, "line");
      l.setAttribute("class", cls);
      l.setAttribute("x1", pa[0]); l.setAttribute("y1", pa[1]); l.setAttribute("x2", pb[0]); l.setAttribute("y2", pb[1]);
      svg.append(l);
    }
    const m = matt(varldAv(a.leafId, a.lokal), varldAv(b.leafId, b.lokal));
    const lbl = el("div", "matetikett", `${tal(m.avstand, 2)} mm`);
    placera(lbl, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]);
    lager.append(lbl);
  }
  for (const s of [pa, pb]) if (s) { const d = el("div", "punkt"); placera(d, s); lager.append(d); }
  // nålar
  const visa = new Set();
  const lagg = (k, nr, cls) => {
    const leaf = bladFor(k);
    if (leaf && !synligFn(leaf)) return;
    const p = leaf ? varldAv(leaf.id, k.punkt) : k.punkt;
    const s = projicera(p);
    if (!s) return;
    const nyckel = cls + ":" + k.id;
    visa.add(nyckel);
    let e = nalar.get(nyckel);
    if (!e) {
      e = el("div", "nal " + cls);
      e.append(el("span", null, nr));
      e.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      e.addEventListener("click", (ev) => { ev.stopPropagation(); visaKommentar(k, cls === "lank"); });
      lager.append(e);
      nalar.set(nyckel, e);
    }
    e.firstChild.textContent = nr;
    e.title = k.text;
    e.classList.toggle("skymd", skymd(p));
    e.classList.toggle("aktiv", S.aktivKommentar === k.id);
    placera(e, s);
  };
  S.kommentarer.forEach((k, i) => lagg(k, String(i + 1), "egen"));
  S.lankKommentarer.forEach((k, i) => lagg(k, String(i + 1), "lank"));
  if (S.ny) {
    lagg({ id: "ny", punkt: S.ny.punkt, del: S.ny.del, kropp: S.ny.kropp, text: "" }, "+", "ny");
    const s = projicera(varldAv(S.ny.leafId, S.ny.punkt));
    if (s) placeraRuta($("kommentarRuta"), s);
  }
  for (const [k, e] of nalar) if (!visa.has(k)) { e.remove(); nalar.delete(k); }
}

function bladFor(k) {
  const m = S.modell;
  if (!k.del) return null;
  const del = m.delAv.get(k.del);
  if (!del) return null;
  const id = del.kroppar.length > 1 && k.kropp != null ? `${k.del}#${k.kropp}` : k.del;
  return m.bladAv.get(id) || m.bladAv.get(del.blad[0]) || null;
}

function placeraRuta(ruta, s) {
  const r = ruta.getBoundingClientRect();
  const W = innerWidth, H = innerHeight;
  let x = s[0] + 16, y = s[1] - r.height / 2;
  if (x + r.width > W - 8) x = s[0] - 16 - r.width;
  x = Math.max(8, Math.min(W - r.width - 8, x));
  y = Math.max(8, Math.min(H - r.height - 8, y));
  ruta.style.left = `${x}px`; ruta.style.top = `${y}px`;
}

// ---------------------------------------------------------------- kamera

function synligaGranser(bara = null) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const leaf of S.modell.blad) {
    if (!synligFn(leaf) || (bara && !bara.has(leaf.id))) continue;
    const f = S.forskjutning.get(leaf.id) || [0, 0, 0];
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], leaf.lo[a] + f[a]); hi[a] = Math.max(hi[a], leaf.hi[a] + f[a]); }
  }
  if (!isFinite(lo[0])) return null;
  return { center: lo.map((x, i) => (x + hi[i]) / 2), radie: Math.max(len(sub(hi, lo)) / 2, 0.5) };
}

function passaIn(animera = true, bara = null) {
  S.forskjutning = placeraBlad(S.modell, lage());
  const g = synligaGranser(bara) || { center: S.modell.center, radie: S.modell.radie };
  const { w, h } = storlek();
  const k = S.kamera;
  const fran = { target: [...k.target], dist: k.dist };
  k.passaIn(g.center, g.radie, w, h);
  if (animera) animeraKamera(fran, { target: k.target, dist: k.dist });
  ortoLapp();
  begar();
}

function standardvy(namn) {
  S.forskjutning = placeraBlad(S.modell, lage());
  const g = synligaGranser() || { center: S.modell.center, radie: S.modell.radie };
  const { w, h } = storlek();
  S.kamera.standardvy(namn, g.center, g.radie, w, h);
  ortoLapp();
  begar();
}

let kameraAnim = 0;
function animeraKamera(fran, till) {
  const k = S.kamera, t0 = performance.now(), id = ++kameraAnim;
  const steg = (nu) => {
    if (id !== kameraAnim) return;
    const u = Math.min(1, (nu - t0) / 280), e = u * u * (3 - 2 * u);
    k.target = fran.target.map((x, i) => x + (till.target[i] - x) * e);
    k.dist = fran.dist + (till.dist - fran.dist) * e;
    begar();
    if (u < 1) requestAnimationFrame(steg);
  };
  requestAnimationFrame(steg);
}

function flygTill(p) {
  const k = S.kamera;
  animeraKamera({ target: [...k.target], dist: k.dist }, { target: p, dist: Math.min(k.dist, S.modell.radie * 1.6) });
}

function ortoLapp() {
  const o = S.kamera.orto;
  $("ortoLapp").hidden = !o;
  if (o) $("ortoLapp").textContent = VYNAMN[o];
}

// ---------------------------------------------------------------- sprängvy och flytt

let sprangAnim = 0;
function satSprang(t, animera = false) {
  const id = ++sprangAnim;
  if (!animera) { S.t = t; $("sprang").value = String(t); begar(); return; }
  const fran = S.t, t0 = performance.now();
  const steg = (nu) => {
    if (id !== sprangAnim) return;
    const u = Math.min(1, (nu - t0) / 300), e = u * u * (3 - 2 * u);
    S.t = fran + (t - fran) * e;
    $("sprang").value = String(S.t);
    begar();
    if (u < 1) requestAnimationFrame(steg);
  };
  requestAnimationFrame(steg);
}

function aterstall() {
  S.flytt.clear(); S.sprangFlytt.clear();
  satSprang(0, true);
  toast("Läget återställt");
}

// ---------------------------------------------------------------- verktyg

const TIPS = {
  valj: ["Dra för att vrida · högerklick- eller ⇧-dra flyttar vyn · rulla eller nyp för att zooma · klicka för att välja",
    "Dra för att vrida · två fingrar flyttar och zoomar · tryck för att välja"],
  mat: ["Klicka två punkter – fäster mot hörn och kanter · Esc rensar", "Tryck två punkter – fäster mot hörn och kanter"],
  flytta: ["Dra en del för att flytta den · ⇧ låser till en axel · dubbelklick lägger tillbaka · R återställer",
    "Dra en del för att flytta den · dubbeltryck lägger tillbaka"],
  peka: ["Klicka en punkt i modellen och skriv en kommentar", "Tryck på en punkt i modellen och skriv en kommentar"],
};

function satVerktyg(v) {
  S.verktyg = v;
  for (const b of document.querySelectorAll("[data-verktyg]")) b.classList.toggle("vald", b.dataset.verktyg === v);
  for (const b of document.querySelectorAll("[data-verktyg]")) b.setAttribute("aria-pressed", String(b.dataset.verktyg === v));
  if (v !== "mat") { S.hover = null; }
  if (v !== "peka") avbrytKommentar();
  $("tips").textContent = TIPS[v][grov.matches ? 1 : 0];
  $("duk").style.cursor = v === "valj" ? "default" : v === "flytta" ? "grab" : "crosshair";
  begar();
}

function valj(nytt) {
  S.val = nytt;
  ritaTrad();
  visaValInfo();
  begar();
}

function visaValInfo() {
  const v = S.val;
  if (!v) { stangInfo(); return; }
  const del = S.modell.delAv.get(v.del);
  if (!del) return;
  const kropp = v.objekt ? del.kroppar.find((k) => `${del.id}#${k.n}` === v.objekt) : null;
  const rader = [];
  const f = v.yta != null ? del.ytor.get(v.yta) : null;
  if (f) rader.push(...ytInfo(f));
  visaInfo(del.namn + (kropp ? ` · ${kropp.namn}` : ""), rader, del.beskrivning);
}

function visaInfo(rubrik, rader = [], under = null, stort = null) {
  const c = $("infoInnehall");
  c.replaceChildren();
  c.append(el("h3", null, rubrik));
  if (stort) c.append(stort);
  if (rader.length) {
    const tb = el("table");
    for (const [a, b] of rader) { const tr = el("tr"); tr.append(el("td", null, a), el("td", null, b)); tb.append(tr); }
    c.append(tb);
  }
  if (under) c.append(el("p", "hjalp", under));
  $("info").hidden = false;
}

function stangInfo() { $("info").hidden = true; }

// ---------------------------------------------------------------- klick i 3D

function klick(x, y, pekTyp) {
  if (S.verktyg === "mat") { matKlick(x, y, pekTyp); return; }
  const h = traff(x, y);
  if (S.verktyg === "peka") { if (h) borjaKommentar(h); return; }
  if (!h) { S.aktivKommentar = null; valj(null); return; }
  valj({ del: h.leaf.del, objekt: h.leaf.multi ? h.leaf.id : null, yta: h.yta, leafId: h.leaf.id });
}

function dubbelklick(x, y) {
  const h = traff(x, y);
  if (S.verktyg === "flytta") {
    if (!h) return;
    for (const k of [h.leaf.id, h.leaf.del]) { S.flytt.delete(k); S.sprangFlytt.delete(k); }
    begar();
    return;
  }
  if (!h) { passaIn(); return; }
  if (S.val && S.val.del === h.leaf.del) {
    S.utfallda = fallUtTillValt(S.modell, S.val, S.utfallda);
    visaPanel("objektpanel", true);
    ritaTrad();
    begar();
  }
}

function fastBlad() {
  const ut = [];
  for (const leaf of S.modell.blad) {
    if (!synligFn(leaf)) continue;
    if (!S.fastCache.has(leaf.id)) S.fastCache.set(leaf.id, fastpunkter(leaf, S.modell.delAv.get(leaf.del)));
    ut.push({ leaf, forskjutning: S.forskjutning.get(leaf.id) || [0, 0, 0], punkter: S.fastCache.get(leaf.id) });
  }
  return ut;
}

function matPunkt(x, y, pekTyp) {
  const touch = pekTyp === "touch" || pekTyp === "pen";
  const f = matFaste(fastBlad(), projicera, [x, y], skymd, touch ? { snapPx: 14, kantPx: 18 } : { snapPx: 6, kantPx: 9 });
  if (f) {
    const kant = f.kant != null ? f.leaf.kanter.find((e) => e.id === f.kant) : null;
    return { leafId: f.leaf.id, lokal: f.lokal, typ: f.typ, kant, yta: f.yta ?? null };
  }
  const h = traff(x, y);
  if (h) return { leafId: h.leaf.id, lokal: h.lokal, typ: "yta", yta: h.yta, kant: null };
  return null;
}

const TYPTEXT = { "hörn": "Hörn", "kantmitt": "Kantens mitt", "cirkelcentrum": "Cirkelns centrum", "ytcentrum": "Ytans centrum", "på kanten": "På kanten", "yta": "På ytan" };

function matKlick(x, y, pekTyp) {
  const p = matPunkt(x, y, pekTyp);
  if (!p) { S.matning = { a: null, b: null }; stangInfo(); begar(); return; }
  if (!S.matning.a || S.matning.b) S.matning = { a: p, b: null }; else S.matning.b = p;
  const leaf = S.modell.bladAv.get(p.leafId);
  const del = S.modell.delAv.get(leaf.del);
  const extra = [];
  if (p.kant) extra.push(...kantInfo(p.kant));
  else if (p.yta != null && del.ytor.get(p.yta)) extra.push(...ytInfo(del.ytor.get(p.yta)));
  const vad = `${TYPTEXT[p.typ] || "Punkt"} · ${del.namn}${leaf.multi ? " · " + leaf.namn : ""}`;
  if (S.matning.b) {
    const { a, b } = S.matning;
    const m = matt(varldAv(a.leafId, a.lokal), varldAv(b.leafId, b.lokal));
    const stort = el("div");
    stort.append(el("div", "stort", `${tal(m.avstand, 2)} mm`));
    const d = el("div");
    d.append(el("span", "dx", `dx ${tal(m.dx, 2)}`), "   ", el("span", "dy", `dy ${tal(m.dy, 2)}`), "   ", el("span", "dz", `dz ${tal(m.dz, 2)}`));
    stort.append(d);
    visaInfo("Avstånd", extra, `Punkt 2: ${vad}`, stort);
  } else {
    visaInfo("Punkt 1 – klicka en andra punkt", extra, vad);
  }
  begar();
}

let hoverBegard = null;
function hover(x, y) {
  if (S.verktyg !== "mat") return;
  hoverBegard = [x, y];
  requestAnimationFrame(() => {
    if (!hoverBegard) return;
    const [hx, hy] = hoverBegard; hoverBegard = null;
    const f = matFaste(fastBlad(), projicera, [hx, hy], skymd, { snapPx: 6, kantPx: 9 });
    const ny = f ? { leafId: f.leaf.id, lokal: f.lokal, kantPts: f.typ === "på kanten" ? f.leaf.kanter.find((e) => e.id === f.kant)?.pts : null } : null;
    if (JSON.stringify(ny) !== JSON.stringify(S.hover)) { S.hover = ny; begar(); }
  });
}

// ---------------------------------------------------------------- kommentarer

function borjaKommentar(h) {
  S.ny = { punkt: h.lokal, del: h.leaf.del, kropp: h.leaf.body, leafId: h.leaf.id };
  $("kommentarText").value = "";
  $("kommentarRuta").hidden = false;
  begar();
  setTimeout(() => $("kommentarText").focus(), 0);
}

function avbrytKommentar() {
  S.ny = null;
  $("kommentarRuta").hidden = true;
  begar();
}

function sparaKommentar() {
  const text = $("kommentarText").value.trim();
  if (!S.ny) return;
  if (!text) { $("kommentarText").focus(); return; }
  const k = nyKommentar({ text, punkt: S.ny.punkt, del: S.ny.del, kropp: S.ny.kropp });
  S.kommentarer.push(k);
  sparaLokalt();
  avbrytKommentar();
  ritaKommentarer();
  toast(`Kommentar ${S.kommentarer.length} sparad`);
}

function sparaLokalt() {
  if (!sparaLagrat(S.id, { namn: S.namn, kommentarer: S.kommentarer })) {
    setStatus("Webbläsaren tillåter inte att kommentarerna sparas – skicka dem innan du stänger sidan.", "fel");
  }
}

function tidText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

function kommentarRad(k, nr, lank) {
  const li = el("li", "kommentar" + (lank ? " lank" : ""));
  li.append(el("span", "nr", String(nr)));
  const kropp = el("div", "kropp");
  kropp.append(el("div", "text", k.text));
  const del = k.del && S.modell.delAv.get(k.del);
  const meta = [del ? del.namn : null, tidText(k.tid), k.skickad ? "skickad" : null].filter(Boolean).join(" · ");
  kropp.append(el("div", "meta", meta));
  li.append(kropp);
  if (!lank) {
    const bort = el("button", "bort", "✕");
    bort.title = "Ta bort kommentaren";
    bort.setAttribute("aria-label", "Ta bort kommentaren");
    bort.addEventListener("click", (e) => {
      e.stopPropagation();
      S.kommentarer = S.kommentarer.filter((x) => x.id !== k.id);
      sparaLokalt(); ritaKommentarer(); begar();
    });
    li.append(bort);
  }
  li.addEventListener("click", () => visaKommentar(k, lank, true));
  return li;
}

function visaKommentar(k, lank, flyg = false) {
  S.aktivKommentar = k.id;
  const leaf = bladFor(k);
  if (leaf && !synligFn(leaf)) { S.dolda.delete(leaf.id); S.dolda.delete(leaf.del); ritaTrad(); }
  const p = leaf ? varldAv(leaf.id, k.punkt) : k.punkt;
  if (flyg) flygTill(p);
  const del = k.del && S.modell.delAv.get(k.del);
  const fran = lank ? (S.lankFran || "länken") : "dig";
  visaInfo(`Kommentar från ${fran}`, [], [del ? del.namn : null, tidText(k.tid)].filter(Boolean).join(" · "), el("p", "text", k.text));
  if (smal.matches) visaPanel("kommentarpanel", false);
  begar();
}

function ritaKommentarer() {
  const lista = $("kommentarLista");
  lista.replaceChildren(...S.kommentarer.map((k, i) => kommentarRad(k, i + 1, false)));
  $("kommentarHjalp").hidden = S.kommentarer.length > 0;
  $("lankKommentarer").hidden = !S.lankKommentarer.length;
  $("lankKommentarRubrik").textContent = `Kommentarer i länken${S.lankFran ? " från " + S.lankFran : ""}`;
  $("lankKommentarLista").replaceChildren(...S.lankKommentarer.map((k, i) => kommentarRad(k, i + 1, true)));
  const n = S.kommentarer.length + S.lankKommentarer.length;
  $("antalKommentarer").hidden = !n;
  $("antalKommentarer").textContent = String(n);
  const osanda = S.kommentarer.filter((k) => !k.skickad).length;
  const knapp = $("knappSkicka");
  if (S.modell.brevlada) {
    knapp.textContent = osanda ? `Skicka ${osanda === 1 ? "kommentaren" : osanda + " kommentarer"}` : "Skicka kommentarer";
    knapp.disabled = !osanda;
  } else {
    knapp.textContent = "Skapa svarslänk";
    knapp.disabled = !S.kommentarer.length;
  }
}

function setStatus(text, typ = "") {
  const s = $("skickaStatus");
  s.textContent = text;
  s.className = "status " + typ;
}

let skickar = false;
async function skicka() {
  if (skickar) return;
  skickar = true;
  $("knappSkicka").disabled = true;
  const osanda = S.kommentarer.filter((k) => !k.skickad);
  const mottagare = S.modell.fran || "ägaren";
  $("svarslankRuta").hidden = true;
  try {
    if (S.modell.brevlada && osanda.length) {
      setStatus("Skickar …");
      try {
        const blob = await brevBlob(brevData(S.namn, osanda), S.nyckel);
        await skickaBrev(S.modell.brevlada, blob);
        const tid = new Date().toISOString();
        for (const k of osanda) k.skickad = tid;
        sparaLokalt();
        setStatus(`Skickat till ${mottagare}.`, "ok");
        toast(`Skickat till ${mottagare}`);
        return;
      } catch (e) {
        setStatus(`Kunde inte skicka till brevlådan (${e.message}). Skicka i stället svarslänken nedan till ${mottagare}.`, "fel");
      }
    } else {
      setStatus("");
    }
    const urval = osanda.length ? osanda : S.kommentarer;
    const bas = location.origin + location.pathname;
    $("svarslank").value = await svarslank(bas, S.id, S.nyckelText, brevData(S.namn, urval));
    $("svarslankText").textContent = `Skicka den här länken till ${mottagare} – den innehåller dina kommentarer (och nyckeln till modellen):`;
    $("svarslankRuta").hidden = false;
    $("knappDela").hidden = typeof navigator.share !== "function";
  } finally {
    skickar = false;
    ritaKommentarer();
  }
}

async function kopiera() {
  const f = $("svarslank");
  try {
    await navigator.clipboard.writeText(f.value);
  } catch {
    f.select();
    document.execCommand("copy");
  }
  toast("Länken kopierad");
}

async function dela() {
  try {
    await navigator.share({ title: `Kommentarer om ${S.modell.namn}`, url: $("svarslank").value });
  } catch { /* avbrutet */ }
}

// ---------------------------------------------------------------- objektträdet

function ogaIkon(pa) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVGNS, "path");
  p.setAttribute("d", "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z");
  p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.7");
  svg.append(p);
  const c = document.createElementNS(SVGNS, "circle");
  c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "3");
  c.setAttribute("fill", pa ? "currentColor" : "none"); c.setAttribute("stroke", "currentColor"); c.setAttribute("stroke-width", "1.7");
  svg.append(c);
  if (!pa) {
    const l = document.createElementNS(SVGNS, "path");
    l.setAttribute("d", "M4 20 20 4"); l.setAttribute("stroke", "currentColor"); l.setAttribute("stroke-width", "1.9");
    svg.append(l);
  }
  return svg;
}

function ritaTrad() {
  const m = S.modell;
  const rader = tradRader(m, S.utfallda);
  const rad = valdRad(m, S.val, S.utfallda);
  const stig = new Set(valdStig(m, S.val));
  const ut = [];
  for (const r of rader) {
    if (r.typ === "rubrik") { ut.push(el("div", "trad-rubrik", r.namn)); continue; }
    const tand = radTand(r, S.dolda);
    const d = el("div", "trad-rad" + (rad === r.nyckel ? " vald" : stig.has(r.nyckel) ? " stig" : "") + (tand ? "" : " slackt"));
    d.setAttribute("role", "treeitem");
    if (r.fallbar) d.setAttribute("aria-expanded", String(r.utfalld));
    d.style.paddingLeft = `${4 + r.indrag * 16}px`;
    const pil = el("button", "pil" + (r.fallbar ? "" : " tom"), r.utfalld ? "▼" : "▶");
    pil.tabIndex = r.fallbar ? 0 : -1;
    pil.setAttribute("aria-label", r.utfalld ? "Fäll ihop" : "Fäll ut");
    pil.title = r.utfalld ? "Fäll ihop – i sprängvyn hålls delarna då ihop" : "Fäll ut – i sprängvyn dras delarna då isär var för sig";
    pil.addEventListener("click", (e) => { e.stopPropagation(); vaxlaUtfalld(r.nyckel); });
    d.append(pil);
    if (r.typ === "grupp") d.append(el("span", "lada-ikon"));
    else { const p = el("span", "prick"); p.style.background = `rgb(${r.farg.map((x) => Math.round(x * 255)).join(",")})`; if (r.typ === "kropp") p.style.opacity = "0.7"; d.append(p); }
    const namn = el("div", "namn");
    namn.append(el("span", null, r.namn));
    if (r.sub) namn.append(el("span", "under", r.sub));
    d.title = r.sub ? `${r.namn}\n${r.sub}` : r.namn;
    d.append(namn);
    const oga = el("button", "oga" + (tand ? "" : " av"));
    oga.append(ogaIkon(tand));
    oga.title = tand ? "Släck" : "Tänd";
    oga.setAttribute("aria-label", (tand ? "Släck " : "Tänd ") + r.namn);
    oga.addEventListener("click", (e) => { e.stopPropagation(); S.dolda = vaxlaOga(r, S.dolda); ritaTrad(); begar(); });
    d.append(oga);
    d.addEventListener("click", () => {
      if (r.typ === "grupp") { vaxlaUtfalld(r.nyckel); return; }
      const nytt = r.typ === "kropp" ? { del: r.del, objekt: r.nyckel, yta: null, leafId: r.nyckel } : { del: r.del, objekt: null, yta: null, leafId: null };
      const samma = S.val && S.val.del === nytt.del && S.val.objekt === nytt.objekt && S.val.yta == null;
      valj(samma ? null : nytt);
    });
    d.addEventListener("dblclick", () => { if (r.typ !== "grupp") zoomaTillValt(); });
    ut.push(d);
  }
  $("trad").replaceChildren(...ut);
  $("knappVisaAlla").disabled = S.dolda.size === 0;
  $("knappBaraVald").hidden = !S.val;
  const v = $("trad").querySelector(".vald");
  if (v) v.scrollIntoView({ block: "nearest" });
}

function vaxlaUtfalld(k) {
  if (S.utfallda.has(k)) S.utfallda.delete(k); else S.utfallda.add(k);
  ritaTrad();
  begar();
}

function baraVald() {
  const v = S.val;
  if (!v) return;
  const m = S.modell;
  const alla = new Set();
  for (const d of m.delar) { alla.add(d.id); if (d.kroppar.length > 1) for (const k of d.kroppar) alla.add(`${d.id}#${k.n}`); }
  if (v.objekt) alla.delete(v.objekt);
  alla.delete(v.del);
  for (const c of m.delar.filter((c) => c.foralder === v.del)) { alla.delete(c.id); for (const k of c.kroppar) alla.delete(`${c.id}#${k.n}`); }
  if (!v.objekt) for (const k of m.delAv.get(v.del)?.kroppar || []) alla.delete(`${v.del}#${k.n}`);
  S.dolda = alla;
  ritaTrad();
  begar();
}

function zoomaTillValt() {
  const ids = markerade();
  if (!ids.size) { passaIn(); return; }
  passaIn(true, ids);
}

// ---------------------------------------------------------------- paneler

function visaPanel(id, pa) {
  const p = $(id);
  if (pa === undefined) pa = p.hidden;
  if (pa && smal.matches) for (const annan of ["objektpanel", "kommentarpanel"]) if (annan !== id) visaPanel(annan, false);
  p.hidden = !pa;
  p.style.transform = "";
  $(id === "objektpanel" ? "knappObjekt" : "knappKommentarer").setAttribute("aria-pressed", String(pa));
}

function ladDrag(panel) {
  // smal skärm: dra lådan nedåt i handtaget/huvudet för att stänga den
  let y0 = null, dy = 0;
  const start = (e) => {
    if (!smal.matches || e.target.closest("button")) return;
    y0 = e.clientY; dy = 0;
    panel.classList.add("drar");
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const flytta = (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  };
  const slut = () => {
    if (y0 == null) return;
    y0 = null;
    panel.classList.remove("drar");
    if (dy > 70) visaPanel(panel.id, false); else panel.style.transform = "";
  };
  for (const h of panel.querySelectorAll(".handtag, .panelhuvud")) {
    h.addEventListener("pointerdown", start);
    h.addEventListener("pointermove", flytta);
    h.addEventListener("pointerup", slut);
    h.addEventListener("pointercancel", slut);
  }
}

let toastTimer = 0;
function toast(t) {
  const e = $("toast");
  e.textContent = t;
  e.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { e.hidden = true; }, 1600);
}

// ---------------------------------------------------------------- händelser

function kopplaHandelser() {
  const duk = $("duk");
  const pekare = new Map();
  let gest = null, senasteTryck = null;

  const pos = (e) => { const r = duk.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  duk.addEventListener("contextmenu", (e) => e.preventDefault());
  duk.addEventListener("pointerdown", (e) => {
    duk.focus({ preventScroll: true });
    duk.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    pekare.set(e.pointerId, { x, y });
    kameraAnim++;
    if (pekare.size === 2) {
      const [a, b] = [...pekare.values()];
      gest = { typ: "nyp", d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pekare.size > 2) return;
    const pan = e.button === 1 || e.button === 2 || e.shiftKey && S.verktyg !== "flytta";
    gest = { typ: "vanta", x0: x, y0: y, x, y, pan, typPek: e.pointerType };
    if (S.verktyg === "flytta" && e.button === 0) {
      const h = traff(x, y);
      if (h) {
        gest = { typ: "dra", x0: x, y0: y, x, y, leaf: h.leaf, drag: borjaDra(S.modell, h.leaf, lage(), e.altKey), flyttat: false, typPek: e.pointerType };
        duk.style.cursor = "grabbing";
      }
    }
  });

  duk.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    if (!pekare.has(e.pointerId)) { if (e.pointerType === "mouse") hover(x, y); return; }
    const p = pekare.get(e.pointerId);
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (!gest) return;
    const { h } = storlek();
    if (gest.typ === "nyp") {
      if (pekare.size < 2) return;
      const [a, b] = [...pekare.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const { w } = storlek();
      if (d > 0 && gest.d > 0) S.kamera.zooma(gest.d / d, S.kamera.punktIPlan(mx, my, w, h));
      S.kamera.panorera(mx - gest.mx, my - gest.my, h);
      gest.d = d; gest.mx = mx; gest.my = my;
      ortoLapp(); begar();
      return;
    }
    if (gest.typ === "vanta") {
      const troskel = gest.typPek === "mouse" ? 3 : 8;
      if (Math.hypot(x - gest.x0, y - gest.y0) < troskel) return;
      gest.typ = gest.pan ? "panorera" : "vrid";
    }
    if (gest.typ === "vrid") { S.kamera.vrid(dx, dy); ortoLapp(); begar(); }
    else if (gest.typ === "panorera") { S.kamera.panorera(dx, dy, h); begar(); }
    else if (gest.typ === "dra") {
      if (!gest.flyttat && Math.hypot(x - gest.x0, y - gest.y0) < (gest.typPek === "mouse" ? 2 : 6)) return;
      gest.flyttat = true;
      const b = S.kamera.bas();
      const c = add(gest.leaf.center, S.forskjutning.get(gest.leaf.id) || [0, 0, 0]);
      const k = S.kamera.mmPerPx(-dot(sub(c, b.pos), b.bak), h);
      // räknas från startpunkten (inte stegvis), så att ⇧-låsningen kan slås av och på under dragningen
      const total = add(mul(b.hoger, (x - gest.x0) * k), mul(b.upp, -(y - gest.y0) * k));
      gest.drag.total = [0, 0, 0];
      let delta = total;
      if (e.shiftKey) {
        const a = total.map(Math.abs);
        const ax = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
        delta = [0, 0, 0]; delta[ax] = total[ax];
      }
      dra(gest.drag, delta, lage());
      begar();
    }
  });

  const slut = (e, avbruten) => {
    if (!pekare.has(e.pointerId)) return;
    pekare.delete(e.pointerId);
    const [x, y] = pos(e);
    if (gest && gest.typ === "vanta" && !avbruten && pekare.size === 0) {
      klick(x, y, e.pointerType);
      const nu = performance.now();
      if (senasteTryck && nu - senasteTryck.t < 380 && Math.hypot(x - senasteTryck.x, y - senasteTryck.y) < 14) {
        dubbelklick(x, y);
        senasteTryck = null;
      } else senasteTryck = { t: nu, x, y };
    } else if (gest && gest.typ === "dra" && !gest.flyttat && !avbruten) {
      klick(x, y, e.pointerType);
    }
    if (gest && gest.typ === "dra") duk.style.cursor = "grab";
    if (pekare.size === 0) gest = null;
    else if (gest && gest.typ === "nyp") {
      const [p] = [...pekare.values()];
      gest = { typ: "vrid", x0: p.x, y0: p.y, x: p.x, y: p.y };
    }
  };
  duk.addEventListener("pointerup", (e) => slut(e, false));
  duk.addEventListener("pointercancel", (e) => slut(e, true));
  duk.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pekare.size && S.hover) { S.hover = null; begar(); } });

  duk.addEventListener("wheel", (e) => {
    e.preventDefault();
    kameraAnim++;
    const [x, y] = pos(e);
    const { w, h } = storlek();
    const skala = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? h : 1;
    const dx = e.deltaX * skala, dy = e.deltaY * skala;
    const mot = () => (traff(x, y)?.varld) || S.kamera.punktIPlan(x, y, w, h);
    if (e.ctrlKey) {
      S.kamera.zooma(Math.exp(dy * 0.01), mot());   // nyp på styrplatta
    } else if (arMushjul(e)) {
      S.kamera.zooma(Math.exp(dy * 0.0015), mot());
    } else if (e.shiftKey) {
      S.kamera.panorera(-dx, -dy, h);
    } else {
      S.kamera.vrid(-dx, -dy);
    }
    ortoLapp();
    begar();
  }, { passive: false });

  // Safari på Mac: nyp på styrplattan kommer som gesture-händelser
  let gskala = 1;
  document.addEventListener("gesturestart", (e) => { e.preventDefault(); gskala = 1; });
  document.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    if (pekare.size) return;   // pekskärm: pekarhändelserna sköter nypet
    const { w, h } = storlek();
    const r = duk.getBoundingClientRect();
    S.kamera.zooma(gskala / e.scale, S.kamera.punktIPlan(e.clientX - r.left, e.clientY - r.top, w, h));
    gskala = e.scale;
    begar();
  });
  document.addEventListener("gestureend", (e) => e.preventDefault());

  addEventListener("resize", begar);
  morkt.addEventListener("change", lasFarger);
  grov.addEventListener("change", () => satVerktyg(S.verktyg));

  // verktygsraden
  for (const b of document.querySelectorAll("[data-verktyg]")) b.addEventListener("click", () => satVerktyg(b.dataset.verktyg));
  $("sprang").addEventListener("input", (e) => satSprang(parseFloat(e.target.value)));
  $("knappPassa").addEventListener("click", () => passaIn());
  $("knappAterstall").addEventListener("click", aterstall);
  const meny = $("vyMeny");
  $("knappVyer").addEventListener("click", (e) => {
    e.stopPropagation();
    meny.hidden = !meny.hidden;
    $("knappVyer").setAttribute("aria-expanded", String(!meny.hidden));
  });
  for (const b of meny.querySelectorAll("[data-vy]")) b.addEventListener("click", () => { standardvy(b.dataset.vy); meny.hidden = true; });
  document.addEventListener("click", (e) => { if (!meny.hidden && !e.target.closest(".vyer")) meny.hidden = true; });
  $("knappObjekt").addEventListener("click", () => visaPanel("objektpanel"));
  $("knappKommentarer").addEventListener("click", () => visaPanel("kommentarpanel"));
  for (const b of document.querySelectorAll("[data-stang]")) b.addEventListener("click", () => visaPanel(b.dataset.stang, false));
  ladDrag($("objektpanel")); ladDrag($("kommentarpanel"));
  $("knappVisaAlla").addEventListener("click", () => { S.dolda = new Set(); ritaTrad(); begar(); });
  $("knappBaraVald").addEventListener("click", baraVald);
  $("infoStang").addEventListener("click", () => {
    stangInfo();
    S.matning = { a: null, b: null }; S.aktivKommentar = null;
    if (S.val) valj(null); else begar();
  });

  // kommentarer
  $("knappSparaKommentar").addEventListener("click", sparaKommentar);
  $("knappAvbrytKommentar").addEventListener("click", avbrytKommentar);
  $("kommentarText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sparaKommentar(); }
    if (e.key === "Escape") { e.preventDefault(); avbrytKommentar(); }
  });
  $("ditNamn").addEventListener("input", (e) => { S.namn = e.target.value; sparaLokalt(); });
  $("knappSkicka").addEventListener("click", skicka);
  $("knappKopiera").addEventListener("click", kopiera);
  $("knappDela").addEventListener("click", dela);

  // tangentbord (som i appen)
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, textarea")) return;
    const k = e.key.toLowerCase();
    const vyer = { 1: "Topp", 2: "−Y", 3: "+X", 4: "+Y", 5: "−X", 6: "Botten", 7: "Persp" };
    if (k === "v") satVerktyg("valj");
    else if (k === "m") { satVerktyg("mat"); S.matning = { a: null, b: null }; begar(); }
    else if (k === "g") satVerktyg("flytta");
    else if (k === "p") satVerktyg("peka");
    else if (k === "e") satSprang(S.t > 0 ? 0 : 1, true);
    else if (k === "r") aterstall();
    else if (k === "o") visaPanel("objektpanel");
    else if (k === "k") visaPanel("kommentarpanel");
    else if (k === "f" || k === "0") passaIn();
    else if (k === "z") zoomaTillValt();
    else if (vyer[k]) standardvy(vyer[k]);
    else if (e.key === "Escape") {
      if (!meny.hidden) meny.hidden = true;
      else if (S.ny) avbrytKommentar();
      else { S.matning = { a: null, b: null }; S.aktivKommentar = null; S.hover = null; stangInfo(); if (S.val) valj(null); else begar(); }
    } else return;
    e.preventDefault();
  });
}

/** Ett vanligt mushjul (radvis eller stora heltalssteg) zoomar; styrplattans tvåfingersvep vrider. */
function arMushjul(e) {
  if (e.deltaMode !== 0) return true;
  return e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
}
