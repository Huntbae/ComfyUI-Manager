# 01. XMind 파일 포맷 분석

> **신뢰도 표기**
> `[확인]` = 공개 소스코드/문서로 교차 확인됨
> `[실측]` = **실제 `.xmind` 파일 코퍼스에서 직접 관찰됨** — 가장 높은 신뢰도
> `[추정]` = 다수 구현체에서 관찰되나 1차 출처 미확인 — 실측 검증 필요
>
> 📊 **실측 코퍼스 5개 파일 / 252 토픽 분석 완료.** 상세 결과는 [07번 문서](07-corpus-measurement.md).
> 아래 본문은 그 결과를 반영해 갱신되었다.

---

## 1. 큰 그림

`.xmind`는 **ZIP 아카이브**다. 확장자를 `.zip`으로 바꾸면 그대로 풀린다. `[확인]`
문제는 **버전에 따라 내부 구조가 완전히 다르다**는 점이다.

| 세대 | 제품 버전 | 콘텐츠 파일 | 비고 |
|---|---|---|---|
| Legacy | XMind 3 ~ XMind 8 | `content.xml` (XML) | OpenDocument/OOXML 원칙 기반의 공개 포맷 |
| Modern ("Zen"/2021+) | XMind Zen, XMind 2020~2026 | `content.json` (JSON) | 공식 스펙 문서 없음. 사실상 리버스 엔지니어링 대상 |

버전 판별 휴리스틱 `[확인]`:

```
metadata/manifest 의 version ≤ 9   → legacy
                  version ≥ 10  → modern
연도 ≤ 2019 → legacy / 연도 ≥ 2020 → modern
```

**실무적으로 더 견고한 판별법** — 버전 필드를 믿지 말고 엔트리 존재 여부로 분기한다:

```js
if (zip.files['content.json']) → modern
else if (zip.files['content.xml']) → legacy
else → 지원하지 않는 파일
```

이 방식은 `simple-mind-map`, `xmindparser` 등 실제 구현체가 공통으로 쓴다. `[확인]`

### 🚨 이 순서는 선택이 아니라 필수다 `[실측]`

**modern 파일에도 `content.xml`이 함께 들어 있다.** 그런데 그 내용은 마인드맵이 아니라
구버전 XMind용 **경고 스텁**이다. 코퍼스 5개 파일의 `content.xml`이 MD5까지 동일하며
(4309 bytes), 타임스탬프가 2017년으로 고정된 상수다:

```xml
<topic structure-class="org.xmind.ui.logic.right" timestamp="1503058545540">
  <title>Warning
警告
Attention
Warnung
경고</title>
```

→ **`content.xml`을 먼저 검사하면 사용자의 맵 대신 "경고"라는 맵을 조용히 연다.**
   `content.json` 우선 검사를 **불변 규칙**으로 못박고 테스트로 강제한다.

---

## 2. Modern 포맷 (`content.json` 세대)

### 2.1 아카이브 엔트리

```
myfile.xmind
├── content.json              # 필수. 시트/토픽 트리 전체
├── metadata.json             # 작성자, 데이터 구조 버전, 활성 시트 id
├── manifest.json             # 파일 엔트리 목록(첨부/이미지 등록부)
├── Thumbnails/
│   └── thumbnail.png         # 미리보기
├── resources/                # 삽입 이미지·첨부파일 실체
│   └── <hash>.png
└── content.xml               # (선택) 구버전 호환용 XML 스켈레톤
```

`[실측]` — 코퍼스 5개 파일이 정확히 이 구성이다. `Thumbnails/`는 길이 0의
**디렉터리 엔트리로도 별도 존재**하므로 ZIP 재작성 시 빠뜨리지 않도록 주의한다.

### 2.2 `metadata.json` 실제 형태 `[실측]`

```json
{"dataStructureVersion":"2","modifier":"Vana 22.11.3656.202301092354",
 "layoutEngineVersion":"3","activeSheetId":"bcaa8a711fc9de683e504a29f4",
 "creator":{"name":"Vana","version":"25.01.01061"}}
```

- `creator.name`은 **`"Vana"`** — XMind의 내부 코드네임이다. `"Xmind"`가 아니다.
- `layoutEngineVersion`은 `"3"`(2025년 파일) → `"4"`(2026년 파일)로 **올라가고 있다.**
- **파일마다 키 집합이 다르다.** 일부에만 `familyId`, `Author`, `Create.Time`,
  `Share.LanguageChannel`이 존재한다.

→ **고정 스키마로 재생성하면 안 된다.** 원본 객체를 유지하고 `activeSheetId` 등
   꼭 필요한 키만 패치한다. `creator`도 원본을 덮어쓰지 않는 것을 권장한다(§5).

### 2.3 `manifest.json` 실제 형태 `[실측]`

```json
{"file-entries":{"content.json":{},"metadata.json":{},"Thumbnails/thumbnail.png":{}}}
```

이미지가 있는 파일만 `"resources/<sha256>.svg":{}`가 추가된다.

**🚨 manifest는 완전한 등록부가 아니다.** `content.xml`이 아카이브에 실재하는데
manifest에는 **없다**(5개 파일 전부). 즉 manifest ≠ ZIP 엔트리 목록이다.

→ ZIP 엔트리 목록을 진실로 삼고, manifest는 **리소스 항목만 증분 동기화**한다.
   manifest를 통째로 재생성하면 XMind가 기대하는 상태에서 벗어난다.

### 2.4 `content.json` 스키마

최상위는 **시트 배열**이다(멀티 시트 = 탭). `[확인]`

```jsonc
[
  {
    "id": "sheet-uuid",
    "class": "sheet",
    "title": "시트 1",
    "rootTopic": { /* Topic */ },
    "topicPositioning": "fixed",     // 자유 배치 여부
    "topicOverlapping": "overlap",
    "theme": { /* 테마 객체 */ },
    "relationships": [ /* 관계선 */ ],
    "extensions": [],
    "coreVersion": "2.x"
  }
]
```

#### Topic 객체 — 확인된 필드 `[확인]`

`simple-mind-map`의 import/export 코드에서 실제로 읽고 쓰는 필드들:

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 토픽 고유 ID |
| `class` | `"topic"` | 클래스 태그 |
| `title` | string | 노드 텍스트 |
| `structureClass` | string | 레이아웃 종류 (루트/서브트리 단위 지정 가능) |
| `children.attached[]` | Topic[] | **자식 노드** |
| `notes.plain.content` | string | 노트(평문) |
| `notes.realHTML.content` | string | 노트(리치 HTML) |
| `href` | string | 하이퍼링크 (`https?://` 또는 `xap:` 내부 참조) |
| `labels[]` | string[] | 태그/라벨 |
| `summaries[]` | `{id, range, topicId}` | 요약 노드. `range`는 `"(0,2)"` 형태의 자식 인덱스 구간 |
| `extensions[]` | any[] | 확장 데이터 |
| `branch` | `"folded"` | 접힘 상태 |
| `style` | `{id, type:"topic", properties:{...}}` | 개별 노드 스타일 |

#### Topic 객체 — 실측으로 확정된 필드 `[실측]`

| 필드 | 형태 | 관찰 |
|---|---|---|
| `children.detached[]` | Topic[] + `position` | **플로팅 토픽.** 3개 관찰 |
| `image` | `{src:"xap:resources/<sha256>.svg", width, height, align}` | `xap:` = ZIP 내부 참조 |
| `position` | `{x: float, y: float}` | 36회 |
| `customWidth` | int | 31회 |
| `attributedTitle` | `[{text: "..."}, …]` | 9회. **§2.6에서 별도 경고** |
| `class` | `"topic"` \| **`"importantTopic"`** | 토픽 역할 구분 |
| `extensions[]` | `{provider, content}` | 루트에서 좌우 분배(`right-number`) 지정 |

#### Topic 객체 — 아직 미검증 `[추정]`

| 필드 | 의미 | 상태 |
|---|---|---|
| `markers[]` | `{markerId: "priority-1"}` 아이콘 | 코퍼스에 사용 사례 없음. **단 `theme.*` 에 대응 스타일 존재** |
| `boundaries[]` | `{id, range, title, style}` 경계선 | 〃 (`theme.boundary` 존재) |
| `summaries[]` / `children.summary[]` | 요약 노드 | 〃 (`theme.summary`, `theme.summaryTopic` 존재) |
| `children.callout[]` | 말풍선 주석 | 〃 (`theme.calloutTopic` 존재) |
| `numberFormat` / `numberSeparator` | 자동 넘버링 | 사용 사례 없음 |

> 테마에 대응 스타일이 존재하므로 **필드 자체는 확실하다.** 정확한 형태만 미확정이다.
> [07번 문서 §8](07-corpus-measurement.md)에 추가 샘플 요청 목록이 있다.

#### Sheet 레벨 — 실측 추가 발견 `[실측]`

| 필드 | 값 | 의미 |
|---|---|---|
| `revisionId` | UUID | 5개 전부 존재. 버전 추적 |
| `topicPositioning` | `"fixed"` | 자유 배치 모드 |
| `topicOverlapping` | `"overlap"` | 겹침 허용 |
| `theme` | 15개 하위 키 | `map, centralTopic, mainTopic, subTopic, minorTopic, importantTopic, expiredTopic, floatingTopic, calloutTopic, summaryTopic, summary, boundary, relationship, colorThemeId, skeletonThemeId` |

> **주의**: `xmindparser`(MIT)는 자체 문서에서 **플로팅 토픽, 링크된 토픽, 요약, 경계선,
> Pro 기능(task info)을 지원하지 않는다**고 명시한다. `[확인]`
> 즉 기존 OSS 파서를 그대로 쓰면 이 데이터는 전부 날아간다.

#### `structureClass` 값 `[확인 — 상수 존재 / 추정 — 개별 문자열]`

`jan-bar/xmind`(Go 구현)에 상수로 정의된 카테고리:
unbalanced map, balanced map(방향 변형), org-chart, tree, logic, timeline, fishbone, spreadsheet(matrix).

관찰된 실제 문자열 `[추정]`:

```
org.xmind.ui.map.unbalanced        일반 마인드맵(비대칭)
org.xmind.ui.map.clockwise         시계방향 균형 맵
org.xmind.ui.logic.right / .left   논리 구조도
org.xmind.ui.org-chart.down / .up  조직도
org.xmind.ui.tree.right / .left    트리(디렉터리)
org.xmind.ui.timeline.horizontal / .vertical   타임라인
org.xmind.ui.fishbone.rightHeaded / .leftHeaded 피시본
org.xmind.ui.spreadsheet           매트릭스
```

실측으로 `org.xmind.ui.logic.right`, `org.xmind.ui.fishbone.leftHeaded`,
`org.xmind.ui.tree.right`, `org.xmind.ui.map.unbalanced` 확인 — **위 문자열 형태가 정확히 일치**한다. `[실측]`

`simple-mind-map`은 export 시 무조건 `org.xmind.ui.logic.right`로 고정한다. `[확인]`
→ **구조 정보가 왕복에서 손실된다**는 뜻. 우리가 반드시 고쳐야 할 지점.

#### 🚨 구조 정보는 세 곳에 분산 저장된다 `[실측]`

피시본 파일에서 관찰:

```jsonc
// 1) 시트 확장 — 레벨별 구조 지정
"extensions": [{
  "provider": "org.xmind.ui.skeleton.structure.style",
  "content": { "centralTopic": "org.xmind.ui.fishbone.leftHeaded",
               "mainTopic":    "org.xmind.ui.tree.right" }   // 1레벨 자식이 쓸 구조
}]
// 2) rootTopic.structureClass
// 3) 개별 topic.structureClass
```

**구조 전환 Command는 이 세 지점을 일관되게 갱신해야 한다.** 하나만 고치면 XMind에서 레이아웃이 깨진다.
`simple-mind-map`이 구조를 고정해버리는 것도 이 복잡성 때문으로 보인다.

### 2.5 관계선(Relationship) `[실측]`

시트 레벨의 `relationships[]`에 저장된다. 코퍼스에서 18개 관찰:

```jsonc
{ "id": "182aa7e6-…", "end1Id": "topicA", "end2Id": "topicB",
  "title": "연계 창업",
  "controlPoints": { "0": {"x": 734.83, "y": -3.12}, "1": {"x": 691.83, "y": 3.04} },
  "lineEndPoints": { "0": {"x": 127.5, "y": -3.12}, "1": {"x": 83.5, "y": 3.04} } }
```

`controlPoints` / `lineEndPoints`는 **배열이 아니라 `"0"`, `"1"` 문자열 키를 갖는 객체**다.
JSON 파싱 후 배열로 정규화하면 재직렬화 시 형태가 바뀌므로 그대로 둔다.

### 2.6 🚨 `attributedTitle` — 텍스트 이중 저장 `[실측]`

```json
{ "title": "일정 :  2025-04-03 ~ 2025-04-13",
  "attributedTitle": [ {"text": "일정 :  "}, {"text": "2025-04-03 ~ 2025-04-13"} ] }
```

같은 문자열이 두 곳에 있다. `attributedTitle`은 구간별 서식용 리치텍스트,
`title`은 그 평문 버전이다.

**편집기에 미치는 영향**: 텍스트 편집 시 `title`만 갱신하면 우리 앱에는 새 글자가 보이지만
**XMind에서 열면 `attributedTitle`이 우선되어 옛 글자가 보일 수 있다.**

→ v1 규칙: **텍스트가 바뀌면 `attributedTitle`을 삭제한다.**
   (서식은 잃되 데이터 불일치는 없다. 서식 보존은 리치텍스트 편집기를 붙이는 Phase 3에서.)
   이 규칙은 주석이 아니라 **테스트로 강제**한다.

---

## 3. Legacy 포맷 (`content.xml` 세대)

XMind 3은 **EPL v1.0 + LGPL v3 듀얼 라이선스 오픈소스**였고, 포맷도 공개 포맷으로 설계됐다. `[확인]`
소스는 `code.google.com/p/xmind3` → GitHub 미러(예: `juliuskunze/xmind`)에 남아 있다.

구성 `[확인]`:

```
content.xml            토픽 트리
styles.xml             스타일
meta.xml               메타데이터
META-INF/manifest.xml  엔트리 목록
Thumbnails/thumbnail.jpg
attachments/           첨부
markers/               커스텀 마커
```

XML 구조는 `<sheet><topic><children><topics type="attached"><topic>...` 형태이며,
하이퍼링크는 `xlink:href` **속성**으로 들어간다(모던의 `href` 필드와 다름). `[확인]`

**전략적 판단**: Legacy는 **읽기 전용(import)만 지원**하고 저장은 항상 모던 포맷으로 한다.
XMind 8 이하 사용자는 이미 소수이며, 양방향 지원은 비용 대비 효용이 낮다.

---

## 4. 기존 OSS 구현의 손실 지점

> 📊 아래 표는 코퍼스 실측으로 검증됐다. naive 파서 방식을 5개 파일에 돌린 결과
> **131개 데이터 포인트가 유실**됐다 — 플로팅 토픽 3, 관계선 18, style 33,
> position 36, customWidth 31, attributedTitle 9, 이미지 1.
> 이미지 1개는 코퍼스의 유일한 리소스다. 즉 **왕복 한 번에 그림이 사라진다.**
> 상세는 [07번 문서 §6](07-corpus-measurement.md).


| 요소 | `simple-mind-map` | `xmindparser` | 우리 목표 |
|---|---|---|---|
| 텍스트/계층 | ✅ | ✅ | ✅ |
| 노트 | ✅ (plain/realHTML) | ✅ (평문으로 강등) | ✅ 리치 유지 |
| 라벨 | ✅ | ✅ | ✅ |
| 하이퍼링크 | ⚠️ `https?://`만 통과 | — | ✅ `xap:` 내부링크 포함 |
| 이미지 | ⚠️ 부분 | — | ✅ resources 왕복 |
| 마커/아이콘 | ⚠️ | ⚠️ 이미지로 강등 | ✅ markerId 보존 |
| 요약(summary) | ⚠️ range만 | ❌ | ✅ |
| 경계선(boundary) | ❌ | ❌ | ✅ |
| 관계선 | ❌ | ⚠️ 옵션 | ✅ |
| 플로팅 토픽 | ❌ | ❌ | ✅ |
| 다중 시트 | ❌ | ⚠️ | ✅ |
| 구조(structureClass) | ❌ 강제 고정 | — | ✅ |
| 테마/스타일 | ❌ | ❌ | ✅ 최소한 보존 |

**이 표가 곧 제품의 차별화 명세다.** 오른쪽 열을 채우는 것이 개발의 본질이다.

---

## 5. 핵심 설계 결정 — "Preserve and Patch" 저장 전략

> 이것이 이 프로젝트에서 가장 중요한 아키텍처 결정이다.

### 문제

일반적인 방식은 `parse → 내부 모델 → serialize`다. 이 경우 **내부 모델이 모르는 필드는
저장 시점에 전부 소멸**한다. XMind는 공식 스펙이 없고 버전마다 필드가 추가되므로,
우리가 아무리 스키마를 잘 만들어도 **모르는 필드는 반드시 존재**한다.

### 해법

```
열기:  .xmind(ZIP) ──┬─→ 원본 JSON AST 통째로 메모리 보관 (unknown 필드 포함)
                     └─→ 편집용 뷰 모델 생성 (id로 원본 노드와 1:1 연결)

편집:  뷰 모델 변경 → 명령(Command) 로그

저장:  원본 AST 복제 → 명령이 건드린 필드만 in-place 패치 → 재직렬화
       ZIP도 재생성이 아니라 원본 엔트리 복사 + 변경분 교체
```

**효과**:
- 텍스트만 고치고 저장하면 `content.json`의 나머지가 **바이트 수준으로 거의 동일**하게 유지된다.
- 우리가 지원하지 않는 Pro 기능(간트, 태스크 정보 등)도 파일에 그대로 살아남는다.
- 사용자가 XMind와 우리 앱을 **번갈아 써도 데이터가 마모되지 않는다.**

**비용**: 내부 모델이 두 겹이 되어 구현 복잡도가 올라간다.
→ 그러나 이것이 "기존 파일을 편집하고 싶다"는 요구사항의 유일한 정답이다.

### 검증 방법 (Phase 0 필수 산출물) — ✅ 달성

```
원본.xmind → [우리 앱: 열기 → 아무것도 안 함 → 저장] → 결과.xmind
assert  normalizeJSON(원본.content.json) == normalizeJSON(결과.content.json)
assert  원본 ZIP 엔트리 집합 == 결과 ZIP 엔트리 집합
```

**결과: 코퍼스 5/5 통과.** 구현은 `tools/roundtrip.py`.

### 🎯 목표를 "바이트 동등"으로 상향할 수 있다 `[실측]`

기대 이상의 결과가 나왔다. XMind의 직렬화 방식을 정확히 재현하면
`content.json`이 **바이트 단위로 동일**해진다 (5/5, 14449 → 14449 bytes 등):

```python
json.dumps(ast, ensure_ascii=False, separators=(",", ":"))   # Python
JSON.stringify(ast)                                          # JS (기본 동작이 동일)
```

조건 세 가지:
1. **공백 없는 compact JSON** — `,` `:` 뒤 공백 없음
2. **비ASCII 이스케이프 금지** — 한글이 `\uXXXX`가 아니라 UTF-8 원문
3. **키 순서 보존** — 재정렬 금지

→ 무편집 저장 시 **파일 해시가 그대로 유지**된다.
   이는 **`.xmind`를 Git으로 버전 관리해도 노이즈 diff가 생기지 않는다**는 뜻이고,
   그 자체로 제품 기능이 된다 ([05번 로드맵](05-roadmap.md) Phase 5 "Git 친화" 항목).

---

## 6. Phase 0 검증 체크리스트

- [x] 실제 XMind 앱으로 만든 샘플 파일 확보 (5개 / 252 토픽)
- [x] `content.json` 전체 키를 재귀 수집해 **실측 스키마** 산출 → `tools/schema_extract.py`
- [x] `[추정]` 필드 승격 — detached, image, position, customWidth, attributedTitle, relationships 확정
- [x] 무편집 왕복 diff = 0 달성 (**바이트 동등까지 달성**)
- [x] 테마 객체 최상위 구조 파악 (15개 키. 보존만 하고 편집은 Phase 3)
- [ ] 마커 ID 목록 추출 — **샘플 부족.** 마커 사용 파일 필요
- [ ] 경계선 · 요약 · 말풍선 형태 확정 — **샘플 부족**
- [ ] 다중 시트 파일 검증 — 현재 코퍼스는 전부 단일 시트
- [ ] legacy(XMind 8) 파일로 읽기 경로 검증
- [ ] 우리가 저장한 파일을 **실제 XMind 앱에서 열어 정상 렌더링되는지** 육안 확인

> 남은 항목은 전부 **샘플 부족**이 원인이다. 필요한 파일 목록은 [07번 문서 §8](07-corpus-measurement.md).

---

## 참고 자료

- [SimpleMindMap XMind 파서 구현](https://github.com/wanglin2/mind-map) — MIT, 실제 import/export 코드
- [xmindltd/xmind-generator](https://github.com/xmindltd/xmind-generator) — Xmind 공식, MIT, 파일 생성 로직
- [xmindltd/xmind-sdk-js](https://github.com/xmindltd/xmind-sdk-js) — Xmind 공식 SDK, MIT
- [tobyqin/xmindparser](https://github.com/tobyqin/xmindparser) — MIT, legacy/zen 자동 판별
- [jan-bar/xmind (Go)](https://github.com/jan-bar/xmind/blob/master/model.go) — 스키마가 Go 구조체로 명시됨
- [juliuskunze/xmind](https://github.com/juliuskunze/xmind) — XMind 3 원본 소스 미러 (EPL/LGPL)
- [XMind — Wikipedia](https://en.wikipedia.org/wiki/XMind)
