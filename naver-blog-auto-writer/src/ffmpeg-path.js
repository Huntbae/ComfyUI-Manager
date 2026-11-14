// Playwright가 녹화에 쓰는 ffmpeg의 위치 계산.
// check-env.js(점검)와 link-ffmpeg.js(연결)가 같은 기준을 쓰도록 한 곳에 모았다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Playwright가 브라우저·ffmpeg를 두는 곳.
// PLAYWRIGHT_BROWSERS_PATH가 없으면 OS별 기본 캐시 경로를 봐야 한다.
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
  const pkg = require.resolve('playwright-core/package.json');
  const json = path.join(path.dirname(pkg), 'browsers.json');
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

// Playwright가 실제로 찾아볼 경로
function expectedPath() {
  return path.join(browsersRoot(), `ffmpeg-${ffmpegRevision()}`, binName());
}

// 그 자리에 실행 가능한 ffmpeg가 있는가 (심볼릭 링크면 대상까지 확인)
function isLinked() {
  const p = expectedPath();
  try {
    return fs.statSync(p).isFile(); // statSync는 심볼릭 링크를 따라간다
  } catch {
    return false;
  }
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

module.exports = { browsersRoot, ffmpegRevision, binName, expectedPath, isLinked, findSystemFfmpeg };
