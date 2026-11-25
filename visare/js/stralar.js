// Strålkastning på CPU: en BVH per blad (kropp/del) så att träffar går fort också på mobil. Ren logik.

const BLAD_STORLEK = 6;

/** Bygger en BVH över trianglarna. pos: Float32Array (x,y,z …), idx: Uint32Array (3 per triangel). */
export function byggBVH(pos, idx) {
  const nt = idx.length / 3;
  const ordning = new Uint32Array(nt);
  const cen = new Float32Array(nt * 3);
  const tlo = new Float32Array(nt * 3), thi = new Float32Array(nt * 3);
  for (let i = 0; i < nt; i++) {
    ordning[i] = i;
    for (let a = 0; a < 3; a++) {
      const x0 = pos[idx[3 * i] * 3 + a], x1 = pos[idx[3 * i + 1] * 3 + a], x2 = pos[idx[3 * i + 2] * 3 + a];
      const lo = Math.min(x0, x1, x2), hi = Math.max(x0, x1, x2);
      tlo[3 * i + a] = lo; thi[3 * i + a] = hi; cen[3 * i + a] = (lo + hi) / 2;
    }
  }
  // noder: lo(3) hi(3) i Float32Array; [första, antal ≥ 0] för löv, [vänster barn, −höger barn] för inre noder
  const box = new Float32Array((2 * nt + 1) * 6);
  const info = new Int32Array((2 * nt + 1) * 2);
  let n = 0;
  const stack = [[0, nt, n++]];
  while (stack.length) {
    const [s, e, nod] = stack.pop();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const clo = [Infinity, Infinity, Infinity], chi = [-Infinity, -Infinity, -Infinity];
    for (let k = s; k < e; k++) {
      const i = ordning[k];
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], tlo[3 * i + a]); hi[a] = Math.max(hi[a], thi[3 * i + a]);
        clo[a] = Math.min(clo[a], cen[3 * i + a]); chi[a] = Math.max(chi[a], cen[3 * i + a]);
      }
    }
    box.set(lo, nod * 6); box.set(hi, nod * 6 + 3);
    const ant = e - s;
    let axel = 0;
    const ext = [chi[0] - clo[0], chi[1] - clo[1], chi[2] - clo[2]];
    if (ext[1] > ext[axel]) axel = 1;
    if (ext[2] > ext[axel]) axel = 2;
    if (ant <= BLAD_STORLEK || !(ext[axel] > 0)) { info[nod * 2] = s; info[nod * 2 + 1] = ant; continue; }
    // dela vid mitten av centroidernas utsträckning (fall tillbaka på medianen)
    const mitt = (clo[axel] + chi[axel]) / 2;
    let m = s;
    for (let k = s; k < e; k++) {
      if (cen[3 * ordning[k] + axel] < mitt) { const x = ordning[k]; ordning[k] = ordning[m]; ordning[m] = x; m++; }
    }
    if (m === s || m === e) m = (s + e) >> 1;
    const v = n++, h = n++;
    info[nod * 2] = v; info[nod * 2 + 1] = -h;   // inre nod: vänster barn, -höger barn
    stack.push([s, m, v], [m, e, h]);
  }
  return { box: box.subarray(0, n * 6), info: info.subarray(0, n * 2), ordning, pos, idx };
}

function lada(box, nod, o, inv, tmax) {
  let t0 = 0, t1 = tmax;
  for (let a = 0; a < 3; a++) {
    let ta = (box[nod * 6 + a] - o[a]) * inv[a], tb = (box[nod * 6 + 3 + a] - o[a]) * inv[a];
    if (ta > tb) { const x = ta; ta = tb; tb = x; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Möller–Trumbore, dubbelsidig. Ger t eller Infinity. */
export function triangelTraff(pos, i0, i1, i2, o, d) {
  const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
  const e1x = pos[i1 * 3] - ax, e1y = pos[i1 * 3 + 1] - ay, e1z = pos[i1 * 3 + 2] - az;
  const e2x = pos[i2 * 3] - ax, e2y = pos[i2 * 3 + 1] - ay, e2z = pos[i2 * 3 + 2] - az;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : Infinity;
}

/** Närmaste träff längs strålen o + t·d (d behöver inte vara normerad; t i samma skala). {t, tri} eller null. */
export function stralBVH(bvh, o, d, tmax = Infinity) {
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  const { box, info, ordning, pos, idx } = bvh;
  let bast = tmax, tri = -1;
  const stack = [0];
  while (stack.length) {
    const nod = stack.pop();
    if (lada(box, nod, o, inv, bast) === Infinity) continue;
    const a = info[nod * 2], b = info[nod * 2 + 1];
    if (b >= 0) {
      for (let k = a; k < a + b; k++) {
        const i = ordning[k];
        const t = triangelTraff(pos, idx[3 * i], idx[3 * i + 1], idx[3 * i + 2], o, d);
        if (t < bast) { bast = t; tri = i; }
      }
    } else {
      const v = a, h = -b;
      const tv = lada(box, v, o, inv, bast), th = lada(box, h, o, inv, bast);
      // närmaste barnet sist på stacken (tas först)
      if (tv < th) { if (th !== Infinity) stack.push(h); if (tv !== Infinity) stack.push(v); }
      else { if (tv !== Infinity) stack.push(v); if (th !== Infinity) stack.push(h); }
    }
  }
  return tri >= 0 ? { t: bast, tri } : null;
}

/**
 * Stråle mot alla synliga blad. forskjutning: Map(leafId → [x,y,z]); synligFn(leaf) → bool.
 * Ger {leaf, t, tri, yta, varld: [x,y,z], lokal: [x,y,z] (modellens koordinater utan förskjutning)} eller null.
 */
export function stralMotModell(blad, forskjutning, synligFn, o, d, tmax = Infinity) {
  let bast = null;
  for (const leaf of blad) {
    if (!synligFn(leaf) || !leaf.nat.idx.length) continue;
    if (!leaf.bvh) leaf.bvh = byggBVH(leaf.nat.pos, leaf.nat.idx);
    const f = forskjutning.get(leaf.id) || [0, 0, 0];
    const ol = [o[0] - f[0], o[1] - f[1], o[2] - f[2]];
    const h = stralBVH(leaf.bvh, ol, d, bast ? bast.t : tmax);
    if (h) {
      const lokal = [ol[0] + d[0] * h.t, ol[1] + d[1] * h.t, ol[2] + d[2] * h.t];
      bast = { leaf, t: h.t, tri: h.tri, yta: leaf.nat.triYta[h.tri], lokal, varld: [lokal[0] + f[0], lokal[1] + f[1], lokal[2] + f[2]] };
    }
  }
  if (bast && bast.yta < 0) bast.yta = null;
  return bast;
}
