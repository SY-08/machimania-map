// オンライン機能（リアルタイムの位置共有・チャット）
//  - SupabaseNet: 本番用。Supabase の Realtime（Presence + Broadcast）と DB を使う
//  - LocalNet:    設定前のテスト用。同じブラウザの別タブ同士＋テスト住人（NPC）で動く

import { blobToDataURL } from "./media.js";
import { normNick, nickToLoginId, hashPassLocal, checkNick, checkPass } from "./account.js";

const BUCKET = "community";
const LOCAL_POSTS = "machimania.community";
const LOCAL_FEEDBACK = "machimania.feedback";
const LOCAL_ACCOUNTS = "machimania.accounts";
const LOCAL_SESSION = "machimania.session";
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* なし */ } };

class Emitter {
  constructor() { this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach((f) => f(...a)); }
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

// ====================================================================== テスト用
export class LocalNet extends Emitter {
  constructor(opts = {}) {
    super();
    this.mode = "local";
    this.room = opts.room || "town";
    this.bots = opts.bots !== false;
    this.walkable = opts.walkable || (() => true);
    this.spawn = opts.spawn || [0, 0];
    this.peers = new Map();
    this.history = [];
    this.area = null;
    this.official = new Set();
    this.selfOfficial = /owner/.test(location.hash);   // テスト用：URLの最後に #owner をつけると本人扱い
  }

  isOfficial(id) { return id === this.id ? this.selfOfficial : !!this.peers.get(id)?.official; }

  // ---------- アカウント（テストモード：この端末の中だけ。パスワードはハッシュにして保存）
  async init() {
    const sess = lsGet(LOCAL_SESSION, null);
    const acc = sess && lsGet(LOCAL_ACCOUNTS, {})[sess.key];
    this.accountInfo = acc ? { member: true, accountId: acc.id, nickname: acc.nickname } : { member: false };
    return { ...this.accountInfo, profile: acc ? { name: acc.nickname, avatar: acc.avatar } : null };
  }
  account() {
    if (!this._watching) {
      this._watching = true;
      addEventListener("storage", (e) => { if (e.key === LOCAL_SESSION) location.reload(); });   // 別のタブでログインしたらそろえる
    }
    return this.accountInfo || { member: false };
  }
  async register(nick, pass, avatar) {
    const bad = checkNick(nick) || checkPass(pass);
    if (bad) throw new Error(bad);
    const all = lsGet(LOCAL_ACCOUNTS, {}), key = normNick(nick);
    if (all[key]) throw new Error("そのニックネームはもう使われています。別のニックネームにしてください");
    if (/まちマニア|横塚|マチマニア/.test(nick) && !this.selfOfficial) throw new Error("その名前は使えません（まちマニア横塚さん本人だけが使える名前です）");
    const salt = uid();
    all[key] = { id: "acc-" + uid(), nickname: nick.trim(), salt, hash: await hashPassLocal(pass, salt), avatar, created: new Date().toISOString() };
    lsSet(LOCAL_ACCOUNTS, all);
    lsSet(LOCAL_SESSION, { key });
  }
  async login(nick, pass) {
    const all = lsGet(LOCAL_ACCOUNTS, {}), key = normNick(nick), acc = all[key];
    if (!acc || acc.hash !== await hashPassLocal(pass, acc.salt)) throw new Error("ニックネームかパスワードがちがいます");
    lsSet(LOCAL_SESSION, { key });
  }
  async logout() { try { localStorage.removeItem(LOCAL_SESSION); } catch { /* なし */ } location.reload(); }
  async updateProfile(me) {
    this.me = me;
    const sess = lsGet(LOCAL_SESSION, null), all = lsGet(LOCAL_ACCOUNTS, {});
    if (sess && all[sess.key]) { all[sess.key].avatar = me.avatar; lsSet(LOCAL_ACCOUNTS, all); }
    this._post({ t: "hello", info: this._info() });
  }
  async myPostCount() {
    const aid = this.account().accountId;
    return aid ? (await this.listCommunity()).filter((p) => p.userId === aid).length : 0;
  }
  async ranking() {
    const map = new Map();
    for (const p of await this.listCommunity()) {
      const k = p.userId || p.author;
      const r = map.get(k) || { userId: p.userId, name: p.author, posts: 0 };
      r.posts++; map.set(k, r);
    }
    return [...map.values()].sort((a, b) => b.posts - a.posts).slice(0, 100);
  }

  async connect(me, area) {
    if (/full/.test(location.hash) && !this._fullShown) {   // テスト用：#full で満員の画面を確認できる
      this._fullShown = true;
      const e = new Error("いま町がいっぱいです");
      e.code = "FULL"; e.count = 200;
      throw e;
    }
    this.area = area || this.area;
    let id = null;
    try { id = sessionStorage.getItem("machimania.localId"); } catch { /* なし */ }
    if (!id) { id = uid(); try { sessionStorage.setItem("machimania.localId", id); } catch { /* なし */ } }
    this.id = id;
    this.me = me;
    try {
      this.bc = new BroadcastChannel("machimania-" + this.room);
      this.bc.onmessage = (e) => this._recv(e.data);
      this._post({ t: "hello", info: this._info() });
    } catch { this.bc = null; }
    this.beat = setInterval(() => {
      this._post({ t: "hello", info: this._info(), ack: true });
      const now = Date.now();
      for (const [pid, p] of this.peers) if (!p.bot && now - p.seen > 12000) { this.peers.delete(pid); this.emit("leave", pid); }
    }, 4000);
    addEventListener("beforeunload", () => this._post({ t: "bye" }));
    if (this.bots) this._startBots();
    this.emit("status", { online: true, label: "テストモード" });
    return { id: this.id, anonymous: true, email: null };
  }

  _info() { return { name: this.me.name, avatar: this.me.avatar, state: this.lastState || null, official: this.selfOfficial }; }
  _post(m) { if (this.bc) this.bc.postMessage({ ...m, from: this.id, area: this.area }); }

  // 地域（部屋）を移る：同じ地域の人とだけ位置やチャットをやり取りする
  setRoom(area) {
    if (area === this.area) return;
    this.area = area;
    for (const [pid, p] of [...this.peers]) {
      const inArea = p.bot ? this.botArea === area : p.area === area;
      if (!inArea) { this.peers.delete(pid); this.emit("leave", pid); }
    }
    if (this.bots && this.botArea === area) for (const b of this.botState || []) if (!this.peers.has(b.id)) { this.peers.set(b.id, b.info); this.emit("peer", b.id, b.info); }
    this._post({ t: "hello", info: this._info() });
    this.emit("room", area);
    this.emit("online", this.peers.size + 1);
  }

  _recv(m) {
    if (!m || m.from === this.id) return;
    if (m.t !== "shop" && m.area !== this.area) {
      if (this.peers.has(m.from)) { this.peers.delete(m.from); this.emit("leave", m.from); }
      return;
    }
    if (m.t === "hello") {
      const known = this.peers.has(m.from);
      this.peers.set(m.from, { ...m.info, area: m.area, seen: Date.now() });
      if (!known) {
        this.emit("peer", m.from, m.info);
        if (!m.ack) this._post({ t: "hello", info: this._info(), ack: true });
      } else {
        this.emit("profile", m.from, m.info);
      }
      if (m.info.state) this.emit("state", m.from, m.info.state);
    } else if (m.t === "state") {
      const p = this.peers.get(m.from);
      if (p) { p.seen = Date.now(); this.emit("state", m.from, m.s); }
    } else if (m.t === "chat") {
      this.history.push(m.msg);
      this.emit("chat", m.msg);
    } else if (m.t === "shop") {
      this.emit("shop");
    } else if (m.t === "bye") {
      this.peers.delete(m.from);
      this.emit("leave", m.from);
    }
  }

  setState(s) {
    this.lastState = s;
    if (!this.peers.size) return;   // 同じ地域にだれもいないときは送らない
    this._post({ t: "state", s });
  }


  async chat(kind, body) {
    const msg = { id: uid(), from: this.id, name: this.me.name, kind, body, at: Date.now() };
    this.history.push(msg);
    this._post({ t: "chat", msg });
    this.emit("chat", msg);
    return msg;
  }

  async report() { return { ok: true, local: true }; }

  // ---------- みんなの投稿（テストモードではこの端末にだけ保存）
  async listCommunity() {
    try { return JSON.parse(localStorage.getItem(LOCAL_POSTS) || "[]"); } catch { return []; }
  }

  async submitCommunity(post) {
    const list = await this.listCommunity();
    const thumbUrl = post.thumb ? await blobToDataURL(post.thumb.blob) : null;
    const item = {
      id: "local-" + uid(), kind: "community", name: post.name, genre: post.genre, lat: post.lat, lng: post.lng,
      comment: post.comment, snsUrl: post.snsUrl || null, thumbUrl, photoUrl: thumbUrl,
      author: post.author || this.me.name, userId: this.account().accountId || null, createdAt: new Date().toISOString(), local: true, mine: true,
    };
    list.push(item);
    setTimeout(() => this._post({ t: "shop" }), 50);
    try { localStorage.setItem(LOCAL_POSTS, JSON.stringify(list)); }
    catch { throw new Error("この端末に保存できませんでした（保存できる容量がいっぱいかもしれません）"); }
    return item;
  }

  async deleteCommunity(id) {
    const list = (await this.listCommunity()).filter((x) => x.id !== id);
    try { localStorage.setItem(LOCAL_POSTS, JSON.stringify(list)); } catch { /* なし */ }
  }

  async isAdmin() { return false; }
  async listPending() { return []; }
  async reportShop() { return { ok: true, local: true }; }

  // ---------- ご意見（テストモードではこの端末にだけ保存）
  async sendFeedback(fb) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(LOCAL_FEEDBACK) || "[]"); } catch { /* なし */ }
    list.push({ ...fb, id: "local-" + uid(), createdAt: new Date().toISOString() });
    try { localStorage.setItem(LOCAL_FEEDBACK, JSON.stringify(list.slice(-50))); } catch { throw new Error("この端末に保存できませんでした"); }
    return { ok: true, local: true };
  }

  peerCount() { return this.peers.size; }

  // ---------- テスト住人（NPC）
  _startBots() {
    const bots = [
      { name: "テスト住人 ハル", avatar: { skin: "#f6cfae", hair: "bob", hairColor: "#5b3a27", eyes: "smile", mouth: "smile", shirt: "#7bd389", pants: "#3d4f6b", height: 0.95 } },
      { name: "テスト住人 ソラ", avatar: { skin: "#e8b48b", hair: "hat", hairColor: "#2b2420", eyes: "round", mouth: "open", shirt: "#5fb6e8", pants: "#6b4f3d", height: 1.05, glasses: true } },
      { name: "まちマニア横塚（見本）", official: true, avatar: { skin: "#f6cfae", hair: "short", hairColor: "#2b2420", eyes: "smile", mouth: "smile", shirt: "#ffd166", pants: "#3d4f6b", height: 1.05 } },
    ];
    this.botArea = this.area;
    const lines = [
      ["text", "こんにちは！ここ何もないね"], ["stamp", "hi"], ["text", "あのお店気になる〜"], ["stamp", "hungry"],
      ["text", "電車きた！"], ["stamp", "nice"], ["text", "次はどこにお店ができるかな"], ["stamp", "yay"],
    ];
    this.botState = bots.map((b, i) => {
      const id = "bot-" + i;
      const pos = [this.spawn[0] + [-6, 6, 2][i], this.spawn[1] + [4, 4, 8][i]];
      const info = { ...b, bot: true, seen: Infinity };
      this.peers.set(id, info);
      setTimeout(() => { if (this.area === this.botArea) this.emit("peer", id, info); this.emit("online", this.peers.size + 1); }, 600 + i * 900);
      return { id, info, pos, target: null, wait: 1 + i * 2, nextTalk: Date.now() + 6000 + i * 9000, li: i * 3 };
    });
    let last = performance.now();
    this.botTimer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      if (this.area !== this.botArea) return;
      for (const b of this.botState) {
        if (b.wait > 0) { b.wait -= dt; this.emit("state", b.id, { x: b.pos[0], z: b.pos[1], ry: b.ry || 0, vx: 0, vz: 0 }); }
        else {
          if (!b.target) {
            for (let k = 0; k < 12; k++) {
              const t = [this.spawn[0] + (Math.random() - 0.5) * 50, this.spawn[1] + (Math.random() - 0.5) * 50];
              if (this.walkable(t[0], t[1])) { b.target = t; break; }
            }
            if (!b.target) { b.wait = 2; continue; }
          }
          const dx = b.target[0] - b.pos[0], dz = b.target[1] - b.pos[1];
          const d = Math.hypot(dx, dz);
          const sp = 3.2;
          if (d < 0.3) { b.target = null; b.wait = 2 + Math.random() * 5; continue; }
          const vx = (dx / d) * sp, vz = (dz / d) * sp;
          const nx = b.pos[0] + vx * dt, nz = b.pos[1] + vz * dt;
          if (!this.walkable(nx, nz)) { b.target = null; b.wait = 1; continue; }
          b.pos = [nx, nz];
          b.ry = Math.atan2(vx, vz);
          this.emit("state", b.id, { x: nx, z: nz, ry: b.ry, vx, vz });
        }
        if (Date.now() > b.nextTalk) {
          const [kind, body] = lines[b.li++ % lines.length];
          const info = this.peers.get(b.id);
          this.emit("chat", { id: uid(), from: b.id, name: info.name, kind, body, at: Date.now() });
          b.nextTalk = Date.now() + 22000 + Math.random() * 25000;
        }
      }
    }, 100);
  }
}

// ====================================================================== 本番用（Supabase）
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.min.js";

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("ライブラリを読み込めませんでした"));
    document.head.appendChild(s);
  });
}

export class SupabaseNet extends Emitter {
  constructor(cfg) {
    super();
    this.mode = "online";
    this.cfg = cfg;
    this.room = cfg.room || "town";
    this.peers = new Map();
    this.lastSent = 0;
    this.pending = null;
  }

  async init() {
    if (!window.supabase) await loadScript(SUPABASE_JS);
    this.client = window.supabase.createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    let { data: { session } } = await this.client.auth.getSession();
    if (!session) {
      const { data, error } = await this.client.auth.signInAnonymously();
      if (error) throw new Error("ゲストログインに失敗しました。Supabase の Authentication で「Allow anonymous sign-ins」を有効にしてください（" + error.message + "）");
      session = data.session;
    }
    this.user = session.user;
    this.id = this.user.id;
    // private チャンネルに入るため、ログイン中の鍵をリアルタイム接続にも渡す
    await this.client.realtime.setAuth(session.access_token);
    this.client.auth.onAuthStateChange((ev, s) => {
      // 別のタブで登録・ログイン・ログアウトしたら、このタブも読み込み直してそろえる
      if ((ev === "SIGNED_IN" || ev === "SIGNED_OUT") && (s?.user?.id || null) !== (this.id || null) && this._ready && !this._selfAuth) { location.reload(); return; }
      if (s?.access_token) this.client.realtime.setAuth(s.access_token);
      if (s?.user) { this.user = s.user; this.emit("account", this.account()); }
    });
    // 保存済みのプロフィール（ログイン済みのとき）
    let prof = null;
    if (!this.user.is_anonymous) {
      ({ data: prof } = await this.client.from("profiles").select("name, avatar").eq("id", this.id).maybeSingle());
      this.nickname = prof?.name || this.user.user_metadata?.nickname || null;
    }
    this._ready = true;
    return { id: this.id, profile: prof || null, ...this.account() };
  }

  // member：ニックネーム＋パスワードで登録した人。ゲスト（匿名）は見るだけ
  account() { const member = !!this.user && !this.user.is_anonymous; return { member, accountId: member ? this.id : null, nickname: member ? this.nickname : null }; }

  async register(nick, pass, avatar) {
    const bad = checkNick(nick) || checkPass(pass);
    if (bad) throw new Error(bad);
    nick = nick.replace(/\s+/g, " ").trim();
    const email = await nickToLoginId(nick, this.cfg.accountIdDomain);
    this._selfAuth = true;
    const { data, error } = await this.client.auth.signUp({ email, password: pass, options: { data: { nickname: nick } } });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new Error("そのニックネームはもう使われています。別のニックネームにしてください");
      throw new Error("登録できませんでした（" + error.message + "）");
    }
    if (!data.session) throw new Error("登録の設定がまだです（運営者へ：Supabase の Authentication → Email の「Confirm email」をオフにしてください）");
    this.user = data.user; this.id = data.user.id;
    await this.client.realtime.setAuth(data.session.access_token);
    const { error: perr } = await this.client.from("profiles").upsert({ id: this.id, name: nick, avatar, updated_at: new Date().toISOString() });
    if (perr) {
      await this.client.auth.signOut();
      if (/reserved/.test(perr.message)) throw new Error("その名前は使えません（まちマニア横塚さん本人だけが使える名前です）");
      if (/duplicate|unique/i.test(perr.message)) throw new Error("そのニックネームはもう使われています。別のニックネームにしてください");
      throw new Error("登録できませんでした（" + perr.message + "）");
    }
  }

  async login(nick, pass) {
    const email = await nickToLoginId(nick, this.cfg.accountIdDomain);
    this._selfAuth = true;
    const { error } = await this.client.auth.signInWithPassword({ email, password: pass });
    if (error) throw new Error(/invalid/i.test(error.message) ? "ニックネームかパスワードがちがいます" : "ログインできませんでした（" + error.message + "）");
  }

  async myPostCount() {
    if (this.user?.is_anonymous) return 0;
    const { count } = await this.client.from("community_shops").select("id", { count: "exact", head: true }).eq("user_id", this.id).eq("status", "approved");
    return count || 0;
  }

  async ranking() {
    const { data, error } = await this.client.rpc("post_ranking", { lim: 100 });
    if (error) { console.warn(error); return []; }
    return (data || []).map((r) => ({ userId: r.user_id, name: r.name, posts: Number(r.posts) }));
  }

  isOfficial(id) { return this.official?.has(id); }

  async connect(me, area) {
    this.me = me;
    // 公式（本人）マークをつける人の一覧。だれでも読めるが、書きかえられるのは運営者だけ
    const { data: off } = await this.client.from("official_users").select("user_id");
    this.official = new Set((off || []).map((r) => r.user_id));
    // ゲストはプロフィールを保存しない（見るだけ）。登録した人は見た目だけ更新（名前＝ログイン名は変えない）
    if (!this.user.is_anonymous) await this.client.from("profiles").update({ avatar: me.avatar, updated_at: new Date().toISOString() }).eq("id", this.id);
    const { data: banned } = await this.client.from("banned_users").select("user_id").eq("user_id", this.id).maybeSingle();
    if (banned) throw new Error("このアカウントは利用が停止されています");

    // 全国の人数を数える部屋（ロビー）。満員なら入らずに待つ
    const count = await this._joinLobby();
    const max = this.cfg.maxOnline || 190;
    if (count > max) {
      await this.client.removeChannel(this.lobby);
      this.lobby = null;
      const e = new Error("いま町がいっぱいです");
      e.code = "FULL"; e.count = count;
      throw e;
    }
    await this.setRoom(area);
    this.emit("status", { online: true, label: "オンライン" });
    return { id: this.id, ...this.account() };
  }

  _subscribe(ch) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("リアルタイム接続がタイムアウトしました")), 15000);
      ch.subscribe((status, err) => {
        if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          const e = new Error("リアルタイム接続に失敗しました（" + (err?.message || status) + "）");
          // 同時接続の上限に達したときも、ここに来る
          if (/limit|too many|capacity|connection/i.test(err?.message || "")) e.code = "FULL";
          reject(e);
        } else if (status === "CLOSED") this.emit("status", { online: false, label: "切断されました" });
      });
    });
  }

  async _joinLobby() {
    if (this.lobby) { try { await this.client.removeChannel(this.lobby); } catch { /* なし */ } this.lobby = null; }
    const lobby = this.client.channel("lobby", { config: { private: true, presence: { key: this.id } } });
    this.lobby = lobby;
    let synced;
    const first = new Promise((r) => (synced = r));
    lobby.on("presence", { event: "sync" }, () => {
      const n = Object.keys(lobby.presenceState()).length;
      this.onlineCount = n;
      this.emit("online", n);
      synced(n);
    });
    await this._subscribe(lobby);
    await lobby.track({ at: Date.now() });
    return Promise.race([first, new Promise((r) => setTimeout(() => r(this.onlineCount || 1), 2500))]);
  }

  // 地域（部屋）を移る：同じ地域（約80km四方）の人とだけ、位置とチャットをやり取りする
  async setRoom(area) {
    if (!area || area === this.area) return;
    if (this._switching) { this._nextArea = area; return; }
    this._switching = true;
    try {
      if (this.ch) { await this.client.removeChannel(this.ch); this.ch = null; }
      for (const pid of [...this.peers.keys()]) { this.peers.delete(pid); this.emit("leave", pid); }
      this.area = area;
      this.room = "area" + area;
      const ch = this.client.channel("room:" + this.room, {
        config: { private: true, presence: { key: this.id }, broadcast: { self: false, ack: false } },
      });
      this.ch = ch;
      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        const ids = new Set(Object.keys(state).filter((k) => k !== this.id));
        for (const pid of ids) {
          const info = state[pid][0];
          if (!this.peers.has(pid)) {
            this.peers.set(pid, info);
            this.emit("peer", pid, info);
            if (info.state) this.emit("state", pid, info.state);
            this._sendNow(); // 新しく来た人に自分の位置を知らせる
          } else if (info.name !== this.peers.get(pid).name || JSON.stringify(info.avatar) !== JSON.stringify(this.peers.get(pid).avatar)) {
            this.peers.set(pid, info);
            this.emit("profile", pid, info);
          }
        }
        for (const pid of [...this.peers.keys()]) if (!ids.has(pid)) { this.peers.delete(pid); this.emit("leave", pid); }
        this.emit("count", this.peers.size);
      });
      ch.on("broadcast", { event: "state" }, ({ payload }) => {
        if (payload?.from && payload.from !== this.id && this.peers.has(payload.from)) this.emit("state", payload.from, payload.s);
      });
      ch.on("broadcast", { event: "shop" }, ({ payload }) => {
        if (payload?.from && payload.from !== this.id) this.emit("shop");
      });
      ch.on("broadcast", { event: "chat" }, ({ payload }) => {
        if (payload?.from && payload.from !== this.id) this.emit("chat", payload);
      });
      await this._subscribe(ch);
      await ch.track({ name: this.me.name, avatar: this.me.avatar, state: this.lastState || null, joined: Date.now() });
      const { data: rows } = await this.client.from("messages").select("id, user_id, name, kind, body, created_at")
        .eq("room", this.room).order("created_at", { ascending: false }).limit(30);
      this.emit("room", area);
      this.emit("history", (rows || []).reverse().map((r) => ({ id: r.id, from: r.user_id, name: r.name, kind: r.kind, body: r.body, at: Date.parse(r.created_at) })));
    } finally {
      this._switching = false;
      if (this._nextArea && this._nextArea !== this.area) { const a = this._nextArea; this._nextArea = null; this.setRoom(a); }
    }
  }

  // 位置は「動いているときだけ」「1秒に数回」送る（無料枠のメッセージ数を節約）
  setState(s) {
    this.lastState = s;
    const now = performance.now();
    const hz = this.cfg.stateHz || 2;
    const prev = this.lastSentState;
    const startedOrStopped = !prev || (Math.hypot(prev.vx, prev.vz) > 0.1) !== (Math.hypot(s.vx, s.vz) > 0.1);
    const turned = prev && Math.hypot(s.vx - prev.vx, s.vz - prev.vz) > 1.5;
    const moving = Math.hypot(s.vx, s.vz) > 0.1;
    if (!this.peers.size) return;   // 同じ地域にだれもいないときは送らない（無料枠の節約）
    if (startedOrStopped || turned ? now - this.lastSent > 120 : moving && now - this.lastSent > 1000 / hz) this._sendNow();
  }

  _sendNow() {
    if (!this.ch || !this.lastState) return;
    this.lastSent = performance.now();
    this.lastSentState = this.lastState;
    const s = this.lastState;
    this.ch.send({ type: "broadcast", event: "state", payload: { from: this.id, s: { x: +s.x.toFixed(2), z: +s.z.toFixed(2), ry: +s.ry.toFixed(2), vx: +s.vx.toFixed(2), vz: +s.vz.toFixed(2) } } });
  }

  async updateProfile(me) {
    this.me = me;
    if (!this.user.is_anonymous) await this.client.from("profiles").update({ avatar: me.avatar, updated_at: new Date().toISOString() }).eq("id", this.id);
    if (this.ch) await this.ch.track({ name: me.name, avatar: me.avatar, state: this.lastState || null, joined: Date.now() });
  }

  async chat(kind, body) {
    const { data, error } = await this.client.from("messages").insert({ room: this.room, name: this.me.name, kind, body }).select("id, created_at").single();
    if (error) throw new Error(error.message.includes("rate") ? "連続で送りすぎです。少し待ってください" : "送信できませんでした（" + error.message + "）");
    const msg = { id: data.id, from: this.id, name: this.me.name, kind, body, at: Date.parse(data.created_at) };
    this.ch.send({ type: "broadcast", event: "chat", payload: msg });
    this.emit("chat", msg);
    return msg;
  }

  async report(targetId, messageId, reason) {
    const mid = /^\d+$/.test(String(messageId || "")) ? Number(messageId) : null;
    const { error } = await this.client.from("reports").insert({ target: targetId, message_id: mid, reason: String(reason).slice(0, 400) });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  async logout() { this._selfAuth = true; await this.client.auth.signOut(); location.reload(); }

  // ---------- みんなの投稿
  publicUrl(path) { return path ? this.client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null; }

  _mapPost(r) {
    return {
      id: "c" + r.id, dbId: r.id, kind: "community", userId: r.user_id, name: r.name, genre: r.genre, lat: r.lat, lng: r.lng,
      comment: r.comment, author: r.author, createdAt: r.created_at,
      photoUrl: this.publicUrl(r.photo_path), thumbUrl: this.publicUrl(r.thumb_path || r.photo_path),
      snsUrl: r.sns_url || null, videoUrl: r.video_url || this.publicUrl(r.video_path), pending: r.status === "pending", mine: r.user_id === this.id,
    };
  }

  async listCommunity() {
    const { data, error } = await this.client.from("community_shops")
      .select("id,user_id,author,name,genre,lat,lng,comment,sns_url,video_url,photo_path,thumb_path,video_path,status,created_at")
      .in("status", ["approved", "pending"]).order("created_at", { ascending: false }).limit(2000);
    if (error) { console.warn(error); return []; }
    return (data || []).filter((r) => r.status === "approved").map((r) => this._mapPost(r));
  }

  async submitCommunity(post) {
    const base = `${this.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const up = async (path, blob, type) => {
      const { error } = await this.client.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false, cacheControl: "31536000" });
      if (error) throw new Error("アップロードできませんでした（" + error.message + "）");
      return path;
    };
    const photo_path = post.photo ? await up(`${base}.${post.photo.ext}`, post.photo.blob, post.photo.type) : null;
    const thumb_path = post.thumb ? await up(`${base}-t.${post.thumb.ext}`, post.thumb.blob, post.thumb.type) : null;
    const video_path = post.videoFile ? await up(`${base}.${(post.videoFile.name.split(".").pop() || "mp4").toLowerCase()}`, post.videoFile, post.videoFile.type) : null;
    const { data, error } = await this.client.from("community_shops").insert({
      name: post.name, genre: post.genre, lat: post.lat, lng: post.lng, comment: post.comment || null,
      sns_url: post.snsUrl || null, video_url: post.videoUrl || null, photo_path, thumb_path, video_path, author: post.author || this.me.name,
    }).select("*").single();
    if (error) throw new Error(error.message.includes("rate") ? "今日の投稿は10件までです。また明日お願いします" : "投稿できませんでした（" + error.message + "）");
    const item = this._mapPost(data);
    // ほかの人の画面にも、すぐ建つように知らせる
    if (this.ch) this.ch.send({ type: "broadcast", event: "shop", payload: { from: this.id, id: item.id } });
    return item;
  }

  async deleteCommunity(id) {
    const dbId = Number(String(id).replace(/^c/, ""));
    await this.client.from("community_shops").delete().eq("id", dbId);
  }

  async isAdmin() {
    const { data } = await this.client.from("admins").select("user_id").eq("user_id", this.id).maybeSingle();
    return !!data;
  }

  async listPending() {
    const { data, error } = await this.client.from("community_shops").select("*").eq("status", "pending").order("created_at", { ascending: true }).limit(100);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => this._mapPost(r));
  }

  async review(dbId, status) {
    const { error } = await this.client.from("community_shops").update({ status, reviewed_at: new Date().toISOString() }).eq("id", dbId);
    if (error) throw new Error(error.message);
  }

  async sendFeedback(fb) {
    const { error } = await this.client.from("feedback").insert({
      kind: fb.kind, body: fb.body, nickname: fb.nickname || null, area: fb.area || null,
      lat: fb.lat ?? null, lng: fb.lng ?? null, device: fb.device || null,
    });
    if (error) {
      if (/feedback_limit|row-level security/i.test(error.message)) throw new Error("今日はもうたくさん送ってくれました。また明日おねがいします");
      throw new Error("送れませんでした：" + error.message);
    }
    return { ok: true };
  }

  async reportShop(shop, reason) {
    const { error } = await this.client.from("reports").insert({ target: shop.userId, reason: `投稿 #${shop.dbId}「${shop.name}」: ${String(reason).slice(0, 300)}` });
    if (error) throw new Error(error.message);
    return { ok: true };
  }


  peerCount() { return this.peers.size; }
}
