/**
 * まちマニアMAP 管理用スクリプト（Google スプレッドシートに貼って使います）
 *
 * このスクリプトがすること
 *   1. 毎日のリサーチ結果（GitHub の data/research-inbox.json）を「新店」シートに取りこむ
 *   2. 開店日から1年をこえたお店の「状態」を「1年以上」に切りかえる
 *   3. 「新店」シートで「表示」にチェックがある行を、MAP 用のデータ（data/research.json）として GitHub に書き出す
 *   4. 参加者の投稿・アカウント・通報を Supabase から「投稿」「アカウント」「通報」シートに写す
 *   5. シートで「非表示」にした投稿、「利用停止」「公式★」にチェックした人を Supabase に反映する
 *
 * 最初の設定（README の手順どおりに）
 *   - 拡張機能 → Apps Script にこのファイルの中身を貼る
 *   - プロジェクトの設定 → スクリプト プロパティに次の4つを入れる
 *       GITHUB_REPO          例: SY-08/machimania-map
 *       GITHUB_TOKEN         GitHub の「Fine-grained token」（このリポジトリの Contents: Read and write）
 *       SUPABASE_URL         例: https://xxxx.supabase.co
 *       SUPABASE_SERVICE_KEY Supabase の Secret key（sb_secret_…。ぜったいに公開しない）
 *       MEMBER_SHEET_ID      参加者の情報（投稿・アカウント・通報）を置く、別の非公開スプレッドシートのID
 *   - 関数「setup」を1回実行（シートと、毎日・毎時の自動実行が作られます）
 */

const SHEETS = {
  shops: {
    name: "新店",
    headers: ["ID", "店名", "ジャンル", "都道府県", "市区町村", "住所", "緯度", "経度", "開店日", "状態", "概要", "背景", "情報源URL", "見つけた日", "表示", "メモ", "個人店の根拠"],
  },
  posts: {
    member: true,   // 会員情報のスプレッドシート（非公開）に置く
    name: "投稿",
    headers: ["投稿ID", "投稿日時", "ニックネーム", "ユーザーID", "店名", "ジャンル", "緯度", "経度", "SNSリンク", "口コミ", "状態", "メモ"],
  },
  accounts: {
    member: true,
    name: "アカウント",
    headers: ["ユーザーID", "ニックネーム", "投稿数", "登録日時", "最終ログイン", "公式★", "利用停止", "メモ"],
  },
  reports: {
    member: true,
    name: "通報",
    headers: ["通報ID", "日時", "通報した人", "対象の人", "対象の投稿", "理由"],
  },
  log: {
    name: "ログ",
    headers: ["日時", "処理", "結果"],
  },
};

const GENRES = ["ramen", "udon", "cafe", "sweets", "izakaya", "bakery", "curry", "sushi", "yakiniku", "chinese", "western", "other"];

// ===================================================================== 設定
// 参加者の情報（投稿・アカウント・通報）は、別の非公開スプレッドシート（スクリプト プロパティ MEMBER_SHEET_ID）に置く
function memberSs_() {
  const id = props_().MEMBER_SHEET_ID;
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}
function ssFor_(def) { return def.member ? memberSs_() : SpreadsheetApp.getActive(); }

function setup() {
  const ss = SpreadsheetApp.getActive();
  const ms = memberSs_();
  for (const key of Object.keys(SHEETS)) {
    const def = SHEETS[key];
    const book = ssFor_(def);
    let sh = book.getSheetByName(def.name);
    if (!sh) sh = book.insertSheet(def.name);
    const first = sh.getRange(1, 1, 1, def.headers.length);
    first.setValues([def.headers]).setFontWeight("bold").setBackground("#f4efe2");
    sh.setFrozenRows(1);
    // 会員情報を別のスプレッドシートへ移す：元のシートに残っている行を写してから、元のシートを消す
    if (def.member && ms.getId() !== ss.getId()) {
      const old = ss.getSheetByName(def.name);
      if (old) {
        if (old.getLastRow() > 1) {
          const rows = old.getRange(2, 1, old.getLastRow() - 1, def.headers.length).getValues();
          sh.getRange(sh.getLastRow() + 1, 1, rows.length, def.headers.length).setValues(rows);
        }
        ss.deleteSheet(old);
      }
    }
  }
  ss.setActiveSheet(ss.getSheetByName(SHEETS.shops.name)); ss.moveActiveSheet(1);   // 「新店」を先頭に
  for (const book of [ss, ms]) {
    const blank = book.getSheetByName("シート1") || book.getSheetByName("Sheet1");
    if (blank && blank.getLastRow() <= 1 && book.getSheets().length > 1) book.deleteSheet(blank);
  }
  // チェックボックス
  checkboxes_(SHEETS.shops, "表示");
  checkboxes_(SHEETS.accounts, "公式★");
  checkboxes_(SHEETS.accounts, "利用停止");
  // 状態のプルダウン（投稿）
  const posts = sheet_(SHEETS.posts);
  const stCol = SHEETS.posts.headers.indexOf("状態") + 1;
  posts.getRange(2, stCol, posts.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["公開", "非表示"], true).build());
  // 自動実行（毎朝7時台に新店、1時間ごとに投稿・アカウント）
  for (const t of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger("dailyShops").timeBased().everyDays(1).atHour(7).inTimezone("Asia/Tokyo").create();
  ScriptApp.newTrigger("syncSupabase").timeBased().everyHours(1).create();
  writeRules();
  log_("setup", "シートと自動実行を作りました" + (ms.getId() !== ss.getId() ? "（会員情報は別のスプレッドシート）" : ""));
  try { SpreadsheetApp.getUi().alert("準備ができました。毎朝7時台に新店、1時間ごとに投稿とアカウントが更新されます。"); } catch (e) { /* エディタから実行したとき */ }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("まちマニアMAP")
    .addItem("新店を今すぐ更新（取りこみ→MAPに反映）", "dailyShops")
    .addItem("投稿・アカウントを今すぐ同期", "syncSupabase")
    .addItem("「ルール」シートを書き直す", "writeRules")
    .addSeparator()
    .addItem("最初の設定（setup）", "setup")
    .addToUi();
}


// ===================================================================== 運用ルール（「ルール」シートに書き出す。Notion「まちマニアMAP 運用ルール」と同じ内容）
const RULES = [
  ["区分", "ルール"],
  ["1. 新店（赤・紫）", "個人オーナーの店だけを載せる（チェーン・フランチャイズを入れると数が膨大になるため）"],
  ["", "入れる：店主（オーナー）が自分で営む、その店1店舗だけ（または同じ店主の2店舗目まで）の飲食店。店主がその店のために作った小さな会社（店名と同じ社名・1店舗だけ）も含める"],
  ["", "入れない：チェーン店・フランチャイズ店（支店名つき、「全国〇店舗」「〇号店」「〇県初出店」「〇〇グループ」「FC」など）"],
  ["", "入れない：企業・会社が運営する店（上場企業・外食企業・商業施設の運営会社・メーカーや食品会社の新業態など）"],
  ["", "入れない：ショッピングモール・駅ビル・空港・フードコートのテナント出店"],
  ["", "入れない：有名店の暖簾分け・系列店・プロデュース店"],
  ["", "個人店と判断した根拠（出典の記述）を「新店」シートの「個人店の根拠」列に書く。根拠が見つからない店は入れない"],
  ["", "ほかの条件：信頼できる情報源が1つ以上／店名・住所（番地まで）・オープン日が確認できる／実店舗の飲食店（キッチンカー・期間限定・閉店済みは除く）"],
  ["", "開店日から1年たったら自動で紫（開店1年以上）に切りかえる"],
  ["", "毎朝5:43にClaudeが全国をリサーチ → 7時台に「新店」シートへ取りこみ → 翌朝MAPに反映。載せたくない店は「表示」のチェックを外す"],
  ["2. 参加者の投稿（青）", "口コミ（必須・10〜200文字）＋ SNS投稿のリンク（おすすめ・なくてもOK）"],
  ["", "SNSは Instagram・TikTok・YouTube・X・Facebook・Threads の公開投稿。写真・動画はSNSに置いたまま埋め込みで表示し、こちらでは保存しない"],
  ["", "投稿はすぐ公開（承認制なし）。1人1日10件まで"],
  ["3. 口コミのルール", "載せない：個人の尊厳・お店の尊厳を壊す投稿（一方的な誹謗中傷）"],
  ["", "例：暴言（死ね・潰れろ など）／人やお店を見下す言葉（クズ・ゴミ店 など）／差別的な言葉／根拠のない犯罪の決めつけ（詐欺・違法 など）／お店の人への人格攻撃／個人を晒すこと（住所・本名・電話番号の特定）"],
  ["", "そのまま載せる：素直な意見。味・量・値段・接客・待ち時間・清潔さなどのマイナス評価も、率直な感想として許可する（例：「麺が伸びていた」「接客がそっけない」「高い」「二度と行かない」）"],
  ["", "投稿画面とデータベースの両方で言葉をチェックし、当てはまる投稿はアップロードできない。すり抜けた投稿は「投稿」シートで状態を「非表示」にすると1時間以内に消える"],
  ["4. アカウント", "ニックネーム＋パスワードだけで参加（メールアドレスは使わない）"],
  ["", "パスワードは一方向の暗号（ハッシュ）で保存し、運営も見られない。忘れたら再発行はせず、アカウントの作り直し"],
  ["", "一度ログインすると、その端末ではログインしたまま"],
  ["", "ニックネームは重複不可（全角・半角などのちがいも同じ名前とみなす）。ログイン名なので後から変えられない"],
  ["", "登録しない人（ゲスト）は町を見て歩くだけ。チャットと投稿は登録した人だけ"],
  ["", "「まちマニア」「横塚」を含む名前は本人だけ（★公式）。最初に「まちマニア横塚」で登録した人が自動で公式になる"],
  ["", "「アカウント」シートで「利用停止」にチェックすると、その人は投稿もチャットもできなくなる"],
  ["5. 投稿数とランキング", "投稿数はアカウントごとに記録し、「アカウント」シートの「投稿数」列に1時間ごとに反映"],
  ["", "各プレイヤーの画面左上に「あなたの投稿 N件」を表示"],
  ["", "「投稿ランキング」モードで、口コミ投稿数の多い人のランキングを表示"],
];

function writeRules() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName("ルール");
  if (!sh) sh = ss.insertSheet("ルール");
  sh.clear();
  sh.getRange(1, 1, RULES.length, 2).setValues(RULES).setWrap(true).setVerticalAlignment("top");
  sh.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f4efe2");
  sh.getRange(2, 1, RULES.length - 1, 1).setFontWeight("bold");
  sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 760);
  sh.setFrozenRows(1);
}

// ===================================================================== 新店
function dailyShops() {
  const added = importResearchInbox();
  updateShopStatuses();
  // GITHUB_TOKEN があればすぐMAPに書き出す。なければ、毎朝のリサーチ（Claude）がこのシートを読んで書き出す
  if (props_().GITHUB_TOKEN) {
    const n = publishResearch();
    log_("新店", `取りこみ ${added} 件 / MAPに表示 ${n} 件`);
  } else {
    log_("新店", `取りこみ ${added} 件（MAPへの反映は翌朝のリサーチ時）`);
  }
}

/** GitHub の受け箱から新しいお店を取りこむ（同じIDや、同じ店名＋住所は取りこまない） */
function importResearchInbox() {
  const inbox = githubGetJson_("data/research-inbox.json");
  if (!inbox || !Array.isArray(inbox.items)) return 0;
  const sh = sheet_(SHEETS.shops);
  // 基準（個人オーナー店）に合わないとわかった店は、シートから消して二度と取りこまない
  const excluded = new Set((inbox.excluded || []).map(String));
  if (excluded.size) {
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    for (let i = ids.length - 1; i >= 0; i--) if (excluded.has(String(ids[i][0]))) sh.deleteRow(i + 2);
  }
  const rows = readRows_(sh, SHEETS.shops);
  const seen = new Set([...rows.map((r) => r["ID"]), ...excluded]);
  const seenKey = new Set(rows.map((r) => norm_(r["店名"]) + "|" + norm_(r["住所"])));
  const out = [];
  for (const it of inbox.items) {
    if (!it || !it.name) continue;
    const id = it.id || ("r-" + Utilities.getUuid().slice(0, 8));
    const key = norm_(it.name) + "|" + norm_(it.address || "");
    if (seen.has(id) || seenKey.has(key)) continue;
    // 緯度・経度がないときは、住所から国土地理院の住所検索で調べる
    if ((it.lat == null || it.lng == null) && it.address) {
      const p = geocode_(it.address);
      if (p) { it.lat = p.lat; it.lng = p.lng; }
    }
    if (it.lat == null || it.lng == null) continue;
    seen.add(id); seenKey.add(key);
    out.push(SHEETS.shops.headers.map((h) => ({
      "ID": id, "店名": it.name, "ジャンル": GENRES.indexOf(it.genre) >= 0 ? it.genre : "other",
      "都道府県": it.pref || "", "市区町村": it.city || "", "住所": it.address || "",
      "緯度": it.lat, "経度": it.lng, "開店日": it.opened || "", "状態": "",
      "概要": it.summary || "", "背景": it.background || "", "情報源URL": (it.sources || []).join("\n"),
      "見つけた日": it.found || today_(), "表示": !it.review, "メモ": it.review ? "要確認（AIなしで自動で読み取った店。内容を確かめて「表示」にチェック）" : (it.note || ""), "個人店の根拠": it.owner || "",
    })[h]));
  }
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, SHEETS.shops.headers.length).setValues(out);
  checkboxes_(SHEETS.shops, "表示");
  return out.length;
}

/** 開店日から1年（365日）をこえたら「1年以上」、それまでは「新店」 */
function updateShopStatuses() {
  const sh = sheet_(SHEETS.shops);
  const last = sh.getLastRow();
  if (last < 2) return;
  const h = SHEETS.shops.headers;
  const opened = sh.getRange(2, h.indexOf("開店日") + 1, last - 1, 1).getValues();
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  const now = new Date();
  const status = opened.map(([d], i) => {
    if (!ids[i][0]) return [""];
    const t = d instanceof Date ? d : (d ? new Date(String(d).replace(/\./g, "-")) : null);
    if (!t || isNaN(t)) return ["新店（開店日不明）"];
    if (t > now) return ["オープン前"];
    return [(now - t) / 86400000 > 365 ? "1年以上" : "新店"];
  });
  sh.getRange(2, h.indexOf("状態") + 1, status.length, 1).setValues(status);
}

/** 「表示」にチェックがある行を MAP 用データとして GitHub に書き出す */
function publishResearch() {
  const rows = readRows_(sheet_(SHEETS.shops), SHEETS.shops).filter((r) => r["表示"] === true && r["緯度"] !== "" && r["経度"] !== "");
  const shops = rows.map((r) => ({
    id: String(r["ID"]),
    type: "new",
    name: String(r["店名"]),
    genre: GENRES.indexOf(r["ジャンル"]) >= 0 ? r["ジャンル"] : "other",
    lat: Number(r["緯度"]), lng: Number(r["経度"]),
    opened: dateStr_(r["開店日"]),
    address: String(r["住所"] || ""),
    summary: String(r["概要"] || ""),
    background: String(r["背景"] || ""),
    sources: String(r["情報源URL"] || "").split(/\s+/).filter((u) => /^https:\/\//.test(u)).slice(0, 3),
    facing: 0,
  }));
  const body = JSON.stringify({ updated: new Date().toISOString(), shops }, null, 1);
  githubPutFile_("data/research.json", body, `新店データを更新（${shops.length}件）`);
  return shops.length;
}

// ===================================================================== 投稿・アカウント（Supabase）
function syncSupabase() {
  const p = props_();
  if (!p.SUPABASE_URL || !p.SUPABASE_SERVICE_KEY) { log_("同期", "Supabase の設定がありません"); return; }
  pushSheetDecisions_();
  pullPosts_();
  pullAccounts_();
  pullReports_();
  log_("同期", "投稿・アカウント・通報を更新しました");
}

function pullPosts_() {
  const data = supa_("GET", "/rest/v1/community_shops?select=*&order=created_at.asc&limit=5000");
  const sh = sheet_(SHEETS.posts);
  const rows = readRows_(sh, SHEETS.posts);
  const index = new Map(rows.map((r, i) => [String(r["投稿ID"]), i + 2]));
  const add = [];
  for (const d of data) {
    const row = {
      "投稿ID": String(d.id), "投稿日時": fmtTime_(d.created_at), "ニックネーム": d.author, "ユーザーID": d.user_id,
      "店名": d.name, "ジャンル": d.genre, "緯度": d.lat, "経度": d.lng, "SNSリンク": d.sns_url || d.video_url || "",
      "口コミ": d.comment || "", "状態": d.status === "rejected" ? "非表示" : "公開", "メモ": "",
    };
    if (index.has(row["投稿ID"])) continue;   // 既にある行は、シートでの編集（状態・メモ）を優先して触らない
    add.push(SHEETS.posts.headers.map((h) => row[h]));
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, SHEETS.posts.headers.length).setValues(add);
}

function pullAccounts_() {
  const profiles = supa_("GET", "/rest/v1/profiles?select=id,name,created_at,updated_at&limit=10000");
  const names = new Map(profiles.map((p) => [p.id, p]));
  const official = new Set(supa_("GET", "/rest/v1/official_users?select=user_id").map((r) => r.user_id));
  const banned = new Set(supa_("GET", "/rest/v1/banned_users?select=user_id").map((r) => r.user_id));
  const users = [];
  for (let page = 1; page <= 20; page++) {
    const res = supa_("GET", `/auth/v1/admin/users?page=${page}&per_page=500`);
    const list = res.users || [];
    users.push(...list);
    if (list.length < 500) break;
  }
  // 投稿数（公開中の口コミの数）
  const counts = new Map();
  for (const c of supa_("GET", "/rest/v1/community_shops?select=user_id&status=eq.approved&limit=100000")) counts.set(c.user_id, (counts.get(c.user_id) || 0) + 1);
  const sh = sheet_(SHEETS.accounts);
  const rows = readRows_(sh, SHEETS.accounts);
  const index = new Map(rows.map((r, i) => [String(r["ユーザーID"]), i + 2]));
  const h = SHEETS.accounts.headers;
  const add = [];
  for (const u of users) {
    if (u.is_anonymous) continue;   // 登録していないゲスト（見るだけの人）は載せない
    const p = names.get(u.id);
    const nick = (p && p.name) || (u.user_metadata && u.user_metadata.nickname) || "";
    // メールアドレス・パスワードは持たない（ログイン用の内部IDも載せない）
    const vals = {
      "ユーザーID": u.id, "ニックネーム": nick, "投稿数": counts.get(u.id) || 0,
      "登録日時": fmtTime_(u.created_at), "最終ログイン": fmtTime_(u.last_sign_in_at),
      "公式★": official.has(u.id), "利用停止": banned.has(u.id), "メモ": "",
    };
    if (index.has(u.id)) {
      // ニックネーム・投稿数・登録日時・最終ログインだけ更新（チェックとメモはシートが正）
      const r = index.get(u.id);
      sh.getRange(r, h.indexOf("ニックネーム") + 1, 1, 4).setValues([[vals["ニックネーム"], vals["投稿数"], vals["登録日時"], vals["最終ログイン"]]]);
    } else {
      add.push(h.map((k) => vals[k]));
    }
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, h.length).setValues(add);
  checkboxes_(SHEETS.accounts, "公式★");
  checkboxes_(SHEETS.accounts, "利用停止");
}

function pullReports_() {
  const data = supa_("GET", "/rest/v1/reports?select=*&order=created_at.asc&limit=5000");
  const sh = sheet_(SHEETS.reports);
  const have = new Set(readRows_(sh, SHEETS.reports).map((r) => String(r["通報ID"])));
  const add = data.filter((d) => !have.has(String(d.id))).map((d) => [String(d.id), fmtTime_(d.created_at), d.reporter, d.target, d.message_id || "", d.reason || ""]);
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, SHEETS.reports.headers.length).setValues(add);
}

/** シートでの判断（非表示・利用停止・公式★）を Supabase に反映 */
function pushSheetDecisions_() {
  // いまの状態と違う投稿だけを書きかえる（毎時の通信を少なくする）
  const current = new Map(supa_("GET", "/rest/v1/community_shops?select=id,status&limit=10000").map((d) => [String(d.id), d.status]));
  for (const r of readRows_(sheet_(SHEETS.posts), SHEETS.posts)) {
    const id = String(r["投稿ID"] || "");
    if (!id || !current.has(id)) continue;
    const status = r["状態"] === "非表示" ? "rejected" : "approved";
    if (current.get(id) === status) continue;
    supa_("PATCH", `/rest/v1/community_shops?id=eq.${encodeURIComponent(id)}`, { status, reviewed_at: new Date().toISOString() });
  }
  const accounts = readRows_(sheet_(SHEETS.accounts), SHEETS.accounts).filter((r) => r["ユーザーID"]);
  const want = (col) => new Set(accounts.filter((r) => r[col] === true).map((r) => String(r["ユーザーID"])));
  syncSet_("/rest/v1/banned_users", want("利用停止"), (id) => ({ user_id: id, reason: "スプレッドシートで利用停止" }));
  syncSet_("/rest/v1/official_users", want("公式★"), (id) => ({ user_id: id }));
}

function syncSet_(path, wantIds, mk) {
  const now = new Set(supa_("GET", path + "?select=user_id").map((r) => r.user_id));
  for (const id of wantIds) if (!now.has(id)) supa_("POST", path, mk(id), { Prefer: "resolution=ignore-duplicates" });
  for (const id of now) if (!wantIds.has(id)) supa_("DELETE", `${path}?user_id=eq.${id}`);
}

// ===================================================================== 道具
function geocode_(address) {
  try {
    const q = String(address).replace(/〒?\d{3}-?\d{4}\s*/, "").trim();
    const res = UrlFetchApp.fetch("https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + encodeURIComponent(q), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const list = JSON.parse(res.getContentText());
    if (!list.length) return null;
    const [lng, lat] = list[0].geometry.coordinates;
    if (!(lat > 20 && lat < 46 && lng > 122 && lng < 154)) return null;
    Utilities.sleep(300);
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  } catch (e) { return null; }
}

function props_() { return PropertiesService.getScriptProperties().getProperties(); }

function supa_(method, path, body, extraHeaders) {
  const p = props_();
  const res = UrlFetchApp.fetch(p.SUPABASE_URL.replace(/\/$/, "") + path, {
    method, muteHttpExceptions: true, contentType: "application/json",
    // 新しい形式の鍵（sb_secret_…）は apikey だけで送る。古い形式（eyJ…）は Authorization にも入れる
    headers: Object.assign({ apikey: p.SUPABASE_SERVICE_KEY, Prefer: "return=minimal" },
      /^eyJ/.test(p.SUPABASE_SERVICE_KEY) ? { Authorization: "Bearer " + p.SUPABASE_SERVICE_KEY } : {}, extraHeaders || {}),
    payload: body ? JSON.stringify(body) : undefined,
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error(`Supabase ${method} ${path} → ${code}: ${res.getContentText().slice(0, 300)}`);
  const text = res.getContentText();
  return text ? JSON.parse(text) : null;
}

function github_(method, path, body) {
  const p = props_();
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${p.GITHUB_REPO}/contents/${path}`, {
    method, muteHttpExceptions: true, contentType: "application/json",
    headers: { Authorization: "Bearer " + p.GITHUB_TOKEN, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { code: res.getResponseCode(), json: res.getContentText() ? JSON.parse(res.getContentText()) : null };
}

function githubGetJson_(path) {
  if (!props_().GITHUB_TOKEN) {
    // 公開リポジトリなので、鍵がなくても読むだけならできる
    const res = UrlFetchApp.fetch(`https://raw.githubusercontent.com/${props_().GITHUB_REPO}/main/${path}?t=${Date.now()}`, { muteHttpExceptions: true });
    if (res.getResponseCode() === 404) return null;
    if (res.getResponseCode() >= 300) throw new Error("GitHub 読み込み失敗 " + res.getResponseCode());
    return JSON.parse(res.getContentText("UTF-8"));
  }
  const r = github_("GET", path);
  if (r.code === 404) return null;
  if (r.code >= 300) throw new Error("GitHub 読み込み失敗 " + r.code);
  const text = Utilities.newBlob(Utilities.base64Decode(r.json.content.replace(/\n/g, ""))).getDataAsString("UTF-8");
  return JSON.parse(text);
}

function githubPutFile_(path, text, message) {
  const cur = github_("GET", path);
  if (cur.code === 200) {
    const old = Utilities.newBlob(Utilities.base64Decode(cur.json.content.replace(/\n/g, ""))).getDataAsString("UTF-8");
    // 日時以外が同じなら書かない
    if (old.replace(/"updated":"[^"]*"/, "") === text.replace(/"updated":"[^"]*"/, "")) return false;
  }
  const r = github_("PUT", path, {
    message, branch: "main",
    content: Utilities.base64Encode(Utilities.newBlob(text, "application/json").getBytes()),
    sha: cur.code === 200 ? cur.json.sha : undefined,
  });
  if (r.code >= 300) throw new Error("GitHub 書き込み失敗 " + r.code + " " + JSON.stringify(r.json).slice(0, 200));
  return true;
}

function sheet_(def) { return ssFor_(def).getSheetByName(def.name); }

function readRows_(sh, def) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, def.headers.length).getValues();
  return vals.map((v) => Object.fromEntries(def.headers.map((h, i) => [h, v[i]])));
}

function checkboxes_(def, header) {
  const sh = sheet_(def);
  const col = def.headers.indexOf(header) + 1;
  if (sh.getLastRow() < 2) return;   // 行がないうちはチェックボックスを置かない（空行のあとに追記されてしまうため）
  sh.getRange(2, col, sh.getLastRow() - 1, 1).insertCheckboxes();
}

function norm_(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }
function today_() { return Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd"); }
function dateStr_(d) {
  if (d instanceof Date) return Utilities.formatDate(d, "Asia/Tokyo", "yyyy-MM-dd");
  return d ? String(d).replace(/\./g, "-").slice(0, 10) : "";
}
function fmtTime_(s) { return s ? Utilities.formatDate(new Date(s), "Asia/Tokyo", "yyyy-MM-dd HH:mm") : ""; }

function log_(what, result) {
  const sh = sheet_(SHEETS.log);
  if (!sh) return;
  sh.appendRow([Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm"), what, result]);
  if (sh.getLastRow() > 500) sh.deleteRows(2, sh.getLastRow() - 500);
}
