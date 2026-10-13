#!/bin/bash
# 하루 한 편 자동 실행 — launchd가 매일 이 파일을 부른다.
# 하는 일: 최신 원고 받기 → 역사 사진(출처 포함) 확보 → 임시저장 1편 → 로그 남기기
# 발행은 하지 않는다. 임시저장까지만.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/out/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$(date +%Y-%m-%d).log"

# launchd는 로그인 셸 PATH를 물려받지 않는다. node/python/git이 있는 곳을 직접 넣어준다.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

say() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

cd "$ROOT" || { echo "경로 없음: $ROOT"; exit 1; }

say "=== 하루 한 편 시작 ==="

# 1) 원고 최신화 (실패해도 계속 — 네트워크 문제로 오늘 글을 거르지 않는다)
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if git diff --quiet && git diff --cached --quiet; then
    git pull --ff-only origin "$BRANCH" >>"$LOG" 2>&1 && say "원고 최신화 완료 ($BRANCH)" || say "원고 최신화 건너뜀"
  else
    say "로컬 수정본이 있어 pull 건너뜀"
  fi
fi

# 2) 오늘 글에 역사 사진이 필요하면 받아온다 (출처는 스크립트가 캡션에 박아 넣는다)
NEXT_FILE="$(node -e '
  const q = require("./src/queue");
  const n = q.getNext();
  if (!n.done && !n.error) console.log(require("path").join(n.config.sourceDir, n.file));
' 2>/dev/null)"
if [ -n "${NEXT_FILE:-}" ] && grep -q '\[\[img:hist_' "$NEXT_FILE" 2>/dev/null; then
  if grep -q '(출처 확인 전' "$NEXT_FILE" 2>/dev/null; then
    say "역사 사진 내려받는 중 (위키미디어 공용)"
    python3 scripts/fetch_history_images.py >>"$LOG" 2>&1 \
      && say "역사 사진 준비 완료" \
      || say "⚠ 역사 사진 실패 — 아래 next에서 막힐 수 있음"
  fi
fi

# 3) 한 편 임시저장
say "임시저장 시도"
node index.js next >>"$LOG" 2>&1
RC=$?
if [ $RC -eq 0 ]; then
  say "✅ 오늘 한 편 임시저장 완료"
else
  say "❌ 실패 (코드 $RC) — 이 글은 내일 다시 시도됩니다. 자세한 내용은 $LOG"
fi

# 4) 오래된 로그·녹화 정리 (30일)
find "$LOG_DIR" -name 'daily-*.log' -mtime +30 -delete 2>/dev/null
find "$ROOT/out" -name '*.webm' -mtime +30 -delete 2>/dev/null

say "=== 끝 ==="
exit $RC
