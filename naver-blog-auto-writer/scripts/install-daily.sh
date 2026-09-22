#!/bin/bash
# 매일 한 편 자동 임시저장 — macOS launchd 등록/해제.
#
#   bash scripts/install-daily.sh            # 매일 09:00 실행으로 등록
#   bash scripts/install-daily.sh 21         # 매일 21:00
#   bash scripts/install-daily.sh 21 30      # 매일 21:30
#   bash scripts/install-daily.sh --off      # 해제
#   bash scripts/install-daily.sh --status   # 상태 보기
#   bash scripts/install-daily.sh --run      # 지금 한 번 실행
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.clanhunts.blog.daily"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "이 스크립트는 macOS 전용입니다. (지금: $(uname -s))"
  echo "리눅스라면 crontab에 아래 한 줄을 넣으세요:"
  echo "  0 9 * * *  bash $ROOT/scripts/daily.sh"
  exit 1
fi

case "${1:-}" in
  --off|off)
    launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo "매일 자동 실행을 껐습니다."
    exit 0
    ;;
  --status|status)
    if [ -f "$PLIST" ]; then
      echo "등록됨: $PLIST"
      /usr/libexec/PlistBuddy -c "Print :StartCalendarInterval" "$PLIST" 2>/dev/null
      launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | grep -E "state|last exit" || true
    else
      echo "등록 안 됨. 켜려면: bash scripts/install-daily.sh"
    fi
    LATEST="$(ls -t "$ROOT/out/logs"/daily-*.log 2>/dev/null | head -1)"
    [ -n "$LATEST" ] && { echo; echo "최근 로그: $LATEST"; tail -12 "$LATEST"; }
    exit 0
    ;;
  --run|run)
    exec bash "$ROOT/scripts/daily.sh"
    ;;
esac

HOUR="${1:-9}"
MIN="${2:-0}"
case "$HOUR" in ''|*[!0-9]*) echo "시(hour)는 0~23 숫자로 주세요."; exit 1;; esac
case "$MIN"  in ''|*[!0-9]*) echo "분(minute)은 0~59 숫자로 주세요."; exit 1;; esac
[ "$HOUR" -gt 23 ] && { echo "시(hour)는 0~23 입니다."; exit 1; }
[ "$MIN"  -gt 59 ] && { echo "분(minute)은 0~59 입니다."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/out/logs"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/daily.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MIN</integer>
  </dict>
  <!-- 그 시각에 맥이 꺼져 있었으면 켜진 뒤 한 번 따라잡는다 -->
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$ROOT/out/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/out/logs/launchd.err.log</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
if launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null; then
  printf '✅ 매일 %02d:%02d 에 한 편씩 임시저장하도록 등록했습니다.\n' "$HOUR" "$MIN"
else
  echo "⚠ 등록에 실패했습니다. 시스템 설정 > 개인정보 보호 및 보안 에서 터미널 권한을 확인하세요."
  exit 1
fi

cat <<TXT

  발행은 하지 않습니다. 임시저장까지만 하고, 발행은 직접 누르세요.
  확인할 것들
    bash scripts/install-daily.sh --status    # 등록 상태 + 최근 로그
    bash scripts/install-daily.sh --run       # 지금 한 번 돌려보기
    bash scripts/install-daily.sh --off       # 끄기

  맥이 잠자기여도 로그인 세션이 살아 있으면 깨어난 뒤 실행됩니다.
  전원이 완전히 꺼져 있었다면 그날은 건너뜁니다 (다음 날 그 글이 다시 대상이 됩니다).
TXT
