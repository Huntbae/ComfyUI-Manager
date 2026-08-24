#!/usr/bin/env bash
# kart 단축 명령을 셸에 설치한다. 어느 폴더에서 실행하든 프로젝트를 찾아간다.
#
#   bash scripts/install-shortcut.sh
#
# 이미 설치돼 있으면 최신 내용으로 갱신한다.
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 사용 중인 셸의 설정 파일 고르기
if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = "zsh" ]; then
  RC="$HOME/.zshrc"
else
  RC="$HOME/.bashrc"
fi
touch "$RC"

BEGIN="# >>> kart (naver-blog-auto-writer) >>>"
END="# <<< kart (naver-blog-auto-writer) <<<"

# 기존 블록 제거 (구버전 한 줄짜리 정의 포함)
tmp="$(mktemp)"
awk -v b="$BEGIN" -v e="$END" '
  $0==b {skip=1} !skip && $0 !~ /^kart\(\) \{/ {print} $0==e {skip=0}
' "$RC" > "$tmp" && mv "$tmp" "$RC"

cat >> "$RC" <<EOF
$BEGIN
kart() {
  local d="$DIR"
  local cmd="\$1"; shift 2>/dev/null || true
  case "\$cmd" in
    ""|help|-h|--help)
      echo "kart 사용법 (어느 폴더에서든 실행 가능)"
      echo "  kart next            다음 원고 1편 임시저장"
      echo "  kart status          큐 현황"
      echo "  kart reset           진행 기록 초기화 (1편부터 다시)"
      echo "  kart login           네이버 로그인 (프로필에 1회)"
      echo "  kart topic           유튜브에서 글감 선정"
      echo "  kart images [옵션]   사진 다시 모으기 (--dry-run, --no-sweep, --from-existing, --src 경로)"
      echo "  kart check           환경 점검"
      echo "  kart ffmpeg          녹화용 ffmpeg 연결"
      echo "  kart frames          최근 녹화를 프레임으로 자르기"
      echo "  kart pull            최신 원고·코드 받기"
      echo "  kart cd              프로젝트 폴더로 이동"
      echo "  kart where           프로젝트 경로 출력"
      ;;
    images)  ( cd "\$d" && python3 scripts/rebuild_images.py "\$@" ) ;;
    check)   ( cd "\$d" && npm run --silent check ) ;;
    ffmpeg)  ( cd "\$d" && npm run --silent link-ffmpeg ) ;;
    frames)  ( cd "\$d" && npm run --silent frames -- "\$@" ) ;;
    pull)    ( cd "\$d" && git pull origin claude/naver-blog-auto-writer-tgbpz6 ) ;;
    where)   echo "\$d" ;;
    cd)      cd "\$d" ;;
    *)       ( cd "\$d" && node index.js "\$cmd" "\$@" ) ;;
  esac
}
$END
EOF

echo "✅ 설치 완료: $RC"
echo "   프로젝트: $DIR"
echo
echo "지금 창에서 바로 쓰려면:  source $RC"
echo "그다음:                   kart help"
