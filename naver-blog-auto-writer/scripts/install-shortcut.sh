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
      echo "  kart setup           이 기기 1회 설정 (의존성·ffmpeg·단축키·점검)"
      echo "  kart sync            진행 기록만 다른 기기와 맞추기"
      echo "  kart preview         네이버에 찍힐 모양을 터미널에서 미리보기"
      echo "  kart next            다음 원고 1편 임시저장"
      echo "  kart retry           막힌 지점을 진단하며 단계적으로 재시도"
      echo "  kart doctor          글은 안 쓰고 에디터 구조만 덤프 (셀렉터 점검)"
      echo "  kart test            가짜 에디터로 자동화 로직 검증 (네이버 접속 안 함)"
      echo "  kart status          큐 현황"
      echo "  kart reset           진행 기록 초기화 (1편부터 다시)"
      echo "  kart login           네이버 로그인 (프로필에 1회)"
      echo "  kart topic           유튜브에서 글감 선정"
      echo "  kart images [옵션]   사진 다시 모으기 (--dry-run, --no-sweep, --from-existing, --src 경로)"
      echo "  kart history         역사 사진 내려받기 (위키미디어 공용, 출처 자동 표기)"
      echo "  kart daily [시] [분] 매일 한 편 자동 임시저장 켜기 (기본 09:00)"
      echo "  kart daily off       매일 자동 실행 끄기"
      echo "  kart daily status    자동 실행 상태 + 최근 로그"
      echo "  kart daily run       지금 한 번 실행"
      echo "  kart check           환경 점검"
      echo "  kart ffmpeg          녹화용 ffmpeg 연결"
      echo "  kart frames          최근 녹화를 프레임으로 자르기"
      echo "  kart pull            최신 원고·코드 받기"
      echo "  kart cd              프로젝트 폴더로 이동"
      echo "  kart where           프로젝트 경로 출력"
      ;;
    images)  ( cd "\$d" && python3 scripts/rebuild_images.py "\$@" ) ;;
    history) ( cd "\$d" && python3 scripts/fetch_history_images.py "\$@" ) ;;
    daily)   ( cd "\$d" && bash scripts/install-daily.sh "\$@" ) ;;
    retry)   ( cd "\$d" && bash scripts/retry.sh "\$@" ) ;;
    setup)   ( cd "\$d" && bash scripts/setup.sh "\$@" ) ;;
    sync)    ( cd "\$d" && node -e "const r=require('./src/sync').pullProgress(); console.log(r.ok ? ('동기화 완료 — 게시 '+(r.count===null?0:r.count)+'편') : ('동기화 실패: '+r.reason));" ) ;;
    test)    ( cd "\$d" && npm test --silent ) ;;
    check)   ( cd "\$d" && npm run --silent check ) ;;
    ffmpeg)  ( cd "\$d" && npm run --silent link-ffmpeg ) ;;
    frames)  ( cd "\$d" && npm run --silent frames -- "\$@" ) ;;
    pull)    ( cd "\$d" && git pull origin claude/naver-blog-auto-writer-tgbpz6 ) ;;
    where)   echo "\$d" ;;
    cd)      cd "\$d" ;;
    next|다음|status|reset|preview|login|topic|doctor|cookies|post)
             ( cd "\$d" && node index.js "\$cmd" "\$@" ) ;;
    *)       # 모르는 명령을 node로 넘기면 node가 자기 명령만 나열해서
             # 정작 kart 쪽 명령(pull/history/daily/images)이 안 보인다.
             echo "kart: 모르는 명령입니다 — '\$cmd'" >&2
             echo >&2
             kart help >&2
             return 1 ;;
  esac
}
$END
EOF

echo "✅ 설치 완료: $RC"
echo "   프로젝트: $DIR"
echo
echo "지금 창에서 바로 쓰려면:  source $RC"
echo "그다음:                   kart help"
