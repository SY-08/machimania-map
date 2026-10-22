#!/usr/bin/env python3
"""
まちマニアMAP 全国の地図データを作るスクリプト（Python 標準ライブラリだけで動きます）

出力:
  data/japan/index.json        … 全国の市区町村・駅の一覧、全国マップ用の輪郭、タイルの一覧
  data/japan/tiles/{x}_{z}.json … 80km 四方ごとの地図（陸地・境界・鉄道・駅・道路・川）

データの出典:
  行政界   … 国土数値情報 N03（smartnews-smri/japan-topography 経由）
  鉄道・駅 … 関東：Mini Tokyo 3D（公共交通オープンデータ由来、線路の形が正確）
             全国：駅データ（piuccio/open-data-jp-railway-stations）の駅を順につないだ線
             --rail n02 のときは国土数値情報 N02（全国の線路の形が正確）
  道路・川 … OpenStreetMap（Overpass API）。取れないときは tools/approx/ の仮データ

使い方:
  python3 tools/build_japan.py                      # 道路は OSM を試し、だめなら仮データ
  python3 tools/build_japan.py --roads approx       # 道路は仮データのみ（速い）
  python3 tools/build_japan.py --rail n02           # 鉄道を国土数値情報 N02 で作る
  python3 tools/build_japan.py --cache .cache       # ダウンロードを保存して2回目から速く
"""
import argparse
import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "japan")

N03_URL = "https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_{pref}_210101.json"
MT3D = "https://raw.githubusercontent.com/nagix/mini-tokyo-3d/master/data/"
EKI_STATIONS = "https://raw.githubusercontent.com/piuccio/open-data-jp-railway-stations/master/stations.json"
EKI_LINES = "https://raw.githubusercontent.com/piuccio/open-data-jp-railway-lines/master/lines.json"
N02_URLS = [
    "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-24/N02-24_GML.zip",
    "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-23/N02-23_GML.zip",
    "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-22/N02-22_GML.zip",
]
OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
SKIP_RAIL = ("Freight", "Connection", "Base.", "Direct")
PALETTE = ["#e8805a", "#5aa0e0", "#8a6fd0", "#e0b23c", "#4fae8a", "#d9668f", "#6c8fb8", "#b88a4f", "#5fbf6a", "#c46a4a"]


# ================================================================ 取得
def fetch(url, cache=None, data=None, timeout=180):
    path = None
    if cache:
        os.makedirs(cache, exist_ok=True)
        key = urllib.parse.quote(url + (data.decode()[:400] if data else ""), safe="")[-180:]
        path = os.path.join(cache, key)
        if os.path.exists(path):
            return open(path, "rb").read()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "machimania-map-builder/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if path:
        open(path, "wb").write(body)
    return body


def fetch_json(url, cache=None, data=None, timeout=180):
    return json.loads(fetch(url, cache, data, timeout).decode("utf-8"))


# ================================================================ 座標
class Proj:
    def __init__(self, origin, mpu):
        self.lat0, self.lng0, self.mpu = origin["lat"], origin["lng"], mpu
        self.kx = math.cos(math.radians(self.lat0)) * 111320.0
        self.kz = 110540.0

    def xz(self, lng, lat):
        return [round((lng - self.lng0) * self.kx / self.mpu, 1), round((self.lat0 - lat) * self.kz / self.mpu, 1)]

    def lnglat(self, x, z):
        return (self.lng0 + x * self.mpu / self.kx, self.lat0 - z * self.mpu / self.kz)


# ================================================================ 幾何
def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        best, idx = 0, -1
        for i in range(a + 1, b):
            d = seg_dist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1])
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def ring_area(r):
    return 0.5 * sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))


def bbox(points):
    xs = [p[0] for p in points]
    zs = [p[1] for p in points]
    return [min(xs), min(zs), max(xs), max(zs)]


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def clip_line_rect(pts, r):
    """折れ線を長方形 r=[x0,z0,x1,z1] で切る（Liang-Barsky を区間ごとに）"""
    out, cur = [], []

    def clip_seg(a, b):
        t0, t1 = 0.0, 1.0
        dx, dz = b[0] - a[0], b[1] - a[1]
        for p, q in ((-dx, a[0] - r[0]), (dx, r[2] - a[0]), (-dz, a[1] - r[1]), (dz, r[3] - a[1])):
            if p == 0:
                if q < 0:
                    return None
            else:
                t = q / p
                if p < 0:
                    if t > t1:
                        return None
                    t0 = max(t0, t)
                else:
                    if t < t0:
                        return None
                    t1 = min(t1, t)
        return ([round(a[0] + dx * t0, 1), round(a[1] + dz * t0, 1)], [round(a[0] + dx * t1, 1), round(a[1] + dz * t1, 1)], t0 > 0, t1 < 1)

    for a, b in zip(pts, pts[1:]):
        c = clip_seg(a, b)
        if not c:
            if cur:
                out.append(cur)
                cur = []
            continue
        p, q, enter, leave = c
        if not cur or enter:
            if cur:
                out.append(cur)
            cur = [p]
        cur.append(q)
        if leave:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [c for c in out if len(c) >= 2]


class SegGrid:
    def __init__(self, cell):
        self.cell = cell
        self.g = defaultdict(list)

    def add(self, item, a, b):
        c = self.cell
        for gx in range(int(math.floor(min(a[0], b[0]) / c)), int(math.floor(max(a[0], b[0]) / c)) + 1):
            for gz in range(int(math.floor(min(a[1], b[1]) / c)), int(math.floor(max(a[1], b[1]) / c)) + 1):
                self.g[(gx, gz)].append((item, a, b))

    def near(self, x, z, r):
        c = self.cell
        seen = set()
        for gx in range(int(math.floor((x - r) / c)), int(math.floor((x + r) / c)) + 1):
            for gz in range(int(math.floor((z - r) / c)), int(math.floor((z + r) / c)) + 1):
                for it in self.g.get((gx, gz), ()):
                    k = id(it)
                    if k not in seen:
                        seen.add(k)
                        yield it


# ================================================================ 行政界
def load_munis(proj, cache):
    groups = {}
    for p in range(1, 48):
        pref = f"{p:02d}"
        print(f"  行政界 {pref}", end="\r")
        for f in fetch_json(N03_URL.format(pref=pref), cache)["features"]:
            pr = f["properties"]
            code = pr.get("N03_007")
            if not code:
                continue
            g = f["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
            m = groups.setdefault(code, {"code": code, "pref": pr.get("N03_001") or "",
                                         "name": (pr.get("N03_003") or "") + (pr.get("N03_004") or ""), "polys": []})
            for poly in polys:
                rings = []
                for ring in poly:
                    pts = [proj.xz(q[0], q[1]) for q in ring]
                    if len(pts) > 1 and pts[0] == pts[-1]:
                        pts = pts[:-1]
                    pts = simplify(pts + [pts[0]], 0.35)[:-1] if len(pts) > 4 else pts
                    rings.append(pts)
                if len(rings[0]) >= 3 and abs(ring_area(rings[0])) >= 3.0:
                    m["polys"].append([r for r in rings if len(r) >= 3])
    print()
    munis = [m for m in groups.values() if m["polys"]]
    for m in munis:
        allp = [pt for poly in m["polys"] for pt in poly[0]]
        m["bbox"] = bbox(allp)
        big = max(m["polys"], key=lambda p: abs(ring_area(p[0])))[0]
        m["label"] = [round(sum(p[0] for p in big) / len(big), 1), round(sum(p[1] for p in big) / len(big), 1)]
    return munis


def classify_borders(munis):
    """市区町村の境界線を「市境」「都道府県境」「海岸」に分ける"""
    grid = SegGrid(6.0)
    for mi, m in enumerate(munis):
        for poly in m["polys"]:
            for ring in poly:
                for i in range(len(ring)):
                    a, b = ring[i], ring[(i + 1) % len(ring)]
                    grid.add(mi, a, b)
    out = []
    TH = 5.0
    for mi, m in enumerate(munis):
        for poly in m["polys"]:
            for ring in poly:
                n = len(ring)
                classes = []
                for i in range(n):
                    a, b = ring[i], ring[(i + 1) % n]
                    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                    best, bd = None, TH
                    for oj, p, q in grid.near(mx, mz, TH):
                        if oj == mi:
                            continue
                        d = seg_dist(mx, mz, p[0], p[1], q[0], q[1])
                        if d < bd:
                            bd, best = d, oj
                    classes.append(best)
                # 同じ相手が続く区間をまとめる
                start = 0
                for i in range(1, n + 1):
                    if i == n or classes[i] != classes[start]:
                        nb = classes[start]
                        pts = [ring[k % n] for k in range(start, i + 1)]
                        if nb is None:
                            out.append({"cls": "coast", "a": m["code"], "pts": pts})
                        elif m["code"] < munis[nb]["code"]:
                            cls = "pref" if munis[nb]["code"][:2] != m["code"][:2] else "city"
                            out.append({"cls": cls, "a": m["code"], "b": munis[nb]["code"], "pts": pts})
                        start = i
    return out


# ================================================================ 鉄道
def is_subway(lid, full):
    if lid.startswith(("TokyoMetro.", "YokohamaMunicipal.")):
        return True
    if lid.startswith("Toei.") and lid not in ("Toei.Arakawa", "Toei.NipporiToneri"):
        return True
    return any(k in full for k in ("地下鉄", "メトロ", "大阪市高速電気軌道")) and "ニュートラム" not in full and "南港ポートタウン" not in full


def short_line_name(n):
    n = n.replace("ＪＲ", "JR")
    for k, v in (("大阪市高速電気軌道", "Osaka Metro"), ("東京地下鉄", "東京メトロ"), ("都営地下鉄", "都営"), ("名古屋市営地下鉄", "名古屋市営"),
                 ("横浜市営地下鉄", "横浜市営"), ("札幌市営地下鉄", "札幌市営"), ("福岡市地下鉄", "福岡市営"), ("京都市営地下鉄", "京都市営"),
                 ("神戸市営地下鉄", "神戸市営"), ("仙台市地下鉄", "仙台市営")):
        n = n.replace(k, v)
    if n.startswith("JR") and not n.startswith("JR西日本") and "新幹線" not in n:
        n = n[2:]
    if "(" in n:
        n = n[: n.index("(")]
    if "（" in n:
        n = n[: n.index("（")]
    return n.strip() or n


# 新幹線（駅データに入っていないので、駅の並びから作る。位置は同じ名前の在来線の駅を使う）
SHINKANSEN = {
    "S-Tokaido": ("東海道新幹線", "#1f63c6", "東京 品川 新横浜 小田原 熱海 三島 新富士 静岡 掛川 浜松 豊橋 三河安城 名古屋 岐阜羽島 米原 京都 新大阪"),
    "S-Sanyo": ("山陽新幹線", "#2a74d0", "新大阪 新神戸 西明石 姫路 相生 岡山 新倉敷 福山 新尾道 三原 東広島 広島 新岩国 徳山 新山口 厚狭 新下関 小倉 博多"),
    "S-Tohoku": ("東北新幹線", "#2d9b5a", "東京 上野 大宮 小山 宇都宮 那須塩原 新白河 郡山 福島 白石蔵王 仙台 古川 くりこま高原 一ノ関 水沢江刺 北上 新花巻 盛岡 いわて沼宮内 二戸 八戸 七戸十和田 新青森"),
    "S-Hokkaido": ("北海道新幹線", "#4fae8a", "新青森 奥津軽いまべつ 木古内 新函館北斗"),
    "S-Joetsu": ("上越新幹線", "#d9663e", "大宮 熊谷 本庄早稲田 高崎 上毛高原 越後湯沢 浦佐 長岡 燕三条 新潟"),
    "S-Hokuriku": ("北陸新幹線", "#8a6fd0", "高崎 安中榛名 軽井沢 佐久平 上田 長野 飯山 上越妙高 糸魚川 黒部宇奈月温泉 富山 新高岡 金沢 小松 加賀温泉 芦原温泉 福井 越前たけふ 敦賀"),
    "S-Kyushu": ("九州新幹線", "#c94a3f", "博多 新鳥栖 久留米 筑後船小屋 新大牟田 新玉名 熊本 新八代 新水俣 出水 川内 鹿児島中央"),
    "S-NishiKyushu": ("西九州新幹線", "#c96a2f", "武雄温泉 嬉野温泉 新大村 諫早 長崎"),
}
# 駅データにない新しい駅（緯度, 経度）
EXTRA_STATIONS = {
    "越前たけふ": (35.9036, 136.2072), "嬉野温泉": (33.1028, 130.0569), "新大村": (32.9350, 129.9582),
    "奥津軽いまべつ": (41.1450, 140.5150), "新函館北斗": (41.9049, 140.6486), "黒部宇奈月温泉": (36.8746, 137.4810),
    "上越妙高": (37.0656, 138.2470), "佐久平": (36.2780, 138.4630), "安中榛名": (36.3580, 138.8436),
    "新大牟田": (33.0590, 130.4810), "新玉名": (32.9332, 130.5640),
    "岐阜羽島": (35.3160, 136.6855), "新尾道": (34.4269, 133.1878), "東広島": (34.4168, 132.7650), "新岩国": (34.1564, 132.1563),
    "白石蔵王": (38.0040, 140.6260), "くりこま高原": (38.7480, 141.0730), "水沢江刺": (39.1418, 141.1885), "七戸十和田": (40.7206, 141.1537),
    "本庄早稲田": (36.2185, 139.1786), "上毛高原": (36.6840, 138.9790),
}


def add_shinkansen(proj, lines, stations, raw_points):
    """raw_points: 名前 → [(x, z), ...]（同じ名前の駅の候補）"""
    for lid, (name, color, seq) in SHINKANSEN.items():
        order, prev = [], None
        for nm in seq.split():
            cands = list(raw_points.get(nm, []))
            if nm in EXTRA_STATIONS:
                cands.append(tuple(proj.xz(EXTRA_STATIONS[nm][1], EXTRA_STATIONS[nm][0])))
            if not cands:
                print(f"  新幹線の駅が見つかりません: {nm}", file=sys.stderr)
                continue
            p = min(cands, key=lambda c: 0 if prev is None else math.hypot(c[0] - prev[0], c[1] - prev[1]))
            order.append([nm, round(p[0], 1), round(p[1], 1)])
            prev = p
        if len(order) < 2:
            continue
        lines[lid] = {"name": name, "color": color, "kind": "shinkansen", "segs": [[[o[1], o[2]] for o in order]], "order": order, "approx": True}
        for o in order:
            hub = min((st for st in stations if st["name"] == o[0]), default=None,
                      key=lambda st: math.hypot(st["pos"][0] - o[1], st["pos"][1] - o[2]))
            if hub and math.hypot(hub["pos"][0] - o[1], hub["pos"][1] - o[2]) < 25:
                if lid not in hub["lines"]:
                    hub["lines"].insert(0, lid)
            else:
                stations.append({"name": o[0], "pos": [o[1], o[2]], "lines": [lid]})


def build_rail_fallback(proj, cache):
    """関東は Mini Tokyo 3D、それ以外は駅を順につないだ線"""
    rail_meta = {r["id"]: r for r in fetch_json(MT3D + "railways.json", cache)}
    coords = fetch_json(MT3D + "coordinates.json", cache)["railways"]
    mt_stations = {s["id"]: s for s in fetch_json(MT3D + "stations.json", cache) if "coord" in s}
    mt_ids = set()
    lines = {}
    for r in coords:
        rid = r["id"]
        if any(k in rid for k in SKIP_RAIL) or rid not in rail_meta:
            continue
        segs = []
        for sub in r.get("sublines", []):
            c = sub.get("coords")
            if not c:
                continue
            st = sub.get("start") or {}
            shared = st.get("railway")
            if sub.get("type") == "sub" and shared and shared != rid and shared in rail_meta \
                    and not st.get("offset") and not any(k in shared for k in SKIP_RAIL):
                continue
            pts = simplify([proj.xz(q[0], q[1]) for q in c], 0.25)
            if len(pts) >= 2:
                segs.append(pts)
        if segs:
            mt_ids.add(rid)
            order = []
            for sid in rail_meta[rid].get("stations", []):
                st = mt_stations.get(sid)
                if st:
                    x, z = proj.xz(st["coord"][0], st["coord"][1])
                    order.append([st["title"]["ja"], x, z])
            lines[rid] = {"name": rail_meta[rid]["title"]["ja"], "color": r.get("color") or rail_meta[rid].get("color") or "#888888",
                          "kind": "subway" if is_subway(rid, "") else "normal", "segs": segs, "order": order}

    groups = fetch_json(EKI_STATIONS, cache)
    eki_lines = {l["ekidata_id"]: l for l in fetch_json(EKI_LINES, cache)}
    by_line = defaultdict(list)
    for g in groups:
        for s in g["stations"]:
            by_line[s["ekidata_line_id"]].append(s)
    covered = {}
    for lid, sts in by_line.items():
        codes = Counter(s["line_code"] for s in sts if s.get("line_code") in mt_ids)
        if codes:
            covered[lid] = codes.most_common(1)[0][0]
    for lid, sts in by_line.items():
        if lid in covered:
            continue
        info = eki_lines.get(lid, {})
        full = info.get("name_kanji", "") or lid
        shin = "新幹線" in full
        sts = sorted(sts, key=lambda s: s["ekidata_id"])
        segs, cur = [], []
        gap = 120000 if shin else 45000
        for s in sts:
            p = proj.xz(s["lon"], s["lat"])
            if cur and math.hypot(p[0] - cur[-1][0], p[1] - cur[-1][1]) * proj.mpu > gap:
                if len(cur) >= 2:
                    segs.append(cur)
                cur = []
            cur.append(p)
        if len(cur) >= 2:
            segs.append(cur)
        if not segs:
            continue
        order = [[s["name_kanji"], *proj.xz(s["lon"], s["lat"])] for s in sts]
        lines["E" + lid] = {"order": order, "name": short_line_name(full), "full": full,
                            "color": "#3b78d8" if shin else PALETTE[int(lid) % len(PALETTE)],
                            "kind": "shinkansen" if shin else "subway" if is_subway("", full) else "normal", "segs": segs, "approx": True}
    # 駅（同じ駅グループをまとめる）
    stations = []
    subgroups = []
    for g in groups:
        by_name = defaultdict(list)
        for s in g["stations"]:
            if s.get("lat"):
                by_name[s.get("name_kanji") or g["name_kanji"]].append(s)
        for nm, sts in by_name.items():
            subgroups.append((nm, sts))
    for name, sts in subgroups:
        ids = []
        for s in sts:
            lid = s["ekidata_line_id"]
            if lid in covered:
                rid = s["line_code"] if s.get("line_code") in mt_ids else covered[lid]
            else:
                rid = "E" + lid
            if rid in lines and rid not in ids:
                ids.append(rid)
        if not ids:
            continue
        x = sum(proj.xz(s["lon"], s["lat"])[0] for s in sts) / len(sts)
        z = sum(proj.xz(s["lon"], s["lat"])[1] for s in sts) / len(sts)
        stations.append({"name": name, "pos": [round(x, 1), round(z, 1)], "lines": ids})
    raw_points = defaultdict(list)
    for g in groups:
        for st in g["stations"]:
            if st.get("lat"):
                raw_points[st.get("name_kanji") or g["name_kanji"]].append(tuple(proj.xz(st["lon"], st["lat"])))
    add_shinkansen(proj, lines, stations, raw_points)
    return lines, stations, "mt3d+ekidata"


def build_rail_n02(proj, cache):
    """国土数値情報 N02（全国の線路の形）。GitHub Actions など国の配布サイトに届く環境で使います"""
    body, used = None, None
    for url in N02_URLS:
        try:
            body = fetch(url, cache, timeout=600)
            used = url
            break
        except Exception as ex:  # noqa: BLE001
            print(f"  N02 取得失敗 {url}: {ex}", file=sys.stderr)
    if body is None:
        raise RuntimeError("N02 を取得できませんでした")
    zf = zipfile.ZipFile(io.BytesIO(body))
    names = zf.namelist()
    sec = next(n for n in names if n.lower().endswith("railroadsection.geojson"))
    stn = next(n for n in names if n.lower().endswith("station.geojson"))
    mt_colors = {}
    try:
        for r in fetch_json(MT3D + "railways.json", cache):
            mt_colors[r["title"]["ja"]] = r.get("color")
    except Exception:  # noqa: BLE001
        pass
    lines = {}
    for f in json.loads(zf.read(sec).decode("utf-8"))["features"]:
        p = f["properties"]
        line, company = p.get("N02_003", ""), p.get("N02_004", "")
        key = "N" + str(abs(hash(company + "|" + line)) % 10 ** 9)
        g = f["geometry"]
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        shin = "新幹線" in line
        L = lines.setdefault(key, {"name": line, "company": company, "kind": "shinkansen" if shin else "subway" if is_subway("", company + line) else "normal",
                                   "color": "#3b78d8" if shin else mt_colors.get(line) or PALETTE[abs(hash(line)) % len(PALETTE)],
                                   "segs": []})
        for c in parts:
            pts = simplify([proj.xz(q[0], q[1]) for q in c], 0.25)
            if len(pts) >= 2:
                L["segs"].append(pts)
    hubs = []
    grid = defaultdict(list)
    for f in json.loads(zf.read(stn).decode("utf-8"))["features"]:
        p = f["properties"]
        g = f["geometry"]
        c = g["coordinates"] if g["type"] == "LineString" else [q for part in g["coordinates"] for q in part]
        lng = sum(q[0] for q in c) / len(c)
        lat = sum(q[1] for q in c) / len(c)
        x, z = proj.xz(lng, lat)
        name = p.get("N02_005", "")
        key = "N" + str(abs(hash(p.get("N02_004", "") + "|" + p.get("N02_003", ""))) % 10 ** 9)
        gk = (int(x // 20), int(z // 20))
        hub = None
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for h in grid[(gk[0] + dx, gk[1] + dz)]:
                    if h["name"] == name and math.hypot(h["pos"][0] - x, h["pos"][1] - z) < 15:
                        hub = h
        if hub is None:
            hub = {"name": name, "pos": [x, z], "lines": [], "_n": 0}
            hubs.append(hub)
            grid[gk].append(hub)
        if key in lines and key not in hub["lines"]:
            hub["lines"].append(key)
    for h in hubs:
        h.pop("_n", None)
    return lines, [h for h in hubs if h["lines"]], "n02:" + used.rsplit("/", 1)[-1]


def fill_line_orders(lines, stations):
    """駅の順番がない路線（N02 など）は、線路の上に駅を投影して順番を決める"""
    by_line = defaultdict(list)
    for s in stations:
        for lid in s["lines"]:
            by_line[lid].append(s)
    for lid, L in lines.items():
        if L.get("order"):
            continue
        segs = sorted(L["segs"], key=lambda sg: -len(sg))
        if not segs or not by_line.get(lid):
            continue
        path = segs[0]
        cum = [0.0]
        for a, b in zip(path, path[1:]):
            cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        res = []
        for s in by_line[lid]:
            best, bs = 1e9, 0
            for i, (a, b) in enumerate(zip(path, path[1:])):
                d = seg_dist(s["pos"][0], s["pos"][1], a[0], a[1], b[0], b[1])
                if d < best:
                    L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
                    t = 0 if L2 == 0 else max(0, min(1, ((s["pos"][0] - a[0]) * (b[0] - a[0]) + (s["pos"][1] - a[1]) * (b[1] - a[1])) / L2))
                    best, bs = d, cum[i] + t * (cum[i + 1] - cum[i])
            if best < 30:
                res.append((bs, [s["name"], s["pos"][0], s["pos"][1]]))
        L["order"] = [o for _, o in sorted(res)]


# ================================================================ 道路・川（OSM）
def overpass(q, cache):
    last = None
    for url in OVERPASS_URLS:
        try:
            return json.loads(fetch(url, cache, data=urllib.parse.urlencode({"data": q}).encode(), timeout=900).decode("utf-8"))
        except Exception as ex:  # noqa: BLE001
            last = ex
            print(f"  Overpass 失敗 ({url}): {ex}", file=sys.stderr)
            time.sleep(10)
    raise RuntimeError(last)


ROAD_CLASS = {"motorway": "highway", "trunk": "major", "primary": "major", "secondary": "minor", "tertiary": "minor"}


def osm_layers(osm, proj, tol):
    roads, rivers = [], []
    for el in osm.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        t = el.get("tags", {})
        pts = simplify([proj.xz(g["lon"], g["lat"]) for g in el["geometry"]], tol)
        if len(pts) < 2:
            continue
        if "highway" in t:
            roads.append({"name": t.get("name", ""), "cls": ROAD_CLASS.get(t["highway"], "minor"), "pts": pts})
        elif t.get("waterway") == "river":
            rivers.append({"name": t.get("name", ""), "pts": pts})
    return roads, rivers


def fetch_osm(world, munis, shops, proj, cache):
    roads, rivers, done_prefs = [], [], set()
    classes = world.get("osmNationalRoads", ["motorway", "trunk", "primary"])
    by_pref = defaultdict(list)
    for m in munis:
        by_pref[m["code"][:2]].append(m)
    for pref, ms in sorted(by_pref.items()):
        bb = [min(m["bbox"][0] for m in ms), min(m["bbox"][1] for m in ms), max(m["bbox"][2] for m in ms), max(m["bbox"][3] for m in ms)]
        w, n = proj.lnglat(bb[0], bb[1])
        e, s = proj.lnglat(bb[2], bb[3])
        q = f"""[out:json][timeout:800][maxsize:1073741824];
(way["highway"~"^({"|".join(classes)})$"]({s},{w},{n},{e});
 way["waterway"="river"]["name"]({s},{w},{n},{e}););
out tags geom;"""
        try:
            print(f"  OSM 都道府県 {pref}")
            r, v = osm_layers(overpass(q, cache), proj, 0.4)
            roads += r
            rivers += v
            done_prefs.add(pref)
            time.sleep(5)
        except Exception as ex:  # noqa: BLE001
            print(f"  → {pref} は道路なし（{ex}）", file=sys.stderr)
    # お店のまわりは細い道路まで
    detail = world.get("osmDetailRoads", ["secondary", "tertiary"])
    rad = world.get("osmDetailRadiusDeg", 0.03)
    boxes = []
    for s in shops:
        if s.get("lat") is None:
            continue
        b = [s["lat"] - rad, s["lng"] - rad, s["lat"] + rad, s["lng"] + rad]
        for bx in boxes:
            if not (b[2] < bx[0] or b[0] > bx[2] or b[3] < bx[1] or b[1] > bx[3]):
                bx[:] = [min(bx[0], b[0]), min(bx[1], b[1]), max(bx[2], b[2]), max(bx[3], b[3])]
                break
        else:
            boxes.append(b)
    for b in boxes:
        q = f"""[out:json][timeout:300];
way["highway"~"^({"|".join(detail)})$"]({b[0]},{b[1]},{b[2]},{b[3]});
out tags geom;"""
        try:
            r, _ = osm_layers(overpass(q, cache), proj, 0.3)
            roads += r
            time.sleep(5)
        except Exception as ex:  # noqa: BLE001
            print(f"  → お店まわりの道路なし（{ex}）", file=sys.stderr)
    return roads, rivers, done_prefs


def approx_layers(proj, done_prefs):
    roads, rivers = [], []
    d = os.path.join(ROOT, "tools", "approx")
    if not os.path.isdir(d):
        return roads, rivers
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".json") or fn[:2] in done_prefs:
            continue
        src = json.load(open(os.path.join(d, fn), encoding="utf-8"))
        roads += [{"name": r["name"], "cls": r["class"], "approx": True, "pts": [proj.xz(lng, lat) for lat, lng in r["latlng"]]} for r in src.get("roads", [])]
        rivers += [{"name": r["name"], "approx": True, "pts": [proj.xz(lng, lat) for lat, lng in r["latlng"]]} for r in src.get("rivers", [])]
    return roads, rivers


# ================================================================ メイン
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roads", choices=["auto", "osm", "approx"], default="auto")
    ap.add_argument("--rail", choices=["auto", "n02", "fallback"], default="fallback")
    ap.add_argument("--cache", default=None)
    args = ap.parse_args()

    world = json.load(open(os.path.join(DATA, "world.json"), encoding="utf-8"))
    proj = Proj(world["origin"], world["metersPerUnit"])
    T = world.get("tileSize", 2000)

    print("行政界を取得")
    munis = load_munis(proj, args.cache)
    print(f"  市区町村 {len(munis)}")
    print("境界を分類")
    borders = classify_borders(munis)
    print(f"  境界線 {len(borders)}")

    print("鉄道・駅")
    rail = None
    if args.rail in ("auto", "n02"):
        try:
            rail = build_rail_n02(proj, args.cache)
        except Exception as ex:  # noqa: BLE001
            if args.rail == "n02":
                raise
            print(f"  → N02 が使えないので駅データで作ります（{ex}）", file=sys.stderr)
    if rail is None:
        rail = build_rail_fallback(proj, args.cache)
    lines, stations, rail_source = rail
    fill_line_orders(lines, stations)
    print(f"  路線 {len(lines)} / 駅 {len(stations)} ({rail_source})")

    shops = json.load(open(os.path.join(DATA, "shops.json"), encoding="utf-8")).get("shops", [])
    roads, rivers, done = [], [], set()
    if args.roads in ("auto", "osm"):
        try:
            roads, rivers, done = fetch_osm(world, munis, shops, proj, args.cache)
        except Exception as ex:  # noqa: BLE001
            if args.roads == "osm":
                raise
            print(f"  → OSM なし（{ex}）", file=sys.stderr)
    ar, av = approx_layers(proj, done)
    roads += ar
    rivers += av
    # 境界が川になっているところ（OSM の川がない都道府県だけ）
    mby = {m["code"]: m for m in munis}
    for br in world.get("borderRivers", []):
        if br["code"][:2] in done:
            continue
        for b in borders:
            if b["cls"] == "coast":
                continue
            pair = {b["a"], b.get("b")}
            if br["code"] in pair:
                other = (pair - {br["code"]}).pop()
                if other in mby and any(n in mby[other]["name"] for n in br["neighbors"]) and len(b["pts"]) >= 3:
                    rivers.append({"name": br["name"], "fromBorder": br["code"], "pts": b["pts"]})
    print(f"  道路 {len(roads)} / 川 {len(rivers)}")

    # ------------------------------------------------ タイルに分ける
    tiles = defaultdict(lambda: {"munis": [], "borders": [], "rail": defaultdict(list), "stations": [], "roads": [], "rivers": []})

    def tiles_for_bbox(bb):
        for tx in range(int(math.floor(bb[0] / T)), int(math.floor(bb[2] / T)) + 1):
            for tz in range(int(math.floor(bb[1] / T)), int(math.floor(bb[3] / T)) + 1):
                yield tx, tz

    for m in munis:
        for poly in m["polys"]:
            pb = bbox(poly[0])
            for k in tiles_for_bbox(pb):
                lst = tiles[k]["munis"]
                ent = next((e for e in lst if e["code"] == m["code"]), None)
                if not ent:
                    ent = {"code": m["code"], "name": m["name"], "pref": m["pref"], "polys": []}
                    lst.append(ent)
                ent["polys"].append(poly)

    def add_lines(items, key, mk):
        for it in items:
            pts = it["pts"]
            for k in tiles_for_bbox(bbox(pts)):
                r = [k[0] * T, k[1] * T, (k[0] + 1) * T, (k[1] + 1) * T]
                for part in clip_line_rect(pts, r):
                    tiles[k][key].append(mk(it, part))

    add_lines(borders, "borders", lambda it, p: {"cls": it["cls"], "pts": p, **({"a": it["a"], "b": it["b"]} if it.get("b") else {"a": it["a"]})})
    add_lines(roads, "roads", lambda it, p: {k: v for k, v in {**it, "pts": p}.items()})
    add_lines(rivers, "rivers", lambda it, p: {k: v for k, v in {**it, "pts": p}.items()})
    for lid, L in lines.items():
        for seg in L["segs"]:
            for k in tiles_for_bbox(bbox(seg)):
                r = [k[0] * T, k[1] * T, (k[0] + 1) * T, (k[1] + 1) * T]
                for part in clip_line_rect(seg, r):
                    tiles[k]["rail"][lid].append(part)
    for s in stations:
        k = (int(math.floor(s["pos"][0] / T)), int(math.floor(s["pos"][1] / T)))
        tiles[k]["stations"].append(s)

    os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
    for fn in os.listdir(os.path.join(OUT, "tiles")):
        os.remove(os.path.join(OUT, "tiles", fn))
    tile_list = []
    for (tx, tz), t in sorted(tiles.items()):
        if not t["munis"]:
            continue
        key = f"{tx}_{tz}"
        t["rail"] = [{"id": k, "segs": v} for k, v in t["rail"].items()]
        with open(os.path.join(OUT, "tiles", key + ".json"), "w", encoding="utf-8") as f:
            json.dump({"key": key, **t}, f, ensure_ascii=False, separators=(",", ":"))
        tile_list.append(key)

    # ------------------------------------------------ 全国マップ用
    over_land = []
    for m in munis:
        for poly in m["polys"]:
            if abs(ring_area(poly[0])) < 60:
                continue
            r = simplify(poly[0] + [poly[0][0]], 6)[:-1]
            if len(r) >= 3:
                over_land.append([[round(p[0]), round(p[1])] for p in r])
    over_pref = []
    for b in borders:
        if b["cls"] == "pref":
            r = simplify(b["pts"], 6)
            if len(r) >= 2:
                over_pref.append([[round(p[0]), round(p[1])] for p in r])
    prefs = {}
    for m in munis:
        p = prefs.setdefault(m["code"][:2], {"code": m["code"][:2], "name": m["pref"], "xs": [], "zs": []})
        p["xs"].append(m["label"][0])
        p["zs"].append(m["label"][1])
    pref_list = [{"code": p["code"], "name": p["name"],
                  "label": [round(sorted(p["xs"])[len(p["xs"]) // 2]), round(sorted(p["zs"])[len(p["zs"]) // 2])]} for p in prefs.values()]
    index = {
        "built": time.strftime("%Y-%m-%d"),
        "tileSize": T,
        "railSource": rail_source,
        "roadsFromOsm": sorted(done),
        "lines": {k: {"name": v["name"], "color": v["color"], "kind": v["kind"], **({"approx": True} if v.get("approx") else {})} for k, v in lines.items()},
        "prefs": sorted(pref_list, key=lambda p: p["code"]),
        "munis": [{"code": m["code"], "name": m["name"], "pref": m["pref"], "label": m["label"], "bbox": [round(v) for v in m["bbox"]]} for m in sorted(munis, key=lambda m: m["code"])],
        "stations": [{"n": s["name"], "p": [round(s["pos"][0]), round(s["pos"][1])], "l": list(dict.fromkeys(lines[i]["name"] for i in s["lines"]))[:4]} for s in stations],
        "overview": {"land": over_land, "pref": over_pref},
        "tiles": tile_list,
        "lineStations": {k: [[o[0], round(o[1]), round(o[2])] for o in v.get("order", [])] for k, v in lines.items() if v.get("order")},
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    total = sum(os.path.getsize(os.path.join(OUT, "tiles", k + ".json")) for k in tile_list)
    print(f"タイル {len(tile_list)} 枚 / 合計 {total / 1e6:.1f} MB / index {os.path.getsize(os.path.join(OUT, 'index.json')) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
