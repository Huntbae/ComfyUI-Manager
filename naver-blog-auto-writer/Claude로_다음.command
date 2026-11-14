#!/bin/bash
# 더블클릭하면: 이 폴더에서 로컬 Claude Code를 열고, 바로 "다음"을 입력해
# 다음 글 한 편을 네이버 블로그에 임시저장합니다. (맥북에서 실행되므로 네이버 접속 가능)
cd "$(dirname "$0")"

# claude 실행 파일 찾기 (PATH → 일반 설치 경로들)
CLAUDE="$(command -v claude || true)"
for p in "$HOME/.local/bin/claude" "/usr/local/bin/claude" "/opt/homebrew/bin/claude"; do
  [ -z "$CLAUDE" ] && [ -x "$p" ] && CLAUDE="$p"
done
if [ -z "$CLAUDE" ]; then
  echo "claude(로컬 Claude Code)를 찾지 못했습니다."
  echo "설치: curl -fsSL https://claude.ai/install.sh | bash  (후 터미널 새로 열기)"
  exit 1
fi

# 초기 프롬프트로 "다음"을 넣어 Claude Code 실행 (CLAUDE.md 지시서를 따름)
exec "$CLAUDE" "다음"
