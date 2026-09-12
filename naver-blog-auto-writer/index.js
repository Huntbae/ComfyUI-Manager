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
// 창을 띄우는 게 기본. 헤드리스는 네이버에서 조용히 막히는 경우가 있어
// 눈으로 볼 수 있는 쪽을 기본값으로 둔다. 끄려면 --headless.
const headfulOn = () => !flag('headless');

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
    if (!flag('no-sync')) {
      const p = require('./src/sync').pushProgress('진행 기록 초기화');
      if (p.ok) console.log('초기화를 다른 기기와 공유했습니다.');
    }
    console.log('※ 네이버에 이미 임시저장된 글은 지워지지 않습니다. 필요하면 직접 삭제하세요.');
    process.exit(0);
  }

  // 큐 현황
  if (cmd === 'status') {
    if (!flag('no-sync')) require('./src/sync').pullProgress();
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
      headful: headfulOn(),
      record: recordOn(),
    });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }

  // 프로필 로그인: 전용 크롬 프로필을 열어 네이버에 한 번만 로그인해 둔다.
  if (cmd === 'login') {
    const cfg = queue.loadConfig();
    const { resolveEditor, writeUrl, dumpEvidence } = post();
    console.log('전용 크롬 프로필을 엽니다. 창에서 네이버에 로그인하세요. (이 기기에서 한 번만)');
    console.log('로그인이 끝나면 글쓰기 화면까지 열어 실제로 되는지 확인한 뒤 창을 닫습니다...');
    let context;
    try {
      ({ context } = await browser().launchPersistent({ headful: headfulOn() }));
    } catch (e) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
    const page = context.pages()[0] || (await context.newPage());
    let code = 1;
    try {
      await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
      // 로그인 페이지를 벗어날 때까지 최대 5분 대기
      await page.waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 300_000 });

      // 여기서 끝내면 안 된다. 로그인 페이지를 벗어난 것만으로는 로그인됐다는 증거가 아니다
      // (오류 페이지로 튕겨도 URL은 바뀐다). 실제로 쓸 화면을 열어 확인한다.
      console.log('글쓰기 화면을 확인하는 중...');
      await page.goto(writeUrl(cfg.blogId), { waitUntil: 'domcontentloaded' });
      if (page.url().includes('nidlogin')) {
        console.error('❌ 아직 로그인되지 않았습니다. 다시 시도하세요.');
      } else {
        const { root, where } = await resolveEditor(page);
        if (root) {
          console.log(`✅ 로그인 확인 — 글쓰기 화면이 열립니다 (에디터: ${where}).`);
          console.log('   이제 kart next 로 임시저장할 수 있습니다.');
          code = 0;
        } else {
          const dir = await dumpEvidence(page, null, `login-no-editor-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
          console.error('❌ 로그인은 된 것 같은데 글쓰기 화면이 안 열립니다.');
          console.error(`   blogId가 "${cfg.blogId}" 가 맞는지 config.json 을 확인하세요.`);
          console.error(`   증거: ${dir}`);
        }
      }
    } catch (e) {
      console.error(`⏱ 실패: ${e.message.split('\n')[0]}`);
      console.error('   5분 안에 로그인을 마쳐야 합니다. 다시 시도하세요.');
    } finally {
      await context.close();
    }
    process.exit(code);
  }

  // 미리보기: 네이버에 실제로 찍힐 모양을 터미널에서 본다. 브라우저를 띄우지 않는다.
  // 올리고 나서 "이게 아닌데" 하는 것보다 먼저 보는 게 낫다.
  if (cmd === 'preview') {
    const { markdownToPlain } = require('./src/format');
    const nx = queue.getNext();
    if (nx.error) { console.error(`설정 오류: ${nx.hint || nx.error}`); process.exit(1); }
    if (nx.done) { console.log(`준비된 글을 모두 게시했습니다 (총 ${nx.total}편).`); process.exit(0); }
    const pathMod = require('path');
    const dir = nx.config.imagedir || '';
    console.log('━'.repeat(60));
    console.log(`제목:  ${nx.title}`);
    console.log('━'.repeat(60));
    for (const line of markdownToPlain(nx.body).split('\n')) {
      const m = line.match(/^\s*\[\[\s*(?:img|image)\s*:\s*([^|\]]+?)\s*(?:\|\s*(.+?)\s*)?\]\]\s*$/i);
      if (m) {
        const p2 = dir ? pathMod.resolve(dir, m[1]) : m[1];
        const mark = fs.existsSync(p2) ? '🖼' : '❌없음';
        console.log(`\n  ${mark} [사진] ${m[1]}`);
        if (m[2]) console.log(`     ${m[2]}`);
        console.log('');
        continue;
      }
      console.log(line);
    }
    console.log('━'.repeat(60));
    console.log(`파일: ${nx.file} / 남은 ${nx.remaining}편`);
    console.log('이대로 올리려면: kart next');
    process.exit(0);
  }

  // 진단: 글을 쓰지 않고 에디터에 들어가 구조만 덤프한다.
  // 셀렉터가 안 맞을 때 뭘 고쳐야 하는지 알려면 실제 DOM이 필요하다.
  if (cmd === 'doctor') {
    const { loadConfig } = queue;
    const cfg = loadConfig();
    const { launchPersistent } = require('./src/browser');
    const { resolveEditor, dumpEvidence, writeUrl } = post();
    const { context } = await launchPersistent({ headful: headfulOn(), record: false });
    const page = context.pages()[0] || (await context.newPage());
    try {
      console.log(`글쓰기 화면 진입: ${writeUrl(cfg.blogId)}`);
      await page.goto(writeUrl(cfg.blogId), { waitUntil: 'domcontentloaded' });
      if (page.url().includes('nidlogin')) {
        console.error('❌ 로그인이 안 돼 있습니다. node index.js login 을 먼저 하세요.');
        process.exitCode = 1;
        return;
      }
      const { root, where } = await resolveEditor(page);
      console.log(`에디터 위치: ${where}`);
      const dir = await dumpEvidence(page, root, `doctor-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
      console.log(`\n덤프 완료: ${dir}`);
      console.log('  screen.png   화면 스크린샷');
      console.log('  report.txt   화면 텍스트 + 버튼 목록 (셀렉터 수정용)');
      console.log('  page.html    전체 HTML');
      console.log('\nreport.txt 를 보내주시면 어떤 셀렉터가 틀렸는지 잡겠습니다.');
    } finally {
      await context.close();
    }
    return;
  }

  // "다음" 한 방: 다음 미게시 글을 골라 이미지 넣어 임시저장하고 진행 기록까지.
  if (cmd === 'next' || cmd === '다음') {
    // 다른 기기가 올린 기록을 먼저 받아온다.
    // 이게 없으면 맥북에서 3편까지 올린 걸 아이맥이 모르고 1편부터 다시 올린다.
    if (!flag('no-sync')) {
      const sync = require('./src/sync');
      const r = sync.pullProgress();
      if (r.ok && r.count !== null) console.log(`진행 기록 동기화: ${r.count}편 게시됨`);
      else if (!r.ok) console.log(`(진행 기록 동기화 건너뜀: ${r.reason} — 이 기기만의 기록으로 진행합니다)`);
    }
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
      headful: headfulOn(),
      record: recordOn(),
      keepOpen: flag('keep-open'),
    });
    if (r.ok) {
      // 저장이 확인된 경우에만 게시 표시를 남긴다.
      // 예전엔 확인 없이 표시해서, 네이버에 글이 없는데 올라간 걸로 처리됐다.
      const count = queue.markDone(nx.file);
      console.log(`✅ 임시저장 확인 — 「${nx.title}」`);
      console.log(`   제목 확인: "${r.titleOnPage || ''}"`);
      console.log(`   사진 ${r.imagesInserted ?? 0}장 삽입 / 본문에 ${r.imageComponents ?? 0}장 붙음`);
      console.log(`   저장 확인 방법: ${r.verifiedBy === 'count' ? '임시저장 개수 증가' : '저장 완료 안내 확인'}`);
      console.log(`   누적 ${count}편 / 남은 ${nx.remaining - 1}편`);
      console.log(`   네이버에서 확인: https://blog.naver.com/${nx.config.blogId} → 글쓰기 → 저장된 글`);
      if (r.evidence) console.log(`   증거(화면·본문): ${r.evidence}`);
      if (r.video) console.log(`   녹화: ${r.video}  (npm run frames 로 프레임 확인)`);
      // 다른 기기가 같은 글을 다시 올리지 않도록 기록을 공유한다.
      if (!flag('no-sync')) {
        const sync = require('./src/sync');
        const p = sync.pushProgress(`게시 기록: ${nx.file}`);
        if (p.ok && p.note !== 'no_change') console.log('   진행 기록을 다른 기기와 공유했습니다.');
        else if (!p.ok) console.log(`   ⚠ 진행 기록 공유 실패(${p.reason}) — 다른 기기에서 이 글이 다시 올라갈 수 있습니다.`);
      }
      process.exit(0);
    }
    console.error(`❌ 실패: ${r.reason || ''}`);
    if (r.hint) console.error(`   ${r.hint}`);
    console.error('   진행 기록을 남기지 않았습니다 — 이 글은 다음에 다시 시도됩니다.');
    if (r.evidence || (r.hint || '').includes('증거')) {
      console.error('   증거 폴더의 report.txt 와 screen.png 를 보내주시면 원인을 잡겠습니다.');
    }
    process.exit(1);
  }

  console.error('알 수 없는 명령입니다. status / reset / preview / topic / login / doctor / next(다음) / cookies / post 중 하나를 사용하세요.');
  process.exit(1);
})();
