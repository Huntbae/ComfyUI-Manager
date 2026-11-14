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

// ── 올리기 ───────────────────────────────────────────────────────
// 화면 구조를 미리 알지 못한 채로 쓴 코드다. 그래서 이름(클래스)에 기대지 않고
// 화면에 적힌 글자와 입력칸의 설명글로 찾는다. 그리고 다음을 지킨다.
//   · 제목칸을 찾지 못하면 게시하지 않는다.
//   · 게시 버튼은 글자가 정확히 맞는 것만 누른다 (게시·올리기·등록 …).
//     대시보드에 원래 있던 버튼(머리말의 '업로드' 등)은 후보에서 뺀다.
//   · 게시됐다는 증거(주소가 바뀜·완료 안내·입력 화면이 사라짐)를 보기 전에는
//     올렸다고 하지 않는다.
//   · 한 일을 전부 적어 돌려준다. 막히면 그 기록과 화면 구조로 고친다.
const PUBLISH_WORDS = ['게시하기', '게시', '클립 올리기', '올리기', '업로드하기', '업로드', '등록하기', '등록', '완료', '발행'];
const CONFIRM_WORDS = ['확인', '게시', '게시하기', '네', '예', '올리기'];
const DONE_RX = /게시(가|를)?\s*(완료|되었|됐|했)|업로드(가|를)?\s*(완료|되었|됐)|등록(이|을)?\s*(완료|되었|됐)|올렸습니다|게시 완료/;

const visibleNew = (snap, base) => [...snap.entries()].filter(([k, v]) => !base.has(k) && v.visible).map(([, v]) => v);
const hintOf = (i) => `${i.ph} ${i.label} ${i.id} ${i.cls}`;
// 글자를 적는 칸인가. div·p·span 은 contenteditable 일 때만 목록에 들어오는데,
// role 이 붙은 것(버튼·탭)은 적는 칸이 아니다.
const isTextField = (i) => (i.tag === 'textarea'
  || (['div', 'p', 'span'].includes(i.tag) && !i.type)
  || (i.tag === 'input' && !['file', 'checkbox', 'radio', 'hidden', 'button', 'submit'].includes(i.type)));

async function typeInto(active, it, value) {
  const loc = it.frame.locator(`[data-kart-id="${it.kid}"]`).first();
  const max = Number(it.max) || 0;
  const text = max ? value.slice(0, max) : value;
  if (it.tag === 'input' || it.tag === 'textarea') {
    await loc.fill(text);
  } else {                                   // contenteditable
    await loc.click();
    await active.keyboard.type(text, { delay: 15 });
  }
  return text;
}

// 대시보드에서 업로드 화면으로 들어간다. { active, base, chooser() } 를 돌려준다.
async function enterUpload(page, log) {
  const context = page.context();
  await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle(page);
  if (page.url().includes('nidlogin')) {
    log('   로그인 화면입니다. 뜬 창에서 네이버에 로그인해 주세요 (3분 안에).');
    await page.waitForURL((u) => !u.href.includes('nidlogin'), { timeout: 180_000 }).catch(() => {});
    await settle(page);
    if (!page.url().includes('clipcreators')) {
      await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(page);
    }
  }
  if (!page.url().includes('clipcreators')) {
    return { error: 'not_entered', hint: `클립 크리에이터에 들어가지 못했습니다 (지금 주소: ${page.url().slice(0, 90)})` };
  }
  const base = await snapshot(page);
  let chooser = null;
  const onChooser = (c) => { chooser = chooser || c; };
  page.on('filechooser', onChooser);

  const entry = [...base.values()]
    .filter((i) => i.visible && !i.disabled && i.type !== 'file' && i.tag !== 'input' && i.tag !== 'textarea')
    .map((i) => ({ i, t: `${i.text} ${i.label}`.trim() }))
    .filter(({ t }) => /업로드|올리기|클립\s*만들기|새\s*클립|만들기|upload/i.test(t))
    .sort((a, b) => {
      const score = (t) => (/업로드|upload/i.test(t) ? 0 : 1) * 100 + t.length;
      return score(a.t) - score(b.t);
    });
  if (!entry.length) {
    return { error: 'no_upload_entry', hint: '대시보드에서 업로드로 들어가는 버튼을 찾지 못했습니다.', base, active: page };
  }
  const pick = entry[0].i;
  log(`   업로드 입구: "${pick.text || pick.label}"`);
  const popup = context.waitForEvent('page', { timeout: 6_000 }).catch(() => null);
  await pick.frame.locator(`[data-kart-id="${pick.kid}"]`).first().click({ timeout: 8_000 }).catch(() => {});
  let active = page;
  const np = await popup;
  if (np) {
    active = np;
    active.on('filechooser', onChooser);
    await np.waitForLoadState('domcontentloaded').catch(() => {});
  }
  await settle(active, 8_000);
  log(`   업로드 화면: ${active.url().slice(0, 90)}`);
  return { active, base, chooser: () => chooser, onChooser };
}

async function feedVideo(active, getChooser, videoPath, base, log) {
  const c = getChooser();
  if (c) {
    try { await c.setFiles(videoPath); log('   영상: 파일창으로 넣음'); return true; } catch { /* 아래로 */ }
  }
  for (const f of active.frames()) {
    const inputs = f.locator('input[type="file"]');
    const n = await inputs.count().catch(() => 0);
    for (let k = 0; k < n; k += 1) {
      const acc = (await inputs.nth(k).getAttribute('accept').catch(() => '')) || '';
      if (/image/i.test(acc) && !/video|mp4|mov/i.test(acc)) continue;
      try { await inputs.nth(k).setInputFiles(videoPath); log(`   영상: 파일 입력칸에 넣음 (accept="${acc}")`); return true; } catch { /* 다음 */ }
    }
  }
  // 파일 입력칸이 아직 없으면, 새로 나타난 것 중 영상을 고르는 버튼을 눌러 본다
  const snap = await snapshot(active);
  const btns = visibleNew(snap, base)
    .filter((i) => !i.disabled && /동영상|영상|파일|선택|추가|올리기|업로드|upload/i.test(`${i.text} ${i.label}`));
  for (const b of btns.slice(0, 3)) {
    try {
      const [ch] = await Promise.all([
        active.waitForEvent('filechooser', { timeout: 6_000 }),
        b.frame.locator(`[data-kart-id="${b.kid}"]`).first().click({ timeout: 5_000 }),
      ]);
      await ch.setFiles(videoPath);
      log(`   영상: "${b.text || b.label}" 를 눌러 파일창으로 넣음`);
      return true;
    } catch { /* 다음 */ }
  }
  return false;
}

// 영상 하나를 클립으로 올리고 게시한다.
async function clipUpload(page, item, { log = console.log, uploadTimeout = 900_000, titleTimeout = 180_000 } = {}) {
  const dialogs = [];
  const onDialog = (d) => { dialogs.push(d.message().slice(0, 80)); d.accept().catch(() => {}); };
  page.context().on('dialog', onDialog);
  let active = page;
  const fail = async (reason, hint) => {
    const snap = await snapshot(active).catch(() => new Map());
    return {
      ok: false, reason, hint,
      url: active.url(),
      text: await pageText(active, 500).catch(() => ''),
      dump: [...snap.values()].slice(0, 120).map(fmt),
      dialogs,
    };
  };
  try {
    const ent = await enterUpload(page, log);
    if (ent.error) { active = ent.active || page; return await fail(ent.error, ent.hint); }
    active = ent.active;
    const { base } = ent;

    if (!(await feedVideo(active, ent.chooser, item.path, base, log))) {
      return await fail('no_file_input', '영상을 넣을 곳을 찾지 못했습니다.');
    }

    // 제목칸이 나타나기를 기다린다 (업로드가 시작돼야 입력 화면이 뜨는 구현이 많다)
    let title = null; let snap = null;
    const t0 = Date.now();
    while (Date.now() - t0 < titleTimeout) {
      await active.waitForTimeout(2_000);
      snap = await snapshot(active);
      const fields = visibleNew(snap, base).filter((i) => isTextField(i) && !i.disabled);
      title = fields.find((i) => /제목|title/i.test(hintOf(i)));
      if (title) break;
    }
    if (!title) return await fail('no_title_field', '영상을 넣었지만 제목칸을 찾지 못했습니다. 게시하지 않았습니다.');
    const typedTitle = await typeInto(active, title, item.title);
    log(`   제목: "${typedTitle}"`);

    // 설명칸과 태그칸 (없으면 건너뛴다)
    snap = await snapshot(active);
    const fields = visibleNew(snap, base).filter((i) => isTextField(i) && !i.disabled && i.kid !== title.kid);
    const tagField = fields.find((i) => /태그|tag/i.test(hintOf(i)));
    const desc = fields.find((i) => i !== tagField && /내용|설명|소개|본문|문구|description|caption/i.test(hintOf(i)));
    const hashtags = (item.tags || []).slice(0, 8).map((t) => `#${t}`).join(' ');
    if (desc) {
      // 태그칸이 따로 없으면 설명 끝에 해시태그를 붙인다
      const typed = await typeInto(active, desc, tagField ? item.description : `${item.description}\n${hashtags}`);
      log(`   설명: ${typed.length}자${tagField ? '' : ' (해시태그 포함)'}`);
    } else {
      log('   설명칸: 찾지 못해 건너뜀');
    }
    if (tagField) {
      const loc = tagField.frame.locator(`[data-kart-id="${tagField.kid}"]`).first();
      let n = 0;
      for (const t of (item.tags || []).slice(0, 8)) {
        try { await loc.click(); await active.keyboard.type(t, { delay: 20 }); await active.keyboard.press('Enter'); n += 1; } catch { break; }
        await active.waitForTimeout(250);
      }
      log(`   태그: ${n}개`);
    }

    // 게시 버튼이 눌릴 수 있게 되기를 기다린다 (= 업로드가 끝남)
    const urlBefore = active.url();
    let pub = null;
    const t1 = Date.now();
    while (Date.now() - t1 < uploadTimeout) {
      snap = await snapshot(active);
      const cands = visibleNew(snap, base).filter((i) => (i.tag === 'button' || i.tag === 'a' || i.type === 'button')
        && PUBLISH_WORDS.includes(i.text.trim()));
      cands.sort((a, b) => PUBLISH_WORDS.indexOf(a.text.trim()) - PUBLISH_WORDS.indexOf(b.text.trim()));
      pub = cands.find((i) => !i.disabled) || null;
      if (pub) break;
      await active.waitForTimeout(3_000);
    }
    if (!pub) return await fail('no_publish_button', '게시 버튼을 찾지 못했거나 끝까지 잠겨 있었습니다. 게시하지 않았습니다.');
    log(`   게시 버튼: "${pub.text.trim()}" 을 누름`);
    const before = snap;
    await pub.frame.locator(`[data-kart-id="${pub.kid}"]`).first().click({ timeout: 10_000 });

    // 확인 창이 뜨면 확인을 누르고, 게시됐다는 증거를 기다린다
    let confirmed = false;
    const t2 = Date.now();
    while (Date.now() - t2 < 90_000) {
      await active.waitForTimeout(1_500);
      const text = await pageText(active, 1500).catch(() => '');
      const urlNow = active.url();
      const now = await snapshot(active).catch(() => new Map());
      const titleGone = ![...now.values()].some((i) => i.visible && isTextField(i) && /제목|title/i.test(hintOf(i)));
      if (DONE_RX.test(text)) { log('   확인: 게시 완료 안내가 떴습니다'); return { ok: true, how: 'notice', title: typedTitle, url: urlNow, dialogs }; }
      if (urlNow !== urlBefore && !/upload|write|create/i.test(urlNow)) { log(`   확인: 화면이 넘어갔습니다 → ${urlNow.slice(0, 80)}`); return { ok: true, how: 'url', title: typedTitle, url: urlNow, dialogs }; }
      if (titleGone && Date.now() - t2 > 6_000) { log('   확인: 입력 화면이 닫혔습니다'); return { ok: true, how: 'form_closed', title: typedTitle, url: urlNow, dialogs }; }
      if (!confirmed) {
        const ask = visibleNew(now, before).find((i) => (i.tag === 'button' || i.tag === 'a') && !i.disabled
          && CONFIRM_WORDS.includes(i.text.trim()));
        if (ask) {
          log(`   확인 창: "${ask.text.trim()}" 을 누름`);
          await ask.frame.locator(`[data-kart-id="${ask.kid}"]`).first().click({ timeout: 5_000 }).catch(() => {});
          confirmed = true;
        }
      }
    }
    return await fail('publish_unverified', '게시 버튼을 눌렀지만 게시됐다는 증거를 보지 못했습니다. 클립 관리 화면에서 직접 확인해 주세요.');
  } catch (e) {
    return await fail('error', e.message.split('\n')[0]);
  } finally {
    page.context().off('dialog', onDialog);
  }
}

module.exports = { clipDoctor, clipUpload, DASHBOARD };
