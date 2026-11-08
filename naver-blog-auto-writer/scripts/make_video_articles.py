#!/usr/bin/env python3
"""
준비된 동영상(state/video_plan.json)으로 [동영상] 원고를 만든다.

사진 원고와 다르게 쓰는 이유가 있다. 나는 영상을 보지 못한다.
폴더 이름과 날짜, 그리고 이미 확정된 사실(제원·인증·일정)만 안다.
그래서 "영상에서 무엇을 하고 있다"고 쓰지 않는다. 대신
  · 이 영상이 어느 자리의 기록인지 (폴더·날짜)
  · 그 자리가 전체 이야기에서 무엇이었는지 (확정 사실)
를 적고, 보는 일은 영상에 맡긴다. 지어낸 묘사가 섞이는 것보다 낫다.

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

# 폴더 이름 → 이 자리가 무엇이었나. 확정된 범위 안에서만 적는다.
# 모르는 폴더는 THEME_FALLBACK 으로 간다.
THEMES = {
    "조립 영상 제작": (
        "에듀카트를 조립하는 과정",
        "에듀카트는 조립해 보면서 배우는 교육용 키트입니다. 그래서 조립 과정 자체가 "
        "교재입니다. 영상으로 남겨둔 이유도 그것입니다 — 글로 적은 순서로는 "
        "손이 어디로 가야 하는지를 못 알려줍니다.",
    ),
    "1차 교육 관련 영상": (
        "첫 교육 현장",
        "만든 물건을 처음 남에게 쥐여주는 자리입니다. 설계가 맞았는지는 이 자리에서 "
        "드러납니다. 설명서대로 안 되는 지점, 손이 안 들어가는 지점이 바로 보입니다.",
    ),
    "Ver. 2 조립관련 영상": (
        "2차 버전 조립",
        "첫 버전을 교육에 써 보고 고친 것이 2차 버전입니다. 무엇이 바뀌었는지는 "
        "부품 변경 관리대장에 남습니다. 그 이야기는 사진 시리즈 16편에 적었습니다.",
    ),
    "EDU-KART 동영상": (
        "에듀카트",
        "에듀카트는 인증이 필요 없는 영역에서 먼저 굴려본 제품입니다. "
        "교육용·사유지용이라 도로 인증 절차를 밟지 않아도 됩니다. "
        "그 순서가 왜 중요한지는 사진 시리즈 25편에 적었습니다.",
    ),
    "군산 에듀카트 교육": (
        "교육 현장",
        "학교와 공공기관에 물건을 넣을 때 알아야 할 것들이 있습니다. "
        "그 이야기는 사진 시리즈 28편에 따로 적었습니다.",
    ),
    "카트 영상": (
        "카트 주행",
        "달리는 모습입니다. 최고속도는 60km/h로 묶여 있습니다 — 저희가 정한 숫자가 "
        "아니라 사륜형 이륜자동차에 걸린 법정 상한입니다.",
    ),
    "송부 동영상": ("보내기 위해 정리한 기록", "자료로 보내려고 따로 묶어둔 영상입니다."),
    "Cycle Kart(newtro M) 실측 확인 영상": (
        "실측 확인",
        "제원표에 적어낸 숫자와 실제 차를 맞춰보는 절차입니다. 길이를 재고, 무게를 달고, "
        "번호를 대조합니다. 칼리의 전장은 2,495밀리미터로 적혀 있습니다 — "
        "법정 한계 2,500에서 5밀리미터를 뺀 숫자입니다. 그 5밀리미터가 왜 필요했는지는 "
        "사진 시리즈 11편에 적었습니다.",
    ),
    "칼리 실태조사시": (
        "사업 실태조사",
        "국가 연구개발 과제를 하면 정기적으로 점검을 받습니다. 그 자리의 기록입니다.",
    ),
    "칼리-여수": (
        "여수에서",
        "현장에서 찍은 기록입니다. 만든 물건을 현장에 내보내면 사무실에서 안 보이던 "
        "것들이 보입니다.",
    ),
    "10.7. 차량주행 Test 영상": (
        "주행 시험",
        "최고속도는 60km/h입니다. 저희가 정한 숫자가 아니라 사륜형 이륜자동차에 "
        "걸린 법정 상한입니다. 그 이상 나가지 못하도록 속도제한장치를 달고 봉인합니다.",
    ),
    "사이클카트영상-고프로": ("차에 붙여 찍은 기록", "차체에 카메라를 붙여 찍었습니다."),
    "탑승영상": (
        "타 보는 자리",
        "1인승입니다. 승차정원 1명은 저희 선택이 아니라 이 차종에 걸린 법적 조건입니다. "
        "옆자리를 없애고, 지붕과 문을 없애고, 트렁크를 없애라 — 그 세 줄이 "
        "차의 생김새를 거의 다 정했습니다.",
    ),
    "운행영상": ("운행", "번호판을 달고 도로에 나간 뒤의 기록입니다."),
    "교육 동영상": ("교육", "교육 과정의 기록입니다."),
    "동영상 임시 백업": ("개발 기록", "개발 과정에서 남은 영상입니다."),
}
THEME_FALLBACK = ("개발 기록", "개발 과정에서 남은 영상입니다.")

HEAD = "[동영상]"

# 글 끝에 붙이는 안내. 소리를 바꿨다는 사실은 밝혀두는 편이 정직하다.
OUTRO = (
    "영상의 소리는 배경음악으로 바꿨습니다. 현장 소음과 대화가 섞여 있어서 그대로 "
    "올리기 어려웠습니다."
)

SERIES = (
    "이 블로그에는 「기획자가 개발한 전기차 사이클카트」 서른 편을 사진과 함께 따로 "
    "적어두었습니다. 왜 이런 차가 됐는지, 인증은 어떻게 통과했는지는 그쪽에 있습니다."
)


def nfc(s):
    return unicodedata.normalize("NFC", s)


def slug(s):
    s = nfc(s)
    s = re.sub(r"[^\w가-힣]+", "", s)
    return s[:24] or "영상"


def build(entry, idx, total):
    theme = nfc(entry["theme"])
    title_part, lead = THEMES.get(theme, THEME_FALLBACK)
    vids = entry["videos"]

    # 날짜를 하나라도 알면 제목에 넣는다. 영상 파일명·경로에서 읽은 값이다.
    when = ""
    for v in vids:
        m = re.search(r"(20\d{2})[-_.]?(\d{2})", Path(v["source"]).name)
        if m and 1 <= int(m.group(2)) <= 12:
            when = f"{m.group(1)}년 {int(m.group(2))}월 "
            break

    title = f"{HEAD} {when}{title_part}"
    if total > 1:
        title = f"{title} ({idx}/{total})"

    lines = [title, "", lead, ""]

    # 영상마다 설명을 달리 적는다. 같은 문장이 세 번 찍히면 성의 없어 보인다.
    # 사진 쪽에서 캡션이 겹치던 것과 같은 문제다.
    NTH = ["첫 번째", "두 번째", "세 번째"]
    for i, v in enumerate(vids):
        sec = f" · {int(v['sec'])}초" if v.get("sec") else ""
        if len(vids) == 1:
            cap = f"{title_part}{sec}"
        else:
            cap = f"{title_part} — {NTH[i] if i < len(NTH) else f'{i+1}번째'}{sec}"
        lines.append(f"[[video:{v['file']}|{cap}]]")
        lines.append("")
        if len(vids) > 1 and i == 0:
            lines.append("같은 자리에서 찍은 것이 더 있습니다. 이어서 보시면 됩니다.")
            lines.append("")

    lines += [
        "**이 영상을 왜 남겼나**", "",
        "개발 과정은 서류로 남습니다. 제원표, 시험성적서, 회의록. 그런데 서류는 "
        "무엇이 어떻게 움직였는지를 못 적습니다. 그래서 영상을 찍었습니다. "
        "지금 돌아보면 그게 제일 쓸모 있는 기록이었습니다.", "",
        "**소리에 대해**", "", OUTRO, "",
        "**함께 보기**", "", SERIES, "",
    ]
    return title, "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not PLAN.exists():
        sys.exit(f"영상 계획이 없습니다: {PLAN}\n먼저 kart videos 를 돌리세요.")
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    entries = plan.get("articles") or []
    if not entries:
        sys.exit("계획에 편이 없습니다.")

    # 같은 주제가 여러 편이면 (1/3) 처럼 번호를 붙인다
    counts = {}
    for e in entries:
        counts[nfc(e["theme"])] = counts.get(nfc(e["theme"]), 0) + 1
    seen = {}

    made = []
    for e in entries:
        th = nfc(e["theme"])
        seen[th] = seen.get(th, 0) + 1
        title, body = build(e, seen[th], counts[th])
        made.append((th, seen[th], title, body, len(e["videos"])))

    print(f"동영상 원고 {len(made)}편\n")
    for i, (_th, _n, title, body, nv) in enumerate(made, 1):
        print(f"  {i:2}. {title}  (영상 {nv}개, {len(body)}자)")

    if args.dry_run:
        print("\n(--dry-run 이므로 파일을 만들지 않았습니다)")
        return

    # 기존 원고는 보관한다. 사진 시리즈 30편을 지우지 않는다.
    # 되돌리려면 mv articles_v6/*.txt articles/
    if ARTICLES.exists() and any(ARTICLES.glob("*.txt")):
        keep = ROOT / "articles_v6"
        keep.mkdir(exist_ok=True)
        moved = 0
        for f in ARTICLES.glob("*.txt"):
            shutil.move(str(f), keep / f.name)
            moved += 1
        print(f"\n사진 시리즈 {moved}편 → articles_v6/ 로 보관했습니다.")
        print("   되돌리려면: mv articles_v6/*.txt articles/")

    ARTICLES.mkdir(parents=True, exist_ok=True)
    for i, (th, n, title, body, _nv) in enumerate(made, 1):
        name = f"{i:02d}_영상_{slug(th)}{'' if counts[th] == 1 else f'_{n}'}.txt"
        (ARTICLES / name).write_text(body, encoding="utf-8")
    print(f"\n원고 {len(made)}편 → {ARTICLES}")
    print("다음: kart status 로 큐를 확인하고, kart next 로 한 편 올려보세요.")


if __name__ == "__main__":
    main()
