// キャンバスで作るテクスチャと文字ラベル
const THREE = window.THREE;

export const FONT = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

// 更地の地面：乾いた土にまばらな草
export function groundTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#dfe2ad";
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry(7);
  // 土の見えるところ
  for (let i = 0; i < 18; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = rnd() * 22 + 10;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(232,212,166,0.75)");
    grd.addColorStop(1, "rgba(232,212,166,0)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // 草のかたまり
  for (let i = 0; i < 40; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = rnd() * 16 + 6;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, "rgba(160,198,110,0.7)");
    grd.addColorStop(1, "rgba(160,198,110,0)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 1600; i++) {
    const x = rnd() * 256, y = rnd() * 256;
    g.fillStyle = rnd() < 0.6 ? "rgba(140,182,96,0.55)" : "rgba(246,238,200,0.6)";
    g.fillRect(x, y, 1.5, rnd() < 0.5 ? 3 : 1.5);
  }
  const [c2, g2] = canvas(256, 256);
  for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) g2.drawImage(c, dx, dy);
  return tex(c2);
}

// 舗装道路（中央線つき）
export function roadTexture(centerLine) {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#cdc6b8"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#e9e3d6"; g.fillRect(0, 0, 64, 5); g.fillRect(0, 59, 64, 5);
  if (centerLine) { g.fillStyle = "#fbf7ea"; g.fillRect(4, 30, 30, 4); }
  return tex(c);
}

export function waterTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "rgba(120,190,220,0.25)"; g.fillRect(0, 40, 64, 6);
  g.fillStyle = "rgba(255,255,255,0.0)";
  g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(6, 18); g.quadraticCurveTo(12, 14, 18, 18); g.stroke();
  g.beginPath(); g.moveTo(38, 46); g.quadraticCurveTo(44, 42, 50, 46); g.stroke();
  const t = tex(c);
  return t;
}

export function ballastTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#b9ad9c"; g.fillRect(0, 0, 64, 64);
  const rnd = mulberry(3);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = rnd() < 0.5 ? "#a39784" : "#cfc4b4";
    g.fillRect(rnd() * 64, rnd() * 64, 2, 2);
  }
  return tex(c);
}

// 文字の看板（スプライト）
export function labelSprite(text, opts = {}) {
  const {
    size = 1, color = "#3b3427", bg = "rgba(255,252,243,0.92)", border = "#3b3427",
    dots = [], sub = "", weight = 800,
  } = opts;
  const px = 44;
  const [c0, g0] = canvas(8, 8);
  g0.font = `${weight} ${px}px ${FONT}`;
  const tw = g0.measureText(text).width;
  g0.font = `600 ${px * 0.5}px ${FONT}`;
  const sw = sub ? g0.measureText(sub).width : 0;
  const dotW = dots.length ? dots.length * 30 + 10 : 0;
  const w = Math.ceil(Math.max(tw + dotW, sw) + 48);
  const h = sub ? 108 : 76;
  const [c, g] = canvas(w, h);
  g.fillStyle = bg;
  g.strokeStyle = border;
  g.lineWidth = 5;
  roundRect(g, 3, 3, w - 6, h - 6, 30);
  g.fill(); g.stroke();
  let x = 24;
  dots.forEach((col) => {
    g.fillStyle = col; g.beginPath(); g.arc(x + 11, 38, 11, 0, Math.PI * 2); g.fill();
    x += 30;
  });
  if (dots.length) x += 10;
  g.fillStyle = color;
  g.font = `${weight} ${px}px ${FONT}`;
  g.textBaseline = "middle";
  g.fillText(text, x, 40);
  if (sub) {
    g.font = `600 ${px * 0.5}px ${FONT}`;
    g.fillStyle = "rgba(59,52,39,0.7)";
    g.fillText(sub, 24, 84);
  }
  const t = tex(c, false);
  const m = new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(m);
  const k = size / 76;
  s.scale.set(w * k, h * k, 1);
  s.userData.aspect = w / h;
  return s;
}

// お店の上に浮かぶアイコン
export function iconSprite(emoji, ring = "#ff8a5c") {
  const [c, g] = canvas(128, 150);
  g.fillStyle = "#fffaf0";
  g.strokeStyle = ring; g.lineWidth = 8;
  g.beginPath(); g.arc(64, 62, 54, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = ring;
  g.beginPath(); g.moveTo(46, 108); g.lineTo(82, 108); g.lineTo(64, 146); g.closePath(); g.fill();
  g.font = `64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(emoji, 64, 66);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(c, false), transparent: true, depthWrite: false }));
  s.scale.set(2.2, 2.6, 1);
  return s;
}

// 看板の板（お店の名前）
export function signTexture(text, bg, fg = "#fffaf0") {
  const [c, g] = canvas(512, 128);
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = 6; g.strokeRect(10, 10, 492, 108);
  g.fillStyle = fg;
  let px = 64;
  g.font = `900 ${px}px ${FONT}`;
  while (g.measureText(text).width > 460 && px > 24) { px -= 4; g.font = `900 ${px}px ${FONT}`; }
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  return tex(c, false);
}

export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
