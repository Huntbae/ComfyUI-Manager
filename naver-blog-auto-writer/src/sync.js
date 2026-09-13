// 기기 간 진행 기록 동기화.
//
// 맥북·아이맥 어디서 실행하든 "몇 편까지 올렸는지"가 같아야 한다.
// 둘을 잇는 통로는 이미 git 하나뿐이므로 state/progress.json 만 좁게 주고받는다.
// 원고·이미지·코드는 건드리지 않는다 — 사용자의 다른 작업을 밀어내면 안 된다.
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOCAL_PROGRESS = path.join(ROOT, 'state', 'progress.json');

// git 명령은 항상 리포 루트에서 돌린다.
// git add 의 경로는 현재 디렉터리 기준이라, 루트 기준 경로를 하위 폴더에서 주면 어긋난다.
let _root = null;
function repoRoot() {
  if (_root) return _root;
  _root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30_000,
  }).trim();
  return _root;
}

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, ...opts,
  }).trim();
}

// 리포 루트 기준 경로. 이 폴더가 리포 루트든 하위 폴더든 맞게 나온다.
function tracked() {
  return path.relative(repoRoot(), LOCAL_PROGRESS).split(path.sep).join('/');
}

function inRepo() {
  try { repoRoot(); return true; } catch { return false; }
}

function branch() {
  try { return git(['rev-parse', '--abbrev-ref', 'HEAD']); } catch { return null; }
}

// 올리기 전에 다른 기기가 올린 기록을 받아온다.
// 이게 없으면 아이맥이 1편부터 다시 올려 네이버에 중복이 쌓인다.
function pullProgress() {
  if (!inRepo()) return { ok: false, reason: 'not_a_repo' };
  const br = branch();
  if (!br || br === 'HEAD') return { ok: false, reason: 'detached' };
  try {
    git(['fetch', 'origin', br]);
  } catch (e) {
    return { ok: false, reason: 'fetch_failed', detail: e.message.split('\n')[0] };
  }
  // 진행 기록만 원격 것으로 맞춘다. 작업 중인 다른 파일은 그대로 둔다.
  try {
    const remote = git(['show', `origin/${br}:${tracked()}`]);
    const fs = require('fs');
    const local = LOCAL_PROGRESS;
    const cur = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : '{"posted":[]}';
    const merged = [...new Set([
      ...(JSON.parse(cur).posted || []),
      ...(JSON.parse(remote).posted || []),
    ])];
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, JSON.stringify({ posted: merged }, null, 2));
    return { ok: true, count: merged.length };
  } catch {
    // 원격에 아직 파일이 없으면(첫 실행) 그냥 진행한다
    return { ok: true, count: null, note: 'remote_empty' };
  }
}

// 올린 뒤 기록을 원격에 남긴다. 실패해도 게시 자체는 성공이므로 경고만 한다.
function pushProgress(message) {
  if (!inRepo()) return { ok: false, reason: 'not_a_repo' };
  const br = branch();
  if (!br || br === 'HEAD') return { ok: false, reason: 'detached' };
  try {
    const rel = tracked();
    git(['add', '--', rel]);
    // 변경이 없으면 커밋하지 않는다
    try { git(['diff', '--cached', '--quiet', '--', rel]); return { ok: true, note: 'no_change' }; }
    catch { /* 변경 있음 — 계속 */ }
    // --only: 다른 파일이 스테이지에 있어도 이 파일만 커밋한다
    git(['commit', '-m', message, '--only', '--', rel]);
  } catch (e) {
    return { ok: false, reason: 'commit_failed', detail: e.message.split('\n')[0] };
  }
  try {
    git(['push', 'origin', br]);
    return { ok: true, branch: br };
  } catch {
    // 다른 기기가 먼저 올렸으면 한 번 rebase 후 재시도
    try {
      git(['pull', '--rebase', 'origin', br]);
      git(['push', 'origin', br]);
      return { ok: true, branch: br, note: 'rebased' };
    } catch (e2) {
      return { ok: false, reason: 'push_failed', detail: e2.message.split('\n')[0] };
    }
  }
}

module.exports = { pullProgress, pushProgress, inRepo, branch };
