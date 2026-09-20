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
# 내용은 scripts/kart.sh 에 있다. 여기는 부르기만 한다.
# 그래야 새 명령이 생겨도 kart pull 만으로 반영된다 (재설치 불필요).
kart() {
  local d="$DIR"
  case "\$1" in
    cd)    cd "\$d" ;;                       # 부모 셸에서 해야 해서 여기 남는다
    where) echo "\$d" ;;
    *)     ( bash "\$d/scripts/kart.sh" "\$@" ) ;;
  esac
}
$END
EOF

echo "✅ 설치 완료: $RC"
echo "   프로젝트: $DIR"
echo
echo "지금 창에서 바로 쓰려면:  source $RC"
echo "그다음:                   kart help"
