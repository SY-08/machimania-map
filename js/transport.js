// 乗り物：電車・飛行機・船
import { toon } from "./style.js";
import { trainCar } from "./props.js";
import { labelSprite } from "./textures.js";
import { cumulative, sampleAt, densify } from "./geo.js";

const THREE = window.THREE;
const BUILD_R = 700;

export class Transport {
  constructor(scene, world, index, proj, data) {
    this.scene = scene;
    this.world = world;
    this.index = index;
    this.proj = proj;
    this.airports = data.airports.map((a) => ({ ...a, pos: proj.xz(a.lat, a.lng) }));
    this.ports = data.ports.map((p) => ({ ...p, pos: proj.xz(p.lat, p.lng) }));
    this.routes = data.routes.map((r) => {
      const from = this.ports.find((p) => p.id === r.from), to = this.ports.find((p) => p.id === r.to);
      const pts = [from.pos, ...r.via.map(([lat, lng]) => proj.xz(lat, lng)), to.pos];
      return { ...r, fromPort: from, toPort: to, pts };
    });
    this.built = new Map();
  }

  // 近くの空港・港を組み立てる
  update(px, pz) {
    for (const a of this.airports) this._keep(a, "air", px, pz);
    for (const p of this.ports) this._keep(p, "port", px, pz);
  }

  _keep(item, kind, px, pz) {
    const key = kind + item.id;
    const d = Math.hypot(item.pos[0] - px, item.pos[1] - pz);
    if (d < BUILD_R && !this.built.has(key)) {
      if (!this.world.isReady(item.pos[0], item.pos[1])) return;
      const obj = kind === "air" ? this._airport(item) : this._port(item);
      this.scene.add(obj.group);
      this.world.extraWalk.push(...obj.walk);
      this.built.set(key, obj);
    } else if (d > BUILD_R + 300 && this.built.has(key)) {
      const obj = this.built.get(key);
      this.scene.remove(obj.group);
      obj.group.traverse((o) => o.geometry && o.geometry.dispose());
      this.world.extraWalk = this.world.extraWalk.filter((w) => !obj.walk.includes(w));
      this.built.delete(key);
    }
  }

  _airport(a) {
    const g = new THREE.Group();
    const dir = ((a.dir || 0) * Math.PI) / 180;
    const fx = Math.sin(dir), fz = -Math.cos(dir);   // 滑走路の向き（北が0度）
    const rx = Math.cos(dir), rz = Math.sin(dir);    // 右
    const runway = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 70), toon("#6d7277"));
    runway.position.set(a.pos[0], 0.06, a.pos[1]);
    runway.rotation.y = Math.atan2(fx, fz);
    runway.receiveShadow = true;
    g.add(runway);
    for (let i = -30; i <= 30; i += 6) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 3), toon("#ffffff"));
      line.position.set(a.pos[0] + fx * i, 0.13, a.pos[1] + fz * i);
      line.rotation.y = runway.rotation.y;
      g.add(line);
    }
    const tx = a.pos[0] + rx * 12, tz = a.pos[1] + rz * 12;
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 5), toon("#eef2f4"));
    terminal.position.set(tx, 1.5, tz);
    terminal.rotation.y = runway.rotation.y + Math.PI / 2;
    terminal.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.4, 6), toon("#7fb4d8"));
    roof.position.set(tx, 3.2, tz);
    roof.rotation.y = terminal.rotation.y;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 0.1), toon("#bfe3f0"));
    glass.position.set(tx - rx * 2.55, 1.6, tz - rz * 2.55);
    glass.rotation.y = terminal.rotation.y;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 7, 10), toon("#e8e3d8"));
    tower.position.set(tx + fx * 9, 3.5, tz + fz * 9);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.0, 1.4, 10), toon("#5d8fb3"));
    cab.position.set(tx + fx * 9, 7.6, tz + fz * 9);
    g.add(terminal, roof, glass, tower, cab);
    const plane = airplane();
    plane.position.set(a.pos[0] + rx * 5, 0.4, a.pos[1] + rz * 5 - 0);
    plane.rotation.y = runway.rotation.y + Math.PI / 2;
    plane.scale.setScalar(0.8);
    g.add(plane);
    const label = labelSprite("✈ " + a.name, { size: 1.4 });
    label.position.set(tx, 6.5, tz);
    g.add(label);
    const front = [tx + rx * 4.5, tz + rz * 4.5];
    a.front = front;
    return { group: g, walk: [{ x: a.pos[0], z: a.pos[1], r: 36 }, { x: tx, z: tz, r: 12 }] };
  }

  _port(p) {
    const g = new THREE.Group();
    // 海の方向をさがす
    let best = 0, bestScore = -1;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      let sea = 0;
      for (const r of [6, 10, 14, 18]) if (!this.world.isLand(p.pos[0] + Math.sin(a) * r, p.pos[1] + Math.cos(a) * r)) sea++;
      if (sea > bestScore) { bestScore = sea; best = a; }
    }
    const sx = Math.sin(best), sz = Math.cos(best);
    p.seaDir = best;
    const pierLen = 14;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, pierLen), toon("#cdbfa6"));
    pier.position.set(p.pos[0] + sx * pierLen / 2, 0.05, p.pos[1] + sz * pierLen / 2);
    pier.rotation.y = best;
    pier.receiveShadow = true;
    g.add(pier);
    for (let i = 2; i < pierLen; i += 4) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 6), toon("#7a5a3d"));
        post.position.set(p.pos[0] + sx * i + Math.cos(best) * 1.4 * side, 0.4, p.pos[1] + sz * i - Math.sin(best) * 1.4 * side);
        g.add(post);
      }
    }
    const term = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 4), toon("#f4efe6"));
    term.position.set(p.pos[0] - sx * 4, 1.3, p.pos[1] - sz * 4);
    term.rotation.y = best;
    term.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.3, 4.6), toon("#3f86a8"));
    roof.position.set(term.position.x, 2.75, term.position.z);
    roof.rotation.y = best;
    g.add(term, roof);
    const ship = ferry();
    ship.position.set(p.pos[0] + sx * (pierLen - 3) + Math.cos(best) * 4, -0.4, p.pos[1] + sz * (pierLen - 3) - Math.sin(best) * 4);
    ship.rotation.y = best;
    g.add(ship);
    const label = labelSprite("⛴ " + p.name, { size: 1.3 });
    label.position.set(term.position.x, 5.2, term.position.z);
    g.add(label);
    p.front = [p.pos[0] + sx * 2, p.pos[1] + sz * 2];
    return { group: g, walk: [{ x: p.pos[0], z: p.pos[1], r: 7 }, { x: p.pos[0] + sx * 7, z: p.pos[1] + sz * 7, r: 3 }, { x: p.pos[0] + sx * 12, z: p.pos[1] + sz * 12, r: 3 }] };
  }

  // 近くに乗り場があるか
  nearby(x, z) {
    for (const a of this.airports) {
      const f = a.front || a.pos;
      if (Math.hypot(f[0] - x, f[1] - z) < 16) return { kind: "air", item: a };
    }
    for (const p of this.ports) {
      const f = p.front || p.pos;
      if (Math.hypot(f[0] - x, f[1] - z) < 12 && this.routes.some((r) => r.fromPort === p || r.toPort === p)) return { kind: "port", item: p };
    }
    let st = null, bd = 11;
    for (const s of this.world.stations) {
      const pts = [s.plaza, s.front, ...s.spots.map((sp) => [sp.x, sp.z])];
      for (const q of pts) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; st = s; } }
    }
    if (st) {
      const lines = [...new Set(st.spots.map((sp) => sp.line).filter((id) => id && this.index.lineStations[id]?.length > 1))];
      if (lines.length) return { kind: "train", item: st, lines };
    }
    return null;
  }

  // 路線の駅の並びと、いまの駅の位置
  lineInfo(lineId, station) {
    const order = this.index.lineStations[lineId] || [];
    let idx = -1, bd = Infinity;
    order.forEach((o, i) => {
      const d = Math.hypot(o[1] - station.pos[0], o[2] - station.pos[1]) + (o[0] === station.name ? 0 : 40);
      if (d < bd) { bd = d; idx = i; }
    });
    return { order, idx, info: this.index.lines[lineId] };
  }
}

// ======================================================================
// 乗っている間の動き
export class Ride {
  // opts: kind, legs: async () => 次の区間 {pts, stopName, last} を返す関数, speed, label, color
  constructor(scene, opts) {
    this.scene = scene;
    this.kind = opts.kind;
    this.label = opts.label;
    this.speed = opts.speed;
    this.nextLeg = opts.nextLeg;
    this.onStop = opts.onStop || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.group = new THREE.Group();
    if (this.kind === "train") {
      this.cars = [0, 1, 2].map(() => trainCar(opts.color || "#7bb4d8"));
      if (opts.shinkansen) this.cars.forEach((c) => c.scale.set(1, 1, 1.15));
      this.cars.forEach((c) => this.group.add(c));
    } else if (this.kind === "air") {
      this.cars = [airplane()];
      this.cars[0].scale.setScalar(1.6);
      this.group.add(this.cars[0]);
    } else {
      this.cars = [ferry()];
      this.group.add(this.cars[0]);
    }
    scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.dir = 0;
    this.leg = null;
    this.s = 0;
    this.wait = 0;
    this.state = "loading";
    this.getOffNext = false;
    this.done = false;
    this._load();
  }

  async _load() {
    this.state = "loading";
    const leg = await this.nextLeg();
    if (!leg) { this.finish(); return; }
    const pts = leg.pts.length > 1 ? densify(leg.pts, this.kind === "train" ? 1 : 4) : leg.pts;
    this.leg = { ...leg, pts, cum: cumulative(pts) };
    this.leg.total = this.leg.cum[this.leg.cum.length - 1];
    this.s = 0;
    this.state = "moving";
  }

  update(dt) {
    if (this.done || !this.leg) return;
    const L = this.leg;
    if (this.state === "moving") {
      // 区間の最初と最後はゆっくり
      const edge = Math.min(this.s, L.total - this.s);
      const k = this.kind === "air" ? 1 : Math.max(0.3, Math.min(1, edge / 8 + 0.25));
      this.s = Math.min(L.total, this.s + this.speed * k * dt);
      if (this.s >= L.total - 0.01) {
        this.state = "stopped";
        this.wait = L.last ? 0.6 : 1.0;
        this.onStop(L.stopName, L.last || this.getOffNext);
      }
    } else if (this.state === "stopped") {
      this.wait -= dt;
      if (this.wait <= 0) {
        if (L.last || this.getOffNext) { this.finish(); return; }
        this._load();
      }
    }
    const p = sampleAt(L.pts, L.cum, Math.max(0.01, Math.min(L.total - 0.01, this.s)));
    let y = 0.15;
    if (this.kind === "train" && L.elevated) y = 2.6;
    if (this.kind === "ship") y = -0.35 + Math.sin(performance.now() / 500) * 0.06;
    if (this.kind === "air") {
      const up = Math.min(this.s - 25, L.total - 30 - this.s);
      y = 0.4 + Math.max(0, Math.min(140, up * 0.55));
      this.altitude = y;
      this.cars[0].scale.setScalar(1.6 + (y / 140) * 2.4);   // 高く飛ぶほど大きく見せる
    }
    this.pos.set(p.x, y, p.z);
    this.dir = p.dir;
    this.cars.forEach((car, i) => {
      const q = sampleAt(L.pts, L.cum, Math.max(0.01, Math.min(L.total - 0.01, this.s - i * 2.45)));
      car.position.set(q.x, y, q.z);
      car.rotation.set(0, q.dir, 0);
      if (this.kind === "air") {
        const climb = this.s < L.total / 2 ? (y < 139 && y > 0.5 ? -0.25 : 0) : (y > 0.5 && y < 139 ? 0.2 : 0);
        car.rotation.x = climb;
      }
    });
  }

  progressText() {
    if (!this.leg) return "出発の準備中…";
    if (this.state === "stopped") return this.leg.last ? `${this.leg.stopName} に着きました` : `${this.leg.stopName} に停車中`;
    return this.kind === "train" ? `次は ${this.leg.stopName}` : `${this.leg.stopName} へ向かっています`;
  }

  finish() {
    if (this.done) return;
    if (!this.leg) { this.done = true; this.scene.remove(this.group); this.onEnd(null); return; }
    this.done = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.onEnd(this.leg);
  }
}

// ---------------------------------------------------------------- 乗り物の形
export function airplane() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 6, 12), toon("#f7f7f4"));
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), toon("#f7f7f4"));
  nose.position.z = 3;
  nose.scale.z = 1.4;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 1.4), toon("#dfe6ec"));
  wing.position.set(0, -0.1, 0.2);
  wing.castShadow = true;
  const tailW = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 0.8), toon("#dfe6ec"));
  tailW.position.set(0, 0.1, -2.7);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 1.1), toon("#3f86e0"));
  fin.position.set(0, 0.8, -2.6);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.5, 4.2, 12, 1, true), toon("#3f86e0"));
  stripe.rotation.x = Math.PI / 2;
  stripe.scale.set(1, 1, 0.15);
  stripe.position.y = -0.05;
  for (const s of [-1, 1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.1, 10), toon("#9aa3ab"));
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 1.6, -0.4, 0.5);
    g.add(eng);
  }
  g.add(body, nose, wing, tailW, fin, stripe);
  return g;
}

export function ferry() {
  const g = new THREE.Group();
  const hullShape = new THREE.Shape([new THREE.Vector2(-1.6, 0), new THREE.Vector2(1.6, 0), new THREE.Vector2(1.4, -1), new THREE.Vector2(-1.4, -1)]);
  const hull = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape, { depth: 9, bevelEnabled: false }), toon("#e9eef2"));
  hull.position.set(0, 0.9, -4.5);
  hull.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.3, 9.1), toon("#3f86e0"));
  band.position.y = 0.3;
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 4), toon("#e9eef2"));
  bow.rotation.x = Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 0.6);
  bow.position.set(0, 0.45, 5.6);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 5), toon("#ffffff"));
  cabin.position.set(0, 1.6, -0.6);
  cabin.castShadow = true;
  const windows = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.35, 4.6), toon("#5d7f99"));
  windows.position.set(0, 1.75, -0.6);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.6), toon("#ffffff"));
  bridge.position.set(0, 2.7, 0.9);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.4, 10), toon("#e2483d"));
  funnel.position.set(0, 3.0, -2.2);
  g.add(hull, band, bow, cabin, windows, bridge, funnel);
  return g;
}
