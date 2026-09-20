#!/bin/bash
# kart 의 실제 내용. 셸 함수는 이 파일을 부르기만 한다.
# 그래야 새 명령이 생겨도 kart pull 만으로 반영된다 (재설치 불필요).
# cd/where 만 부모 셸이 해야 해서 함수 쪽에 남는다.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cmd="${1:-}"; shift 2>/dev/null || true

case "$cmd" in
  ""|help|-h|--help)
    cat <<'TXT'
kart 사용법 (어느 폴더에서든 실행 가능)

  준비
    kart setup           이 기기 1회 설정 (의존성·ffmpeg·단축키·점검)
    kart login           네이버 로그인 (이 기기 프로필에 1회)

  올리기
    kart preview         네이버에 찍힐 모양을 터미널에서 미리보기
    kart next            다음 원고 1편 임시저장
    kart all [편수]      남은 글을 이어서 임시저장 (기본 90초 간격)
    kart retry           막힌 지점을 진단하며 단계적으로 재시도
    kart daily [시] [분] 매일 자동 (off / status / run)

  자료
    kart images [옵션]   사진 다시 모으기 (외장 드라이브 자동 인식)
      --scan-only        어떤 폴더에 몇 장이 있는지만 확인
      --dry-run          어느 사진이 어느 편에 들어갈지만 확인
      --src <경로>       볼 폴더를 직접 추가
    kart history         역사 사진 내려받기 (출처 자동 표기)
    kart topic           유튜브에서 글감 선정

  점검
    kart status          큐 현황
    kart sync            진행 기록만 다른 기기와 맞추기
    kart reset           진행 기록 초기화 (1편부터 다시)
    kart test            가짜 에디터로 로직 검증 (네이버 접속 안 함)
    kart doctor          에디터 구조 덤프 (셀렉터 점검)
    kart check / ffmpeg / frames

  기타
    kart pull            최신 원고·코드 받기
    kart cd / where      폴더 이동 · 경로 출력
TXT
    ;;
  setup)    bash scripts/setup.sh "$@" ;;
  retry)    bash scripts/retry.sh "$@" ;;
  daily)    bash scripts/install-daily.sh "$@" ;;
  images)   python3 scripts/rebuild_images.py "$@" ;;
  history)  python3 scripts/fetch_history_images.py "$@" ;;
  test)     npm test --silent ;;
  check)    npm run --silent check ;;
  ffmpeg)   npm run --silent link-ffmpeg ;;
  frames)   npm run --silent frames -- "$@" ;;
  pull)     git pull origin claude/naver-blog-auto-writer-tgbpz6 ;;
  sync)     node -e "const r=require('./src/sync').pullProgress(); console.log(r.ok ? ('동기화 완료 — 게시 '+(r.count===null?0:r.count)+'편') : ('동기화 실패: '+r.reason));" ;;
  next|다음|all|전부|status|reset|preview|login|topic|doctor|cookies|post)
            node index.js "$cmd" "$@" ;;
  *)        # 모르는 명령을 node로 넘기면 node가 자기 명령만 나열해
            # 정작 kart 쪽 명령(pull/history/daily/setup)이 안 보인다.
            echo "kart: 모르는 명령입니다 — '$cmd'" >&2
            echo >&2
            bash "$0" help >&2
            exit 1 ;;
esac
