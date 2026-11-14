#!/bin/bash
# 새 기기에서 한 번만 실행한다. 맥북이든 아이맥이든 이거 하나면 준비 끝.
#
#   bash scripts/setup.sh
#
# 여러 번 돌려도 안전하다 (이미 된 건 건너뛴다).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

ok()   { echo "  ✅ $*"; }
warn() { echo "  ⚠  $*"; }
bad()  { echo "  ❌ $*"; }
step() { echo; echo "▸ $*"; }

echo "설치 위치: $ROOT"
NEED=()

step "1. Node 18 이상"
if command -v node >/dev/null 2>&1; then
  V="$(node -v)"; MAJ="$(echo "$V" | sed 's/^v//' | cut -d. -f1)"
  if [ "${MAJ:-0}" -ge 18 ]; then ok "node $V"; else bad "node $V — 18 이상이 필요합니다"; NEED+=("Node 18+ 설치"); fi
else
  bad "node 없음"; NEED+=("Node 18+ 설치 (https://nodejs.org)")
fi

step "2. 의존성"
npm install --no-audit --no-fund >/dev/null 2>&1 && ok "npm install 완료" || { bad "npm install 실패"; NEED+=("npm install 수동 실행"); }

step "3. 파이썬 (사진 수집용)"
command -v python3 >/dev/null 2>&1 && ok "$(python3 -V)" || { bad "python3 없음"; NEED+=("python3 설치"); }

step "4. 크롬/크로미움"
CHROME="$(node -e "console.log(require('./src/chromium-path').findChromium())" 2>/dev/null)"
[ -n "${CHROME:-}" ] && ok "$CHROME" || { bad "크로미움을 찾지 못했습니다"; NEED+=("크롬 설치"); }

step "5. 녹화용 ffmpeg"
if node -e "process.exit(require('./src/ffmpeg-path').isLinked() ? 0 : 1)" 2>/dev/null; then
  ok "연결됨"
else
  node scripts/link-ffmpeg.js >/dev/null 2>&1 \
    && ok "연결했습니다" \
    || warn "ffmpeg 미연결 — 녹화만 안 됩니다. 게시는 정상 동작합니다."
fi

step "6. kart 단축 명령"
bash scripts/install-shortcut.sh >/dev/null 2>&1 && ok "설치/갱신 완료" || bad "설치 실패"

step "7. 자동화 로직 점검 (네이버 접속 안 함)"
if npm test --silent >/dev/null 2>&1; then ok "검증 통과"; else bad "검증 실패 — npm test 를 직접 돌려 확인하세요"; NEED+=("npm test 확인"); fi

step "8. 네이버 로그인 (이 기기 전용 프로필)"
if [ -d "$ROOT/.chrome-profile" ]; then
  ok "프로필 있음 (만료됐으면 kart login 을 다시)"
else
  warn "아직 없음 — kart login 을 한 번 실행하세요"
  NEED+=("kart login")
fi

step "9. 진행 기록 동기화"
node -e "
const s=require('./src/sync'); const r=s.pullProgress();
if (r.ok) console.log('  ✅ 다른 기기와 동기화됨 (게시 ' + (r.count===null?0:r.count) + '편)');
else console.log('  ⚠  동기화 건너뜀: ' + r.reason);
" 2>/dev/null || warn "동기화 확인 실패"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ ${#NEED[@]} -eq 0 ]; then
  echo "준비 끝. 새 터미널을 열거나 source ~/.zshrc 후:"
  echo "    kart history    # 역사 사진 + 출처"
  echo "    kart next       # 1편 임시저장"
  echo "    kart daily      # 매일 09:00 자동 (원하면)"
else
  echo "남은 일:"
  for n in "${NEED[@]}"; do echo "  · $n"; done
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
