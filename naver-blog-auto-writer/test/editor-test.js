// 가짜 스마트에디터로 post.js 를 검증한다. 네이버에 접속하지 않는다.
//
// 왜 있나: 확인 없이 성공을 보고해서 글을 잃은 사고가 두 번 있었다.
//   1) tempSave() 가 저장 성공을 확인하지 않고 무조건 ok 를 반환했다.
//   2) 제목 검증이 플레이스홀더("제목")를 제목으로 읽어, 제목이 빈 채로 통과했다.
//      같은 날 에디터가 타이핑 도중 스스로 리로드돼 본문 앞부분과 사진이 전부 날아갔다.
// 이 테스트는 그 상황들을 매번 재현해서 실패로 잡는지 확인한다.
//
//   npm test
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { findChromium } = require('../src/chromium-path');
const { fillEditor } = require('../src/post.js');
const { markdownToPlain } = require('../src/format.js');
const FAKE = 'file://' + path.join(__dirname, 'fake-editor.html');

// 동영상 시험용 더미 파일. 가짜 에디터는 파일 내용을 보지 않고,
// post.js 는 존재만 확인한다. 진짜 영상을 두면 collect_videos 가
// videos/ 를 비울 때 같이 지워져 시험이 깨진다 — 실제로 그랬다.
const VDIR = path.join(__dirname, '..', 'videos');
const VFIX = path.join(VDIR, 'test_v01.mp4');
function makeVideoFixture() {
  fs.mkdirSync(VDIR, { recursive: true });
  if (!fs.existsSync(VFIX)) fs.writeFileSync(VFIX, Buffer.alloc(1024));
}

(async () => {
  const browser = await chromium.launch({ executablePath: findChromium(), headless: true });
  const run = async (label, { content, slowUpload, breakSave = false, breakTitle = false, wipeAt = 0, popupAt = 0, swallowFirst = false, hideCount = false, staleNotice = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(FAKE);
    if (breakSave) await page.evaluate(() => { window.BREAK_SAVE = true; });
    // 저장 개수를 못 읽는 스킨 재현. 그때는 안내 문구만이 증거가 된다.
    if (hideCount) {
      await page.evaluate(() => { document.getElementById('save').innerText = '저장'; });
    }
    // 클릭 전부터 저장 완료 안내가 떠 있는 상황 재현.
    // 네이버는 자동저장을 주기적으로 돌리고 그 안내를 화면에 남긴다.
    // 이것 때문에 저장이 실패해도 성공으로 보고됐다 (기록 30편 / 실제 3개).
    if (staleNotice) {
      await page.evaluate(() => {
        document.getElementById('toast').innerText = '자동저장 오후 02:03 임시저장되었습니다';
      });
    }
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
    if (slowUpload) await page.evaluate((v) => { window.VIDEO_UPLOAD_MS = v; }, slowUpload);
    const r = await fillEditor(page, {
      title: '테스트 제목입니다',
      content: content || '**굵은 소제목**\n첫 문단입니다.\n- 목록 항목\n\n| | 가 | 나 |\n|---|---|---|\n| 값 | 1 | 2 |\n\n[[img:kalli_01.png|사진 설명 한 줄]]\n둘째 문단입니다.',
      imagedir: path.join(__dirname, '..', 'images'),
    });
    console.log(`\n── ${label}: ok=${r.ok} reason=${r.reason || '-'} 시도=${r.attempts}`);
    if (!r.ok) console.log(`   ${r.hint || ''}`);
    if (r.ok) console.log(`   제목="${r.titleOnPage}" 사진=${r.imageComponents} 본문=${r.bodyChars}자 캡션=${JSON.stringify(r.captions || [])}`);
    await ctx.close();
    return r;
  };

  makeVideoFixture();
  const a = await run('정상');
  const b = await run('저장 버튼 먹통', { breakSave: true });
  const c = await run('제목칸 포커스 실패(플레이스홀더만)', { breakTitle: true });
  const d = await run('타이핑 도중 문서가 날아감', { wipeAt: 20 });
  const e = await run('타이핑 도중 복구 팝업', { popupAt: 20 });
  const f = await run('제목 첫 글자가 먹힘', { swallowFirst: true });
  // 동영상: 업로드 레이어 → 제목 필수 → 완료 → 본문에 붙었는지 확인까지
  const g = await run('동영상 1개', {
    content: '첫 문단입니다.\n[[video:test_v01.mp4|2024년 6월, 제작 현장]]\n뒷 문단입니다.',
  });
  // 업로드가 느릴 때도 기다리는지 (완료 버튼이 늦게 풀린다)
  const h = await run('동영상 업로드가 느림', {
    content: '첫 문단입니다.\n[[video:test_v01.mp4|느린 업로드]]',
    slowUpload: 6000,
  });
  // 파일이 없으면 올리지 않고 멈추는지
  const i = await run('동영상 파일이 없음', {
    content: '첫 문단\n[[video:없는파일.mp4|설명]]',
  });

  // ── 저장 확인의 구멍 ─────────────────────────────────────────
  // 실제로 기록은 30편 저장 완료인데 네이버의 저장 개수는 3이었다.
  // 원인: 저장 완료 안내를 클릭 전과 비교하지 않고 현재 화면에만
  // 그 문구가 있는지 봤다. 자동저장 안내가 남아 있으면 항상 통과했다.
  const j = await run('저장 먹통 + 안내가 이미 떠 있음', {
    content: '첫 문단\n둘째 문단', breakSave: true, staleNotice: true,
  });
  // 개수를 못 읽는 스킨에서도 남아 있던 문구로 통과해서는 안 된다
  const k = await run('개수 못 읽음 + 저장 먹통 + 안내가 이미 떠 있음', {
    content: '첫 문단\n둘째 문단', breakSave: true, hideCount: true, staleNotice: true,
  });
  // 반대로 개수를 못 읽어도 안내가 **새로** 뜨면 성공으로 봐야 한다
  const l = await run('개수 못 읽음 + 저장은 됨', {
    content: '첫 문단\n둘째 문단', hideCount: true,
  });
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
    ['사진 설명이 캡션칸에 들어가나 (본문 아님)', (a.captions || [])[0] === '사진 설명 한 줄'],
    ['캡션이 본문 글자수에 섞이지 않나', a.bodyChars > 0 && a.bodyChars < 60],
    ['제목 첫 글자가 먹혀도 제목이 온전한가', f.ok === true && f.titleOnPage === '테스트 제목입니다'],
    ['제목을 고치느라 다시 쓰지는 않나', f.attempts === 1],
    ['실패 시 증거를 남기나', !!(b.hint || '').includes('증거')],
    ['굵게 표시가 사라지나', !md.includes('**')],
    ['표 구분선이 사라지나', !md.includes('|---')],
    ['표가 문장으로 바뀌나', md.includes('값 — 가: 1 / 나: 2')],
    ['글머리 기호가 · 로 바뀌나', md.includes('· 항목')],
    ['이미지 마커는 그대로인가', md.includes('[[img:x.png|설명]]')],
    ['동영상이 본문에 붙나', g.ok === true && g.videoComponents === 1],
    ['동영상 제목이 네이버 쪽에 들어가나', g.videoTitle === '2024년 6월, 제작 현장'],
    ['동영상 설명이 본문 문단으로 들어가나', (g.bodyText || '').includes('2024년 6월, 제작 현장')],
    ['업로드가 느려도 기다리나', h.ok === true && h.videoComponents === 1],
    ['없는 영상 파일은 올리지 않고 멈추나', i.ok === false && i.reason === 'video_missing'],
    ['이미 떠 있던 저장 안내로 통과하지 않나', j.ok === false],
    ['개수를 못 읽어도 묵은 안내로 통과하지 않나', k.ok === false],
    ['개수를 못 읽어도 새 안내는 성공으로 보나', l.ok === true],
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
