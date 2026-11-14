// 네이버 클립 크리에이터 (clipcreators.naver.com).
//
// 블로그와 다른 점이 하나 있고 그것이 전부를 바꾼다: 클립은 올리면 바로 공개된다.
// 블로그는 임시저장까지만 하고 사람이 보고 발행했다. 클립에는 그 중간 단계가
// 없을 수 있다. 그래서 화면 구조를 추측해서 버튼을 누르지 않는다 —
// 먼저 clipDoctor 로 실제 화면을 읽고, 읽은 것으로 올리는 코드를 쓴다.
//
// 이 파일에 지금 있는 것은 읽는 쪽(clipDoctor)뿐이다. 게시 버튼은 누르지 않는다.
const DASHBOARD = 'https://clipcreators.naver.com/web/dashboard';

// 화면에 있는 누를 수 있는 것·적을 수 있는 것을 전부 읽는다. 값은 읽지 않는다.
// 읽으면서 요소마다 표(data-kart-id)를 붙여둔다. 글자가 없는 버튼(아이콘)도
// 나중에 그 표로 정확히 누를 수 있다.
let snapNo = 0;
async function snapshot(page) {
  const all = new Map();
  snapNo += 1;
  for (const [fi, f] of page.frames().entries()) {
    const where = f === page.mainFrame() ? '바깥' : (f.name() || f.url().slice(0, 40));
    const items = await f.evaluate((prefix) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden';
      };
      const label = (el) => {
        // 체크박스·라디오·입력칸에 붙은 설명글
        const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const wrap = el.closest('label');
        return ((id || wrap)?.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      };
      const sel = 'button, a, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], input, textarea, select, [contenteditable="true"]';
      return [...document.querySelectorAll(sel)].map((el, idx) => {
        el.setAttribute('data-kart-id', `${prefix}-${idx}`);
        return el;
      }).map((el) => ({
        kid: el.getAttribute('data-kart-id'),
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || el.getAttribute('role') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        label: label(el),
        ph: el.getAttribute('placeholder') || '',
        max: el.getAttribute('maxlength') || '',
        accept: el.getAttribute('accept') || '',
        href: (el.getAttribute('href') || '').slice(0, 60),
        id: el.id || '',
        cls: String(el.className || '').slice(0, 70),
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        checked: el.checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true',
        visible: vis(el),
      })).filter((i) => i.visible || i.type === 'file');
    }, `s${snapNo}f${fi}`).catch(() => []);
    for (const it of items) {
      const key = [where, it.tag, it.type, it.id, it.cls, it.text, it.ph, it.label, it.href].join('|');
      all.set(key, { where, frame: f, ...it });
    }
  }
  return all;
}

function fmt(it) {
  let s = `  <${it.tag}${it.type ? ` ${it.type}` : ''}>`;
  if (it.id) s += ` #${it.id}`;
  if (it.text) s += ` "${it.text}"`;
  if (it.label) s += ` 설명="${it.label}"`;
  if (it.ph) s += ` placeholder="${it.ph}"`;
  if (it.max) s += ` 최대${it.max}자`;
  if (it.accept) s += ` accept="${it.accept}"`;
  if (it.href) s += ` → ${it.href}`;
  s += `  .${it.cls}`;
  if (it.disabled) s += '  (잠김)';
  if (it.checked) s += '  (선택됨)';
  if (!it.visible) s += '  (안 보임)';
  if (it.where !== '바깥') s += `  [프레임 ${it.where}]`;
  return s;
}

async function pageText(page, n = 500) {
  const parts = [];
  for (const f of page.frames()) {
    const t = await f.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim()).catch(() => '');
    if (t) parts.push(t);
  }
  return parts.join(' / ').slice(0, n);
}

// 리다이렉트가 가라앉기를 기다린다.
async function settle(page, ms = 12_000) {
  const t0 = Date.now();
  let cur = page.url();
  let since = Date.now();
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(500);
    if (page.url() !== cur) { cur = page.url(); since = Date.now(); } else if (Date.now() - since > 3_000) break;
  }
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => {});
}

// 클립 크리에이터의 화면 구조를 읽는다.
//   1) 대시보드
//   2) 업로드로 들어가는 버튼을 눌러 본 화면
//   3) (videoPath 가 있으면) 영상을 넣은 뒤 나타나는 입력 화면 — 제목·설명·공개 설정·게시 버튼
// 3)에서 영상 파일은 네이버로 올라간다. 그래야 그 뒤의 화면이 보인다.
// 그러나 **게시 버튼은 누르지 않는다.** 읽기만 하고 나온다.
async function clipDoctor(page, { videoPath = null, log = console.log } = {}) {
  const context = page.context();
  const chain = [];
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) return;
    const u = f.url().slice(0, 110);
    if (chain[chain.length - 1] !== u) chain.push(u);
  });

  log(`대시보드 진입: ${DASHBOARD}`);
  await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle(page);
  if (page.url().includes('nidlogin')) {
    log('로그인 화면입니다. 뜬 창에서 네이버에 로그인해 주세요 (3분 안에).');
    await page.waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 180_000 }).catch(() => {});
    await settle(page);
    if (!page.url().includes('clipcreators')) {
      await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(page);
    }
  }

  log('\n══ 1) 대시보드 ══');
  log('이동 경로:');
  for (const u of chain) log(`  → ${u}`);
  log(`지금 주소: ${page.url()}`);
  log(`화면 글자: "${await pageText(page)}"`);
  const s1 = await snapshot(page);
  log(`누를 수 있는 것·입력칸 ${s1.size}개:`);
  for (const it of [...s1.values()].slice(0, 120)) log(fmt(it));

  if (!page.url().includes('clipcreators')) {
    log('\n클립 크리에이터에 들어가지 못했습니다. 위의 주소와 화면 글자를 보내주세요.');
    return { ok: false };
  }

  // 업로드로 들어가는 것. 글자로 고른다 — 짧고 정확한 것부터.
  const entry = [...s1.values()]
    .filter((i) => i.visible && !i.disabled && i.type !== 'file' && i.tag !== 'input')
    .map((i) => ({ i, t: `${i.text} ${i.label}` }))
    .filter(({ t }) => /업로드|올리기|클립\s*만들기|새\s*클립|만들기|upload/i.test(t))
    .sort((a, b) => {
      const score = (t) => (/업로드|upload/i.test(t) ? 0 : 1) * 100 + t.length;
      return score(a.t) - score(b.t);
    });
  log(`\n업로드로 보이는 것 ${entry.length}개:`);
  for (const { i } of entry.slice(0, 8)) log(fmt(i));

  let chooser = null;
  const onChooser = (c) => { chooser = chooser || c; };     // 듣고 있으면 실제 파일창은 뜨지 않는다
  page.on('filechooser', onChooser);
  let active = page;

  if (entry.length) {
    const pick = entry[0].i;
    log(`\n══ 2) "${pick.text || pick.label}" 를 눌러 본다 ══`);
    const loc = pick.frame.locator(`[data-kart-id="${pick.kid}"]`).first();
    const popup = context.waitForEvent('page', { timeout: 6_000 }).catch(() => null);
    await loc.click({ timeout: 8_000 }).catch((e) => log(`  누르지 못했습니다: ${e.message.split('\n')[0]}`));
    const np = await popup;
    if (np) {
      active = np;
      active.on('filechooser', onChooser);
      await np.waitForLoadState('domcontentloaded').catch(() => {});
      log('  새 창(탭)이 열렸습니다.');
    }
    await settle(active, 8_000);
    log(`지금 주소: ${active.url()}`);
    log(`파일창: ${chooser ? '바로 떴습니다' : '안 떴습니다'}`);
    log(`화면 글자: "${await pageText(active)}"`);
    const s2 = await snapshot(active);
    const fresh = [...s2.entries()].filter(([k]) => !s1.has(k)).map(([, v]) => v);
    log(`새로 나타난 것 ${fresh.length}개:`);
    for (const it of fresh.slice(0, 100)) log(fmt(it));
  } else {
    log('\n업로드 버튼을 글자로 찾지 못했습니다. 위 목록에서 어느 것인지 보고 고치겠습니다.');
  }

  if (!videoPath) {
    log('\n(영상을 주지 않아 여기까지만 봤습니다.)');
    page.off('filechooser', onChooser);
    return { ok: true, stage: 2 };
  }

  log(`\n══ 3) 영상을 넣어 본다: ${require('path').basename(videoPath)} ══`);
  log('   (입력 화면을 보려면 영상이 올라가야 합니다. 게시 버튼은 누르지 않습니다.)');
  const sBefore = await snapshot(active);
  let fed = false;
  if (chooser) {
    await chooser.setFiles(videoPath).then(() => { fed = true; }).catch(() => {});
  }
  if (!fed) {
    // 동영상을 받는 파일 입력칸에 직접 넣는다
    outer:
    for (const f of active.frames()) {
      const inputs = f.locator('input[type="file"]');
      const n = await inputs.count().catch(() => 0);
      for (let k = 0; k < n; k += 1) {
        const acc = (await inputs.nth(k).getAttribute('accept').catch(() => '')) || '';
        if (/image/i.test(acc) && !/video|mp4|mov/i.test(acc)) continue;
        try { await inputs.nth(k).setInputFiles(videoPath); fed = true; break outer; } catch { /* 다음 */ }
      }
    }
  }
  if (!fed) {
    log('   영상을 넣을 곳을 찾지 못했습니다 (파일창도 파일 입력칸도 없음). 위 2)의 목록으로 고치겠습니다.');
    page.off('filechooser', onChooser);
    return { ok: false, stage: 3 };
  }
  log('   영상을 넣었습니다. 입력 화면이 나타나기를 기다립니다 (최대 2분).');

  // 입력칸이 늘어나는 순간들을 찍는다.
  let last = sBefore;
  let lastCount = -1;
  const t0 = Date.now();
  for (const at of [8, 20, 40, 70, 110]) {
    while ((Date.now() - t0) / 1000 < at) await active.waitForTimeout(1_000);
    const s = await snapshot(active);
    const fresh = [...s.entries()].filter(([k]) => !last.has(k)).map(([, v]) => v);
    if (fresh.length && s.size !== lastCount) {
      log(`\n── ${at}초 뒤 · 주소 ${active.url().slice(0, 90)}`);
      log(`   화면 글자: "${(await pageText(active, 400))}"`);
      log(`   새로 나타난 것 ${fresh.length}개:`);
      for (const it of fresh.slice(0, 80)) log(fmt(it));
    }
    last = s;
    lastCount = s.size;
  }

  log('\n══ 지금 화면 전체 (게시 직전) ══');
  const sEnd = await snapshot(active);
  for (const it of [...sEnd.values()].slice(0, 150)) log(fmt(it));
  log('\n게시 버튼은 누르지 않았습니다. 이 화면 전체를 보내주세요.');
  log('(방금 넣은 영상은 게시되지 않은 채로 남거나 사라집니다. 클립 관리 화면에 초안으로 남아 있으면 지우셔도 됩니다.)');
  page.off('filechooser', onChooser);
  return { ok: true, stage: 3 };
}

module.exports = { clipDoctor, DASHBOARD };
