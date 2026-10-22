// 幾何ユーティリティ（ゲーム座標: x=東, z=南）

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

// polys: [[outer, hole...], ...]
export function pointInPolys(x, z, polys) {
  for (const poly of polys) {
    if (pointInRing(x, z, poly[0]) && !poly.slice(1).some((h) => pointInRing(x, z, h))) return true;
  }
  return false;
}

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  let t = L === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / L;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qz = az + t * dz;
  return { d: Math.hypot(px - qx, pz - qz), t, x: qx, z: qz };
}

// 線分交差 (p1-p2) x (p3-p4) → {t, u, x, z} | null
export function segIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: p1[0] + t * (p2[0] - p1[0]), z: p1[1] + t * (p2[1] - p1[1]) };
}

// 折れ線をポリゴン内外で分割する（境界との交点を挿入）
export function clipPolyline(pts, polys) {
  const edges = [];
  for (const poly of polys) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  }
  const inside = [], outside = [];
  let cur = [pts[0]];
  let curIn = pointInPolys(pts[0][0], pts[0][1], polys);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const hits = [];
    for (const [e1, e2] of edges) {
      if (Math.max(a[0], b[0]) < Math.min(e1[0], e2[0]) || Math.min(a[0], b[0]) > Math.max(e1[0], e2[0])) continue;
      if (Math.max(a[1], b[1]) < Math.min(e1[1], e2[1]) || Math.min(a[1], b[1]) > Math.max(e1[1], e2[1])) continue;
      const h = segIntersect(a, b, e1, e2);
      if (h) hits.push(h);
    }
    hits.sort((p, q) => p.t - q.t);
    for (const h of hits) {
      cur.push([h.x, h.z]);
      (curIn ? inside : outside).push(cur);
      cur = [[h.x, h.z]];
      curIn = !curIn;
    }
    cur.push(b);
  }
  (curIn ? inside : outside).push(cur);
  const ok = (l) => l.length >= 2 && polylineLength(l) > 0.05;
  return { inside: inside.filter(ok), outside: outside.filter(ok) };
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// 折れ線上の距離 s の位置と向き
export function sampleAt(pts, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1e-6;
  const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dir: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}

export function cumulative(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return c;
}

// 細かく分割した折れ線（曲線を滑らかに見せる・枕木配置用）
export function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

// 帯状メッシュの頂点を貯める（同じ材質のものをまとめて1つのメッシュにする）
export class RibbonBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.n = 0; }

  // pts: [[x,z]...], width, y, offset: 中心線からの横ずれ, uScale: 長さ方向のUV倍率
  add(pts, width, y = 0, offset = 0, uScale = 1) {
    if (pts.length < 2) return;
    const hw = width / 2;
    let along = 0;
    const base = this.n;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let tx = next[0] - prev[0], tz = next[1] - prev[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      // 角の内側がつぶれないよう、隣接2辺の法線の平均で押し出す（マイター上限つき）
      let nx = -tz, nz = tx, scale = 1;
      if (i > 0 && i < pts.length - 1) {
        const ax = p[0] - prev[0], az = p[1] - prev[1], al = Math.hypot(ax, az) || 1;
        const n1x = -az / al, n1z = ax / al;
        const dot = n1x * nx + n1z * nz;
        scale = Math.min(2.2, 1 / Math.max(0.3, dot));
      }
      if (i > 0) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const cx = p[0] + nx * offset, cz = p[1] + nz * offset;
      this.pos.push(cx + nx * hw * scale, y, cz + nz * hw * scale, cx - nx * hw * scale, y, cz - nz * hw * scale);
      this.uv.push(along * uScale, 0, along * uScale, 1);
      if (i > 0) {
        const a = base + (i - 1) * 2;
        this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    this.n += pts.length * 2;
  }

  build(THREE) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    const normals = new Float32Array(this.pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// 決まった種から同じ乱数列を出す（お店の周りの木などを毎回同じ配置にする）
export function seeded(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (let i = 0; i < String(seedStr).length; i++) {
    h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export class Projector {
  constructor(origin, metersPerUnit) {
    this.lat0 = origin.lat; this.lng0 = origin.lng; this.mpu = metersPerUnit;
    this.kx = Math.cos((this.lat0 * Math.PI) / 180) * 111320;
    this.kz = 110540;
  }
  xz(lat, lng) { return [((lng - this.lng0) * this.kx) / this.mpu, ((this.lat0 - lat) * this.kz) / this.mpu]; }
  latlng(x, z) { return [this.lat0 - (z * this.mpu) / this.kz, this.lng0 + (x * this.mpu) / this.kx]; }
}
