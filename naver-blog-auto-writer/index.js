#!/usr/bin/env node
// 사용법:
//   node index.js cookies                # NID_AUT/NID_SES 환경변수로 쿠키 저장
//   node index.js post --blog <blogId> --title "제목" --file content.txt \
//                      [--images a.jpg,b.jpg] [--headful] [--no-record]
//
// 발행은 하지 않는다 — 임시저장까지만. 발행은 사람이 검토 후 직접 누른다.
const fs = require('fs');
const { saveCookies, COOKIE_PATH } = require('./src/browser');
const { writePost } = require('./src/post');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

(async () => {
  const cmd = process.argv[2];

  if (cmd === 'cookies') {
    const { NID_AUT, NID_SES } = process.env;
    if (!NID_AUT || !NID_SES) {
      console.error('NID_AUT / NID_SES 환경변수를 설정하세요.');
      console.error('추출법: 크롬 로그인 → F12 → Application → Cookies → naver.com → 필터에 NID');
      process.exit(1);
    }
    const p = saveCookies({ NID_AUT, NID_SES });
    console.log(`쿠키 저장 완료: ${p} (이 파일은 아이디+비번급 민감정보입니다. 공개 금지)`);
    process.exit(0);
  }

  if (cmd === 'post') {
    const blogId = arg('blog');
    const title = arg('title');
    const file = arg('file');
    if (!blogId || !title || !file) {
      console.error('필수 인자: --blog <blogId> --title "제목" --file <본문파일>');
      process.exit(1);
    }
    const images = (arg('images') || '').split(',').filter(Boolean);
    for (const img of images) {
      if (!fs.existsSync(img)) {
        console.error(`이미지 파일 없음: ${img}`);
        process.exit(1);
      }
    }
    const r = await writePost({
      blogId,
      title,
      content: fs.readFileSync(file, 'utf8'),
      images,
      headful: flag('headful'),
      record: !flag('no-record'),
    });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  console.error('알 수 없는 명령입니다. cookies 또는 post를 사용하세요.');
  process.exit(1);
})();
