#!/usr/bin/env node
// 사용법:
//   node index.js cookies                # NID_AUT/NID_SES 환경변수로 쿠키 저장
//   node index.js post --blog <blogId> --title "제목" --file content.txt \
//                      [--images a.jpg,b.jpg] [--headful] [--no-record]
//
// 발행은 하지 않는다 — 임시저장까지만. 발행은 사람이 검토 후 직접 누른다.
const fs = require('fs');
const queue = require('./src/queue');
// playwright-core는 실제로 브라우저를 띄울 때만 필요하다.
// status/reset 같은 명령이 의존성 없이도 돌게 늦게 불러온다.
const browser = () => require('./src/browser');
const post = () => require('./src/post');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);
// 녹화는 기본 켜짐. --no-record 로만 끈다. (요구사항: 전 과정 녹화)
const recordOn = () => !flag('no-record');

(async () => {
  const cmd = process.argv[2];

  // 글감 자동 선정: 이번 주 유튜브에서 주제 영상을 모아 점수로 1등을 뽑는다.
  if (cmd === 'topic') {
    require('./scripts/pick-topic.js');
    return;
  }

  // 진행 기록 초기화 — 1편부터 다시 올린다. 원고·이미지는 건드리지 않는다.
  if (cmd === 'reset') {
    const n = queue.resetProgress();
    console.log(n
      ? `진행 기록을 지웠습니다 (게시 표시돼 있던 ${n}편 해제).`
      : '지울 진행 기록이 없습니다. 이미 처음 상태입니다.');
    console.log('이제 node index.js next 를 실행하면 1편부터 다시 올라갑니다.');
    console.log('※ 네이버에 이미 임시저장된 글은 지워지지 않습니다. 필요하면 직접 삭제하세요.');
    process.exit(0);
  }

  // 큐 현황
  if (cmd === 'status') {
    const st = queue.status();
    if (st.error) {
      console.error(`설정 오류: ${st.hint || st.error}`);
      process.exit(1);
    }
    console.log(`총 ${st.total}편 / 남은 ${st.remaining}편\n`);
    st.items.forEach((it, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${it.done ? '✅ 게시' : '· 대기'}  ${it.file}`);
    });
    process.exit(0);
  }

  if (cmd === 'cookies') {
    // 값은 화면에 표시되지 않게 입력받는다. (환경변수로 줘도 되지만 비권장 — 노출 위험)
    let NID_AUT = process.env.NID_AUT;
    let NID_SES = process.env.NID_SES;
    if (!NID_AUT || !NID_SES) {
      console.log('크롬 로그인 → F12 → Application → Cookies → naver.com → 필터 NID 에서 값을 복사하세요.');
      console.log('아래에 붙여넣고 Enter를 누르면 됩니다. (입력값은 화면에 표시되지 않습니다)\n');
      const { ask } = require('./src/prompt');
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
    const p = browser().saveCookies({ NID_AUT, NID_SES });
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
    const imagedir = arg('imagedir') || '';
    const images = (arg('images') || '').split(',').filter(Boolean).map((p) =>
      imagedir && !fs.existsSync(p) ? require('path').resolve(imagedir, p) : p);
    for (const img of images) {
      if (!fs.existsSync(img)) {
        console.error(`이미지 파일 없음: ${img}`);
        process.exit(1);
      }
    }
    // 기본은 프로필 방식(node index.js login으로 저장한 로그인 재사용).
    // --cookies 를 주면 예전 NID 쿠키 방식으로 동작한다.
    const { writePost, writePostProfile } = post();
    const run = flag('cookies') ? writePost : writePostProfile;
    const r = await run({
      blogId,
      title,
      content: fs.readFileSync(file, 'utf8'),
      images,
      imagedir,
      headful: flag('headful'),
      record: recordOn(),
    });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  // 프로필 로그인: 전용 크롬 프로필을 열어 네이버에 한 번만 로그인해 둔다.
  if (cmd === 'login') {
    console.log('전용 크롬 프로필을 엽니다. 창에서 네이버에 로그인하세요. (한 번만)');
    console.log('로그인이 끝나면 이 창은 자동으로 닫힙니다...');
    const { context } = await browser().launchPersistent({ headful: true });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
    try {
      // 로그인 완료(로그인 페이지를 벗어남)까지 최대 5분 대기
      await page.waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 300_000 });
      console.log('✅ 로그인 확인. 이제 node index.js next 로 자동 게시할 수 있습니다.');
    } catch {
      console.log('⏱ 시간이 초과됐습니다. 다시 시도하세요.');
    } finally {
      await context.close();
    }
    process.exit(0);
  }

  // "다음" 한 방: 다음 미게시 글을 골라 이미지 넣어 임시저장하고 진행 기록까지.
  if (cmd === 'next' || cmd === '다음') {
    const nx = queue.getNext();
    if (nx.error) {
      console.error(`설정 오류: ${nx.hint || nx.error}`);
      process.exit(1);
    }
    if (nx.done) {
      console.log(`🎉 준비된 글을 모두 게시했습니다 (총 ${nx.total}편). 새 글감을 요청하세요.`);
      process.exit(0);
    }
    console.log(`오늘의 글: 「${nx.title}」 (남은 ${nx.remaining}편)`);

    // 이미지가 없으면 post.js가 조용히 건너뛰어 글만 올라간다. 미리 막는다.
    {
      const pathMod = require('path');
      const dir = nx.config.imagedir || '';
      // [[img:파일명]] 과 [[img:파일명|설명]] 둘 다 — 파일명만 뽑는다
      const want = [...nx.body.matchAll(/\[\[\s*(?:img|image)\s*:\s*([^|\]]+?)\s*(?:\|[^\]]*)?\]\]/gi)].map((m) => m[1]);
      const missing = want.filter((n) => !fs.existsSync(dir ? pathMod.resolve(dir, n) : n));
      if (missing.length) {
        console.error(`❌ 이미지 ${missing.length}장이 없습니다: ${missing.join(', ')}`);
        console.error('   그대로 올리면 사진 없이 글만 올라갑니다. 먼저 이미지를 만드세요:');
        if (missing.some((n) => n.startsWith('hist_'))) {
          console.error('     python3 scripts/fetch_history_images.py        # 역사 사진(위키미디어 공용, 출처 자동 표기)');
        }
        console.error('     python3 scripts/rebuild_images.py              # 구글 드라이브에서 수집');
        console.error('     python3 scripts/rebuild_images.py --from-existing   # 드라이브 없이 기존 사진으로');
        process.exit(1);
      }

      // 남의 사진을 출처 없이 올리는 사고 방지.
      // fetch_history_images.py 가 캡션을 실제 저작자·라이선스로 바꿔주기 전에는 못 올린다.
      if (/\(출처 확인 전/.test(nx.body)) {
        console.error('❌ 사진 출처가 아직 채워지지 않았습니다.');
        console.error('   남의 사진을 출처 없이 올릴 수는 없습니다. 먼저 실행하세요:');
        console.error('     python3 scripts/fetch_history_images.py');
        process.exit(1);
      }
    }
    const r = await post().writePostProfile({
      blogId: nx.config.blogId,
      title: nx.title,
      content: nx.body,
      imagedir: nx.config.imagedir || '',
      headful: flag('headful'),
      record: recordOn(),
    });
    if (r.ok) {
      const count = queue.markDone(nx.file);
      console.log(`✅ 임시저장 완료 — 「${nx.title}」`);
      console.log(`   누적 ${count}편 / 남은 ${nx.remaining - 1}편`);
      console.log(`   네이버에서 확인: https://blog.naver.com/${nx.config.blogId} → 글쓰기 → 저장된 글`);
      if (r.video) {
        console.log(`   녹화: ${r.video}`);
        console.log('   프레임으로 확인: npm run frames');
      }
      process.exit(0);
    }
    console.error(`❌ 게시 실패: ${r.reason || ''} ${r.hint || ''}`);
    console.error('(실패 시 이 글은 다음에 다시 시도됩니다)');
    process.exit(1);
  }

  console.error('알 수 없는 명령입니다. status / reset / topic / login / next(다음) / cookies / post 중 하나를 사용하세요.');
  process.exit(1);
})();
