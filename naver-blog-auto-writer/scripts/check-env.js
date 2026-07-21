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

  // 녹화는 playwright 번들 ffmpeg 필요 (없어도 글쓰기는 동작, 녹화만 꺼짐)
  const pwDir = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  const hasFfmpeg =
    (pwDir && fs.existsSync(pwDir) && fs.readdirSync(pwDir).some((d) => d.startsWith('ffmpeg'))) || false;
  console.log(hasFfmpeg
    ? 'ffmpeg OK: 녹화 가능'
    : 'ffmpeg 미확인: 녹화가 안 되면 --no-record 옵션으로 실행하세요');
})().catch((e) => {
  console.error('점검 실패:', e.message);
  process.exit(1);
});
