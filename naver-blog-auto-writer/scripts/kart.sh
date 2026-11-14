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
      --src <경로>       볼 폴더를 직접 추가 (공백 있으면 따옴표)
      --only-src         그 폴더만 본다 (자동 인식 끔)
    kart history         역사 사진 내려받기 (출처 자동 표기)
    kart videos [옵션]   동영상 모으기 + BGM 입히기 (원본 소리는 덮는다)
      --scan-only        어디에 몇 개 있는지만 (못 잡은 폴더 이름도 보여준다)
      --dry-run          편별 배정 계획만
      --bgm <파일>       쓸 음원 (기본: auto — 영상 종류에 맞는 곡을 고른다)
      --keep-audio       원본 소리를 남긴다 (사람 목소리가 공개될 수 있다)
      --src <경로>       볼 폴더를 직접 추가 · --only-src 면 그것만
      --max-articles N   N편만 만든다 (주제를 돌아가며 뽑음)
    kart vgo [편수]      동영상 편을 한 번에 끝까지 (확인→모으기→원고→임시저장)
      --redo             이미 올린 동영상 편까지 처음부터 다시 (새 음악으로 재업로드)
    kart vreset [--yes]  동영상 편 기록만 지우기 (사진 시리즈 기록은 그대로)
    kart vposts          그 영상으로 [동영상] 원고 만들기
    kart clip plan       네이버 클립에 올릴 영상 목록 (차량 영상만)
    kart clip go [N]     클립에 올려 게시 (올리면 바로 공개된다)
    kart clip doctor     클립 크리에이터 업로드 화면 구조 읽기 (게시하지 않음)
    kart topic           유튜브에서 글감 선정

  점검
    kart status          큐 현황
    kart sync            진행 기록만 다른 기기와 맞추기
    kart reset           진행 기록 초기화 (1편부터 다시)
    kart test            가짜 에디터 + 채택규칙 검증 (네이버 접속 안 함)
    kart doctor [--video] 에디터 구조 덤프 (--video: 동영상 업로드 창도)
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
  videos)   # 구글 드라이브에서 동영상을 모아 BGM 을 깔고 videos/ 에 넣는다.
            # --bgm 을 안 주면 기본 음원을 쓴다 (원본 소리는 덮는다).
            case " $* " in
              *" --bgm "*|*" --keep-audio "*|*" --scan-only "*|*" --dry-run "*)
                python3 scripts/collect_videos.py "$@" ;;
              *) python3 scripts/collect_videos.py --bgm auto "$@" ;;
            esac ;;
  vposts)   python3 scripts/make_video_articles.py "$@" ;;
  vgo)      bash scripts/vgo.sh "$@" ;;
  vreset)   python3 scripts/video_reset.py "$@" ;;
  clip)     # 네이버 클립 크리에이터 (clipcreators.naver.com)
            sub="${1:-}"; shift 2>/dev/null || true
            case "$sub" in
              plan)   python3 scripts/clip_plan.py --dry-run "$@" ;;
              doctor) python3 scripts/clip_plan.py --count 1 >/dev/null 2>&1
                      node index.js clip-doctor "$@" ;;
              go)     # 다음 영상을 찾아(올린 것은 빠진다) 올려서 게시한다.
                      # kart clip go 5  → 5개를 찾아 5개를 올린다
                      n="10"; case "${1:-}" in ''|*[!0-9]*) ;; *) n="$1" ;; esac
                      python3 scripts/clip_plan.py --count "$n" || exit 1
                      echo
                      node index.js clip-go "$@" ;;
              *)      echo "kart clip plan      클립에 올릴 영상 목록 (차량 영상만, 교육 영상 제외)"
                      echo "kart clip go [N]    클립에 올려 게시 (N개만. 올리면 바로 공개된다)"
                      echo "kart clip doctor    클립 크리에이터의 업로드 화면 구조 읽기 (게시하지 않음)" ;;
            esac ;;
  test)     npm test --silent ;;
  check)    npm run --silent check ;;
  ffmpeg)   npm run --silent link-ffmpeg ;;
  frames)   npm run --silent frames -- "$@" ;;
  pull)     # images/ 는 kart images 가 매번 새로 만드는 생성물이다. 그게 수정됨
            # 상태로 남아 있으면 git 이 pull 을 거부한다("unstaged changes").
            # 실제로 이것 때문에 새 코드가 며칠 동안 안 내려갔다.
            # 원본은 드라이브와 images_src/ 에 있으므로 버려도 잃는 게 없다.
            if ! git diff --quiet -- "$DIR/images" 2>/dev/null; then
              n=$(git diff --name-only -- "$DIR/images" | wc -l | tr -d ' ')
              echo "생성된 사진 ${n}개가 수정돼 있어 되돌립니다 (kart images 로 다시 만들어집니다)."
              git checkout -- "$DIR/images"
            fi
            git pull origin claude/naver-blog-auto-writer-tgbpz6 ;;
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
