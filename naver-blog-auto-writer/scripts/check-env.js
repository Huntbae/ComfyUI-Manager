// 환경 점검: Node 18+, 크롬 자동 탐색·구동, 녹화용 ffmpeg 확인
const fs = require('fs');
const { findChromium } = require('../src/chromium-path');

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node 18 이상이 필요합니다. 현재: v${process.versions.node}`);
  console.error('https://nodejs.org 에서 LTS 버전을 설치하세요.');
  process.exit(1);
}
console.log(`Node OK: v${process.versions.node}`);

const { chromium } = require('playwright-core');

(async () => {
  const chromePath = findChromium();
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  console.log(`Chromium OK: ${browser.version()} (${chromePath})`);
  await browser.close();

  // 녹화는 Playwright가 기대하는 자리의 ffmpeg만 쓴다.
  // PLAYWRIGHT_BROWSERS_PATH가 없으면 OS 기본 캐시 경로를 봐야 한다 (예전엔 이걸 놓쳐 오탐이 났다).
  const ff = require('../src/ffmpeg-path');
  if (ff.isLinked()) {
    console.log(`ffmpeg OK: 녹화 가능 (${ff.expectedPath()})`);
  } else {
    const sys = ff.findSystemFfmpeg();
    console.log('ffmpeg 없음: 녹화가 꺼진 채로 실행됩니다');
    console.log(sys
      ? `  → npm run link-ffmpeg 로 시스템 ffmpeg(${sys})를 연결하세요`
      : '  → brew install ffmpeg 후 npm run link-ffmpeg 를 실행하세요');
  }
})().catch((e) => {
  console.error('점검 실패:', e.message);
  process.exit(1);
});
