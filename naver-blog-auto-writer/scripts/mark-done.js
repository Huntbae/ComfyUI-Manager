// "다음" 워크플로 마지막 단계: 방금 게시(임시저장)에 성공한 자료 파일을
// 진행상황에 기록해 다음 실행 때 건너뛰게 한다.
//   node scripts/mark-done.js "자료파일명.txt"
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROGRESS_PATH = path.join(ROOT, '.auth', 'progress.json');

const name = process.argv[2];
if (!name) {
  console.error('사용법: node scripts/mark-done.js "자료파일명"');
  process.exit(1);
}

let progress = { posted: [] };
try { progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')); } catch {}
if (!Array.isArray(progress.posted)) progress.posted = [];
if (!progress.posted.includes(name)) progress.posted.push(name);

fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
console.log(`기록 완료: "${name}" (누적 ${progress.posted.length}편)`);
