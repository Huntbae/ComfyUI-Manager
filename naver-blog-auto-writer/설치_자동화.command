#!/bin/bash
# 한 번만 더블클릭하면: 의존성 설치 → (쿠키 없으면) 쿠키 저장 →
# 매일 오전 9시 자동 임시저장 예약(launchd) → 지금 1편 테스트까지 진행합니다.
set -e
cd "$(dirname "$0")"
PROJ="$(pwd)"
NODE="$(command -v node || true)"

echo "=================================================="
echo " 클랜헌트 네이버 블로그 자동화 설치"
echo "=================================================="

if [ -z "$NODE" ]; then
  echo "❌ node를 찾을 수 없습니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요."
  exit 1
fi
echo "node: $NODE"

echo ""
echo "[1/4] 의존성 설치..."
npm install --silent

echo ""
echo "[2/4] 네이버 쿠키 확인..."
if [ ! -f ".auth/cookies.json" ]; then
  echo "쿠키가 없습니다. 지금 저장합니다. (값은 화면에 표시되지 않습니다)"
  "$NODE" index.js cookies
else
  echo "이미 저장돼 있습니다. (건너뜀)"
fi

echo ""
echo "[3/4] 매일 오전 9시 자동 실행 예약(launchd) 설치..."
PLIST="$HOME/Library/LaunchAgents/com.clanhunts.naverblog.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clanhunts.naverblog</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$PROJ/index.js</string>
    <string>next</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJ</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$PROJ/out/schedule.log</string>
  <key>StandardErrorPath</key><string>$PROJ/out/schedule.log</string>
</dict>
</plist>
PLISTEOF
mkdir -p "$PROJ/out"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "예약 완료: 매일 오전 9시 → $PROJ/out/schedule.log 에 기록"

echo ""
echo "[4/4] 지금 1편 테스트로 올려봅니다..."
"$NODE" index.js next || true

echo ""
echo "=================================================="
echo " 설치 끝! 이제 아무것도 안 하셔도 매일 한 편씩 임시저장됩니다."
echo " - 지금 바로 한 편 더: 「다음.command」 더블클릭"
echo " - 자동 예약 끄기: 「해제_자동화.command」 더블클릭"
echo " - 확인: 네이버 블로그 → 글쓰기 → 저장된 글"
echo "=================================================="
