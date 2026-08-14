# 04. 아키텍처 및 기술 스택

---

## 1. 레이어 구조

```
┌───────────────────────────────────────────────────────────┐
│  UI Shell            React + TypeScript                    │
│  (툴바 · 사이드패널 · 시트탭 · 다이얼로그 · 아웃라이너)      │
├───────────────────────────────────────────────────────────┤
│  Editor Core         simple-mind-map (MIT) — SVG 렌더링     │
│  (레이아웃 · 드래그 · 노드 렌더 · 테마 적용)                 │
├───────────────────────────────────────────────────────────┤
│  Document Model      ★ 자체 구현                            │
│  ├─ SourceAST        원본 content.json 원형 보존            │
│  ├─ ViewModel        편집용 정규화 트리                     │
│  └─ CommandBus       모든 변경은 Command로만 발생            │
├───────────────────────────────────────────────────────────┤
│  Format Layer        ★ 자체 구현                            │
│  ├─ XMindReader      modern/legacy 판별 → SourceAST         │
│  ├─ XMindWriter      SourceAST 패치 → ZIP                   │
│  ├─ ResourceStore    resources/ + manifest 동기화           │
│  └─ Importers        Markdown / FreeMind / OPML             │
├───────────────────────────────────────────────────────────┤
│  Platform            Web (File System Access API)           │
│                      Tauri (네이티브 파일 IO)                │
└───────────────────────────────────────────────────────────┘
```

★ 표시 = **우리가 직접 만드는 부분.** 나머지는 빌려온다.

---

## 2. Document Model — 이중 표현

[01번 문서 §5](01-xmind-format.md)의 preserve-and-patch 전략을 구현하는 계층이다.

```ts
interface MindDocument {
  /** 원본 아카이브 전체. 우리가 모르는 엔트리까지 포함 */
  archive: RawArchive            // Map<entryPath, Uint8Array>

  /** content.json 을 파싱만 하고 손대지 않은 원형 */
  sourceAST: XMindSheet[]

  /** 편집용 뷰. sourceAST 노드와 id로 1:1 대응 */
  sheets: SheetVM[]

  /** 이 문서에 적용된 변경 목록 */
  journal: Command[]
}

interface NodeVM {
  id: string                     // sourceAST 노드의 id 와 동일
  text: string
  children: NodeVM[]
  note?: RichText
  labels: string[]
  markers: string[]              // markerId 문자열만 보존
  image?: ResourceRef
  href?: string
  collapsed: boolean
  structure?: StructureClass
  style?: NodeStyle

  /** ★ 핵심: 우리가 해석하지 못한 모든 필드의 보관소 */
  __unknown: Record<string, unknown>
}
```

### 저장 알고리즘

```
save(doc):
  ast ← deepClone(doc.sourceAST)
  for cmd in doc.journal:
      cmd.applyToAST(ast)          # 건드린 필드만 in-place 수정
  archive ← clone(doc.archive)
  archive['content.json'] ← serialize(ast)
  archive['metadata.json'] ← patchMetadata(...)   # activeSheetId 등만
  syncManifest(archive)
  regenerateThumbnail(archive)
  return zip(archive)
```

**불변식**: `journal`이 비어 있으면 저장 결과는 원본과 (타임스탬프를 제외하고) 동일해야 한다.
이것을 CI 테스트로 강제한다.

### Command 예시

```ts
type Command =
  | { t: 'setText';      nodeId: string; before: string; after: string }
  | { t: 'insertNode';   parentId: string; index: number; node: NodeVM }
  | { t: 'removeNode';   nodeId: string; snapshot: XMindTopic }  // 원본 AST 노드 통째 보관
  | { t: 'moveNode';     nodeId: string; from: Loc; to: Loc }
  | { t: 'setStructure'; nodeId: string; before?: string; after: string }
  | { t: 'setMarkers';   nodeId: string; before: string[]; after: string[] }
```

- 각 Command는 `applyToAST` / `applyToVM` / `invert()` 를 갖는다.
- **`invert()` 하나로 undo/redo가 끝난다.**
- `removeNode`가 원본 AST 서브트리를 통째로 스냅샷하는 이유: undo 시 **우리가 모르는 필드까지 복원**하기 위함.

---

## 3. Format Layer 상세

### XMindReader

```
읽기 순서
 1. ZIP 언팩 → RawArchive
 2. content.json 존재? → modern / content.xml 존재? → legacy / else → 오류
 3. legacy 인 경우: XML → modern 형태로 정규화 (읽기 전용 경로)
 4. sourceAST 구성 (JSON.parse 결과 그대로, 가공 금지)
 5. sourceAST → ViewModel 투영 (알려진 필드만 꺼내고 나머지는 __unknown 으로)
```

**중요 규칙**
- `JSON.parse` 결과에 **정규화/기본값 채우기를 하지 않는다.** 순수 보관이 목적.
- 하이퍼링크는 `https?://` 뿐 아니라 **`xap:` (아카이브 내부 참조)와 `xmind:` (토픽 간 점프)** 도 인식.
  기존 OSS가 `https?://`만 통과시키는 것이 손실 원인 중 하나다.

### XMindWriter

- export 정확성 기준선: **`xmindltd/xmind-generator`(Xmind 공식, MIT)의 출력**과 diff.
- 새 문서 생성 시에는 generator를 그대로 써도 되지만, **기존 문서 편집 저장에는 쓰지 않는다**
  (generator는 새로 만드는 용도라 unknown 필드를 보존하지 못한다).

### ResourceStore

```
이미지 삽입:  파일 → hash → resources/<hash>.<ext> 로 추가
              → manifest['file-entries'] 등록
              → 노드 image.src = "xap:resources/<hash>.<ext>"
이미지 삭제:  참조 카운트 0이 되어도 즉시 삭제하지 않는다(고아 리소스 허용).
              → 이유: undo 복원 및 우리가 못 읽는 다른 참조 가능성
              → "리소스 정리"는 명시적 메뉴로만 제공
```

---

## 4. 렌더링 전략

- 기본은 `simple-mind-map`의 **SVG** 렌더러.
- 성능 한계선: 노드 3,000개 근처에서 SVG DOM 부하가 체감된다 `[검증 필요]`.
  → 대형 맵 대비책은 **뷰포트 컬링**(화면 밖 노드 DOM 미생성)이 1순위, Canvas 전환은 최후 수단.
- 접힌 서브트리는 레이아웃 계산에서도 제외해 O(보이는 노드)를 유지.

---

## 5. 배포 형태

### Phase A — 웹 (로컬 파일 편집)

- **File System Access API** (`showOpenFilePicker` / `createWritable`)로
  브라우저에서 로컬 `.xmind`를 **직접 열고 덮어쓴다.** 업로드/다운로드가 아니다.
- 미지원 브라우저(Safari/Firefox)는 파일 열기 + 다운로드 저장으로 폴백.
- 서버 없음 = 사용자 데이터가 나가지 않음 = **프라이버시가 마케팅 포인트.**

### Phase B — Tauri 데스크톱

- 파일 연결(더블클릭으로 `.xmind` 열기), 최근 파일, 자동 저장, 네이티브 메뉴
- Electron 대비 번들 크기·메모리 우위. 프론트엔드 코드는 웹과 100% 공유.

### Phase C — 협업 (선택)

- **Yjs** CRDT. 트리를 중첩 `Y.Map`으로 모델링하고 `Y.Text`로 노드 텍스트를 다룬다.
- 주의: CRDT 트리는 **동시 이동으로 사이클이 생길 수 있다.** 이동 연산은 별도 처리 필요.
- 저장 시점에만 CRDT → SourceAST 패치로 환원한다. **CRDT를 저장 포맷으로 삼지 않는다.**

---

## 6. 기술 선택 요약

| 영역 | 선택 | 근거 |
|---|---|---|
| 언어 | TypeScript | 포맷 스키마를 타입으로 고정해야 유실을 막는다 |
| UI | React 19 | 생태계, 채용, Tauri 호환 |
| 코어 | simple-mind-map (MIT) | Xmind 기능 커버리지 최대 |
| ZIP | fflate | 속도·번들 크기 |
| 리치텍스트 | Tiptap | `notes.realHTML`과 매핑 자연스러움 |
| 상태 | Zustand + 자체 CommandBus | 단순함, undo를 직접 통제 |
| 테스트 | Vitest + Playwright | 왕복 테스트는 Node, 편집 시나리오는 브라우저 |
| 데스크톱 | Tauri 2 | 경량, 네이티브 파일 IO |
| 협업 | Yjs | 사실상 표준 |

---

## 7. 저장소 구조 제안

```
mindmap-app/
├── packages/
│   ├── xmind-format/      # ★ 리더/라이터/리소스 — 프레임워크 무관, 단독 배포 가능
│   ├── doc-model/         # ★ ViewModel + CommandBus
│   ├── editor/            # simple-mind-map 어댑터 + 커스텀 렌더 확장
│   └── ui/                # React 컴포넌트
├── apps/
│   ├── web/
│   └── desktop/           # Tauri
├── fixtures/              # ★ 실제 .xmind 샘플 코퍼스 (왕복 테스트 입력)
└── tools/
    └── schema-extract/    # content.json 실측 스키마 추출기
```

> `packages/xmind-format`은 **독립 npm 패키지로 공개할 가치가 있다.**
> "무손실 XMind 파서"는 현재 오픈소스에 존재하지 않는다.
> 이걸 먼저 공개하면 커뮤니티 검증과 홍보를 동시에 얻는다.
