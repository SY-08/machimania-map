// 人ベースのアバター（大きな頭・小さな体のデフォルメ）
import { toon } from "./style.js";
import { labelSprite } from "./textures.js";

const THREE = window.THREE;

export const AVATAR_OPTIONS = {
  skin: ["#ffe2cc", "#f6cfae", "#e8b48b", "#c98e64", "#8f5d3d"],
  hair: [
    { id: "short", label: "ショート" }, { id: "bob", label: "ボブ" }, { id: "long", label: "ロング" },
    { id: "spiky", label: "ツンツン" }, { id: "bun", label: "おだんご" }, { id: "hat", label: "ぼうし" },
  ],
  hairColor: ["#2b2420", "#5b3a27", "#a2663b", "#e2b45e", "#cfcac2", "#e8789a", "#5b78cc"],
  eyes: [{ id: "round", label: "まる" }, { id: "smile", label: "にっこり" }, { id: "sleepy", label: "ねむそう" }, { id: "big", label: "ぱっちり" }],
  mouth: [{ id: "smile", label: "スマイル" }, { id: "open", label: "あーん" }, { id: "cat", label: "ねこ口" }],
  shirt: ["#ff8a65", "#ffd166", "#7bd389", "#5fb6e8", "#8c7ae6", "#f78fb3", "#f6f2ea", "#3d4f6b"],
  pants: ["#3d4f6b", "#6b4f3d", "#2f2f35", "#7c8a99", "#c9a46a", "#4f7a5d"],
};

export function randomAvatar() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return {
    skin: pick(AVATAR_OPTIONS.skin), hair: pick(AVATAR_OPTIONS.hair).id, hairColor: pick(AVATAR_OPTIONS.hairColor),
    eyes: pick(AVATAR_OPTIONS.eyes).id, mouth: pick(AVATAR_OPTIONS.mouth).id,
    shirt: pick(AVATAR_OPTIONS.shirt), pants: pick(AVATAR_OPTIONS.pants), height: 1, glasses: Math.random() < 0.2,
  };
}

// 受け取った見た目データを安全な値にそろえる（他人のデータもここを通す）
export function sanitizeAvatar(a) {
  const o = AVATAR_OPTIONS;
  const color = (v, list) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : list[0]);
  const id = (v, list) => (list.some((x) => x.id === v) ? v : list[0].id);
  a = a || {};
  return {
    skin: color(a.skin, o.skin), hair: id(a.hair, o.hair), hairColor: color(a.hairColor, o.hairColor),
    eyes: id(a.eyes, o.eyes), mouth: id(a.mouth, o.mouth), shirt: color(a.shirt, o.shirt), pants: color(a.pants, o.pants),
    height: Math.max(0.85, Math.min(1.15, Number(a.height) || 1)), glasses: !!a.glasses,
  };
}

// まちマニア横塚さん専用のすがた（★の公式アカウントだけに使われ、参加者は選べない）
// 見た目を本人に寄せるときは、ここの値を変える
export const OWNER_LOOK = {
  skin: "#f3c9a5", hair: "short", hairColor: "#2b2420", eyes: "smile", mouth: "smile",
  shirt: "#f2b632", pants: "#3d4f6b", height: 1.04, glasses: true,
};

const HEAD_R = 0.62;

// 公式アカウントだけが持つ、首から下げたカメラ（お店を撮りに行く人の目印）
function ownerCamera() {
  const g = new THREE.Group();
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 20, Math.PI * 1.3), toon("#3b3427"));
  strap.rotation.set(-0.35, 0, Math.PI * 1.35);
  strap.position.set(0, 1.18, 0.1);
  const cam = new THREE.Group();
  const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.14), toon("#2f2f35"));
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 14), toon("#4a4a52"));
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.12;
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.055, 14), new THREE.MeshBasicMaterial({ color: "#7fb4d8" }));
  glass.position.z = 0.185;
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff3b30" }));
  red.position.set(0.12, 0.08, 0.07);
  cam.add(bodyM, lens, glass, red);
  cam.position.set(0, 0.86, 0.38);
  g.add(strap, cam);
  return g;
}

function arc(r, tube, angle) {
  return new THREE.TorusGeometry(r, tube, 6, 14, angle);
}

function buildHead(cfg) {
  const head = new THREE.Group();
  const skin = toon(cfg.skin);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 24, 18), skin);
  ball.scale.set(1, 0.95, 0.96);
  ball.castShadow = true;
  head.add(ball);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skin);
    ear.position.set(s * HEAD_R * 0.98, -0.04, 0);
    ear.scale.set(0.6, 1, 0.8);
    head.add(ear);
  }
  const black = toon("#2a2522");
  const fz = HEAD_R * 0.9;
  // 目
  for (const s of [-1, 1]) {
    const ex = s * 0.21, ey = 0.04;
    if (cfg.eyes === "smile") {
      const e = new THREE.Mesh(arc(0.075, 0.02, Math.PI), black);
      e.position.set(ex, ey - 0.02, fz + 0.02);
      head.add(e);
    } else if (cfg.eyes === "sleepy") {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.03), black);
      e.position.set(ex, ey, fz + 0.03);
      e.rotation.z = s * -0.12;
      head.add(e);
    } else {
      const big = cfg.eyes === "big";
      const e = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), black);
      e.scale.set(big ? 0.085 : 0.065, big ? 0.12 : 0.09, 0.04);
      e.position.set(ex, ey, fz);
      head.add(e);
      const hi = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.03 : 0.022, 8, 6), toon("#ffffff"));
      hi.position.set(ex + 0.025, ey + 0.035, fz + 0.035);
      head.add(hi);
    }
    // まゆ
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.02), toon(cfg.hairColor));
    brow.position.set(ex, 0.19, HEAD_R * 0.86);
    brow.rotation.z = s * 0.08;
    head.add(brow);
    // ほっぺ
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.07, 14), new THREE.MeshBasicMaterial({ color: "#ff9fa8", transparent: true, opacity: 0.55 }));
    cheek.position.set(s * 0.36, -0.1, HEAD_R * 0.78);
    cheek.rotation.y = s * 0.55;
    head.add(cheek);
  }
  // 口
  if (cfg.mouth === "open") {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), toon("#9c3d3d"));
    m.scale.set(0.07, 0.055, 0.03);
    m.position.set(0, -0.2, fz - 0.01);
    head.add(m);
  } else if (cfg.mouth === "cat") {
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(arc(0.045, 0.014, Math.PI), black);
      m.position.set(s * 0.045, -0.18, fz - 0.01);
      m.rotation.z = Math.PI;
      head.add(m);
    }
  } else {
    const m = new THREE.Mesh(arc(0.08, 0.017, Math.PI), black);
    m.position.set(0, -0.15, fz - 0.005);
    m.rotation.z = Math.PI;
    head.add(m);
  }
  if (cfg.glasses) {
    const gm = toon("#3b3b44");
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 18), gm);
      ring.position.set(s * 0.21, 0.04, fz + 0.06);
      head.add(ring);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), gm);
    bridge.position.set(0, 0.07, fz + 0.07);
    head.add(bridge);
  }
  // 髪
  const hm = toon(cfg.hairColor);
  const R = HEAD_R * 1.05;
  const cap = (thetaLen) => new THREE.Mesh(new THREE.SphereGeometry(R, 22, 14, 0, Math.PI * 2, 0, thetaLen), hm);
  const shell = (thetaLen, open, r = R) => {
    const g = new THREE.SphereGeometry(r, 22, 14, Math.PI / 2 + open / 2, Math.PI * 2 - open, 0, thetaLen);
    const m = new THREE.Mesh(g, hm);
    m.material.side = THREE.DoubleSide;
    return m;
  };
  if (cfg.hair === "hat") {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(R * 1.02, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), toon(cfg.shirt));
    hat.position.y = 0.04;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 20, 1, false, -Math.PI / 2, Math.PI), toon(cfg.shirt));
    brim.position.set(0, 0.28, HEAD_R * 0.62);
    brim.rotation.x = 0.15;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.93, R * 0.93, 0.08, 22, 1, true), toon("#fffaf0"));
    band.position.y = 0.27;
    head.add(hat, brim, band);
    const back = shell(Math.PI * 0.58, Math.PI * 1.1);
    head.add(back);
  } else {
    const top = cap(Math.PI * 0.36);
    top.position.y = 0.05;
    top.rotation.x = -0.18;
    head.add(top);
    // 前髪
    const fringe = new THREE.Mesh(new THREE.SphereGeometry(R * 0.98, 20, 8, Math.PI * 0.15, Math.PI * 0.7, Math.PI * 0.18, Math.PI * 0.16), hm);
    fringe.rotation.y = Math.PI;
    fringe.position.set(0, 0.02, 0.02);
    fringe.material.side = THREE.DoubleSide;
    head.add(fringe);
    const back = shell(Math.PI * (cfg.hair === "short" || cfg.hair === "spiky" ? 0.55 : 0.68), Math.PI * 0.95);
    head.add(back);
    if (cfg.hair === "long") {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.25), hm);
      tail.position.set(0, -0.55, -0.42);
      tail.rotation.x = 0.12;
      head.add(tail);
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.32), hm);
        side.position.set(s * 0.6, -0.42, -0.02);
        head.add(side);
      }
    }
    if (cfg.hair === "bob") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, 0.12, 8, 20, Math.PI * 1.1), hm);
      ring.rotation.set(Math.PI / 2, 0, -Math.PI * 0.05 + Math.PI);
      ring.position.y = -0.28;
      ring.rotation.z = Math.PI * 0.45 + Math.PI;
      head.add(ring);
    }
    if (cfg.hair === "spiky") {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.36, 6), hm);
        c.position.set(Math.cos(a) * 0.32, R * 0.86, Math.sin(a) * 0.32 - 0.05);
        c.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
        head.add(c);
      }
    }
    if (cfg.hair === "bun") {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), hm);
      bun.position.set(0, R * 0.95, -0.2);
      head.add(bun);
    }
  }
  return head;
}

export class Avatar {
  constructor(cfg, name = "", opts = {}) {
    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.phase = 0;
    this.emoteT = 0;
    this.showName = opts.showName !== false;
    this.official = !!opts.official;
    this.navi = opts.navi === false ? null : new Navi(this.official);
    this.setConfig(cfg, name);
  }

  setConfig(cfg, name = this.name) {
    this.cfg = sanitizeAvatar(cfg);
    this.ownCfg = this.cfg;
    // 公式アカウントは、えらんだ見た目にかかわらず専用のすがたになる
    if (this.official) this.cfg = sanitizeAvatar(OWNER_LOOK);
    this.name = name;
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    const c = this.cfg;
    const body = new THREE.Group();
    const shirt = toon(c.shirt), pants = toon(c.pants), skin = toon(c.skin);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.7, 14), shirt);
    torso.position.y = 0.95;
    torso.castShadow = true;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.14, 8), skin);
    neck.position.y = 1.35;
    body.add(torso, neck);
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.16, 0.62, 0);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, 0.48, 8), pants);
      leg.position.y = -0.24;
      leg.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), toon("#4a3a33"));
      shoe.scale.set(1, 0.6, 1.35);
      shoe.position.set(0, -0.52, 0.05);
      hip.add(leg, shoe);
      body.add(hip);
      this.legs.push(hip);
    }
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.38, 1.2, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.5, 8), shirt);
      arm.position.y = -0.24;
      arm.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skin);
      hand.position.y = -0.52;
      sh.add(arm, hand);
      sh.rotation.z = s * 0.12;
      body.add(sh);
      this.arms.push(sh);
    }
    this.head = buildHead(c);
    this.head.position.y = 1.4 + HEAD_R * 0.92;
    body.add(this.head);
    if (this.official) body.add(ownerCamera());
    body.scale.setScalar(c.height);
    this.body = body;
    this.root.add(body);
    // 足元の影（丸）
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.16, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.02;
    this.root.add(sh);
    if (this.tag) { this.group.remove(this.tag); this.tag.material.map.dispose(); }
    this.tag = null;
    if (this.star) { this.group.remove(this.star); this.star = null; }
    if (this.official) {
      this.star = makeStar();
      this.star.position.y = 3.55 * c.height;
      this.group.add(this.star);
    }
    if (this.showName && name) {
      this.tag = this.official
        ? labelSprite("★ " + name, { size: 0.66, bg: "rgba(255,226,120,0.96)", border: "#b88a00", sub: "公式・本人" })
        : labelSprite(name, { size: 0.6, bg: "rgba(255,255,255,0.88)", border: "rgba(59,52,39,0.35)" });
      this.tag.position.y = 2.95 * c.height;
      this.group.add(this.tag);
    }
  }

  emote() { this.emoteT = 0.9; if (this.navi) this.navi.cheer(); }

  setOfficial(on) {
    if (this.official === !!on) return;
    this.official = !!on;
    if (this.navi) this.navi.setGold(this.official);
    this.setConfig(this.ownCfg || this.cfg, this.name);
  }

  // 場面に出す・しまう（ナビもいっしょに）
  addTo(scene) { scene.add(this.group); if (this.navi) { scene.add(this.navi.group); this.navi.snap(this.group); } }
  removeFrom(scene) { scene.remove(this.group); if (this.navi) scene.remove(this.navi.group); }

  update(dt, speed) {
    if (this.navi) this.navi.update(dt, this.group, this.group.visible);
    if (this.star) this.star.rotation.y += dt * 2;
    const moving = speed > 0.2;
    this.phase += dt * (moving ? 9 + speed * 0.6 : 2.2);
    const swing = moving ? Math.min(0.75, 0.25 + speed * 0.07) : 0;
    const s = Math.sin(this.phase);
    this.legs[0].rotation.x = s * swing;
    this.legs[1].rotation.x = -s * swing;
    this.arms[0].rotation.x = -s * swing * 0.9;
    this.arms[1].rotation.x = s * swing * 0.9;
    let y = moving ? Math.abs(Math.cos(this.phase)) * 0.08 : Math.sin(this.phase) * 0.015;
    this.head.rotation.z = moving ? 0 : Math.sin(this.phase * 0.5) * 0.04;
    if (this.emoteT > 0) {
      this.emoteT -= dt;
      const k = Math.max(0, this.emoteT) / 0.9;
      y += Math.sin(k * Math.PI) * 0.5;
      this.arms[1].rotation.x = 0;
      this.arms[1].rotation.z = Math.PI * 0.85 + Math.sin(this.phase * 3) * 0.25;
    } else {
      this.arms[1].rotation.z = 0.12;
    }
    this.body.position.y = y;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    if (this.navi) this.navi.dispose();
  }
}


// ---------------------------------------------------------------- ナビ（いつも一緒にいる小さな光。顔はなく、光だけ）
function glowTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, outer);
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = { normal: null, gold: null };

export class Navi {
  constructor(gold = false) {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: "#fffbe0" }));
    this.body.add(this.core);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.set(1.5, 1.5, 1);
    this.body.add(this.halo);
    // きらきらの粒
    this.sparks = [];
    const sparkMat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(sparkMat);
      sp.scale.setScalar(0.18);
      sp.userData = { life: Math.random(), x: 0, y: 0, z: 0 };
      this.group.add(sp);
      this.sparks.push(sp);
    }
    this.sparkMat = sparkMat;
    this.t = Math.random() * 10;
    this.cheerT = 0;
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.setGold(gold);
  }

  setGold(gold) {
    const key = gold ? "gold" : "normal";
    if (!GLOW[key]) GLOW[key] = gold ? glowTexture("rgba(255,250,210,1)", "rgba(255,196,60,0.55)") : glowTexture("rgba(255,255,230,1)", "rgba(170,240,150,0.5)");
    this.halo.material.map = GLOW[key];
    this.halo.material.needsUpdate = true;
    this.sparkMat.map = GLOW[key];
    this.sparkMat.needsUpdate = true;
    this.core.material.color.set(gold ? "#fff1b8" : "#fffbe0");
  }

  cheer() { this.cheerT = 1.2; }

  snap(target) {
    this.group.position.set(target.position.x + 0.9, 2.4, target.position.z);
  }

  update(dt, target, visible = true) {
    this.t += dt;
    this.group.visible = visible;
    if (!visible) return;
    const ry = target.rotation.y;
    // 肩の少しうしろ・ななめ上をふわふわついていく
    const ox = Math.cos(ry) * 0.85 * this.side - Math.sin(ry) * 0.45;
    const oz = -Math.sin(ry) * 0.85 * this.side - Math.cos(ry) * 0.45;
    const bob = Math.sin(this.t * 2.6) * 0.18;
    let tx = target.position.x + ox, tz = target.position.z + oz, ty = target.position.y + 2.35 + bob;
    if (this.cheerT > 0) {
      this.cheerT -= dt;
      const a = this.t * 7;
      tx = target.position.x + Math.cos(a) * 0.9;
      tz = target.position.z + Math.sin(a) * 0.9;
      ty += 0.4;
    }
    const k = 1 - Math.exp(-5 * dt);
    const p = this.group.position;
    if (Math.hypot(tx - p.x, tz - p.z) > 30) p.set(tx, ty, tz);
    p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.z += (tz - p.z) * k;
    this.body.rotation.y = Math.atan2(target.position.x - p.x, target.position.z - p.z) * 0.3 + ry * 0.7;
    const pulse = 1 + Math.sin(this.t * 4) * 0.08;
    this.halo.scale.set(1.5 * pulse, 1.5 * pulse, 1);
    for (const sp of this.sparks) {
      const u = sp.userData;
      u.life += dt * 0.9;
      if (u.life > 1) { u.life = 0; u.x = (Math.random() - 0.5) * 0.3; u.z = (Math.random() - 0.5) * 0.3; u.y = 0; }
      sp.position.set(u.x, -u.life * 0.7 + Math.sin(u.life * 6) * 0.05, u.z);
      sp.material.opacity = 1 - u.life;
      sp.scale.setScalar(0.18 * (1 - u.life * 0.6));
    }
  }

  dispose() { this.group.traverse((o) => o.geometry && o.geometry.dispose()); }
}

function makeStar() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.16 : 0.36, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    i ? shape.lineTo(x, y) : shape.moveTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
  g.center();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: "#ffc93c" }));
}
