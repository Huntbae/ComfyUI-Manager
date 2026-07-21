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

// 함정 1+3: "작성 중인 글 복구" 팝업은 팝업 내부에서만, 텍스트 정확 일치로
// "취소"를 눌러야 한다. 부분 일치로 찾으면 툴바의 "취소선"을 눌러
// 본문 전체가 취소선으로 써지는 사고가 난다.
async function dismissRecoveryPopup(page) {
  const popup = page.locator('.se-popup-container, [class*="popup"]').first();
  const cancel = popup.getByText('취소', { exact: true }); // text-is
  try {
    await cancel.click({ timeout: 5_000 });
    return true;
  } catch {
    return false; // 팝업이 안 떴으면 정상 진행
  }
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

// 임시저장: 상단 "저장" 버튼 (발행 버튼은 절대 누르지 않는다)
async function tempSave(page) {
  const save = page.locator(
    '[data-click-area="tpb.save"], button:has-text("저장")',
  ).first();
  await save.click();
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
