#!/usr/bin/env python3
"""영상 채택 판정 시험. 드라이브 없이 경로 문자열만으로 돈다.

여기 있는 경로는 모두 실제 스캔에서 나온 폴더 이름이다. 지어낸 것이 아니다.
한 번 1,084개가 잡혔고 그 대부분이 오탐이었다 — 조상 폴더 하나가 '칼리'면
그 아래 사진 라이브러리 덤프(Photos-001 277개)와 사람 이름 폴더
(카메라 촬영_홍성욱 60개)까지 전부 끌려 들어왔다. 그 일이 다시 생기지
않게 고정한다.

    python3 test/match-site.py
"""

import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from collect_videos import is_ours, matched_hints, theme_of  # noqa: E402

# (설명, 경로, 채택되어야 하나)
CASES = [
    # ── 끌려 들어오면 안 되는 것 ───────────────────────────────
    ("조상 이름으로 끌려온 사진덤프",
     "/Volumes/Mac Data/칼리/Photos-001 (2)/IMG_1.mov", False),
    ("사람 이름 폴더 (초상권)",
     "/Volumes/Mac Data/칼리 자료/카메라 촬영_홍성욱/a.mp4", False),
    ("사람 이름만 적힌 폴더",
     "/Volumes/Mac Data/에듀카트/배효수/a.mp4", False),
    ("Mopetta (우리 차가 아니다)",
     "/Volumes/Mac Data/에듀카트/Mopetta/b.mp4", False),
    ("관계없는 프로젝트의 중간 산출물",
     "/Volumes/Mac Data/야담/호롱불야담/EP49/cuts/j.mp4", False),
    ("참조 폴더 아래는 조상까지 본다",
     "/Volumes/Mac Data/CycleKart Design 참조/칼리/k.mp4", False),
    ("남의 영상 폴더",
     "/Volumes/Mac Data/칼리/참고동영상/x.mp4", False),
    ("일반 이름이지만 조상이 무관",
     "/Volumes/Mac Data/홍콩여행/동영상/c.mp4", False),

    # ── 들어와야 하는 것 ──────────────────────────────────────
    ("폴더 이름이 일반적이면 한 단계 위를 본다",
     "/Volumes/Mac Data/칼리/동영상/c.mp4", True),
    ("영문 일반 이름도 같다",
     "/Volumes/Mac Data/에듀카트/VIDEO/c.mp4", True),
    ("띄어쓰기 없는 '교육관련 영상' (170개)",
     "/Volumes/Mac Data/x/교육관련 영상/d.mp4", True),
    ("'1차 교육 관련 영상' (58개)",
     "/Volumes/Mac Data/x/1차 교육 관련 영상/d.mp4", True),
    ("조립 영상 제작",
     "/Volumes/Mac Data/x/조립 영상 제작/e.mp4", True),
    ("Ver. 2 조립관련 영상",
     "/Volumes/Mac Data/x/Ver. 2 조립관련 영상/f.mp4", True),
    ("Ver. 3 알루미늄 차체",
     "/Volumes/Mac Data/x/Ver. 3 알루미늄 차체/g.mp4", True),
    ("사이클카트 공도주행",
     "/Volumes/Mac Data/x/20240820-사이클카트 공도주행/h.mp4", True),
    ("횡성 시승회",
     "/Volumes/Mac Data/x/241016 횡성 시승회/i.mp4", True),
    ("EDU-KART 동영상",
     "/Volumes/Mac Data/x/EDU-KART 동영상/i.mp4", True),
    ("탑승영상",
     "/Volumes/Mac Data/x/탑승영상/i.mp4", True),
    ("실측 확인 영상",
     "/Volumes/Mac Data/x/Cycle Kart(newtro M) 실측 확인 영상/i.mp4", True),
]


def main():
    bad = []
    for name, p, want in CASES:
        # 맥은 한글 파일명을 NFD 로 준다. 시험도 그 조건으로 돈다.
        nfd = Path(unicodedata.normalize("NFD", p))
        got = is_ours(nfd)
        if got != want:
            bad.append((name, p, want, got, matched_hints(nfd)))
        print(f"{'✅' if got == want else '❌'} "
              f"{'채택' if got else '제외'}  {name}")

    # 주제 이름이 NFC 로 돌아오는지 — 원고 제목에 그대로 쓰인다
    t = theme_of(Path(unicodedata.normalize("NFD", "/x/조립 영상 제작/a.mp4")))
    if t != "조립 영상 제작":
        bad.append(("주제 이름이 NFC 가 아니다", t, "조립 영상 제작", t, []))
        print("❌ 주제 이름 NFC 정규화")
    else:
        print("✅ 주제 이름이 NFC 로 돌아온다")

    print()
    if bad:
        print(f"{len(bad)}개 실패:")
        for name, p, want, got, hints in bad:
            print(f"  {name}\n    경로: {p}\n    기대: {want} / 실제: {got} / 힌트: {hints}")
        sys.exit(1)
    print(f"{len(CASES) + 1}개 모두 통과")


if __name__ == "__main__":
    main()
