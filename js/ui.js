// 画面のパネル類（マップ・モーダル・お店カードなど）
import { Avatar, AVATAR_OPTIONS, sanitizeAvatar } from "./avatar.js";
import { GENRES, KINDS, MODES, shopKind, daysSince } from "./style.js";
import { parseSns } from "./media.js";

const THREE = window.THREE;
const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- トースト
let toastTimer;
export function toast(text, ms = 2600) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- モーダル
export function openModal(html, { onClose, dismissable = true } = {}) {
  const root = $("#modalRoot");
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal panel" role="dialog" aria-modal="true">${dismissable ? '<button class="close-x" type="button" aria-label="閉じる">✕</button>' : ""}${html}</div>`;
  root.appendChild(bg);
  const close = () => { bg.remove(); onClose && onClose(); };
  if (dismissable) {
    bg.addEventListener("pointerdown", (e) => { if (e.target === bg) close(); });
    $(".close-x", bg).addEventListener("click", close);
    bg.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  bg.addEventListener("keydown", (e) => e.stopPropagation());
  bg.addEventListener("keyup", (e) => e.stopPropagation());
  setTimeout(() => ($("input,button:not(.close-x)", bg) || bg).focus(), 30);
  return { el: bg, close };
}
export const anyModalOpen = () => !!$("#modalRoot").children.length;


// ---------------------------------------------------------------- 全国マップ（ミニマップ／大きいマップ）
export class MiniMap {
  constructor(canvas, world, index, onPick) {
    this.c = canvas;
    this.world = world;
    this.index = index;
    this.onPick = onPick;
    this.big = false;
    this.scale = 2.2;          // 1ピクセルあたりのゲーム単位
    this.center = [0, 0];
    this.follow = true;
    this.mode = "standard";
    // 全国の輪郭（バウンディングボックスつき）
    this.land = index.overview.land.map((r) => ({ r, bb: bboxOf(r) }));
    this.prefLines = index.overview.pref.map((r) => ({ r, bb: bboxOf(r) }));
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag || !this.big) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
      if (drag.moved) { this.follow = false; this.center[0] -= dx * this.scale; this.center[1] -= dy * this.scale; this.dirty = true; }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    canvas.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) {
        const r = canvas.getBoundingClientRect();
        const [x, z] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        onPick(x, z);
      }
      drag = null;
    });
    canvas.addEventListener("wheel", (e) => {
      if (!this.big) return;
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const [wx, wz] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const k = Math.exp(e.deltaY * 0.0015);
      this.scale = Math.max(0.15, Math.min(90, this.scale * k));
      const [nx, nz] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.center[0] += wx - nx; this.center[1] += wz - nz;
      this.follow = false;
      this.dirty = true;
    }, { passive: false });
    this.resize();
  }

  setBig(big) {
    this.big = big;
    this.scale = big ? 6 : 2.2;
    this.follow = true;
    this.resize();
  }

  zoom(k) { this.scale = Math.max(0.15, Math.min(90, this.scale * k)); this.dirty = true; }
  showAll() { this.follow = false; this.center = [-1200, -5200]; this.scale = Math.max(45000 / Math.max(this.w, 1), 38000 / Math.max(this.h, 1)); this.dirty = true; }
  recenter() { this.follow = true; this.dirty = true; }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.dirty = true;
  }

  toScreen(x, z) { return [(x - this.center[0]) / this.scale + this.w / 2, (z - this.center[1]) / this.scale + this.h / 2]; }
  toWorld(sx, sy) { return [(sx - this.w / 2) * this.scale + this.center[0], (sy - this.h / 2) * this.scale + this.center[1]]; }

  draw(me, peers) {
    if (this.follow) {
      if (Math.abs(this.center[0] - me.x) / this.scale > 1.5 || Math.abs(this.center[1] - me.z) / this.scale > 1.5) this.dirty = true;
      if (this.dirty) this.center = [me.x, me.z];
    }
    if (this.dirty || !this.base) this._drawBase();
    const g = this.c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.base, 0, 0);
    g.scale(this.dpr, this.dpr);
    const font = `800 11px "M PLUS Rounded 1c", sans-serif`;
    // お店
    for (const s of this.world.shops) {
      const [x, y] = this.toScreen(s.x, s.z);
      if (x < -10 || y < -10 || x > this.w + 10 || y > this.h + 10) continue;
      g.fillStyle = s.look.ring; g.strokeStyle = "#fff"; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, this.big ? 6 : 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
      if (this.big && this.scale < 4) { g.font = font; g.fillStyle = "#3b3427"; g.fillText(s.look.emoji + " " + s.shop.name, x + 8, y - 6); }
    }
    for (const p of peers) {
      const [x, y] = this.toScreen(p.x, p.z);
      g.fillStyle = p.bot ? "#9aa6a2" : "#5fb6e8"; g.strokeStyle = "#fff"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    const [x, y] = this.toScreen(me.x, me.z);
    g.save();
    g.translate(x, y); g.rotate(-me.ry + Math.PI);
    g.fillStyle = "#ef6f5a"; g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  _drawBase() {
    this.dirty = false;
    if (!this.base) this.base = document.createElement("canvas");
    const off = this.base;
    off.width = this.c.width; off.height = this.c.height;
    const g = off.getContext("2d");
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = "#bfe3f0"; g.fillRect(0, 0, this.w, this.h);
    const [vx0, vz0] = this.toWorld(0, 0), [vx1, vz1] = this.toWorld(this.w, this.h);
    const vis = (bb) => !(bb[2] < vx0 || bb[0] > vx1 || bb[3] < vz0 || bb[1] > vz1);
    const path = (r, close) => { g.beginPath(); r.forEach((p, i) => { const [x, y] = this.toScreen(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (close) g.closePath(); };
    g.fillStyle = "#ead9b2"; g.strokeStyle = "#d3bf93"; g.lineWidth = 0.6;
    for (const l of this.land) if (vis(l.bb)) { path(l.r, true); g.fill(); if (this.scale < 6) g.stroke(); }
    g.strokeStyle = "#e57a63"; g.lineWidth = 1.2;
    for (const l of this.prefLines) if (vis(l.bb)) { path(l.r, false); g.stroke(); }
    g.lineCap = "round"; g.lineJoin = "round";
    if (this.scale < 4) {
      for (const r of this.world.minimapRails) {
        g.strokeStyle = r.color; g.lineWidth = Math.max(1.2, 2.2 / this.scale);
        path(r.pts, false); g.stroke();
      }
    }
    const font = (w, s) => `${w} ${s}px "M PLUS Rounded 1c", sans-serif`;
    if (this.scale < 2.5) {
      for (const s of this.index.stations) {
        if (s.p[0] < vx0 || s.p[0] > vx1 || s.p[1] < vz0 || s.p[1] > vz1) continue;
        const [x, y] = this.toScreen(s.p[0], s.p[1]);
        g.fillStyle = "#fff"; g.strokeStyle = "#3b3427"; g.lineWidth = 1.3;
        g.beginPath(); g.arc(x, y, this.big ? 3.6 : 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
        if (this.big && this.scale < 1.2) { g.font = font(800, 11); g.fillStyle = "#3b3427"; g.fillText(s.n, x + 5, y + 4); }
      }
    }
    if (this.big && this.scale >= 1.2 && this.scale < 14) {
      g.font = font(700, 11); g.fillStyle = "rgba(59,52,39,.65)"; g.textAlign = "center";
      for (const m of this.index.munis) {
        if (m.label[0] < vx0 || m.label[0] > vx1 || m.label[1] < vz0 || m.label[1] > vz1) continue;
        const [x, y] = this.toScreen(m.label[0], m.label[1]);
        g.fillText(m.name, x, y);
      }
      g.textAlign = "start";
    }
    if (this.big && this.scale >= 14) {
      g.font = font(800, 12); g.fillStyle = "#3b3427"; g.textAlign = "center";
      for (const p of this.index.prefs) { const [x, y] = this.toScreen(p.label[0], p.label[1]); g.fillText(p.name, x, y); }
      g.textAlign = "start";
    }
  }
}

function bboxOf(r) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of r) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }
  return b;
}

// ---------------------------------------------------------------- 場所をさがす
export function searchPlaces(index, shops, q) {
  q = q.trim();
  if (!q) return [];
  const out = [];
  for (const s of shops) if (s.shop.name.includes(q)) out.push({ kind: "shop", label: s.look.emoji + " " + s.shop.name, sub: KINDS[s.kind].label, x: s.x, z: s.z + 5.5 });
  for (const s of index.stations) if (s.n.includes(q)) out.push({ kind: "station", label: s.n + "駅", sub: s.l.join("・"), x: s.p[0], z: s.p[1], station: s.n });
  for (const m of index.munis) if ((m.pref + m.name).includes(q)) out.push({ kind: "muni", label: m.name, sub: m.pref, x: m.label[0], z: m.label[1] });
  out.sort((a, b) => (a.label.startsWith(q) ? 0 : 1) - (b.label.startsWith(q) ? 0 : 1) || a.label.length - b.label.length);
  return out.slice(0, 10);
}

// ---------------------------------------------------------------- お店カード
const fmtDate = (s) => (s ? String(s).slice(0, 10).replace(/-/g, ".") : "");

export function shopCardHTML(o, nearestStation, opts = {}) {
  const s = o.shop;
  const k = KINDS[o.kind];
  const g = GENRES[s.genre] || GENRES.other;
  let thumb = `<span class="emoji">${g.emoji}</span>`;
  const vid = youtubeId(s.youtube);
  const sns = parseSns(s.snsUrl);
  if (o.kind === "community" && s.thumbUrl) thumb += `<img src="${esc(safeUrl(s.thumbUrl, true))}" alt="${esc(s.name)}の写真" data-act="photo">`;
  else if (sns?.thumb) thumb += `<img src="${esc(sns.thumb)}" alt="" data-act="sns" onerror="this.remove()">`;
  else if (sns) thumb += `<span class="sns-badge" data-act="sns">${esc(sns.emoji)} ${esc(sns.label)}の投稿</span>`;
  else if (vid) thumb += `<img src="https://i.ytimg.com/vi/${esc(vid)}/hqdefault.jpg" alt="" onerror="this.remove()">`;
  const tags = [
    `<span class="tag kind" style="--k:${k.color};--kt:${k.text}">${esc(k.short)}</span>`,
    `<span class="tag">${esc(g.label)}</span>`,
    nearestStation ? `<span class="tag">${esc(nearestStation)}駅の近く</span>` : "",
  ];
  let body = "";
  let actions = "";
  if (o.kind === "youtube") {
    if (s.published) tags.push(`<span class="tag">動画 ${esc(fmtDate(s.published))}</span>`);
    if (s.opened) tags.push(`<span class="tag">${esc(fmtDate(s.opened))} オープン</span>`);
    body = s.comment ? `<p>${esc(s.comment)}</p>` : "";
    actions = s.youtube ? `<a class="btn yt" href="${esc(safeUrl(s.youtube))}" target="_blank" rel="noopener">▶ YouTubeで見る</a>` : "";
  } else if (o.kind === "new" || o.kind === "old") {
    const days = daysSince(s.opened);
    if (s.opened) tags.push(`<span class="tag">${esc(fmtDate(s.opened))} オープン${days != null && days >= 0 ? `（${days}日目）` : days != null ? "（オープン前）" : ""}</span>`);
    body = `${s.summary ? `<p><b>概要</b>　${esc(s.summary)}</p>` : ""}${s.background ? `<p><b>背景</b>　${esc(s.background)}</p>` : ""}`;
    const src = (s.sources || []).filter((u) => /^https:\/\//.test(u)).slice(0, 3);
    if (src.length) body += `<p class="src">情報源：${src.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(" ")}</p>`;
  } else {
    if (s.createdAt) tags.push(`<span class="tag">投稿 ${esc(fmtDate(s.createdAt))}</span>`);
    if (s.pending) tags.push(`<span class="tag" style="background:var(--sun)">審査待ち（あなたにだけ見えています）</span>`);
    if (s.local) tags.push(`<span class="tag" style="background:var(--sun)">テスト投稿</span>`);
    body = `${s.comment ? `<p>${esc(s.comment)}</p>` : ""}<p class="src">ニックネーム：${esc(s.author || "だれか")}</p>`;
    actions = [
      sns ? `<button class="btn sns" type="button" data-act="sns">${esc(sns.emoji)} ${esc(sns.label)}の投稿を見る</button>` : "",
      !sns && s.videoUrl ? `<a class="btn yt" href="${esc(safeUrl(s.videoUrl))}" target="_blank" rel="noopener">▶ 動画を見る</a>` : "",
      s.photoUrl ? `<button class="btn" type="button" data-act="photo">📷 写真を大きく</button>` : "",
      !s.local && !opts.mine ? `<button class="btn" type="button" data-act="report-shop" aria-label="この投稿を通報">通報</button>` : "",
    ].join("");
  }
  return `
    <button class="close-x" type="button" data-act="close" aria-label="閉じる">✕</button>
    <div class="shop-thumb" style="--ring:${k.color}">${thumb}</div>
    <div class="shop-body">
      <h3>${esc(s.name)}</h3>
      <div class="shop-meta">${tags.join("")}</div>
      ${body}
      ${actions ? `<div class="shop-actions">${actions}</div>` : ""}
    </div>`;
}

export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}
export function safeUrl(u, allowData = false) {
  if (allowData && /^data:image\//.test(u)) return u;
  return /^https:\/\//.test(u || "") ? u : "#";
}

export function shopListHTML(objs, stationOf, mode) {
  const kinds = MODES[mode].kinds;
  const list = objs.filter((o) => kinds.includes(o.kind));
  const legend = `<div class="legend">${kinds.map((k) => `<span><i style="background:${KINDS[k].color}"></i>${KINDS[k].label}（${list.filter((o) => o.kind === k).length}）</span>`).join("")}</div>`;
  if (!list.length) return legend + `<div class="empty">このモードのお店はまだありません。</div>`;
  const date = (o) => o.shop.published || o.shop.opened || o.shop.createdAt || "";
  const sorted = [...list].sort((a, b) => String(date(b)).localeCompare(String(date(a))));
  return legend + `<div class="shop-list">${sorted.map((o) => `
    <div class="shop-item" style="--k:${KINDS[o.kind].color}">
      <div class="em">${o.look.emoji}</div>
      <div><b>${esc(o.shop.name)}</b><small>${esc(KINDS[o.kind].short)} ・ ${esc(stationOf(o) || "")}${date(o) ? " ・ " + esc(fmtDate(date(o))) : ""}</small></div>
      <div class="acts">
        <button class="btn sun" type="button" data-go="${esc(o.shop.id)}">行く</button>
        ${o.shop.youtube ? `<a class="btn yt" href="${esc(safeUrl(o.shop.youtube))}" target="_blank" rel="noopener" aria-label="動画">▶</a>` : ""}
      </div>
    </div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- 投稿フォーム
export function postFormHTML({ here, online, nickname }) {
  const genres = Object.entries(GENRES).map(([k, g]) => `<option value="${k}">${g.emoji} ${g.label}</option>`).join("");
  return `
    <h2>お店を投稿する</h2>
    <p class="lead">あなたが行ったお店を、みんなのMAPに建てられます。<b>おすすめは、自分のSNS投稿（写真・動画）のリンクを貼る方法</b>です。写真や動画はSNSに置いたまま、ここに表示されます。${online ? "投稿すると、すぐにみんなの町に建ちます。" : "いまはテストモードなので、この端末にだけ保存されます。"}</p>
    <form id="postForm" class="post-form" autocomplete="off">
      <label class="field"><b>ニックネーム（必須）</b><input type="text" id="pNick" maxlength="12" required value="${esc(nickname || "")}" placeholder="例：ラーメン好きのたろう">
        <small>本名や学校名は入れないでください。投稿と一緒に表示されます。</small></label>
      <label class="field"><b>お店の名前（必須）</b><input type="text" id="pName" maxlength="40" required placeholder="例：中華そば まちだ"></label>
      <label class="field"><b>ジャンル</b><select id="pGenre">${genres}</select></label>
      <fieldset class="field"><legend><b>場所</b></legend>
        <label class="radio"><input type="radio" name="pWhere" value="here" checked> いま立っている場所（${esc(here)}）</label>
        <label class="radio"><input type="radio" name="pWhere" value="coords"> 緯度・経度を入れる</label>
        <input type="text" id="pCoords" placeholder="35.54132, 139.44836（Googleマップで右クリック）" hidden>
      </fieldset>
      <fieldset class="field how"><legend><b>投稿のしかた</b></legend>
        <label class="radio big"><input type="radio" name="pHow" value="sns" checked> <span><b>SNS投稿のリンクを貼る（おすすめ）</b><small>青いお店（参加者投稿）になります</small></span></label>
        <label class="radio big"><input type="radio" name="pHow" value="text"> <span><b>文字だけで口コミを書く</b><small>SNSに投稿していないとき。こちらも青いお店になります</small></span></label>
      </fieldset>
      <div class="field sns-only">
        <label class="field"><b>SNS投稿のリンク</b><input type="url" id="pSns" placeholder="https://www.instagram.com/p/…">
          <small>Instagram・TikTok・YouTube・X・Facebook・Threads の<b>公開</b>投稿。投稿の「共有」→「リンクをコピー」で取れます。</small></label>
        <div class="sns-check" id="pSnsCheck" hidden></div>
      </div>
      <label class="field"><b id="pCommentLabel">ひとこと（なくても大丈夫）</b><textarea id="pComment" maxlength="200" placeholder="おすすめのメニューや、お店の雰囲気など"></textarea>
        <small id="pCommentNote">お店への悪口や、本当かわからないことは書かないでください。</small></label>
      <label class="radio"><input type="checkbox" id="pAgree" required> 自分が行ったお店で、お店や他の人に迷惑がかからない内容です</label>
      <div class="row-end"><button class="btn primary" type="submit" id="pSend">投稿する</button></div>
    </form>`;
}


export function openAvatarEditor({ name = "", avatar, firstTime = false, onSave }) {
  let cfg = sanitizeAvatar(avatar);
  const o = AVATAR_OPTIONS;
  const sw = (key, list) => `<div class="swatches" data-key="${key}">${list.map((c) => `<button type="button" class="sw" style="background:${c}" data-v="${c}" aria-label="${c}" aria-pressed="${cfg[key] === c}"></button>`).join("")}</div>`;
  const seg = (key, list) => `<div class="seg" data-key="${key}">${list.map((x) => `<button type="button" data-v="${x.id}" aria-pressed="${cfg[key] === x.id}">${x.label}</button>`).join("")}</div>`;
  const html = `
    <h2>${firstTime ? "ようこそ、まちマニアMAPへ" : "すがたを変える"}</h2>
    <p class="lead">${firstTime ? "まずは町を歩くあなたの分身をつくりましょう。あとからいつでも変えられます。" : "名前と見た目は、まわりの人にも見えます。"}</p>
    <div class="editor">
      <canvas class="preview" id="avPreview" width="400" height="530"></canvas>
      <div class="opts">
        <label class="field"><b>なまえ（12文字まで）</b><input type="text" id="avName" maxlength="12" value="${esc(name)}" placeholder="例：まちあるきの人"></label>
        <section class="face-photo">
          <button type="button" class="btn" id="avPhotoBtn">📷 顔写真から似せてつくる</button>
          <input type="file" id="avPhoto" accept="image/*" hidden>
          <small>写真はこの端末の中だけで使います。送信も保存もしません。</small>
        </section>
        <section><h4>はだ</h4>${sw("skin", o.skin)}</section>
        <section><h4>かみがた</h4>${seg("hair", o.hair)}</section>
        <section><h4>かみの色</h4>${sw("hairColor", o.hairColor)}</section>
        <section><h4>め</h4>${seg("eyes", o.eyes)}</section>
        <section><h4>くち</h4>${seg("mouth", o.mouth)}</section>
        <section><h4>ふく</h4>${sw("shirt", o.shirt)}</section>
        <section><h4>ズボン</h4>${sw("pants", o.pants)}</section>
        <section><h4>せの高さ</h4><input type="range" id="avHeight" min="0.85" max="1.15" step="0.01" value="${cfg.height}" aria-label="せの高さ"></section>
        <section><label class="field" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="avGlasses" ${cfg.glasses ? "checked" : ""}> <b>メガネ</b></label></section>
      </div>
    </div>
    <p class="note">名前に本名や学校名などの個人情報は入れないでください。</p>
    <div class="row-end"><button class="btn primary" type="button" id="avSave">${firstTime ? "町に出かける" : "これにする"}</button></div>`;
  const m = openModal(html, { dismissable: !firstTime, onClose: () => { running = false; renderer.dispose(); } });
  const canvas = $("#avPreview", m.el);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#c9b38a", 0.7));
  const dl = new THREE.DirectionalLight("#fff4e0", 0.5);
  dl.position.set(3, 5, 4);
  scene.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 400 / 530, 0.1, 50);
  cam.position.set(0, 1.9, 7.4);
  cam.lookAt(0, 1.45, 0);
  const av = new Avatar(cfg, "", { showName: false, navi: false });
  scene.add(av.group);
  let running = true, t0 = performance.now();
  const loop = () => {
    if (!running) return;
    const t = (performance.now() - t0) / 1000;
    av.group.rotation.y = Math.sin(t * 0.7) * 0.6;
    av.update(1 / 60, 0);
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  };
  loop();
  m.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-v]");
    if (!b) return;
    const key = b.parentElement.dataset.key;
    cfg[key] = b.dataset.v;
    b.parentElement.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    av.setConfig(cfg, "");
    av.emote();
  });
  const refresh = () => {
    m.el.querySelectorAll("[data-key]").forEach((box) => box.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", String(cfg[box.dataset.key] === x.dataset.v))));
    $("#avGlasses", m.el).checked = cfg.glasses;
  };
  $("#avPhotoBtn", m.el).addEventListener("click", () => $("#avPhoto", m.el).click());
  $("#avPhoto", m.el).addEventListener("change", async (e) => {
    const input = e.target, file = input.files && input.files[0];
    input.value = "";   // 選んだファイルへの参照もすぐ手放す
    if (!file) return;
    const btn = $("#avPhotoBtn", m.el);
    btn.disabled = true; btn.textContent = "顔を見ています…";
    try {
      const { avatarFromPhoto } = await import("./facephoto.js");
      const { look, note } = await avatarFromPhoto(file, cfg);
      cfg = sanitizeAvatar(look);
      av.setConfig(cfg, ""); av.emote(); refresh();
      toast(note, 5000);
    } catch (err) {
      toast(err.message || "うまく読み取れませんでした", 4000);
    } finally {
      btn.disabled = false; btn.textContent = "📷 顔写真から似せてつくる";
    }
  });
  $("#avHeight", m.el).addEventListener("input", (e) => { cfg.height = +e.target.value; av.setConfig(cfg, ""); });
  $("#avGlasses", m.el).addEventListener("change", (e) => { cfg.glasses = e.target.checked; av.setConfig(cfg, ""); });
  $("#avSave", m.el).addEventListener("click", () => {
    const nm = $("#avName", m.el).value.replace(/\s+/g, " ").trim().slice(0, 12);
    if (!nm) { toast("なまえを入れてください"); $("#avName", m.el).focus(); return; }
    onSave(nm, sanitizeAvatar(cfg));
    m.close();
  });
}
