#!/usr/bin/env node
// 함정 6: 스크린샷 한 장으로는 "언제부터 꼬였는지" 알 수 없다.
// 녹화를 몇 초 간격으로 잘라 눈으로 훑으면 문제 지점이 바로 보인다.
//
//   node scripts/inspect-video.js              # 최근 녹화를 2초 간격으로 자름
//   node scripts/inspect-video.js --every 1    # 1초 간격
//   node scripts/inspect-video.js --file out/xxx.webm
//
// 결과: out/frames/<영상이름>/frame_0001.png ...  + 컨택트시트 1장

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// 시스템 ffmpeg를 쓴다. link-ffmpeg.js가 건 심볼릭 링크도 후보에 넣는다.
function ffmpegBin() {
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  try {
    const w = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim().split('\n')[0];
    if (w) candidates.unshift(w);
  } catch {
    /* 무시 */
  }
  const found = candidates.find((c) => {
    try {
      return fs.statSync(c).isFile();
    } catch {
      return false;
    }
  });
  if (!found) {
    console.error('❌ ffmpeg를 찾지 못했습니다. brew install ffmpeg 후 다시 실행하세요.');
    process.exit(1);
  }
  return found;
}

function latestVideo() {
  if (!fs.existsSync(OUT)) return null;
  const vids = fs
    .readdirSync(OUT)
    .filter((f) => /\.(webm|mp4)$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return vids.length ? path.join(OUT, vids[0].f) : null;
}

function main() {
  const every = Number(arg('every', '2'));
  const file = arg('file') || latestVideo();

  if (!file) {
    console.error('❌ out/ 에 녹화 파일이 없습니다.');
    console.error('   녹화는 기본으로 켜져 있습니다. --no-record 로 껐다면 빼고 다시 실행하세요.');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`❌ 파일이 없습니다: ${file}`);
    process.exit(1);
  }

  const ff = ffmpegBin();
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  const dir = path.join(OUT, 'frames', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // fps=1/N → N초에 한 장
  execFileSync(ff, [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-vf', `fps=1/${every},scale=640:-1`,
    path.join(dir, 'frame_%04d.png'),
  ]);

  const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  if (!frames.length) {
    console.error('❌ 프레임을 뽑지 못했습니다. 영상이 비어 있을 수 있습니다.');
    process.exit(1);
  }

  // 한눈에 보는 컨택트시트 (4열)
  const sheet = path.join(OUT, 'frames', `${name}_sheet.png`);
  try {
    execFileSync(ff, [
      '-hide_banner', '-loglevel', 'error',
      '-i', path.join(dir, 'frame_%04d.png'),
      '-vf', 'scale=320:-1,tile=4x' + Math.ceil(frames.length / 4),
      '-frames:v', '1', '-y', sheet,
    ]);
  } catch {
    /* 컨택트시트는 실패해도 개별 프레임이 있으니 넘어간다 */
  }

  console.log(`영상   : ${file}`);
  console.log(`간격   : ${every}초`);
  console.log(`프레임 : ${frames.length}장 → ${dir}`);
  if (fs.existsSync(sheet)) console.log(`요약본 : ${sheet}`);
  console.log('\n프레임을 순서대로 넘겨 보면 어느 단계에서 꼬였는지 바로 보입니다.');
  console.log(`열기: open "${dir}"`);
}

main();
