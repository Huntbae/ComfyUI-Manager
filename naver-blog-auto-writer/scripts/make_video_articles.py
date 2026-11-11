#!/usr/bin/env python3
"""
준비된 동영상(state/video_plan.json)으로 [동영상] 원고를 만든다.

글의 목적은 홍보다. 그래서
  · 제목: '[동영상]' 머릿말 + 검색어가 앞에 오는 제목 + 한 줄 설명
  · 첫 문장: 읽던 사람을 붙잡는 한 줄(후킹)
  · 본문: 제품이 무엇인지 확정된 사실로 설명 (검색어가 자연스럽게 들어간다)
  · 끝: 문의 안내와 해시태그
로 짠다.

지키는 선이 둘 있다.

1. 나는 영상을 보지 못한다. 폴더 이름과 날짜, 확정된 사실(제원·인증)만 안다.
   그래서 "영상에서 무엇을 하고 있다"고 쓰지 않는다. 제품이 무엇인지,
   이 기록이 어떤 종류의 자리인지(폴더 이름이 말해주는 만큼)만 쓴다.

2. 홍보 문구도 확정된 범위 안에서만 쓴다. 가격·주행거리·충전시간·'최초'·'유일'
   같은 말은 넣지 않는다. 확인되지 않은 숫자 하나가 글 전체의 신뢰를 깎는다.
   칼리 제원은 CLAUDE.md 의 확정 제원만 쓴다.

사용법:
    python3 scripts/make_video_articles.py --dry-run
    python3 scripts/make_video_articles.py
"""

import argparse
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / "state" / "video_plan.json"
ARTICLES = ROOT / "articles"

HEAD = "[동영상]"


def nfc(s):
    return unicodedata.normalize("NFC", str(s))


def ns(s):
    """비교용: NFC + 소문자 + 공백 제거."""
    return re.sub(r"\s+", "", nfc(s)).lower()


# ── 무슨 제품의 영상인가 ─────────────────────────────────────────
EDU_KEYS = ["에듀카트", "edu-kart", "edukart", "educart", "에듀"]
KALLI_KEYS = ["칼리", "kalli", "newtro", "뉴트로", "사이클카트", "cyclekart"]


def product_of(theme, sources):
    """edu / kalli / none.

    폴더 이름이 먼저다. 이름이 말해주지 않으면 원본 경로 전체에서 찾는다
    (채택 여부를 경로 전체로 정하면 오탐이 났지만, 이미 채택된 영상이
    어느 제품 것인지 가리는 데는 조상 폴더가 좋은 단서다).
    둘 다 걸리거나 둘 다 안 걸리면 제품을 단정하지 않는다.
    """
    def which(text):
        e = any(k in text for k in EDU_KEYS)
        k = any(k in text for k in KALLI_KEYS)
        return None if e == k else ("edu" if e else "kalli")

    t = ns(theme)
    got = which(t) or which(ns(" ".join(sources)))
    if got:
        return got
    # 조립·교육은 에듀카트의 일이다 (조립해 보면서 배우는 키트)
    if "조립" in t or "교육" in t:
        return "edu"
    return "none"


# ── 어떤 종류의 기록인가 (폴더 이름이 말해주는 만큼만) ──────────────
KINDS = [
    ("시승", ["시승"]),
    ("공도", ["공도"]),
    ("주행", ["주행", "운행", "탑승", "고프로", "나들", "racing"]),
    ("교육", ["교육", "수업"]),
    ("조립", ["조립", "차체", "제작", "making", "install"]),
    ("실측", ["실측", "계측"]),
    ("행사", ["포럼", "엑스포", "전시", "박람회", "출품"]),
]


def kind_of(theme):
    t = ns(theme)
    for kind, keys in KINDS:
        if any(k in t for k in keys):
            return kind
    return "기록"


# ── 제품 설명. 확정된 사실만. ────────────────────────────────────
FACTS = {
    "edu": (
        "에듀카트는 어떤 카트인가",
        "에듀카트(eDu Kart)는 클랜헌트가 만든 교육용 전기카트 키트입니다. "
        "완성된 차를 받아서 타는 것이 아니라, 부품 상태에서 직접 조립해 보면서 "
        "전기차가 어떻게 움직이는지를 배웁니다. 교육용·사유지용이라 도로 인증 "
        "절차를 밟지 않아도 교육 현장에서 쓸 수 있습니다. 첫 버전을 교육에 써 "
        "보고, 거기서 드러난 문제를 고쳐 다음 버전을 만들었습니다.",
    ),
    "kalli": (
        "칼리(Kalli)는 어떤 차인가",
        "칼리(Kalli)는 클랜헌트가 기획하고 개발한 1인승 전기차입니다. 차명은 "
        "NEWTRO M, 법적으로는 사륜형 이륜자동차입니다. 공인시험 33종을 거쳐 "
        "번호판을 달고 도로를 달립니다. 전장 2,495mm, 최고출력 11kW, 72V 구동계에 "
        "교환식 배터리(73.8V 86.4Ah)를 씁니다. 최고속도 60km/h는 저희가 정한 "
        "숫자가 아니라 이 차종에 걸린 법정 상한입니다.",
    ),
    "none": (
        "클랜헌트는 무엇을 만드나",
        "클랜헌트(ClanHunts)는 전기 모빌리티를 직접 기획하고 개발합니다. "
        "조립해 보면서 배우는 교육용 전기카트 '에듀카트(eDu Kart)'와, 공인시험 "
        "33종을 거쳐 번호판을 달고 도로를 달리는 1인승 전기차 '칼리(Kalli)'가 "
        "그 결과물입니다.",
    ),
}

TAGS = {
    "edu": "#에듀카트 #eDuKart #교육용전기카트 #전기카트 #전기카트조립 #전기차교육 #클랜헌트",
    "kalli": "#칼리 #Kalli #사이클카트 #1인승전기차 #뉴트로M #사륜형이륜자동차 #전기차 #클랜헌트",
    "none": "#클랜헌트 #에듀카트 #칼리 #사이클카트 #전기카트 #1인승전기차",
}

# ── (제품, 종류) → 제목·후킹·영상 제목·영상으로 남긴 이유 ──────────
# 제목은 검색어를 앞에 둔다. 네이버는 제목 앞쪽의 단어를 더 무겁게 본다.
T = {
    ("edu", "조립"): dict(
        title="에듀카트 조립 영상 — 교육용 전기카트, 직접 만들면 이렇게 됩니다",
        hook="전기차를 내 손으로 조립한다면 어디서부터 시작할까요? 에듀카트는 그 과정을 "
             "그대로 수업으로 만든 교육용 전기카트입니다.",
        vkw="에듀카트 조립 영상",
        why="조립 순서는 글로 적어도 손이 어디로 가야 하는지까지는 알려주지 못합니다. "
            "그래서 조립 과정을 영상으로 남겼습니다. 에듀카트는 조립 과정 자체가 교재입니다.",
    ),
    ("edu", "교육"): dict(
        title="에듀카트 교육 현장 영상 — 전기카트를 직접 조립하며 배우는 수업",
        hook="설명을 듣는 수업과 직접 조립해 보는 수업은 남는 것이 다릅니다. "
             "교육용 전기카트 에듀카트의 교육 현장을 영상으로 남겼습니다.",
        vkw="에듀카트 교육 영상",
        why="만든 물건을 처음 남의 손에 쥐여주는 자리가 교육 현장입니다. 설명서대로 "
            "안 되는 지점, 손이 안 들어가는 지점이 이 자리에서 드러납니다. "
            "그 기록이 다음 버전을 만듭니다.",
    ),
    ("edu", "주행"): dict(
        title="에듀카트 주행 영상 — 조립해서 타는 교육용 전기카트",
        hook="조립이 끝나면 달려 봐야 합니다. 직접 조립하는 교육용 전기카트, "
             "에듀카트의 주행 영상입니다.",
        vkw="에듀카트 주행 영상",
        why="조립이 맞게 됐는지는 굴려 보면 압니다. 에듀카트는 교육용·사유지용이라 "
            "도로가 아닌 곳에서 탑니다.",
    ),
    ("edu", "기록"): dict(
        title="에듀카트(eDu Kart) 영상 — 조립하며 배우는 교육용 전기카트",
        hook="완성된 차를 받는 것과 직접 만들어 보는 것, 어느 쪽이 더 많이 남을까요? "
             "에듀카트는 뒤쪽을 고른 교육용 전기카트입니다.",
        vkw="에듀카트 영상",
        why="개발 과정은 서류로 남지만, 서류는 무엇이 어떻게 움직였는지를 적지 못합니다. "
            "그래서 영상을 남겼습니다.",
    ),
    ("kalli", "공도"): dict(
        title="사이클카트 칼리 공도 주행 영상 — 번호판 달고 도로를 달리는 1인승 전기차",
        hook="1인승 전기차가 번호판을 달고 도로에 나왔습니다. 클랜헌트가 개발한 "
             "사이클카트 칼리(Kalli)의 공도 주행 영상입니다.",
        vkw="칼리 공도 주행 영상",
        why="도로에 나오기까지 공인시험 33종을 거쳤습니다. 서류에는 통과 여부만 남습니다. "
            "실제로 달리는 모습은 영상으로만 남길 수 있습니다.",
    ),
    ("kalli", "주행"): dict(
        title="사이클카트 칼리(Kalli) 주행 영상 — 클랜헌트가 개발한 1인승 전기차",
        hook="혼자 타는 전기차는 어떻게 달릴까요? 클랜헌트가 기획하고 개발한 1인승 전기차, "
             "사이클카트 칼리(Kalli)의 주행 영상입니다.",
        vkw="칼리 주행 영상",
        why="제원표의 숫자는 차가 어떻게 움직이는지를 보여주지 못합니다. "
            "그래서 달리는 모습을 영상으로 남겼습니다.",
    ),
    ("kalli", "시승"): dict(
        title="칼리(Kalli) 시승회 현장 영상 — 1인승 전기차 사이클카트를 타 보는 자리",
        hook="제원표의 숫자와 직접 타 본 느낌은 다릅니다. 1인승 전기차 칼리(Kalli) "
             "시승회 현장을 영상으로 남겼습니다.",
        vkw="칼리 시승회 영상",
        why="칼리는 1인승입니다. 승차정원 1명은 저희 선택이 아니라 이 차종에 걸린 "
            "법적 조건입니다. 그 조건 안에서 만든 차를 직접 타 보는 자리가 시승회입니다.",
    ),
    ("kalli", "실측"): dict(
        title="칼리(Kalli) 실측 확인 영상 — 1인승 전기차가 도로에 나오기까지",
        hook="차가 도로에 나오려면 제원표의 숫자와 실제 차가 맞아야 합니다. "
             "1인승 전기차 칼리(Kalli)의 실측 확인 영상입니다.",
        vkw="칼리 실측 확인 영상",
        why="제원표에 적어낸 숫자와 실제 차를 맞춰 보는 절차입니다. 칼리의 전장은 "
            "2,495mm입니다. 법정 한계 2,500mm에서 5mm를 남긴 숫자입니다.",
    ),
    ("kalli", "조립"): dict(
        title="칼리(Kalli) 제작 과정 영상 — 1인승 전기차가 만들어지기까지",
        hook="차 한 대가 도로에 나오기까지 어떤 과정을 거칠까요? 1인승 전기차 "
             "칼리(Kalli)의 제작 과정을 영상으로 남겼습니다.",
        vkw="칼리 제작 영상",
        why="만드는 과정은 완성된 차에서는 보이지 않습니다. 그래서 과정을 영상으로 남겼습니다.",
    ),
    ("kalli", "기록"): dict(
        title="1인승 전기차 칼리(Kalli) 영상 — 클랜헌트가 개발한 사이클카트",
        hook="번호판을 달고 도로를 달리는 1인승 전기차가 있습니다. 클랜헌트가 기획하고 "
             "개발한 사이클카트, 칼리(Kalli)입니다.",
        vkw="칼리 영상",
        why="개발 과정은 서류로 남지만, 서류는 무엇이 어떻게 움직였는지를 적지 못합니다. "
            "그래서 영상을 남겼습니다.",
    ),
    # 제품을 폴더 이름으로 알 수 없을 때. 제품을 단정하지 않되, 종류는 말한다.
    # (이게 없으면 시승회 영상이 '개발 영상'이라는 엉뚱한 제목을 받는다.)
    ("none", "시승"): dict(
        title="클랜헌트 시승회 현장 영상 — 직접 타 보는 전기 모빌리티",
        hook="제원표의 숫자와 직접 타 본 느낌은 다릅니다. 클랜헌트 시승회 현장을 "
             "영상으로 남겼습니다.",
        vkw="클랜헌트 시승회 영상",
        why="만든 것을 직접 타 보는 자리에서는 사무실에서 안 보이던 것이 보입니다. "
            "그 자리의 기록입니다.",
    ),
    ("none", "주행"): dict(
        title="클랜헌트 전기 모빌리티 주행 영상 — 에듀카트와 칼리(Kalli)",
        hook="만든 것은 굴려 봐야 압니다. 클랜헌트가 개발한 전기 모빌리티의 주행 영상입니다.",
        vkw="클랜헌트 주행 영상",
        why="제원표의 숫자는 차가 어떻게 움직이는지를 보여주지 못합니다. "
            "그래서 달리는 모습을 영상으로 남겼습니다.",
    ),
    ("none", "조립"): dict(
        title="클랜헌트 전기 모빌리티 제작 과정 영상 — 만들어지기까지",
        hook="차 한 대가 만들어지기까지 어떤 과정을 거칠까요? 클랜헌트의 제작 과정을 "
             "영상으로 남겼습니다.",
        vkw="클랜헌트 제작 영상",
        why="만드는 과정은 완성된 차에서는 보이지 않습니다. 그래서 과정을 영상으로 남겼습니다.",
    ),
    ("none", "행사"): dict(
        title="클랜헌트 행사 현장 영상 — 교육용 전기카트와 1인승 전기차",
        hook="만든 것을 밖에 내놓는 자리에서는 사무실에서 안 보이던 것이 보입니다. "
             "클랜헌트의 행사 현장 영상입니다.",
        vkw="클랜헌트 행사 영상",
        why="현장의 기록은 그 자리에서 남기지 않으면 다시 얻을 수 없습니다.",
    ),
    ("none", "기록"): dict(
        title="클랜헌트 전기 모빌리티 개발 영상 — 에듀카트와 칼리(Kalli)",
        hook="아이디어가 실제로 굴러가는 차가 되기까지, 그 과정을 영상으로 남겼습니다.",
        vkw="클랜헌트 개발 영상",
        why="개발 과정은 서류로 남지만, 서류는 무엇이 어떻게 움직였는지를 적지 못합니다. "
            "그래서 영상을 남겼습니다.",
    ),
}

# 소리를 바꿨다는 사실은 밝혀두는 편이 정직하다.
OUTRO = ("영상의 소리는 배경음악으로 바꿨습니다. 현장 소음과 대화가 섞여 있어서 "
         "그대로 올리기 어려웠습니다.")

CTA = ("에듀카트 교육 도입이나 1인승 전기차 칼리(Kalli)에 대해 궁금한 점은 댓글로 "
       "남겨 주세요. 이 블로그에 클랜헌트의 전기카트·전기차 영상을 계속 올립니다. "
       "이웃으로 추가해 두시면 새 영상을 받아보실 수 있습니다.")

PLACES = ["횡성", "군산", "여수", "제주", "춘천", "대구"]
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"


def pick(product, kind):
    return T.get((product, kind)) or T.get((product, "기록")) or T[("none", "기록")]


def when_of(theme, vids):
    """찍은 때. 폴더 이름과 파일 이름에 적힌 날짜만 믿는다."""
    def ok(y, m):
        return 2018 <= y <= 2026 and 1 <= m <= 12

    texts = [nfc(theme)] + [Path(v["source"]).name for v in vids]
    for t in texts:
        m = re.search(r"(20\d{2})[.\-_ ]?(\d{2})[.\-_ ]?\d{2}", t)       # 20240820 / 2020.03.30
        if m and ok(int(m.group(1)), int(m.group(2))):
            return f"{m.group(1)}년 {int(m.group(2))}월"
        m = re.match(r"\s*(\d{2})[.\-_ ]?(\d{2})[.\-_ ]?(\d{2})(?!\d)", t)  # 241016 / 23.06.21
        if m and ok(2000 + int(m.group(1)), int(m.group(2))) and 1 <= int(m.group(3)) <= 31:
            return f"{2000 + int(m.group(1))}년 {int(m.group(2))}월"
    return ""


def slug(s):
    s = re.sub(r"[^\w가-힣]+", "", nfc(s))
    return s[:24] or "영상"


def build(entry, part, parts):
    theme = nfc(entry["theme"])
    vids = entry["videos"]
    product = product_of(theme, [v["source"] for v in vids])
    kind = kind_of(theme)
    t = pick(product, kind)

    title = f"{HEAD} {t['title']}"
    if parts > 1:
        title = f"{title} ({part}/{parts})"

    lines = [title, "", t["hook"], ""]

    # 언제·어디서. 폴더 이름에 적힌 만큼만.
    when = when_of(theme, vids)
    place = next((p for p in PLACES if p in theme), "")
    if when or place:
        bits = " ".join(x for x in [when, f"{place}에서" if place else ""] if x)
        lines += [f"{bits} 찍은 기록입니다.", ""]

    # 영상 제목은 네이버 동영상 검색에 걸린다. 검색어를 넣고, 서로 다르게 붙인다.
    for i, v in enumerate(vids):
        mark = "" if len(vids) == 1 else f" {CIRCLED[i] if i < len(CIRCLED) else i + 1}"
        if parts > 1:
            mark = f" {part}편{mark}"
        sec = f" · {int(v['sec'])}초" if v.get("sec") else ""
        cap = f"{t['vkw']}{mark}{sec}"
        lines += [f"[[video:{v['file']}|{cap}]]", ""]
        if len(vids) > 1 and i == 0:
            lines += ["같은 자리에서 찍은 영상이 이어집니다.", ""]

    head, facts = FACTS[product]
    lines += [
        f"**{head}**", "", facts, "",
        "**왜 영상으로 남겼나**", "", t["why"], "",
        "**소리에 대해**", "", OUTRO, "",
        "**문의**", "", CTA, "",
        TAGS[product], "",
    ]
    return title, "\n".join(lines), dict(product=product, kind=kind)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--show", type=int, default=0, metavar="N",
                    help="N번째 원고를 화면에 찍는다 (파일은 만들지 않는다)")
    args = ap.parse_args()

    if not PLAN.exists():
        sys.exit(f"영상 계획이 없습니다: {PLAN}\n먼저 kart videos 를 돌리세요.")
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    entries = plan.get("articles") or []
    if not entries:
        sys.exit("계획에 편이 없습니다.")

    # 같은 제목이 여러 편이면 (1/3) 을 붙인다. 주제(폴더)가 달라도 제목이
    # 같아질 수 있다 — '칼리' 폴더와 'Kalli' 폴더는 같은 제목을 받는다.
    # 그래서 폴더가 아니라 제목으로 센다.
    base = []
    for e in entries:
        theme = nfc(e["theme"])
        product = product_of(theme, [v["source"] for v in e["videos"]])
        base.append(pick(product, kind_of(theme))["title"])
    totals = {}
    for b in base:
        totals[b] = totals.get(b, 0) + 1

    seen, per_theme, made = {}, {}, []
    for e, b in zip(entries, base):
        seen[b] = seen.get(b, 0) + 1
        title, body, meta = build(e, seen[b], totals[b])
        th = nfc(e["theme"])
        per_theme[th] = per_theme.get(th, 0) + 1
        made.append((th, per_theme[th], title, body, len(e["videos"]), meta))

    print(f"동영상 원고 {len(made)}편\n")
    for i, (th, _n, title, body, nv, meta) in enumerate(made, 1):
        print(f"  {i:2}. {title}")
        print(f"        ← 폴더 '{th}' · 영상 {nv}개 · {len(body)}자 · "
              f"{meta['product']}/{meta['kind']}")

    if args.show:
        if not 1 <= args.show <= len(made):
            sys.exit(f"\n--show 는 1~{len(made)} 사이여야 합니다.")
        print("\n" + "─" * 60 + "\n" + made[args.show - 1][3] + "─" * 60)
        return
    if args.dry_run:
        print("\n(--dry-run 이므로 파일을 만들지 않았습니다)")
        return

    # 기존 원고를 치운다.
    #   · 사진 시리즈 → articles_v6/ 로 보관 (지우지 않는다)
    #   · 지난번에 만든 동영상 원고(NN_영상_*.txt) → 지운다. 다시 만들 것이므로.
    # 예전에는 둘을 가리지 않고 전부 articles_v6/ 로 옮겼다. 그래서 이 명령을
    # 두 번 돌리면 지난 동영상 원고가 사진 시리즈 보관함에 섞여 들어갔다.
    ARTICLES.mkdir(parents=True, exist_ok=True)
    keep = ROOT / "articles_v6"
    moved = removed = 0
    for f in sorted(ARTICLES.glob("*.txt")):
        if re.match(r"\d+_영상_", nfc(f.name)):
            f.unlink()
            removed += 1
        else:
            keep.mkdir(exist_ok=True)
            shutil.move(str(f), keep / f.name)
            moved += 1
    if moved:
        print(f"\n사진 시리즈 {moved}편 → articles_v6/ 로 보관했습니다.")
        print("   되돌리려면: mv articles_v6/*.txt articles/")
    if removed:
        print(f"지난 동영상 원고 {removed}편은 새로 만듭니다.")

    counts = {}
    for th, *_ in made:
        counts[th] = counts.get(th, 0) + 1
    for i, (th, n, _title, body, _nv, _meta) in enumerate(made, 1):
        name = f"{i:02d}_영상_{slug(th)}{'' if counts[th] == 1 else f'_{n}'}.txt"
        (ARTICLES / name).write_text(body, encoding="utf-8")
    print(f"\n원고 {len(made)}편 → {ARTICLES}")
    print("다음: kart preview 로 찍힐 모양을 보고, kart next 로 한 편 올려보세요.")


if __name__ == "__main__":
    main()
