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

async function writePost({ blogId, title, content, images = [], headful = false, record = true }) {
  const { browser, context, hasCookies } = await launch({ headful, record });
  if (!hasCookies) {
    await browser.close();
    return { ok: false, reason: 'no_cookies', hint: '먼저 node index.js cookies 로 NID 쿠키를 저장하세요' };
  }
  const page = await context.newPage();
  try {
    await page.goto(writeUrl(blogId), { waitUntil: 'domcontentloaded' });
    if (page.url().includes('nidlogin')) {
      return { ok: false, reason: 'cookie_expired', hint: 'NID 쿠키가 만료되었습니다. 다시 추출해 저장하세요' };
    }

    await page.waitForSelector('.se-section-documentTitle', { timeout: 30_000 });
    await dismissRecoveryPopup(page);
    await closeHelpPanel(page); // 도움말 온보딩 패널이 떠 있으면 닫기 (함정 7)

    // 제목
    await page.locator('.se-section-documentTitle .se-text-paragraph').first().click();
    await humanType(page, title);

    // 본문 — 문단 단위로 타이핑, 문단 사이에 이미지를 순서대로 삽입
    await page.locator('.se-component.se-text .se-text-paragraph').last().click();
    const paragraphs = content.split(/\n{2,}/);
    let imgIdx = 0;
    for (let i = 0; i < paragraphs.length; i++) {
      for (const line of paragraphs[i].split('\n')) {
        await humanType(page, line);
        await page.keyboard.press('Enter');
      }
      await page.keyboard.press('Enter');
      if (imgIdx < images.length && i < paragraphs.length - 1) {
        await insertImage(page, images[imgIdx++]);
      }
    }
    // 문단 수보다 이미지가 많으면 나머지는 끝에 몰아서 삽입
    while (imgIdx < images.length) await insertImage(page, images[imgIdx++]);

    await tempSave(page);

    const video = record ? await page.video()?.path() : null;
    return { ok: true, saved: true, published: false, video };
  } finally {
    await context.close(); // 녹화 파일은 context close 시점에 저장된다
    await browser.close();
  }
}

module.exports = { writePost, OUT_DIR };
