#!/usr/bin/env python3
"""
まちマニアMAP 新店リサーチ（GitHub Actions で毎日動かす。費用はかからない）

  1. ニュースのRSS（Bing ニュース・Google ニュース）から「新店・開店・独立」の記事を集める
  2. 記事の本文を読み、GitHub Models（GitHub の無料のAI）で
     「個人オーナーの飲食店か」「店名・住所・開店日」をスクリーニングして取り出す
  3. 条件を満たした店だけを data/research-inbox.json に追記する
     （スプレッドシートの Apps Script が毎朝7時台に「新店」シートへ取りこむ）

  さらに、環境変数 SHEET_CSV_URL（「新店」シートをCSVで公開したURL）があれば、
  そのCSVから data/research.json（MAPに出す新店）を作りなおす。

必要なもの（Actions が自動で用意）：GITHUB_TOKEN（models: read 権限）
"""
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INBOX = ROOT / "data" / "research-inbox.json"
RESEARCH = ROOT / "data" / "research.json"
JST = dt.timezone(dt.timedelta(hours=9))
TODAY = dt.datetime.now(JST).date()
MODEL = os.environ.get("RESEARCH_MODEL", "openai/gpt-4.1-mini")
MAX_ARTICLES = int(os.environ.get("RESEARCH_MAX_ARTICLES", "28"))   # AIに読ませる記事の上限（無料枠に収める）
UA = "Mozilla/5.0 (compatible; machimania-map-research/1.0; +https://sy-08.github.io/machimania-map/)"
GENRES = ["ramen", "udon", "cafe", "sweets", "izakaya", "bakery", "curry", "sushi", "yakiniku", "chinese", "western", "other"]
PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split()

# 個人店が見つかりやすい言い方で、地域ごとに探す
QUERIES = [
    "独立 開業 店主 オープン 飲食店", "脱サラ 開店 店主", "夫婦 店 オープン 新店", "個人店 オープン ラーメン",
    "店主 独立 カフェ オープン", "新店 オープン 店主 修業", "移転オープン 店主", "キッチンカー 実店舗 オープン",
    "北海道 新店 オープン 店主", "東北 新店 オープン 店主", "関東 新店 オープン 店主", "東海 新店 オープン 店主",
    "北陸 甲信越 新店 オープン 店主", "関西 新店 オープン 店主", "中国地方 四国 新店 オープン 店主", "九州 沖縄 新店 オープン 店主",
]
CHAIN_WORDS = re.compile(r"(号店|全国\s*\d|店舗目|初出店|フランチャイズ|ＦＣ|FC加盟|グループ|ホールディングス|株式会社[^\s、。]{0,12}が運営|イオンモール|ららぽーと|駅ビル|フードコート|空港|アウトレット|プロデュース|暖簾分け|のれん分け|系列)")


def log(*a):
    print(*a, flush=True)


def get(url, timeout=20, max_bytes=1_500_000):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja,en;q=0.5"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(max_bytes)
        enc = r.headers.get_content_charset() or "utf-8"
    return data.decode(enc, errors="replace")


# ---------------------------------------------------------------- 1. 記事を集める
def unwrap_link(link):
    """Bing のクリック計測URLから、記事の本当のURLを取り出す"""
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
        if "url" in q:
            return q["url"][0]
    except Exception:
        pass
    return link


def resolve_google(link):
    """Google ニュースのURLから記事のURLを取り出す（取れなければ None）"""
    try:
        page = get(link, timeout=15, max_bytes=400_000)
        m = re.search(r'data-n-au="([^"]+)"', page) or re.search(r'<a[^>]+href="(https?://(?!news\.google)[^"]+)"', page)
        return html.unescape(m.group(1)) if m else None
    except Exception:
        return None


def collect():
    items, seen = [], set()
    for q in QUERIES:
        feeds = [
            ("bing", "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": q, "format": "rss", "setlang": "ja", "cc": "JP", "qft": 'interval="8"'})),
            ("google", "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q + " when:7d", "hl": "ja", "gl": "JP", "ceid": "JP:ja"})),
        ]
        for kind, url in feeds:
            try:
                root = ET.fromstring(get(url).encode("utf-8"))
            except Exception as e:
                log(f"  RSS 取得失敗 {kind} {q}: {e}")
                continue
            for it in root.iter("item"):
                title = (it.findtext("title") or "").strip()
                link = (it.findtext("link") or "").strip()
                desc = re.sub(r"<[^>]+>", " ", html.unescape(it.findtext("description") or "")).strip()
                pub = it.findtext("pubDate") or ""
                if not title or not link:
                    continue
                key = re.sub(r"\s+", "", title)[:40]
                if key in seen:
                    continue
                seen.add(key)
                items.append({"title": title, "link": unwrap_link(link) if kind == "bing" else link, "kind": kind, "desc": desc[:300], "pub": pub, "q": q})
            time.sleep(0.6)
    log(f"記事の候補 {len(items)} 件")
    return items


def prefilter(items):
    """タイトルと要約だけで、明らかに関係ないものやチェーンを落とす"""
    out = []
    for it in items:
        t = it["title"] + " " + it["desc"]
        if not re.search(r"(オープン|開店|開業|新店|独立|移転|グランドオープン|プレオープン)", t):
            continue
        if not re.search(r"(店|カフェ|ラーメン|そば|うどん|食堂|酒場|居酒屋|ベーカリー|パン|スイーツ|菓子|寿司|鮨|焼肉|カレー|中華|ビストロ|レストラン|バル|喫茶|定食|ジェラート|コーヒー|珈琲)", t):
            continue
        if CHAIN_WORDS.search(t):
            continue
        out.append(it)
    # 個人店らしい言葉が入っているものを先に
    out.sort(key=lambda it: -len(re.findall(r"(店主|独立|夫婦|脱サラ|修業|個人|地元|移転)", it["title"] + it["desc"])))
    log(f"一次ふるい後 {len(out)} 件")
    return out


def article_text(url):
    page = get(url, timeout=20)
    page = re.sub(r"(?is)<(script|style|noscript|svg|header|footer|nav|aside)[^>]*>.*?</\1>", " ", page)
    title = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    text = re.sub(r"(?s)<[^>]+>", " ", page)
    text = re.sub(r"\s+", " ", html.unescape(text)).strip()
    return (html.unescape(title.group(1)).strip() if title else ""), text


# ---------------------------------------------------------------- 2. AIでスクリーニング
SYSTEM = f"""あなたは日本の飲食店ニュースを調べる編集者です。渡された記事の本文だけを根拠に判断し、推測で埋めないでください。
目的：「個人オーナーの飲食店が、新しくオープンした（またはオープン予定）」という情報だけを集めること。
個人オーナーの店とは、店主が自分で営む1店舗だけ（同じ店主の2店舗目まで）の店。店主がその店のために作った小さな会社（店名と同じ社名・1店舗）も含む。
次は対象外：チェーン店・フランチャイズ（支店名つき、全国〇店舗、〇号店、〇県初出店、〇〇グループ、FC）、企業や会社が運営する店、ショッピングモール・駅ビル・空港・フードコートのテナント、有名店の暖簾分け・系列店・プロデュース店、キッチンカー・期間限定・閉店済み、飲食店でないもの。
今日は {TODAY.isoformat()} です。
必ず次の形のJSONだけを返してください：
{{"ok": true/false, "reason": "対象外の理由（ok=falseのとき）",
 "name": "店名", "genre": "{'|'.join(GENRES)}のどれか",
 "pref": "都道府県", "city": "市区町村", "address": "住所（番地まで。本文に番地がなければ空）",
 "opened": "YYYY-MM-DD（本文にある開店日。年が書かれていなければ今日に近い年で補う。わからなければ空）",
 "summary": "概要（60字程度・事実のみ）", "background": "出店の背景（店主の経歴・独立・移転など本文にあることだけ。60字程度）",
 "owner": "個人店と判断した根拠（本文の記述を短く引用）"}}
記事に複数の店があるときは、条件にいちばん合う1店だけを返してください。"""


def ask_ai(title, url, text):
    token = os.environ.get("GITHUB_TOKEN")
    body = {
        "model": MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"記事のタイトル：{title}\nURL：{url}\n本文：\n{text[:7000]}"},
        ],
    }
    req = urllib.request.Request(
        "https://models.github.ai/inference/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                res = json.loads(r.read().decode("utf-8"))
            return json.loads(res["choices"][0]["message"]["content"])
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            if e.code == 429:
                log(f"  AIの回数制限：待って再試行（{msg}）")
                time.sleep(20 * (attempt + 1))
                continue
            log(f"  AIエラー {e.code}: {msg}")
            return None
        except Exception as e:
            log(f"  AIエラー: {e}")
            time.sleep(5)
    return None


def valid(r, text):
    """AIの答えを、機械的にもう一度確かめる"""
    if not r or not r.get("ok"):
        return False, (r or {}).get("reason", "AIが対象外と判断")
    for k in ("name", "address", "owner"):
        if not str(r.get(k, "")).strip():
            return False, f"{k} がない"
    addr = str(r["address"])
    if not any(addr.startswith(p) or p in addr[:6] for p in PREFS) and not r.get("pref"):
        return False, "住所に都道府県がない"
    if not re.search(r"\d", addr):
        return False, "住所に番地がない"
    if CHAIN_WORDS.search(r["name"] + " " + r.get("owner", "")):
        return False, "チェーン・企業の可能性"
    try:
        od = dt.date.fromisoformat(str(r.get("opened", ""))[:10])
        if not (-90 <= (od - TODAY).days <= 60):
            return False, f"開店日が範囲外 {od}"
    except Exception:
        return False, "開店日がわからない"
    if str(r["name"]) not in text and re.sub(r"\s", "", str(r["name"])) not in re.sub(r"\s", "", text):
        return False, "店名が本文に見つからない"
    return True, ""


# ---------------------------------------------------------------- 3. 受け箱に追記
def norm(s):
    return re.sub(r"\s+", "", str(s or "")).lower()


def research():
    inbox = json.loads(INBOX.read_text(encoding="utf-8")) if INBOX.exists() else {"items": []}
    inbox.setdefault("items", [])
    inbox.setdefault("excluded", [])
    known = set()
    for it in inbox["items"]:
        known.add(norm(it.get("name")))
    if RESEARCH.exists():
        for s in json.loads(RESEARCH.read_text(encoding="utf-8")).get("shops", []):
            known.add(norm(s.get("name")))

    cands = prefilter(collect())
    added, rejected, used = [], [], 0
    seq = 1 + sum(1 for it in inbox["items"] if str(it.get("id", "")).startswith(f"r-{TODAY:%Y%m%d}-"))
    for it in cands:
        if used >= MAX_ARTICLES:
            break
        url = it["link"]
        if it["kind"] == "google":
            url = resolve_google(url)
            if not url:
                continue
        try:
            title, text = article_text(url)
        except Exception as e:
            rejected.append((it["title"], f"本文を読めない: {e}"))
            continue
        if len(text) < 300:
            rejected.append((it["title"], "本文が短い"))
            continue
        used += 1
        r = ask_ai(title or it["title"], url, text)
        ok, why = valid(r, text)
        if not ok:
            rejected.append((it["title"], why))
            continue
        if norm(r["name"]) in known:
            rejected.append((it["title"], "登録ずみ"))
            continue
        known.add(norm(r["name"]))
        item = {
            "id": f"r-{TODAY:%Y%m%d}-{seq}",
            "name": str(r["name"]).strip()[:40],
            "genre": r.get("genre") if r.get("genre") in GENRES else "other",
            "pref": str(r.get("pref", "")).strip(), "city": str(r.get("city", "")).strip(),
            "address": str(r["address"]).strip(),
            "opened": str(r.get("opened", ""))[:10],
            "summary": str(r.get("summary", "")).strip()[:120],
            "background": str(r.get("background", "")).strip()[:120],
            "owner": str(r.get("owner", "")).strip()[:120],
            "sources": [url],
            "found": TODAY.isoformat(),
        }
        seq += 1
        added.append(item)
        log(f"  ＋ {item['name']}（{item['pref']}{item['city']}）")
        time.sleep(4)   # 無料枠の回数制限（1分あたり）に収める

    inbox["items"] = (inbox["items"] + added)[-300:]
    inbox["updated"] = dt.datetime.now(JST).isoformat(timespec="seconds")
    INBOX.write_text(json.dumps(inbox, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"\n追加 {len(added)} 件 ／ AIで確認 {used} 件")
    for t, why in rejected[:40]:
        log(f"  × {t[:50]} … {why}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"## 新店リサーチ {TODAY}\n\n追加 **{len(added)}** 件（AIで確認 {used} 件）\n\n")
            for a in added:
                f.write(f"- {a['name']}（{a['pref']}{a['city']}）{a['opened']} … {a['owner']}\n")
    return len(added)


# ---------------------------------------------------------------- シート → research.json
def publish_from_sheet():
    url = os.environ.get("SHEET_CSV_URL", "").strip()
    if not url:
        log("SHEET_CSV_URL がないので、research.json はそのまま")
        return
    try:
        csv_text = get(url, timeout=30)
    except Exception as e:
        log(f"シートのCSVを取れませんでした: {e}")
        return
    tmp = ROOT / ".sheet.csv"
    tmp.write_text(csv_text, encoding="utf-8")
    os.system(f'cd "{ROOT}" && python3 tools/publish_from_sheet.py "{tmp}"')
    tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step in ("all", "publish"):
        publish_from_sheet()
    if step in ("all", "research"):
        research()
