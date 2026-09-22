#!/bin/bash
# 이 프로젝트를 다른 맥으로 옮길 수 있게 통째로 복사한다.
# 깃허브 계정 인증 없이 새 기기를 준비할 때 쓴다 (외장 드라이브·AirDrop 경유).
#
#   bash scripts/export-project.sh '/Volumes/Mac Data'
#   bash scripts/export-project.sh '/Volumes/Mac Data' --with-login
#
# 빼는 것:
#   node_modules/  — 기기마다 새로 깔아야 한다 (Intel·애플실리콘이 다르다)
#   out/           — 실행 흔적. 옮길 이유가 없다
#   .chrome-profile/ — 네이버 로그인 정보. 기본은 안 옮긴다.
#                      --with-login 을 주면 함께 옮겨 로그인을 건너뛸 수 있다.
#                      그때는 크롬을 먼저 끄세요. 켜진 채로 복사하면 프로필이 깨진다.
#
# .git 은 함께 옮긴다. 받는 쪽에서 이력을 보고 브랜치를 확인할 수 있다.
# 다만 비공개 저장소라 pull·push 는 받는 쪽에서 깃허브 인증을 한 번 해야 한다.

set -u
PROJ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# .git 은 리포 루트에 있다. 이 프로젝트는 그 안의 한 폴더다.
# 프로젝트만 복사하면 받는 쪽에 git 이 없어 kart pull 이 안 된다.
# 그래서 리포 루트째 옮긴다 (전부 합쳐도 150MB 안팎이라 부담이 없다).
ROOT="$(cd "$PROJ" && git rev-parse --show-toplevel 2>/dev/null)" || ROOT="$PROJ"
[ -n "$ROOT" ] || ROOT="$PROJ"

DEST="${1:-}"
WITH_LOGIN="${2:-}"

if [ -z "$DEST" ]; then
  echo "쓰는 법:  bash scripts/export-project.sh '<옮길 곳>' [--with-login]"
  echo
  echo "붙어 있는 드라이브:"
  ls /Volumes 2>/dev/null | sed 's/^/  /'
  echo
  echo "예:  bash scripts/export-project.sh '/Volumes/Mac Data'"
  exit 1
fi

if [ ! -d "$DEST" ]; then
  echo "❌ 그런 폴더가 없습니다: $DEST"
  exit 1
fi

OUT="$DEST/$(basename "$ROOT")"
SUB="${PROJ#$ROOT/}"          # 리포 루트 안에서 프로젝트가 있는 상대 경로
[ "$SUB" = "$PROJ" ] && SUB=""

if [ -e "$OUT" ]; then
  echo "⚠️  이미 있습니다: $OUT"
  printf "덮어쓸까요? 기존 것은 사라집니다 [y/N] "
  read -r ans
  case "$ans" in
    y|Y) rm -rf "$OUT" ;;
    *)   echo "취소했습니다."; exit 0 ;;
  esac
fi

EXCLUDES=(--exclude 'node_modules' --exclude 'out' --exclude '.DS_Store'
          --exclude '__pycache__' --exclude '.img_stage')

if [ "$WITH_LOGIN" = "--with-login" ]; then
  echo "네이버 로그인 프로필도 함께 옮깁니다."
  echo "  크롬이 켜져 있으면 지금 끄세요. 켜진 채로 복사하면 프로필이 깨집니다."
  printf "크롬을 껐으면 엔터 (취소는 Ctrl-C) "
  read -r _
else
  EXCLUDES+=(--exclude '.chrome-profile')
fi

echo
echo "복사 중 — $ROOT"
echo "        → $OUT"
echo

if command -v rsync >/dev/null 2>&1; then
  rsync -a "${EXCLUDES[@]}" "$ROOT/" "$OUT/" || { echo "❌ 복사 실패"; exit 1; }
else
  # rsync 가 없으면 통째로 복사한 뒤 뺄 것을 지운다
  mkdir -p "$OUT"
  cp -R "$ROOT/." "$OUT/" || { echo "❌ 복사 실패"; exit 1; }
  find "$OUT" \( -name node_modules -o -name __pycache__ -o -name .img_stage \) \
       -maxdepth 3 -type d -exec rm -rf {} + 2>/dev/null
  rm -rf "$OUT/${SUB:+$SUB/}out"
  [ "$WITH_LOGIN" = "--with-login" ] || rm -rf "$OUT/${SUB:+$SUB/}.chrome-profile"
fi

SIZE=$(du -sh "$OUT" 2>/dev/null | cut -f1)
NIMG=$(ls "$OUT/${SUB:+$SUB/}images" 2>/dev/null | wc -l | tr -d ' ')
NART=$(ls "$OUT/${SUB:+$SUB/}articles" 2>/dev/null | wc -l | tr -d ' ')

echo "────────────────────────────────"
echo "  옮긴 크기    ${SIZE:-?}"
echo "  원고         ${NART}개"
echo "  사진         ${NIMG}개"
echo "  네이버 로그인 $([ "$WITH_LOGIN" = "--with-login" ] && echo '함께 옮김' || echo '안 옮김 — 새 기기에서 kart login')"
echo "────────────────────────────────"
echo
echo "새 맥에서 할 일:"
echo "  1. 이 폴더를 홈으로 복사   cp -R '$OUT' ~/"
echo "  2. cd ~/$(basename "$ROOT")${SUB:+/$SUB}"
echo "  3. bash scripts/setup.sh"
echo "  4. source ~/.zshrc"
[ "$WITH_LOGIN" = "--with-login" ] || echo "  5. kart login"
echo
echo "⚠️  두 대에서 동시에 올리지 마세요. 진행 기록(state/progress.json)이"
echo "    어긋나 같은 글이 두 번 올라갑니다. 한 번에 한 대에서만 쓰세요."
