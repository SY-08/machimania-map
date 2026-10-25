// アカウント（ニックネーム＋パスワード）の道具
// ・メールアドレスは使わない。ニックネームから、外に出ない「内部用のID（メール形式）」を作って Supabase の認証に使う
// ・パスワードは Supabase の認証が一方向の暗号（ハッシュ）にして持つだけで、運営もパスワード自体は見られない
// ・忘れたら作り直し（パスワードの再発行はしない）

export const NICK_MAX = 12;
export const PASS_MIN = 8;

// 同じ名前とみなす形にそろえる（全角・半角、大文字・小文字、空白のちがいを無視）
export function normNick(nick) {
  return String(nick || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function checkNick(nick) {
  const n = String(nick || "").replace(/\s+/g, " ").trim();
  if (!n) return "ニックネームを入れてください";
  if ([...n].length > NICK_MAX) return `ニックネームは${NICK_MAX}文字までです`;
  if (/^(ゲスト|guest)$/i.test(n)) return "その名前は使えません";
  return null;
}

export function checkPass(pass, again) {
  if (String(pass || "").length < PASS_MIN) return `パスワードは${PASS_MIN}文字以上にしてください`;
  if (again !== undefined && pass !== again) return "確認用のパスワードが一致しません";
  return null;
}

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ニックネーム → 認証用の内部ID（メールは送られない・だれにも見えない）
export async function nickToLoginId(nick, domain = "users.machimania.invalid") {
  return `n${(await sha256hex("machimania:" + normNick(nick))).slice(0, 40)}@${domain}`;
}

// テストモード用：パスワードを端末内でハッシュにする（PBKDF2）
export async function hashPassLocal(pass, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
