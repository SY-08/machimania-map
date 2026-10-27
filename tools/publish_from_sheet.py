#!/usr/bin/env python3
"""スプレッドシート「新店」シートのCSV（Google Drive の download_file_content で取ったもの）から data/research.json を作る。
使い方: python3 tools/publish_from_sheet.py <CSVファイル または base64テキストのファイル>
「表示」が TRUE で、緯度・経度がある行だけを書き出す。"""
import base64, csv, io, json, re, sys, datetime, pathlib

GENRES = {"ramen", "udon", "cafe", "sweets", "izakaya", "bakery", "curry", "sushi", "yakiniku", "chinese", "western", "other"}

def load(path):
    raw = pathlib.Path(path).read_bytes().strip()
    try:
        text = raw.decode("utf-8")
        if "ID," not in text[:20] and '"ID"' not in text[:20]:
            text = base64.b64decode(raw).decode("utf-8")
    except Exception:
        text = base64.b64decode(raw).decode("utf-8")
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))

def num(v):
    try: return float(v)
    except: return None

def main():
    rows = load(sys.argv[1])
    if not rows or "表示" not in rows[0]:
        sys.exit("「新店」シートの見出しが見つかりません（先頭シートが「新店」か確認）")
    shops = []
    for r in rows:
        lat, lng = num(r.get("緯度")), num(r.get("経度"))
        if str(r.get("表示", "")).upper() != "TRUE" or lat is None or lng is None or not r.get("ID"):
            continue
        opened = re.sub(r"[./]", "-", (r.get("開店日") or "").strip())[:10]
        shops.append({
            "id": r["ID"].strip(), "type": "new", "name": r.get("店名", "").strip(),
            "genre": r.get("ジャンル") if r.get("ジャンル") in GENRES else "other",
            "lat": lat, "lng": lng, "opened": opened, "address": r.get("住所", "").strip(),
            "pref": r.get("都道府県", "").strip(), "city": r.get("市区町村", "").strip(),
            "found": re.sub(r"[./]", "-", (r.get("見つけた日") or "").strip())[:10],
            "summary": r.get("概要", "").strip(), "background": r.get("背景", "").strip(),
            "sources": [u for u in re.split(r"\s+", r.get("情報源URL", "")) if u.startswith("https://")][:3],
            "facing": 0,
        })
    out = {"updated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "shops": shops}
    pathlib.Path("data/research.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"data/research.json に {len(shops)} 件書き出しました")

if __name__ == "__main__":
    main()
