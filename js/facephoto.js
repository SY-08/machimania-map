// 顔写真から、似ているアバターの見た目をつくる
// ・写真はこの端末のブラウザの中だけで読み、どこにも送らず、保存もしない
// ・顔の位置を見つける部品（MediaPipe）は、はじめて使うときにだけ読み込む
// ・部品が読み込めないときは、写真のまん中に顔がある前提で色だけ合わせる

const MP_VER = "0.10.14";
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MP_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise = null;

function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await import(/* @vite-ignore */ MP_URL);
      const files = await vision.FilesetResolver.forVisionTasks(MP_WASM);
      return vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MP_MODEL },
        runningMode: "IMAGE",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    })().catch((e) => { landmarkerPromise = null; throw e; });
  }
  return landmarkerPromise;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

// 画像ファイル → 縮小したキャンバス（元の写真はここで手放す）
async function fileToCanvas(file, max = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("画像を読み込めませんでした"));
      im.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------- 色の道具
const hex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// (x, y) のまわり（半径 r）の色の中央値。端からはみ出すときは null
function sample(data, w, h, x, y, r) {
  r = Math.max(1, Math.round(r));
  x = Math.round(x); y = Math.round(y);
  if (x - r < 0 || y - r < 0 || x + r >= w || y + r >= h) return null;
  const rs = [], gs = [], bs = [];
  for (let j = -r; j <= r; j += Math.max(1, r >> 2)) {
    for (let i = -r; i <= r; i += Math.max(1, r >> 2)) {
      const o = ((y + j) * w + (x + i)) * 4;
      rs.push(data[o]); gs.push(data[o + 1]); bs.push(data[o + 2]);
    }
  }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

function medianColor(list) {
  const ok = list.filter(Boolean);
  if (!ok.length) return null;
  const med = (i) => ok.map((c) => c[i]).sort((a, b) => a - b)[ok.length >> 1];
  return [med(0), med(1), med(2)];
}

// 写真の色は影や照明でくすむので、少し明るく・アニメ調に寄せる
function toonSkin(c) {
  const L = lum(c);
  const k = L < 150 ? Math.min(1.35, 170 / Math.max(40, L)) : 1.06;
  return hex(c.map((v) => v * k + 8));
}
function toonHair(c) {
  const L = lum(c);
  if (L < 70) return hex(c.map((v) => v * 0.9 + 12));   // 黒っぽい髪は少しだけ持ち上げる
  return hex(c.map((v) => v * 1.08));
}

// ---------------------------------------------------------------- 本体
/**
 * 顔写真ファイルから見た目の案をつくる
 * @returns {Promise<{look: object, found: boolean, note: string}>}
 */
export async function avatarFromPhoto(file, current = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error("画像ファイルを選んでください");
  let canvas = await fileToCanvas(file);
  try {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    let res = null;
    try {
      const lm = await withTimeout(loadLandmarker(), 20000);
      res = lm.detect(canvas);
    } catch (e) {
      console.warn("顔の位置を見つける部品を使えませんでした", e);
    }
    const face = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!face) return { look: simpleLook(data, w, h, current), found: false, note: "顔の位置がわからなかったので、写真のまん中を顔として色だけ合わせました" };
    const shapes = {};
    for (const c of (res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories) || []) shapes[c.categoryName] = c.score;
    return { look: landmarkLook(face, shapes, data, w, h, current), found: true, note: "写真に似せてみました。気になるところは下のボタンで直せます" };
  } finally {
    // 縮小した写真も、使い終わったらすぐに消す
    canvas.width = canvas.height = 0;
    canvas = null;
  }
}

function landmarkLook(face, shapes, data, w, h, current) {
  const P = (i) => [face[i].x * w, face[i].y * h];
  const top = P(10), chin = P(152), left = P(234), right = P(454);
  const fh = Math.hypot(chin[0] - top[0], chin[1] - top[1]);
  const fw = Math.hypot(right[0] - left[0], right[1] - left[1]);
  const r = Math.max(2, fw * 0.035);
  const up = [(top[0] - chin[0]) / fh, (top[1] - chin[1]) / fh];   // 顔の「上」方向
  const side = [(right[0] - left[0]) / fw, (right[1] - left[1]) / fw];
  const at = (p, du, ds) => [p[0] + up[0] * du + side[0] * ds, p[1] + up[1] * du + side[1] * ds];
  const S = (p, rr = r) => sample(data, w, h, p[0], p[1], rr);

  // はだ：両ほお・ひたい・鼻すじ
  const skin = medianColor([S(P(50)), S(P(280)), S(P(151)), S(P(195)), S(P(205)), S(P(425))]);
  // かみ：頭のてっぺんより少し上と、こめかみの外側
  const hairTop = medianColor([S(at(top, fh * 0.1, 0)), S(at(top, fh * 0.16, -fw * 0.15)), S(at(top, fh * 0.16, fw * 0.15))]);
  const temples = medianColor([S(at(P(127), fh * 0.05, -fw * 0.08)), S(at(P(356), fh * 0.05, fw * 0.08))]);
  // あごの横（耳より下）：ここも髪の色なら長い髪
  const below = medianColor([S(at(P(172), -fh * 0.12, -fw * 0.18)), S(at(P(397), -fh * 0.12, fw * 0.18))]);
  const ear = medianColor([S(at(left, 0, -fw * 0.1)), S(at(right, 0, fw * 0.1))]);

  const look = { ...current };
  if (skin) look.skin = toonSkin(skin);
  const hairC = hairTop || temples;
  // 髪の色がはだとほぼ同じ → 短い髪（またはぼうし以外）としてあつかう
  const hairIsReal = hairC && (!skin || dist(hairC, skin) > 45);
  if (hairIsReal) {
    look.hairColor = toonHair(hairC);
    const near = (c) => c && dist(c, hairC) < 55;
    if (near(below)) look.hair = "long";
    else if (near(ear)) look.hair = "bob";
    else look.hair = current.hair === "spiky" ? "spiky" : "short";
  } else {
    look.hair = "short";
  }

  // 目：まばたき・目の開き具合・笑顔
  const eyeOpen = (a, b, c, d) => { const v = Math.hypot(P(a)[0] - P(b)[0], P(a)[1] - P(b)[1]); const hz = Math.hypot(P(c)[0] - P(d)[0], P(c)[1] - P(d)[1]); return hz ? v / hz : 0.3; };
  const open = (eyeOpen(159, 145, 33, 133) + eyeOpen(386, 374, 362, 263)) / 2;
  const blink = ((shapes.eyeBlinkLeft || 0) + (shapes.eyeBlinkRight || 0)) / 2;
  const smile = ((shapes.mouthSmileLeft || 0) + (shapes.mouthSmileRight || 0)) / 2;
  const squint = ((shapes.eyeSquintLeft || 0) + (shapes.eyeSquintRight || 0)) / 2;
  if (smile > 0.55 && (squint > 0.35 || blink > 0.35)) look.eyes = "smile";
  else if (blink > 0.5 || open < 0.18) look.eyes = "sleepy";
  else if (open > 0.33) look.eyes = "big";
  else look.eyes = "round";
  // 口
  if ((shapes.jawOpen || 0) > 0.35) look.mouth = "open";
  else if ((shapes.mouthPucker || 0) > 0.5) look.mouth = "cat";
  else look.mouth = "smile";
  return look;
}

// 顔が見つからないとき：まん中＝はだ、上のほう＝かみ
function simpleLook(data, w, h, current) {
  const r = Math.min(w, h) * 0.03;
  const skin = medianColor([sample(data, w, h, w * 0.5, h * 0.52, r), sample(data, w, h, w * 0.4, h * 0.56, r), sample(data, w, h, w * 0.6, h * 0.56, r)]);
  const hair = medianColor([sample(data, w, h, w * 0.5, h * 0.14, r), sample(data, w, h, w * 0.4, h * 0.18, r), sample(data, w, h, w * 0.6, h * 0.18, r)]);
  const look = { ...current };
  if (skin) look.skin = toonSkin(skin);
  if (hair && (!skin || dist(hair, skin) > 45)) look.hairColor = toonHair(hair);
  return look;
}

// テスト用に中の関数も出しておく
export const _internal = { landmarkLook, simpleLook, sample, toonSkin, toonHair };
