// 미리 작성된 글(articles/ 폴더)을 순서대로 하나씩 꺼내고 진행상황을 기록한다.
// config.json: { sourceDir, blogId, imagedir, imageExts }
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
// 진행 기록은 git으로 추적한다 — 맥북에서 올린 걸 아이맥이 알아야
// 같은 글을 두 번 올리지 않는다. 비밀정보가 아니라 "몇 편까지 올렸나"일 뿐이다.
const PROGRESS_PATH = path.join(ROOT, 'state', 'progress.json');
// 예전 위치(.auth/는 gitignore라 기기 간 공유가 안 됐다)
const LEGACY_PROGRESS_PATH = path.join(ROOT, '.auth', 'progress.json');
const TEXT_EXTS = ['.txt', '.md', '.markdown'];

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// 예전 기록(.auth/progress.json)이 있으면 새 위치로 한 번 옮긴다.
// 이미 올린 글을 다시 올리는 사고를 막기 위해 합집합으로 병합한다.
function migrateLegacy() {
  if (!fs.existsSync(LEGACY_PROGRESS_PATH)) return;
  const old = readJson(LEGACY_PROGRESS_PATH, { posted: [] }).posted || [];
  if (!old.length) return;
  const cur = readJson(PROGRESS_PATH, { posted: [] }).posted || [];
  const merged = [...new Set([...cur, ...old])];
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ posted: merged }, null, 2));
  try { fs.renameSync(LEGACY_PROGRESS_PATH, `${LEGACY_PROGRESS_PATH}.migrated`); } catch { /* 무시 */ }
  console.error(`(진행 기록 ${old.length}건을 state/progress.json 으로 옮겼습니다 — 이제 기기 간 공유됩니다)`);
}

function readProgress() {
  migrateLegacy();
  return readJson(PROGRESS_PATH, { posted: [] });
}

function loadConfig() {
  const c = readJson(CONFIG_PATH, {});
  // 상대경로면 프로젝트 기준으로 절대경로화 (실행 위치와 무관하게 동작)
  if (c.sourceDir && !path.isAbsolute(c.sourceDir)) c.sourceDir = path.resolve(ROOT, c.sourceDir);
  if (c.imagedir && !path.isAbsolute(c.imagedir)) c.imagedir = path.resolve(ROOT, c.imagedir);
  return c;
}

function listArticles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && TEXT_EXTS.includes(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

function getNext() {
  const config = loadConfig();
  if (!config.sourceDir || !fs.existsSync(config.sourceDir)) {
    return { done: false, error: 'no_source', hint: 'config.json의 sourceDir를 확인하세요' };
  }
  const files = listArticles(config.sourceDir);
  const posted = new Set(readProgress().posted || []);
  const file = files.find((n) => !posted.has(n));
  const remaining = files.filter((n) => !posted.has(n)).length;
  if (!file) return { done: true, total: files.length };

  const raw = fs.readFileSync(path.join(config.sourceDir, file), 'utf8').replace(/^﻿/, '');
  const nl = raw.indexOf('\n');
  const title = (nl === -1 ? raw : raw.slice(0, nl)).trim();
  const body = (nl === -1 ? '' : raw.slice(nl + 1)).replace(/^\n+/, '');
  return { done: false, file, title, body, config, remaining, total: files.length };
}

function markDone(file) {
  const progress = readProgress();
  if (!Array.isArray(progress.posted)) progress.posted = [];
  if (!progress.posted.includes(file)) progress.posted.push(file);
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  return progress.posted.length;
}

function resetProgress() {
  const before = (readProgress().posted || []).length;
  // 파일을 지우지 않고 비운다. 지우면 다른 기기에서 pull 할 때 변경이 안 보인다.
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify({ posted: [] }, null, 2));
  try { fs.unlinkSync(LEGACY_PROGRESS_PATH); } catch { /* 없으면 그만 */ }
  return before;
}

// 큐 현황: 어떤 글이 올라갔고 어떤 글이 남았는지.
function status() {
  const config = loadConfig();
  if (!config.sourceDir || !fs.existsSync(config.sourceDir)) {
    return { error: 'no_source', hint: 'config.json의 sourceDir를 확인하세요' };
  }
  const files = listArticles(config.sourceDir);
  const posted = new Set(readProgress().posted || []);
  return {
    total: files.length,
    items: files.map((n) => ({ file: n, done: posted.has(n) })),
    remaining: files.filter((n) => !posted.has(n)).length,
  };
}

module.exports = { getNext, markDone, loadConfig, resetProgress, status, PROGRESS_PATH };
