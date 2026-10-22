// チャットの安全対策（画面側）。サーバー側の制限は supabase/schema.sql にあります。

// 伏せ字にする言葉（必要に応じて追加してください）
const NG_WORDS = [
  // ひらがなの短い語（「ばかり」「かえろう」など）は普通の言葉を誤って伏せるので入れていません
  "死ね", "殺す", "ころす", "消えろ", "きえろ", "うざい", "キモい", "きもい", "ブス",
  "バカ", "アホ", "ガイジ", "がいじ", "クズ", "カス野郎",
  "ちんこ", "ちんちん", "まんこ", "セックス", "せっくす", "エロ", "おっぱい", "パパ活", "ぱぱ活",
  "fuck", "shit", "bitch",
];

export const LIMITS = {
  maxLength: 100,     // 1メッセージの最大文字数
  minIntervalMs: 1200, // 連投の間隔
  burst: 5,           // 10秒あたりの上限
  burstWindowMs: 10000,
};

export function cleanText(input, maxLen = LIMITS.maxLength) {
  let t = String(input || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  t = t.slice(0, maxLen);
  // URL・メールアドレス・電話番号らしきものは表示しない（個人情報やスパム対策）
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, "（リンク）");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "（メール）");
  t = t.replace(/(?:\d[\s-]?){10,}/g, "（番号）");
  for (const w of NG_WORDS) {
    if (!w) continue;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    t = t.replace(re, "＊".repeat([...w].length));
  }
  return t;
}

export class RateLimiter {
  constructor() { this.times = []; }
  check() {
    const now = Date.now();
    this.times = this.times.filter((t) => now - t < LIMITS.burstWindowMs);
    const last = this.times[this.times.length - 1] || 0;
    if (now - last < LIMITS.minIntervalMs) return "少し間をあけてから送ってください";
    if (this.times.length >= LIMITS.burst) return "連続で送りすぎです。10秒ほど待ってください";
    this.times.push(now);
    return null;
  }
}

// ブロックした人（この端末に保存）
const KEY = "machitsuku.blocked";
export function loadBlocked() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
export function saveBlocked(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* 保存できない環境では今回だけ有効 */ }
}

export const STAMPS = [
  { id: "hi", emoji: "👋", label: "やあ" },
  { id: "nice", emoji: "👍", label: "いいね" },
  { id: "smile", emoji: "😊", label: "にこにこ" },
  { id: "thanks", emoji: "🙇", label: "ありがとう" },
  { id: "hungry", emoji: "🍜", label: "おなかすいた" },
  { id: "camera", emoji: "📷", label: "撮影中" },
  { id: "yay", emoji: "🎉", label: "わーい" },
  { id: "q", emoji: "❓", label: "どこ？" },
];
export const stampById = (id) => STAMPS.find((s) => s.id === id);
