// Delningspaketet: länkens fragment, hämtning, SKD1-kryptering (AES-256-CBC + HMAC-SHA-256) och gzip.
// Ren logik utan DOM – körs både i webbläsaren och i node (test/test.mjs).
//
// Fil d/<id>.skd:  "SKD1" | iv (16) | chiffertext (AES-256-CBC, PKCS#7) | mac (32)
//   k_enc = SHA-256(nyckel ‖ "skanna-enc"),  k_mac = SHA-256(nyckel ‖ "skanna-mac")
//   mac   = HMAC-SHA-256(k_mac, "SKD1" ‖ iv ‖ chiffertext) – kontrolleras före avkryptering.

const MAGI = new TextEncoder().encode("SKD1");

/** Fel som visaren visar för besökaren. kod: ingen-nyckel | ogiltig-lank | fel-nyckel | borttagen | natverk |
 *  trasig | gammal-webblasare | osaker-sida */
export class VisarFel extends Error {
  constructor(kod, text) {
    super(text || FELTEXT[kod] || kod);
    this.kod = kod;
  }
}

export const FELTEXT = {
  "ingen-nyckel": "Länken saknar nyckel. Kopiera hela länken – också delen efter # – och försök igen.",
  "ogiltig-lank": "Länken är ofullständig eller trasig. Be om en ny länk.",
  "fel-nyckel": "Nyckeln i länken passar inte modellen. Kontrollera att hela länken kom med, eller be om en ny länk.",
  "borttagen": "Delningen finns inte längre. Ägaren har slutat dela modellen.",
  "natverk": "Kunde inte hämta modellen. Kontrollera nätverket och försök igen.",
  "trasig": "Modellfilen är skadad eller i ett format som visaren inte känner igen.",
  "gammal-webblasare": "Webbläsaren är för gammal för visaren. Öppna länken i en aktuell Safari, Chrome, Firefox eller Edge.",
  "osaker-sida": "Visaren måste öppnas via https (eller lokalt), annars kan modellen inte låsas upp.",
};

// ---------- base64url ----------

export function b64urlKoda(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlAvkoda(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("ogiltig base64url");
  const b = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const ut = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) ut[i] = b.charCodeAt(i);
  return ut;
}

// ---------- länken ----------

/** Läser "#d=<id>&k=<nyckel>&c=<kommentarer>" (med eller utan inledande #). */
export function lasFragment(hash) {
  const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  return { d: p.get("d") || null, k: p.get("k") || null, c: p.get("c") || null };
}

/** Kontrollerar länkens delar och ger {id, nyckel: Uint8Array(32)}; kastar VisarFel med en förklaring. */
export function tolkaLank(frag) {
  if (!frag.d) throw new VisarFel("ogiltig-lank", "Länken pekar inte på någon modell. Kopiera hela länken och försök igen.");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(frag.d)) throw new VisarFel("ogiltig-lank");
  if (!frag.k) throw new VisarFel("ingen-nyckel");
  let nyckel;
  try { nyckel = b64urlAvkoda(frag.k); } catch { throw new VisarFel("fel-nyckel"); }
  if (nyckel.length !== 32) throw new VisarFel("fel-nyckel");
  return { id: frag.d, nyckel };
}

/** Saknade förutsättningar i den här miljön (tom lista = allt finns). */
export function saknas(g = globalThis) {
  const ut = [];
  if (!g.crypto || !g.crypto.subtle) ut.push("WebCrypto");
  if (typeof g.DecompressionStream !== "function") ut.push("DecompressionStream");
  if (typeof g.TextDecoder !== "function") ut.push("TextDecoder");
  return ut;
}

// ---------- krypto ----------

function kat(...delar) {
  const n = delar.reduce((s, d) => s + d.length, 0);
  const ut = new Uint8Array(n);
  let o = 0;
  for (const d of delar) { ut.set(d, o); o += d.length; }
  return ut;
}

async function harled(nyckel) {
  const s = crypto.subtle;
  const enc = new Uint8Array(await s.digest("SHA-256", kat(nyckel, new TextEncoder().encode("skanna-enc"))));
  const mac = new Uint8Array(await s.digest("SHA-256", kat(nyckel, new TextEncoder().encode("skanna-mac"))));
  return {
    enc: await s.importKey("raw", enc, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]),
    mac: await s.importKey("raw", mac, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
  };
}

/** SKD1-blob → klartext. Kastar VisarFel("trasig") för fel format och VisarFel("fel-nyckel") om mac inte stämmer. */
export async function dekryptera(blob, nyckel) {
  blob = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  if (blob.length < 4 + 16 + 16 + 32 || (blob.length - 4 - 16 - 32) % 16 !== 0) throw new VisarFel("trasig");
  for (let i = 0; i < 4; i++) if (blob[i] !== MAGI[i]) throw new VisarFel("trasig");
  const k = await harled(nyckel);
  const data = blob.subarray(0, blob.length - 32);
  const mac = blob.subarray(blob.length - 32);
  const ok = await crypto.subtle.verify("HMAC", k.mac, mac, data);
  if (!ok) throw new VisarFel("fel-nyckel");
  const iv = blob.subarray(4, 20);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, k.enc, blob.subarray(20, blob.length - 32)));
  } catch {
    throw new VisarFel("trasig");
  }
}

/** Klartext → SKD1-blob (för brev till brevlådan). iv kan anges för test. */
export async function kryptera(data, nyckel, iv = null) {
  iv = iv || crypto.getRandomValues(new Uint8Array(16));
  const k = await harled(nyckel);
  const chiffer = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k.enc, data));
  const kropp = kat(MAGI, iv, chiffer);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k.mac, kropp));
  return kat(kropp, mac);
}

// ---------- gzip ----------

async function strom(bytes, transform) {
  const s = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function gunzip(bytes) { return strom(bytes, new DecompressionStream("gzip")); }

export async function gzip(bytes) {
  if (typeof CompressionStream !== "function") throw new VisarFel("gammal-webblasare");
  return strom(bytes, new CompressionStream("gzip"));
}

// ---------- paketet ----------

/** Krypterat paket → JSON-objektet (version 1). */
export async function oppnaPaket(blob, nyckel) {
  const klar = await dekryptera(blob, nyckel);
  let paket;
  try {
    paket = JSON.parse(new TextDecoder().decode(await gunzip(klar)));
  } catch {
    throw new VisarFel("trasig");
  }
  if (!paket || typeof paket !== "object" || !Array.isArray(paket.delar)) throw new VisarFel("trasig");
  if (paket.version !== 1) {
    throw new VisarFel("trasig", "Modellen är sparad i en nyare version än den här visaren kan läsa. Ladda om sidan.");
  }
  return paket;
}

/** Hämtar d/<id>.skd relativt visaren. Fragmentet följer aldrig med (fetch skickar det inte, och ingen referrer). */
export async function hamtaPaket(id, { bas = "../d/", hamta = globalThis.fetch } = {}) {
  let svar;
  try {
    svar = await hamta(bas + encodeURIComponent(id) + ".skd", { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-cache" });
  } catch {
    throw new VisarFel("natverk");
  }
  if (svar.status === 404 || svar.status === 410) throw new VisarFel("borttagen");
  if (!svar.ok) throw new VisarFel("natverk", `Kunde inte hämta modellen (fel ${svar.status} från servern). Försök igen senare.`);
  return new Uint8Array(await svar.arrayBuffer());
}
