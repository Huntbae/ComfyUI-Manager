// 네이버 블로그 스마트에디터 ONE 자동 글쓰기.
//
// 흐름: 글쓰기 URL 진입 → 에디터 위치 확정(페이지/iframe) → 복구 팝업 닫기
//       → 제목·본문 사람 속도 타이핑 → 문단 사이 이미지 삽입
//       → **채워졌는지 검증** → 임시저장 → **저장됐는지 검증** → 증거 저장
//
// 중요: 예전 구현은 저장 버튼을 누르고 2초 기다린 뒤 무조건 성공을 반환했다.
// 클릭이 빗나가도 "임시저장 완료"가 찍히고 진행 기록까지 남아서,
// 네이버에 글이 없는데 올라간 걸로 처리되는 사고가 났다. 이제는 확인하고 반환한다.
const fs = require('fs');
const path = require('path');
const { launch, OUT_DIR } = require('./browser');
const { markdownToPlain } = require('./format');

// 구형 진입점(GoBlogWrite.naver 등)은 재로그인으로 튕긴다.
// blog.naver.com/{blogId}/postwrite 신형 주소만 바로 열린다.
const writeUrl = (blogId) => `https://blog.naver.com/${blogId}/postwrite`;
const EDITOR_SEL = '.se-section-documentTitle';
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// 사람 속도 타이핑: 글자당 60~140ms 랜덤 지연
async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(60 + Math.floor(Math.random() * 80));
  }
}

// 에디터가 페이지에 바로 있는지, iframe 안에 있는지 찾아서 그 컨텍스트를 돌려준다.
// (네이버가 mainFrame 구조로 바꿔도 타이핑이 허공에 들어가지 않게)
async function resolveEditor(page) {
  try {
    await page.waitForSelector(EDITOR_SEL, { timeout: 20_000 });
    return { root: page, where: 'page' };
  } catch { /* 아래에서 iframe을 뒤진다 */ }
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    try {
      await frame.waitForSelector(EDITOR_SEL, { timeout: 4_000 });
      return { root: frame, where: `iframe:${frame.name() || frame.url().slice(0, 60)}` };
    } catch { /* 다음 프레임 */ }
  }
  return { root: null, where: 'not_found' };
}

// 실패 원인을 나중에 볼 수 있게 화면·본문·버튼 목록을 남긴다.
// 이게 없으면 "안 된다"는 말만 남고 뭘 고쳐야 할지 알 수 없다.
async function dumpEvidence(page, root, tag) {
  const dir = path.join(OUT_DIR, 'debug', tag);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return null; }
  await page.screenshot({ path: path.join(dir, 'screen.png') }).catch(() => {});
  const ctx = root || page;
  await ctx.content().then(
    (h) => fs.writeFileSync(path.join(dir, 'page.html'), h),
  ).catch(() => {});
  // 눈으로 읽기 쉬운 형태로도 남긴다
  const text = await ctx.evaluate(() => (document.body.innerText || '').slice(0, 4000)).catch(() => '');
  // 툴바·저장 버튼 셀렉터를 고칠 때 필요한 정보
  const buttons = await ctx.evaluate(() => [...document.querySelectorAll('button, a[role="button"]')]
    .map((b) => ({
      text: (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      cls: String(b.className || '').slice(0, 90),
      area: b.getAttribute('data-click-area') || '',
      name: b.getAttribute('data-name') || '',
    }))
    .filter((b) => b.text || b.area || b.name)
    .slice(0, 200)).catch(() => []);
  fs.writeFileSync(path.join(dir, 'report.txt'),
    `URL: ${page.url()}\n\n=== 화면 텍스트 ===\n${text}\n\n=== 버튼 목록 ===\n` +
    buttons.map((b) => `[${b.area || b.name || '-'}] "${b.text}"  .${b.cls}`).join('\n'));
  return dir;
}

// "작성 중인 글 복구" 확인 팝업은 팝업 내부의 취소 버튼만 정확히 눌러야 한다.
// (부분 일치로 찾으면 툴바의 "취소선"을 눌러 본문이 전부 취소선이 되는 사고)
async function dismissRecoveryPopup(root) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const dim = root.locator('.se-popup-dim');
    const popup = root
      .locator('.se-popup-alert-confirm, [data-name*="se-popup-alert"], .se-popup')
      .first();

    if (!(await popup.count().catch(() => 0)) && !(await dim.count().catch(() => 0))) {
      if (attempt === 0) {
        await root.waitForTimeout?.(700).catch(() => {});
        continue;
      }
      return true;
    }
    const cancelBtn = popup.locator('.se-popup-button-cancel').first();
    if (await cancelBtn.count().catch(() => 0)) {
      await cancelBtn.click({ timeout: 3_000 }).catch(() => {});
    } else {
      const byText = popup.getByText('취소', { exact: true }).first();
      if (await byText.count().catch(() => 0)) await byText.click({ timeout: 3_000 }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 500));
    if (!(await dim.count().catch(() => 0))) return true;
  }
  return false;
}

// 에디터 "도움말"·온보딩 패널이 저장/툴바 버튼 위를 덮어 클릭을 가로챈다.
async function closeHelpPanel(page, root) {
  for (const sel of [
    '.se-help-panel-close-button',
    'button[class*="help"][class*="close"]',
    '.se-help-panel button[class*="close"]',
    'button[aria-label="닫기"]',
  ]) {
    const btn = root.locator(sel).first();
    if (await btn.count().catch(() => 0)) await btn.click({ timeout: 2_000 }).catch(() => {});
  }
  if (await root.locator('.se-help-title').count().catch(() => 0)) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

// 복구 팝업("작성 중인 글이 있습니다")은 진입 직후뿐 아니라 글 쓰는 도중에도 뜬다.
// 에디터가 스스로 리로드되면서 빈 문서 + 이 팝업이 뜨는데, 그대로 두면 타이핑이
// 팝업에 먹히고 Enter 가 "확인"(= 예전 글 불러오기)을 눌러 그때까지 쓴 글이 통째로 날아간다.
// 2026-09-12 에 제목·사진 2장·본문 앞부분을 이렇게 통째로 잃었다. 그래서 계속 감시한다.
const RECOVERY_RE = '작성\\s*중인\\s*글|이어서\\s*작성';

// 복구 팝업이 보이면 "취소"만 눌러 닫는다. 확인을 누르면 지금 쓴 글이 예전 글로 덮인다.
// 사진 업로드 진행 팝업("업로드 준비 중입니다")까지 닫으면 업로드가 취소되므로,
// 문구가 복구 팝업일 때만 건드린다.
async function guardPopup(root) {
  const hit = await root.evaluate((reSrc) => {
    const rx = new RegExp(reSrc);
    // position:fixed 인 모달은 offsetParent 가 항상 null 이라 그걸로 판단하면 안 된다.
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    };
    const popup = [...document.querySelectorAll('.se-popup-alert-confirm, .se-popup')]
      .filter(visible).find((el) => rx.test(el.innerText || ''));
    if (!popup) return null;
    // 팝업 안에서만 찾는다 (바깥에서 "취소"를 텍스트로 찾으면 툴바의 "취소선"을 누른다)
    const btn = popup.querySelector('.se-popup-button-cancel')
      || [...popup.querySelectorAll('button, a')].find((b) => (b.innerText || '').trim() === '취소');
    if (btn) btn.click();
    return (popup.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }, RECOVERY_RE).catch(() => null);
  if (hit) await root.waitForTimeout(400).catch(() => {});
  return hit;
}

// 문서에 실제로 뭐가 들어 있는지 읽는다.
// 제목은 플레이스홀더("제목")를 빼고 센다 — innerText 를 그대로 믿으면
// 제목칸이 비어 있어도 "제목" 이 읽혀서 검증이 그냥 통과해 버린다.
async function readDocState(root) {
  return root.evaluate((sel) => {
    const strip = (el) => {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.se-placeholder, .__se_placeholder').forEach((n) => n.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const titleMod = document.querySelector(`${sel} .se-module-text`);
    const body = [...document.querySelectorAll('.se-component.se-text')].map(strip).join('\n');
    return {
      title: strip(document.querySelector(sel)),
      titleFlaggedEmpty: !!titleMod?.classList.contains('se-is-empty'),
      bodyChars: body.replace(/\s/g, '').length,
      imageComponents: document.querySelectorAll('.se-component.se-image').length,
    };
  }, EDITOR_SEL);
}

// 다시 쓰기 전에 남은 찌꺼기를 지운다. 안 지우면 지난 시도의 조각 위에 덧쓴다.
async function clearDocument(page, root) {
  const st = await readDocState(root).catch(() => null);
  if (!st || (!st.bodyChars && !st.imageComponents && !st.title)) return true;
  await root.locator('.se-component.se-text .se-text-paragraph').last()
    .click({ timeout: 5_000 }).catch(() => {});
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(600);
  const after = await readDocState(root).catch(() => null);
  return !!after && !after.bodyChars && !after.imageComponents;
}

// 타이핑 도중 에디터가 리로드되면 그때까지 쓴 게 전부 날아간다. 감시해서 사유로 남긴다.
function watchReload(page) {
  const state = { reloaded: false };
  const onNav = (frame) => { if (frame === page.mainFrame()) state.reloaded = true; };
  page.on('framenavigated', onNav);
  state.stop = () => page.off('framenavigated', onNav);
  return state;
}

// 이미지 삽입: 툴바 사진 버튼 → 파일 선택 다이얼로그에 파일 전달.
// 고정 시간만 기다리지 않고 본문에 실제로 붙은 걸 확인하고 돌아온다.
async function insertImage(page, root, imagePath) {
  // 팝업이 떠 있으면 그 뒤의 사진 버튼은 눌리지 않는다 (파일창이 안 뜨고 15초 뒤 타임아웃)
  await guardPopup(root);
  const btn = root.locator('button[data-name="image"], .se-toolbar-item-image button').first();
  if (!(await btn.count().catch(() => 0))) {
    throw new Error('툴바에서 사진 버튼을 찾지 못했습니다 (data-name="image")');
  }
  const before = (await readDocState(root).catch(() => ({ imageComponents: 0 }))).imageComponents;
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    btn.click(),
  ]);
  await chooser.setFiles(imagePath);

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(700);
    const now = await readDocState(root).catch(() => null);
    if (now && now.imageComponents > before) return true;
    await guardPopup(root); // 업로드 중에 복구 팝업이 뜨는 경우
  }
  throw new Error(`사진이 본문에 붙지 않았습니다: ${path.basename(imagePath)}`);
}

// 저장 버튼의 현재 상태. 네이버는 "저장 3" 처럼 임시저장 개수를 같이 보여준다.
// 저장 전후로 이 숫자가 늘어나면 실제로 저장된 것이다.
async function readSaveState(root) {
  // 네이버는 임시저장 개수를 저장 버튼이 아니라 바로 옆의 별도 버튼에 그린다
  // ([data-click-area="tpb*s.count"] / .save_count_btn__xxzDt). 저장 버튼만 읽으면
  // "저장" 이라는 글자뿐이라 개수를 못 읽고, 저장에 성공해도 실패로 보고된다.
  return root.evaluate(() => {
    const pick = (sel) => document.querySelector(sel);
    const saveBtn = pick('[data-click-area="tpb.save"]')
      || pick('button[class*="save_btn"]')
      || [...document.querySelectorAll('button')].find((b) => /저장/.test(b.innerText || ''));
    const countBtn = pick('[data-click-area*="s.count"]') || pick('[class*="save_count_btn"]');
    const saveText = (saveBtn?.innerText || '').replace(/\s+/g, ' ').trim();
    const countText = (countBtn?.innerText || '').replace(/\s+/g, ' ').trim();
    const num = (t) => { const m = String(t).replace(/\s/g, '').match(/(\d+)/); return m ? Number(m[1]) : null; };
    // 개수 전용 버튼이 먼저, 없으면 저장 버튼 글자 안의 숫자 (구버전 스킨)
    const count = num(countText) ?? num(saveText);
    return { text: [saveText, countText].filter(Boolean).join(' ').trim(), count };
  }).catch(() => ({ text: '', count: null }));
}

// 임시저장 — 누르고 끝내지 않고 저장됐는지 확인한다. 발행 버튼은 절대 누르지 않는다.
async function tempSave(page, root) {
  await closeHelpPanel(page, root);
  const before = await readSaveState(root);

  const save = root.locator(
    '[data-click-area="tpb.save"], button.save_btn__bzc5B, button:has-text("저장")',
  ).first();
  if (!(await save.count().catch(() => 0))) {
    return { ok: false, reason: 'save_button_not_found', before };
  }
  try {
    await save.click({ timeout: 10_000 });
  } catch {
    await save.click({ force: true, timeout: 10_000 }).catch(() => {});
  }

  // 저장 확인: (1) 저장 개수 증가 (2) 저장 완료 안내 문구 — 둘 중 하나면 성공
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    const after = await readSaveState(root);
    if (before.count !== null && after.count !== null && after.count > before.count) {
      return { ok: true, how: 'count', before, after };
    }
    const notice = await root.evaluate(() => {
      const t = document.body.innerText || '';
      return /저장되었습니다|저장했습니다|저장 완료/.test(t);
    }).catch(() => false);
    if (notice) return { ok: true, how: 'notice', before, after };
  }
  const after = await readSaveState(root);
  // 개수를 아예 못 읽는 스킨이면 판단 불가 — 성공으로 우기지 않는다
  return {
    ok: false,
    reason: before.count === null ? 'save_unverifiable' : 'save_not_confirmed',
    before,
    after,
  };
}

// 본문 안의 이미지 마커: [[img:파일명]] 또는 [[img:파일명|설명]]
const IMG_MARKER = /^\s*\[\[\s*(?:img|image)\s*:\s*([^|\]]+?)\s*(?:\|\s*(.+?)\s*)?\]\]\s*$/i;

// 다시 시도할 가치가 있는 실패 — 에디터가 리로드돼 내용이 날아간 부류.
// 저장 실패는 여기 넣지 않는다 (이미 저장됐을 수도 있어 다시 쓰면 초안이 중복된다).
const RETRYABLE = new Set(['editor_reloaded', 'content_lost', 'title_empty', 'image_not_attached', 'title_mismatch', 'fill_error']);

// 제목·본문·이미지를 한 번 채우고 저장까지 한다.
async function fillOnce(page, { title, content, images = [], imagedir = '' }) {
  const { root, where } = await resolveEditor(page);
  if (!root) {
    const dir = await dumpEvidence(page, null, `no-editor-${stamp()}`);
    return { ok: false, reason: 'editor_not_found', hint: `에디터를 찾지 못했습니다. 증거: ${dir}` };
  }

  await dismissRecoveryPopup(root);
  await closeHelpPanel(page, root);
  // 복구 팝업은 진입 직후가 아니라 몇 초 뒤에 뜬다. 치기 전에 잠깐 지켜보고 닫는다.
  for (let i = 0; i < 8; i += 1) {
    if (await guardPopup(root)) break;
    await page.waitForTimeout(1_000);
  }
  const nav = watchReload(page);

  try {
    const focusBody = async () => {
      await root.locator('.se-component.se-text .se-text-paragraph').last()
        .click({ timeout: 5_000 }).catch(() => {});
    };
    // 사람 속도로 치되, 치는 동안 복구 팝업이 뜨는지 계속 살핀다.
    // 팝업을 닫으면 포커스가 풀리므로 원래 칸으로 되돌려 놓고 이어서 친다.
    const typeGuarded = async (text, refocus) => {
      let since = 0;
      for (const ch of text) {
        if (since >= 8) {
          since = 0;
          if (await guardPopup(root)) await refocus();
        }
        await page.keyboard.type(ch);
        since += 1;
        await page.waitForTimeout(60 + Math.floor(Math.random() * 80));
      }
    };

    // 제목. 클릭하자마자 치면 첫 글자가 플레이스홀더 정리에 먹혀 사라진다 —
    // 실제로 "사이클카트는…" 이 "이클카트는…" 으로 저장된 적이 있다.
    // 포커스가 자리잡을 때까지 기다리고, 친 뒤 글자 그대로인지 대조해 틀리면 지우고 다시 친다.
    const titleBox = root.locator(`${EDITOR_SEL} .se-text-paragraph`).first();
    const wantTitle = title.replace(/\s+/g, ' ').trim();
    const refocusTitle = async () => { await titleBox.click({ timeout: 5_000 }).catch(() => {}); };
    let t = null;
    for (let k = 1; k <= 3; k += 1) {
      await titleBox.click();
      await page.waitForTimeout(500);
      const cur = (await readDocState(root).catch(() => ({ title: '' }))).title;
      if (cur) { // 앞 시도에서 잘못 들어간 글자를 지운다 (제목칸 안에서만)
        await page.keyboard.press('End');
        for (let i = 0; i < cur.length + 5; i += 1) await page.keyboard.press('Backspace');
      }
      await typeGuarded(title, refocusTitle);
      t = await readDocState(root).catch(() => null);
      if (t && t.title === wantTitle) break;
    }

    // 본문을 다 치고 나서 제목이 틀린 걸 알면 2분을 날린다. 여기서 바로 확인한다.
    if (!t || !t.title || t.titleFlaggedEmpty) {
      const dir = await dumpEvidence(page, root, `title-empty-${stamp()}`);
      return {
        ok: false,
        reason: nav.reloaded ? 'editor_reloaded' : 'title_empty',
        hint: `제목이 비어 있습니다${nav.reloaded ? ' (타이핑 도중 에디터가 리로드됐습니다)' : ' (입력칸 포커스 실패)'}. 증거: ${dir}`,
      };
    }
    if (t.title !== wantTitle) {
      const dir = await dumpEvidence(page, root, `title-mismatch-${stamp()}`);
      return {
        ok: false,
        reason: 'title_mismatch',
        hint: `제목이 원고와 다릅니다. 원고: "${wantTitle}" / 에디터: "${t.title}". 증거: ${dir}`,
      };
    }

    // 본문
    await focusBody();
    const used = new Set();
    let imagesInserted = 0;
    let expectedChars = 0;
    // 스마트에디터는 마크다운을 해석하지 않는다. 그대로 치면 본문에
    // **굵게** 와 |---|---| 가 문자로 찍히므로 평문으로 바꿔서 넣는다.
    for (const rawLine of markdownToPlain(content).split('\n')) {
      const m = rawLine.match(IMG_MARKER);
      if (m) {
        const imgPath = imagedir ? path.resolve(imagedir, m[1]) : m[1];
        if (!fs.existsSync(imgPath)) {
          const dir = await dumpEvidence(page, root, `missing-image-${stamp()}`);
          return { ok: false, reason: 'image_missing', hint: `${m[1]} 파일이 없습니다. 증거: ${dir}` };
        }
        await insertImage(page, root, imgPath);
        imagesInserted += 1;
        used.add(path.basename(imgPath));
        if (m[2]) {
          expectedChars += m[2].replace(/\s/g, '').length;
          await typeGuarded(m[2], focusBody);
          if (await guardPopup(root)) await focusBody();
          await page.keyboard.press('Enter');
        }
        continue;
      }
      if (await guardPopup(root)) await focusBody();
      expectedChars += rawLine.replace(/\s/g, '').length;
      await typeGuarded(rawLine, focusBody);
      if (await guardPopup(root)) await focusBody();
      await page.keyboard.press('Enter');
    }
    for (const img of images) {
      if (!used.has(path.basename(img)) && fs.existsSync(img)) {
        await insertImage(page, root, img);
        imagesInserted += 1;
      }
    }

    // 저장하기 전에 실제로 들어갔는지 확인한다.
    // 제목 입력칸에 포커스가 안 잡히면 제목이 본문으로 들어가는데, 예전엔 그걸 몰랐다.
    const filled = await readDocState(root).catch(() => null);
    if (!filled) {
      const dir = await dumpEvidence(page, root, `unreadable-${stamp()}`);
      return { ok: false, reason: 'doc_unreadable', hint: `문서 상태를 읽지 못했습니다. 증거: ${dir}` };
    }
    const fail = async (reason, hint) => {
      const dir = await dumpEvidence(page, root, `${reason}-${stamp()}`);
      return { ok: false, reason: nav.reloaded ? 'editor_reloaded' : reason, hint: `${hint} 증거: ${dir}` };
    };
    if (!filled.title || filled.titleFlaggedEmpty) {
      return fail('title_empty', '제목이 비어 있습니다.');
    }
    if (filled.title !== wantTitle) {
      return fail('title_mismatch', `제목이 원고와 다릅니다 (에디터: "${filled.title}").`);
    }
    if (filled.imageComponents < imagesInserted) {
      return fail('image_not_attached', `사진 ${imagesInserted}장을 넣었는데 ${filled.imageComponents}장만 붙었습니다.`);
    }
    // 리로드로 앞부분이 통째로 날아가는 사고를 여기서 잡는다 (예전엔 그대로 저장됐다).
    if (expectedChars && filled.bodyChars < Math.floor(expectedChars * 0.8)) {
      return fail('content_lost', `본문 ${expectedChars}자를 쳤는데 ${filled.bodyChars}자만 남아 있습니다.`);
    }
    if (nav.reloaded) {
      return fail('editor_reloaded', '타이핑 도중 에디터가 리로드됐습니다.');
    }

    const saved = await tempSave(page, root);
    const dir = await dumpEvidence(page, root, `${saved.ok ? 'ok' : 'save-failed'}-${stamp()}`);
    if (!saved.ok) {
      return {
        ok: false,
        reason: saved.reason,
        hint: `저장을 확인하지 못했습니다 (저장버튼: "${saved.before?.text || '?'}" → "${saved.after?.text || '?'}"). 증거: ${dir}`,
        evidence: dir,
      };
    }
    return {
      ok: true,
      where,
      imagesInserted,
      imageComponents: filled.imageComponents,
      titleOnPage: filled.title,
      bodyChars: filled.bodyChars,
      verifiedBy: saved.how,
      evidence: dir,
    };
  } finally {
    nav.stop();
  }
}

// 채우기 + 실패하면 처음부터 다시. 네이버 에디터가 글 쓰는 도중에 스스로 리로드돼
// 내용이 날아가는 일이 있어서, 한 번 실패했다고 그날 글을 포기하지 않는다.
async function fillEditor(page, opts) {
  const attempts = Math.max(1, Number(process.env.NAVER_FILL_ATTEMPTS || 3));
  let last = null;
  for (let i = 1; i <= attempts; i += 1) {
    if (i > 1) {
      console.log(`   ↻ ${i}/${attempts}번째 시도 — 에디터를 새로 열고 처음부터 다시 씁니다 (${last.reason}: ${last.hint || ''}).`);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2_000);
      const { root } = await resolveEditor(page);
      if (root) {
        await dismissRecoveryPopup(root);
        await guardPopup(root);
        await clearDocument(page, root);
      }
    }
    try {
      last = await fillOnce(page, opts);
    } catch (e) {
      // 사진 업로드 타임아웃처럼 도중에 터진 경우. 저장은 안 됐으니 다시 써도 안전하다.
      const dir = await dumpEvidence(page, null, `fill-error-${stamp()}`);
      last = { ok: false, reason: 'fill_error', hint: `${String(e.message).split('\n')[0]} / 증거: ${dir}` };
    }
    if (last.ok) return { ...last, attempts: i };
    if (!RETRYABLE.has(last.reason)) return { ...last, attempts: i };
  }
  return { ...last, attempts };
}

// 방식 A: NID 쿠키 사용 (구버전 호환)
async function writePost({
  blogId, title, content, images = [], imagedir = '', headful = true, record = true,
}) {
  const { browser, context, hasCookies } = await launch({ headful, record });
  if (!hasCookies) {
    await browser.close();
    return { ok: false, reason: 'no_cookies', hint: '먼저 쿠키를 저장하거나 프로필 로그인(node index.js login)을 하세요' };
  }
  const page = await context.newPage();
  try {
    await page.goto(writeUrl(blogId), { waitUntil: 'domcontentloaded' });
    if (page.url().includes('nidlogin')) {
      return { ok: false, reason: 'cookie_expired', hint: 'NID 쿠키가 만료되었습니다' };
    }
    const r = await fillEditor(page, { title, content, images, imagedir });
    let video = null;
    if (record) { try { video = (await page.video()?.path()) || null; } catch { video = null; } }
    return { ...r, saved: r.ok, published: false, video };
  } catch (e) {
    const dir = await dumpEvidence(page, null, `error-${stamp()}`);
    return { ok: false, reason: 'error', hint: `${e.message.split('\n')[0]} / 증거: ${dir}` };
  } finally {
    await context.close();
    await browser.close();
  }
}

// 방식 B(권장): 로그인된 전용 크롬 프로필 재사용.
async function writePostProfile({
  blogId, title, content, images = [], imagedir = '', headful = true, record = true, keepOpen = false,
}) {
  const { launchPersistent } = require('./browser');
  const { context } = await launchPersistent({ headful, record });
  const page = context.pages()[0] || (await context.newPage());
  try {
    await page.goto(writeUrl(blogId), { waitUntil: 'domcontentloaded' });
    if (page.url().includes('nidlogin')) {
      if (!headful) {
        return { ok: false, reason: 'need_login', hint: 'node index.js login 으로 이 프로필에 네이버 로그인을 한 번 해주세요' };
      }
      await page.waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 180_000 });
      await page.goto(writeUrl(blogId), { waitUntil: 'domcontentloaded' });
    }
    const r = await fillEditor(page, { title, content, images, imagedir });
    let video = null;
    if (record) { try { video = (await page.video()?.path()) || null; } catch { video = null; } }
    if (keepOpen) {
      console.log('\n--keep-open: 창을 열어둡니다. 눈으로 확인한 뒤 Enter를 누르세요.');
      await new Promise((res) => process.stdin.once('data', res));
    }
    return { ...r, saved: r.ok, published: false, video };
  } catch (e) {
    const dir = await dumpEvidence(page, null, `error-${stamp()}`);
    return { ok: false, reason: 'error', hint: `${e.message.split('\n')[0]} / 증거: ${dir}` };
  } finally {
    await context.close();
  }
}

module.exports = { writePost, writePostProfile, fillEditor, OUT_DIR, resolveEditor, dumpEvidence, writeUrl };
