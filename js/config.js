// まちマニアMAP 設定ファイル
// ---------------------------------------------------------------
// Supabase の「Project URL」と「anon public key」を貼ると、オンライン（みんなで遊べる）になります。
// 空のままだと「テストモード」で動きます（同じブラウザの別タブ同士＋テスト住人だけ）。
// anon key は公開しても大丈夫な鍵です（データの守りは schema.sql の RLS で行っています）。
export const CONFIG = {
  supabaseUrl: "",       // 例: "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "",   // 例: "eyJhbGciOi..."

  // 位置とチャットは、同じ地域（地図のタイル1枚＝約80km四方）にいる人どうしだけでやり取りします（自動）。
  // 全国の同時接続がこの人数をこえたら、新しく来た人は「入室待ち」になります（Supabase 無料プランの上限は200）
  maxOnline: 190,
  // アカウントの内部ID（メール形式）に使うドメイン。メールは送られません。Supabase で登録エラーになるときだけ変える
  accountIdDomain: "users.machimania.invalid",

  // 位置を送る回数（1秒あたり・動いているときだけ）。リアルタイム通信の無料枠（月200万メッセージ）を
  // いちばん使うのがこれです。2なら、5人が同時に歩いても約1時間で 約18万メッセージ
  stateHz: 2,

  // テストモードで「テスト住人」を歩かせるか
  localBots: true,

  // 最初に立つ駅（駅名）
  spawnStation: "町田",

  // みんなの投稿：動画ファイルのアップロードを許可するか（無料枠の容量を使うので最初は false。動画はリンクで受け付け）
  allowVideoUpload: false,
  maxVideoMB: 15,
};
