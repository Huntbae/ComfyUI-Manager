# 07. 실측 결과 — Phase 0 코퍼스 분석

**대상**: 실제 Xmind 앱으로 작성된 `.xmind` 파일 **6개** (2024-12 ~ 2026-01 작성, 총 **270 토픽**)
**분석 일자**: 2026-08-12 (2차 갱신)
**도구**: `tools/schema_extract.py`, `tools/topic_fields.py`, `tools/roundtrip.py` (본 문서 §9)

이 문서는 [01번 문서](01-xmind-format.md)의 `[추정]` 항목을 실제 파일로 검증한 결과다.

---

## 1. 코퍼스 개요

| ID | 원본 파일 | 시트 | 토픽 | 구조 | 특징 |
|---|---|---|---|---|---|
| f1 | 2022 주요업무 | 1 | 58 | `logic.right` | 관계선 8 |
| f2 | '25 전시회 일정 | 1 | 41 | `fishbone.leftHeaded` | **피시본**, `attributedTitle` 9, href 6 |
| f3 | 2025 주요업무 | 1 | 58 | `logic.right` | 관계선 8 |
| f4 | 2025 상반기 주요업무 | 1 | 67 | `logic.right` | notes 4, position 29, customWidth 29 |
| f5 | (인구소멸/마을버스) | 1 | 28 | `logic.right` | **플로팅 토픽 3**, 이미지 1(SVG), `importantTopic` |
| f6 | TAZZARI_Proj | 1 | 18 | `logic.right` | **PNG 이미지 4**, `titleUnedited`, 아카이브 11엔트리 |

전부 modern(`content.json`) 포맷. legacy 파일은 코퍼스에 없음.

> 2차 수집분 3개 중 2개는 기존 파일과 **MD5가 동일한 중복**이어서 f6만 신규로 편입했다.
> 중복 판별은 `md5sum`으로 먼저 거르는 것을 절차에 넣을 것.

---

## 2. 아카이브 레이아웃 — 확정

```
content.json                 ← 실제 콘텐츠
metadata.json
manifest.json
Thumbnails/                  ← 디렉터리 엔트리가 별도로 존재 (length 0)
Thumbnails/thumbnail.png
content.xml                  ← ⚠️ 함정. §3 참조
resources/                   ← 이미지가 있을 때만
resources/<sha256>.svg
```

### 🚨 발견 1 — `manifest.json`은 완전한 등록부가 아니다

```json
{"file-entries":{"content.json":{},"metadata.json":{},"Thumbnails/thumbnail.png":{}}}
```

**`content.xml`이 아카이브에 실재하는데 manifest에는 없다.** 6개 파일 전부 그렇다.
이미지가 있는 파일만 `resources/…` 항목이 추가된다 (PNG 4개짜리 f6도 4개 전부 등록).

→ **manifest를 "아카이브에 무엇이 있는지"의 근거로 삼으면 안 된다.**
   ZIP 엔트리 목록이 진실이고, manifest는 리소스 등록부에 가깝다.
   저장 시에는 리소스만 동기화하고 나머지는 원본 그대로 둔다.

### 🚨 발견 2 — `content.xml`은 콘텐츠가 아니라 "경고 스텁"이다

6개 파일의 `content.xml`이 **MD5까지 완전히 동일**하다 (`6115c57b…`, 4309 bytes).
내용은 구버전 XMind로 열었을 때 표시되는 다국어 경고문이다:

```xml
<topic id="1vr0lcte2og4t2sopiogvdmifc" structure-class="org.xmind.ui.logic.right"
       timestamp="1503058545540">
  <title>Warning
警告
Attention
Warnung
경고</title>
```

타임스탬프가 `1503058545540` = **2017년**으로 고정되어 있다. 즉 XMind가 구워 넣은 상수다.

→ **`content.xml`을 먼저 검사하는 파서는 실제 마인드맵 대신 "경고"라는 맵을 읽는다.**
   [01번 문서](01-xmind-format.md)에서 제안한 "`content.json` 우선 검사" 분기가
   선택이 아니라 **필수**임이 실증됐다. 순서를 뒤집으면 조용히 잘못된 데이터를 연다.

### `metadata.json` 실측

```json
{"dataStructureVersion":"2","modifier":"Vana 22.11.3656.202301092354",
 "layoutEngineVersion":"3","activeSheetId":"bcaa8a711fc9de683e504a29f4",
 "creator":{"name":"Vana","version":"25.01.01061"}}
```

- `creator.name`이 **`"Vana"`** — XMind의 내부 코드네임. `"Xmind"`가 아니다.
- `layoutEngineVersion`: `"3"`(f1~f4, f6) / `"4"`(f5, 2026년 파일) — **엔진 버전이 올라가고 있다.**
- f2에만 `familyId`, f5에만 `Author` / `Create.Time` / `Share.LanguageChannel`.
  → **파일마다 키 집합이 다르다.** 고정 스키마로 재생성하면 정보가 사라진다.

---

## 3. `[추정]` 항목 검증 결과

| 필드 | 이전 | 결과 | 근거 |
|---|---|---|---|
| `children.detached[]` | `[추정]` | ✅ **확인** | f5에 3개. `position` 좌표 동반 |
| `titleUnedited` | (미발견) | ✅ **신규 확인** | f6에 2개 — §3.1 |
| `image` (`xap:` 스킴) | `[추정]` | ✅ **확인** | SVG 1 + PNG 4. `src` 외 전부 선택 필드 — §3.2 |
| `position` `{x,y}` | `[추정]` | ✅ **확인** | 36회. float |
| `customWidth` | `[추정]` | ✅ **확인** | 31회. int |
| `attributedTitle` | `[추정]` | ✅ **확인** | f2에 9회. §4에서 별도 분석 |
| `relationships[]` | `[추정]` | ✅ **확인** | 18개. `end1Id/end2Id/title/controlPoints/lineEndPoints` |
| `notes.plain` / `notes.realHTML` | `[확인]` | ✅ 재확인 | f4. `realHTML`은 `<ul><li>` 등 실제 HTML |
| `markers[]` | `[추정]` | ⚠️ **미검증** | 코퍼스에 마커 사용 사례 없음 |
| `boundaries[]` | `[추정]` | ⚠️ **미검증** | 사용 사례 없음. 단 `theme.boundary`는 6개 전부 존재 |
| `summaries[]` / `children.summary` | `[추정]` | ⚠️ **미검증** | 사용 사례 없음. `theme.summary` / `theme.summaryTopic`은 존재 |
| `children.callout[]` | `[추정]` | ⚠️ **미검증** | 사용 사례 없음. `theme.calloutTopic`은 존재 |

> 미검증 4종은 **테마에 대응 스타일이 존재한다**는 점에서 필드 자체는 확실하다.
> 다만 정확한 형태를 확정하려면 마커·경계선·요약·말풍선을 쓴 샘플이 추가로 필요하다.
> **다음 샘플 수집 시 이 4가지를 반드시 포함할 것.**

### 새로 발견된 필드 (기존 문서에 없던 것)

| 필드 | 위치 | 값 | 의미 |
|---|---|---|---|
| `revisionId` | sheet | UUID | 6개 중 5개. 버전 추적용 |
| `topicPositioning` | sheet | `"fixed"` | 5개 |
| `topicOverlapping` | sheet | `"overlap"` | 2개 |
| `extensions[].provider` | sheet | `org.xmind.ui.skeleton.structure.style` | **§5 참조 — 중요** |
| `class` | topic | `"topic"` / **`"importantTopic"`** | 토픽 역할 구분 |
| `extensions[].provider` | rootTopic | `org.xmind.ui.map.unbalanced` + `right-number` | 좌우 분배 정보 |
| `theme.level3` | sheet | — | f5(엔진 v4)에만 존재 |
| **`titleUnedited`** | topic | `true` | **§3.1 — 편집기 필수 처리** |

`theme` 최상위 키 15종 (전 파일 공통):
`map, centralTopic, mainTopic, subTopic, minorTopic, importantTopic, expiredTopic,
floatingTopic, calloutTopic, summaryTopic, summary, boundary, relationship,
colorThemeId, skeletonThemeId`

### 3.1 🚨 발견 6 — `titleUnedited`는 "아직 안 고친 기본 텍스트" 표시다

f6에서 2건 관찰:

```json
{ "title": "주요 주제 3", "titleUnedited": true }
{ "title": "주요 주제 4", "titleUnedited": true }
```

노드를 새로 만들면 XMind가 `"주요 주제 N"` 같은 **자리표시자 제목**을 넣고 이 플래그를 세운다.
사용자가 실제로 타이핑하면 플래그가 사라진다.

**편집기 구현 규칙**: 텍스트 편집 Command는 `attributedTitle` 삭제(§4)와 함께
**`titleUnedited`도 제거**해야 한다. 남겨두면 XMind가 그 노드를 여전히 "미입력" 상태로 취급해,
자리표시자로 되돌리거나 자동 선택 동작을 다르게 할 수 있다.

→ 텍스트 편집 시 건드려야 할 필드가 **3개**로 늘었다: `title`, `attributedTitle`, `titleUnedited`.

### 3.2 발견 7 — `image`는 `src` 외 전부 선택 필드다

전 코퍼스 이미지 5건의 키 조합:

| 조합 | 건수 |
|---|---|
| `src` 만 | 3 |
| `src` + `align` | 1 |
| `src` + `width` + `height` + `align` | 1 |

→ **`width`/`height`를 필수로 가정하고 파싱하면 3/5가 깨진다.**
   크기 미지정 = 원본 크기 사용이라는 뜻이므로, 렌더링 시 리소스를 읽어 실제 치수를 구해야 한다.
   저장 시에도 **원래 없던 `width`/`height`를 임의로 채워 넣지 않는다** (바이트 동등이 깨진다).

---

## 4. 🚨 발견 3 — `attributedTitle`은 `title`과 이중 저장된다

f2에서 관찰:

```json
{
  "title": "일정 :  2025-04-03 ~ 2025-04-13",
  "attributedTitle": [
    { "text": "일정 :  " },
    { "text": "2025-04-03 ~ 2025-04-13" }
  ]
}
```

**같은 문자열이 두 곳에 들어 있다.** `attributedTitle`은 구간별 서식을 담는 리치텍스트 표현이고,
`title`은 그 평문 버전이다.

### 편집기 구현에 미치는 영향 (치명적)

사용자가 노드 텍스트를 고쳤을 때 `title`만 갱신하면:
- 우리 앱에서는 새 텍스트가 보인다
- **XMind에서 열면 `attributedTitle`이 우선되어 옛날 텍스트가 보일 수 있다**

→ **텍스트 편집 Command는 반드시 두 필드를 함께 처리해야 한다.**
   서식 편집 UI가 없는 v1에서는 **텍스트가 바뀌면 `attributedTitle`을 삭제**하는 것이 가장 안전하다
   (서식은 잃지만 데이터 불일치는 없다). 서식 보존은 리치텍스트 편집기를 붙이는 Phase 3에서 다룬다.

이 규칙은 코드 주석이 아니라 **테스트로 강제**해야 한다.

---

## 5. 🚨 발견 4 — 구조 정보가 세 곳에 분산 저장된다

f2(피시본)에서:

```json
// 1) 시트 레벨 확장
"extensions": [{
  "provider": "org.xmind.ui.skeleton.structure.style",
  "content": { "centralTopic": "org.xmind.ui.fishbone.leftHeaded",
               "mainTopic":    "org.xmind.ui.tree.right" }
}]

// 2) 루트 토픽
"rootTopic": { "structureClass": "org.xmind.ui.fishbone.leftHeaded", … }

// 3) 개별 토픽 (해당 시)
"structureClass": "…"
```

**시트 확장의 `mainTopic`은 "1레벨 자식들이 쓸 구조"를 지정한다.**
피시본에서 뼈대는 `fishbone.leftHeaded`, 각 가지는 `tree.right`로 그려지는 이유다.

→ 구조를 바꾸는 Command는 **이 세 지점을 일관되게 갱신**해야 한다.
   하나만 고치면 XMind에서 레이아웃이 깨진다.
   `simple-mind-map`이 export 시 `logic.right`로 고정해버리는 것도 이 복잡성 때문으로 보인다.

### 실측된 `structureClass` 값

```
org.xmind.ui.logic.right          (5개 파일)
org.xmind.ui.fishbone.leftHeaded  (1개 파일)
org.xmind.ui.tree.right           (f2 mainTopic)
org.xmind.ui.map.unbalanced       (f5 rootTopic.extensions provider)
```

기존 문서에 적었던 문자열 형태가 **정확히 일치**함을 확인했다.

---

## 6. 왕복 검증 결과 — Phase 0 게이트

세 전략을 같은 코퍼스에 돌렸다.

### 전략 A — naive 파서 (기존 OSS 방식)

`children.attached`만 따라가고 알려진 필드만 재구성. `simple-mind-map`의 실제 동작을 흉내냈다.

| 파일 | 원본 토픽 | 복원 토픽 | 유실 | 관계선 유실 | 유실 필드 |
|---|---|---|---|---|---|
| f1 | 58 | 58 | 0 | **8** | class, style |
| f2 | 41 | 41 | 0 | 0 | **attributedTitle**, class, style |
| f3 | 58 | 58 | 0 | **8** | class, style |
| f4 | 67 | 67 | 0 | **1** | class, customWidth, position, style |
| f5 | 28 | 25 | **3** | **1** | class, customWidth, **extensions, image**, position, style |
| f6 | 18 | 18 | 0 | 0 | attributedTitle, class, **image**, **titleUnedited** |

시트 레벨 유실: `extensions, relationships, revisionId, style, theme, topicOverlapping, topicPositioning`

**코퍼스 전체 유실 데이터 포인트: 131개**

```
플로팅 토픽    3   (완전 소멸)
관계선        18   (완전 소멸)
개별 style    33
position      36
customWidth   31
attributedTitle 9
image          1
```

이미지 1개는 f5의 유일한 리소스다. 즉 **naive 왕복 한 번으로 그림이 사라진다.**

### 전략 B — AST 재직렬화

원본 `content.json`을 파싱한 뒤 그대로 다시 직렬화.

| 파일 | 원본 bytes | 재직렬화 | 바이트 동등 | 의미 동등 |
|---|---|---|---|---|
| f1 | 14449 | 14449 | ✅ PASS | ✅ PASS |
| f2 | 12710 | 12710 | ✅ PASS | ✅ PASS |
| f3 | 14449 | 14449 | ✅ PASS | ✅ PASS |
| f4 | 21912 | 21912 | ✅ PASS | ✅ PASS |
| f5 | 11944 | 11944 | ✅ PASS | ✅ PASS |
| f6 | 10230 | 10230 | ✅ PASS | ✅ PASS |

### 🎯 발견 5 — XMind의 직렬화 방식을 정확히 재현했다

**6개 파일 전부 바이트 단위로 동일**하다. 조건:

```python
json.dumps(ast, ensure_ascii=False, separators=(",", ":"))
```

- **공백 없는 compact JSON** (`,` `:` 뒤 공백 없음)
- **비ASCII 이스케이프 없음** — 한글이 `\uXXXX`가 아니라 UTF-8 원문
- **키 순서 보존** (재정렬 금지)

JS로는 `JSON.stringify(ast)`가 기본으로 이 동작을 한다.

→ **의미 동등(semantic)이 아니라 바이트 동등(byte-exact)을 목표로 삼을 수 있다.**
   이건 예상보다 훨씬 강한 보증이다. 무편집 저장 시 파일 해시가 그대로 유지되므로
   **Git으로 `.xmind`를 버전 관리해도 노이즈 diff가 생기지 않는다.**
   이것 자체가 제품 기능이 된다 ([05번 로드맵](05-roadmap.md) Phase 5의 "Git 친화" 항목과 연결).

### 전략 C — preserve-and-patch (실제 `.xmind` 무편집 왕복)

ZIP 엔트리를 순서까지 보존하고 `content.json`만 교체해 다시 압축.

| 파일 | 엔트리 | 엔트리 보존 | content 동등 | 전체 동등 |
|---|---|---|---|---|
| 2022 주요업무 | 6 | ✅ | ✅ | ✅ |
| '25 전시회 일정 | 6 | ✅ | ✅ | ✅ |
| 2025 주요업무 | 6 | ✅ | ✅ | ✅ |
| 2025 상반기 주요업무 | 6 | ✅ | ✅ | ✅ |
| (인구소멸/마을버스) | 8 | ✅ | ✅ | ✅ |
| **TAZZARI_Proj** | **11** | ✅ | ✅ | ✅ |

TAZZARI 파일은 **PNG 리소스 4개 + 디렉터리 엔트리 2개로 11엔트리**다.
다중 리소스 아카이브에서도 엔트리 순서·내용이 그대로 보존됨을 확인했다.
manifest에는 PNG 4개와 썸네일이 전부 등록돼 있지만 **`content.xml`은 여전히 빠져 있다**(§2 발견 1 재확인).

## ✅ **Phase 0 게이트 통과 — 무편집 왕복 무손실 6/6**

[05번 로드맵](05-roadmap.md)이 요구한 게이트를 **아키텍처 가정대로 통과**했다.
preserve-and-patch 전략이 실제 파일에서 작동함이 실증됐다.

---

## 7. 로드맵에 미치는 영향

| 항목 | 변경 |
|---|---|
| Phase 0 | **부분 완료.** 스키마 실측·왕복 하네스·게이트 통과 달성. 마커/경계선/요약/말풍선 샘플만 추가 필요 |
| Phase 1 | 착수 가능. `XMindReader`/`XMindWriter`의 목표를 **바이트 동등**으로 상향 |
| 신규 필수 작업 | `attributedTitle` 동기화 규칙 (§4) — 텍스트 편집의 정확성이 여기 걸려 있다 |
| 신규 필수 작업 | 구조 3중 저장 동기화 (§5) — 구조 전환 기능의 전제조건 |
| 파서 분기 | `content.json` 우선 검사를 **불변 규칙**으로 승격 (§3 경고 스텁) |
| manifest 처리 | 재생성 금지. 리소스 항목만 증분 동기화 |

---

## 8. 다음 샘플 수집 요청

6개를 모았지만 **아래 4가지는 여전히 코퍼스에 사용 사례가 없다.**
업무용 맵은 대체로 텍스트·계층 위주라 이 기능들이 잘 안 쓰인 것으로 보인다.

- [ ] **마커/아이콘** — 우선순위, 깃발, 별, 스마일 등 (`markers[]`)
- [ ] **경계선(Boundary)** — 여러 노드를 묶은 테두리 (`boundaries[]`)
- [ ] **요약(Summary)** — 자식 범위를 묶어 요약 노드 생성 (`summaries[]`, `children.summary`)
- [ ] **말풍선(Callout)** — 노드에 붙는 주석 (`children.callout`)

> **권고**: 실제 업무 파일을 더 뒤지는 것보다 **테스트용 맵 1개를 새로 만드는 편이 빠르다.**
> XMind에서 빈 맵을 열고 위 4가지를 한 번씩 넣은 뒤 시트 탭을 하나 추가해 저장하면
> 남은 항목이 한 번에 해소된다. 실제 업무 내용을 담을 필요도 없다.

추가로 있으면 좋은 것:
- [ ] **다중 시트** (탭 2개 이상) — 현재 코퍼스 6개가 **전부 단일 시트**
- [ ] **legacy 파일** (XMind 8 이하로 저장한 것) — legacy 읽기 경로 검증용
- [ ] **첨부파일**이 들어간 맵 — `resources/` 비이미지 처리 검증
- [ ] **대형 맵** (1,000+ 노드) — 현재 최대 67 토픽. 성능 측정 불가

### 수집 절차 메모

2차 수집분 3개 중 2개가 기존 파일과 MD5 동일한 중복이었다.
**`md5sum`으로 먼저 중복을 거르고 편입**하는 단계를 넣을 것.

---

## 9. 분석 도구

본 분석에 사용한 스크립트는 `mindmap-app/tools/` 에 커밋되어 있다.

| 도구 | 용도 |
|---|---|
| `tools/schema_extract.py` | `content.json`의 모든 JSON 경로·타입·샘플값 집계 |
| `tools/topic_fields.py` | 토픽 재귀를 정규화해 Sheet/Topic 필드 인벤토리 산출 |
| `tools/roundtrip.py` | 전략 A/B/C 왕복 검증 — **CI에 상시 물릴 게이트** |

```bash
# 코퍼스 준비
mkdir -p corpus/f1 && unzip -q your.xmind -d corpus/f1

python3 tools/schema_extract.py corpus
python3 tools/topic_fields.py  corpus
python3 tools/roundtrip.py     corpus
```
