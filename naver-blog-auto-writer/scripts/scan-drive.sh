#!/bin/bash
# 외장 드라이브에 쓸 만한 사진이 몇 장이나 있는지 센다.
#
# 개발자 도구(Xcode CLT)가 없어도 돌아간다. macOS 기본 명령만 쓴다 —
# find · md5 · stat · awk. git 도 python3 도 필요 없다.
# rebuild_images.py 와 같은 기준으로 거르므로 실제 수집 결과를 미리 가늠할 수 있다.
#
#   bash scan-drive.sh '/Volumes/Mac Data/backup'
#   bash scan-drive.sh                      # 경로 없이 쓰면 /Volumes 전체를 훑는다
#
# 읽기만 한다. 아무것도 바꾸지 않는다. Ctrl-C 로 중단해도 안전하다.

SRC="$1"

# 경로를 안 주면 붙어 있는 외장 드라이브를 알아서 찾는다
if [ -z "$SRC" ]; then
  echo "경로를 안 주셨습니다. /Volumes 아래를 봅니다."
  echo
  ls /Volumes 2>/dev/null | sed 's/^/  /'
  echo
  echo "쓰시려면:  bash $0 '/Volumes/<드라이브 이름>'"
  exit 0
fi

if [ ! -d "$SRC" ]; then
  echo "❌ 그런 폴더가 없습니다: $SRC"
  echo
  echo "드라이브 목록:"
  ls /Volumes 2>/dev/null | sed 's/^/  /'
  echo
  echo "이름에 공백이 있으면 따옴표로 감싸세요 — '/Volumes/Mac Data/backup'"
  exit 1
fi

# md5 는 맥, md5sum 은 리눅스
if command -v md5 >/dev/null 2>&1; then
  MD5() { md5 -q; }
elif command -v md5sum >/dev/null 2>&1; then
  MD5() { md5sum | awk '{print $1}'; }
else
  MD5() { cksum | awk '{print $1}'; }
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "훑는 중입니다: $SRC"
echo "  (드라이브가 크면 몇 분 걸립니다. Ctrl-C 로 멈춰도 됩니다)"
echo

# 들어가 봐야 시간만 쓰는 폴더들을 먼저 쳐낸다.
#   - 타임머신: 같은 파일이 날짜별 스냅샷마다 있다
#   - 앱 번들·캐시: 아이콘·에셋 창고
#   - derivatives/proxies/thumbnails: 같은 사진의 축소본. 크기가 달라
#     내용 지문으로도 안 걸러지므로 이름으로 막아야 한다
find "$SRC" \
  \( -name '.*' \
     -o -name '__MACOSX' -o -name 'System Volume Information' \
     -o -name 'lost+found' -o -name 'node_modules' \
     -o -name 'Backups.backupdb' \
     -o -name 'Caches' -o -name 'Cache' \
     -o -name 'Application Support' -o -name 'Containers' \
     -o -name 'derivatives' -o -name 'proxies' -o -name 'thumbnails' \
     -o -name '*.app' -o -name '*.framework' -o -name '*.bundle' \
     -o -name '*.plugin' -o -name '*.kext' -o -name '*.sparsebundle' \
     -o -name '*.lrdata' -o -name '*.fcpbundle' -o -name '*.imovielibrary' \
  \) -prune \
  -o -type f -print 2>/dev/null \
| awk 'tolower($0) ~ /\.(jpg|jpeg|png|webp|tif|tiff|bmp|gif|heic|heif|arw|cr2|cr3|nef|dng|raf|orf|rw2|srw)$/' \
> "$TMP/all.txt"

TOTAL=$(wc -l < "$TMP/all.txt" | tr -d ' ')

if [ "$TOTAL" -eq 0 ]; then
  echo "이미지 파일을 못 찾았습니다."
  echo "폴더 안에 뭐가 있는지 보세요:  ls '$SRC'"
  exit 0
fi

echo "이미지 파일: ${TOTAL}장"
echo
echo "형식별:"
awk -F. '{print tolower($NF)}' "$TMP/all.txt" | sort | uniq -c | sort -rn \
  | awk '{printf "  %6d장  .%s\n", $1, $2}'

# 너무 작은 건 아이콘·썸네일이다. rebuild_images.py 와 같은 기준(120KB)
echo
echo "지문 계산 중 (같은 사진 걸러내기)..."
while IFS= read -r f; do
  sz=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null) || continue
  [ "${sz:-0}" -lt 120000 ] && continue
  # 크기 + 앞 64KB 해시. 전체를 읽으면 드라이브가 클 때 너무 느리다.
  h=$(dd if="$f" bs=65536 count=1 2>/dev/null | MD5)
  echo "$sz-$h"
done < "$TMP/all.txt" > "$TMP/keys.txt"

BIG=$(wc -l < "$TMP/keys.txt" | tr -d ' ')
UNIQ=$(sort -u "$TMP/keys.txt" | wc -l | tr -d ' ')

echo
echo "────────────────────────────────"
echo "  찾은 이미지        ${TOTAL}장"
echo "  120KB 이상          ${BIG}장   (작은 건 아이콘·썸네일이라 뺐습니다)"
echo "  서로 다른 사진      ${UNIQ}장   ← 실제로 쓸 수 있는 장수"
echo "────────────────────────────────"
echo
if [ "$UNIQ" -ge 60 ]; then
  echo "✅ 30편 × 2장 = 60장을 중복 없이 채울 수 있습니다."
else
  echo "⚠️  60장에 ${UNIQ}장 — $((60 - UNIQ))장 모자랍니다."
  echo "    다른 폴더도 같이 보거나, 편당 1장으로 줄이는 방법이 있습니다."
fi
