#!/bin/bash
# kart retry — 막힌 지점을 스스로 진단하며 단계를 올려 재시도한다.
#
#   1) 원고·코드 최신화
#   2) 사진과 출처 확보
#   3) 임시저장 시도
#   4) need_login 이면 로그인 창을 띄우고 다시 시도
#   5) 그래도 안 되면 진단 결과와 다음 선택지를 알려준다
#
# 진행 기록 초기화(reset)는 자동으로 하지 않는다.
# 네이버에 이미 저장된 글은 지워지지 않아서 같은 글이 두 개씩 쌓이기 때문이다.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

step() { echo; echo "▸ $*"; }
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

step "1/4  원고·코드 최신화"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [ -n "${BRANCH:-}" ] && git diff --quiet && git diff --cached --quiet; then
  git pull --ff-only origin "$BRANCH" 2>&1 | tail -2
else
  echo "   로컬 수정본이 있어 건너뜁니다 (git status 확인)"
fi

step "2/4  사진·출처 확보"
python3 scripts/fetch_history_images.py 2>&1 | grep -E "❌|⚠|✅|←|출처 목록|캡션" || true

step "3/4  임시저장 시도"
node index.js next 2>&1 | tee "$OUT"
RC=${PIPESTATUS[0]}
[ "$RC" -eq 0 ] && { echo; echo "✅ 끝났습니다. 네이버 > 글쓰기 > 저장된 글에서 확인하세요."; exit 0; }

# --- 여기부터는 실패했을 때 ---
if grep -q 'need_login' "$OUT"; then
  step "4/4  로그인이 필요합니다 — 크롬 창을 엽니다"
  echo "   창에서 네이버에 로그인하면 자동으로 다시 시도합니다."
  node index.js login
  node index.js next
  RC=$?
  [ "$RC" -eq 0 ] && { echo; echo "✅ 로그인 후 임시저장 완료."; exit 0; }
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "아직 안 됩니다. 진단:"
echo
if grep -q '이미지.*없습니다' "$OUT"; then
  echo "  · 사진이 모자랍니다 → python3 scripts/fetch_history_images.py 출력을 확인하세요"
elif grep -q '출처가 아직' "$OUT"; then
  echo "  · 사진 출처가 안 채워졌습니다 → kart history 를 단독으로 돌려 오류를 보세요"
elif grep -qi 'net::\|ETIMEDOUT\|ENOTFOUND' "$OUT"; then
  echo "  · 네트워크 문제입니다 → 인터넷 연결 확인 후 kart retry 를 다시"
elif grep -qi 'timeout' "$OUT"; then
  echo "  · 에디터에서 요소를 못 찾았습니다 (네이버 DOM 변경 가능성)"
  echo "    눈으로 보려면:  node index.js next --headful"
  echo "    녹화 확인:      npm run frames"
else
  echo "  · 원인이 위 출력에 있습니다. 그대로 복사해서 보내주세요."
fi
LATEST="$(ls -td "$ROOT"/out/debug/*/ 2>/dev/null | head -1)"
if [ -n "$LATEST" ]; then
  echo
  echo "증거가 남았습니다: $LATEST"
  echo "  report.txt  화면 텍스트 + 버튼 목록 (셀렉터가 틀렸는지 바로 보입니다)"
  echo "  screen.png  그 순간 화면"
  echo "  이 두 개를 보내주시면 원인을 잡습니다."
fi
echo
echo "에디터 구조만 따로 보려면:  kart doctor"
echo
echo "처음부터 다시 올리고 싶으면 (주의):"
echo "    kart reset && kart next"
echo "  네이버에 이미 임시저장된 글은 지워지지 않아 같은 글이 두 개씩 쌓입니다."
echo "  기존 임시저장 글을 먼저 직접 지우세요."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit "$RC"
