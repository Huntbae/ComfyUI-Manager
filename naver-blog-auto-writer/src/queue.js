// 미리 작성된 글(articles/ 폴더)을 순서대로 하나씩 꺼내고 진행상황을 기록한다.
// config.json: { sourceDir, blogId, imagedir, imageExts }
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const PROGRESS_PATH = path.join(ROOT, '.auth', 'progress.json');
const TEXT_EXTS = ['.txt', '.md', '.markdown'];

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
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
  const posted = new Set((readJson(PROGRESS_PATH, { posted: [] }).posted) || []);
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
  const progress = readJson(PROGRESS_PATH, { posted: [] });
  if (!Array.isArray(progress.posted)) progress.posted = [];
  if (!progress.posted.includes(file)) progress.posted.push(file);
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  return progress.posted.length;
}

module.exports = { getNext, markDone, loadConfig };
