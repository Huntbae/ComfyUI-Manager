#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
사이클카트/사이클카 역사 이미지를 위키미디어 공용(Wikimedia Commons)에서 받아온다.

원칙
  - 라이선스는 내가 추측하지 않는다. Commons API가 돌려주는 라이선스 값만 믿는다.
  - 재사용 가능(퍼블릭도메인·CC0·CC BY·CC BY-SA)만 받는다. 그 외는 버린다.
  - 받은 사진의 저작자·라이선스를 원고 캡션에 그대로 박아 넣는다 (--apply, 기본 켜짐).

사용법
  python3 scripts/fetch_history_images.py            # 받고 캡션까지 채움
  python3 scripts/fetch_history_images.py --dry-run  # 뭘 받을지만 보여줌
  python3 scripts/fetch_history_images.py --no-apply # 받기만 하고 캡션은 그대로
"""
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, "images")
ARTICLES = os.path.join(ROOT, "articles")
MANIFEST = os.path.join(ROOT, ".auth", "history-credits.json")
CREDITS_MD = os.path.join(IMAGES, "CREDITS_history.md")

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia는 실명 User-Agent를 요구한다. 없으면 403.
UA = "ClanHunts-BlogAutoWriter/1.0 (https://blog.naver.com/huntbae; huntbae@huntbae.com)"

# 원고가 쓰는 슬롯 -> 어느 카테고리에서 뽑을지
SLOTS = [
    ("hist_cyclecar", 7, [
        "Category:Cyclecars",
        "Category:Bédélia vehicles",
        "Category:GN (car)",
    ]),
    ("hist_cyclekart", 2, [
        "Category:Cyclekart",
        "Category:Cyclecars",   # 사이클카트 카테고리가 4장뿐이라 모자라면 여기서 보충
    ]),
    # 사이클카트가 형태를 빌려온 1920~30년대 그랑프리 카
    ("hist_gpcar", 1, [
        "Category:Bugatti Type 35 (original)",
        "Category:Bugatti Type 35",
        "Category:Bugatti racing cars",
        "Category:Grand Prix cars",
    ]),
    # 사이클카 세대에서 유일하게 살아남은 계열
    ("hist_morgan", 2, [
        "Category:Morgan 3-Wheeler (Vintage)",
        "Category:Morgan 3-Wheeler",
        "Category:Morgan three-wheelers",
        "Category:Morgan vehicles",
    ]),
]

# 재사용 가능하다고 볼 라이선스. Commons의 License / LicenseShortName 값 기준.
# 파일명·설명이 모두 쓸모없을 때 쓸 최소한의 설명
FALLBACK_DESC = {
    "hist_cyclecar": "1910~20년대 사이클카",
    "hist_cyclekart": "사이클카트",
    "hist_gpcar": "1920~30년대 그랑프리 카",
    "hist_morgan": "모건 3륜차",
}

FREE_HINTS = ("pd", "public domain", "cc0", "cc-by", "cc by", "cc-zero", "attribution")
BLOCK_HINTS = ("fair use", "non-free", "nonfree", "noncommercial", "nc-", "-nd", " nd ")
EXT_OK = (".jpg", ".jpeg", ".png")


def flag(name):
    return f"--{name}" in sys.argv


def api(params):
    params = dict(params, format="json", formatversion="2")
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def meta_get(ext, key):
    v = ext.get(key)
    if isinstance(v, dict):
        return strip_html(v.get("value", ""))
    return strip_html(v or "")


def is_free(ext):
    lic = " ".join([
        meta_get(ext, "License"),
        meta_get(ext, "LicenseShortName"),
        meta_get(ext, "UsageTerms"),
    ]).lower()
    if not lic:
        return False
    if any(b in lic for b in BLOCK_HINTS):
        return False
    return any(f in lic for f in FREE_HINTS)


def category_files(cat, limit=200):
    """카테고리 안의 파일 목록 + 메타데이터. 하위 카테고리 1단계까지 훑는다."""
    out = []
    seen_cats = []
    todo = [cat]
    while todo and len(out) < limit:
        c = todo.pop(0)
        if c in seen_cats:
            continue
        seen_cats.append(c)
        try:
            data = api({
                "action": "query",
                "generator": "categorymembers",
                "gcmtitle": c,
                "gcmtype": "file",
                "gcmlimit": "100",
                "prop": "imageinfo",
                "iiprop": "url|extmetadata|size|mime",
                "iiurlwidth": "1400",
            })
        except Exception as e:
            print(f"  ! {c} 조회 실패: {e}")
            continue
        for p in (data.get("query", {}) or {}).get("pages", []) or []:
            ii = (p.get("imageinfo") or [None])[0]
            if not ii:
                continue
            title = p.get("title", "")
            if not title.lower().endswith(EXT_OK):
                continue
            ext = ii.get("extmetadata") or {}
            if not is_free(ext):
                continue
            if (ii.get("width") or 0) < 700:
                continue
            out.append({
                "title": title,
                "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
                "download": ii.get("thumburl") or ii.get("url"),
                "artist": meta_get(ext, "Artist") or meta_get(ext, "Credit") or "저작자 미상",
                "license": meta_get(ext, "LicenseShortName") or meta_get(ext, "License"),
                "license_url": meta_get(ext, "LicenseUrl"),
                "description": meta_get(ext, "ImageDescription"),
            })
        # 하위 카테고리 1단계
        if len(seen_cats) == 1:
            try:
                sub = api({
                    "action": "query", "list": "categorymembers",
                    "cmtitle": c, "cmtype": "subcat", "cmlimit": "20",
                })
                for m in (sub.get("query", {}) or {}).get("categorymembers", []) or []:
                    todo.append(m["title"])
            except Exception:
                pass
        time.sleep(0.3)
    out.sort(key=lambda x: x["title"])   # 실행할 때마다 같은 순서가 되도록
    return out


def short(s, n):
    """단어 중간에서 자르지 않는다. '(M…' 처럼 끊기면 읽기 나쁘다."""
    s = " ".join((s or "").split())
    if len(s) <= n:
        return s
    cut = s[:n]
    sp = cut.rfind(" ")
    if sp > n * 0.6:          # 너무 많이 잘려나가지 않는 선에서만 단어 경계 사용
        cut = cut[:sp]
    return cut.rstrip(" ,.;:-([") + "…"


def clean_title(title):
    """'File:1-10-1923, cyclecar à Berlin - btv1b53119087b.jpg' -> '1-10-1923, cyclecar à Berlin'"""
    t = re.sub(r"^File:", "", title or "")
    t = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", t)
    t = t.replace("_", " ")
    t = re.sub(r"\s*-\s*btv[0-9a-z]+$", "", t)          # 프랑스 국립도서관 정리번호
    t = re.sub(r"\s*\([0-9a-f]{6,}\)$", "", t)          # 플리커 등의 숫자 꼬리표
    t = re.sub(r"\s*\(\d{6,}\)$", "", t)                # 플리커 사진 번호
    # 카메라 파일명이 앞에 붙은 경우: "IMG 8995" - 실제설명  ->  실제설명
    t = re.sub(r'(?i)^["\u2019\u201c\']?\s*(?:img|dsc|dscn|p|pict|photo|image)[ _-]*\d+\s*["\u2019\u201d\']?\s*[-–—:]\s*', "", t)
    t = t.strip(' "\u201c\u201d\'')
    return re.sub(r"\s+", " ", t).strip()


# 파일명이 설명 구실을 하는지. "-i---i-", "IMG 8995", "DSC_0123" 같은 건 아니다.
def is_useless_title(t):
    t = (t or "").strip()
    if len(t) < 6:
        return True
    letters = sum(1 for c in t if c.isalpha())
    if letters < 4:
        return True
    return bool(re.fullmatch(r'(?i)(img|dsc|dscn|p|pict|photo|image)[ _-]*\d+.*', t))


def fallback_for(fname):
    for prefix, desc in FALLBACK_DESC.items():
        if str(fname).startswith(prefix):
            return desc
    return "역사 사진"


def caption_for(item, fname=None):
    """캡션 = 사진 설명 + 출처. 이게 본문에 그대로 들어간다.

    설명은 파일명을 쓴다. Commons의 ImageDescription은 도서관 목록 메타데이터
    ("Sujet : Cyclecars -- France Courses automobiles -- ...") 인 경우가 많아
    블로그 본문에 그대로 넣기에 나쁘다.
    """
    title = clean_title(item.get("title"))
    if is_useless_title(title):
        # 파일명이 쓸모없으면 Commons 설명으로, 그것도 없으면 슬롯 이름으로 대체한다.
        # 캡션이 "-i---i-" 로 나가는 것보다는 낫다.
        title = (item.get("description") or item.get("fallback")
                 or fallback_for(fname or item.get("_name") or ""))
    desc = short(title, 70)
    who = short(item.get("artist"), 55)
    lic = short(item.get("license"), 20) or "Wikimedia Commons"
    return f"{desc} / 사진: {who}, {lic} (Wikimedia Commons)"


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def apply_captions(manifest):
    """원고의 [[img:hist_...|...]] 캡션을 실제 출처로 바꾼다."""
    changed = 0
    for name in sorted(os.listdir(ARTICLES)):
        if not name.endswith((".txt", ".md")):
            continue
        p = os.path.join(ARTICLES, name)
        s = io.open(p, encoding="utf-8").read()
        orig = s

        def repl(m):
            fn = m.group(1).strip()
            info = manifest.get(fn)
            if not info:
                return m.group(0)
            return f"[[img:{fn}|{caption_for(info, fn)}]]"

        s = re.sub(r"\[\[\s*img\s*:\s*(hist_[^|\]]+?)\s*(?:\|[^\]]*)?\]\]", repl, s)
        if s != orig:
            io.open(p, "w", encoding="utf-8").write(s)
            changed += 1
    return changed


def main():
    dry = flag("dry-run")
    os.makedirs(IMAGES, exist_ok=True)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)

    manifest = {}
    if os.path.exists(MANIFEST):
        try:
            manifest = json.load(io.open(MANIFEST, encoding="utf-8"))
        except Exception:
            manifest = {}

    used_titles = {v.get("title") for v in manifest.values()}

    for prefix, need, cats in SLOTS:
        print(f"\n== {prefix} — {need}장 필요 ==")
        pool = []
        for c in cats:
            got = category_files(c)
            print(f"  {c}: 재사용 가능 {len(got)}장")
            pool.extend(got)
        # 중복 제거
        dedup, seen = [], set()
        for it in pool:
            if it["title"] in seen:
                continue
            seen.add(it["title"])
            dedup.append(it)

        for i in range(1, need + 1):
            fname = f"{prefix}_{i:02d}.jpg"
            dest = os.path.join(IMAGES, fname)
            if fname in manifest and os.path.exists(dest):
                print(f"  · {fname} 이미 있음 — 내려받기 생략 (캡션은 다시 계산)")
                used_titles.add(manifest[fname].get("title"))
                continue
            pick = next((x for x in dedup if x["title"] not in used_titles), None)
            if not pick:
                print(f"  ❌ {fname}: 쓸 수 있는 사진이 부족합니다")
                continue
            used_titles.add(pick["title"])
            cap = caption_for(pick)
            print(f"  → {fname}  {pick['title']}")
            print(f"      {cap}")
            if dry:
                continue
            try:
                n = download(pick["download"], dest)
            except Exception as e:
                print(f"      ! 내려받기 실패: {e}")
                continue
            manifest[fname] = {
                "fallback": FALLBACK_DESC.get(prefix, "역사 사진"),
                "title": pick["title"],
                "page": pick["page"],
                "artist": pick["artist"],
                "license": pick["license"],
                "license_url": pick["license_url"],
                "description": pick["description"],
                "caption": cap,
                "bytes": n,
            }

    if dry:
        print("\n(--dry-run 이라 아무것도 저장하지 않았습니다)")
        return

    json.dump(manifest, io.open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    lines = ["# 역사 사진 출처", "",
             "위키미디어 공용에서 재사용 가능 라이선스만 받아온 사진입니다.",
             "라이선스는 Commons API가 돌려준 값을 그대로 적었습니다.", ""]
    for fn in sorted(manifest):
        m = manifest[fn]
        lines += [f"## {fn}",
                  f"- 원본: {m['page']}",
                  f"- 저작자: {m['artist']}",
                  f"- 라이선스: {m['license']} {m.get('license_url') or ''}".rstrip(),
                  ""]
    io.open(CREDITS_MD, "w", encoding="utf-8").write("\n".join(lines))
    print(f"\n출처 목록: {CREDITS_MD}")

    if not flag("no-apply"):
        n = apply_captions(manifest)
        print(f"원고 {n}편의 사진 캡션에 출처를 넣었습니다.")

    # 못 받은 슬롯이 있으면 어느 편이 막히는지 알려준다.
    # 큐 중간에서 갑자기 막히는 것보다 지금 아는 게 낫다.
    missing = {}
    for name in sorted(os.listdir(ARTICLES)):
        if not name.endswith((".txt", ".md")):
            continue
        body = io.open(os.path.join(ARTICLES, name), encoding="utf-8").read()
        for m in re.finditer(r"\[\[\s*img\s*:\s*(hist_[^|\]]+?)\s*(?:\|[^\]]*)?\]\]", body):
            fn = m.group(1).strip()
            if not os.path.exists(os.path.join(IMAGES, fn)):
                missing.setdefault(fn, []).append(name)
    if missing:
        print()
        print("⚠ 아래 사진을 못 받았습니다. 해당 편은 게시가 막힙니다:")
        for fn, arts in sorted(missing.items()):
            print(f"   {fn}  ← {', '.join(a[:2] + '편' for a in arts)}")
        print("   카테고리에 쓸 만한 사진이 없을 수 있습니다. --dry-run 으로 후보를 확인하거나,")
        print("   해당 편의 [[img:hist_...]] 를 자사 사진으로 바꿔주세요.")
    else:
        print("\n✅ 원고가 쓰는 역사 사진이 모두 준비됐습니다.")


if __name__ == "__main__":
    main()
