// 가짜 스마트에디터로 post.js 를 검증한다. 네이버에 접속하지 않는다.
//
// 왜 있나: 확인 없이 성공을 보고해서 글을 잃은 사고가 두 번 있었다.
//   1) tempSave() 가 저장 성공을 확인하지 않고 무조건 ok 를 반환했다.
//   2) 제목 검증이 플레이스홀더("제목")를 제목으로 읽어, 제목이 빈 채로 통과했다.
//      같은 날 에디터가 타이핑 도중 스스로 리로드돼 본문 앞부분과 사진이 전부 날아갔다.
// 이 테스트는 그 상황들을 매번 재현해서 실패로 잡는지 확인한다.
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
  const run = async (label, { breakSave = false, breakTitle = false, wipeAt = 0, popupAt = 0, swallowFirst = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(FAKE);
    if (breakSave) await page.evaluate(() => { window.BREAK_SAVE = true; });
    // 제목칸이 포커스를 안 받는 상황 재현 (플레이스홀더 "제목"만 남는다).
    // 재시도로 새로 열어도 계속 안 되는 상황이어야 하므로 addInitScript 로 건다.
    if (breakTitle) {
      await page.addInitScript(() => {
        addEventListener('DOMContentLoaded', () => {
          document.querySelector('.se-section-documentTitle .se-text-paragraph').contentEditable = 'false';
        });
      });
      await page.reload();
    }
    // 타이핑 도중 에디터가 리로드돼 문서가 비워지는 사고 / 복구 팝업이 뜨는 상황
    if (wipeAt) await page.evaluate((v) => { window.WIPE_AT = v; }, wipeAt);
    if (popupAt) await page.evaluate((v) => { window.POPUP_AT = v; }, popupAt);
    if (swallowFirst) await page.evaluate(() => { window.SWALLOW_FIRST = true; });
    const r = await fillEditor(page, {
      title: '테스트 제목입니다',
      content: '**굵은 소제목**\n첫 문단입니다.\n- 목록 항목\n\n| | 가 | 나 |\n|---|---|---|\n| 값 | 1 | 2 |\n\n[[img:kalli_01.png|사진 설명 한 줄]]\n둘째 문단입니다.',
      imagedir: path.join(__dirname, '..', 'images'),
    });
    console.log(`\n── ${label}: ok=${r.ok} reason=${r.reason || '-'} 시도=${r.attempts}`);
    if (!r.ok) console.log(`   ${r.hint || ''}`);
    if (r.ok) console.log(`   제목="${r.titleOnPage}" 사진=${r.imageComponents} 본문=${r.bodyChars}자`);
    await ctx.close();
    return r;
  };

  const a = await run('정상');
  const b = await run('저장 버튼 먹통', { breakSave: true });
  const c = await run('제목칸 포커스 실패(플레이스홀더만)', { breakTitle: true });
  const d = await run('타이핑 도중 문서가 날아감', { wipeAt: 20 });
  const e = await run('타이핑 도중 복구 팝업', { popupAt: 20 });
  const f = await run('제목 첫 글자가 먹힘', { swallowFirst: true });
  await browser.close();

  // 마크다운이 평문으로 바뀌는지 (네이버는 마크다운을 해석하지 않는다)
  const md = markdownToPlain('**굵게**\n- 항목\n\n| | 가 | 나 |\n|---|---|---|\n| 값 | 1 | 2 |\n\n[[img:x.png|설명]]');
  console.log('\n── 마크다운 변환\n' + md);

  const checks = [
    ['정상 저장이 성공으로 보고되나', a.ok === true],
    ['사진 1장이 본문에 붙었나', a.imageComponents === 1],
    ['제목이 제대로 들어갔나', a.titleOnPage === '테스트 제목입니다'],
    ['저장 확인 근거가 있나', a.verifiedBy === 'count'],
    ['정상이면 한 번에 끝나나', a.attempts === 1],
    ['저장 먹통을 실패로 잡나 (예전 버그)', b.ok === false],
    ['저장 먹통은 다시 쓰지 않나 (초안 중복 방지)', b.attempts === 1],
    ['빈 제목을 실패로 잡나 (플레이스홀더 통과 버그)', c.ok === false && c.reason === 'title_empty'],
    ['빈 제목이면 재시도하고도 안 되면 실패로 끝나나', c.attempts === 3],
    ['문서가 날아가면 그대로 저장하지 않나', d.ok === true && d.attempts > 1],
    ['다시 쓴 글이 온전한가', d.imageComponents === 1 && d.titleOnPage === '테스트 제목입니다'],
    ['복구 팝업이 떠도 글이 올라가나', e.ok === true],
    ['복구 팝업 뒤에도 사진이 붙어 있나', e.imageComponents === 1],
    ['제목 첫 글자가 먹혀도 제목이 온전한가', f.ok === true && f.titleOnPage === '테스트 제목입니다'],
    ['제목을 고치느라 다시 쓰지는 않나', f.attempts === 1],
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
  console.log(`제목누락 사유: ${c.reason} (시도 ${c.attempts}회)`);
  console.log(`문서유실 복구: ok=${d.ok} 시도 ${d.attempts}회 / 팝업: ok=${e.ok} 시도 ${e.attempts}회`);
  process.exit(pass ? 0 : 1);
})();
