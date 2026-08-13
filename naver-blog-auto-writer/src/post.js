// 네이버 블로그 스마트에디터 ONE 자동 글쓰기 — 가이드의 함정 6가지를 반영한 구현.
//
// 흐름: 신형 글쓰기 URL 진입 → 복구 팝업 닫기 → 제목/본문 사람 속도 타이핑
//       → 문단 사이 이미지 삽입 → 임시저장(발행 금지) → 녹화 저장
const fs = require('fs');
const path = require('path');
const { launch, OUT_DIR } = require('./browser');

// 함정 2: 구형 진입점(GoBlogWrite.naver 등)은 재로그인으로 튕긴다.
// blog.naver.com/{blogId}/postwrite 신형 주소만 바로 열린다.
const writeUrl = (blogId) => `https://blog.naver.com/${blogId}/postwrite`;

// 사람 속도 타이핑: 글자당 60~140ms 랜덤 지연 (봇 티 안 나게)
async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(60 + Math.floor(Math.random() * 80));
  }
}

// 함정 1+3: "작성 중인 글 복구" 확인 팝업(se-popup-alert-confirm)은
// 팝업 내부의 취소 버튼(.se-popup-button-cancel)만 정확히 눌러야 한다.
// (부분 일치로 찾으면 툴바의 "취소선"을 눌러 본문이 전부 취소선이 되는 사고)
// 팝업은 로드 직후 살짝 늦게 뜰 수 있어 dim 오버레이가 사라질 때까지 재확인한다.
async function dismissRecoveryPopup(page) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const dim = page.locator('.se-popup-dim');
    const popup = page
      .locator('.se-popup-alert-confirm, [data-name*="se-popup-alert"], .se-popup')
      .first();

    if (!(await popup.count().catch(() => 0)) && !(await dim.count().catch(() => 0))) {
      if (attempt === 0) {
        await page.waitForTimeout(700); // 아직 안 떴을 수 있으니 한 번 더 기다림
        continue;
      }
      return true; // 팝업 없음 = 정상 진행
    }

    // 취소 버튼(=새로 쓰기)만 정확히 클릭
    const cancelBtn = popup.locator('.se-popup-button-cancel').first();
    if (await cancelBtn.count().catch(() => 0)) {
      await cancelBtn.click({ timeout: 3_000 }).catch(() => {});
    } else {
      const byText = popup.getByText('취소', { exact: true }).first();
      if (await byText.count().catch(() => 0)) {
        await byText.click({ timeout: 3_000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(500);
    if (!(await dim.count().catch(() => 0))) return true; // 오버레이 사라짐 = 성공
  }
  return false;
}

// 이미지 삽입: 툴바 사진 버튼 → 파일 선택 다이얼로그에 파일 전달
async function insertImage(page, imagePath) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    page.locator('button[data-name="image"], .se-toolbar-item-image button').first().click(),
  ]);
  await chooser.setFiles(imagePath);
  await page.waitForTimeout(3_000); // 업로드 완료 대기
}

// 실전 함정 7: 에디터 "도움말" 패널이 저장/툴바 버튼 위를 덮어 클릭을 가로챈다.
// 저장·이미지 삽입 전에 떠 있는 도움말/온보딩 패널을 닫는다.
async function closeHelpPanel(page) {
  // 1) 알려진 닫기 버튼들 시도
  const closeSelectors = [
    '.se-help-panel-close-button',
    'button[class*="help"][class*="close"]',
    '.se-help-panel button[class*="close"]',
    'button[aria-label="닫기"]',
  ];
  for (const sel of closeSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 2_000 }).catch(() => {});
    }
  }
  // 2) 그래도 도움말 패널이 남아 있으면 ESC로 닫기 시도
  if (await page.locator('.se-help-title').count().catch(() => 0)) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

// 임시저장: 상단 "저장" 버튼 (발행 버튼은 절대 누르지 않는다)
async function tempSave(page) {
  await closeHelpPanel(page); // 오버레이 먼저 제거
  const save = page.locator(
    '[data-click-area="tpb.save"], button.save_btn__bzc5B, button:has-text("저장")',
  ).first();
  try {
    await save.click({ timeout: 10_000 });
  } catch {
    // 오버레이가 여전히 가로채면, 정확히 resolve된 저장 버튼에 강제 클릭
    await save.click({ force: true, timeout: 10_000 });
  }
  await page.waitForTimeout(2_000);
}

// 본문 안의 이미지 마커: 한 줄이 [[img:파일명]] 또는 [[img:파일명|설명]] 이면
// 그 위치(문맥)에 이미지를 넣고, 설명이 있으면 사진 바로 아래 한 줄로 적는다.
// imagedir 기준으로 파일을 찾는다.
const IMG_MARKER = /^\s*\[\[\s*(?:img|image)\s*:\s*([^|\]]+?)\s*(?:\|\s*(.+?)\s*)?\]\]\s*$/i;

// 에디터에 제목·본문·이미지를 채우고 임시저장한다 (브라우저 진입 이후 공통 로직).
async function fillEditor(page, { title, content, images = [], imagedir = '' }) {
  await page.waitForSelector('.se-section-documentTitle', { timeout: 30_000 });
  await dismissRecoveryPopup(page);
  await closeHelpPanel(page); // 도움말 온보딩 패널 닫기 (함정 7)

  await page.locator('.se-section-documentTitle .se-text-paragraph').first().click();
  await humanType(page, title);

  // 본문 — [[img:파일]] 마커는 그 위치(문맥)에 이미지 삽입, 그 외는 타이핑
  await page.locator('.se-component.se-text .se-text-paragraph').last().click();
  const usedMarkers = new Set();
  for (const rawLine of content.split('\n')) {
    const m = rawLine.match(IMG_MARKER);
    if (m) {
      const imgPath = imagedir ? path.resolve(imagedir, m[1]) : m[1];
      if (fs.existsSync(imgPath)) {
        await insertImage(page, imgPath);
        usedMarkers.add(path.basename(imgPath));
        // 사진 아래 설명 한 줄. 네이버 캡션 입력창은 자동화가 불안정해
        // 본문 문단으로 넣는다 — 블로그에서 흔한 형태이고 읽는 데도 문제없다.
        if (m[2]) {
          await humanType(page, m[2]);
          await page.keyboard.press('Enter');
        }
      }
      continue;
    }
    await humanType(page, rawLine);
    await page.keyboard.press('Enter');
  }
  for (const img of images) {
    if (!usedMarkers.has(path.basename(img)) && fs.existsSync(img)) {
      await insertImage(page, img);
    }
  }
  await tempSave(page);
}

// 방식 A: NID 쿠키 사용 (구버전 호환)
async function writePost({
  blogId, title, content, images = [], imagedir = '', headful = false, record = true,
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
    await fillEditor(page, { title, content, images, imagedir });
    const video = record ? await page.video()?.path() : null;
    return { ok: true, saved: true, published: false, video };
  } finally {
    await context.close();
    await browser.close();
  }
}

// 방식 B(권장): 로그인된 전용 크롬 프로필 재사용 — 쿠키 추출 불필요.
// 프로필에 네이버 로그인이 안 돼 있으면, headful일 때 사람이 로그인할 때까지 대기.
async function writePostProfile({
  blogId, title, content, images = [], imagedir = '', headful = false, record = true,
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
      // 사람이 직접 로그인할 때까지 대기 (최대 3분)
      await page.waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 180_000 });
      await page.goto(writeUrl(blogId), { waitUntil: 'domcontentloaded' });
    }
    await fillEditor(page, { title, content, images, imagedir });
    // 녹화 파일 경로는 context.close() 뒤에 실제로 기록된다. 경로는 미리 받아둔다.
    let video = null;
    if (record) {
      try { video = (await page.video()?.path()) || null; } catch { video = null; }
    }
    return { ok: true, saved: true, published: false, video };
  } catch (e) {
    return { ok: false, reason: 'error', hint: e.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

module.exports = { writePost, writePostProfile, OUT_DIR };
