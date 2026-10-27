// ナビの案内（はじめての人への説明と、ヘルプ）
const $ = (s, el = document) => el.querySelector(s);
const isTouch = () => matchMedia("(pointer: coarse)").matches;

const TOPICS = {
  walk: {
    title: "歩きかた",
    steps: [
      { text: () => isTouch()
        ? "行きたい場所をタップすると、そこまで歩くよ。左下のスティックを動かしても歩けるよ。2本の指でつまむとズーム、1本指でなぞるとカメラが回るよ。"
        : "行きたい場所をクリックすると、そこまで歩くよ。WASD や矢印キーでも歩けて、Shift を押すと走れるよ。ドラッグでカメラを回して、ホイールでズームしてね。",
        focus: () => (isTouch() ? "#joystick" : "#game") },
    ],
  },
  colors: {
    title: "お店の色",
    steps: [
      { text: "町に建っているお店は、色で見分けられるよ。", focus: "#legend" },
      { text: "黄色は、まちマニア横塚さんが行って動画にしたお店。赤は、オープンして1年以内の新店。紫は、開店から1年以上たったお店。青は、みんなが投稿してくれたお店だよ。", focus: "#legend" },
      { text: "お店に近づくと、くわしい説明が出てくるよ。動画やSNSの投稿も見られるんだ。" },
    ],
  },
  modes: {
    title: "モードの切りかえ",
    steps: [
      { text: "上のボタンで、見るお店を切りかえられるよ。", focus: "#modeBar" },
      { text: "「スタンダード」は全部。「新規出店収集」は新店（赤）と開店1年以上（紫）。「みんなでつくる」は、まちマニア横塚さん（黄）とみんなの投稿（青）だよ。", focus: "#modeBar" },
    ],
  },
  post: {
    title: "お店を投稿する",
    steps: [
      { text: "行ったお店があったら「投稿」ボタンから口コミを書いてね。いま立っている場所に、青いお店が建つよ。", focus: "#btnPost" },
      { text: "口コミは必ず書いてね（10文字以上）。自分のSNS（Instagram・TikTok・YouTube など）に同じお店の投稿があったら、リンクも貼るのがおすすめ。写真や動画もいっしょに見てもらえるよ。" },
      { text: "味や接客の感想は、マイナスでも正直に書いて大丈夫。でも、人やお店を傷つける言葉（暴言・見下す言葉・差別・根拠のない決めつけ）は投稿できないよ。" },
      { text: "投稿した数は左上の「あなたの投稿」に出るよ。「投稿ランキング」で、みんなの投稿数も見られるんだ。", focus: "#myPosts" },
    ],
  },
  ride: {
    title: "電車・飛行機・船",
    steps: [
      { text: "駅に近づくと「電車に乗る」ボタンが出るよ。路線と行き先をえらぶと、線路を走ってつれていってくれるんだ。行き先の駅名を入力してもいいよ。", focus: "#rideBtn" },
      { text: "空港では飛行機に、港では船に乗れるよ。全国マップで空港（✈）や港（⛴）の名前をさがしてワープしてみてね。" },
      { text: "乗っている間は「次で降りる」を押すと、次の駅で降りられるよ。" },
    ],
  },
  map: {
    title: "全国マップとワープ",
    steps: [
      { text: "右上の地図が、いまいる場所のまわりだよ。「全国マップ」を押すと日本じゅうが見られるよ。", focus: "#mapWrap" },
      { text: "地図をタップすると、その場所へワープできるよ。駅名や市区町村、お店の名前でさがすこともできるよ。", focus: "#mapWrap" },
    ],
  },
  chat: {
    title: "話す・すれちがう",
    steps: [
      { text: "同じ地域（だいたい80km四方）にいる人が、町の中に見えるよ。下のチャットやスタンプで話しかけてみてね。", focus: ".chatbar" },
      { text: "★がついている人は、まちマニア横塚さん本人だよ。見かけたら声をかけてみてね！" },
      { text: "いやなことをされたら、名前をタップしてブロックや通報ができるよ。" },
    ],
  },
  account: {
    title: "アカウント",
    steps: [
      { text: "チャットとお店の投稿は、アカウントをつくるとできるようになるよ。ニックネームとパスワードだけで、その場ですぐ登録できるんだ。メールアドレスはいらないよ。右上の🔑から登録してね。", focus: "#btnAccount" },
      { text: "一度ログインすると、その端末ではずっとログインしたままだよ。別の端末では、同じニックネームとパスワードでログインしてね。" },
      { text: "パスワードはだれにも見えない形で保存されるから、運営にもわからないんだ。忘れたら再発行できないので、新しいアカウントをつくってね。" },
    ],
  },
  news: {
    title: "新店のお知らせ・案内人",
    steps: [
      { text: "左の「新店のお知らせ」には、毎日見つかった新しいお店が出るよ。「ワープ」を押すと、そのお店の前にひとっとび！ ▾を押すとたためるよ。", focus: "#news" },
      { text: "どの町にも、駅の近くに案内人の「チズ」がいるよ。近づいて「話しかける」を押すと、その町のことや、あそびかたを教えてくれるんだ。" },
    ],
  },
  phone: {
    title: "スマホのホーム画面に置く",
    steps: [
      { text: "スマホなら、ホーム画面に置くとアプリみたいに開けるよ。iPhone は Safari の共有ボタン →「ホーム画面に追加」、Android は Chrome のメニュー →「ホーム画面に追加」だよ。" },
    ],
  },
};

const WELCOME = [
  { text: "はじめまして！ぼくはナビ。きみのそばでいっしょに町を歩く、小さな光だよ。" },
  ...TOPICS.walk.steps,
  { text: "ここは日本じゅうの町。まちマニア横塚さんが行ったお店や、新しいお店、みんなのおすすめのお店が建っていくんだ。" },
  ...TOPICS.colors.steps.slice(0, 2),
  TOPICS.modes.steps[0],
  TOPICS.post.steps[0],
  TOPICS.account.steps[0],
  TOPICS.ride.steps[0],
  TOPICS.map.steps[1],
  TOPICS.chat.steps[0],
  TOPICS.chat.steps[1],
  { text: "わからないことがあったら、いつでも「？」ボタンでぼくを呼んでね。じゃあ、いってらっしゃい！", focus: "#btnHelp" },
];

export class Guide {
  constructor() {
    this.el = $("#guide");
    this.textEl = $("#guideText");
    this.nextBtn = $("#guideNext");
    this.backBtn = $("#guideBack");
    this.menuBtn = $("#guideMenu");
    this.closeBtn = $("#guideClose");
    this.topicsEl = $("#guideTopics");
    drawNaviFace($("#guideFace"));
    this.nextBtn.addEventListener("click", () => this.next());
    this.backBtn.addEventListener("click", () => this.go(this.i - 1));
    this.closeBtn.addEventListener("click", () => this.close());
    this.menuBtn.addEventListener("click", () => this.menu());
    this.topicsEl.addEventListener("click", (e) => {
      if (e.target.closest("[data-credits]")) { this.close(); if (this.onCredits) this.onCredits(); return; }
      const b = e.target.closest("[data-topic]");
      if (b) this.play(TOPICS[b.dataset.topic].steps, TOPICS[b.dataset.topic].title);
    });
    this.el.addEventListener("keydown", (e) => { if (e.key === "Escape") this.close(); e.stopPropagation(); });
  }

  welcome() { this.play(WELCOME, "ようこそ"); }

  menu() {
    this.clearFocus();
    this.steps = null;
    this.el.hidden = false;
    this.el.classList.add("menu");
    $("#guideTitle").textContent = "ナビにきく";
    this.textEl.textContent = "なにを知りたい？";
    this.topicsEl.innerHTML = Object.entries(TOPICS).map(([k, t]) => `<button type="button" data-topic="${k}">${t.title}</button>`).join("")
      + `<button type="button" data-credits>操作の一覧・地図の出典</button>`;
    this.topicsEl.hidden = false;
    this.nextBtn.hidden = this.backBtn.hidden = true;
    this.menuBtn.hidden = true;
    this.closeBtn.focus();
  }

  play(steps, title) {
    this.steps = steps;
    this.title = title;
    this.el.hidden = false;
    this.el.classList.remove("menu");
    this.topicsEl.hidden = true;
    this.menuBtn.hidden = false;
    this.go(0);
  }

  go(i) {
    if (!this.steps) return;
    if (i >= this.steps.length) { this.close(); return; }
    this.i = Math.max(0, i);
    const st = this.steps[this.i];
    $("#guideTitle").textContent = `${this.title}（${this.i + 1}/${this.steps.length}）`;
    this.typeText(typeof st.text === "function" ? st.text() : st.text);
    this.backBtn.hidden = this.i === 0;
    this.nextBtn.hidden = false;
    this.nextBtn.textContent = this.i === this.steps.length - 1 ? "わかった！" : "つぎへ";
    this.clearFocus();
    const sel = typeof st.focus === "function" ? st.focus() : st.focus;
    const el = sel && $(sel);
    if (el && !el.hidden && el.offsetParent !== null) { el.classList.add("navi-focus"); this.focused = el; }
    this.nextBtn.focus();
    if (this.onStep) this.onStep();
  }

  next() {
    if (this.typing) { this.finishType(); return; }
    this.go(this.i + 1);
  }

  typeText(t) {
    clearInterval(this.timer);
    this.full = t;
    let n = 0;
    this.typing = true;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { this.finishType(); return; }
    this.timer = setInterval(() => {
      n += 2;
      this.textEl.textContent = t.slice(0, n);
      if (n >= t.length) this.finishType();
    }, 22);
  }

  finishType() { clearInterval(this.timer); this.typing = false; this.textEl.textContent = this.full; }

  clearFocus() { if (this.focused) this.focused.classList.remove("navi-focus"); this.focused = null; }

  close() {
    clearInterval(this.timer);
    this.typing = false;
    this.clearFocus();
    this.el.hidden = true;
    if (this.onClose) this.onClose();
  }

  get open() { return !this.el.hidden; }
}

// ナビの光（ダイアログ用）
export function drawNaviFace(c) {
  if (!c) return;
  const g = c.getContext("2d");
  const w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  grd.addColorStop(0, "rgba(255,255,240,1)");
  grd.addColorStop(0.25, "rgba(255,252,215,1)");
  grd.addColorStop(0.55, "rgba(200,245,170,0.7)");
  grd.addColorStop(1, "rgba(200,245,170,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.9)";
  for (const [x, y, r] of [[0.28, 0.3, 0.025], [0.72, 0.36, 0.02], [0.66, 0.74, 0.022], [0.3, 0.7, 0.018]]) {
    g.beginPath(); g.arc(w * x, h * y, w * r, 0, Math.PI * 2); g.fill();
  }
}
