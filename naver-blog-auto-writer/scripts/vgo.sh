#!/bin/bash
# 동영상 편을 한 번에 끝까지: 로그인 확인 → 모으기 → 원고 → 올리기.
#
# 왜 있나: 단계마다 명령을 하나씩 받아 돌리고 출력을 되돌려 보내는 데
# 하루가 갔다. 그동안 한 편도 올리지 못했다. 이 스크립트는 한 번에 끝까지 가고,
# 막히면 그 자리에서 멈춰 고치는 데 필요한 것을 화면에 다 찍는다.
# 그 화면 하나만 있으면 무엇을 고칠지 알 수 있게 하는 것이 목적이다.
#
#   kart vgo                 10편
#   kart vgo 3               3편만
#   kart vgo 10 --only-src --src "/Volumes/Mac Data"
#
# 발행은 하지 않는다. 임시저장까지다.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

N=10
if [[ "${1:-}" =~ ^[0-9]+$ ]]; then N="$1"; shift; fi

step() { echo; echo "════════ $1 ════════"; }

# 가장 최근 덤프의 report.txt 를 찍는다. 실패했을 때 무엇을 고칠지는 여기 있다.
show_evidence() {
  local d
  d="$(ls -td out/debug/*/ 2>/dev/null | head -1)"
  [ -n "$d" ] && [ -f "${d}report.txt" ] || return 0
  echo
  echo "──── 실패 순간의 화면 구조 (${d}) ────"
  # 화면 텍스트는 길다. 버튼·입력칸·프레임 목록이 필요한 부분이다.
  sed -n '/=== 버튼 목록 ===/,$p' "${d}report.txt" | grep -v 'toolbar-button\|insert-menu' | head -150
}

fail() {
  echo
  echo "❌ $1 단계에서 멈췄습니다."
  show_evidence
  echo
  echo "이 터미널 화면을 처음부터 끝까지 그대로 보내주세요."
  exit 1
}

step "1/4  로그인과 동영상 업로드 창 확인"
node index.js doctor --video || {
  echo
  echo "글쓰기 화면에 못 들어갔습니다. 위의 '판정'을 보세요."
  echo "로그인이 풀린 것이면:  kart login  →  kart vgo"
  exit 1
}

step "2/4  동영상 모으기 + 배경음악 (${N}편)"
python3 scripts/collect_videos.py --bgm music/bgm_quiet_90s.mp3 --max-articles "$N" "$@" \
  || fail "동영상 모으기"

step "3/4  원고 만들기"
python3 scripts/make_video_articles.py || fail "원고 만들기"

step "4/4  네이버에 임시저장"
# --no-sync: 이 기기에서는 git 푸시가 아이디·비밀번호를 물어 멈춘다.
# 한 편을 먼저 올려 본다. 되면 나머지를 이어서 올린다.
node index.js next --no-sync || fail "첫 편 올리기"

echo
echo "✅ 첫 편이 올라갔습니다. 나머지를 이어서 올립니다 (편 사이 90초)."
node index.js all --no-sync || fail "나머지 올리기"

echo
echo "════════ 끝 ════════"
node index.js status 2>/dev/null | tail -15
echo
echo "네이버 글쓰기 화면에서 '저장' 옆의 숫자를 누르면 임시저장 목록이 열립니다."
echo "발행은 하지 않았습니다. 영상에 나오는 얼굴을 확인한 뒤 직접 발행하세요."
