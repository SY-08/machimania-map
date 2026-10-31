// 運営からの「新しい機能」のお知らせ（ログインしている人に、ナビが1回だけ伝える）
// 新しい機能を出したら、いちばん下に1つ足すだけ。id は日付（YYYY-MM-DD）で、古い順に並べる。
// ・ゲストには出さない（ゲストには、はじめてのときに「ようこそ」の案内が出る）
// ・登録した日より前のお知らせは出さない。一度見たお知らせは、別の端末でログインしても出ない
export const UPDATES = [
  {
    id: "2026-10-27",
    title: "新しい機能",
    steps: [
      { text: "新しい機能が増えたよ！ 左上の「📣 新店のお知らせ」に、毎日みつかった新しいお店が並ぶんだ。「ワープ」でそのお店まで行けるよ。", focus: "#newsToggle" },
      { text: "どの町にも、案内人の「チズ」がいるよ。駅の近くで「！」が出ている人に話しかけると、町のことや近くのお店を教えてくれるんだ。" },
      { text: "右上の「💡ご意見」から、「解消してほしい点」や「追加してほしい要素」を運営に送れるようになったよ。どんどん教えてね！", focus: "#btnFeedback" },
    ],
  },
  {
    id: "2026-10-31",
    title: "スマホで見やすく",
    steps: [
      { text: "スマホの画面を見やすくしたよ。ボタンや文字の大きさを整えて、画面のはしが切れないようにしたんだ。" },
      { text: "電車に乗る・話しかけるボタンは右下に出るよ。左下のスティックで歩きながら押せるんだ。" },
    ],
  },
];

export const LATEST_UPDATE = UPDATES[UPDATES.length - 1].id;

// まだ見ていないお知らせ（seen：最後に見たお知らせのid、since：登録した日）
export function unseenUpdates(seen, since) {
  const from = seen || (since ? String(since).slice(0, 10) : LATEST_UPDATE);
  return UPDATES.filter((u) => u.id > from);
}
