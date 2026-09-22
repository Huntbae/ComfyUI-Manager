// 원고의 마크다운을 네이버 에디터에 그대로 쳐도 되는 평문으로 바꾼다.
//
// 스마트에디터는 마크다운을 해석하지 않는다. 원고를 그대로 타이핑하면
// 본문에 **굵게** 와 |---|---| 가 문자 그대로 찍힌다.
// 서식을 흉내내려 툴바를 조작하면 취소선 오클릭 같은 사고가 나므로,
// 읽기 좋은 평문으로 바꿔서 넣는 쪽을 택했다.

// 이미지 마커는 건드리지 않는다 (post.js 와 같은 규칙)
const IMG_LINE = /^\s*\[\[\s*(?:img|image)\s*:/i;
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// 인라인 서식 제거: **굵게** *기울임* `코드` [글자](주소)
function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

// 표 한 덩어리를 문장형 줄로 바꾼다.
//   | | 고카트 | 사이클카트 |     →   시작 — 고카트: 1956년 / 사이클카트: 1995년
//   | 시작 | 1956년 | 1995년 |
function tableToLines(rows) {
  const body = rows.filter((r) => !isTableSep(r)).map(cells);
  if (!body.length) return [];
  const head = body[0];
  const data = body.slice(1);
  // 헤더가 의미 없으면(첫 칸 빼고 다 비었으면) 그냥 칸을 이어 붙인다
  const headed = head.slice(1).some((h) => h) && data.length;
  if (!headed) return body.map((r) => inline(r.filter(Boolean).join(' · ')));
  return data.map((r) => {
    const label = inline(r[0]);
    const pairs = r.slice(1)
      .map((v, i) => (head[i + 1] ? `${inline(head[i + 1])}: ${inline(v)}` : inline(v)))
      .filter(Boolean)
      .join(' / ');
    return label ? `${label} — ${pairs}` : pairs;
  });
}

function markdownToPlain(text) {
  const out = [];
  const lines = String(text).split('\n');
  let table = [];

  const flush = () => {
    if (table.length) { out.push(...tableToLines(table)); table = []; }
  };

  for (const raw of lines) {
    if (IMG_LINE.test(raw)) { flush(); out.push(raw); continue; }
    if (isTableRow(raw)) { table.push(raw); continue; }
    flush();

    let l = raw;
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push(''); continue; }  // 구분선
    l = l.replace(/^\s*#{1,6}\s*/, '');            // 제목 표시
    l = l.replace(/^\s*>\s?/, '');                 // 인용
    l = l.replace(/^(\s*)[-*+]\s+/, '$1· ');       // 글머리 기호
    l = l.replace(/^(\s*)(\d+)[.)]\s+/, '$1$2. '); // 번호 목록은 그대로
    out.push(inline(l));
  }
  flush();
  return out.join('\n');
}

module.exports = { markdownToPlain };
