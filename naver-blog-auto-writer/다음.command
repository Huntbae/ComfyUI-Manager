#!/bin/bash
# 더블클릭하면 다음 글 한 편을 네이버 블로그에 임시저장합니다.
# (이 파일이 있는 폴더에서 node index.js next 를 실행)
cd "$(dirname "$0")" || exit 1
echo "▶ 다음 글을 네이버 블로그에 임시저장합니다..."
node index.js next
echo ""
echo "끝났습니다. 이 창은 닫으셔도 됩니다."
