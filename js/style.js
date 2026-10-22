// 見た目の共通設定（色・お店の種類・季節）
const THREE = window.THREE;

// トゥーン調の陰影（3段階）
export const gradientMap = (() => {
  const d = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const matCache = new Map();
export function toon(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshToonMaterial({ color, gradientMap, ...extra }));
  return matCache.get(key);
}

// ジャンル（絵文字と壁の色）
export const GENRES = {
  ramen:   { label: "ラーメン",     emoji: "🍜", wall: "#fff1dc" },
  udon:    { label: "うどん・そば", emoji: "🥢", wall: "#f7efe0" },
  cafe:    { label: "カフェ",       emoji: "☕", wall: "#f6efe4" },
  sweets:  { label: "スイーツ",     emoji: "🍰", wall: "#fff3f5" },
  izakaya: { label: "居酒屋",       emoji: "🏮", wall: "#f3e7d4" },
  bakery:  { label: "パン",         emoji: "🥐", wall: "#fff6e6" },
  curry:   { label: "カレー",       emoji: "🍛", wall: "#fff4dd" },
  sushi:   { label: "寿司・和食",   emoji: "🍣", wall: "#f7f2e8" },
  yakiniku:{ label: "焼肉・肉料理", emoji: "🥩", wall: "#f5ebe4" },
  chinese: { label: "中華",         emoji: "🥟", wall: "#fbefe6" },
  western: { label: "洋食",         emoji: "🍝", wall: "#f9f2e7" },
  other:   { label: "お店",         emoji: "🛍️", wall: "#f5f0ff" },
};

// お店の種類（色で見分ける）
export const KINDS = {
  youtube:   { label: "まちマニア横塚", short: "横塚", color: "#f2c230", dark: "#c99a00", text: "#3b3427", note: "まちマニア横塚が行って動画にしたお店" },
  new:       { label: "新店", short: "新店", color: "#e2483d", dark: "#b8322a", text: "#ffffff", note: "オープンして1年以内のお店" },
  old:       { label: "開店1年以上", short: "1年以上", color: "#8a5cc7", dark: "#6a3fa6", text: "#ffffff", note: "オープンから1年をこえたお店" },
  community: { label: "参加者投稿", short: "投稿", color: "#3f86e0", dark: "#2a66b5", text: "#ffffff", note: "参加者がSNS投稿のリンクや口コミで登録したお店" },
};

// モード
export const MODES = {
  standard:  { label: "スタンダード", kinds: ["youtube", "new", "old", "community"], note: "すべてのお店" },
  research:  { label: "新規出店収集", kinds: ["new", "old"], note: "新店（赤）と、開店1年以上（紫）" },
  community: { label: "みんなでつくるMAP", kinds: ["youtube", "community"], note: "まちマニア横塚（黄）と、参加者投稿（青）" },
};

const DAY = 86400000;
export function shopKind(shop, now = Date.now()) {
  if (shop.kind === "community") return "community";
  if (shop.type === "youtube" || (shop.youtube && shop.type !== "new")) return "youtube";
  if (shop.type === "new") {
    const opened = Date.parse(shop.opened || shop.researched || "");
    if (Number.isFinite(opened) && now - opened > 365 * DAY) return "old";
    return "new";
  }
  return "youtube";
}

export function daysSince(dateStr, now = Date.now()) {
  const t = Date.parse(dateStr || "");
  return Number.isFinite(t) ? Math.floor((now - t) / DAY) : null;
}

export function shopLook(shop, kind) {
  const k = KINDS[kind];
  const g = GENRES[shop.genre] || GENRES.other;
  return { wall: g.wall, roof: k.color, awning: [k.color, "#fffaf0"], sign: k.dark, signText: "#ffffff", ring: k.color, emoji: g.emoji };
}

// 季節の木の色（実際の月に合わせる）
export function seasonPalette(month = new Date().getMonth() + 1) {
  if (month === 3 || month === 4) return { name: "春", leaves: ["#f6b6c8", "#f9cad7", "#8cc66a", "#f3a6bd", "#79b85c"], river: ["#f7b9cb", "#fbd3de"], flowers: ["#ff9ab3", "#ffd45c", "#ffffff", "#b49cff"] };
  if (month >= 5 && month <= 9) return { name: "夏", leaves: ["#5ea34f", "#6fb35a", "#4f9447", "#82bf5f"], river: ["#6db35a", "#5aa34f"], flowers: ["#ffd45c", "#ff8a5c", "#ffffff", "#7fb6ff"] };
  if (month === 10 || month === 11) return { name: "秋", leaves: ["#e8833a", "#d9553b", "#f0b63c", "#8db35a", "#c9672f", "#e5a13a"], river: ["#e88a3a", "#f0b63c", "#d9553b"], flowers: ["#ff9a5c", "#ffd45c", "#ffffff", "#c99cff"] };
  return { name: "冬", leaves: ["#4e7f55", "#5c8b5e", "#3f6f4a", "#9c8466"], river: ["#9c8466", "#b19a7e"], flowers: ["#ffffff", "#ff9ab3"] };
}
