#!/usr/bin/env python3
"""
동영상 편을 처음부터 다시 만들 수 있게 기록을 지운다.

쓰는 때: 이미 올린 동영상 편을 새 배경음악으로(또는 새 규칙으로) 다시 올리고 싶을 때.
그냥 다시 돌리면 "이미 올린 영상"으로 빠져서 다시 만들어지지 않는다 — 같은 영상이
두 번 올라가는 것을 막으려고 그렇게 해둔 것이다. 이 스크립트가 그 기록을 지운다.

지우는 것:
  · 진행 기록에서 동영상 편(NN_영상_*.txt)만. 사진 시리즈 기록은 그대로 둔다.
  · 쓴 영상 장부(state/video_used.json), 지난 계획, 준비해 둔 영상과 원고.

지우지 않는 것:
  · 네이버에 이미 임시저장된 글. 그건 여기서 지울 수 없다.
    다시 올리기 전에 네이버에서 직접 지워야 같은 글이 둘이 되지 않는다.
  · 스캔 결과(state/video_scan.json). 드라이브를 다시 훑을 이유는 없다.

    python3 scripts/video_reset.py            # 무엇을 지울지만 보여준다
    python3 scripts/video_reset.py --yes      # 실제로 지운다
"""

import argparse
import json
import re
import shutil
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRESS = ROOT / "state" / "progress.json"
IS_VIDEO = re.compile(r"\d+_영상_")


def nfc(s):
    return unicodedata.normalize("NFC", str(s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="실제로 지운다")
    args = ap.parse_args()

    try:
        prog = json.loads(PROGRESS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prog = {"posted": []}
    posted = prog.get("posted") or []
    vids = [x for x in posted if IS_VIDEO.match(nfc(x))]
    rest = [x for x in posted if not IS_VIDEO.match(nfc(x))]

    files = [ROOT / "state" / "video_used.json", ROOT / "state" / "video_plan.json"]
    drafts = sorted(f for f in (ROOT / "articles").glob("*.txt") if IS_VIDEO.match(nfc(f.name)))

    print(f"진행 기록의 동영상 편 {len(vids)}편을 지웁니다 (사진 시리즈 {len(rest)}편은 그대로):")
    for x in vids:
        print(f"    {nfc(x)}")
    print(f"쓴 영상 장부·지난 계획: {sum(f.exists() for f in files)}개 파일")
    print(f"준비해 둔 동영상 원고: {len(drafts)}편, 영상 폴더: {'있음' if (ROOT / 'videos').exists() else '없음'}")

    if not args.yes:
        print("\n(보여주기만 했습니다. 실제로 지우려면 --yes)")
        return

    prog["posted"] = rest
    PROGRESS.parent.mkdir(parents=True, exist_ok=True)
    PROGRESS.write_text(json.dumps(prog, ensure_ascii=False, indent=2), encoding="utf-8")
    for f in files + drafts:
        try:
            f.unlink()
        except OSError:
            pass
    shutil.rmtree(ROOT / "videos", ignore_errors=True)
    print("\n지웠습니다. 동영상 편은 01번부터 다시 만들어집니다.")
    print("⚠️  네이버에 임시저장된 지난 동영상 글은 그대로 있습니다. 네이버에서 직접 지워주세요.")


if __name__ == "__main__":
    main()
