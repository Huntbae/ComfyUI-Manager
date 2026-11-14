#!/bin/bash
# 네이버 클립에 올릴 영상이 남지 않을 때까지 계속 올린다.
#
#   kart clip all
#
# 열 개씩 찾고(clip_plan.py) 올리고(clip-go), 다시 찾는다. 찾을 것이 없으면 끝난다.
# 같은 영상은 빠진다 — 파일이 똑같은 사본은 내용 지문으로, 다시 내보낸 사본은
# 화면 지문으로 (scripts/fingerprint.py). 교육 현장 영상은 빠진다.
#
# 멈추는 경우
#   · 게시 버튼은 눌렀는데 게시됐는지 확인하지 못했을 때 — 다시 하면 같은 클립이
#     둘이 될 수 있다. 클립 관리 화면에서 확인한 뒤 다시 돌린다.
#   · 화면 구조가 예상과 달라 제목칸·게시 버튼을 못 찾을 때 — 코드를 고쳐야 한다.
#   · 그 밖의 실패가 두 묶음 연속으로 났을 때 (한 편마다 이미 세 번씩 다시 해 본 뒤다).
# 어느 경우든 그때 화면에 있던 것을 찍고 멈춘다. 그 화면을 보내면 고친다.
#
# 올리면 바로 공개된다.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

BATCH=10
round=0
fails=0
start=$(python3 -c "import json;print(len(json.load(open('state/clip_done.json')).get('keys',[])))" 2>/dev/null || echo 0)

while true; do
  round=$((round + 1))
  echo
  echo "════════ ${round}번째 묶음: 다음 영상 찾기 ════════"
  python3 scripts/clip_plan.py --count "$BATCH"
  rc=$?
  if [ "$rc" = "3" ]; then
    echo
    echo "더 올릴 영상이 없습니다."
    break
  elif [ "$rc" != "0" ]; then
    echo "❌ 영상 찾기에서 멈췄습니다. 이 화면을 보내주세요."
    exit 1
  fi

  echo
  echo "════════ ${round}번째 묶음: 올리기 ════════"
  node index.js clip-go
  rc=$?
  if [ "$rc" = "0" ]; then
    fails=0
    continue
  elif [ "$rc" = "2" ]; then
    echo
    echo "멈춥니다. 게시 버튼은 눌렀는데 게시됐는지 확인하지 못했습니다."
    echo "clipcreators.naver.com 의 콘텐츠 목록에서 방금 그 클립이 올라갔는지 보고,"
    echo "올라갔다면 그대로, 아니면 그대로 두고 다시 kart clip all 을 돌리세요."
    exit 2
  elif [ "$rc" = "4" ]; then
    echo
    echo "멈춥니다. 화면 구조가 예상과 달라 코드를 고쳐야 합니다. 이 화면 전체를 보내주세요."
    exit 4
  fi
  fails=$((fails + 1))
  if [ "$fails" -ge 2 ]; then
    echo
    echo "멈춥니다. 두 묶음 연속으로 실패했습니다. 이 화면 전체를 보내주세요."
    exit 1
  fi
  echo
  echo "실패했지만 한 번 더 해 봅니다. 2분 쉽니다…"
  sleep 120
done

end=$(python3 -c "import json;print(len(json.load(open('state/clip_done.json')).get('keys',[])))" 2>/dev/null || echo 0)
echo
echo "════════ 끝 ════════"
echo "이번에 클립 $((end - start))개를 올렸습니다 (지금까지 모두 ${end}개)."
echo "clipcreators.naver.com 의 콘텐츠 목록에서 확인하세요."
