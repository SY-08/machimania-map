// 全国の町：まわりのタイルだけ読み込んで組み立てる
import { pointInPolys, segDist, segIntersect, cumulative, sampleAt, densify, polylineLength, RibbonBuilder, seeded } from "./geo.js";
import { groundTexture, roadTexture, waterTexture, ballastTexture, labelSprite, iconSprite, mulberry } from "./textures.js";
import { toon, shopKind, shopLook, seasonPalette, MODES } from "./style.js";
import { roadBridge, railBridge, levelCrossing, stationPlatforms, trainCar, shopBuilding, growth } from "./props.js";
import { Avatar, randomAvatar } from "./avatar.js";

const THREE = window.THREE;
const Y = { sea: -0.55, river: 0.02, road: 0.05, ballast: 0.06, rail: 0.14, highway: 1.8, shinkansen: 2.6 };
const LOAD_R = 700;     // この距離にかかるタイルを読み込む
const UNLOAD_R = 2600;  // これより遠いタイルは捨てる
const CELL = 48;        // 木や杭などの小物を置く単位
const CELL_R = 3;       // 自分のまわり何マスぶん小物を置くか
const SEASON = seasonPalette();

// ---------------------------------------------------------------- 線分の空間索引
class SegIndex {
  constructor(cell = 16) { this.cell = cell; this.g = new Map(); }
  add(a, b, tag) {
    const c = this.cell;
    const it = { a, b, tag };
    for (let gx = Math.floor(Math.min(a[0], b[0]) / c); gx <= Math.floor(Math.max(a[0], b[0]) / c); gx++)
      for (let gz = Math.floor(Math.min(a[1], b[1]) / c); gz <= Math.floor(Math.max(a[1], b[1]) / c); gz++) {
        const k = gx + "," + gz;
        if (!this.g.has(k)) this.g.set(k, []);
        this.g.get(k).push(it);
      }
  }
  addLine(pts, tag) { for (let i = 1; i < pts.length; i++) this.add(pts[i - 1], pts[i], tag); }
  near(x, z, r, fn) {
    const c = this.cell, seen = new Set();
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
        const l = this.g.get(gx + "," + gz);
        if (!l) continue;
        for (const it of l) if (!seen.has(it)) { seen.add(it); if (fn(it) === false) return; }
      }
  }
  inRect(x0, z0, x1, z1, fn) {
    const c = this.cell, seen = new Set();
    for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++)
      for (let gz = Math.floor(z0 / c); gz <= Math.floor(z1 / c); gz++) {
        const l = this.g.get(gx + "," + gz);
        if (l) for (const it of l) if (!seen.has(it)) { seen.add(it); fn(it); }
      }
  }
  dist(x, z, r, filter) {
    let best = Infinity;
    this.near(x, z, r, (it) => {
      if (filter && !filter(it.tag)) return;
      const d = segDist(x, z, it.a[0], it.a[1], it.b[0], it.b[1]).d;
      if (d < best) best = d;
    });
    return best;
  }
}

// なめらかな乱数（森の濃さなど）
function hash2(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z) => vnoise(x, z) * 0.6 + vnoise(x * 2.3 + 5, z * 2.3 + 9) * 0.3 + vnoise(x * 5.1 + 17, z * 5.1 + 3) * 0.1;

// ======================================================================
export class World {
  constructor(scene, { index, proj, base, shops = [] }) {
    this.scene = scene;
    this.index = index;
    this.proj = proj;
    this.base = base;
    this.T = index.tileSize;
    this.tileSet = new Set(index.tiles);
    this.tiles = new Map();          // key → tile
    this.loading = new Map();        // key → Promise
    this.landMeshes = [];
    this.polyMeshes = new Map();     // 同じ陸地を二重に作らない
    this.cells = new Map();
    this.stations = [];
    this.shopObjs = [];
    this.trains = [];
    this.townsfolk = [];
    this.mode = "standard";
    this.minimapRails = [];
    this.lineInfo = index.lines;
    this.animated = [];
    this._shops = shops;

    // 海
    this.waterTex = waterTexture();
    this.waterTex.repeat.set(400, 400);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: "#9fd6ea", map: this.waterTex }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = Y.sea;
    scene.add(sea);
    this.sea = sea;
    this.landMeshes.push(sea);

    // 共通の材質
    this.riverTex = waterTexture();
    const g = groundTexture();
    g.repeat.set(1 / 14, 1 / 14);
    this.mat = {
      land: new THREE.MeshLambertMaterial({ map: g }),
      cliff: new THREE.MeshLambertMaterial({ color: "#e6d29c" }),
      beach: new THREE.MeshLambertMaterial({ color: "#f2e3b5" }),
      city: new THREE.MeshLambertMaterial({ color: "#c79d62" }),
      pref: new THREE.MeshLambertMaterial({ color: "#e57a63" }),
      water: new THREE.MeshLambertMaterial({ color: "#8fd0e8", map: this.riverTex }),
      major: new THREE.MeshLambertMaterial({ map: roadTexture(true) }),
      minor: new THREE.MeshLambertMaterial({ map: roadTexture(false) }),
      highway: new THREE.MeshLambertMaterial({ map: roadTexture(true), side: THREE.DoubleSide }),
      ballast: new THREE.MeshLambertMaterial({ map: ballastTexture() }),
      steel: new THREE.MeshLambertMaterial({ color: "#8b9099" }),
      viaduct: new THREE.MeshLambertMaterial({ color: "#e4e1da", side: THREE.DoubleSide }),
      plaza: new THREE.MeshLambertMaterial({ color: "#efe6d2" }),
      subway: new THREE.MeshBasicMaterial({ color: "#b9aed6", transparent: true, opacity: 0.45, depthWrite: false }),
    };
    this.animated.push((dt) => { this.riverTex.offset.x -= dt * 0.08; });

    this._addSky();
    this._addBirds();
    this._addOverviewLand();
    this.extraWalk = [];   // 桟橋や空港など、海の上でも歩ける場所（円）
  }

  // 全国の簡単な陸地（飛行機から見下ろしたとき・遠くを見たとき用）
  _addOverviewLand() {
    const shapes = this.index.overview.land.map((r) => new THREE.Shape(r.map((p) => new THREE.Vector2(p[0], -p[1]))));
    const geo = new THREE.ShapeGeometry(shapes);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: "#d4d9a2" }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.35;
    mesh.renderOrder = -0.5;
    this.scene.add(mesh);
    this.overviewLand = mesh;
  }

  // 線路に沿った道すじ（a から b まで）。読み込んだ地図の中で見つからなければ null
  railPath(lineId, a, b) {
    const parts = [];
    for (const t of this.tiles.values()) for (const rl of t.rails) if (rl.id === lineId) parts.push(rl.pts.slice());
    if (!parts.length) return null;
    // タイルの境目で切れた線をつなぐ
    const chains = [];
    const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.8;
    const pool = parts.slice();
    while (pool.length) {
      let c = pool.pop();
      let grown = true;
      while (grown) {
        grown = false;
        for (let i = 0; i < pool.length; i++) {
          const p = pool[i];
          if (near(c[c.length - 1], p[0])) c = c.concat(p.slice(1));
          else if (near(c[c.length - 1], p[p.length - 1])) c = c.concat(p.slice(0, -1).reverse());
          else if (near(c[0], p[p.length - 1])) c = p.concat(c.slice(1));
          else if (near(c[0], p[0])) c = p.slice().reverse().concat(c.slice(1));
          else continue;
          pool.splice(i, 1);
          grown = true;
          break;
        }
      }
      chains.push(c);
    }
    const project = (pts, q) => {
      let best = { d: Infinity, s: 0, i: 0, x: 0, z: 0 };
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const r = segDist(q[0], q[1], pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (r.d < best.d) best = { d: r.d, s: acc + r.t * L, i, x: r.x, z: r.z };
        acc += L;
      }
      return best;
    };
    let bestPath = null, bestScore = Infinity;
    for (const c of chains) {
      const pa = project(c, a), pb = project(c, b);
      if (pa.d > 8 || pb.d > 8) continue;
      const score = pa.d + pb.d;
      if (score >= bestScore) continue;
      let out;
      if (pa.s <= pb.s) out = [[pa.x, pa.z], ...c.slice(pa.i, pb.i), [pb.x, pb.z]];
      else out = [[pa.x, pa.z], ...c.slice(pb.i, pa.i).reverse(), [pb.x, pb.z]];
      bestPath = out;
      bestScore = score;
    }
    return bestPath;
  }

  // ---------------------------------------------------------------- 読み込み
  tileKeyAt(x, z) { return Math.floor(x / this.T) + "_" + Math.floor(z / this.T); }

  isReady(x, z) {
    const k = this.tileKeyAt(x, z);
    return !this.tileSet.has(k) || this.tiles.has(k);
  }

  async ensureAround(x, z, r = LOAD_R) {
    const T = this.T, want = [];
    for (let tx = Math.floor((x - r) / T); tx <= Math.floor((x + r) / T); tx++)
      for (let tz = Math.floor((z - r) / T); tz <= Math.floor((z + r) / T); tz++) {
        const k = tx + "_" + tz;
        if (this.tileSet.has(k) && !this.tiles.has(k)) want.push(k);
      }
    // 自分のいるタイルを先に
    const here = this.tileKeyAt(x, z);
    want.sort((a, b) => (a === here ? -1 : b === here ? 1 : 0));
    await Promise.all(want.map((k) => this._loadTile(k)));
    for (const [k, t] of this.tiles) {
      const cx = (t.tx + 0.5) * T, cz = (t.tz + 0.5) * T;
      if (Math.max(Math.abs(cx - x), Math.abs(cz - z)) > UNLOAD_R) this._unloadTile(k);
    }
  }

  _loadTile(key) {
    if (this.loading.has(key)) return this.loading.get(key);
    const p = fetch(`${this.base}tiles/${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`地図 ${key} を読み込めませんでした`);
      return r.json();
    }).then((data) => {
      if (!this.tiles.has(key)) this._buildTile(data);
    }).finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  _unloadTile(key) {
    const t = this.tiles.get(key);
    if (!t) return;
    this.scene.remove(t.group);
    t.group.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); if (o.isSprite && o.material.map) o.material.map.dispose(); });
    for (const pk of t.polyKeys) {
      const e = this.polyMeshes.get(pk);
      if (!e) continue;
      e.refs.delete(key);
      if (!e.refs.size) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        this.landMeshes.splice(this.landMeshes.indexOf(e.mesh), 1);
        this.polyMeshes.delete(pk);
      }
    }
    this.stations = this.stations.filter((s) => s.tile !== key);
    this.trains = this.trains.filter((tr) => tr.tile !== key);
    this.minimapRails = this.minimapRails.filter((r) => r.tile !== key);
    for (const [ck, c] of this.cells) if (c.tiles.has(key)) this._dropCell(ck);
    this.tiles.delete(key);
  }

  // ---------------------------------------------------------------- タイルを組み立てる
  _buildTile(d) {
    const [tx, tz] = d.key.split("_").map(Number);
    const T = this.T;
    const group = new THREE.Group();
    const tile = {
      key: d.key, tx, tz, group, polyKeys: [], munis: [], segs: new SegIndex(16),
      rivers: [], roads: [], rails: [], borders: [],
    };
    // 陸地
    for (const m of d.munis) {
      const polys = [];
      for (const poly of m.polys) {
        const pk = m.code + ":" + poly[0].length + ":" + poly[0][0][0] + "," + poly[0][0][1];
        polys.push(poly);
        tile.polyKeys.push(pk);
        const e = this.polyMeshes.get(pk);
        if (e) { e.refs.add(d.key); continue; }
        const shape = new THREE.Shape(poly[0].map((p) => new THREE.Vector2(p[0], -p[1])));
        for (const h of poly.slice(1)) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], -p[1]))));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, [this.mat.land, this.mat.cliff]);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = -2.2;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.landMeshes.push(mesh);
        this.polyMeshes.set(pk, { mesh, refs: new Set([d.key]) });
      }
      const allPts = polys.flatMap((p) => p[0]);
      const bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of allPts) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); }
      tile.munis.push({ code: m.code, name: m.name, pref: m.pref, polys, bb });
    }
    const inLand = (x, z) => tile.munis.some((m) => x >= m.bb[0] && x <= m.bb[2] && z >= m.bb[1] && z <= m.bb[3] && pointInPolys(x, z, m.polys));
    tile.inLand = inLand;

    // 境界線（帯）と海岸の砂浜
    const ribCity = new RibbonBuilder(), ribPref = new RibbonBuilder(), ribBeach = new RibbonBuilder();
    for (const b of d.borders) {
      if (b.cls === "coast") {
        const pts = densify(b.pts, 3);
        if (pts.length < 2) continue;
        const off = insetSign(pts, inLand) * 0.9;
        ribBeach.add(pts, 1.8, 0.012, off);
        tile.borders.push({ cls: "coast", pts });
      } else {
        (b.cls === "pref" ? ribPref : ribCity).add(b.pts, b.cls === "pref" ? 0.5 : 0.35, 0.03);
        tile.borders.push({ cls: b.cls, pts: b.pts });
        tile.segs.addLine(b.pts, b.cls);
      }
    }
    group.add(new THREE.Mesh(ribBeach.build(THREE), this.mat.beach));
    group.add(new THREE.Mesh(ribCity.build(THREE), this.mat.city));
    group.add(new THREE.Mesh(ribPref.build(THREE), this.mat.pref));

    // 川
    const ribRiver = new RibbonBuilder();
    for (const r of d.rivers) {
      const pts = densify(r.pts, 2);
      const w = r.name && /川$/.test(r.name) && r.fromBorder ? 1.6 : 1.8;
      const off = r.fromBorder ? insetSign(pts, inLand) * 1.1 : 0;
      ribRiver.add(pts, w, Y.river, off, 1 / 6);
      const line = off ? offsetLine(pts, off) : pts;
      tile.rivers.push({ name: r.name, pts: line, width: w });
      tile.segs.addLine(line, "river");
    }
    const river = new THREE.Mesh(ribRiver.build(THREE), this.mat.water);
    river.receiveShadow = true;
    group.add(river);

    // 道路
    const ribMajor = new RibbonBuilder(), ribMinor = new RibbonBuilder(), ribHw = new RibbonBuilder();
    const piers = [];
    for (const r of d.roads) {
      const pts = densify(r.pts, 2.5);
      const w = r.cls === "highway" ? 3.0 : r.cls === "major" ? 2.3 : 1.7;
      const item = { name: r.name, cls: r.cls, pts, width: w };
      tile.roads.push(item);
      if (r.cls === "highway") {
        ribHw.add(pts, w, Y.highway, 0, 1 / 4);
        const cum = cumulative(pts);
        for (let s = 4; s < cum[cum.length - 1]; s += 9) piers.push(sampleAt(pts, cum, s));
      } else {
        (r.cls === "major" ? ribMajor : ribMinor).add(pts, w, Y.road, 0, 1 / 4);
        tile.segs.addLine(pts, r.cls === "major" ? "major" : "minor");
      }
    }
    for (const [rb, m] of [[ribMajor, this.mat.major], [ribMinor, this.mat.minor], [ribHw, this.mat.highway]]) {
      const mesh = new THREE.Mesh(rb.build(THREE), m);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (piers.length) group.add(instanced(new THREE.BoxGeometry(1.6, Y.highway, 0.6), toon("#d8d1c4"), piers, (o, p) => { o.position.set(p.x, Y.highway / 2, p.z); o.rotation.y = p.dir; }));

    // 鉄道
    const ribBallast = new RibbonBuilder(), ribSteel = new RibbonBuilder(), ribVia = new RibbonBuilder(), ribSub = new RibbonBuilder();
    const viaPiers = [];
    for (const r of d.rail) {
      const info = this.lineInfo[r.id] || { name: "", color: "#888", kind: "normal" };
      for (const seg of r.segs) {
        const pts = densify(seg, info.kind === "shinkansen" ? 4 : 1.2);
        if (pts.length < 2) continue;
        const item = { id: r.id, info, pts };
        tile.rails.push(item);
        this.minimapRails.push({ tile: d.key, color: info.color, pts: seg });
        if (info.kind === "subway") {
          ribSub.add(pts, 0.55, 0.025);
        } else if (info.kind === "shinkansen") {
          ribVia.add(pts, 2.0, Y.shinkansen, 0, 1 / 3);
          const cum = cumulative(pts);
          for (let s = 3; s < cum[cum.length - 1]; s += 10) viaPiers.push(sampleAt(pts, cum, s));
        } else {
          ribBallast.add(pts, 1.4, Y.ballast, 0, 1 / 3);
          ribSteel.add(pts, 0.09, Y.rail, 0.3);
          ribSteel.add(pts, 0.09, Y.rail, -0.3);
          tile.segs.addLine(pts, "rail");
        }
      }
    }
    const bm = new THREE.Mesh(ribBallast.build(THREE), this.mat.ballast);
    bm.receiveShadow = true;
    group.add(bm, new THREE.Mesh(ribSteel.build(THREE), this.mat.steel));
    group.add(new THREE.Mesh(ribSub.build(THREE), this.mat.subway));
    const via = new THREE.Mesh(ribVia.build(THREE), this.mat.viaduct);
    via.castShadow = true;
    group.add(via);
    if (viaPiers.length) group.add(instanced(new THREE.BoxGeometry(1.4, Y.shinkansen, 0.8), toon("#dcd8cf"), viaPiers, (o, p) => { o.position.set(p.x, Y.shinkansen / 2, p.z); o.rotation.y = p.dir; }));

    // 橋・踏切（空間索引で交差をさがす）
    const crossIdx = new SegIndex(24);
    for (const rv of tile.rivers) crossIdx.addLine(rv.pts, { kind: "river", w: rv.width });
    for (const rl of tile.rails) if (rl.info.kind === "normal") crossIdx.addLine(rl.pts, { kind: "rail" });
    const done = [];
    const near = (x, z) => done.some((p) => Math.hypot(p[0] - x, p[1] - z) < 4);
    const cross = (pts, fn) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        crossIdx.inRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (it) => {
          const h = segIntersect(a, b, it.a, it.b);
          if (h && !near(h.x, h.z)) { done.push([h.x, h.z]); fn(h, Math.atan2(b[0] - a[0], b[1] - a[1]), it.tag); }
        });
      }
    };
    for (const road of tile.roads) {
      if (road.cls === "highway") continue;
      cross(road.pts, (h, dir, tag) => group.add(tag.kind === "river" ? roadBridge(h.x, h.z, dir, road.width, tag.w) : levelCrossing(h.x, h.z, dir, road.width)));
    }
    for (const rl of tile.rails) {
      if (rl.info.kind !== "normal") continue;
      for (let i = 1; i < rl.pts.length; i++) {
        const a = rl.pts[i - 1], b = rl.pts[i];
        crossIdx.inRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), (it) => {
          if (it.tag.kind !== "river") return;
          const h = segIntersect(a, b, it.a, it.b);
          if (h && !near(h.x, h.z)) { done.push([h.x, h.z]); group.add(railBridge(h.x, h.z, Math.atan2(b[0] - a[0], b[1] - a[1]), it.tag.w)); }
        });
      }
    }

    // 駅
    for (const st of d.stations) this._buildStation(st, tile, group);

    // 電車（線ごとに一番長い区間）
    const byLine = new Map();
    for (const rl of tile.rails) {
      const L = polylineLength(rl.pts);
      if (!byLine.has(rl.id) || byLine.get(rl.id).L < L) byLine.set(rl.id, { rl, L });
    }
    for (const { rl, L } of byLine.values()) {
      if (L < 25 || rl.info.kind === "subway") continue;
      const cum = cumulative(rl.pts);
      const shin = rl.info.kind === "shinkansen";
      const cars = [0, 1, 2, ...(shin ? [3, 4] : [])].map(() => trainCar(shin ? "#2f6fdb" : rl.info.color));
      cars.forEach((c) => { c.visible = false; group.add(c); });
      const stops = this.stations.filter((s) => s.tile === d.key).flatMap((s) => s.spots.filter((sp) => sp.line === rl.id)).map((sp) => {
        let best = null, bd = 2;
        for (let i = 1; i < rl.pts.length; i++) {
          const q = segDist(sp.x, sp.z, rl.pts[i - 1][0], rl.pts[i - 1][1], rl.pts[i][0], rl.pts[i][1]);
          if (q.d < bd) { bd = q.d; best = cum[i - 1] + q.t * (cum[i] - cum[i - 1]); }
        }
        return best;
      }).filter((s) => s !== null);
      const rnd = mulberry(rl.id.length * 31 + Math.round(L));
      this.trains.push({ tile: d.key, path: rl.pts, cum, total: cum[cum.length - 1], stops, cars, s: rnd() * cum[cum.length - 1], dir: 1, wait: 0, last: null, y: shin ? Y.shinkansen : 0.15, speed: shin ? 22 : 6.5 });
    }

    this.scene.add(group);
    this.tiles.set(d.key, tile);
    this._placeShops();
  }

  _buildStation(st, tile, group) {
    const spots = [];
    let subwayDone = false;
    const colors = [], names = [];
    for (const id of st.lines) {
      const info = this.lineInfo[id];
      if (!info) continue;
      colors.push(info.color);
      names.push(info.name);
      let best = null;
      for (const rl of tile.rails) {
        if (rl.id !== id) continue;
        for (let i = 1; i < rl.pts.length; i++) {
          const a = rl.pts[i - 1], b = rl.pts[i];
          const q = segDist(st.pos[0], st.pos[1], a[0], a[1], b[0], b[1]);
          if (!best || q.d < best.d) best = { ...q, dir: Math.atan2(b[0] - a[0], b[1] - a[1]) };
        }
      }
      if (info.kind === "subway") {
        if (!subwayDone) { group.add(subwayEntrance(st.pos[0], st.pos[1], info.color)); subwayDone = true; }
        spots.push({ x: st.pos[0], z: st.pos[1], dir: best ? best.dir : 0, line: id });
        continue;
      }
      if (best && best.d < 14) {
        const shin = info.kind === "shinkansen";
        const p = stationPlatforms(best.x, best.z, best.dir, info.color);
        if (shin) p.position.y = Y.shinkansen - 0.1;
        group.add(p);
        spots.push({ x: best.x, z: best.z, dir: best.dir, line: id });
      }
    }
    if (!spots.length) spots.push({ x: st.pos[0], z: st.pos[1], dir: 0, line: null });
    const cx = spots.reduce((s, p) => s + p.x, 0) / spots.length;
    const cz = spots.reduce((s, p) => s + p.z, 0) / spots.length;
    // 駅前広場：線路から離れた側
    const sp0 = spots[0];
    const cand = [9.5, -9.5].map((o) => [sp0.x + Math.cos(sp0.dir) * o, sp0.z - Math.sin(sp0.dir) * o]);
    const score = ([x, z]) => (tile.inLand(x, z) ? 100 : 0) + Math.min(20, tile.segs.dist(x, z, 20, (t) => t === "rail"));
    const plaza = score(cand[0]) >= score(cand[1]) ? cand[0] : cand[1];
    const subwayOnly = st.lines.every((id) => this.lineInfo[id]?.kind === "subway");
    const label = labelSprite(st.name, { size: 1.25, dots: colors.slice(0, 4), sub: [...new Set(names)].slice(0, 3).join("・") });
    label.position.set(cx, Math.max(5.4, spots.some((s) => this.lineInfo[s.line]?.kind === "shinkansen") ? 7.4 : 5.4), cz);
    group.add(label);
    if (subwayOnly) {
      label.position.y = 4.2;
      const front = [st.pos[0], st.pos[1] + 2.5];
      this.stations.push({ tile: tile.key, name: st.name, lines: names, colors, pos: [st.pos[0], st.pos[1]], plaza: [st.pos[0], st.pos[1]], front, spots, subway: true });
      return;
    }
    group.add(stationPlaza(plaza[0], plaza[1], Math.atan2(cx - plaza[0], cz - plaza[1]), colors[0] || "#7bb4d8"));
    tile.segs.add([plaza[0] - 0.1, plaza[1]], [plaza[0] + 0.1, plaza[1]], "plaza");
    const ax = plaza[0] - cx, az = plaza[1] - cz, al = Math.hypot(ax, az) || 1;
    const front = [plaza[0] + (ax / al) * 2.6, plaza[1] + (az / al) * 2.6];
    this.stations.push({ tile: tile.key, name: st.name, lines: names, colors, pos: [cx, cz], plaza, front, spots });
  }

  // ---------------------------------------------------------------- お店
  setShops(list) { this._shops = list; this._rebuildShops(); }
  setMode(mode) { this.mode = mode; for (const o of this.shopObjs) o.group.visible = MODES[mode].kinds.includes(o.kind); }

  _rebuildShops() {
    for (const o of this.shopObjs) { this.scene.remove(o.group); o.group.traverse((x) => x.geometry && x.geometry.dispose()); }
    this.shopObjs = [];
    this._placeShops();
  }

  _placeShops() {
    const have = new Set(this.shopObjs.map((o) => o.shop.id));
    for (const shop of this._shops) {
      if (have.has(shop.id) || shop.lat == null || shop.lng == null) continue;
      const [x, z] = this.proj.xz(shop.lat, shop.lng);
      const kind = shopKind(shop);
      const look = shopLook(shop, kind);
      const g = new THREE.Group();
      const b = shopBuilding(shop, look);
      b.rotation.y = ((shop.facing || 0) * Math.PI) / 180;
      b.position.set(x, 0, z);
      g.add(b);
      const icon = iconSprite(look.emoji, look.ring);
      icon.position.set(x, 7.6, z);
      g.add(icon);
      const phase = Math.random() * 6;
      this.animated.push((dt, t) => { icon.position.y = 7.6 + Math.sin(t * 2 + phase) * 0.25; });
      g.add(growth(shop, x, z, b.rotation.y));
      g.visible = MODES[this.mode].kinds.includes(kind);
      this.scene.add(g);
      this.shopObjs.push({ shop, kind, look, x, z, group: g });
    }
  }

  get shops() { return this.shopObjs.filter((o) => o.group.visible); }

  // ---------------------------------------------------------------- 歩けるか
  tileAt(x, z) { return this.tiles.get(this.tileKeyAt(x, z)); }
  isLand(x, z) { const t = this.tileAt(x, z); return !!t && t.inLand(x, z); }
  walkable(x, z) {
    if (!this.isLand(x, z) && !this.extraWalk.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) return false;
    for (const o of this.shopObjs) if (o.group.visible && (x - o.x) ** 2 + (z - o.z) ** 2 < 2.9 * 2.9) return false;
    return true;
  }
  areaAt(x, z) {
    const t = this.tileAt(x, z);
    if (!t) return null;
    return t.munis.find((m) => x >= m.bb[0] && x <= m.bb[2] && z >= m.bb[1] && z <= m.bb[3] && pointInPolys(x, z, m.polys)) || null;
  }
  nearestStation(x, z) {
    let best = null, bd = Infinity;
    for (const s of this.index.stations) { const d = (s.p[0] - x) ** 2 + (s.p[1] - z) ** 2; if (d < bd) { bd = d; best = s; } }
    return best;
  }

  // ---------------------------------------------------------------- 小物（自分のまわりだけ）
  _updateCells(px, pz) {
    const cx0 = Math.floor(px / CELL), cz0 = Math.floor(pz / CELL);
    const want = new Set();
    for (let dx = -CELL_R; dx <= CELL_R; dx++) for (let dz = -CELL_R; dz <= CELL_R; dz++) want.add((cx0 + dx) + "," + (cz0 + dz));
    let built = 0;
    // 近い順に、1フレーム2マスまで
    const order = [...want].filter((k) => !this.cells.has(k)).sort((a, b) => {
      const [ax, az] = a.split(",").map(Number), [bx, bz] = b.split(",").map(Number);
      return (Math.abs(ax - cx0) + Math.abs(az - cz0)) - (Math.abs(bx - cx0) + Math.abs(bz - cz0));
    });
    for (const k of order) {
      const [cx, cz] = k.split(",").map(Number);
      const t = this.tileAt((cx + 0.5) * CELL, (cz + 0.5) * CELL);
      if (!t) continue;
      this._buildCell(k, cx, cz);
      if (++built >= 2) break;
    }
    for (const k of [...this.cells.keys()]) {
      const [cx, cz] = k.split(",").map(Number);
      if (Math.abs(cx - cx0) > CELL_R + 1 || Math.abs(cz - cz0) > CELL_R + 1) this._dropCell(k);
    }
  }

  _dropCell(k) {
    const c = this.cells.get(k);
    if (!c) return;
    this.scene.remove(c.group);
    c.group.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
    this.cells.delete(k);
  }

  _buildCell(key, cx, cz) {
    const x0 = cx * CELL, z0 = cz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
    const group = new THREE.Group();
    const tilesUsed = new Set();
    const tileOf = (x, z) => { const t = this.tileAt(x, z); if (t) tilesUsed.add(t.key); return t; };
    const rnd = seeded("cell" + key);
    const land = (x, z) => { const t = tileOf(x, z); return t && t.inLand(x, z); };
    const clear = (x, z, pad) => {
      const t = tileOf(x, z);
      if (!t) return false;
      let ok = true;
      t.segs.near(x, z, pad + 3, (it) => {
        const need = it.tag === "plaza" ? 9 : it.tag === "major" ? 2.4 : it.tag === "minor" ? 1.9 : it.tag === "rail" ? 1.6 : it.tag === "river" ? 1.3 : 0.6;
        if (segDist(x, z, it.a[0], it.a[1], it.b[0], it.b[1]).d < need + pad) { ok = false; return false; }
      });
      if (!ok) return false;
      for (const o of this.shopObjs) if ((x - o.x) ** 2 + (z - o.z) ** 2 < 100) return false;
      return true;
    };
    const trees = [], bushes = [], flowers = [], rocks = [], tufts = [], posts = { city: [], pref: [] }, sleepers = [], fields = [];
    // 森・草花
    const N = 70;
    for (let i = 0; i < N; i++) {
      const x = x0 + rnd() * CELL, z = z0 + rnd() * CELL;
      const n = fbm(x * 0.018, z * 0.018);
      const r = rnd();
      if (n > 0.6) { if (r < 0.75 && land(x, z) && clear(x, z, 0.8)) trees.push([x, z, rnd(), SEASON.leaves]); }
      else if (n > 0.5) { if (r < 0.35 && land(x, z) && clear(x, z, 0.5)) (r < 0.15 ? trees : bushes).push([x, z, rnd(), SEASON.leaves]); }
      else if (n < 0.28) { if (r < 0.5 && land(x, z) && clear(x, z, 0.3)) flowers.push([x, z, rnd()]); }
      else if (r < 0.12 && land(x, z) && clear(x, z, 0.3)) (r < 0.05 ? rocks : tufts).push([x, z, rnd()]);
    }
    // 畑（森から少し離れた平らなところ）
    if (rnd() < 0.35) {
      const fx = x0 + 8 + rnd() * (CELL - 16), fz = z0 + 8 + rnd() * (CELL - 16);
      const n = fbm(fx * 0.018, fz * 0.018);
      if (n > 0.32 && n < 0.48 && land(fx, fz) && clear(fx, fz, 5)) fields.push([fx, fz, rnd()]);
    }
    // 川沿い・大きな道沿いの並木、線路の枕木、境界の杭
    const t0 = this.tileAt(x0 + CELL / 2, z0 + CELL / 2);
    for (const t of new Set([t0, this.tileAt(x0, z0), this.tileAt(x1 - 0.01, z1 - 0.01)].filter(Boolean))) {
      tilesUsed.add(t.key);
      t.segs.inRect(x0, z0, x1, z1, (it) => {
        const a = it.a, b = it.b;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.01) return;
        const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        const inCell = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
        if (it.tag === "river" || it.tag === "major") {
          const step = it.tag === "river" ? 5 : 9, off = it.tag === "river" ? 2.2 : 2.6;
          for (let s = (hash2(a[0], a[1]) * step); s < L; s += step) {
            for (const side of [-1, 1]) {
              const x = a[0] + ux * s - uz * off * side, z = a[1] + uz * s + ux * off * side;
              if (inCell(x, z) && land(x, z) && clear(x, z, 0.4)) trees.push([x, z, hash2(x, z), it.tag === "river" ? SEASON.river : SEASON.leaves, 0.85]);
            }
          }
        } else if (it.tag === "rail") {
          for (let s = 0.3; s < L; s += 0.6) {
            const x = a[0] + ux * s, z = a[1] + uz * s;
            if (inCell(x, z)) sleepers.push([x, z, Math.atan2(ux, uz)]);
          }
        } else if (it.tag === "city" || it.tag === "pref") {
          const step = it.tag === "pref" ? 4 : 5;
          for (let s = 0; s < L; s += step) {
            const x = a[0] + ux * s, z = a[1] + uz * s;
            if (inCell(x, z)) posts[it.tag].push([x, z]);
          }
        }
      });
    }
    // メッシュにまとめる
    const o3 = new THREE.Object3D();
    const col = new THREE.Color();
    if (trees.length) {
      const trunk = new THREE.InstancedMesh(GEO.trunk, toon("#8a6142"), trees.length);
      const leaf = new THREE.InstancedMesh(GEO.leaf, toon("#ffffff"), trees.length * 2);
      trees.forEach(([x, z, r, pal, sc = 1], i) => {
        const s = (0.85 + r * 0.6) * sc;
        o3.position.set(x, 0.55 * s, z); o3.rotation.set(0, r * 6, 0); o3.scale.set(s, s, s); o3.updateMatrix(); trunk.setMatrixAt(i, o3.matrix);
        const c = pal[Math.floor(r * 997) % pal.length];
        o3.position.set(x, 1.55 * s, z); o3.scale.set(s * 1.05, s * 0.95, s * 1.05); o3.updateMatrix(); leaf.setMatrixAt(i * 2, o3.matrix); leaf.setColorAt(i * 2, col.set(c));
        o3.position.set(x + (r - 0.5) * 0.5 * s, 2.25 * s, z + (0.5 - r) * 0.4 * s); o3.scale.set(s * 0.72, s * 0.7, s * 0.72); o3.updateMatrix(); leaf.setMatrixAt(i * 2 + 1, o3.matrix); leaf.setColorAt(i * 2 + 1, col.set(pal[Math.floor(r * 571) % pal.length]));
      });
      trunk.castShadow = leaf.castShadow = true;
      group.add(trunk, leaf);
    }
    if (bushes.length) {
      const m = new THREE.InstancedMesh(GEO.bush, toon("#ffffff"), bushes.length);
      bushes.forEach(([x, z, r, pal], i) => { const s = 0.7 + r * 0.6; o3.position.set(x, 0.3 * s, z); o3.rotation.set(0, r * 5, 0); o3.scale.set(s * 1.3, s, s); o3.updateMatrix(); m.setMatrixAt(i, o3.matrix); m.setColorAt(i, col.set(pal[Math.floor(r * 37) % pal.length]).multiplyScalar(0.92)); });
      m.castShadow = true;
      group.add(m);
    }
    if (flowers.length) {
      const per = 6;
      const m = new THREE.InstancedMesh(GEO.flower, toon("#ffffff"), flowers.length * per);
      const g2 = new THREE.InstancedMesh(GEO.grassBlob, toon("#9fca6b"), flowers.length);
      flowers.forEach(([x, z, r], i) => {
        o3.position.set(x, 0.03, z); o3.rotation.set(0, r * 6, 0); o3.scale.set(1.4 + r, 0.25, 1.1 + r); o3.updateMatrix(); g2.setMatrixAt(i, o3.matrix);
        for (let k = 0; k < per; k++) {
          const a = r * 40 + k * 1.7, rr = 0.25 + ((k * 0.37 + r) % 1) * 0.9;
          o3.position.set(x + Math.cos(a) * rr, 0.16, z + Math.sin(a) * rr); o3.rotation.set(0, 0, 0); o3.scale.set(1, 1, 1); o3.updateMatrix();
          m.setMatrixAt(i * per + k, o3.matrix); m.setColorAt(i * per + k, col.set(SEASON.flowers[(k + Math.floor(r * 9)) % SEASON.flowers.length]));
        }
      });
      group.add(g2, m);
    }
    if (rocks.length) group.add(instanced(GEO.rock, toon("#bfb3a0"), rocks, (o, [x, z, r]) => { o.position.set(x, 0.12, z); o.rotation.set(r * 3, r * 7, r * 5); const s = 0.6 + r * 1.2; o.scale.set(s, s * 0.7, s); }));
    if (tufts.length) group.add(instanced(GEO.tuft, toon("#a9c460"), tufts, (o, [x, z, r]) => { o.position.set(x, 0.28, z); o.rotation.set(0, r * 6, (r - 0.5) * 0.4); const s = 0.7 + r * 0.8; o.scale.set(s, s, s); }));
    for (const [fx, fz, r] of fields) group.add(farmField(fx, fz, r));
    if (sleepers.length) group.add(instanced(GEO.sleeper, toon("#8a6a4f"), sleepers, (o, [x, z, r]) => { o.position.set(x, 0.1, z); o.rotation.set(0, r, 0); o.scale.set(1, 1, 1); }, false));
    for (const cls of ["city", "pref"]) {
      const list = posts[cls];
      if (!list.length) continue;
      const h = cls === "pref" ? 1.3 : 0.8;
      group.add(instanced(cls === "pref" ? GEO.postPref : GEO.postCity, toon(cls === "pref" ? "#f4efe6" : "#a9784a"), list, (o, [x, z]) => { o.position.set(x, h / 2, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); }));
      group.add(instanced(GEO.cap, toon(cls === "pref" ? "#e2604b" : "#e8c98f"), list, (o, [x, z]) => { o.position.set(x, h, z); }, false));
    }
    this.scene.add(group);
    this.cells.set(key, { group, tiles: tilesUsed });
  }

  // ---------------------------------------------------------------- 空・鳥・まちの人
  _addSky() {
    const geo = new THREE.SphereGeometry(900, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color("#7cc4ec") }, bottom: { value: new THREE.Color("#e6f3f6") } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.1,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }",
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    const rnd = mulberry(9);
    const cloudMat = new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.92 });
    this.clouds = [];
    for (let i = 0; i < 16; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(3 + rnd() * 3, 10, 8), cloudMat);
        s.position.set(k * 4 - n * 2 + rnd() * 2, rnd() * 1.5, rnd() * 3);
        s.scale.y = 0.6;
        c.add(s);
      }
      c.userData.off = [(rnd() - 0.5) * 400, 46 + rnd() * 14, (rnd() - 0.5) * 400];
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  _addBirds() {
    this.birds = [];
    const wing = new THREE.BufferGeometry();
    wing.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.25, -0.6, 0, -0.1, 0, 0, -0.1, 0, 0, 0.25, 0.6, 0, -0.1, 0, 0, -0.1], 3));
    wing.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: "#4a4a55", side: THREE.DoubleSide });
    for (let f = 0; f < 2; f++) {
      const flock = [];
      for (let i = 0; i < 5; i++) {
        const b = new THREE.Mesh(wing.clone(), mat);
        b.scale.setScalar(1.3);
        this.scene.add(b);
        flock.push({ m: b, ph: Math.random() * 6, off: [(i % 3) * 1.6 - 1.6, Math.random() * 1.5, Math.floor(i / 3) * 1.6] });
      }
      this.birds.push({ flock, r: 30 + f * 18, h: 16 + f * 5, sp: 0.18 + f * 0.07, a: f * 2 });
    }
  }

  _updateTownsfolk(px, pz, dt) {
    // 近くの駅前に、まちの人を少しだけ歩かせる
    const near = this.stations.filter((s) => !s.subway && Math.hypot(s.plaza[0] - px, s.plaza[1] - pz) < 110).slice(0, 4);
    const wantKeys = new Set(near.map((s) => s.tile + s.name));
    for (const f of this.townsfolk) if (!wantKeys.has(f.key)) { this.scene.remove(f.av.group); f.av.dispose(); f.dead = true; }
    this.townsfolk = this.townsfolk.filter((f) => !f.dead);
    for (const s of near) {
      const key = s.tile + s.name;
      if (this.townsfolk.some((f) => f.key === key)) continue;
      const rnd = seeded(key);
      for (let i = 0; i < 2; i++) {
        const av = new Avatar(randomAvatarSeeded(rnd), "", { showName: false, navi: false });
        const x = s.plaza[0] + (rnd() - 0.5) * 6, z = s.plaza[1] + (rnd() - 0.5) * 6;
        av.group.position.set(x, 0, z);
        this.scene.add(av.group);
        this.townsfolk.push({ key, av, home: s.plaza, x, z, tx: x, tz: z, wait: rnd() * 3, ry: 0 });
      }
    }
    for (const f of this.townsfolk) {
      let speed = 0;
      if (f.wait > 0) f.wait -= dt;
      else {
        const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz);
        if (d < 0.2) {
          f.wait = 2 + Math.random() * 6;
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 16;
            const nx = f.home[0] + Math.cos(a) * r, nz = f.home[1] + Math.sin(a) * r;
            if (this.walkable(nx, nz)) { f.tx = nx; f.tz = nz; break; }
          }
        } else {
          const nx = f.x + (dx / d) * 2.2 * dt, nz = f.z + (dz / d) * 2.2 * dt;
          if (this.walkable(nx, nz)) { f.x = nx; f.z = nz; speed = 2.2; f.ry = Math.atan2(dx, dz); } else { f.tx = f.x; f.tz = f.z; }
        }
      }
      f.av.group.position.set(f.x, 0, f.z);
      f.av.group.rotation.y = f.ry;
      f.av.update(dt, speed);
    }
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt, t, px, pz) {
    this.sea.position.set(Math.round(px / 10) * 10, Y.sea, Math.round(pz / 10) * 10);
    this.waterTex.offset.y = -this.sea.position.z / 10;
    this.waterTex.offset.x = this.sea.position.x / 10 - t * 0.03;
    this.sky.position.set(px, 0, pz);
    for (const c of this.clouds) {
      c.userData.off[0] += dt * 1.2;
      if (c.userData.off[0] > 220) c.userData.off[0] = -220;
      c.position.set(px + c.userData.off[0], c.userData.off[1], pz + c.userData.off[2]);
    }
    for (const b of this.birds) {
      b.a += dt * b.sp;
      const cx = px + Math.cos(b.a) * b.r, cz = pz + Math.sin(b.a) * b.r;
      const dir = Math.atan2(-Math.sin(b.a), Math.cos(b.a));
      for (const f of b.flock) {
        f.m.position.set(cx + f.off[0], b.h + f.off[1] + Math.sin(t * 2 + f.ph) * 0.4, cz + f.off[2]);
        f.m.rotation.set(0, dir, 0);
        f.m.scale.y = 1;
        f.m.geometry.attributes.position.array[4] = f.m.geometry.attributes.position.array[13] = Math.sin(t * 9 + f.ph) * 0.35;
        f.m.geometry.attributes.position.needsUpdate = true;
      }
    }
    for (const tr of this.trains) {
      if (tr.wait > 0) tr.wait -= dt;
      else {
        const prev = tr.s;
        tr.s += tr.dir * tr.speed * dt;
        if (tr.s > tr.total - 4) { tr.s = tr.total - 4; tr.dir = -1; tr.wait = 2.5; }
        if (tr.s < 4) { tr.s = 4; tr.dir = 1; tr.wait = 2.5; }
        for (const st of tr.stops) if (st !== tr.last && (prev - st) * (tr.s - st) <= 0) { tr.s = st; tr.wait = 2.8; tr.last = st; break; }
      }
      tr.cars.forEach((car, i) => {
        const s = Math.max(0.1, Math.min(tr.total - 0.1, tr.s - tr.dir * i * 2.45));
        const p = sampleAt(tr.path, tr.cum, s);
        const vis = Math.abs(p.x - px) < 260 && Math.abs(p.z - pz) < 260;
        car.visible = vis;
        if (vis) { car.position.set(p.x, tr.y, p.z); car.rotation.y = p.dir; }
      });
    }
    this._updateCells(px, pz);
    this._updateTownsfolk(px, pz, dt);
    for (const f of this.animated) f(dt, t);
  }
}

// ======================================================================
const GEO = {
  trunk: new THREE.CylinderGeometry(0.16, 0.22, 1.1, 6),
  leaf: new THREE.SphereGeometry(1, 7, 5),
  bush: new THREE.SphereGeometry(0.6, 6, 4),
  flower: new THREE.SphereGeometry(0.11, 6, 4),
  grassBlob: new THREE.CylinderGeometry(1, 1, 0.2, 10),
  rock: new THREE.DodecahedronGeometry(0.35, 0),
  tuft: new THREE.ConeGeometry(0.22, 0.6, 5),
  sleeper: new THREE.BoxGeometry(1.05, 0.07, 0.2),
  postCity: new THREE.CylinderGeometry(0.11, 0.13, 0.8, 6),
  postPref: new THREE.CylinderGeometry(0.11, 0.13, 1.3, 6),
  cap: new THREE.SphereGeometry(0.17, 8, 6),
};
for (const g of Object.values(GEO)) g.userData = { shared: true };

function instanced(geo, mat, list, place, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const o = new THREE.Object3D();
  list.forEach((p, i) => { o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); place(o, p); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.castShadow = shadow;
  m.userData.sharedGeo = !!geo.userData?.shared;
  return m;
}

function insetSign(pts, inLand) {
  const i = Math.floor(pts.length / 2);
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
  const m = pts[i];
  return inLand(m[0] + nx * 1.5, m[1] + nz * 1.5) ? 1 : -1;
}

function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / L) * off, p[1] + ((b[0] - a[0]) / L) * off];
  });
}

function randomAvatarSeeded(rnd) {
  const save = Math.random;
  Math.random = rnd;
  const a = randomAvatar();
  Math.random = save;
  return a;
}

// 駅前広場：駅舎・ベンチ・自販機・花壇
function stationPlaza(x, z, rot, color) {
  const g = new THREE.Group();
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(4.2, 28), new THREE.MeshLambertMaterial({ color: "#efe6d2" }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.035;
  plaza.receiveShadow = true;
  g.add(plaza);
  const house = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.0, 2.2), toon("#f7f2e8"));
  body.position.y = 1.0;
  body.castShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.3, 2.7), toon("#8e9ca3"));
  roof.position.y = 2.15;
  roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.06), toon("#bfe3f0"));
  door.position.set(0, 0.7, 1.12);
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16), toon("#ffffff"));
  clock.rotation.x = Math.PI / 2;
  clock.position.set(0, 2.7, 0.9);
  const clockPost = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.3), toon(color));
  clockPost.position.set(0, 2.62, 0.75);
  house.add(body, roof, door, clockPost, clock);
  house.position.set(0, 0, -2.6);
  g.add(house);
  // 花壇
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 0.35, 16), toon("#c9b8a4"));
  bed.position.set(0, 0.18, 1.2);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.1, 16), toon("#7fbf5a"));
  soil.position.set(0, 0.38, 1.2);
  g.add(bed, soil);
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), toon(["#ff9ab3", "#ffd45c", "#ffffff"][i % 3]));
    const a = i * 0.7;
    f.position.set(Math.cos(a) * 0.6, 0.48, 1.2 + Math.sin(a) * 0.6);
    g.add(f);
  }
  // ベンチと自販機
  for (const sx of [-2.6, 2.6]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.45), toon("#a8754d"));
    seat.position.set(sx, 0.45, 0.8);
    seat.rotation.y = Math.PI / 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 1.1), toon("#4b4b4b"));
    leg.position.set(sx, 0.22, 0.8);
    leg.scale.set(0.2, 1, 1);
    g.add(seat, leg);
  }
  const vend = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.6), toon("#ecebe4"));
  vend.position.set(2.3, 0.8, -2.4);
  vend.castShadow = true;
  const vendWin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.02), toon("#dff2fb"));
  vendWin.position.set(2.3, 1.15, -2.09);
  const busPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2, 6), toon("#3f4a52"));
  busPole.position.set(-3.2, 1, 2.4);
  const busSign = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 16), toon("#3f86e0"));
  busSign.rotation.x = Math.PI / 2;
  busSign.position.set(-3.2, 2.0, 2.4);
  g.add(vend, vendWin, busPole, busSign);
  g.position.set(x, 0, z);
  g.rotation.y = rot + Math.PI;
  return g;
}

// 地下鉄の入口
function subwayEntrance(x, z, color) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 1.6), toon("#d9d2c4"));
  base.position.y = 0.08;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.9), toon("#7d8b92"));
  roof.position.y = 1.6;
  roof.castShadow = true;
  const hole = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 1.0), toon("#4a4a55"));
  hole.position.y = 0.17;
  g.add(base, roof, hole);
  for (const [sx, sz] of [[-1.05, -0.8], [1.05, -0.8], [-1.05, 0.8], [1.05, 0.8]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), toon("#3f4a52"));
    p.position.set(sx, 0.85, sz);
    g.add(p);
  }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), toon(color));
  sign.position.set(0, 1.95, 0.9);
  g.add(sign);
  g.position.set(x, 0, z);
  return g;
}

// 畑（うね）
function farmField(x, z, r) {
  const g = new THREE.Group();
  const w = 6 + r * 4, d = 5 + r * 3;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), toon("#a77b52"));
  base.position.y = 0.06;
  base.receiveShadow = true;
  g.add(base);
  const crop = SEASON.name === "冬" ? "#9c8466" : SEASON.name === "秋" ? "#e3b94a" : "#7fbf5a";
  for (let i = -d / 2 + 0.6; i < d / 2; i += 0.9) {
    const row = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.28, 0.45), toon(crop));
    row.position.set(0, 0.22, i);
    g.add(row);
  }
  const fence = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), toon("#d8c7a8"));
  for (const [fx, fz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
    const f = fence.clone();
    f.position.set(fx, 0.3, fz);
    g.add(f);
  }
  g.position.set(x, 0, z);
  g.rotation.y = r * Math.PI;
  return g;
}
