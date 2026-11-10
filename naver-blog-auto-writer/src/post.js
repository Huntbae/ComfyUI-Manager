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
  // 입력칸도 남긴다. 동영상 제목칸처럼 버튼이 아닌 것의 셀렉터를 고칠 때 필요하다.
  // 값은 남기지 않는다 — 어떤 칸이 있는지만 본다.
  const inputs = await ctx.evaluate(() => [...document.querySelectorAll('input, textarea')]
    .map((el) => ({
      type: el.getAttribute('type') || el.tagName.toLowerCase(),
      id: el.id || '',
      ph: el.getAttribute('placeholder') || '',
      cls: String(el.className || '').slice(0, 90),
    }))
    .filter((i) => i.type !== 'hidden')
    .slice(0, 80)).catch(() => []);
  fs.writeFileSync(path.join(dir, 'report.txt'),
    `URL: ${page.url()}\n\n=== 화면 텍스트 ===\n${text}\n\n=== 버튼 목록 ===\n` +
    buttons.map((b) => `[${b.area || b.name || '-'}] "${b.text}"  .${b.cls}`).join('\n') +
    '\n\n=== 입력칸 목록 ===\n' +
    inputs.map((i) => `<${i.type}>${i.id ? ` #${i.id}` : ''}${i.ph ? ` placeholder="${i.ph}"` : ''}  .${i.cls}`).join('\n'));
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
    const imgs = [...document.querySelectorAll('.se-component.se-image')];
    return {
      title: strip(document.querySelector(sel)),
      titleFlaggedEmpty: !!titleMod?.classList.contains('se-is-empty'),
      bodyChars: body.replace(/\s/g, '').length,
      bodyText: body,
      imageComponents: imgs.length,
      // 동영상도 본문에 실제로 붙었는지 세어야 한다. 사진과 세는 곳이 다르다.
      videoComponents: document.querySelectorAll(
        '.se-component.se-video, .se-component.se-videoThumbnail, .se-component[class*="video"]',
      ).length,
      // 사진 설명은 본문이 아니라 사진 자체의 캡션칸에 들어가야 한다
      captions: imgs.map((el) => strip(el.querySelector('.se-caption .se-text-paragraph'))),
    };
  }, EDITOR_SEL);
}

// 사진 설명은 본문 문단이 아니라 사진 자체의 캡션칸(.se-caption)에 넣는다.
// 본문에 치면 사진과 분리된 문단으로 남아 그림 제목처럼 보이지 않는다.
// 사진 자체는 손대지 않고, 테두리·박스 같은 걸 두르지도 않는다.
async function typeCaption(page, root, text, typeFn) {
  const img = root.locator('.se-component.se-image').last();
  if (!(await img.count().catch(() => 0))) return false;
  // 사진을 눌러 선택해야 캡션칸이 나타난다. 선택 전에는 display:none 이라 클릭이 안 된다.
  await img.click({ timeout: 8_000 }).catch(() => {});
  const cap = img.locator('.se-caption .se-text-paragraph').first();
  for (let i = 0; i < 10; i += 1) {
    const box = await cap.boundingBox().catch(() => null);
    if (box && box.height > 0) break;
    await page.waitForTimeout(400);
    if (i === 4) await img.click({ timeout: 5_000 }).catch(() => {});
  }
  const box = await cap.boundingBox().catch(() => null);
  if (!box || box.height <= 0) return false;
  await cap.click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(400); // 플레이스홀더가 걷히고 포커스가 잡힐 때까지
  await typeFn(text);
  return true;
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

async function readSaveNotice(root) {
  // "자동저장"은 네이버가 스스로 돌리는 것이라 우리가 누른 저장의 증거가 아니다.
  // 그 글자를 지운 뒤에 저장 완료 문구를 찾는다.
  return root.evaluate(() => {
    const t = (document.body.innerText || '').replace(/자동\s*저장/g, '');
    return /저장되었습니다|저장했습니다|저장 완료|임시저장되었습니다/.test(t);
  }).catch(() => false);
}

// 임시저장 — 누르고 끝내지 않고 저장됐는지 확인한다. 발행 버튼은 절대 누르지 않는다.
async function tempSave(page, root, maxWaitMs = 20_000) {
  await closeHelpPanel(page, root);
  const before = await readSaveState(root);
  // 클릭 전에 안내 문구가 이미 떠 있었는지 찍어둔다. 비교 대상이 없으면
  // 남아 있던 문구로 성공이라고 우기게 된다.
  const beforeNotice = await readSaveNotice(root);

  const save = root.locator(
    // 해시가 붙은 클래스(save_btn__bzc5B)를 박아두면 안 된다. 네이버가 빌드할
    // 때마다 바뀐다 — 오늘 덤프에는 save_btn__FuUyN 으로 찍혀 있었다.
    // data-click-area 가 먼저이고, 클래스는 앞머리만 본다.
    '[data-click-area="tpb.save"], button[class*="save_btn"], button:has-text("저장")',
  ).first();
  if (!(await save.count().catch(() => 0))) {
    return { ok: false, reason: 'save_button_not_found', before };
  }
  try {
    await save.click({ timeout: 10_000 });
  } catch {
    await save.click({ force: true, timeout: 10_000 }).catch(() => {});
  }

  // 저장 확인: (1) 저장 개수 증가 (2) 저장 완료 안내가 **새로** 떴는지
  //
  // 예전에는 (2)를 클릭 전과 비교하지 않고 현재 화면에만 그 문구가 있는지 봤다.
  // 네이버는 자동저장을 주기적으로 돌리고 그 안내를 화면에 남긴다
  // (덤프에 "자동저장 오후 02:03"). 그래서 우리가 누른 저장이 실패해도
  // 화면에 남아 있던 문구로 통과했다. 기록은 30편 저장 완료인데 네이버의
  // 저장 개수는 3이었던 간극이 여기서 나왔다.
  //
  // 이제 클릭 전 상태를 찍어두고 없던 문구가 생긴 경우만 인정한다.
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    const after = await readSaveState(root);
    if (before.count !== null && after.count !== null && after.count > before.count) {
      return { ok: true, how: 'count', before, after };
    }
    // 개수를 읽을 수 있으면 개수만 믿는다. 안내 문구는 개수를 못 읽는
    // 스킨에서만 쓰는 보조 수단이다.
    if (before.count !== null) continue;
    const notice = await readSaveNotice(root);
    if (notice && !beforeNotice) return { ok: true, how: 'notice', before, after };
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
// 동영상 마커: [[video:파일명|설명]]
const VIDEO_MARKER = /^\s*\[\[\s*(?:video|영상|동영상)\s*:\s*([^|\]]+?)\s*(?:\|\s*(.+?)\s*)?\]\]\s*$/i;

// 동영상 삽입: 사진과 흐름이 다르다.
//
//   사진  — 툴바 버튼 → 파일창 → 본문에 바로 붙는다 (몇 초)
//   동영상 — 툴바 버튼 → 업로드 레이어 → 파일창 → 업로드 → **제목 입력(필수)**
//            → 완료 → 본문에 자리만 잡히고 인코딩은 서버에서 계속된다 (몇 분)
//
// 그래서 (1) 파일창이 바로 안 뜨면 레이어 안의 '추가' 버튼을 한 번 더 누르고,
// (2) 업로드가 끝날 때까지 완료 버튼이 눌리는지 보고 기다리고,
// (3) 제목을 채우고, (4) 본문에 영상 조각이 늘었는지 확인하고 돌아온다.
// 고정 시간만 기다리고 성공이라고 하지 않는다 — 사진에서 그 방식으로 사고가 났다.
const VIDEO_BTN = 'button[data-name="video"], button.se-video-toolbar-button';

// 업로드 창 안의 것들. **앞에 적은 후보가 이긴다** (firstVisible 참고).
//
// 예전에는 쉼표로 이은 셀렉터 하나에 .first() 를 썼다. 그러면 적은 순서가
// 아니라 문서 순서로 고른다. 게다가 'button:has-text("동영상 추가")' 는
// 툴바 버튼에도 걸린다 — 실제 네이버의 툴바 버튼 글자가 '동영상 동영상 추가'
// 이기 때문이다(2026-11-10 덤프). 그래서 업로드 창의 추가 버튼 대신 툴바
// 버튼을 다시 눌렀고, 파일창이 안 떠서 video_not_attached 로 끝났다.
// '파일 추가' 도 같은 식으로 툴바의 '파일 파일 추가' 에 걸린다.
//
// nvu_ 로 시작하는 것은 네이버 동영상 업로더의 클래스로 알려진 이름이다.
// 이 프로젝트에서 실제 화면으로 확인한 것은 아니다. 틀려도 뒤의 글자 기반
// 후보가 받는다. 무엇이 실제로 걸렸는지는 kart doctor --video 가 찍어준다.
const NOT_TOOLBAR = ':not([class*="toolbar-button"]):not([data-name="video"]):not([data-name="file"])';
const VIDEO_ADD = [
  'button.nvu_btn_append.nvu_local',
  'button[class*="nvu_btn_append"]',
  'button.se-video-upload-button',
  `button:has-text("동영상 추가")${NOT_TOOLBAR}`,
  `a:has-text("동영상 추가")${NOT_TOOLBAR}`,
  `button:has-text("내 컴퓨터")${NOT_TOOLBAR}`,
  `button:has-text("파일 추가")${NOT_TOOLBAR}`,
];
const VIDEO_TITLE = [
  '#nvu_inp_box_title',
  'input[class*="nvu_inp"]',
  'input.se-video-title, .se-video-title input',
  'input[placeholder*="제목"]',
  'input[name="title"]',
];
const VIDEO_DONE = [
  'button.nvu_btn_submit',
  'button[class*="nvu_btn_submit"]',
  `button:has-text("완료")${NOT_TOOLBAR}`,
  `button:has-text("등록")${NOT_TOOLBAR}`,
];

// 후보 목록에서 화면에 보이는 첫 번째를 고른다. 적은 순서가 우선이다.
// 업로드 창이 iframe 안에 뜰 수도 있어 모든 프레임을 본다.
async function firstVisible(page, sels) {
  for (const sel of sels) {
    for (const f of page.frames()) {
      const loc = f.locator(sel);
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 5); i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) return { loc: el, sel };
      }
    }
  }
  return null;
}

async function insertVideo(page, root, videoPath, title, { uploadTimeout = 900_000 } = {}) {
  await guardPopup(root);
  const btn = root.locator(VIDEO_BTN).first();
  if (!(await btn.count().catch(() => 0))) {
    throw new Error('툴바에서 동영상 버튼을 찾지 못했습니다 (data-name="video"). '
      + 'kart doctor 로 실제 버튼 이름을 확인하세요.');
  }
  const count = async () => (await readDocState(root).catch(() => ({ videoComponents: -1 }))).videoComponents;
  const before = Math.max(0, await count());
  const want = (title || path.basename(videoPath, path.extname(videoPath))).slice(0, 60);

  // 네이버가 alert() 로 말을 걸면(업로드 중에 완료를 눌렀을 때 등) 거기서 멈춰 선다.
  // 확인을 눌러 넘긴다. 영상 삽입 동안만 건다.
  const onDialog = (d) => { d.accept().catch(() => {}); };
  page.on('dialog', onDialog);
  try {
    // 1) 버튼을 누른다. 파일창이 바로 뜨는 구현도 있고, 업로드 창이 먼저 뜨는 구현도 있다.
    let chooser = null;
    try {
      [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 8_000 }),
        btn.click(),
      ]);
    } catch {
      const add = await firstVisible(page, VIDEO_ADD);
      if (!add) {
        throw new Error('동영상 업로드 창에서 추가 버튼을 찾지 못했습니다. '
          + 'kart doctor --video 로 구조를 확인하세요.');
      }
      [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20_000 }),
        add.loc.click(),
      ]);
    }
    await chooser.setFiles(videoPath);

    // 2) 본문에 붙을 때까지 돈다. 그 사이에
    //      · 제목칸이 보이면 채운다 (네이버 필수. 파일명이 미리 들어가 있어도 바꾼다)
    //      · 완료 버튼이 눌릴 수 있으면 누른다
    //    예전에는 "완료가 눌릴 수 있게 되면 = 업로드 끝"으로 보고 한 번만 눌렀다.
    //    완료가 처음부터 눌리는 구현이면 업로드 도중에 눌러 놓고 끝난 줄 알게 된다.
    //    그래서 붙었는지를 유일한 성공 기준으로 삼고, 안 붙었으면 다시 누른다.
    //    고정 시간만 기다리고 성공이라고 하지 않는다.
    const deadline = Date.now() + uploadTimeout;
    let clicks = 0;
    let lastClick = 0;
    while (Date.now() < deadline) {
      if (await count() > before) return;
      const t = await firstVisible(page, VIDEO_TITLE);
      if (t) {
        const cur = await t.loc.inputValue().catch(() => null);
        if (cur !== null && cur !== want) await t.loc.fill(want).catch(() => {});
      }
      const done = await firstVisible(page, VIDEO_DONE);
      if (done && Date.now() - lastClick > 8_000
          && await done.loc.isEnabled().catch(() => false)) {
        await done.loc.click({ timeout: 10_000 }).catch(() => {});
        clicks += 1;
        lastClick = Date.now();
      }
      await page.waitForTimeout(1_500);
    }
    const mins = Math.round(uploadTimeout / 60_000);
    throw new Error(clicks
      ? `완료를 ${clicks}번 눌렀지만 ${mins}분 안에 본문에 붙지 않았습니다 (${path.basename(videoPath)}).`
      : `동영상 업로드가 ${mins}분 안에 끝나지 않았습니다 (${path.basename(videoPath)}). `
        + '완료 버튼을 찾지 못했거나 끝까지 잠겨 있었습니다.');
  } finally {
    page.off('dialog', onDialog);
  }
}

// 동영상 업로드 창을 열어 구조만 찍는다. 파일은 올리지 않는다.
//
// 툴바의 동영상 버튼은 덤프로 확인됐지만, 그 버튼을 누른 뒤 뜨는 창은
// 눌러보기 전에는 알 수 없다. 영상을 20~40분 인코딩한 뒤 첫 편에서 막히는
// 것보다, 먼저 열어보고 셀렉터를 맞추는 편이 싸다.
async function probeVideoLayer(page, root) {
  const out = [];
  const snap = async () => {
    const all = new Map();
    for (const f of page.frames()) {
      const where = f === page.mainFrame() ? '바깥' : (f.name() || f.url().slice(0, 50));
      const items = await f.evaluate(() => {
        const vis = (el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
        };
        return [...document.querySelectorAll('button, a[role="button"], input, textarea')].map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
          ph: el.getAttribute('placeholder') || '',
          id: el.id || '',
          cls: String(el.className || '').slice(0, 80),
          disabled: !!el.disabled,
          visible: vis(el),
        }));
      }).catch(() => []);
      for (const it of items) {
        const key = [where, it.tag, it.type, it.id, it.cls, it.text, it.ph, it.visible].join('|');
        all.set(key, { where, ...it });
      }
    }
    return all;
  };
  const fmt = (it) => `  [${it.where}] <${it.tag}${it.type ? ` type=${it.type}` : ''}>`
    + `${it.id ? ` #${it.id}` : ''} "${it.text}"${it.ph ? ` placeholder="${it.ph}"` : ''}`
    + `  .${it.cls}${it.disabled ? '  (잠김)' : ''}${it.visible ? '' : '  (안 보임)'}`;
  const hits = async () => {
    for (const [label, sels] of [['추가 버튼', VIDEO_ADD], ['제목칸', VIDEO_TITLE], ['완료 버튼', VIDEO_DONE]]) {
      const h = await firstVisible(page, sels);
      out.push(`  ${label}: ${h ? `걸림 ← ${h.sel}` : '안 걸림'}`);
    }
  };

  let chooser = 0;
  // 듣고 있으면 playwright 가 파일창을 가로채서 실제 창이 뜨지 않는다.
  const onChooser = () => { chooser += 1; };
  page.on('filechooser', onChooser);
  try {
    const btn = root.locator(VIDEO_BTN).first();
    if (!(await btn.count().catch(() => 0))) return '툴바에서 동영상 버튼을 찾지 못했습니다.';
    const before = await snap();
    await btn.click();
    await page.waitForTimeout(3_000);
    const after = await snap();
    out.push(`툴바의 동영상 버튼을 누름 → 파일창 ${chooser ? '바로 뜸' : '안 뜸 (업로드 창이 먼저 뜨는 구현)'}`);
    const fresh = [...after.entries()].filter(([k]) => !before.has(k)).map(([, v]) => v);
    out.push(`새로 나타난 것 ${fresh.length}개:`);
    for (const it of fresh.slice(0, 60)) out.push(fmt(it));
    out.push('지금 셀렉터가 걸리는지:');
    await hits();

    if (!chooser) {
      const add = await firstVisible(page, VIDEO_ADD);
      if (add) {
        await add.loc.click().catch(() => {});
        await page.waitForTimeout(3_000);
        out.push(`추가 버튼을 누름 → 파일창 ${chooser ? '뜸 ✅' : '안 뜸 ❌'}`);
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    out.push('(파일은 올리지 않았습니다. 제목칸·완료 버튼은 업로드 뒤에야 나타날 수 있습니다.)');
  } finally {
    page.off('filechooser', onChooser);
  }
  return out.join('\n');
}

// 글쓰기 화면에 못 들어갔을 때 왜인지를 글자로 남긴다.
//
// 블로그 홈은 프레임셋이라 바깥 페이지에는 글자도 버튼도 없다. 그래서
// postwrite 가 블로그 홈으로 튕겼을 때 덤프(report.txt)가 텅 비어
// 아무것도 알 수 없었다. 여기서는 세 가지를 본다.
//   1) 로그인 쿠키가 있는지 — 값은 읽지도 찍지도 않는다. 이름과 만료만 본다.
//   2) 프레임마다 주소와 화면 글자 앞머리
//   3) 화면에 '로그인' 링크가 보이는지
async function diagnoseEntry(page) {
  const lines = [];
  const state = { aut: false, ses: false, sessionOnly: [] };
  try {
    const cookies = await page.context().cookies(['https://nid.naver.com', 'https://blog.naver.com']);
    for (const name of ['NID_AUT', 'NID_SES']) {
      const c = cookies.find((x) => x.name === name);
      if (!c) { lines.push(`  ${name}: 없음`); continue; }
      if (name === 'NID_AUT') state.aut = true; else state.ses = true;
      if (c.expires > 0) {
        const days = Math.round((c.expires * 1000 - Date.now()) / 86_400_000);
        lines.push(`  ${name}: 있음 (약 ${days}일 남음)`);
      } else {
        state.sessionOnly.push(name);
        lines.push(`  ${name}: 있음 — 단, 브라우저를 닫으면 사라지는 쿠키`);
      }
    }
  } catch (e) {
    lines.push(`  쿠키를 읽지 못했습니다: ${e.message.split('\n')[0]}`);
  }
  let loginLink = false;
  const frames = [];
  for (const f of page.frames()) {
    const info = await f.evaluate(() => ({
      text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      buttons: document.querySelectorAll('button, a[role="button"]').length,
      login: !!document.querySelector('a[href*="nidlogin"], a[href*="nid.naver.com/nidlogin"]'),
    })).catch(() => null);
    const name = f === page.mainFrame() ? '바깥' : (f.name() || '이름없음');
    if (!info) { frames.push(`  [${name}] ${f.url().slice(0, 90)}  (읽지 못함)`); continue; }
    if (info.login) loginLink = true;
    frames.push(`  [${name}] ${f.url().slice(0, 90)}`);
    frames.push(`      버튼 ${info.buttons}개${info.login ? ' · 로그인 링크 보임' : ''} · "${info.text}"`);
  }
  const loggedIn = state.aut && state.ses;
  let verdict;
  if (!loggedIn) {
    verdict = '로그인이 풀려 있습니다. kart login 으로 다시 로그인하세요 '
      + "(로그인 창에서 '로그인 상태 유지'를 체크).";
  } else if (loginLink) {
    verdict = '쿠키는 있는데 화면에 로그인 링크가 보입니다. 네이버가 세션을 끊은 것으로 보입니다. '
      + 'kart login 으로 다시 로그인하세요.';
  } else {
    verdict = '로그인은 돼 있는데 글쓰기 화면이 안 열렸습니다. '
      + 'config.json 의 blogId 가 로그인한 계정의 블로그가 맞는지 확인하세요.';
  }
  return { loggedIn, loginLink, sessionOnly: state.sessionOnly, verdict,
    text: ['로그인 쿠키:', ...lines, '프레임:', ...frames, `판정: ${verdict}`].join('\n') };
}

// 다시 시도할 가치가 있는 실패 — 에디터가 리로드돼 내용이 날아간 부류.
// 저장 실패는 여기 넣지 않는다 (이미 저장됐을 수도 있어 다시 쓰면 초안이 중복된다).
const RETRYABLE = new Set(['editor_reloaded', 'content_lost', 'title_empty', 'image_not_attached', 'video_not_attached', 'title_mismatch', 'caption_mismatch', 'caption_box_missing', 'fill_error']);

// 제목·본문·이미지를 한 번 채우고 저장까지 한다.
async function fillOnce(page, { title, content, images = [], imagedir = '', stampBefore = null }) {
  const { root, where } = await resolveEditor(page);
  if (!root) {
    const dir = await dumpEvidence(page, null, `no-editor-${stamp()}`);
    // "에디터를 찾지 못했습니다"만으로는 무엇을 해야 할지 알 수 없다.
    // 대부분은 로그인이 풀린 것이다 — 그걸 바로 말해준다.
    const diag = await diagnoseEntry(page).catch(() => null);
    if (diag && !diag.loggedIn) {
      return { ok: false, reason: 'need_login', hint: `${diag.verdict} 증거: ${dir}` };
    }
    return { ok: false, reason: 'editor_not_found',
      hint: `에디터를 찾지 못했습니다. ${diag ? diag.verdict : ''} 증거: ${dir}` };
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
    const wantCaptions = [];
    // 스마트에디터는 마크다운을 해석하지 않는다. 그대로 치면 본문에
    // **굵게** 와 |---|---| 가 문자로 찍히므로 평문으로 바꿔서 넣는다.
    let videosInserted = 0;
    for (const rawLine of markdownToPlain(content).split('\n')) {
      const vm = rawLine.match(VIDEO_MARKER);
      if (vm) {
        // 영상은 videos/ 에서 찾는다. 사진과 폴더가 다르다.
        const vPath = path.resolve(path.join(__dirname, '..', 'videos'), vm[1]);
        if (!fs.existsSync(vPath)) {
          const dir = await dumpEvidence(page, root, `missing-video-${stamp()}`);
          return {
            ok: false,
            reason: 'video_missing',
            hint: `${vm[1]} 파일이 없습니다. kart videos 를 먼저 돌리세요. 증거: ${dir}`,
          };
        }
        try {
          await insertVideo(page, root, vPath, vm[2] || '');
        } catch (e) {
          const dir = await dumpEvidence(page, root, `video-insert-${stamp()}`);
          return { ok: false, reason: 'video_not_attached', hint: `${e.message} 증거: ${dir}` };
        }
        videosInserted += 1;
        await focusBody();
        // 영상 설명은 캡션칸이 아니라 바로 아래 문단에 적는다.
        // 영상 조각에는 사진 같은 캡션칸이 없다.
        if (vm[2]) {
          await typeGuarded(vm[2], focusBody);
          await page.keyboard.press('Enter');
        }
        continue;
      }
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
          const want = m[2].replace(/\s+/g, ' ').trim();
          wantCaptions.push(want);
          const capBox = root.locator('.se-component.se-image').last()
            .locator('.se-caption .se-text-paragraph').first();
          const ok = await typeCaption(page, root, m[2], async (txt) => {
            await typeGuarded(txt, async () => { await capBox.click({ timeout: 5_000 }).catch(() => {}); });
          });
          if (!ok) {
            const dir = await dumpEvidence(page, root, `caption-box-missing-${stamp()}`);
            return { ok: false, reason: 'caption_box_missing', hint: `사진 캡션칸을 찾지 못했습니다. 증거: ${dir}` };
          }
          await focusBody(); // 다음 문단은 다시 본문에
        } else {
          wantCaptions.push('');
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
    if (filled.videoComponents < videosInserted) {
      return fail('video_not_attached', `동영상 ${videosInserted}개를 넣었는데 ${filled.videoComponents}개만 붙었습니다.`);
    }
    // 설명이 캡션칸에 제대로 들어갔는지 (본문으로 새면 여기서 걸린다)
    const gotCaptions = filled.captions || [];
    for (let n = 0; n < wantCaptions.length; n += 1) {
      if (wantCaptions[n] && gotCaptions[n] !== wantCaptions[n]) {
        return fail('caption_mismatch',
          `${n + 1}번째 사진 설명이 캡션칸에 안 들어갔습니다. 원고: "${wantCaptions[n]}" / 캡션칸: "${gotCaptions[n] || ''}".`);
      }
    }
    // 리로드로 앞부분이 통째로 날아가는 사고를 여기서 잡는다 (예전엔 그대로 저장됐다).
    if (expectedChars && filled.bodyChars < Math.floor(expectedChars * 0.8)) {
      return fail('content_lost', `본문 ${expectedChars}자를 쳤는데 ${filled.bodyChars}자만 남아 있습니다.`);
    }
    if (nav.reloaded) {
      return fail('editor_reloaded', '타이핑 도중 에디터가 리로드됐습니다.');
    }

    // 초안을 그 자리에서 고칠 때는 임시저장 개수가 늘지 않는다.
    // 그때는 목록에 찍힌 저장 시각이 바뀌었는지로 저장 여부를 확인한다.
    const saved = await tempSave(page, root, stampBefore ? 8_000 : 20_000);
    if (!saved.ok && stampBefore) {
      const afterStamp = await readDraftStamp(page, root, title).catch(() => null);
      if (afterStamp && afterStamp !== stampBefore) {
        saved.ok = true;
        saved.how = `저장시각 ${stampBefore} → ${afterStamp}`;
      } else {
        saved.reason = 'save_not_confirmed';
        saved.hintExtra = `저장시각이 그대로입니다 (${stampBefore} → ${afterStamp || '읽기 실패'}).`;
      }
    }
    const dir = await dumpEvidence(page, root, `${saved.ok ? 'ok' : 'save-failed'}-${stamp()}`);
    if (!saved.ok) {
      return {
        ok: false,
        reason: saved.reason,
        hint: `저장을 확인하지 못했습니다 (저장버튼: "${saved.before?.text || '?'}" → "${saved.after?.text || '?'}"). ${saved.hintExtra || ''} 증거: ${dir}`,
        evidence: dir,
      };
    }
    return {
      ok: true,
      where,
      imagesInserted,
      imageComponents: filled.imageComponents,
      videosInserted,
      videoComponents: filled.videoComponents,
      captions: filled.captions,
      titleOnPage: filled.title,
      bodyChars: filled.bodyChars,
      bodyText: filled.bodyText,
      // 시험에서 '영상 제목이 네이버 쪽 칸에 들어갔는지' 보기 위한 값.
      // 실제 네이버에서는 undefined 다 (가짜 에디터만 남긴다).
      videoTitle: await page.evaluate(() => window.LAST_VIDEO_TITLE).catch(() => undefined),
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
      if (opts.reopen) {
        // 초안 수정 모드 — 새 글을 만들지 않도록 그 초안을 다시 연다
        const re = await opts.reopen();
        if (!re.ok) return { ...re, attempts: i };
      } else {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2_000);
        const { root } = await resolveEditor(page);
        if (root) {
          await dismissRecoveryPopup(root);
          await guardPopup(root);
          await clearDocument(page, root);
        }
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
  let browser; let context; let hasCookies;
  try {
    ({ browser, context, hasCookies } = await launch({ headful, record }));
  } catch (e) {
    return { ok: false, reason: 'launch_failed', hint: e.message.split('\n')[0] };
  }
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
  // 브라우저 실행 실패는 여기서 잡아 문장으로 돌려준다.
  // try 밖에 두면 playwright 스택 트레이스가 그대로 터져 나온다.
  let context;
  try {
    ({ context } = await launchPersistent({ headful, record }));
  } catch (e) {
    return { ok: false, reason: 'launch_failed', hint: e.message.split('\n')[0] };
  }
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


// ── 저장된 초안을 그 자리에서 고치기 ──────────────────────────────────
// 사진 설명을 캡션칸으로 옮기려고 글을 새로 올리면 초안이 두 배로 쌓인다.
// 그래서 저장된 초안을 열어 같은 자리에 다시 쓴다.
// 위험한 동작이다 — 엉뚱한 초안을 열면 다른 글을 덮어쓴다.
// 목록에서 제목이 정확히 일치하는 줄만 누르고, 연 다음 제목을 한 번 더 대조한다.

async function openDraftList(page, root) {
  await root.evaluate(() => {
    document.querySelector('[data-click-area*="s.count"], [class*="save_count_btn"]')?.click();
  }).catch(() => {});
  await page.waitForTimeout(2_500);
}

async function closeDraftList(page, root) {
  await root.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /닫기|close/i.test(b.getAttribute('aria-label') || b.className || ''));
    btn?.click();
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
}

// 목록에서 이 제목의 줄과 저장 시각을 읽는다. 없으면 null.
async function findDraftRow(root, title) {
  return root.evaluate((w) => {
    const re = /(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2})/;
    const norm = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('*')]
      .filter((e) => { const t = norm(e); return t.includes(w) && re.test(t) && t.length < 200; })
      .sort((a, b) => norm(a).length - norm(b).length);
    if (!rows.length) return null;
    const t = norm(rows[0]);
    return { text: t.slice(0, 120), stamp: (t.match(re) || [])[1] || null };
  }, title.replace(/\s+/g, ' ').trim());
}

// 목록을 열어 이 제목의 저장 시각만 확인하고 닫는다 (저장됐는지 판정용).
async function readDraftStamp(page, root, title) {
  await openDraftList(page, root);
  const row = await findDraftRow(root, title).catch(() => null);
  await closeDraftList(page, root);
  return row ? row.stamp : null;
}

async function openDraftByTitle(page, root, title) {
  const want = title.replace(/\s+/g, ' ').trim();
  await openDraftList(page, root);
  const clicked = await root.evaluate((w) => {
    const re = /\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/;
    const norm = (e) => (e.innerText || '').replace(/\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('*')]
      .filter((e) => { const t = norm(e); return t.includes(w) && re.test(t) && t.length < 200; })
      .sort((a, b) => norm(a).length - norm(b).length);
    if (!rows.length) return null;
    const hit = rows[0];
    (hit.querySelector('a, button') || hit.closest('a, button, li') || hit).click();
    return norm(hit).slice(0, 120);
  }, want).catch(() => null);
  if (!clicked) return { ok: false, reason: 'draft_not_found', hint: `임시저장 목록에 「${want}」 가 없습니다.` };

  await page.waitForTimeout(3_500);
  await guardPopup(root);
  // 연 글이 정말 그 글인지 대조한다. 다르면 아무것도 건드리지 않고 멈춘다.
  const st = await readDocState(root).catch(() => null);
  if (!st || st.title !== want) {
    return {
      ok: false,
      reason: 'wrong_draft_opened',
      hint: `열린 글의 제목이 다릅니다. 기대: "${want}" / 열린 글: "${st ? st.title : '읽기 실패'}". 덮어쓰지 않고 멈췄습니다.`,
    };
  }
  return { ok: true, row: clicked, before: st };
}

// 저장된 초안을 열어 같은 자리에 다시 쓴다. 새 초안을 만들지 않는다.
async function editDraftProfile({
  blogId, title, content, images = [], imagedir = '', headful = true, record = false, keepOpen = false,
}) {
  const { launchPersistent } = require('./browser');
  const { context } = await launchPersistent({ headful, record });
  const page = context.pages()[0] || (await context.newPage());
  try {
    let stampBefore = null;
    // 초안을 열고 내용을 비운다. 재시도할 때도 같은 절차를 다시 밟는다.
    const open = async () => {
      await page.goto(writeUrl(blogId), { waitUntil: 'domcontentloaded' });
      if (page.url().includes('nidlogin')) {
        return { ok: false, reason: 'need_login', hint: 'node index.js login 으로 이 프로필에 네이버 로그인을 한 번 해주세요' };
      }
      const { root } = await resolveEditor(page);
      if (!root) return { ok: false, reason: 'editor_not_found', hint: '에디터를 찾지 못했습니다.' };
      await dismissRecoveryPopup(root);
      for (let i = 0; i < 8; i += 1) {
        if (await guardPopup(root)) break;
        await page.waitForTimeout(1_000);
      }
      const opened = await openDraftByTitle(page, root, title);
      if (!opened.ok) return opened;
      const row = await (async () => { await openDraftList(page, root); const r = await findDraftRow(root, title); await closeDraftList(page, root); return r; })();
      stampBefore = row ? row.stamp : stampBefore;
      if (!(await clearDocument(page, root))) {
        return { ok: false, reason: 'clear_failed', hint: '초안 내용을 비우지 못했습니다. 덮어쓰지 않고 멈췄습니다.' };
      }
      return { ok: true };
    };

    const first = await open();
    if (!first.ok) return { ...first, saved: false, published: false };

    const r = await fillEditor(page, { title, content, images, imagedir, reopen: open, stampBefore });
    if (keepOpen) {
      console.log('\n--keep-open: 창을 열어둡니다. 확인 후 Enter.');
      await new Promise((res) => process.stdin.once('data', res));
    }
    return { ...r, saved: r.ok, published: false };
  } catch (e) {
    const dir = await dumpEvidence(page, null, `edit-error-${stamp()}`);
    return { ok: false, reason: 'error', hint: `${String(e.message).split('\n')[0]} / 증거: ${dir}` };
  } finally {
    await context.close();
  }
}

module.exports = { writePost, writePostProfile, editDraftProfile, openDraftByTitle, readDraftStamp, fillEditor, OUT_DIR, resolveEditor, dumpEvidence, writeUrl, diagnoseEntry, probeVideoLayer };
