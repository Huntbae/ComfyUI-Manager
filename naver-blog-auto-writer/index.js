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
const { ask } = require('./src/prompt');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

(async () => {
  const cmd = process.argv[2];

  if (cmd === 'cookies') {
    // 값은 화면에 표시되지 않게 입력받는다. (환경변수로 줘도 되지만 비권장 — 노출 위험)
    let NID_AUT = process.env.NID_AUT;
    let NID_SES = process.env.NID_SES;
    if (!NID_AUT || !NID_SES) {
      console.log('크롬 로그인 → F12 → Application → Cookies → naver.com → 필터 NID 에서 값을 복사하세요.');
      console.log('아래에 붙여넣고 Enter를 누르면 됩니다. (입력값은 화면에 표시되지 않습니다)\n');
      NID_AUT = await ask('NID_AUT 붙여넣기 후 Enter: ', { hidden: true });
      NID_SES = await ask('NID_SES 붙여넣기 후 Enter: ', { hidden: true });
    }
    if (!NID_AUT || !NID_SES) {
      console.error('값이 비었습니다. 다시 실행하세요.');
      process.exit(1);
    }
    if (NID_AUT.length < 20 || NID_SES.length < 20) {
      console.error(`값이 너무 짧습니다 (AUT ${NID_AUT.length}자, SES ${NID_SES.length}자). 예시 문구가 아니라 실제 쿠키 값인지 확인하세요.`);
      process.exit(1);
    }
    const p = saveCookies({ NID_AUT, NID_SES });
    console.log(`\n쿠키 저장 완료: ${p}`);
    console.log(`저장된 길이: NID_AUT ${NID_AUT.length}자 / NID_SES ${NID_SES.length}자`);
    console.log('이 파일은 아이디+비번급 민감정보입니다. 공개 금지.');
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
