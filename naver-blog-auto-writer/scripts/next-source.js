// "다음" 워크플로 1단계: 아직 안 올린 다음 자료 파일과 폴더 내 이미지 목록을 알려준다.
// 아무것도 게시 처리하지 않는다 (게시 성공 후 mark-done.js로 기록).
//
// 설정: config.json { "sourceDir": "...", "blogId": "...", "imageExts": [...] }
// 진행상황: .auth/progress.json { "posted": ["파일명", ...] }
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const PROGRESS_PATH = path.join(ROOT, '.auth', 'progress.json');

const TEXT_EXTS = ['.txt', '.md', '.markdown'];
const DEFAULT_IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function main() {
  const config = readJson(CONFIG_PATH, null);
  if (!config || !config.sourceDir) {
    console.log(JSON.stringify({
      ok: false,
      reason: 'no_config',
      hint: 'config.json에 { "sourceDir": "클랜헌트 폴더 경로", "blogId": "edukart" } 를 설정하세요',
    }, null, 2));
    return;
  }
  const dir = config.sourceDir;
  if (!fs.existsSync(dir)) {
    console.log(JSON.stringify({ ok: false, reason: 'dir_not_found', dir }, null, 2));
    return;
  }
  const imgExts = config.imageExts || DEFAULT_IMG_EXTS;
  const progress = readJson(PROGRESS_PATH, { posted: [] });
  const postedSet = new Set(progress.posted || []);

  const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
  const textFiles = entries
    .map((e) => e.name)
    .filter((n) => TEXT_EXTS.includes(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ko')); // 이름 순 = 게시 순서

  const images = entries
    .map((e) => e.name)
    .filter((n) => imgExts.includes(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'ko'));

  const next = textFiles.find((n) => !postedSet.has(n));
  if (!next) {
    console.log(JSON.stringify({
      ok: true, done: true, message: '모든 자료를 게시했습니다.',
      total: textFiles.length, posted: postedSet.size,
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    done: false,
    blogId: config.blogId || null,
    sourceDir: dir,
    file: next,
    filePath: path.join(dir, next),
    text: fs.readFileSync(path.join(dir, next), 'utf8'),
    images,                       // 폴더 내 이미지 파일명 (문맥에 맞게 골라 [[img:파일명]]으로 배치)
    remaining: textFiles.filter((n) => !postedSet.has(n)).length,
    total: textFiles.length,
  }, null, 2));
}

main();
