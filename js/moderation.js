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

// ---------------------------------------------------------------- 口コミのチェック
// 方針：人やお店の尊厳を傷つける投稿（一方的な誹謗中傷・暴言・差別・根拠のない犯罪の決めつけ）は投稿できない。
//       一方で「味が薄い」「接客がそっけない」「高い」「待たされた」などの率直なマイナス評価はそのまま載せる。
// サーバー側（supabase/schema.sql の review_is_abusive）にも同じ考え方のチェックがあります。
const ABUSE_RULES = [
  { re: /(死ね|しね|氏ね|ﾀﾋね|タヒね|殺す|ころす|殺したい|消えろ|きえろ|潰れろ|つぶれろ|潰れてしまえ|潰してやる|燃やす|放火)/, why: "相手を傷つける暴言" },
  { re: /(クズ|くず|カス|ゴミ(?!箱|袋|が落ち|が置|の分別|捨て)|ごみ屋|ゴミ屋|ゴミ店|ゴミ以下|ゴミみたい)/, why: "人やお店を見下す言葉" },
  { re: /(バカ(?!高|たか|うま|旨|でか|デカ|多|安|みたいに(?:うま|旨|多))|馬鹿(?!高|うま|旨|でか|多|安)|ばか(?!り|に(?:なら|でき))|アホ|あほ(?!う)|ブス|ぶす(?!っ)|デブ|でぶ|ハゲ|はげ(?!し)|キモい|キモイ|きもい|ババア|ばばあ|ジジイ|じじい|クソ(?:店|店員|店主|店長|野郎|女|男|ババア|ジジイ|大将))/, why: "人を傷つける言葉" },
  { re: /(ガイジ|がいじ|池沼|ちしょう|支那|シナ人|チョン|土人|かたわ|めくら|つんぼ|きちがい|キチガイ|基地外)/, why: "差別的な言葉" },
  { re: /(詐欺|サギ師|犯罪者|犯罪店|違法営業|脱税|前科|逮捕され|ヤクザ|やくざ|反社|闇営業|食中毒を出|毒を盛)/, why: "根拠のない犯罪の決めつけ" },
  { re: /(店員|店主|店長|大将|女将|オーナー|スタッフ|バイト|夫婦|奥さん|旦那)[^。！!？?\n]{0,8}(人間性|人格|頭がおかし|頭おかし|頭悪|顔が|顔面|見た目が|生理的に無理|障害|病気|死んで|消えて|辞めろ|やめろ|クビにしろ)/, why: "お店の人への人格攻撃" },
  { re: /(人間性|人格|頭がおかし|頭おかし|頭が悪|性格が悪|性格悪)[^。！!？?\n]{0,8}(店員|店主|店長|大将|女将|オーナー|スタッフ|バイト|奥さん|旦那)/, why: "お店の人への人格攻撃" },
  { re: /(晒|さら)(す|します|してやる|しとく)|(住所|自宅|本名|電話番号)(を|は)(晒|さら|特定)/, why: "個人を晒す内容" },
];

/** 口コミとして載せられるか。{ ok: true } か { ok: false, why, word } を返す */
export function checkReview(input) {
  const t = String(input || "").normalize("NFKC").replace(/\s+/g, "");
  for (const r of ABUSE_RULES) {
    const m = t.match(r.re);
    if (m) return { ok: false, why: r.why, word: m[0] };
  }
  return { ok: true };
}

export const REVIEW_GUIDE = "味・量・値段・接客・待ち時間・清潔さなどの感想は、マイナスの評価でも率直に書いて大丈夫です。人やお店を傷つける言葉（暴言・見下す言葉・差別・根拠のない犯罪の決めつけ・個人を晒すこと）は投稿できません。";

// 口コミ用の整形：伏せ字はせず（判定は checkReview で行う）、リンク・メール・電話番号だけ隠す
export function cleanReview(input, maxLen = 200) {
  let t = String(input || "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim().slice(0, maxLen);
  t = t.replace(/https?:\/\/\S+|www\.\S+/gi, "（リンク）");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "（メール）");
  t = t.replace(/(?:\d[\s-]?){10,}/g, "（番号）");
  return t;
}
