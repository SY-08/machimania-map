// 町の部品（橋・駅・電車・お店など）
import { seeded } from "./geo.js";
import { signTexture } from "./textures.js";
import { toon, gradientMap } from "./style.js";

const THREE = window.THREE;

export function roadBridge(x, z, dir, roadW, riverW) {
  const g = new THREE.Group();
  const len = riverW + 3;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(roadW + 0.4, 0.35, len), toon("#d9d2c4"));
  deck.position.y = 0.22;
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, len), toon("#e5604c"));
    rail.position.set(sx * (roadW / 2 + 0.1), 0.85, 0);
    g.add(rail);
    for (let k = -1; k <= 1; k++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), toon("#e5604c"));
      post.position.set(sx * (roadW / 2 + 0.1), 0.6, (k * len) / 2.4);
      g.add(post);
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = dir;
  return g;
}

export function railBridge(x, z, dir, riverW) {
  const g = new THREE.Group();
  const len = riverW + 2.6;
  for (const sx of [-1, 1]) {
    const girder = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, len), toon("#6f7d8c"));
    girder.position.set(sx * 0.75, 0.32, 0);
    girder.castShadow = true;
    g.add(girder);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, len), toon("#8c8f94"));
  deck.position.y = 0.08;
  g.add(deck);
  g.position.set(x, 0, z);
  g.rotation.y = dir;
  return g;
}

export function levelCrossing(x, z, dir, roadW) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), toon("#3a3a3a"));
    pole.position.set(s * (roadW / 2 + 0.3), 0.7, s * 1.3);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.05), toon("#f2c230"));
    sign.position.set(s * (roadW / 2 + 0.3), 1.3, s * 1.3);
    sign.rotation.z = Math.PI / 4;
    const sign2 = sign.clone(); sign2.rotation.z = -Math.PI / 4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(roadW * 0.5, 0.07, 0.07), toon("#f2c230"));
    arm.position.set(s * (roadW / 4 + 0.05), 1.0, s * 1.3);
    g.add(pole, sign, sign2, arm);
  }
  g.position.set(x, 0, z);
  g.rotation.y = dir;
  return g;
}

export function stationPlatforms(x, z, dir, color) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const plat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 8), toon("#ebe4d6"));
    plat.position.set(s * 1.55, 0.25, 0);
    plat.castShadow = plat.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 8), toon("#f2c230"));
    edge.position.set(s * 0.95, 0.51, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 5.4), toon("#efeae0"));
    roof.position.set(s * 1.6, 2.15, 0);
    roof.castShadow = true;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 5.4), toon(color));
    band.position.set(s * 2.46, 2.12, 0);
    g.add(plat, edge, roof, band);
    for (const k of [-2, 0, 2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.65, 6), toon("#f6f3ec"));
      post.position.set(s * 1.85, 1.33, k);
      g.add(post);
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = dir;
  return g;
}

export function trainCar(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.05, 2.3), toon("#f7f6f1"));
  body.position.y = 0.72;
  body.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.17, 0.18, 2.32), toon(color));
  band.position.y = 0.5;
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.3, 1.9), toon("#4c5d70"));
  win.position.y = 0.92;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 2.2), toon("#d9dadc"));
  top.position.y = 1.3;
  g.add(body, band, win, top);
  return g;
}

export function shopBuilding(shop, look) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 4.6), toon("#e9e1d2"));
  base.position.y = 0.11;
  base.receiveShadow = true;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.7, 3.4), toon(look.wall));
  walls.position.y = 1.57;
  walls.castShadow = walls.receiveShadow = true;
  // 切妻屋根
  const roofShape = new THREE.Shape([new THREE.Vector2(-2.55, 0), new THREE.Vector2(2.55, 0), new THREE.Vector2(0, 1.5)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 3.9, bevelEnabled: false }), toon(look.roof));
  roof.position.set(0, 2.9, -1.95);
  roof.castShadow = true;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.6, 0.1), toon("#7a5338"));
  door.position.set(-0.9, 1.02, 1.72);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), toon("#f2c230"));
  knob.position.set(-0.6, 1.0, 1.78);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.1), toon("#bfe3f0"));
  win.position.set(0.85, 1.35, 1.72);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.15, 0.06), toon("#ffffff"));
  frame.position.set(0.85, 1.35, 1.69);
  // しま模様のひさし
  const aw = document.createElement("canvas");
  aw.width = 128; aw.height = 32;
  const ag = aw.getContext("2d");
  for (let i = 0; i < 8; i++) { ag.fillStyle = look.awning[i % 2]; ag.fillRect(i * 16, 0, 16, 32); }
  const awTex = new THREE.CanvasTexture(aw);
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.0), new THREE.MeshToonMaterial({ map: awTex, gradientMap, side: THREE.DoubleSide }));
  awning.position.set(0, 2.3, 2.05);
  awning.rotation.x = -Math.PI / 3.2;
  awning.castShadow = true;
  // 看板
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: signTexture(shop.name, look.sign, look.signText) }));
  sign.position.set(0, 3.45, 1.98);
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(3.75, 1.02, 0.1), toon("#fffaf0"));
  signBack.position.set(0, 3.45, 1.92);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.9, 0.45), toon("#c9b8a4"));
  chimney.position.set(1.3, 3.9, -0.6);
  g.add(base, walls, roof, door, knob, frame, win, awning, signBack, sign, chimney);
  return g;
}

// お店のまわりに緑が育つ
export function growth(shop, x, z, rot) {
  const g = new THREE.Group();
  const rnd = seeded(shop.id || shop.name);
  const grassC = document.createElement("canvas");
  grassC.width = grassC.height = 128;
  const gg = grassC.getContext("2d");
  const grd = gg.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, "rgba(163,205,112,1)");
  grd.addColorStop(0.7, "rgba(163,205,112,0.85)");
  grd.addColorStop(1, "rgba(163,205,112,0)");
  gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
  const gt = new THREE.CanvasTexture(grassC);
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(10, 32), new THREE.MeshLambertMaterial({ map: gt, transparent: true, depthWrite: false }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(x, 0.015, z);
  lawn.receiveShadow = true;
  g.add(lawn);
  const greens = ["#6fae5b", "#83bd62", "#5c9d57", "#9cc86a"];
  const flowerCols = ["#ff9ab3", "#ffd45c", "#ffffff", "#b49cff", "#ff8a5c"];
  const place = (minR, maxR) => {
    for (let k = 0; k < 20; k++) {
      const a = rnd() * Math.PI * 2, r = minR + rnd() * (maxR - minR);
      const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
      if (lz > 1.5 && Math.abs(lx) < 3) continue; // 入口の前はあける
      const wx = x + lx * Math.cos(rot) + lz * Math.sin(rot), wz = z - lx * Math.sin(rot) + lz * Math.cos(rot);
      return [wx, wz];
    }
    return [x + maxR, z];
  };
  const nTrees = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < nTrees; i++) {
    const [tx, tz] = place(3.8, 8.5);
    const tree = new THREE.Group();
    const h = 1.0 + rnd() * 0.8;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, h, 6), toon("#8a6142"));
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    tree.add(trunk);
    const col = greens[Math.floor(rnd() * greens.length)];
    const blobs = 2 + Math.floor(rnd() * 2);
    for (let b = 0; b < blobs; b++) {
      const r = 0.8 + rnd() * 0.5;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), toon(col));
      leaf.position.set((rnd() - 0.5) * 0.7, h + 0.4 + b * 0.55, (rnd() - 0.5) * 0.7);
      leaf.castShadow = true;
      tree.add(leaf);
    }
    tree.position.set(tx, 0, tz);
    tree.scale.setScalar(0.9 + rnd() * 0.4);
    g.add(tree);
  }
  const flowers = 22;
  const fm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshToonMaterial({ gradientMap }), flowers);
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < flowers; i++) {
    const [fx, fz] = place(2.8, 7.5);
    o.position.set(fx, 0.18, fz); o.updateMatrix();
    fm.setMatrixAt(i, o.matrix);
    fm.setColorAt(i, col.set(flowerCols[Math.floor(rnd() * flowerCols.length)]));
  }
  g.add(fm);
  // ベンチと街灯
  const [bx, bz] = place(4.5, 6);
  const bench = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.45), toon("#a8754d"));
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.08), toon("#a8754d"));
  back.position.set(0, 0.7, -0.2);
  for (const s of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), toon("#4b4b4b"));
    leg.position.set(s, 0.22, 0);
    bench.add(leg);
  }
  bench.add(seat, back);
  bench.position.set(bx, 0, bz);
  bench.lookAt(x, 0, z);
  g.add(bench);
  const [lx, lz] = place(3.2, 4.2);
  const lamp = new THREE.Group();
  const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 6), toon("#3f4a52"));
  lp.position.y = 1.2;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: "#fff1b8" }));
  bulb.position.y = 2.5;
  lamp.add(lp, bulb);
  lamp.position.set(lx, 0, lz);
  g.add(lamp);
  return g;
}
