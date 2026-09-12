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

// 이미지 삽입: 툴바 사진 버튼 → 파일 선택 다이얼로그에 파일 전달
async function insertImage(page, root, imagePath) {
  const btn = root.locator('button[data-name="image"], .se-toolbar-item-image button').first();
  if (!(await btn.count().catch(() => 0))) {
    throw new Error('툴바에서 사진 버튼을 찾지 못했습니다 (data-name="image")');
  }
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    btn.click(),
  ]);
  await chooser.setFiles(imagePath);
  await page.waitForTimeout(3_000); // 업로드 완료 대기
}

// 저장 버튼의 현재 상태. 네이버는 "저장 3" 처럼 임시저장 개수를 같이 보여준다.
// 저장 전후로 이 숫자가 늘어나면 실제로 저장된 것이다.
async function readSaveState(root) {
  const el = root.locator('[data-click-area="tpb.save"], button.save_btn__bzc5B, button:has-text("저장")').first();
  const text = await el.innerText().catch(() => '');
  const m = text.replace(/\s/g, '').match(/(\d+)/);
  return { text: text.replace(/\s+/g, ' ').trim(), count: m ? Number(m[1]) : null };
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

// 제목·본문·이미지를 채우고, 채워졌는지 확인한 뒤 임시저장한다.
async function fillEditor(page, { title, content, images = [], imagedir = '' }) {
  const { root, where } = await resolveEditor(page);
  if (!root) {
    const dir = await dumpEvidence(page, null, `no-editor-${stamp()}`);
    return { ok: false, reason: 'editor_not_found', hint: `에디터를 찾지 못했습니다. 증거: ${dir}` };
  }

  await dismissRecoveryPopup(root);
  await closeHelpPanel(page, root);

  // 제목
  const titleBox = root.locator(`${EDITOR_SEL} .se-text-paragraph`).first();
  await titleBox.click();
  await humanType(page, title);

  // 본문
  await root.locator('.se-component.se-text .se-text-paragraph').last().click();
  const used = new Set();
  let imagesInserted = 0;
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
      if (m[2]) { await humanType(page, m[2]); await page.keyboard.press('Enter'); }
      continue;
    }
    await humanType(page, rawLine);
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
  const filled = await root.evaluate((sel) => {
    const t = document.querySelector(sel);
    const body = document.querySelector('.se-component.se-text');
    return {
      title: (t?.innerText || '').replace(/\s+/g, ' ').trim(),
      bodyChars: (document.querySelector('.se-container')?.innerText || body?.innerText || '').length,
      imageComponents: document.querySelectorAll('.se-component.se-image').length,
    };
  }, EDITOR_SEL).catch(() => null);

  if (!filled || !filled.title) {
    const dir = await dumpEvidence(page, root, `title-empty-${stamp()}`);
    return { ok: false, reason: 'title_empty', hint: `제목이 비어 있습니다 (입력칸 포커스 실패). 증거: ${dir}` };
  }
  if (filled.imageComponents < imagesInserted) {
    const dir = await dumpEvidence(page, root, `image-lost-${stamp()}`);
    return {
      ok: false,
      reason: 'image_not_attached',
      hint: `사진 ${imagesInserted}장을 넣었는데 ${filled.imageComponents}장만 붙었습니다. 증거: ${dir}`,
    };
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
    verifiedBy: saved.how,
    evidence: dir,
  };
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
