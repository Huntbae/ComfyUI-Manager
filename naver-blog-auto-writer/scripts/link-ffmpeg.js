#!/usr/bin/env node
// 함정 5: Playwright 화면 녹화는 Playwright가 기대하는 자리에 있는 ffmpeg만 쓴다.
// 시스템에 ffmpeg가 깔려 있어도 그 자리에 없으면 녹화가 조용히 꺼진다.
// 이 스크립트가 시스템 ffmpeg를 그 자리에 심볼릭 링크로 걸어준다.
//
//   node scripts/link-ffmpeg.js
//
// 이미 연결돼 있으면 아무것도 하지 않는다.

const fs = require('fs');
const path = require('path');
const { expectedPath, isLinked, findSystemFfmpeg } = require('../src/ffmpeg-path');

function main() {
  const target = expectedPath();

  if (isLinked()) {
    console.log(`✅ 이미 연결돼 있습니다: ${target}`);
    return;
  }

  const sys = findSystemFfmpeg();
  if (!sys) {
    console.error('❌ 시스템에 ffmpeg가 없습니다.');
    console.error('   설치: brew install ffmpeg');
    console.error('   또는 Playwright 것을 받기: npx playwright install ffmpeg');
    console.error('   (녹화 없이 진행하려면 --no-record 옵션을 쓰세요)');
    process.exit(1);
  }

  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(sys, target);
  // Playwright는 이 표식 파일이 있어야 설치된 것으로 본다
  fs.writeFileSync(path.join(dir, 'INSTALLATION_COMPLETE'), '');

  console.log('✅ 연결 완료');
  console.log(`   시스템 ffmpeg : ${sys}`);
  console.log(`   Playwright 자리: ${target}`);
  console.log('   이제 녹화가 켜진 상태로 실행됩니다.');
}

main();
