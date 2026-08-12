#!/usr/bin/env node
// 글감 자동 선정 — 이번 주 유튜브에서 내 주제 영상을 모아 점수로 줄 세우고 1등을 글감으로 뽑는다.
//
//   export YOUTUBE_API_KEY="..."          # 키는 환경변수로만. 명령줄에 쓰지 말 것
//   node scripts/pick-topic.js            # 선정 + 근거 파일 기록
//   node scripts/pick-topic.js --days 14  # 기간 조정 (기본 7일)
//   node scripts/pick-topic.js --dry-run  # 파일 쓰지 않고 결과만 출력
//
// 설정은 config.json 의 topicPicker 를 읽는다.
//   queries      : 검색할 주제어 목록
//   signalWords  : 제목에 들어가면 가점을 주는 신호어
//   maxPerQuery  : 주제어당 최대 수집 수
//
// 점수(0~100, 근거를 남기기 위해 단순하게 유지)
//   조회수 60점  = 60 × log10(조회수+1) / log10(최대조회수+1)
//   신호어 30점  = 겹치는 신호어 개수 × 10 (최대 30)
//   신선도 10점  = 10 × (1 − 경과일 / 기간)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const OUT_DIR = path.join(ROOT, 'out');
const STATE_DIR = path.join(ROOT, '.auth');
const API = 'https://www.googleapis.com/youtube/v3';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const tp = cfg.topicPicker || {};
  if (!Array.isArray(tp.queries) || !tp.queries.length) {
    throw new Error('config.json 의 topicPicker.queries 가 비어 있습니다');
  }
  return {
    queries: tp.queries,
    signalWords: tp.signalWords || [],
    maxPerQuery: Number(tp.maxPerQuery || 50),
  };
}

async function api(endpoint, params, key) {
  const url = new URL(`${API}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', key);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 키가 노출되지 않도록 URL은 찍지 않는다
    let hint = '';
    if (res.status === 403 && /quota/i.test(body)) hint = ' (일일 할당량 소진으로 보입니다)';
    else if (res.status === 403) hint = ' (키 권한 또는 YouTube Data API v3 활성화를 확인하세요)';
    else if (res.status === 400) hint = ' (키가 잘못됐을 수 있습니다)';
    throw new Error(`YouTube API ${endpoint} 실패: ${res.status}${hint}`);
  }
  return res.json();
}

// 검색 + 통계 조회. search.list 는 조회수를 주지 않아 videos.list 로 한 번 더 받는다.
async function collect(query, publishedAfter, maxItems, key) {
  const ids = [];
  let pageToken = '';
  while (ids.length < maxItems) {
    const page = await api('search', {
      part: 'id',
      q: query,
      type: 'video',
      order: 'viewCount',
      publishedAfter,
      maxResults: String(Math.min(50, maxItems - ids.length)),
      ...(pageToken ? { pageToken } : {}),
    }, key);
    for (const it of page.items || []) {
      if (it.id && it.id.videoId) ids.push(it.id.videoId);
    }
    pageToken = page.nextPageToken || '';
    if (!pageToken) break;
  }
  if (!ids.length) return [];

  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const detail = await api('videos', {
      part: 'snippet,statistics',
      id: chunk.join(','),
    }, key);
    for (const v of detail.items || []) {
      out.push({
        id: v.id,
        title: v.snippet?.title || '',
        channel: v.snippet?.channelTitle || '',
        publishedAt: v.snippet?.publishedAt || '',
        views: Number(v.statistics?.viewCount || 0),
        query,
      });
    }
  }
  return out;
}

function score(videos, signalWords, days) {
  const maxViews = Math.max(1, ...videos.map((v) => v.views));
  const denom = Math.log10(maxViews + 1) || 1;
  const now = Date.now();

  return videos
    .map((v) => {
      const viewScore = 60 * (Math.log10(v.views + 1) / denom);

      const hits = signalWords.filter((w) => v.title.toLowerCase().includes(w.toLowerCase()));
      const signalScore = Math.min(30, hits.length * 10);

      const ageDays = (now - new Date(v.publishedAt).getTime()) / 86_400_000;
      const freshScore = Math.max(0, 10 * (1 - ageDays / days));

      return {
        ...v,
        hits,
        ageDays: Number(ageDays.toFixed(1)),
        viewScore: Number(viewScore.toFixed(1)),
        signalScore,
        freshScore: Number(freshScore.toFixed(1)),
        total: Number((viewScore + signalScore + freshScore).toFixed(1)),
      };
    })
    .sort((a, b) => b.total - a.total);
}

function rationale(ranked, cfg, days, publishedAfter) {
  const top = ranked[0];
  const lines = [];
  lines.push(`# 글감 선정 근거`);
  lines.push('');
  lines.push(`- 수집 기간: 최근 ${days}일 (${publishedAfter} 이후 업로드분)`);
  lines.push(`- 검색 주제어: ${cfg.queries.join(', ')}`);
  lines.push(`- 신호어: ${cfg.signalWords.join(', ') || '(없음)'}`);
  lines.push(`- 수집 영상: ${ranked.length}편 (중복 제거 후)`);
  lines.push('');
  lines.push(`## 선정된 글감`);
  lines.push('');
  lines.push(`**${top.title}**`);
  lines.push('');
  lines.push(`- 총점 **${top.total}점** (조회수 ${top.viewScore} + 신호어 ${top.signalScore} + 신선도 ${top.freshScore})`);
  lines.push(`- 조회수 ${top.views.toLocaleString('ko-KR')}회 · 업로드 ${top.ageDays}일 전 · 채널 ${top.channel}`);
  lines.push(`- 걸린 신호어: ${top.hits.length ? top.hits.join(', ') : '없음'}`);
  lines.push(`- 검색 주제어: ${top.query}`);
  lines.push(`- https://www.youtube.com/watch?v=${top.id}`);
  lines.push('');
  lines.push(`### 왜 1등인가`);
  const second = ranked[1];
  if (second) {
    const gap = Number((top.total - second.total).toFixed(1));
    lines.push(`2위 「${second.title}」(${second.total}점)보다 ${gap}점 높습니다.`);
    const reason = [];
    if (top.viewScore > second.viewScore) reason.push('조회수');
    if (top.signalScore > second.signalScore) reason.push('신호어 적중');
    if (top.freshScore > second.freshScore) reason.push('신선도');
    if (reason.length) lines.push(`앞선 항목: ${reason.join(', ')}.`);
  } else {
    lines.push('비교 대상이 없어 단독 1위입니다.');
  }
  lines.push('');
  lines.push(`## 전체 순위 (상위 20)`);
  lines.push('');
  lines.push('| 순위 | 총점 | 조회수 | 신호어 | 경과 | 제목 |');
  lines.push('|---:|---:|---:|---|---:|---|');
  ranked.slice(0, 20).forEach((v, i) => {
    const t = v.title.replace(/\|/g, '\\|');
    lines.push(`| ${i + 1} | ${v.total} | ${v.views.toLocaleString('ko-KR')} | ${v.hits.join(' ') || '-'} | ${v.ageDays}일 | ${t} |`);
  });
  lines.push('');
  lines.push('### 점수 계산');
  lines.push('```');
  lines.push('조회수 60점 = 60 × log10(조회수+1) / log10(최대조회수+1)');
  lines.push('신호어 30점 = 겹치는 신호어 개수 × 10 (최대 30)');
  lines.push(`신선도 10점 = 10 × (1 − 경과일 / ${days})`);
  lines.push('```');
  return lines.join('\n');
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.error('❌ YOUTUBE_API_KEY 환경변수가 없습니다.');
    console.error('   export YOUTUBE_API_KEY="발급받은키"   ← 명령줄 인자로 넘기지 마세요');
    console.error('   키 발급: console.cloud.google.com → YouTube Data API v3 사용 설정 → 사용자 인증 정보');
    process.exit(1);
  }

  const cfg = loadConfig();
  const days = Number(arg('days', '7'));
  const publishedAfter = new Date(Date.now() - days * 86_400_000).toISOString();

  console.log(`최근 ${days}일 유튜브에서 글감을 찾습니다...`);
  const seen = new Map();
  for (const q of cfg.queries) {
    const got = await collect(q, publishedAfter, cfg.maxPerQuery, key);
    for (const v of got) if (!seen.has(v.id)) seen.set(v.id, v);
    console.log(`  "${q}" → ${got.length}편 (누적 ${seen.size}편)`);
  }

  const videos = [...seen.values()];
  if (!videos.length) {
    console.error('❌ 기간 안에 수집된 영상이 없습니다. --days 를 늘리거나 주제어를 넓혀보세요.');
    process.exit(1);
  }

  const ranked = score(videos, cfg.signalWords, days);
  const top = ranked[0];

  console.log('');
  console.log('상위 5편');
  ranked.slice(0, 5).forEach((v, i) => {
    console.log(`  ${i + 1}. [${v.total}점] ${v.views.toLocaleString('ko-KR')}회  ${v.title}`);
    console.log(`     조회수 ${v.viewScore} + 신호어 ${v.signalScore}${v.hits.length ? `(${v.hits.join(',')})` : ''} + 신선도 ${v.freshScore}`);
  });
  console.log('');
  console.log(`✅ 선정: 「${top.title}」 (${top.total}점)`);

  if (flag('dry-run')) {
    console.log('(--dry-run 이므로 파일을 남기지 않았습니다)');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(STATE_DIR, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const mdPath = path.join(OUT_DIR, `topic-${stamp}.md`);
  fs.writeFileSync(mdPath, rationale(ranked, cfg, days, publishedAfter), 'utf8');

  const jsonPath = path.join(STATE_DIR, 'selected-topic.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    pickedAt: new Date().toISOString(),
    days,
    queries: cfg.queries,
    signalWords: cfg.signalWords,
    collected: ranked.length,
    selected: top,
    runnerUp: ranked[1] || null,
  }, null, 2), 'utf8');

  console.log(`근거 파일: ${mdPath}`);
  console.log(`선정 결과: ${jsonPath}`);
  console.log('');
  console.log('다음 단계: 이 글감으로 원고를 쓴 뒤  node index.js next  로 임시저장하세요.');
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exit(1);
});
