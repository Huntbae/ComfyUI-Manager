#!/usr/bin/env node
// 함정 5: Playwright 화면 녹화는 Playwright가 기대하는 자리에 있는 ffmpeg만 쓴다.
// 시스템에 ffmpeg가 깔려 있어도 그 자리에 없으면 녹화가 조용히 꺼진다.
// 이 스크립트가 시스템 ffmpeg를 그 자리에 심볼릭 링크로 걸어준다.
//
//   node scripts/link-ffmpeg.js
//
// 이미 연결돼 있으면 아무것도 하지 않는다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Playwright가 브라우저·ffmpeg를 두는 곳
function browsersRoot() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  }
  return path.join(os.homedir(), '.cache', 'ms-playwright');
}

// 설치된 playwright-core가 기대하는 ffmpeg 리비전
function ffmpegRevision() {
  const p = require.resolve('playwright-core/package.json');
  const json = path.join(path.dirname(p), 'browsers.json');
  const data = JSON.parse(fs.readFileSync(json, 'utf8'));
  const entry = (data.browsers || []).find((b) => b.name === 'ffmpeg');
  if (!entry) throw new Error('browsers.json에서 ffmpeg 항목을 찾지 못했습니다');
  return String(entry.revision);
}

function binName() {
  if (process.platform === 'darwin') return 'ffmpeg-mac';
  if (process.platform === 'win32') return 'ffmpeg-win64.exe';
  return 'ffmpeg-linux';
}

// 시스템에 깔린 ffmpeg 찾기
function findSystemFfmpeg() {
  const candidates = [
    '/opt/homebrew/bin/ffmpeg',   // Apple Silicon Homebrew
    '/usr/local/bin/ffmpeg',      // Intel Homebrew
    '/usr/bin/ffmpeg',
    '/opt/local/bin/ffmpeg',      // MacPorts
  ];
  try {
    const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], {
      encoding: 'utf8',
    }).trim().split('\n')[0];
    if (which) candidates.unshift(which);
  } catch {
    /* which 실패는 무시하고 후보 목록으로 진행 */
  }
  return candidates.find((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function main() {
  const root = browsersRoot();
  const rev = ffmpegRevision();
  const dir = path.join(root, `ffmpeg-${rev}`);
  const target = path.join(dir, binName());

  if (fs.existsSync(target)) {
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

  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(sys, target);
  // Playwright는 이 표식 파일이 있어야 설치된 것으로 본다
  fs.writeFileSync(path.join(dir, 'INSTALLATION_COMPLETE'), '');

  console.log(`✅ 연결 완료`);
  console.log(`   시스템 ffmpeg : ${sys}`);
  console.log(`   Playwright 자리: ${target}`);
  console.log('   이제 녹화가 켜진 상태로 실행됩니다.');
}

main();
