// 클립 올리기(clipUpload) 시험. 네이버에 접속하지 않고 가짜 사이트로 돈다.
//
// 이 코드는 실제 화면 구조를 모르는 채로 썼다. 그래서 글자와 설명글로 찾는다.
// 클립은 올리면 바로 공개되므로, 잘 올리는 것만큼 **막혔을 때 게시하지 않는 것**이
// 중요하다. 둘 다 고정한다.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { findChromium } = require('../src/chromium-path');
const { clipUpload } = require('../src/clip.js');

const DASH = `<body><header><a href="/web/dashboard">대시보드</a>
  <button class="hd_upload" onclick="location.href='/web/upload'">업로드</button></header>
  <main>이번 주 조회수 0</main></body>`;

// mode: ok(정상) / notitle(제목칸이 없음) / locked(게시 버튼이 끝까지 잠김) / confirm(확인 창이 뜸)
const upload = (mode) => `<body><header><a href="/web/dashboard">대시보드</a>
  <button class="hd_upload" onclick="location.href='/web/upload'">업로드</button></header>
  <h1>클립 업로드</h1>
  <input id="f" type="file" accept="video/mp4,video/quicktime" style="display:none" onchange="picked()">
  <button onclick="document.getElementById('f').click()">동영상 선택</button>
  <div id="form" style="display:none">
    ${mode === 'notitle' ? '' : '<input id="ttl" placeholder="제목을 입력해 주세요" maxlength="20">'}
    <textarea id="desc" placeholder="내용을 입력해 주세요"></textarea>
    <input id="tag" placeholder="태그 입력" onkeydown="if(event.key==='Enter'){window.TAGS=(window.TAGS||[]).concat(this.value);this.value=''}">
    <button id="tmp" onclick="window.TEMP=1">임시저장</button>
    <button id="pub" disabled onclick="publish()">게시</button>
  </div>
  <div id="ask" style="display:none">게시하시겠습니까? <button onclick="window.CANCEL=1">취소</button> <button onclick="really()">확인</button></div>
  <script>
    function picked(){ document.getElementById('form').style.display='block';
      ${mode === 'locked' ? '' : "setTimeout(()=>{document.getElementById('pub').disabled=false}, 2500);"} }
    function publish(){ ${mode === 'confirm' ? "document.getElementById('ask').style.display='block'" : 'really()'} }
    function really(){
      const t=(document.getElementById('ttl')||{}).value||'';
      if(!t) return;
      sessionStorage.setItem('pub', JSON.stringify({title:t, desc:document.getElementById('desc').value, tags:window.TAGS||[]}));
      location.href='/web/content?done=1';
    }
  </script></body>`;
const CONTENT = `<body><h1>콘텐츠</h1><p id="r"></p><script>document.getElementById('r').innerText=sessionStorage.getItem('pub')||''</script></body>`;

(async () => {
  const VID = path.join(__dirname, '..', 'videos', 'test_clip.mp4');
  fs.mkdirSync(path.dirname(VID), { recursive: true });
  if (!fs.existsSync(VID)) fs.writeFileSync(VID, Buffer.alloc(1024));
  const item = { path: VID, file: 'test_clip.mp4', title: '칼리 주행 영상 1 — 클랜헌트가 개발한 1인승 전기차',
    description: '혼자 타는 전기차는 어떻게 달릴까요?', tags: ['칼리', '사이클카트', '1인승전기차'] };
  const b = await chromium.launch({ executablePath: findChromium(), headless: true });
  const scenario = async (mode, opts = {}) => {
    const ctx = await b.newContext();
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      const body = u.includes('/web/upload') ? upload(mode) : (u.includes('/web/content') ? CONTENT : DASH);
      route.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    const page = await ctx.newPage();
    const r = await clipUpload(page, item, { log: () => {}, ...opts });
    const pub = await page.evaluate(() => sessionStorage.getItem('pub')).catch(() => null);
    const cancel = await page.evaluate(() => window.CANCEL === 1 || window.TEMP === 1).catch(() => false);
    await ctx.close();
    console.log(`${mode}: ok=${r.ok} reason=${r.reason || '-'} how=${r.how || '-'}`);
    return { r, pub: pub ? JSON.parse(pub) : null, cancel };
  };
  const a = await scenario('ok');
  const c = await scenario('confirm');
  const n = await scenario('notitle', { titleTimeout: 8_000 });
  const l = await scenario('locked', { uploadTimeout: 9_000 });
  await b.close();
  const checks = [
    ['영상을 넣고 게시까지 가나', a.r.ok === true && !!a.pub],
    ['제목이 칸의 최대 글자수에 맞게 들어가나', !!a.pub && a.pub.title === item.title.slice(0, 20)],
    ['설명과 태그가 들어가나', !!a.pub && a.pub.desc.includes('혼자 타는') && a.pub.tags.length === 3],
    ['임시저장·취소는 누르지 않나', a.cancel === false && c.cancel === false],
    ['확인 창이 떠도 확인을 눌러 게시하나', c.r.ok === true && !!c.pub],
    ['제목칸을 못 찾으면 게시하지 않고 멈추나', n.r.ok === false && n.r.reason === 'no_title_field' && n.pub === null],
    ['게시 버튼이 잠겨 있으면 게시하지 않고 멈추나', l.r.ok === false && l.r.reason === 'no_publish_button' && l.pub === null],
    ['멈출 때 화면 구조를 같이 돌려주나', Array.isArray(n.r.dump) && n.r.dump.length > 0],
  ];
  let pass = true;
  for (const [name, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${name}`); pass = pass && ok; }
  process.exit(pass ? 0 : 1);
})();
