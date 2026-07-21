// 시스템 크로미움 구동 + NID 쿠키 주입 + (옵션) 전 과정 영상 녹화.
//
// 가이드 기준 인증 방식: 비밀번호 로그인이 아니라 NID_AUT/NID_SES 쿠키 재사용.
// 쿠키는 .auth/cookies.json(.gitignore 경로)에 보관한다.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { findChromium } = require('./chromium-path');

const COOKIE_PATH = process.env.NAVER_COOKIE_PATH || path.join(__dirname, '..', '.auth', 'cookies.json');
const OUT_DIR = path.join(__dirname, '..', 'out');

// 함정 4: domain/path가 빠지면 "domain/path pair" 에러로 쿠키 전체가 안 들어간다.
// 모든 쿠키에 domain='.naver.com', path='/'를 명시해 저장한다.
function buildCookies({ NID_AUT, NID_SES }) {
  const clean = (v) => String(v).replace(/\s+/g, ''); // 붙여넣기 시 딸려온 공백/개행 제거
  return ['NID_AUT', 'NID_SES'].map((name) => ({
    name,
    value: name === 'NID_AUT' ? clean(NID_AUT) : clean(NID_SES),
    domain: '.naver.com',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'None',
  }));
}

function saveCookies(values) {
  fs.mkdirSync(path.dirname(COOKIE_PATH), { recursive: true });
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(buildCookies(values), null, 2));
  return COOKIE_PATH;
}

function loadCookies() {
  if (!fs.existsSync(COOKIE_PATH)) return null;
  return JSON.parse(fs.readFileSync(COOKIE_PATH, 'utf8'));
}

async function launch({ headful = false, record = false } = {}) {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    headless: !headful,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    // 함정 5: 녹화는 playwright 번들 ffmpeg가 필요. 없으면 시스템 ffmpeg를
    // 심볼릭 링크로 연결할 것 (README 참고).
    ...(record ? { recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 900 } } } : {}),
  });

  const cookies = loadCookies();
  if (cookies) {
    // 하나라도 형식이 틀리면 전체 실패하므로 하나씩 넣어 범인을 특정한다 (함정 4)
    for (const c of cookies) {
      try {
        await context.addCookies([c]);
      } catch (e) {
        throw new Error(`쿠키 ${c.name} 주입 실패: ${e.message}`);
      }
    }
  }
  return { browser, context, hasCookies: !!cookies };
}

// 로그인된 전용 크롬 프로필을 재사용하는 persistent 컨텍스트.
// 이 프로필에 네이버 로그인을 한 번 해두면 이후 로그인 상태가 유지된다.
const PROFILE_DIR = process.env.NAVER_PROFILE_DIR || path.join(__dirname, '..', '.chrome-profile');

async function launchPersistent({ headful = false, record = false } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: findChromium(),
    headless: !headful,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    ...(record ? { recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 900 } } } : {}),
  });
  return { context, profileDir: PROFILE_DIR };
}

module.exports = { launch, launchPersistent, saveCookies, loadCookies, COOKIE_PATH, OUT_DIR, PROFILE_DIR };
