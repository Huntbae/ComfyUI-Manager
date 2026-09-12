// 가짜 스마트에디터로 post.js 를 검증한다. 네이버에 접속하지 않는다.
//
// 왜 있나: "임시저장 완료"가 찍혔는데 네이버에 글이 없는 사고가 있었다.
// 원인은 tempSave()가 저장 성공을 확인하지 않고 무조건 ok를 반환한 것.
// 이 테스트는 저장 버튼이 먹통일 때 실패로 잡는지를 매번 확인한다.
//
//   npm test
const path = require('path');
const { chromium } = require('playwright-core');
const { findChromium } = require('../src/chromium-path');
const { fillEditor } = require('../src/post.js');
const { markdownToPlain } = require('../src/format.js');
const FAKE = 'file://' + path.join(__dirname, 'fake-editor.html');

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const run = async (label, { breakSave = false, breakTitle = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(FAKE);
    if (breakSave) await page.evaluate(() => { window.BREAK_SAVE = true; });
    if (breakTitle) await page.evaluate(() => {
      // 제목칸이 포커스를 안 받는 상황 재현
      document.querySelector('.se-section-documentTitle .se-text-paragraph').contentEditable = 'false';
    });
    const r = await fillEditor(page, {
      title: '테스트 제목입니다',
      content: '**굵은 소제목**\n첫 문단입니다.\n- 목록 항목\n\n| | 가 | 나 |\n|---|---|---|\n| 값 | 1 | 2 |\n\n[[img:kalli_01.png|사진 설명 한 줄]]\n둘째 문단입니다.',
      imagedir: path.join(__dirname, '..', 'images'),
    });
    console.log(`\n── ${label}: ok=${r.ok} reason=${r.reason || '-'}`);
    await ctx.close();
    return r;
  };

  const a = await run('정상');
  const b = await run('저장 버튼 먹통', { breakSave: true });
  const c = await run('제목칸 포커스 실패', { breakTitle: true });
  await browser.close();

  // 마크다운이 평문으로 바뀌는지 (네이버는 마크다운을 해석하지 않는다)
  const md = markdownToPlain('**굵게**\n- 항목\n\n| | 가 | 나 |\n|---|---|---|\n| 값 | 1 | 2 |\n\n[[img:x.png|설명]]');
  console.log('\n── 마크다운 변환\n' + md);

  const checks = [
    ['정상 저장이 성공으로 보고되나', a.ok === true],
    ['사진 1장이 본문에 붙었나', a.imageComponents === 1],
    ['제목이 제대로 들어갔나', a.titleOnPage === '테스트 제목입니다'],
    ['저장 확인 근거가 있나', a.verifiedBy === 'count'],
    ['저장 먹통을 실패로 잡나 (예전 버그)', b.ok === false],
    ['제목 누락을 실패로 잡나', c.ok === false],
    ['실패 시 증거를 남기나', !!(b.hint || '').includes('증거')],
    ['굵게 표시가 사라지나', !md.includes('**')],
    ['표 구분선이 사라지나', !md.includes('|---')],
    ['표가 문장으로 바뀌나', md.includes('값 — 가: 1 / 나: 2')],
    ['글머리 기호가 · 로 바뀌나', md.includes('· 항목')],
    ['이미지 마커는 그대로인가', md.includes('[[img:x.png|설명]]')],
  ];
  console.log('\n════ 판정 ════');
  let pass = true;
  for (const [name, ok] of checks) { console.log(`${ok ? '✅' : '❌'} ${name}`); pass = pass && ok; }
  console.log(`\n정상케이스 상세: 사진 ${a.imagesInserted}장 삽입 → ${a.imageComponents}장 부착, 확인=${a.verifiedBy}`);
  console.log(`저장먹통 사유: ${b.reason} / ${b.hint}`);
  console.log(`제목누락 사유: ${c.reason}`);
  process.exit(pass ? 0 : 1);
})();
