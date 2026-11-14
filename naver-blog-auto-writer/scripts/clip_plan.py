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

CTA = "더 많은 영상과 이야기는 블로그에 있습니다."


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
                "description": f"{t['hook']} {CTA}",
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
    if any(skipped.values()):
        print("\n뺀 것:")
        for k, n in skipped.items():
            if n:
                print(f"  {n:3}개  {why[k]}")
    print(f"\n목록 → {OUT}")


if __name__ == "__main__":
    main()
