// 크롬 창이 도중에 닫혔을 때 새로 띄워 이어가는지 본다. 네이버에 접속하지 않는다.
//
// 실제로 난 일: 영상 30개와 원고 10편을 다 준비해 놓고, 첫 편을 쓰는 도중에
// 크롬 창이 닫혔다 ("Target page, context or browser has been closed").
// 같은 죽은 창에서 재시도하다 끝나서 한 편도 못 올렸다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');
const { findChromium } = require('../src/chromium-path');
const browserMod = require('../src/browser.js');
const editorHtml = fs.readFileSync(path.join(__dirname, 'fake-editor.html'), 'utf8');

(async () => {
  const results = [];
  const scenario = async (name, closeOnLaunches) => {
    let launches = 0;
    const dirs = [];
    // 진짜 프로필 대신 임시 프로필을 띄우고, 글쓰기 주소를 가짜 에디터로 돌려준다.
    browserMod.launchPersistent = async () => {
      launches += 1;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-relaunch-'));
      dirs.push(dir);
      const context = await chromium.launchPersistentContext(dir, {
        executablePath: findChromium(), headless: true, viewport: { width: 1280, height: 900 },
      });
      await context.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: editorHtml }));
      if (closeOnLaunches.includes(launches)) {
        // 쓰는 도중에 창이 닫히는 상황
        setTimeout(() => { context.pages()[0]?.close().catch(() => {}); }, 2500);
      }
      return { context, profileDir: dir };
    };
    const { writePostProfile } = require('../src/post.js');
    const log = console.log;
    console.log = () => {};                       // 재시도 안내는 시험 출력에서 뺀다
    const r = await writePostProfile({
      blogId: 'huntbae', title: '창이 닫혀도 이어가는지',
      content: '첫 문단입니다.\n둘째 문단입니다.\n셋째 문단입니다.\n넷째 문단입니다.',
      headful: false, record: false,
    });
    console.log = log;
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    console.log(`${name}: ok=${r.ok} reason=${r.reason || '-'} 창을 ${launches}번 띄움`);
    return { r, launches };
  };
  const a = await scenario('멀쩡할 때          ', []);
  const b = await scenario('첫 창이 도중에 닫힘  ', [1]);
  const c = await scenario('세 번 다 닫힘       ', [1, 2, 3]);
  const checks = [
    ['멀쩡하면 한 번에 끝나나', a.r.ok === true && a.launches === 1],
    ['창이 닫히면 새로 띄워 끝까지 올리나', b.r.ok === true && b.launches === 2],
    ['계속 닫히면 세 번에서 멈추고 이유를 말하나', c.r.ok === false && c.r.reason === 'browser_closed' && c.launches === 3],
  ];
  let pass = true;
  for (const [name, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${name}`); pass = pass && ok; }
  process.exit(pass ? 0 : 1);
})();
