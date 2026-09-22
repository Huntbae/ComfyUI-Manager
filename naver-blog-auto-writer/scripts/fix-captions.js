// 저장된 초안을 그 자리에서 고친다 — 사진 설명을 본문 문단이 아니라
// 사진 자체의 캡션칸으로 옮긴다. 사진 파일은 그대로 두고 박스도 두르지 않는다.
//
// 새 글을 올리지 않으므로 초안이 중복되지 않는다.
// 엉뚱한 초안을 덮어쓰지 않도록, 목록에서 제목이 정확히 일치하는 줄만 열고
// 연 다음 제목을 한 번 더 대조한다. 다르면 아무것도 쓰지 않고 멈춘다.
//
//   node scripts/fix-captions.js            # 전체
//   node scripts/fix-captions.js 1          # 1편만
//   node scripts/fix-captions.js 3 10       # 3~10편
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { editDraftProfile } = require(path.join(ROOT, 'src/post'));

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const srcDir = path.resolve(ROOT, config.sourceDir);
const imagedir = path.resolve(ROOT, config.imagedir);
const files = fs.readdirSync(srcDir).filter((f) => /\.(txt|md)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, 'ko'));

const from = Number(process.argv[2] || 1);
const to = Number(process.argv[3] || process.argv[2] || files.length);
const targets = files.slice(from - 1, to);

(async () => {
  let done = 0;
  for (const [i, file] of targets.entries()) {
    const raw = fs.readFileSync(path.join(srcDir, file), 'utf8');
    const nl = raw.indexOf('\n');
    const title = (nl === -1 ? raw : raw.slice(0, nl)).trim();
    const content = nl === -1 ? '' : raw.slice(nl + 1).trim();
    const n = from + i;
    console.log(`\n════ ${n}/${files.length}  ${file} ════`);
    const r = await editDraftProfile({
      blogId: config.blogId, title, content, imagedir, headful: true, record: true,
    });
    if (r.ok) {
      done += 1;
      console.log(`✅ 고침 — "${r.titleOnPage}"`);
      console.log(`   사진 ${r.imageComponents}장 / 캡션 ${JSON.stringify(r.captions || [])}`);
      console.log(`   저장 확인: ${r.verifiedBy}`);
    } else {
      console.log(`❌ ${r.reason}`);
      console.log(`   ${r.hint || ''}`);
      console.log(`   여기서 멈춥니다 (${done}편 고침).`);
      process.exit(1);
    }
  }
  console.log(`\n═══ ${done}편 전부 고쳤습니다 ═══`);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
