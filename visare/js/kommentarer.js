// Besökarens kommentarer: svarslänk (c=), brev till brevlådan och lagring i webbläsaren. Ren logik utan DOM.
import { b64urlAvkoda, b64urlKoda, gunzip, gzip, kryptera } from "./paket.js";

export const MAX_BREV = 64 * 1024;

function slump(n = 8) { return b64urlKoda(crypto.getRandomValues(new Uint8Array(n))); }

export function nyKommentar({ text, punkt, del = null, kropp = null, tid = null }) {
  return {
    id: slump(),
    tid: tid || new Date().toISOString(),
    text: String(text || "").trim(),
    punkt: punkt.map((x) => Math.round(x * 1000) / 1000),
    del,
    kropp,
  };
}

/** Städar en kommentar från en länk/lagring: fel form ger null. */
export function tvatta(k) {
  if (!k || typeof k !== "object") return null;
  const p = Array.isArray(k.punkt) && k.punkt.length === 3 && k.punkt.every((x) => typeof x === "number" && isFinite(x)) ? k.punkt : null;
  if (!p || typeof k.text !== "string") return null;
  return {
    id: typeof k.id === "string" ? k.id.slice(0, 64) : slump(),
    tid: typeof k.tid === "string" ? k.tid.slice(0, 40) : "",
    text: k.text.slice(0, 5000),
    punkt: p,
    del: typeof k.del === "string" ? k.del.slice(0, 200) : null,
    kropp: Number.isInteger(k.kropp) ? k.kropp : null,
    ...(typeof k.skickad === "string" ? { skickad: k.skickad } : {}),
  };
}

/** Det som skickas: {"fran": "Namn", "kommentarer": [{id, tid, text, punkt, del, kropp}]}. */
export function brevData(fran, kommentarer) {
  return {
    fran: String(fran || "").trim() || null,
    kommentarer: kommentarer.map(({ id, tid, text, punkt, del, kropp }) => ({ id, tid, text, punkt, del, kropp })),
  };
}

export async function kodaSvar(data) {
  return b64urlKoda(await gzip(new TextEncoder().encode(JSON.stringify(data))));
}

export async function avkodaSvar(c) {
  const json = JSON.parse(new TextDecoder().decode(await gunzip(b64urlAvkoda(c))));
  const kommentarer = (Array.isArray(json?.kommentarer) ? json.kommentarer : []).map(tvatta).filter(Boolean);
  return { fran: typeof json?.fran === "string" ? json.fran.slice(0, 200) : null, kommentarer };
}

/** Svarslänk: samma sida, samma delning, med kommentarerna i c=. bas = sidans adress utan fragment. */
export async function svarslank(bas, id, nyckelText, data) {
  return `${bas}#d=${id}&k=${nyckelText}&c=${await kodaSvar(data)}`;
}

/** Brevet till brevlådan: SKD1(gzip(JSON)) med delningens nyckel. */
export async function brevBlob(data, nyckel) {
  return kryptera(await gzip(new TextEncoder().encode(JSON.stringify(data))), nyckel);
}

/** POST:ar brevet. Kastar Error vid nätverksfel eller svar som inte är 2xx. */
export async function skickaBrev(url, blob, hamta = globalThis.fetch) {
  if (blob.length > MAX_BREV) throw new Error("för stort");
  const u = new URL(url);
  if (u.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("brevlådan måste ha https");
  const svar = await hamta(u.href, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": "application/octet-stream" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    mode: "cors",
  });
  if (!svar.ok) throw new Error(`brevlådan svarade ${svar.status}`);
  return svar.status;
}

// ---------- lagring per delning ----------

export function lagringsNyckel(id) { return "skanna-visare:" + id; }

export function lasLagrat(id, lagring = globalThis.localStorage) {
  try {
    const d = JSON.parse(lagring.getItem(lagringsNyckel(id)) || "null");
    return {
      namn: typeof d?.namn === "string" ? d.namn : "",
      kommentarer: (Array.isArray(d?.kommentarer) ? d.kommentarer : []).map(tvatta).filter(Boolean),
    };
  } catch {
    return { namn: "", kommentarer: [] };
  }
}

export function sparaLagrat(id, data, lagring = globalThis.localStorage) {
  try { lagring.setItem(lagringsNyckel(id), JSON.stringify(data)); return true; } catch { return false; }
}
