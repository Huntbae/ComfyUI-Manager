// 클립 크리에이터 화면 읽기(clipDoctor) 시험. 네이버에 접속하지 않고 가짜 사이트로 돈다.
//
// 클립은 올리면 바로 공개된다. 그래서 화면을 읽는 도구가 **게시 버튼을 누르지 않는다**는
// 것이 가장 중요하다. 그것을 고정한다.
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const { chromium } = require('playwright-core');
const { findChromium } = require(R + '/src/chromium-path');
const { clipDoctor } = require(R + '/src/clip.js');
const DASH = `<body><header><a href="/web/dashboard">대시보드</a> <a href="/web/content">콘텐츠</a>
  <button class="btn_upload__x1" onclick="location.href='/web/upload'"><svg></svg>업로드</button></header>
  <main>이번 주 조회수 0 · 팔로워 0</main></body>`;
const UPLOAD = `<body><h1>클립 업로드</h1>
  <button class="pick" onclick="document.getElementById('f').click()">동영상 선택</button>
  <input id="f" type="file" accept="video/mp4,video/quicktime" style="display:none" onchange="setTimeout(showForm, 1500)">
  <div id="form" style="display:none">
    <input id="ttl" placeholder="제목을 입력해 주세요" maxlength="40">
    <textarea placeholder="내용을 입력해 주세요" maxlength="1000"></textarea>
    <input placeholder="태그 입력" class="tag_input">
    <label><input type="radio" name="open" checked> 전체 공개</label>
    <label><input type="radio" name="open"> 비공개</label>
    <button class="temp" onclick="window.TEMP=1">임시저장</button>
    <button class="publish" onclick="window.PUBLISHED=1;document.title='PUBLISHED'">게시</button>
  </div>
  <script>function showForm(){document.getElementById('form').style.display='block'}</script></body>`;
(async () => {
  const VID = path.join(R, 'videos', 'test_clip.mp4');
  fs.mkdirSync(path.dirname(VID), { recursive: true });
  if (!fs.existsSync(VID)) fs.writeFileSync(VID, Buffer.alloc(1024));
  const b = await chromium.launch({ executablePath: findChromium(), headless: true });
  const ctx = await b.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: u.includes('/web/upload') ? UPLOAD : DASH });
  });
  const page = await ctx.newPage();
  const lines = [];
  const r = await clipDoctor(page, { videoPath: VID, log: (x) => lines.push(x) });
  const out = lines.join('\n');
  const published = await page.evaluate(() => window.PUBLISHED === 1).catch(() => false);
  const checks = [
    ['업로드 화면으로 들어갔나', /지금 주소: .*\/web\/upload/.test(out)],
    ['영상을 넣은 뒤 제목칸(최대 글자수 포함)을 읽었나', /placeholder="제목을 입력해 주세요" 최대40자/.test(out)],
    ['설명칸·태그칸을 읽었나', /내용을 입력해 주세요/.test(out) && /태그 입력/.test(out)],
    ['공개 설정과 임시저장 버튼을 읽었나', /전체 공개/.test(out) && /"임시저장"/.test(out)],
    ['게시 버튼을 읽기만 하고 누르지 않았나', /"게시"/.test(out) && published === false],
  ];
  let pass = r.ok;
  for (const [n, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${n}`); pass = pass && ok; }
  await b.close();
  process.exit(pass ? 0 : 1);
})();
