#!/bin/bash
# 외장 드라이브에서 블로그에 쓸 사진을 골라 한 폴더로 모은다.
#
# 개발자 도구(Xcode CLT)가 없어도 돌아간다. macOS 기본 명령만 쓴다 —
# find · md5 · stat · awk · sips. git 도 python3 도 필요 없다.
#
#   bash collect-photos.sh '/Volumes/Mac Data/backup'
#   bash collect-photos.sh '/Volumes/Mac Data/backup' ~/kart_사진 60
#
# 하는 일:
#   1. 타임머신·앱 번들·캐시·축소본 폴더를 빼고 훑는다
#   2. 120KB 미만(아이콘·썸네일)을 뺀다
#   3. 같은 사진을 하나로 합친다 (크기 + 앞 64KB 해시)
#   4. 제품 사진(칼리·에듀카트)을 먼저, 모자라면 나머지로 채운다
#   5. 고르게 솎아 필요한 장수만 복사하고 목록을 남긴다
#
# 원본은 건드리지 않는다. 복사만 한다.

set -u

SRC="${1:-}"
DEST="${2:-$HOME/kart_사진}"
NEED="${3:-60}"

if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "쓰는 법:  bash $0 '<사진이 있는 폴더>' [모을 폴더] [장수]"
  echo
  echo "붙어 있는 드라이브:"
  ls /Volumes 2>/dev/null | sed 's/^/  /'
  echo
  echo "예:  bash $0 '/Volumes/Mac Data/backup'"
  exit 1
fi

if command -v md5 >/dev/null 2>&1; then
  MD5() { md5 -q; }
elif command -v md5sum >/dev/null 2>&1; then
  MD5() { md5sum | awk '{print $1}'; }
else
  MD5() { cksum | awk '{print $1}'; }
fi
SIZE() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "훑는 중입니다: $SRC"
echo "  (드라이브가 크면 몇 분 걸립니다. Ctrl-C 로 멈춰도 안전합니다)"
echo

find "$SRC" \
  \( -name '.*' \
     -o -name '__MACOSX' -o -name 'System Volume Information' \
     -o -name 'lost+found' -o -name 'node_modules' \
     -o -name 'Backups.backupdb' -o -name '.MobileBackups' \
     -o -name 'Caches' -o -name 'Cache' \
     -o -name 'Application Support' -o -name 'Containers' \
     -o -name 'derivatives' -o -name 'proxies' -o -name 'thumbnails' \
     -o -name '*.app' -o -name '*.framework' -o -name '*.bundle' \
     -o -name '*.plugin' -o -name '*.kext' -o -name '*.sparsebundle' \
     -o -name '*.lrdata' -o -name '*.fcpbundle' -o -name '*.imovielibrary' \
  \) -prune \
  -o -type f -print 2>/dev/null \
| awk 'tolower($0) ~ /\.(jpg|jpeg|png|webp|tif|tiff|heic|heif|arw|cr2|cr3|nef|dng|raf|orf|rw2|srw)$/' \
> "$TMP/all.txt"

TOTAL=$(wc -l < "$TMP/all.txt" | tr -d ' ')
echo "이미지 파일 ${TOTAL}장"
if [ "$TOTAL" -eq 0 ]; then
  echo "폴더 안에 뭐가 있는지 보세요:  ls '$SRC'"
  exit 0
fi

# 서류·판촉물·개인정보성 파일은 뺀다. rebuild_images.py 의 JUNK 와 같은 기준.
JUNK='실측확인|제원|통보서|계약|견적|재료비|납품|세금|청구|신청서|공고|입찰|증빙|보조금|정산|품의|결재|확인서|사업자|등기|면허|보험|약관|규정|회의록|출장|QR|큐알|현수막|배너|포스터|명함|리플렛|팜플렛|카드뉴스|cardnews|상세페이지|썸네일|표지|cover|시안|스크린샷|screenshot|캡처|화면|로고|logo|icon|아이콘|엠블럼|폰트|주민|여권|신분증|통장|이력서|서명|도장|인감|가족|졸업'

echo "거르는 중 (서류·중복·작은 파일)..."
: > "$TMP/keep.txt"
while IFS= read -r f; do
  case "$(echo "$f" | tr 'A-Z' 'a-z')" in
    *$'\n'*) continue ;;
  esac
  echo "$f" | grep -Eqi "$JUNK" && continue
  sz=$(SIZE "$f") || continue
  [ "${sz:-0}" -lt 120000 ] && continue
  # 지문 = 크기 + 앞 64KB + 뒤 64KB.
  # 앞부분만 보면 헤더·EXIF가 같은 사진들이 한 장으로 합쳐진다.
  # 전체를 읽으면 드라이브가 클 때 너무 느리다.
  h="$sz-$(head -c 65536 "$f" 2>/dev/null | MD5)"
  [ "$sz" -gt 131072 ] && h="$h-$(tail -c 65536 "$f" 2>/dev/null | MD5)"
  printf '%s\t%s\n' "$h" "$f" >> "$TMP/keep.txt"
done < "$TMP/all.txt"

# 같은 지문은 첫 번째만 남긴다
sort -u -t"$(printf '\t')" -k1,1 "$TMP/keep.txt" | cut -f2- > "$TMP/uniq.txt"
UNIQ=$(wc -l < "$TMP/uniq.txt" | tr -d ' ')
echo "  서로 다른 사진 ${UNIQ}장"

# 제품 사진을 먼저 쓴다. 글과 맞는 사진이 우선이다.
grep -Ei 'kalli|칼리|뉴트로|newtrom|사이클카트|cyclekart|차량[ _]?이미지|개발[ _]?차량' "$TMP/uniq.txt" > "$TMP/t_kalli.txt" 2>/dev/null || true
grep -Ei 'edu-?kart|에듀카트|안전정비|실습|조립|아두이노|워크숍|워크샵|메이커' "$TMP/uniq.txt" > "$TMP/t_edu.txt" 2>/dev/null || true
cat "$TMP/t_kalli.txt" "$TMP/t_edu.txt" 2>/dev/null | sort -u > "$TMP/t_named.txt"
grep -vxF -f "$TMP/t_named.txt" "$TMP/uniq.txt" > "$TMP/t_rest.txt" 2>/dev/null || cp "$TMP/uniq.txt" "$TMP/t_rest.txt"

NK=$(wc -l < "$TMP/t_kalli.txt" | tr -d ' ')
NE=$(wc -l < "$TMP/t_edu.txt" | tr -d ' ')
NR=$(wc -l < "$TMP/t_rest.txt" | tr -d ' ')
echo "  이름에 제품이 드러난 것 — 칼리 ${NK}장 · 에듀카트 ${NE}장"
echo "  나머지 ${NR}장"

cat "$TMP/t_kalli.txt" "$TMP/t_edu.txt" "$TMP/t_rest.txt" 2>/dev/null \
  | awk '!seen[$0]++' > "$TMP/ordered.txt"
AVAIL=$(wc -l < "$TMP/ordered.txt" | tr -d ' ')

if [ "$AVAIL" -le "$NEED" ]; then
  cp "$TMP/ordered.txt" "$TMP/pick.txt"
else
  # 후보가 넉넉하면 고르게 솎는다. 앞쪽만 쓰면 같은 날 같은 장소 사진만 모인다.
  awk -v n="$NEED" -v t="$AVAIL" 'BEGIN{step=t/n} {a[NR]=$0}
       END{for(i=0;i<n;i++){k=int(i*step)+1; if(k<=t) print a[k]}}' \
      "$TMP/ordered.txt" > "$TMP/pick.txt"
fi

PICK=$(wc -l < "$TMP/pick.txt" | tr -d ' ')

mkdir -p "$DEST"
echo
echo "복사 중 → $DEST"
i=0
: > "$DEST/목록.txt"
{
  echo "# 원본 폴더: $SRC"
  echo "# 만든 때: $(date '+%Y-%m-%d %H:%M')"
  echo "# 새 이름 <- 원본 경로"
} >> "$DEST/목록.txt"
while IFS= read -r f; do
  i=$((i+1))
  ext="${f##*.}"
  low=$(echo "$ext" | tr 'A-Z' 'a-z')
  new=$(printf 'photo_%03d.%s' "$i" "$low")
  cp "$f" "$DEST/$new" 2>/dev/null || continue
  printf '%s <- %s\n' "$new" "$f" >> "$DEST/목록.txt"
done < "$TMP/pick.txt"

COPIED=$(find "$DEST" -type f ! -name '목록.txt' 2>/dev/null | wc -l | tr -d ' ')

echo
echo "────────────────────────────────"
echo "  훑은 이미지        ${TOTAL}장"
echo "  거르고 남은 사진    ${UNIQ}장"
echo "  복사한 사진        ${COPIED}장  →  $DEST"
echo "────────────────────────────────"
echo
if [ "$COPIED" -ge "$NEED" ]; then
  echo "✅ ${NEED}장을 중복 없이 채웠습니다."
else
  echo "⚠️  ${NEED}장 중 ${COPIED}장만 모였습니다. ${NEED} 에서 $((NEED - COPIED))장 모자랍니다."
  echo "    다른 폴더도 같이 보려면 상위 폴더를 넘기세요 — 예: '/Volumes/Mac Data'"
fi
echo
echo "어떤 사진이 어디서 왔는지: $DEST/목록.txt"
echo "사진을 눈으로 보시려면:    open '$DEST'"
echo
echo "다음 단계 — 레포가 있는 맥에서:"
echo "  kart images --only-src --src '$DEST'"
