// 크롬/크로미움 실행 파일 자동 탐색 (Windows / macOS / Linux)
// 우선순위: CHROMIUM_PATH 환경변수 → OS별 일반 설치 경로
const fs = require('fs');
const path = require('path');

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Chromium\\Application\\chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
};

function findChromium() {
  if (process.env.CHROMIUM_PATH) {
    if (fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
    throw new Error(`CHROMIUM_PATH에 지정된 파일이 없습니다: ${process.env.CHROMIUM_PATH}`);
  }
  for (const p of CANDIDATES[process.platform] || CANDIDATES.linux) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    '크롬을 찾지 못했습니다. 크롬을 설치하거나, CHROMIUM_PATH 환경변수로 ' +
    'chrome 실행 파일 경로를 직접 지정하세요.',
  );
}

module.exports = { findChromium };
