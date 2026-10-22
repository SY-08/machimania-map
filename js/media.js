// 写真を小さくする（位置情報などのメタデータは描き直しで消える）
export async function compressImage(file, maxSide = 1280, quality = 0.82) {
  if (!file || !/^image\//.test(file.type)) throw new Error("写真のファイルを選んでください");
  if (file.size > 25 * 1024 * 1024) throw new Error("写真が大きすぎます（25MBまで）");
  const bmp = await loadBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let blob = await new Promise((r) => c.toBlob(r, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
  return { blob, width: w, height: h, type: blob.type, ext: blob.type === "image/webp" ? "webp" : "jpg" };
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* 下の方法へ */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

export function isVideoLink(u) {
  return /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vt\.tiktok\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|vimeo\.com|nicovideo\.jp|nico\.ms)\//i.test(String(u || "").trim());
}

// ---------------------------------------------------------------- SNS の投稿リンク
// 写真や動画は各SNSに置いたまま、公式の埋め込み表示で見せる（こちらでは保存しない）
export function parseSns(url) {
  const u = String(url || "").trim();
  let m;
  if ((m = u.match(/^https:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]+)/i))) {
    const type = m[1].toLowerCase() === "p" ? "p" : "reel";
    return { platform: "instagram", label: "Instagram", emoji: "📸", url: u, embed: `https://www.instagram.com/${type}/${m[2]}/embed/captioned/`, tall: true };
  }
  if ((m = u.match(/^https:\/\/(?:www\.|m\.)?tiktok\.com\/@[\w.-]+\/(?:video|photo)\/(\d+)/i))) {
    return { platform: "tiktok", label: "TikTok", emoji: "🎵", url: u, embed: `https://www.tiktok.com/embed/v2/${m[1]}`, tall: true };
  }
  if (/^https:\/\/(?:vt|vm)\.tiktok\.com\/[\w]+/i.test(u)) {
    return { platform: "tiktok", label: "TikTok", emoji: "🎵", url: u, embed: null };
  }
  if ((m = u.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i))) {
    return { platform: "youtube", label: "YouTube", emoji: "▶", url: u, embed: `https://www.youtube-nocookie.com/embed/${m[1]}`, thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  }
  if ((m = u.match(/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w+\/status\/(\d+)/i))) {
    return { platform: "x", label: "X", emoji: "𝕏", url: u, embed: `https://platform.twitter.com/embed/Tweet.html?id=${m[1]}&lang=ja`, tall: true };
  }
  if (/^https:\/\/(?:www\.|m\.)?(?:facebook\.com|fb\.watch)\//i.test(u)) {
    const isVideo = /\/videos?\/|\/watch|fb\.watch|\/reel\//i.test(u);
    return { platform: "facebook", label: "Facebook", emoji: "📘", url: u, embed: `https://www.facebook.com/plugins/${isVideo ? "video" : "post"}.php?href=${encodeURIComponent(u)}&show_text=true&width=500`, tall: true };
  }
  if ((m = u.match(/^https:\/\/(?:www\.)?threads\.(?:net|com)\/@[\w.]+\/post\/([\w-]+)/i))) {
    return { platform: "threads", label: "Threads", emoji: "🧵", url: u, embed: null };
  }
  return null;
}
