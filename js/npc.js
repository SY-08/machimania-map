// まちの案内人（どの市区町村にも、駅前に同じ人がいる）と、話しかけたときの会話
import { Avatar } from "./avatar.js";
import { labelSprite } from "./textures.js";
import { toon } from "./style.js";

const THREE = window.THREE;
export const GUIDE_NAME = "チズ";

// 案内人の見た目（参加者のアバターと同じ作りで、地図とぼうしが目印）
const LOOK = { skin: "#f6cfae", hair: "hat", hairColor: "#a2663b", eyes: "big", mouth: "smile", shirt: "#7bd389", pants: "#6b4f3d", height: 0.96, glasses: false };

function mapProp() {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.03), toon("#fff4d6"));
  const road = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.035), toon("#e2b45e"));
  road.position.set(0, 0.04, 0);
  road.rotation.z = 0.4;
  const river = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.035), toon("#5fb6e8"));
  river.position.set(-0.12, 0, 0);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), toon("#ef6b5b"));
  pin.position.set(0.14, 0.08, 0.03);
  g.add(paper, road, river, pin);
  return g;
}

// 頭の上の「！」（近づくと出る）
function bangSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  x.fillStyle = "#ffd166"; x.strokeStyle = "#3b3427"; x.lineWidth = 5;
  x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.fill(); x.stroke();
  x.fillStyle = "#3b3427"; x.font = "900 40px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText("!", 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(0.9, 0.9, 1);
  s.renderOrder = 10;
  return s;
}

export class TownGuide {
  constructor(scene) {
    this.scene = scene;
    this.av = new Avatar(LOOK, "", { showName: false, navi: false });
    this.group = this.av.group;
    this.map = mapProp();
    this.map.position.set(-0.32, 0.92, 0.32);
    this.map.rotation.set(-0.5, 0.35, 0);
    this.av.body.add(this.map);
    this.tag = labelSprite(`案内人 ${GUIDE_NAME}`, { size: 0.56, bg: "rgba(214,245,222,0.95)", border: "#3f7d4f" });
    this.tag.position.y = 2.95;
    this.group.add(this.tag);
    this.bang = bangSprite();
    this.bang.position.y = 3.65;
    this.bang.visible = false;
    this.group.add(this.bang);
    this.home = null;
    this.target = null;
    this.ry = 0;
    this.t = Math.random() * 10;
    this.talking = false;
    this.areaCode = null;
    scene.add(this.group);
    this.group.visible = false;
  }

  place(x, z, areaCode) {
    this.home = [x, z];
    this.group.position.set(x, 0, z);
    this.target = null;
    this.areaCode = areaCode;
    this.group.visible = true;
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }
  distTo(x, z) { return Math.hypot(this.x - x, this.z - z); }

  update(dt, me, walkable) {
    if (!this.home) return;
    this.t += dt;
    const d = this.distTo(me.x, me.z);
    let speed = 0;
    if (this.talking || d < 7) {
      // 近くに人がいたら立ち止まって、そちらを向く
      const want = Math.atan2(me.x - this.x, me.z - this.z);
      this.ry = lerpAngle(this.ry, want, 1 - Math.exp(-6 * dt));
      this.target = null;
    } else {
      // 駅前をゆっくり歩きまわる
      if (!this.target || Math.hypot(this.target[0] - this.x, this.target[1] - this.z) < 0.3) {
        if (!this.wait || this.wait <= 0) {
          const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3.5;
          const nx = this.home[0] + Math.cos(a) * r, nz = this.home[1] + Math.sin(a) * r;
          if (!walkable || walkable(nx, nz)) this.target = [nx, nz];
          this.wait = 2 + Math.random() * 4;
        } else this.wait -= dt;
      }
      if (this.target) {
        const dx = this.target[0] - this.x, dz = this.target[1] - this.z, L = Math.hypot(dx, dz);
        if (L > 0.05) {
          speed = 1.6;
          this.group.position.x += (dx / L) * Math.min(L, speed * dt);
          this.group.position.z += (dz / L) * Math.min(L, speed * dt);
          this.ry = lerpAngle(this.ry, Math.atan2(dx, dz), 1 - Math.exp(-6 * dt));
        }
      }
    }
    this.group.rotation.y = this.ry;
    this.bang.visible = !this.talking && d < 7;
    this.bang.position.y = 3.65 + Math.sin(this.t * 4) * 0.08;
    this.map.rotation.z = Math.sin(this.t * 1.5) * 0.06;
    this.av.update(dt, speed);
  }

  cheer() { this.av.emote(); }
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// ---------------------------------------------------------------- 会話ウィンドウ
// script: [{ text, choices?: [{label, value}] }] を順に見せる。choices のある行で選ばれた value を返す
export class Dialogue {
  constructor() {
    this.root = document.getElementById("talk");
    this.textEl = document.getElementById("talkText");
    this.nameEl = document.getElementById("talkName");
    this.nextEl = document.getElementById("talkNext");
    this.choicesEl = document.getElementById("talkChoices");
    this.open = false;
    this.root.addEventListener("click", (e) => {
      if (e.target.closest("[data-choice]")) return;
      this.advance();
    });
    this.choicesEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-choice]");
      if (b && this._choose) { e.stopPropagation(); this._choose(b.dataset.choice); }
    });
    addEventListener("keydown", (e) => {
      if (!this.open) return;
      if (this.choicesEl.childElementCount) {
        const btns = [...this.choicesEl.querySelectorAll("button")];
        const i = btns.indexOf(document.activeElement);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = (i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length; btns[n].focus(); }
        return;
      }
      if (e.key === " " || e.key === "Enter" || e.key === "z" || e.key === "Z") { e.preventDefault(); this.advance(); }
    }, true);
  }

  show(name) {
    this.open = true;
    this.nameEl.textContent = name;
    this.root.hidden = false;
    document.body.classList.add("talking");
  }

  hide() {
    this.open = false;
    clearInterval(this.timer);
    this.root.hidden = true;
    this.choicesEl.innerHTML = "";
    document.body.classList.remove("talking");
  }

  // 1ページ分を表示して、進むか選ぶまで待つ
  say(text, choices) {
    return new Promise((resolve) => {
      this.choicesEl.innerHTML = "";
      this.nextEl.hidden = true;
      this._resolve = null;
      this._choose = null;
      this.full = text;
      this.typing = true;
      let n = 0;
      clearInterval(this.timer);
      const done = () => {
        clearInterval(this.timer);
        this.typing = false;
        this.textEl.textContent = this.full;
        if (choices && choices.length) {
          this.choicesEl.innerHTML = choices.map((c) => `<button type="button" data-choice="${c.value}">${c.label}</button>`).join("");
          this._choose = (v) => { this.choicesEl.innerHTML = ""; resolve(v); };
          this.choicesEl.querySelector("button")?.focus();
        } else {
          this.nextEl.hidden = false;
          this._resolve = () => resolve(null);
        }
      };
      this._finish = done;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) { done(); return; }
      const start = performance.now();
      this.timer = setInterval(() => {
        n = Math.floor((performance.now() - start) / 32) + 1;   // 経過時間で進める（画面が重くても同じ速さ）
        this.textEl.textContent = text.slice(0, n);
        if (n >= text.length) done();
      }, 30);
    });
  }

  advance() {
    if (this.typing) { this._finish?.(); return; }
    if (this._resolve) { const r = this._resolve; this._resolve = null; r(); }
  }
}
