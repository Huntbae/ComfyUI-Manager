#!/bin/bash
# 매일 자동 실행 예약을 해제합니다. (글·설정·쿠키는 그대로 둡니다)
PLIST="$HOME/Library/LaunchAgents/com.clanhunts.naverblog.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "자동 예약을 해제했습니다. (수동 실행은 「다음.command」로 계속 가능)"
