// まちマニアMAP 本体
import { CONFIG } from "./config.js";
import { Projector } from "./geo.js";
import { World } from "./world.js";
import { KINDS, MODES, GENRES, seasonPalette } from "./style.js";

const SEASON_NAME = seasonPalette().name;
import { parseSns } from "./media.js";
import { Transport, Ride } from "./transport.js";
import { Guide } from "./guide.js";
import { TownGuide, Dialogue, GUIDE_NAME } from "./npc.js";
import { Avatar, randomAvatar, sanitizeAvatar } from "./avatar.js";
import { LocalNet, SupabaseNet } from "./net.js";
import { checkNick, checkPass } from "./account.js";
import { MiniMap, openModal, toast, openAvatarEditor, shopCardHTML, shopListHTML, esc, anyModalOpen, searchPlaces, postFormHTML, feedbackFormHTML, safeUrl } from "./ui.js";
import { cleanText, cleanReview, checkReview, REVIEW_GUIDE, RateLimiter, loadBlocked, saveBlocked, STAMPS, stampById } from "./moderation.js";

const THREE = window.THREE;
const $ = (s, el = document) => el.querySelector(s);
const store = {
  get(k) {
    try { return JSON.parse(localStorage.getItem("machimania." + k) ?? localStorage.getItem("machitsuku." + k)); } catch { return null; }
  },
  set(k, v) { try { localStorage.setItem("machimania." + k, JSON.stringify(v)); } catch { /* 保存できない環境 */ } },
};

function progress(p, text) {
  $("#loadBar").style.width = Math.round(p * 100) + "%";
  if (text) $("#loadText").textContent = text;
}

async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path} を読み込めませんでした (${r.status})`);
  return r.json();
}

const WALK = 6, RUN = 11;

async function boot() {
  progress(0.05, "地図を読み込んでいます");
  const [worldCfg, index, shopsData] = await Promise.all([
    loadJSON("data/world.json"),
    loadJSON("data/japan/index.json"),
    loadJSON("data/shops.json").catch(() => ({ shops: [] })),
  ]);
  // 毎日のリサーチで見つけた新店（スプレッドシートの「新店」シートから自動で書き出される）
  const researchData = await loadJSON("data/research.json").catch(() => ({ shops: [] }));
  const transportData = await loadJSON("data/transport.json").catch(() => ({ airports: [], ports: [], routes: [] }));
  progress(0.35, "町をつくっています");
  const proj = new Projector(worldCfg.origin, worldCfg.metersPerUnit);

  // ------------------------------------------------------------ 描画の準備
  const canvas = $("#game");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#cfe8f3");
  scene.fog = new THREE.Fog("#dcecf1", 150, 430);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.3, 1200);
  scene.add(new THREE.HemisphereLight("#ffffff", "#d9c49a", 0.62));
  const sun = new THREE.DirectionalLight("#fff1d6", 0.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 200 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const seenIds = new Set();
  const ownShops = [...(shopsData.shops || []), ...(researchData.shops || []).map((r) => ({ ...r, type: "new" }))]
    .filter((s) => !s._hidden && Number.isFinite(s.lat) && Number.isFinite(s.lng) && !seenIds.has(s.id) && seenIds.add(s.id));
  const W = new World(scene, { index, proj, base: "data/japan/", shops: ownShops });
  let mode = MODES[store.get("mode")] ? store.get("mode") : "standard";
  W.setMode(mode);

  // ------------------------------------------------------------ 自分
  const spawnIdx = index.stations.find((s) => s.n === CONFIG.spawnStation) || index.stations[0];
  const saved = store.get("pos");
  const me = { x: spawnIdx.p[0], z: spawnIdx.p[1], ry: Math.PI, vx: 0, vz: 0, speed: 0 };
  const useSaved = saved && Number.isFinite(saved.x) && Number.isFinite(saved.z);
  if (useSaved) { me.x = saved.x; me.z = saved.z; me.ry = saved.ry || 0; }
  progress(0.5, "まわりの地図を読み込んでいます");
  await W.ensureAround(me.x, me.z);
  if (!useSaved) {
    const st = W.stations.find((s) => s.name === CONFIG.spawnStation);
    if (st) { me.x = st.front[0]; me.z = st.front[1]; }
  }
  const findWalkable = (x, z, maxR = 40) => {
    if (W.walkable(x, z)) return [x, z];
    for (let r = 1; r < maxR; r++) for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (W.walkable(nx, nz)) return [nx, nz];
    }
    return null;
  };
  const okPos = findWalkable(me.x, me.z) || findWalkable(spawnIdx.p[0], spawnIdx.p[1]);
  if (okPos) [me.x, me.z] = okPos;
  progress(0.8, "住人をさがしています");

  let profile = null;
  let net = CONFIG.supabaseUrl && CONFIG.supabaseAnonKey
    ? new SupabaseNet(CONFIG)
    : new LocalNet({ room: CONFIG.room, bots: CONFIG.localBots, walkable: (x, z) => W.walkable(x, z), spawn: [me.x, me.z] });
  let account = { member: false };
  try {
    account = await net.init();
  } catch (e) {
    console.error(e);
    toast(e.message, 8000);
    net = new LocalNet({ room: CONFIG.room, bots: CONFIG.localBots, walkable: (x, z) => W.walkable(x, z), spawn: [me.x, me.z] });
    account = await net.init();
  }
  if (account.member && account.profile) profile = { name: account.profile.name, avatar: sanitizeAvatar(account.profile.avatar) };
  progress(1, "準備ができました");
  $("#loading").hidden = true;

  // 編集画面の後ろに町が見えるよう、先に1枚描いておく
  camera.position.set(me.x, 26, me.z + 26);
  camera.lookAt(me.x, 0, me.z);
  sun.position.set(me.x + 28, 52, me.z + 18);
  sun.target.position.set(me.x, 0, me.z);
  renderer.render(scene, camera);

  const isMember = () => !!account?.member;
  let guestMode = false;
  // 登録・ログイン画面（ニックネーム＋パスワード。メールアドレスはいらない）
  function joinDialog(message = "", { first = false } = {}) {
    return new Promise((resolve) => {
      const m = openModal(`
        <h2>${first ? "ようこそ、まちマニアMAPへ" : (message ? esc(message) : "アカウントをつくる")}</h2>
        <div class="join-easy">
          <b>ニックネームとパスワードだけで、いますぐ登録できます</b>
          <span>メールアドレスや電話番号はいりません。1分ほどで終わります。</span>
        </div>
        ${first ? `<p class="lead">登録すると、チャットで話したり、行ったお店の口コミを投稿したりできます。</p>` : ""}
        <div class="join-tabs" role="tablist">
          <button class="btn" type="button" data-tab="new" aria-pressed="true">はじめて（アカウントをつくる）</button>
          <button class="btn" type="button" data-tab="login" aria-pressed="false">ログイン</button>
        </div>
        <form id="joinForm" class="post-form" autocomplete="on">
          <label class="field"><b>ニックネーム（12文字まで）</b><input id="jNick" maxlength="12" required autocomplete="username" placeholder="例：ラーメン好きのたろう">
            <small class="new-only">町やランキングに表示されます。本名や学校名は入れないでください。あとから変えられません。</small></label>
          <label class="field"><b>パスワード（8文字以上）</b><input id="jPass" type="password" minlength="8" required autocomplete="new-password"></label>
          <label class="field new-only"><b>パスワード（確認）</b><input id="jPass2" type="password" minlength="8" autocomplete="new-password"></label>
          <p class="note new-only">パスワードは運営も見られない形で保存されます。<b>忘れたときは再発行できないので、アカウントの作り直し</b>になります。この端末ではログインしたままになります。</p>
          <div class="row-end">
            <button class="btn" type="button" id="jGuest">${first ? "登録せずに見てまわる" : "閉じる"}</button>
            <button class="btn primary" type="submit" id="jGo">次へ（すがたをつくる）</button>
          </div>
        </form>
        ${first ? `<p class="note">登録しないと、チャットとお店の投稿はできません（町を歩いて見ることはできます）。</p>` : ""}`, { dismissable: !first, onClose: () => resolve(null) });
      let tab = "new";
      const setTab = (t) => {
        tab = t;
        m.el.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === t)));
        m.el.querySelectorAll(".new-only").forEach((el) => { el.hidden = t !== "new"; });
        $("#jPass", m.el).autocomplete = t === "new" ? "new-password" : "current-password";
        $("#jGo", m.el).textContent = t === "new" ? "次へ（すがたをつくる）" : "ログイン";
      };
      m.el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
      $("#jGuest", m.el).addEventListener("click", () => { resolve({ type: "guest" }); m.close(); });
      $("#joinForm", m.el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const nick = $("#jNick", m.el).value.replace(/\s+/g, " ").trim(), pass = $("#jPass", m.el).value;
        const bad = checkNick(nick) || checkPass(pass, tab === "new" ? $("#jPass2", m.el).value : undefined);
        if (bad) return toast(bad);
        const btn = $("#jGo", m.el);
        btn.disabled = true;
        try {
          if (tab === "login") { await net.login(nick, pass); resolve({ type: "login" }); m.close(); location.reload(); return; }
          resolve({ type: "new", nick, pass }); m.close();
        } catch (ex) { toast(ex.message, 5000); btn.disabled = false; }
      });
    });
  }
  async function runJoin(message, opts) {
    const r = await joinDialog(message, opts);
    if (!r || r.type !== "new") return r;
    // すがたをつくってから登録する
    const avatar = await new Promise((resolve) => openAvatarEditor({
      name: r.nick, avatar: profile?.avatar || randomAvatar(), firstTime: true, nameLocked: true,
      nameNote: "ニックネームがそのまま名前になります", saveLabel: "登録して町に出かける",
      onSave: (_n, av) => resolve(av),
    }));
    try {
      await net.register(r.nick, r.pass, avatar);
      store.set("profile", { name: r.nick, avatar });
      location.reload();
    } catch (ex) {
      toast(ex.message, 6000);
      return runJoin(ex.message, opts);
    }
    return r;
  }
  function openJoin(message) { runJoin(message); }

  if (!profile) {
    if (!store.get("joinSeen")) {
      store.set("joinSeen", true);
      await runJoin("", { first: true });
    }
    const g = store.get("guestAvatar") || randomAvatar();
    store.set("guestAvatar", g);
    profile = { name: "ゲスト", avatar: g };
    guestMode = true;
  }
  store.set("profile", profile);

  const myAvatar = new Avatar(profile.avatar, profile.name, { official: !!net.isOfficial?.(net.id) });
  myAvatar.group.position.set(me.x, 0, me.z);
  myAvatar.addTo(scene);
  const transport = new Transport(scene, W, index, proj, transportData);
  const townGuide = new TownGuide(scene);
  const dialog = new Dialogue();
  let talkBlend = 0, talkWith = null, detailT = 1;
  $("#talkBtn").addEventListener("click", () => startTalk());
  const guide = new Guide();
  const selfTarget = { av: myAvatar, bubble: null };

  // ------------------------------------------------------------ ほかの人
  const blocked = loadBlocked();
  const peers = new Map(); // id → {av, s, recvAt, x, z, ry, speed, info, bubble}

  function addPeer(id, info) {
    if (peers.has(id)) return peers.get(id);
    const av = new Avatar(info.avatar, info.name || "だれか", { official: !!(net.isOfficial(id) || (net.mode === "local" && info.official)) });
    av.group.visible = false;
    av.addTo(scene);
    const p = { id, av, info, s: null, recvAt: 0, x: 0, z: 0, ry: 0, speed: 0, bot: !!info.bot };
    peers.set(id, p);
    return p;
  }
  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    p.av.removeFrom(scene);
    p.av.dispose();
    p.bubble?.el.remove();
    peers.delete(id);
  }

  net.on("peer", (id, info) => {
    addPeer(id, info);
    if (!blocked.has(id)) logSystem(`${info.name || "だれか"} さんが来ました`);
    updateNetChip();
  });
  net.on("profile", (id, info) => {
    const p = peers.get(id);
    if (p) { p.info = info; p.av.setConfig(info.avatar, info.name); }
  });
  net.on("leave", (id) => {
    const p = peers.get(id);
    if (p && !blocked.has(id)) logSystem(`${p.info.name || "だれか"} さんが帰りました`);
    removePeer(id);
    updateNetChip();
  });
  net.on("state", (id, s) => {
    const p = peers.get(id);
    if (!p || !s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return;
    if (!p.s) { p.x = s.x; p.z = s.z; p.ry = s.ry || 0; }
    p.s = s;
    p.recvAt = performance.now();
    p.av.group.visible = !blocked.has(id);
  });
  net.on("chat", (msg) => onChat(msg));
  net.on("history", (list) => {
    if (list.length) logSystem("これまでの会話");
    list.forEach((m) => onChat(m, true));
  });
  net.on("status", () => updateNetChip());
  net.on("count", () => updateNetChip());
  net.on("account", (a) => { account = { ...account, ...a }; });
  let onlineTotal = 1;
  net.on("online", (n) => { onlineTotal = n; updateNetChip(); });
  net.on("room", () => { logSystem(`${(W.areaAt(me.x, me.z) || {}).name || "この地域"}あたりの部屋に入りました（近くの人とだけ話せます）`); updateNetChip(); });

  function updateNetChip() {
    const chip = $("#netChip");
    const n = [...peers.values()].filter((p) => !blocked.has(p.id)).length + 1;
    chip.className = "chip " + (net.mode === "online" ? "on" : "test");
    const total = Math.max(onlineTotal, n);
    chip.querySelector("span").textContent = net.mode === "online" ? `全国 ${total}人・近く ${n}人` : `テストモード 近く ${n}人`;
    chip.title = net.mode === "online" ? "全国の人数と、同じ地域（約80km四方）にいる人数" : "Supabase を設定するとオンラインになります";
  }


  // ------------------------------------------------------------ チャット
  const chatLog = $("#chatLog");
  const limiter = new RateLimiter();
  let unread = 0;
  function logLine(html, cls = "") {
    const d = document.createElement("div");
    d.className = "msg " + cls;
    d.innerHTML = html;
    chatLog.appendChild(d);
    while (chatLog.children.length > 150) chatLog.firstChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
    if (chatLog.hidden && cls !== "system") { unread++; $("#btnLog").dataset.unread = unread > 9 ? "9+" : unread; }
  }
  function logSystem(text) { logLine(esc(text), "system"); }
  const hhmm = (t) => { const d = new Date(t || Date.now()); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

  function onChat(msg, quiet = false) {
    if (!msg || blocked.has(msg.from)) return;
    const mine = msg.from === net.id;
    const official = mine ? myAvatar.official : !!peers.get(msg.from)?.av.official || net.isOfficial?.(msg.from);
    const name = (official ? "★ " : "") + (mine ? profile.name : (peers.get(msg.from)?.info.name || msg.name || "だれか"));
    let body;
    if (msg.kind === "stamp") {
      const st = stampById(msg.body);
      if (!st) return;
      body = `<span class="stamp">${st.emoji}</span><span class="body">${esc(st.label)}</span>`;
    } else {
      body = `<span class="body">${esc(cleanText(msg.body))}</span>`;
    }
    logLine(`<button type="button" class="who" data-id="${esc(msg.from)}" data-mid="${esc(msg.id ?? "")}">${esc(name)}</button>${body}<span class="time">${hhmm(msg.at)}</span>`, mine ? "mine" : "");
    if (quiet) { unread = 0; delete $("#btnLog").dataset.unread; return; }
    const target = mine ? selfTarget : peers.get(msg.from);
    if (target) {
      showBubble(target, msg);
      if (msg.kind === "stamp") target.av.emote();
    }
  }

  $("#chatInput").addEventListener("input", (e) => { $("#chatCount").textContent = `${[...e.target.value].length}/100`; });
  $("#chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const text = cleanText(input.value);
    if (!text) return;
    if (!isMember()) { openJoin("チャットするには、アカウントをつくってください"); return; }
    const err = limiter.check();
    if (err) { toast(err); return; }
    input.value = "";
    $("#chatCount").textContent = "0/100";
    try { await net.chat("text", text); } catch (ex) { toast(ex.message); input.value = text; }
  });
  $("#stampPanel").innerHTML = STAMPS.map((s) => `<button type="button" class="stamp-btn" data-stamp="${s.id}">${s.emoji}<span>${s.label}</span></button>`).join("");
  $("#stampPanel").addEventListener("click", async (e) => {
    if (!isMember() && e.target.closest("[data-stamp]")) { openJoin("スタンプを送るには、アカウントをつくってください"); return; }
    const b = e.target.closest("[data-stamp]");
    if (!b) return;
    const err = limiter.check();
    if (err) { toast(err); return; }
    togglePanel("stamp", false);
    try { await net.chat("stamp", b.dataset.stamp); } catch (ex) { toast(ex.message); }
  });
  function togglePanel(which, force) {
    const el = which === "log" ? chatLog : $("#stampPanel");
    const btn = which === "log" ? $("#btnLog") : $("#btnStamp");
    const show = force ?? el.hidden;
    el.hidden = !show;
    btn.setAttribute("aria-expanded", show);
    if (which === "log" && show) { unread = 0; delete btn.dataset.unread; chatLog.scrollTop = chatLog.scrollHeight; }
    if (show) (which === "log" ? $("#stampPanel") : chatLog).hidden = true;
  }
  $("#btnLog").addEventListener("click", () => togglePanel("log"));
  $("#btnStamp").addEventListener("click", () => togglePanel("stamp"));
  chatLog.addEventListener("click", (e) => {
    const b = e.target.closest(".who");
    if (b && b.dataset.id !== net.id) openPlayerMenu(b.dataset.id, b.dataset.mid);
  });

  // ------------------------------------------------------------ 吹き出し
  const bubbleLayer = $("#bubbles");
  function showBubble(target, msg) {
    if (!target.bubble) {
      const el = document.createElement("div");
      el.className = "bubble";
      bubbleLayer.appendChild(el);
      target.bubble = { el, until: 0 };
    }
    const b = target.bubble;
    if (msg.kind === "stamp") {
      const st = stampById(msg.body);
      b.el.className = "bubble stamp";
      b.el.innerHTML = `${st.emoji}<small>${esc(st.label)}</small>`;
      b.until = performance.now() + 4000;
    } else {
      b.el.className = "bubble";
      b.el.textContent = cleanText(msg.body);
      b.until = performance.now() + 6500;
    }
    b.el.style.animation = "none";
    void b.el.offsetWidth;
    b.el.style.animation = "";
  }
  const v3 = new THREE.Vector3();
  function placeBubble(target, x, z, h) {
    const b = target.bubble;
    if (!b) return;
    const now = performance.now();
    const visible = now < b.until && Math.hypot(x - me.x, z - me.z) < 95;
    if (!visible) { b.el.hidden = true; return; }
    v3.set(x, 3.55 * h, z).project(camera);
    if (v3.z > 1) { b.el.hidden = true; return; }
    b.el.hidden = false;
    b.el.style.transform = `translate(${((v3.x + 1) / 2) * innerWidth}px, ${((1 - v3.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
  }

  // ------------------------------------------------------------ 接続（チャット欄の準備ができてから）
  let currentArea = W.tileKeyAt(me.x, me.z);
  let waitTimer = null, retryTimer = null, retryDelay = 15000, retryNoticed = false;
  async function connectNet() {
    clearTimeout(retryTimer);
    try {
      const info = await net.connect({ name: profile.name, avatar: profile.avatar }, currentArea);
      account = { ...(account || {}), ...info };
      hideWaiting();
      myAvatar.setOfficial(!!net.isOfficial?.(net.id));
      for (const p of peers.values()) p.av.setOfficial(!!(net.isOfficial(p.id) || (net.mode === "local" && p.info.official)));
    } catch (e) {
      if (e.code === "FULL") { showWaiting(e.count); return; }
      console.error(e);
      // 通信が一時的にうまくいかないときは、少しずつ間をあけて自動でつなぎ直す（そのあいだもひとりで歩ける）
      if (!retryNoticed) { toast("いまサーバーにつながりにくいので、自動でつなぎ直します（ひとりで歩くことはできます）", 7000); retryNoticed = true; }
      retryTimer = setTimeout(connectNet, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 120000);
    }
    updateNetChip();
  }
  // 満員のときの入室待ち（30秒ごとに入れるか確かめる）
  function showWaiting(count) {
    const w = $("#waiting");
    w.hidden = false;
    $("#waitCount").textContent = count ? `いま全国で ${count} 人が遊んでいます。` : "";
    let sec = 30;
    clearInterval(waitTimer);
    $("#waitSec").textContent = sec;
    waitTimer = setInterval(() => {
      sec--;
      $("#waitSec").textContent = Math.max(0, sec);
      if (sec <= 0) { clearInterval(waitTimer); connectNet(); }
    }, 1000);
  }
  function hideWaiting() { clearInterval(waitTimer); $("#waiting").hidden = true; $("#waitMini").hidden = true; }
  $("#waitAlone").addEventListener("click", () => { $("#waiting").hidden = true; $("#waitMini").hidden = false; });
  $("#waitMini").addEventListener("click", () => { $("#waiting").hidden = false; $("#waitMini").hidden = true; });
  await connectNet();

  // ------------------------------------------------------------ 人のメニュー（ブロック・通報）
  function openPlayerMenu(id, messageId) {
    const p = peers.get(id);
    const name = p?.info.name || [...chatLog.querySelectorAll(".who")].find((b) => b.dataset.id === id)?.textContent || "だれか";
    const isBlocked = blocked.has(id);
    const m = openModal(`
      <h2>${esc(name)}</h2>
      <p class="lead">${p?.bot ? "テスト用の住人です。" : "いやなことをされたら、ブロックや通報ができます。"}</p>
      <div class="row-end" style="justify-content:flex-start">
        ${!isBlocked && p ? `<button class="btn sun" type="button" data-a="wave">👋 あいさつする</button>` : ""}
        <button class="btn" type="button" data-a="block">${isBlocked ? "ブロックを解除" : "🚫 ブロックする"}</button>
        <button class="btn danger" type="button" data-a="report">通報する</button>
      </div>
      <p class="note" style="margin-top:12px">ブロックすると、その人の姿とチャットがあなたの画面から消えます（相手には伝わりません）。</p>`);
    m.el.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      if (a === "wave") {
        m.close();
        const err = limiter.check();
        if (err) return toast(err);
        try { await net.chat("stamp", "hi"); } catch (ex) { toast(ex.message); }
      } else if (a === "block") {
        if (isBlocked) blocked.delete(id); else blocked.add(id);
        saveBlocked(blocked);
        if (p) { p.av.group.visible = !blocked.has(id) && !!p.s; if (p.bubble) p.bubble.el.hidden = true; }
        toast(isBlocked ? "ブロックを解除しました" : `${name} さんをブロックしました`);
        updateNetChip();
        m.close();
      } else if (a === "report") {
        m.close();
        openReport(id, name, messageId);
      }
    });
  }

  function openReport(id, name, messageId) {
    const reasons = ["悪口・いやがらせ", "個人情報を聞かれた・書かれた", "出会い目的・勧誘", "スパム・宣伝", "その他"];
    const m = openModal(`
      <h2>通報する</h2>
      <p class="lead">${esc(name)} さんについて、運営者に知らせます。相手には伝わりません。</p>
      <div class="radio-list">${reasons.map((r, i) => `<label><input type="radio" name="rr" value="${esc(r)}" ${i === 0 ? "checked" : ""}> ${esc(r)}</label>`).join("")}</div>
      <label class="field" style="margin-top:12px"><b>くわしく（なくても大丈夫）</b><textarea id="rDetail" maxlength="300"></textarea></label>
      <div class="row-end"><button class="btn danger" type="button" id="rSend">通報を送る</button></div>`);
    $("#rSend", m.el).addEventListener("click", async () => {
      const reason = m.el.querySelector("input[name=rr]:checked").value + " / " + $("#rDetail", m.el).value.slice(0, 300);
      try {
        const r = await net.report(id, messageId, reason);
        toast(r.local ? "テストモードのため送信はしていません（オンラインでは運営者に届きます）" : "通報を受け付けました。ありがとうございます", 4000);
        if (!blocked.has(id)) { blocked.add(id); saveBlocked(blocked); const p = peers.get(id); if (p) p.av.group.visible = false; }
      } catch (ex) { toast("送れませんでした：" + ex.message); }
      m.close();
    });
  }

  // ------------------------------------------------------------ お店カード
  const stationOf = (o) => W.nearestStation(o.x, o.z)?.n || "";
  const card = $("#shopCard");
  let cardShop = null, dismissed = null;
  card.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") { dismissed = cardShop; card.hidden = true; cardShop = null; }
    else if (act === "sns" && cardShop) openSnsPost(cardShop.shop);
    else if (act === "photo" && cardShop) {
      const s = cardShop.shop;
      openModal(`<h2>${esc(s.name)}</h2><img class="photo-full" src="${esc(safeUrl(s.photoUrl || s.thumbUrl, true))}" alt="${esc(s.name)}の写真"><p class="note">投稿：${esc(s.author || "")}</p>`);
    } else if (act === "report-shop" && cardShop) {
      const s = cardShop.shop;
      const m = openModal(`<h2>この投稿を通報する</h2><p class="lead">「${esc(s.name)}」の写真や内容に問題があれば、運営者に知らせます。</p>
        <label class="field"><b>理由</b><textarea id="rsReason" maxlength="300" placeholder="例：人の顔が写っている、関係のない写真 など"></textarea></label>
        <div class="row-end"><button class="btn danger" type="button" id="rsSend">通報を送る</button></div>`);
      $("#rsSend", m.el).addEventListener("click", async () => {
        try { const r = await net.reportShop(s, $("#rsReason", m.el).value || "理由なし"); toast(r.local ? "テストモードのため送信はしていません" : "通報を受け付けました。ありがとうございます", 4000); }
        catch (ex) { toast("送れませんでした：" + ex.message); }
        m.close();
      });
    }
  });
  function updateShopCard() {
    let best = null, bd = Infinity;
    for (const o of W.shops) { const d = Math.hypot(o.x - me.x, o.z - me.z); if (d < bd) { bd = d; best = o; } }
    if (best && bd < 8) {
      if (cardShop !== best && dismissed !== best) {
        cardShop = best;
        card.innerHTML = shopCardHTML(best, stationOf(best), { mine: best.shop.mine });
        card.hidden = false;
      }
    } else {
      if (cardShop) { card.hidden = true; cardShop = null; }
      if (bd > 10) dismissed = null;
    }
  }

  // ------------------------------------------------------------ ワープ
  let warping = false;
  async function teleport(x, z, label, opts = {}) {
    if (warping) return;
    if (ride && !opts.fromRide) { const r = ride; ride = null; r.onEnd = () => {}; r.finish(); $("#rideHud").hidden = true; if (matchMedia("(pointer: coarse)").matches) $("#joystick").hidden = false; }
    warping = true;
    try {
      if (!W.isReady(x, z)) toast("地図を読み込んでいます…", 1500);
      await W.ensureAround(x, z);
      if (opts.station) {
        const st = W.stations.filter((s) => s.name === opts.station).sort((a, b) => Math.hypot(a.pos[0] - x, a.pos[1] - z) - Math.hypot(b.pos[0] - x, b.pos[1] - z))[0];
        if (st) { x = st.front[0]; z = st.front[1]; }
      }
      const p = findWalkable(x, z, 30);
      if (!p) { toast("そこは海の上です。陸地をえらんでください"); return; }
      [x, z] = p;
    } catch (e) { toast(e.message); return; } finally { warping = false; }
    me.x = x; me.z = z; me.vx = me.vz = 0;
    walkTarget = null;
    marker.visible = false;
    camTarget.set(x, 1.6, z);
    myAvatar.emote();
    if (label) toast(label);
  }
  const minimap = new MiniMap($("#minimap"), W, index, (x, z) => {
    const area = index.munis.find((m) => x >= m.bbox[0] && x <= m.bbox[2] && z >= m.bbox[1] && z <= m.bbox[3]);
    teleport(x, z, area ? `${area.pref}${area.name} にワープしました` : "ワープしました");
  });
  function setBigMap(big) {
    const wrap = $("#mapWrap");
    wrap.classList.toggle("big", big);
    $("#mapTools").hidden = !big;
    minimap.setBig(big);
    $("#mapToggle").textContent = big ? "小さく" : "全国マップ";
  }
  $("#mapToggle").addEventListener("click", () => setBigMap(!minimap.big));
  $("#mapZoomIn").addEventListener("click", () => minimap.zoom(0.6));
  $("#mapZoomOut").addEventListener("click", () => minimap.zoom(1.7));
  $("#mapAll").addEventListener("click", () => minimap.showAll());
  $("#mapHere").addEventListener("click", () => minimap.recenter());
  const searchBox = $("#placeSearch"), results = $("#placeResults");
  searchBox.addEventListener("input", () => {
    const list = searchPlaces(index, W.shops, searchBox.value);
    results.hidden = !list.length;
    results.innerHTML = list.map((r, i) => `<button type="button" data-i="${i}"><b>${esc(r.label)}</b><small>${esc(r.sub)}</small></button>`).join("");
    results._list = list;
  });
  results.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const r = results._list[+b.dataset.i];
    results.hidden = true;
    searchBox.value = "";
    setBigMap(false);
    teleport(r.x, r.z, `${r.label} に着きました`, { station: r.station });
  });

  // ------------------------------------------------------------ ボタン
  $("#btnShops").addEventListener("click", () => {
    const m = openModal(`<h2>お店リスト</h2><p class="lead">いまのモード「${esc(MODES[mode].label)}」のお店です。「行く」でお店の前にワープします。</p>${shopListHTML(W.shopObjs, stationOf, mode)}`);
    m.el.addEventListener("click", (e) => {
      const id = e.target.closest("[data-go]")?.dataset.go;
      if (!id) return;
      const o = W.shopObjs.find((s) => s.shop.id === id);
      const f = ((o.shop.facing || 0) * Math.PI) / 180;
      m.close();
      dismissed = null;
      teleport(o.x + Math.sin(f) * 5.5, o.z + Math.cos(f) * 5.5, `${o.shop.name} に着きました`);
      me.ry = f + Math.PI;
    });
  });
  $("#btnAvatar").addEventListener("click", () => openAvatarEditor({
    name: profile.name, avatar: profile.avatar, nameLocked: true, official: !!net.isOfficial?.(net.id),
    nameNote: isMember() ? "ニックネーム（ログイン名）は変えられません" : "登録するとニックネームが名前になります",
    onSave: async (name, avatar) => {
      profile = { name: profile.name, avatar };
      store.set("profile", profile);
      if (!isMember()) store.set("guestAvatar", avatar);
      myAvatar.setConfig(avatar, name);
      myAvatar.emote();
      try { await net.updateProfile(profile); } catch (e) { toast(e.message); }
    },
  }));
  $("#btnAccount").addEventListener("click", openAccount);
  $("#btnHelp").addEventListener("click", () => guide.menu());
  $("#btnFeedback").addEventListener("click", () => openFeedback());
  guide.onCredits = () => openHelp();

  async function openAccount() {
    if (!isMember()) { openJoin(""); return; }
    const n = await net.myPostCount().catch(() => 0);
    const m = openModal(`
      <h2>アカウント</h2>
      <p class="lead"><b>${esc(profile.name)}</b> さんでログインしています${net.mode === "online" ? "" : "（テストモード：この端末の中だけのアカウント）"}。</p>
      <p class="note">これまでの投稿：<b>${n}件</b></p>
      <p class="note">この端末ではログインしたままになります。別の端末では、ニックネームとパスワードでログインしてください。パスワードを忘れたときは再発行できないので、新しいアカウントを作ってください。</p>
      <div class="row-end">
        <button class="btn" type="button" id="acRank">投稿ランキングを見る</button>
        <button class="btn" type="button" id="acOut">ログアウト</button>
      </div>`);
    $("#acRank", m.el).addEventListener("click", () => { m.close(); openRanking(); });
    $("#acOut", m.el).addEventListener("click", () => { store.set("profile", null); net.logout(); });
  }

  // ------------------------------------------------------------ 投稿数・ランキング
  async function refreshMyPosts() {
    const chip = $("#myPosts");
    if (!chip) return;
    if (!isMember()) { chip.textContent = "📝 かんたん登録で投稿"; return; }
    const n = await net.myPostCount().catch(() => null);
    if (n != null) chip.textContent = `📝 あなたの投稿 ${n}件`;
  }
  async function openRanking() {
    const m = openModal(`<h2>🏆 投稿ランキング</h2><p class="lead">口コミをたくさん投稿してくれた人のランキングです。</p><ol class="rank-list" id="rankList"><li>読み込み中…</li></ol>`);
    const list = await net.ranking().catch(() => []);
    const myId = account?.accountId;
    const medal = ["🥇", "🥈", "🥉"];
    $("#rankList", m.el).innerHTML = list.length ? list.map((r, i) => `<li class="${r.userId && r.userId === myId ? "me" : ""}"><span class="no">${medal[i] || i + 1}</span><span>${net.isOfficial?.(r.userId) ? "★ " : ""}${esc(r.name || "だれか")}</span><span class="n">${r.posts}件</span></li>`).join("")
      : `<li>まだ投稿がありません。最初の1件を投稿してみませんか？</li>`;
  }
  $("#myPosts")?.addEventListener("click", () => (isMember() ? openRanking() : openJoin("お店を投稿するには、アカウントをつくってください")));

  function openHelp() {
    const approx = !index.roadsFromOsm.length;
    openModal(`
      <h2>まちマニアMAPの遊び方</h2>
      <p class="lead">日本じゅうの町に、お店が少しずつ建っていきます。お店に近づくと情報が出て、動画や写真を見られます。</p>
      <section><h4>お店の色</h4><div class="legend">${Object.values(KINDS).map((k) => `<span><i style="background:${k.color}"></i>${esc(k.label)}：${esc(k.note)}</span>`).join("")}</div></section>
      <section><h4>モード</h4><p class="note">${Object.values(MODES).map((m) => `<b>${esc(m.label)}</b>…${esc(m.note)}`).join("<br>")}</p></section>
      <section><h4>うごく</h4>
        <div class="keys">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / 矢印</span><span>歩く（<kbd>Shift</kbd> で走る）</span>
          <span>クリック・タップ</span><span>その場所まで歩く</span>
          <span>ドラッグ / <kbd>Q</kbd><kbd>E</kbd></span><span>カメラを回す</span>
          <span>ホイール・ピンチ</span><span>ズーム</span>
          <span>マップをクリック</span><span>その場所へワープ（「全国マップ」で日本じゅうへ）</span>
          <span><kbd>Enter</kbd></span><span>チャットを書く</span>
        </div>
      </section>
      <section><h4>みんなと話す</h4><p class="note">チャットとスタンプは同じ部屋の全員に届きます。名前をタップするとブロック・通報ができます。リンクや電話番号は自動で伏せられます。</p></section>
      <section><h4>地図について</h4>
        <p class="note">縮尺は実際の約 1/${worldCfg.metersPerUnit}（歩く距離を短くしています）。全国の市区町村と都道府県の境、鉄道と駅があります。木や花の色は季節で変わります（いまは${esc(SEASON_NAME)}）。${approx ? "<br><b>道路は町田市の主な道路だけ（仮の配置）</b>です。" : ""}${index.railSource.startsWith("n02") ? "" : "<br>関東以外の線路は、駅と駅をまっすぐつないだ線で表しています。"}</p>
      </section>
      <section><h4>出典</h4>
        <p class="credits">行政区域：国土交通省「国土数値情報（行政区域データ）」を加工（smartnews-smri/japan-topography 経由）<br>
        ${index.railSource.startsWith("n02") ? "鉄道・駅：国土交通省「国土数値情報（鉄道データ）」を加工<br>" : "鉄道・駅（関東）：公共交通オープンデータセンターのデータを元にした Mini Tokyo 3D（MIT License）のデータを加工<br>鉄道・駅（全国）：駅データ.jp を元にした open-data-jp-railway-stations のデータを加工<br>"}
        ${approx ? "" : "道路・川：© OpenStreetMap contributors（ODbL）<br>"}
        3D描画：three.js</p>
      </section>`);
  }

  // ------------------------------------------------------------ 操作
  const keys = new Set();
  addEventListener("keydown", (e) => {
    if (anyModalOpen()) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (dialog.open) return;
    if ((e.code === "Space" || e.code === "KeyF") && !$("#talkBtn").hidden) { e.preventDefault(); startTalk(); return; }
    if (e.key === "Enter") { e.preventDefault(); $("#chatInput").focus(); return; }
    if (e.key === "m" || e.key === "M") { $("#mapToggle").click(); return; }
    keys.add(e.code);
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  let yaw = 0, pitch = 0.8, zoom = 1.25, lastUserCam = 0;
  const pointers = new Map();
  let drag = null, pinchD = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); drag = null; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD) zoom = clamp(zoom * (pinchD / d), 0.35, 3.4);
      pinchD = d;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 7) drag.moved = true;
    if (drag.moved) { yaw -= dx * 0.006; pitch = clamp(pitch + dy * 0.004, 0.38, 1.3); lastUserCam = performance.now(); }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endPointer = (e) => {
    if (drag && !drag.moved && pointers.size === 1) onTap(e.clientX, e.clientY);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchD = 0;
    if (!pointers.size) drag = null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); drag = null; });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom = clamp(zoom * Math.exp(e.deltaY * 0.0012), 0.35, 3.4); }, { passive: false });

  // 目的地マーカー
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 24), new THREE.MeshBasicMaterial({ color: "#ffcf4a", transparent: true, opacity: 0.9, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.08;
  marker.visible = false;
  scene.add(marker);
  let walkTarget = null;

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function onTap(cx, cy) {
    togglePanel("stamp", false);
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    // ほかの人
    let hitPeer = null, hd = 1.4;
    for (const p of peers.values()) {
      if (!p.av.group.visible) continue;
      const c = new THREE.Vector3(p.x, 1.6 * p.av.cfg.height, p.z);
      const d = ray.ray.distanceToPoint(c);
      if (d < hd) { hd = d; hitPeer = p; }
    }
    if (hitPeer) return openPlayerMenu(hitPeer.id);
    const hits = ray.intersectObjects(W.landMeshes, false);
    if (!hits.length) return;
    const pt = hits[0].point;
    // お店をタップ → 入口の前まで歩く
    const shop = W.shops.find((o) => Math.hypot(o.x - pt.x, o.z - pt.z) < 4);
    if (shop) {
      const f = ((shop.shop.facing || 0) * Math.PI) / 180;
      walkTarget = { x: shop.x + Math.sin(f) * 4.6, z: shop.z + Math.cos(f) * 4.6 };
      dismissed = null;
    } else if (W.walkable(pt.x, pt.z)) {
      walkTarget = { x: pt.x, z: pt.z };
    } else {
      toast("そこは海の上です");
      return;
    }
    marker.position.set(walkTarget.x, 0.08, walkTarget.z);
    marker.visible = true;
  }

  // スマホ用スティック
  const joy = { x: 0, y: 0, id: null };
  if (matchMedia("(pointer: coarse)").matches) {
    const j = $("#joystick"), knob = j.querySelector(".knob");
    j.hidden = false;
    const setKnob = (e) => {
      const r = j.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2 - 14;
      const L = Math.hypot(dx, dy);
      if (L > max) { dx *= max / L; dy *= max / L; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy.x = dx / max; joy.y = dy / max;
    };
    j.addEventListener("pointerdown", (e) => { joy.id = e.pointerId; j.setPointerCapture(e.pointerId); setKnob(e); walkTarget = null; marker.visible = false; });
    j.addEventListener("pointermove", (e) => { if (e.pointerId === joy.id) setKnob(e); });
    const release = (e) => { if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ""; } };
    j.addEventListener("pointerup", release);
    j.addEventListener("pointercancel", release);
  }

  // ------------------------------------------------------------ ループ
  const camTarget = new THREE.Vector3(me.x, 1.6, me.z);
  const camPos = new THREE.Vector3();
  let lastArea = null, saveT = 0, ensureT = 0, rideBtnT = 0, last = performance.now(), t = 0, guideT = 1;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;

    // 入力 → 進みたい方向
    let ix = 0, iz = 0;
    if (!anyModalOpen()) {
      if (keys.has("KeyW") || keys.has("ArrowUp")) iz += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) iz -= 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
      if (keys.has("KeyQ")) { yaw += dt * 1.6; lastUserCam = now; }
      if (keys.has("KeyE")) { yaw -= dt * 1.6; lastUserCam = now; }
    }
    if (joy.id !== null) { ix += joy.x; iz += -joy.y; }
    if (dialog.open) { ix = iz = 0; walkTarget = null; marker.visible = false; }
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // カメラの向く方向（前）
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // 右
    let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
    let mag = Math.hypot(dx, dz);
    let running = keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(joy.x, joy.y) > 0.92;
    if (mag > 0.01) { walkTarget = null; marker.visible = false; }
    else if (walkTarget) {
      dx = walkTarget.x - me.x; dz = walkTarget.z - me.z;
      mag = Math.hypot(dx, dz);
      running = mag > 30;
      if (mag < 0.35) { walkTarget = null; marker.visible = false; dx = dz = mag = 0; }
    }
    const analog = joy.id !== null && !walkTarget ? Math.min(1, Math.hypot(joy.x, joy.y)) : 1;
    const sp = mag > 0.01 ? (running ? RUN : WALK) * analog : 0;
    const tvx = mag > 0.01 ? (dx / mag) * sp : 0, tvz = mag > 0.01 ? (dz / mag) * sp : 0;
    const k = 1 - Math.exp(-12 * dt);
    me.vx += (tvx - me.vx) * k;
    me.vz += (tvz - me.vz) * k;
    if (ride) {
      const r = ride;
      r.update(dt);   // 着いたら、この中で ride が null になることがある
      me.x = r.pos.x; me.z = r.pos.z; me.ry = r.dir;
      me.vx = me.vz = 0; me.speed = 0;
      if (ride && r.kind !== "train") {
        // 飛行機・船：カメラがゆっくり後ろに回りこむ（自分で回したら、しばらくはそのまま）
        if (now - lastUserCam > 3000) yaw = lerpAngle(yaw, r.dir + Math.PI, 1 - Math.exp(-0.7 * dt));
        // 着く前に、到着地の町を先に読み込んでおく（着陸のときにカクつかないように）
        if (r.dest && !r.preloaded && r.leg && r.s > r.leg.total * 0.6) { r.preloaded = true; W.ensureAround(r.dest[0], r.dest[1]).catch(() => {}); }
      }
      walkTarget = null; marker.visible = false;
      $("#rideStatus").textContent = r.progressText();
    } else {
      const nx = me.x + me.vx * dt, nz = me.z + me.vz * dt;
      if (W.walkable(nx, nz)) { me.x = nx; me.z = nz; }
      else if (W.walkable(nx, me.z)) { me.x = nx; me.vz = 0; }
      else if (W.walkable(me.x, nz)) { me.z = nz; me.vx = 0; }
      else { me.vx = me.vz = 0; walkTarget = null; marker.visible = false; }
      me.speed = Math.hypot(me.vx, me.vz);
      if (me.speed > 0.3) me.ry = lerpAngle(me.ry, Math.atan2(me.vx, me.vz), 1 - Math.exp(-14 * dt));
    }
    const flying = ride && ride.kind === "air" && (ride.altitude || 0) > 20;
    myAvatar.group.position.set(me.x, 0, me.z);
    myAvatar.group.rotation.y = me.ry;
    myAvatar.root.visible = !ride;
    myAvatar.group.position.y = ride ? ride.pos.y + (ride.kind === "air" ? 0.6 : 1.2) : 0;
    myAvatar.update(dt, me.speed);
    if (marker.visible) marker.scale.setScalar(1 + Math.sin(t * 6) * 0.12);
    net.setState({ x: me.x, z: me.z, ry: me.ry, vx: me.vx, vz: me.vz });

    // ほかの人：届いた位置＋速度から少し先を予測して、なめらかに追いかける
    for (const p of peers.values()) {
      if (!p.s) continue;
      const age = Math.min(0.6, (now - p.recvAt) / 1000);
      const tx = p.s.x + (p.s.vx || 0) * age, tz = p.s.z + (p.s.vz || 0) * age;
      const kk = 1 - Math.exp(-8 * dt);
      const ox = p.x, oz = p.z;
      if (Math.hypot(tx - p.x, tz - p.z) > 25) { p.x = tx; p.z = tz; }
      else { p.x += (tx - p.x) * kk; p.z += (tz - p.z) * kk; }
      p.speed = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3);
      if (p.speed > 0.3) p.ry = lerpAngle(p.ry, Math.atan2(p.x - ox, p.z - oz), 1 - Math.exp(-10 * dt));
      else if (p.s.ry != null) p.ry = lerpAngle(p.ry, p.s.ry, 1 - Math.exp(-6 * dt));
      p.av.group.position.set(p.x, 0, p.z);
      p.av.group.rotation.y = p.ry;
      p.av.update(dt, p.speed);
    }

    // カメラ
    const camY = ride ? ride.pos.y + 1.6 : 1.6;
    if (ride && Math.hypot(camTarget.x - me.x, camTarget.z - me.z) > 60) camTarget.set(me.x, camY, me.z);
    camTarget.lerp(new THREE.Vector3(me.x, camY, me.z), 1 - Math.exp(-10 * dt));
    let dist = 21 * zoom + (ride ? (ride.kind === "train" ? 10 : ride.kind === "ship" ? 18 : 30 + (ride.altitude || 0) * 1.4) : 0);
    // 会話中はカメラがふたりに寄る（肩ごしに、話し相手を見る画角）
    talkBlend += ((dialog.open ? 1 : 0) - talkBlend) * (1 - Math.exp(-4 * dt));
    let camYaw = yaw, camPitch = pitch, look = camTarget;
    if (talkBlend > 0.002 && talkWith) {
      const b = talkBlend * talkBlend * (3 - 2 * talkBlend);
      const nx = talkWith.x, nz = talkWith.z;
      const tx = me.x + (nx - me.x) * 0.55, tz = me.z + (nz - me.z) * 0.55;
      const away = Math.atan2(me.x - nx, me.z - nz);           // 話し相手から見た自分の方向
      look = new THREE.Vector3(camTarget.x + (tx - camTarget.x) * b, camTarget.y + (1.45 - camTarget.y) * b, camTarget.z + (tz - camTarget.z) * b);
      dist += (6.2 - dist) * b;
      camPitch += (0.2 - camPitch) * b;
      camYaw = lerpAngle(yaw, away + 0.62, b);
    }
    camPos.set(
      look.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
      look.y + Math.sin(camPitch) * dist,
      look.z + Math.cos(camYaw) * Math.cos(camPitch) * dist,
    );
    camera.position.copy(camPos);
    camera.lookAt(look);
    sun.position.set(me.x + 28, 52, me.z + 18);
    sun.target.position.set(me.x, 0, me.z);

    W.update(dt, t, me.x, me.z);
    townGuide.update(dt, me, (x, z) => W.walkable(x, z));
    guideT += dt;
    if (guideT > 1 && !ride && !dialog.open) { guideT = 0; placeGuide(); }
    const nearGuide = townGuide.group.visible && !ride && !dialog.open && !anyModalOpen() && townGuide.distTo(me.x, me.z) < 4.5;
    if ($("#talkBtn").hidden === nearGuide) $("#talkBtn").hidden = !nearGuide;
    ensureT += dt;
    const fastSea = ride && ride.kind === "ship" && ride.speed > 150;
    if (ensureT > 0.7 && !flying && !fastSea) {
      ensureT = 0;
      W.ensureAround(me.x, me.z).catch((e) => console.warn(e));
      transport.update(me.x, me.z);
      // 地域（部屋）の切りかえ
      const area = W.tileKeyAt(me.x, me.z);
      if (area !== currentArea && W.isReady(me.x, me.z)) { currentArea = area; net.setRoom?.(area); }
    }
    rideBtnT += dt;
    if (rideBtnT > 0.3) { rideBtnT = 0; updateRideButton(); }
    // 空の上では遠くまで見えるように
    const high = ride && (ride.altitude || 0) > 15;
    // 会話中は低い画角で遠くまで見えてしまい重くなるので、遠くをかすませて描かない
    const talkView = talkBlend > 0.02 && talkWith;
    const fogFar = high ? 2600 : talkView ? 115 : 430, fogNear = high ? 700 : talkView ? 40 : 150;
    scene.fog.far += (fogFar - scene.fog.far) * Math.min(1, dt * 2.5);
    scene.fog.near += (fogNear - scene.fog.near) * Math.min(1, dt * 2.5);
    const sc = W.sea.scale.x + ((high ? 4 : 1) - W.sea.scale.x) * Math.min(1, dt * 2);
    W.sea.scale.set(sc, sc, 1);
    const far = talkView ? scene.fog.far + 10 : Math.max(1200, scene.fog.far * 1.8);
    W.sky.scale.setScalar(Math.min(sc, (far * 0.92) / 900));   // 空は描く範囲の内側に
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    detailT += dt;
    if (talkView && detailT > 0.5) { detailT = 0; W.setDetailRadius(me.x, me.z, 70); }
    else if (!talkView && W._detailHidden) W.setDetailRadius(0, 0, null);

    placeBubble(selfTarget, me.x, me.z, myAvatar.cfg.height);
    for (const p of peers.values()) {
      if (p.bubble) { if (blocked.has(p.id) || !p.s) p.bubble.el.hidden = true; else placeBubble(p, p.x, p.z, p.av.cfg.height); }
    }

    updateShopCard();
    const area = W.areaAt(me.x, me.z);
    if (area && area.code !== lastArea?.code) {
      $("#areaChip").textContent = `${area.pref} ${area.name}`;
      if (lastArea && !warping && !ride) toast(area.pref !== lastArea.pref ? `${area.pref}${area.name}に入りました` : `${area.name}に入りました`);
      lastArea = area;
    }
    minimap.draw(me, [...peers.values()].filter((p) => p.s && !blocked.has(p.id)).map((p) => ({ x: p.x, z: p.z, bot: p.bot })));
    saveT += dt;
    if (saveT > 3 && !ride) { saveT = 0; store.set("pos", { x: me.x, z: me.z, ry: me.ry }); }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    minimap.resize();
  });



  // ------------------------------------------------------------ 乗り物
  let ride = null;
  let nearRide = null;
  const rideBtn = $("#rideBtn");
  const RIDE_LABEL = { train: "🚃 電車に乗る", air: "✈ 飛行機に乗る", port: "⛴ 船に乗る" };
  function updateRideButton() {
    nearRide = ride || anyModalOpen() ? null : transport.nearby(me.x, me.z);
    rideBtn.hidden = !nearRide;
    if (nearRide) rideBtn.textContent = `${RIDE_LABEL[nearRide.kind]}（${nearRide.item.name}${nearRide.kind === "train" ? "駅" : ""}）`;
  }
  rideBtn.addEventListener("click", () => { if (nearRide) openRideMenu(nearRide); });

  function openRideMenu(near) {
    if (near.kind === "train") return openTrainMenu(near);
    if (near.kind === "air") {
      const from = near.item;
      const list = transport.airports.filter((a) => a !== from).map((a) => ({ a, d: Math.hypot(a.pos[0] - from.pos[0], a.pos[1] - from.pos[1]) })).sort((p, q) => p.d - q.d);
      const m = openModal(`<h2>✈ ${esc(from.name)}</h2><p class="lead">行き先の空港をえらんでね。</p>
        <div class="ride-list">${list.map(({ a, d }) => `<button type="button" class="ride-item" data-id="${esc(a.id)}"><b>${esc(a.name)}</b><small>約${Math.round((d * 40) / 1000)}km</small></button>`).join("")}</div>`);
      m.el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-id]");
        if (!b) return;
        m.close();
        startFlight(from, transport.airports.find((a) => a.id === b.dataset.id));
      });
      return;
    }
    const port = near.item;
    const routes = transport.routes.filter((r) => r.fromPort === port || r.toPort === port);
    const m = openModal(`<h2>⛴ ${esc(port.name)}</h2><p class="lead">乗る船をえらんでね。</p>
      <div class="ride-list">${routes.map((r, i) => { const to = r.fromPort === port ? r.toPort : r.fromPort; return `<button type="button" class="ride-item" data-i="${i}"><b>${esc(to.name)} 行き</b><small>${esc(r.name)}</small></button>`; }).join("")}</div>`);
    m.el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (!b) return;
      m.close();
      startShip(routes[+b.dataset.i], port);
    });
  }

  function openTrainMenu(near) {
    const st = near.item;
    const lines = near.lines;
    let cur = lines[0];
    const normSt = (v) => String(v || "").normalize("NFKC").replace(/\s+/g, "").replace(/駅$/, "");
    // この駅から乗りかえなしで行ける駅（全部の路線）
    const reachable = () => {
      const out = [];
      for (const id of lines) {
        const { order, idx } = transport.lineInfo(id, st);
        order.forEach((o, i) => { if (i !== idx) out.push({ line: id, i, name: o[0] }); });
      }
      return out;
    };
    const render = () => {
      const { order, idx, info } = transport.lineInfo(cur, st);
      const before = order.slice(0, idx).map((o, i) => ({ o, i })).reverse();
      const after = order.slice(idx + 1).map((o, i) => ({ o, i: idx + 1 + i }));
      const dirBtn = (arr, label) => arr.length ? `<h4>${esc(label)}</h4><div class="ride-list">${arr.map(({ o, i }) => `<button type="button" class="ride-item" data-dest="${i}"><b>${esc(o[0])}</b><small>${Math.abs(i - idx)}駅</small></button>`).join("")}</div>` : "";
      const names = [...new Set(reachable().map((r) => r.name))];
      return `<h2>🚃 ${esc(st.name)}駅</h2>
        <form class="dest-form" id="destForm" autocomplete="off">
          <label class="field"><b>行き先の駅名を入れる</b>
            <div class="dest-row"><input id="destInput" list="destList" placeholder="例：新宿" enterkeyhint="go"><button class="btn primary" type="submit">この駅まで乗る</button></div>
            <small>この駅から乗りかえなしで行ける駅が候補に出ます。</small></label>
          <datalist id="destList">${names.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
        </form>
        <div class="seg ride-lines">${lines.map((id) => `<button type="button" data-line="${esc(id)}" aria-pressed="${id === cur}"><i style="background:${esc(transport.index.lines[id]?.color || "#999")}"></i>${esc(transport.index.lines[id]?.name || id)}</button>`).join("")}</div>
        <p class="lead">${esc(info?.name || "")}の行き先をえらんでね。${info?.approx ? "（この路線は、駅と駅をまっすぐ走ります）" : ""}</p>
        ${dirBtn(after, `${after.length ? after[after.length - 1].o[0] : ""} 方面`)}
        ${dirBtn(before, `${before.length ? before[before.length - 1].o[0] : ""} 方面`)}`;
    };
    const m = openModal(render());
    const box = m.el.querySelector(".modal");
    const goTyped = () => {
      const q = normSt($("#destInput", m.el)?.value);
      if (!q) return toast("行き先の駅名を入れてください");
      if (q === normSt(st.name)) return toast("いまいる駅です");
      const all = reachable();
      // 完全に一致 → 前方一致 → 部分一致の順でさがす（いま選んでいる路線を優先）
      const pick = (f) => all.filter((r) => f(normSt(r.name))).sort((x, y) => (x.line === cur ? 0 : 1) - (y.line === cur ? 0 : 1))[0];
      const hit = pick((n) => n === q) || pick((n) => n.startsWith(q)) || pick((n) => n.includes(q));
      if (hit) { m.close(); startTrain(hit.line, st, hit.i); return; }
      // 乗りかえが必要な駅：ワープを提案
      const far = searchPlaces(index, [], q).find((r) => r.kind === "station");
      m.close();
      if (!far) { toast(`「${q}」という駅が見つかりませんでした`); return; }
      const c = openModal(`<h2>${esc(far.label)}</h2>
        <p class="lead">${esc(st.name)}駅からは、乗りかえなしでは行けない駅です。${esc(far.label)}へワープしますか？</p>
        <div class="row-end"><button class="btn" type="button" data-x="no">やめる</button><button class="btn primary" type="button" data-x="go">ワープする</button></div>`);
      c.el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-x]");
        if (!b) return;
        c.close();
        if (b.dataset.x === "go") teleport(far.x, far.z, `${far.label}に着きました`, { station: far.station });
      });
    };
    const bindForm = () => $("#destForm", m.el)?.addEventListener("submit", (e) => { e.preventDefault(); goTyped(); });
    bindForm();
    m.el.addEventListener("click", (e) => {
      const lb = e.target.closest("[data-line]");
      if (lb) { cur = lb.dataset.line; box.innerHTML = '<button class="close-x" type="button" aria-label="閉じる">✕</button>' + render(); box.querySelector(".close-x").addEventListener("click", m.close); bindForm(); return; }
      const db = e.target.closest("[data-dest]");
      if (db) { m.close(); startTrain(cur, st, +db.dataset.dest); }
    });
  }

  function beginRide(r, label) {
    if (ride) { const old = ride; old.onEnd = () => {}; old.finish(); }
    ride = r;
    card.hidden = true; cardShop = null;
    $("#rideHud").hidden = false;
    $("#rideTitle").textContent = label;
    $("#rideOff").hidden = r.kind !== "train";
    rideBtn.hidden = true;
    $("#joystick").hidden = true;
    guide.close();
    myAvatar.emote();
  }
  async function endRide(x, z, label, opts) {
    $("#rideHud").hidden = true;
    ride = null;
    if (matchMedia("(pointer: coarse)").matches) $("#joystick").hidden = false;
    await teleport(x, z, label, { ...(opts || {}), fromRide: true });
  }
  $("#rideOff").addEventListener("click", () => {
    if (!ride) return;
    ride.getOffNext = true;
    $("#rideOff").textContent = "次で降ります";
    $("#rideOff").disabled = true;
  });

  function startTrain(lineId, st, destIdx) {
    const { order, idx, info } = transport.lineInfo(lineId, st);
    if (idx < 0 || destIdx === idx) return;
    const step = destIdx > idx ? 1 : -1;
    let k = idx;
    const shin = info?.kind === "shinkansen";
    $("#rideOff").textContent = "次で降りる";
    $("#rideOff").disabled = false;
    const r = new Ride(scene, {
      kind: "train", color: shin ? "#2f6fdb" : info?.color, shinkansen: shin, speed: shin ? 110 : 40,
      nextLeg: async () => {
        if (k === destIdx) return null;
        const a = order[k], b = order[k + step];
        k += step;
        await W.ensureAround(b[1], b[2], 300).catch(() => {});
        const path = W.railPath(lineId, [a[1], a[2]], [b[1], b[2]]) || [[a[1], a[2]], [b[1], b[2]]];
        return { pts: path, stopName: b[0], last: k === destIdx, elevated: shin };
      },
      onStop: (name) => logSystem(`${name}駅に着きました`),
      onEnd: (leg) => { const o = order[k]; endRide(o[1], o[2], `${o[0]}駅で降りました`, { station: o[0] }); },
    });
    beginRide(r, `${info?.name || "電車"}　${st.name} → ${order[destIdx][0]}`);
  }

  function startFlight(from, to) {
    const f1 = runwayVec(from), f2 = runwayVec(to);
    const p = (a, v, d) => [a.pos[0] + v[0] * d, a.pos[1] + v[1] * d];
    const pts = [p(from, f1, -30), p(from, f1, 40), p(from, f1, 160), p(to, f2, -260), p(to, f2, -40), p(to, f2, 28)];
    const L = pts.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
    let flown = false;
    const r = new Ride(scene, {
      kind: "air", speed: Math.max(160, L / 20),
      nextLeg: async () => (flown ? null : ((flown = true), { pts, stopName: to.name, last: true })),
      onEnd: async () => {
        await W.ensureAround(to.pos[0], to.pos[1]).catch(() => {});
        transport.update(to.pos[0], to.pos[1]);
        const f = to.front || [to.pos[0] + Math.cos(((to.dir || 0) * Math.PI) / 180) * 16, to.pos[1] + Math.sin(((to.dir || 0) * Math.PI) / 180) * 16];
        endRide(f[0], f[1], `${to.name}に着きました`);
      },
    });
    r.dest = to.pos;
    beginRide(r, `✈ ${from.name} → ${to.name}`);
  }
  function runwayVec(a) { const d = ((a.dir || 0) * Math.PI) / 180; return [Math.sin(d), -Math.cos(d)]; }

  function startShip(route, port) {
    const forward = route.fromPort === port;
    const pts = forward ? route.pts : route.pts.slice().reverse();
    const to = forward ? route.toPort : route.fromPort;
    const L = pts.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
    let sailed = false;
    const r = new Ride(scene, {
      kind: "ship", speed: Math.min(420, Math.max(30, L / 28)),
      nextLeg: async () => (sailed ? null : ((sailed = true), { pts, stopName: to.name, last: true })),
      onEnd: async () => {
        await W.ensureAround(to.pos[0], to.pos[1]).catch(() => {});
        transport.update(to.pos[0], to.pos[1]);
        const f = to.front || to.pos;
        endRide(f[0], f[1], `${to.name}に着きました`);
      },
    });
    r.dest = to.pos;
    beginRide(r, `⛴ ${route.name}　${port.name} → ${to.name}`);
  }

  // ------------------------------------------------------------ モード・みんなの投稿
  function setMode(m) {
    mode = m;
    store.set("mode", m);
    W.setMode(m);
    document.querySelectorAll("#modeBar [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    $("#legend").innerHTML = MODES[m].kinds.map((k) => `<span><i style="background:${KINDS[k].color}"></i>${esc(KINDS[k].short)}</span>`).join("");
    $("#btnPost").hidden = m === "research";
    card.hidden = true; cardShop = null; dismissed = null;
    minimap.dirty = true;
  }

  async function loadCommunity() {
    try {
      const posts = await net.listCommunity();
      W.setShops([...ownShops, ...posts]);
      W.setMode(mode);
      minimap.dirty = true;
    } catch (e) { console.warn(e); }
  }

  function setupModesAndPosts() {
    $("#modeBar").addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]");
      if (b?.dataset.mode === "ranking") openRanking();
      if (!b || b.dataset.mode === mode) return;
      setMode(b.dataset.mode);
      toast(`${MODES[mode].label}：${MODES[mode].note}`, 3500);
    });
    setMode(mode);
    loadCommunity();
    $("#btnPost").addEventListener("click", openPostForm);
    // ほかの人の投稿がリアルタイムで届いたら、すぐ町に建てる
    net.on("shop", () => { loadCommunity(); refreshMyPosts(); });
    refreshMyPosts();
  }

  function openPostForm() {
    if (!isMember()) { openJoin("お店を投稿するには、アカウントをつくってください"); return; }
    const [lat, lng] = proj.latlng(me.x, me.z);
    const area = W.areaAt(me.x, me.z);
    const here = `${area ? area.pref + area.name + "・" : ""}${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const online = net.mode === "online";
    const m = openModal(postFormHTML({ here, online, nickname: profile.name, guide: REVIEW_GUIDE }));
    const f = $("#postForm", m.el);
    // 建てる場所：線路・駅・道路・川・ほかのお店にかぶるところには建てられない
    const readWhere = () => {
      if (f.querySelector("input[name=pWhere]:checked").value !== "coords") return { lat, lng };
      const mm = $("#pCoords", m.el).value.match(/(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)/);
      if (!mm) return null;
      let a = +mm[1], b = +mm[2];
      if (a > 90) [a, b] = [b, a];
      return { lat: a, lng: b };
    };
    let siteFix = null;
    const checkSite = async () => {
      const box = $("#pSite", m.el), fixBtn = $("#pSiteFix", m.el);
      const w = readWhere();
      siteFix = null;
      if (!w) { box.hidden = true; return null; }
      const [x, z] = proj.xz(w.lat, w.lng);
      await W.ensureAround(x, z, 60);
      const why = W.siteIssue(x, z);
      box.hidden = !why;
      if (!why) return null;
      const p = W.findSite(x, z, 40);
      if (p) siteFix = proj.latlng(p[0], p[1]);
      $("#pSiteText", m.el).textContent = `この場所には建てられません（${why}）。` + (siteFix ? "" : "少しはなれた場所で投稿してください。");
      fixBtn.hidden = !siteFix;
      return why;
    };
    $("#pSiteFix", m.el).addEventListener("click", () => {
      if (!siteFix) return;
      f.querySelector("input[name=pWhere][value=coords]").checked = true;
      $("#pCoords", m.el).hidden = false;
      $("#pCoords", m.el).value = `${siteFix[0].toFixed(6)}, ${siteFix[1].toFixed(6)}`;
      checkSite();
    });
    $("#pCoords", m.el).addEventListener("change", checkSite);
    f.querySelectorAll("input[name=pWhere]").forEach((r) => r.addEventListener("change", () => {
      $("#pCoords", m.el).hidden = f.querySelector("input[name=pWhere]:checked").value !== "coords";
      checkSite();
    }));
    checkSite();
    const showReview = () => {
      const v = $("#pComment", m.el).value, box = $("#pReviewCheck", m.el);
      $("#pCount", m.el).textContent = `${[...v].length} / 200`;
      const r = checkReview(v);
      box.hidden = r.ok;
      if (!r.ok) box.textContent = `「${r.word}」は${r.why}にあたるため、このままでは投稿できません。感じたことを、人やお店を傷つけない言葉で書き直してください。`;
    };
    $("#pComment", m.el).addEventListener("input", showReview);
    $("#pSns", m.el).addEventListener("input", (e) => {
      const v = e.target.value.trim(), box = $("#pSnsCheck", m.el);
      const sns = parseSns(v);
      box.hidden = !v;
      box.className = "sns-check " + (sns ? "ok" : "ng");
      box.textContent = sns ? `${sns.emoji} ${sns.label}の投稿をいっしょに表示します` : "対応しているSNSの投稿リンクではないようです（空欄でも投稿できます）";
    });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nick = profile.name;
      const name = $("#pName", m.el).value.replace(/\s+/g, " ").trim();
      if (!name) return toast("お店の名前を入れてください");
      const raw = $("#pComment", m.el).value;
      if ([...raw.trim()].length < 10) return toast("口コミは10文字以上で書いてください");
      const rc = checkReview(raw + " " + name);
      if (!rc.ok) { showReview(); return toast(`「${rc.word}」は${rc.why}にあたるため投稿できません`, 5000); }
      const comment = cleanReview(raw, 200);
      let snsUrl = null;
      const snsRaw = $("#pSns", m.el).value.trim();
      if (snsRaw) {
        const sns = parseSns(snsRaw);
        if (!sns) return toast("SNS投稿のリンクを確認してください（なければ空欄のままで投稿できます）", 4500);
        snsUrl = sns.url.replace(/[?&](igsh|igshid|si|utm_[a-z]+|_r|is_from_webapp|sender_device)=[^&]*/g, "").replace(/\?$/, "");
      }
      let plat = lat, plng = lng;
      if (f.querySelector("input[name=pWhere]:checked").value === "coords") {
        const mm = $("#pCoords", m.el).value.match(/(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)/);
        if (!mm) return toast("「35.54132, 139.44836」のように緯度・経度を入れてください");
        plat = +mm[1]; plng = +mm[2];
        if (plat > 90) [plat, plng] = [plng, plat];
      }
      const [x, z] = proj.xz(plat, plng);
      await W.ensureAround(x, z);
      if (!W.isLand(x, z)) return toast("その場所は日本の陸地ではないようです");
      const why = await checkSite();
      if (why) return toast(`この場所には建てられません（${why}）。「近くの空き地にずらす」を押すか、場所を変えてください`, 5500);
      const btn = $("#pSend", m.el);
      btn.disabled = true;
      btn.textContent = "送信中…";
      try {
        await net.submitCommunity({ author: nick, name, genre: $("#pGenre", m.el).value, lat: +plat.toFixed(6), lng: +plng.toFixed(6), comment, snsUrl });
        m.close();
        await loadCommunity();
        refreshMyPosts();
        if (mode === "research") setMode("community");
        const p = findWalkable(x, z + 5.5, 12);
        if (p) { me.x = p[0]; me.z = p[1]; me.ry = Math.PI; }
        myAvatar.emote();
        toast(online ? "投稿しました。みんなの町にも、いま建ちました" : "テスト投稿しました（この端末にだけ表示されます）", 5000);
      } catch (ex) {
        toast(ex.message, 5000);
        btn.disabled = false;
        btn.textContent = "投稿する";
      }
    });
  }

  // ご意見（解消してほしい点・追加してほしい要素）を送る。送った内容は Supabase → 会員シート「要望」に記録
  function openFeedback() {
    const area = W.areaAt(me.x, me.z);
    const [lat, lng] = proj.latlng(me.x, me.z);
    const here = area ? `${area.pref}${area.name}` : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    let mine = [];
    try { mine = JSON.parse(localStorage.getItem("machimania.feedbackMine") || "[]"); } catch { /* なし */ }
    const online = net.mode === "online";
    const m = openModal(feedbackFormHTML({ online, nickname: isMember() ? profile.name : "", here, mine }));
    const f = $("#fbForm", m.el);
    $("#fbBody", m.el).addEventListener("input", (e) => { $("#fbCount", m.el).textContent = `${[...e.target.value].length} / 600`; });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const kind = f.querySelector("input[name=fbKind]:checked")?.value;
      if (!kind) return toast("「解消してほしい点」か「追加してほしい要素」を選んでください");
      const body = $("#fbBody", m.el).value.replace(/\s+\n/g, "\n").trim().slice(0, 600);
      if ([...body].length < 4) return toast("内容をもう少しくわしく書いてください");
      const rc = checkReview(body);
      if (!rc.ok) return toast(`「${rc.word}」は${rc.why}にあたるため送れません。書き直してください`, 5000);
      const withWhere = $("#fbWhere", m.el).checked;
      const btn = $("#fbSend", m.el);
      btn.disabled = true; btn.textContent = "送信中…";
      try {
        await net.sendFeedback({
          kind, body, nickname: isMember() ? profile.name : "ゲスト",
          area: withWhere ? here : null, lat: withWhere ? +lat.toFixed(5) : null, lng: withWhere ? +lng.toFixed(5) : null,
          device: `${innerWidth}x${innerHeight} ${/Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? "スマホ" : "PC"}`,
        });
        mine.push({ kind, body: body.slice(0, 120), at: new Date().toLocaleDateString("ja-JP") });
        try { localStorage.setItem("machimania.feedbackMine", JSON.stringify(mine.slice(-30))); } catch { /* なし */ }
        m.close();
        myAvatar.emote();
        toast(kind === "fix" ? "ありがとうございます！ 解消してほしい点として受けつけました" : "ありがとうございます！ 追加してほしい要素として受けつけました", 4500);
      } catch (ex) {
        toast(ex.message, 5000);
        btn.disabled = false; btn.textContent = "送る";
      }
    });
  }

  function openSnsPost(s) {
    const sns = parseSns(s.snsUrl);
    if (!sns) return;
    openModal(`<h2>${esc(s.name)}</h2>
      <p class="lead">${esc(s.author || "")} さんの ${esc(sns.label)} の投稿です。</p>
      ${sns.embed ? `<div class="sns-frame${sns.tall ? " tall" : ""}"><iframe src="${esc(sns.embed)}" title="${esc(sns.label)}の投稿" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ""}
      <p class="note">表示されないときは、元の投稿が非公開か削除されています。</p>
      <div class="row-end"><a class="btn primary" href="${esc(safeUrl(sns.url))}" target="_blank" rel="noopener">${esc(sns.label)}で開く</a></div>`);
  }


  logSystem(net.mode === "online" ? "オンラインでつながりました" : "テストモードです（別のタブで開くと、もう1人として会えます）");
  // ゲストには、登録のかんたんさを伝える
  if (!isMember()) {
    $("#chatInput").placeholder = "登録するとチャットできます（ニックネームとパスワードだけ）";
    logSystem("いまはゲスト（見学）です。ニックネームとパスワードだけで、いつでも登録できます。登録するとチャットとお店の投稿ができます");
    if (guestMode) setTimeout(() => toast("ゲストで見学中です。ニックネームとパスワードだけで登録すると、チャットと投稿ができます（右上の🔑から）", 7000), 2500);
  }
  setupModesAndPosts();
  setupNews();

  // ------------------------------------------------------------ まちの案内人（どの市区町村にも、駅前に同じ人がいる）
  function placeGuide() {
    const area = W.areaAt(me.x, me.z);
    const code = area ? area.pref + area.name : W.tileKeyAt(me.x, me.z);
    const far = townGuide.group.visible ? townGuide.distTo(me.x, me.z) : Infinity;
    if (townGuide.areaCode === code && far < 260) return;
    // いちばん近い駅の駅前（同じ市区町村の中）。なければ自分の少し先
    let best = null, bd = Infinity;
    for (const st of W.stations) {
      const p = st.front || st.pos;
      const d = Math.hypot(p[0] - me.x, p[1] - me.z);
      if (d > 240 || d >= bd) continue;
      const a = W.areaAt(p[0], p[1]);
      if (area && (!a || a.code !== area.code)) continue;
      bd = d; best = p;
    }
    let pos = best ? findWalkable(best[0] + 3, best[1] + 2, 12) : null;
    if (!pos) pos = findWalkable(me.x + Math.sin(me.ry) * 9, me.z + Math.cos(me.ry) * 9, 15);
    if (pos) townGuide.place(pos[0], pos[1], code);
  }

  function townFacts() {
    const area = W.areaAt(me.x, me.z);
    const name = area ? `${area.pref}${area.name}` : "このあたり";
    const near = [];
    for (const s of index.stations) {
      const d = Math.hypot(s.p[0] - me.x, s.p[1] - me.z);
      if (d > 220) continue;
      const a = W.areaAt(s.p[0], s.p[1]);
      if (area && a && a.code !== area.code) continue;
      near.push({ s, d });
    }
    near.sort((a, b) => a.d - b.d);
    const lines = [...new Set(near.flatMap((n) => n.s.l))];
    const shops = W.shopObjs.map((o) => ({ o, d: Math.hypot(o.x - me.x, o.z - me.z) })).filter((x) => x.d < 900).sort((a, b) => a.d - b.d);
    const port = transport.ports?.find?.((p) => Math.hypot(p.pos[0] - me.x, p.pos[1] - me.z) < 400);
    const air = transport.airports?.find?.((p) => Math.hypot(p.pos[0] - me.x, p.pos[1] - me.z) < 500);
    return { area, name, stations: near.map((n) => n.s.n), lines, shops, port, air };
  }

  async function startTalk() {
    if (dialog.open || ride) return;
    talkWith = townGuide;
    townGuide.talking = true;
    townGuide.cheer();
    walkTarget = null; marker.visible = false;
    me.ry = Math.atan2(townGuide.x - me.x, townGuide.z - me.z);
    card.hidden = true; cardShop = null;
    $("#talkBtn").hidden = true;
    guide.close();
    dialog.show(GUIDE_NAME);
    setTags(false);
    const who = isMember() ? `${profile.name}さん` : "ゲストさん";
    const f = townFacts();
    try {
      await dialog.say(`あっ、${who}！ こんにちは。\nわたしは案内人の${GUIDE_NAME}。${f.name}へようこそ！`);
      let first = true;
      for (;;) {
        const pick = await dialog.say(first ? "なにか聞きたいことはある？" : "ほかに聞きたいことはある？", [
          { label: "この町のこと", value: "town" },
          { label: "近くのお店", value: "shops" },
          { label: "あそびかた", value: "howto" },
          { label: "またね", value: "bye" },
        ]);
        first = false;
        if (pick === "town") await talkTown(f);
        else if (pick === "shops") { const go = await talkShops(f); if (go) return; }
        else if (pick === "howto") await talkHowto();
        else break;
      }
      await dialog.say(`またいつでも話しかけてね。${f.area ? f.area.name : "このまち"}を楽しんで！`);
    } finally {
      dialog.hide();
      setTags(true);
      townGuide.talking = false;
      setTimeout(() => { if (!dialog.open) talkWith = null; }, 1200);
    }
  }

  // 会話中は名札をかくして、ふたりが見えるようにする
  function setTags(on) {
    if (myAvatar.tag) myAvatar.tag.visible = on;
    if (myAvatar.navi) myAvatar.navi.hiddenForTalk = !on;
    for (const p of peers.values()) if (p.av.tag) p.av.tag.visible = on;
    townGuide.tag.visible = on;
  }

  async function talkTown(f) {
    const season = SEASON_NAME;
    if (f.stations.length) {
      await dialog.say(`${f.name}には、${f.stations.slice(0, 3).join("駅、")}駅${f.stations.length > 3 ? `など、${f.stations.length}の駅` : ""}があるよ。`);
      if (f.lines.length) await dialog.say(`走っているのは ${f.lines.slice(0, 4).join("・")}${f.lines.length > 4 ? " など" : ""}。駅の前で「電車に乗る」を押すと、線路をたどって旅ができるんだ。`);
    } else {
      await dialog.say(`${f.name}は、駅から少しはなれた静かなところだね。`);
    }
    if (f.air) await dialog.say(`近くに${f.air.name}があるよ。飛行機で日本の空を飛べるんだ！`);
    if (f.port) await dialog.say(`${f.port.name}からは船も出ているよ。`);
    const kinds = { youtube: 0, new: 0, old: 0, community: 0 };
    for (const x of f.shops) kinds[x.o.kind] = (kinds[x.o.kind] || 0) + 1;
    const total = f.shops.length;
    await dialog.say(total
      ? `このまわりには、いま${total}軒のお店が建っているよ。${kinds.youtube ? `まちマニア横塚さんの動画のお店が${kinds.youtube}軒、` : ""}${kinds.new ? `新しいお店が${kinds.new}軒、` : ""}${kinds.community ? `みんなの口コミのお店が${kinds.community}軒` : ""}あるんだ。`
      : "このまわりには、まだお店が建っていないんだ。行ったお店があったら、口コミを投稿して最初のお店を建ててみて！");
    if (season) await dialog.say(`いまは${season}。木や花の色も、季節に合わせて変わっているでしょ？`);
  }

  async function talkShops(f) {
    const list = f.shops.slice(0, 3);
    if (!list.length) {
      await dialog.say("近くにはまだお店がないんだ。右上の「お店」ボタンで、全国のお店をさがせるよ。");
      return false;
    }
    const lines = list.map((x) => `・${x.o.shop.name}（${KINDS[x.o.kind]?.short || ""}、${x.d < 60 ? "すぐそこ" : `${Math.round((x.d * 40) / 100) / 10}km`}）`).join("\n");
    const pick = await dialog.say(`近くのおすすめはこのあたり！\n${lines}`, [
      ...list.map((x, i) => ({ label: `${x.o.shop.name}へ行く`, value: "s" + i })),
      { label: "もどる", value: "back" },
    ]);
    if (!pick || pick === "back") return false;
    const o = list[+pick.slice(1)].o;
    await dialog.say(`${o.shop.name}だね。いってらっしゃい！`);
    dialog.hide();
    setTags(true);
    townGuide.talking = false;
    talkWith = null;
    const fa = ((o.shop.facing || 0) * Math.PI) / 180;
    dismissed = null;
    await teleport(o.x + Math.sin(fa) * 5.5, o.z + Math.cos(fa) * 5.5, `${o.shop.name} に着きました`);
    me.ry = fa + Math.PI;
    return true;
  }

  async function talkHowto() {
    const touch = matchMedia("(pointer: coarse)").matches;
    const pages = [
      touch ? "行きたい場所をタップすると、そこまで歩くよ。左下のスティックでも歩けるんだ。" : "行きたい場所をクリックすると歩くよ。WASD や矢印キーでも歩けて、Shift で走れるんだ。",
      touch ? "1本指でなぞるとカメラが回って、2本指でつまむとズームできるよ。" : "ドラッグでカメラを回して、ホイールでズームできるよ。",
      "お店に近づくと説明が出るよ。黄色はまちマニア横塚さんの動画のお店、赤は新しいお店、紫は開店1年以上、青はみんなの口コミのお店！",
      "左の「新店のお知らせ」に、毎日見つかった新しいお店が出るよ。「ワープ」を押すと、そのお店の前にひとっとび！",
      "駅・空港・港では乗り物に乗れるよ。電車は行き先の駅名を入れてもいいんだ。",
      isMember() ? "行ったお店があったら「投稿」で口コミを書いてね。チャットで近くの人と話すこともできるよ。" : "ニックネームとパスワードだけで登録すると、口コミの投稿やチャットができるようになるよ。右上の🔑からどうぞ！",
      "わからなくなったら、右上の「？」でナビにも聞けるからね。",
    ];
    for (const p of pages) await dialog.say(p);
  }

  // ------------------------------------------------------------ 新店のお知らせ（毎日の新店リサーチで増えた店）
  function setupNews() {
    const box = $("#news"), list = $("#newsList"), toggle = $("#newsToggle"), badge = $("#newsBadge");
    const items = (researchData.shops || [])
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .sort((a, b) => String(b.found || "").localeCompare(String(a.found || "")) || String(b.opened || "").localeCompare(String(a.opened || "")))
      .slice(0, 40);
    box.hidden = false;
    const seen = new Set(store.get("newsSeen") || []);
    const today = Date.now();
    const md = (d) => { const m = String(d || "").match(/^\d{4}-(\d{2})-(\d{2})/); return m ? `${+m[1]}/${+m[2]}` : ""; };
    if (!items.length) {
      list.innerHTML = `<li class="news-empty">新しいお店が見つかると、ここでお知らせします。</li>`;
    } else {
      list.innerHTML = items.map((s) => {
        const g = GENRES[s.genre] || GENRES.other;
        const opened = s.opened ? (Date.parse(s.opened) > today ? `${md(s.opened)}オープン予定` : `${md(s.opened)}オープン`) : "";
        const fresh = !seen.has(s.id) && s.found && today - Date.parse(s.found) < 7 * 86400000;
        return `<li class="news-item">
          <span class="em" aria-hidden="true">${g.emoji}</span>
          <span class="t"><b>${fresh ? `<span class="new">NEW</span>` : ""}${esc(s.name)}</b><small>${esc([s.pref, s.city].filter(Boolean).join(" ") || g.label)}${opened ? "・" + esc(opened) : ""}</small></span>
          <button type="button" class="btn sun go" data-warp="${esc(s.id)}" aria-label="${esc(s.name)}へワープ">ワープ</button>
        </li>`;
      }).join("");
    }
    const unseen = items.filter((s) => !seen.has(s.id)).length;
    const setBadge = (n) => { badge.hidden = !n; badge.textContent = n > 99 ? "99+" : String(n); };
    setBadge(unseen);
    // 開いているかどうか（スマホははじめ閉じておく）
    let open = store.get("newsOpen");
    if (open == null) open = !matchMedia("(max-width: 640px)").matches;
    const apply = () => {
      toggle.setAttribute("aria-expanded", String(open));
      list.hidden = !open;
      if (open) { store.set("newsSeen", items.map((s) => s.id)); setBadge(0); }
    };
    apply();
    toggle.addEventListener("click", () => { open = !open; store.set("newsOpen", open); apply(); });
    list.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-warp]");
      if (!b) return;
      const s = items.find((x) => x.id === b.dataset.warp);
      if (!s) return;
      const o = W.shopObjs.find((x) => x.shop.id === s.id);
      if (mode === "community") setMode("standard");
      if (o) {
        const f = ((o.shop.facing || 0) * Math.PI) / 180;
        dismissed = null;
        await teleport(o.x + Math.sin(f) * 5.5, o.z + Math.cos(f) * 5.5, `${s.name} に着きました`);
        me.ry = f + Math.PI;
      } else {
        const [x, z] = proj.xz(s.lat, s.lng);
        await teleport(x, z + 5.5, `${s.name} に着きました`);
      }
    });
  }
  // はじめての人には、ナビが使い方を案内する
  if (!store.get("welcomed")) {
    setTimeout(() => { guide.welcome(); store.set("welcomed", true); }, 900);
  }
  window.__machimania = { me, peers, W, net, teleport, renderer, camera, scene, setMode: (m) => setMode(m), transport, guide, guide2: townGuide, startTalk, startTrain, startFlight, startShip, get ride() { return ride; } }; // 動作確認用
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

boot().catch((e) => {
  console.error(e);
  progress(1, "読み込みに失敗しました：" + e.message);
});
