#!/usr/bin/env python3
"""
네이버 클립에 올릴 영상 목록을 만든다 (state/clip_plan.json).

블로그에 올라간 동영상 편의 영상을 그대로 쓴다 — 배경음악까지 입힌 videos/ 의 파일.
다만 두 가지를 뺀다.

1. 교육 현장 영상. 학생 얼굴이 찍혀 있고 미성년자가 포함된다. 블로그는 임시저장이라
   발행 전에 사람이 볼 수 있었지만, 클립은 올리면 바로 공개된다. 볼 기회가 없다.
   사용자가 "차량 영상만"으로 정했다.

2. 무엇을 찍었는지 알 수 없는 영상. 폴더 이름으로 제품도 종류도 가릴 수 없는 것
   ('동영상 임시 백업' 같은). 차량 영상이라고 말할 근거가 없다.
   넣으려면 --include-unknown.

이미 클립에 올린 영상(state/clip_done.json)도 뺀다.

    python3 scripts/clip_plan.py            # 목록을 만들고 보여준다
    python3 scripts/clip_plan.py --all      # 블로그에 아직 안 올라간 편의 영상도
"""

import argparse
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_video_articles as mva  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / "state" / "video_plan.json"
PROGRESS = ROOT / "state" / "progress.json"
OUT = ROOT / "state" / "clip_plan.json"
DONE = ROOT / "state" / "clip_done.json"
VIDEOS = ROOT / "videos"

# 클립 제목은 짧아야 한다. 정확한 상한은 화면에서 읽은 뒤 맞춘다 (kart clip doctor).
TITLE_MAX = 40

# 클립 설명에 넣는 제품 소개. 블로그 원고의 긴 설명(mva.FACTS)을 두세 문장으로 줄인 것.
# 여기도 확정된 사실만 쓴다 — 가격·주행거리·'최초' 같은 말은 없다.
ABOUT = {
    "edu": ("에듀카트(eDu Kart)는 클랜헌트가 만든 교육용 전기카트 키트입니다. "
            "부품 상태에서 직접 조립해 보면서 전기차가 어떻게 움직이는지를 배웁니다."),
    "kalli": ("칼리(Kalli)는 클랜헌트가 기획하고 개발한 1인승 전기차입니다. "
              "공인시험 33종을 거쳐 번호판을 달고 도로를 달립니다. "
              "최고속도 60km/h, 교환식 배터리를 씁니다."),
    "none": ("클랜헌트(ClanHunts)는 교육용 전기카트 '에듀카트'와 1인승 전기차 "
             "'칼리(Kalli)'를 직접 기획하고 개발합니다."),
}


def cta(blog_id):
    where = f" (blog.naver.com/{blog_id})" if blog_id else ""
    return f"궁금한 점은 댓글로 남겨 주세요. 더 많은 영상과 개발 이야기는 블로그{where}에 있습니다."


def nfc(s):
    return unicodedata.normalize("NFC", str(s))


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="블로그에 아직 안 올라간 편의 영상도 넣는다")
    ap.add_argument("--include-unknown", action="store_true",
                    help="무엇을 찍었는지 알 수 없는 폴더의 영상도 넣는다")
    args = ap.parse_args()

    plan = load(PLAN, None)
    if not plan or not plan.get("articles"):
        sys.exit(f"영상 계획이 없습니다: {PLAN}\n먼저 kart vgo 로 블로그에 올리세요.")
    posted = {nfc(x) for x in load(PROGRESS, {}).get("posted", [])}
    blog_id = load(ROOT / "config.json", {}).get("blogId", "")
    done = set(load(DONE, {}).get("files", []))

    items, skipped = [], {"교육": 0, "모름": 0, "블로그 미게시": 0, "이미 올림": 0, "파일 없음": 0}
    for e in plan["articles"]:
        theme = nfc(e["theme"])
        sources = [v["source"] for v in e["videos"]]
        product = mva.product_of(theme, sources)
        kind = mva.kind_of(theme)
        n = len(e["videos"])
        if kind == "교육":
            skipped["교육"] += n
            continue
        if product == "none" and kind == "기록" and not args.include_unknown:
            skipped["모름"] += n
            continue
        if not args.all and nfc(e.get("article") or "") not in posted:
            skipped["블로그 미게시"] += n
            continue
        t = mva.pick(product, kind)
        tail = t["title"].split(" — ", 1)[-1]
        tags = [x.lstrip("#") for x in mva.TAGS[product].split()]
        for i, v in enumerate(e["videos"]):
            f = VIDEOS / v["file"]
            if v["file"] in done:
                skipped["이미 올림"] += 1
                continue
            if not f.exists():
                skipped["파일 없음"] += 1
                continue
            items.append({
                "file": v["file"],
                "path": str(f),
                "vkw": t["vkw"],
                "tail": tail,
                # 설명은 두 가지 길이로 준비한다. 클립의 설명칸이 몇 자까지 받는지는
                # 화면에서 읽어야 안다. 올리는 쪽이 칸에 들어가는 가장 긴 것을 고른다.
                # 잘라서 문장 중간에 끊기는 것보다 짧은 판을 통째로 넣는 편이 낫다.
                "description": f"{t['hook']}\n\n{ABOUT[product]}\n\n{cta(blog_id)}",
                "description_short": f"{t['hook']} {cta(blog_id)}",
                "tags": tags,
                "theme": theme,
                "kind": f"{product}/{kind}",
                "sec": v.get("sec"),
            })

    # 제목에 번호를 붙인다. 폴더가 달라도 같은 종류면 제목이 같아지므로
    # ('조립 영상 제작' 과 'Ver. 2 조립관련 영상' 은 둘 다 '에듀카트 조립 영상'),
    # 폴더별이 아니라 목록 전체에서 이어 센다. 같은 제목의 클립이 둘이 되지 않게.
    totals, seen = {}, {}
    for it in items:
        totals[it["vkw"]] = totals.get(it["vkw"], 0) + 1
    for it in items:
        k = it["vkw"]
        seen[k] = seen.get(k, 0) + 1
        title = k if totals[k] == 1 else f"{k} {seen[k]}"
        # 자리가 남으면 한 줄 설명을 붙인다
        if len(title) + 3 + len(it["tail"]) <= TITLE_MAX:
            title = f"{title} — {it['tail']}"
        it["title"] = title[:TITLE_MAX]
        del it["vkw"], it["tail"]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"클립에 올릴 영상 {len(items)}개\n")
    for i, it in enumerate(items, 1):
        sec = f" · {int(it['sec'])}초" if it.get("sec") else ""
        print(f"  {i:2}. {it['title']}")
        print(f"        {it['file']}{sec} · 폴더 '{it['theme']}' · {it['kind']}")
    why = {
        "교육": "교육 현장 영상 (학생 얼굴 — 클립은 바로 공개되어 미리 볼 수 없다)",
        "모름": "무엇을 찍었는지 알 수 없는 폴더 (넣으려면 --include-unknown)",
        "블로그 미게시": "블로그에 아직 안 올라간 편의 영상 (넣으려면 --all)",
        "이미 올림": "이미 클립에 올린 영상",
        "파일 없음": "videos/ 에 파일이 없음 (kart videos 로 다시 만들어야 한다)",
    }
    if items:
        print("\n설명은 이렇게 들어갑니다 (첫 영상):")
        for line in items[0]["description"].splitlines():
            print(f"    {line}")
        print("    " + " ".join(f"#{t}" for t in items[0]["tags"]))
    if any(skipped.values()):
        print("\n뺀 것:")
        for k, n in skipped.items():
            if n:
                print(f"  {n:3}개  {why[k]}")
    print(f"\n목록 → {OUT}")


if __name__ == "__main__":
    main()
