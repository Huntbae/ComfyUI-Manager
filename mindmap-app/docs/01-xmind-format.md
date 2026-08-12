# 01. XMind 파일 포맷 분석

> **신뢰도 표기**
> `[확인]` = 공개 소스코드/문서로 교차 확인됨
> `[추정]` = 다수 구현체에서 관찰되나 1차 출처 미확인 — **Phase 0에서 실측 검증 필요**

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

`[확인]` — `simple-mind-map`의 export 구현이 정확히 이 엔트리들을 쓴다.
`revisions/` 디렉터리도 관찰되나 편집기 동작에는 불필요. `[추정]`

### 2.2 `metadata.json` 실제 형태 `[확인]`

```json
{
  "modifier": "",
  "dataStructureVersion": "2",
  "creator": { "name": "mind-map" },
  "layoutEngineVersion": "3",
  "activeSheetId": "<sheet id>"
}
```

`creator.name`에는 생성 앱 이름이 들어간다. 우리 앱 이름을 넣되,
**원본을 편집한 경우 `creator`를 함부로 덮어쓰지 않는 것**을 권장한다(§5 참조).

### 2.3 `manifest.json` 실제 형태 `[확인]`

```json
{
  "file-entries": {
    "content.json": {},
    "metadata.json": {},
    "Thumbnails/thumbnail.png": {},
    "resources/abc123.png": {}
  }
}
```

리소스를 추가/삭제할 때 **manifest도 반드시 동기화**해야 한다.
manifest에 없는 `resources/` 파일은 XMind 본체가 무시하거나 파일을 손상으로 판정할 수 있다. `[추정]`

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

#### Topic 객체 — 관찰되나 검증 필요한 필드 `[추정]`

| 필드 | 의미 | 왜 중요한가 |
|---|---|---|
| `children.detached[]` | **플로팅 토픽** (트리에 붙지 않은 자유 노드) | 유실 시 사용자 데이터가 사라진다 |
| `children.summary[]` | 요약 노드의 실체 토픽 | `summaries[]`는 참조, 실체는 여기 |
| `children.callout[]` | 말풍선 주석 | |
| `markers[]` | `{markerId: "priority-1"}` 형태의 아이콘 | Xmind 사용자의 핵심 습관 |
| `image` | `{src:"xap:resources/x.png", width, height, align}` | `xap:` 스킴이 ZIP 내부 참조 |
| `boundaries[]` | `{id, range, title, style}` 경계선 | 시각적 그룹핑 |
| `numberFormat` / `numberSeparator` | 자동 넘버링 | |
| `customWidth`, `customPosition` | 수동 배치 | |
| `attributedTitle` | 리치텍스트 제목 (부분 서식) | 평문 `title`과 이중 저장 가능성 |

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

`simple-mind-map`은 export 시 무조건 `org.xmind.ui.logic.right`로 고정한다. `[확인]`
→ **구조 정보가 왕복에서 손실된다**는 뜻. 우리가 반드시 고쳐야 할 지점.

### 2.5 관계선(Relationship) `[추정]`

시트 레벨의 `relationships[]`에 저장된다:

```jsonc
{ "id": "...", "end1Id": "topicA", "end2Id": "topicB",
  "title": "라벨", "style": {...}, "controlPoints": {...} }
```

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

## 4. 기존 OSS 구현의 손실 지점 (실측 요약)

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

### 검증 방법 (Phase 0 필수 산출물)

```
원본.xmind → [우리 앱: 열기 → 아무것도 안 함 → 저장] → 결과.xmind
assert  normalizeJSON(원본.content.json) == normalizeJSON(결과.content.json)
assert  원본 ZIP 엔트리 집합 == 결과 ZIP 엔트리 집합
```

**무편집 왕복이 바이트 동등에 가깝지 않으면 그 다음 단계로 가지 않는다.**
이 게이트를 통과한 뒤에야 편집 기능을 얹는다.

---

## 6. Phase 0 검증 체크리스트

- [ ] 실제 XMind 앱(최신 버전)으로 모든 기능을 1회씩 사용한 샘플 파일 제작
- [ ] `content.json` 전체 키를 재귀 수집해 **실측 스키마** 산출
- [ ] `[추정]` 표기된 필드 전부를 `[확인]`으로 승격 또는 폐기
- [ ] 마커 ID 전체 목록 추출 (priority-*, task-*, flag-*, star-*, people-*, symbol-*, month-*, week-* 등)
- [ ] 테마 객체 구조 파악 (전체 보존만 하고 편집은 후순위로 둘지 결정)
- [ ] 무편집 왕복 diff = 0 달성
- [ ] 우리가 저장한 파일을 **실제 XMind 앱에서 열어 정상 렌더링되는지** 육안 확인

---

## 참고 자료

- [SimpleMindMap XMind 파서 구현](https://github.com/wanglin2/mind-map) — MIT, 실제 import/export 코드
- [xmindltd/xmind-generator](https://github.com/xmindltd/xmind-generator) — Xmind 공식, MIT, 파일 생성 로직
- [xmindltd/xmind-sdk-js](https://github.com/xmindltd/xmind-sdk-js) — Xmind 공식 SDK, MIT
- [tobyqin/xmindparser](https://github.com/tobyqin/xmindparser) — MIT, legacy/zen 자동 판별
- [jan-bar/xmind (Go)](https://github.com/jan-bar/xmind/blob/master/model.go) — 스키마가 Go 구조체로 명시됨
- [juliuskunze/xmind](https://github.com/juliuskunze/xmind) — XMind 3 원본 소스 미러 (EPL/LGPL)
- [XMind — Wikipedia](https://en.wikipedia.org/wiki/XMind)
