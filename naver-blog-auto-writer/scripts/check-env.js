// 환경 점검: Node 18+, 시스템 크로미움 구동, 녹화용 ffmpeg 존재 확인
const fs = require('fs');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node 18 이상이 필요합니다. 현재: v${process.versions.node}`);
  process.exit(1);
}
console.log(`Node OK: v${process.versions.node}`);

const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  console.log(`Chromium OK: ${browser.version()} (${CHROMIUM_PATH})`);
  await browser.close();

  // 함정 5: 녹화는 playwright 번들 ffmpeg 필요
  const pwDir = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
  const hasFfmpeg =
    (pwDir && fs.readdirSync(pwDir).some((d) => d.startsWith('ffmpeg'))) || false;
  console.log(hasFfmpeg
    ? 'ffmpeg OK: 녹화 가능'
    : 'ffmpeg 없음: 녹화하려면 시스템 ffmpeg를 심볼릭 링크로 연결하세요 (README 참고)');
})().catch((e) => {
  console.error('Chromium 구동 실패:', e.message);
  process.exit(1);
});
