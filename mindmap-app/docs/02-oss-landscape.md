# 02. 오픈소스 지형 조사

목표: **바닥부터 짜지 않는다.** 마인드맵 편집기의 어려운 부분(레이아웃 알고리즘,
드래그 재배치, 리치텍스트 노드, 실행취소, 다중 선택)은 이미 잘 해결한 OSS가 있다.
우리가 새로 만들어야 할 부분은 **XMind 무손실 호환**뿐이다.

---

## 1. 편집기 코어 후보

### 🥇 simple-mind-map (`wanglin2/mind-map`) — **채택 권고**

| 항목 | 내용 |
|---|---|
| 라이선스 | **MIT** |
| 규모 | 12.6k ★ / 1.7k fork |
| npm | `simple-mind-map` |
| 프레임워크 | **비의존(framework-agnostic)** 코어 + Vue 2 데모 앱 |
| 렌더링 | SVG |

**지원 기능** (Xmind와 직접 대응):
- 구조: 마인드맵, 논리 구조도, 조직도, 디렉터리, 타임라인, **피시본**, 표
- 테마 100종 이상
- 노드 요소: 텍스트, 이미지, 링크, 아이콘, 노트, 첨부, 태그, **요약 노드, 관계선, 경계선**,
  마커, 할 일, 설명, 넘버링, 수식
- Export: PNG, **XMind**, SVG, PDF, Markdown, TXT, XLSX, FreeMind, Mermaid, HTML
- Import: **XMind**, FreeMind, Markdown, TXT, XLSX

**채택 이유**
1. Xmind의 기능 인벤토리와 **커버리지가 가장 넓다.** 경계선·관계선·요약은 다른 라이브러리에 거의 없다.
2. XMind import/export가 이미 있어 **0에서 시작하지 않는다.**
3. MIT라 포크·상용화에 제약이 없다.
4. 플러그인 아키텍처라 XMind 호환 레이어를 **플러그인으로 격리**할 수 있다.

**주의점**
1. XMind 호환은 **로시(lossy)** 다 — [01번 문서 §4](01-xmind-format.md) 표 참조.
   경계선/관계선/플로팅/다중시트/구조가 왕복에서 유실된다.
   → **이 부분은 우리가 새로 쓴다.** 라이브러리의 `parse/xmind.js`는 참고자료로만 쓰고 대체한다.
2. 문서·주석·이슈가 대부분 중국어다. 팀 온보딩 비용을 예산에 넣어야 한다.
3. 데모 앱은 Vue 2(EOL)다. **데모 앱은 쓰지 말고 코어만 의존**하고 UI는 새로 만든다.

**의존 방식 권고**: 초기엔 npm 의존 → XMind 계층을 우리가 대체하면서 필요 시 포크(vendoring).
포크하면 업스트림 추적 비용이 생기므로, **코어는 건드리지 말고 플러그인/어댑터로 감싸는 것을 원칙**으로 한다.

---

### 🥈 mind-elixir-core (`ssshooter/mind-elixir-core`)

| 항목 | 내용 |
|---|---|
| 라이선스 | MIT |
| 규모 | 3.1k ★ |
| npm | `mind-elixir` |
| 렌더링 | DOM + SVG(연결선) |

- 드래그앤드롭, 다중 선택, undo/redo, 노드 연결, CSS 변수 기반 테마
- React / Vue 3 래퍼 공식 제공 — **모던 스택 친화적**
- `@mind-elixir/export-xmind` 플러그인 존재 (**export 전용, import 없음**)

**평가**: 코드가 깔끔하고 현대적이며 React 통합이 쉽다. 그러나 **경계선·요약·다중 시트·피시본 등
Xmind 고유 기능이 없어** 우리 목표에 맞추려면 결국 대부분을 직접 구현해야 한다.
→ *"Xmind 클론"이 아니라 "가벼운 자체 마인드맵"이 목표라면 이쪽이 정답.*

---

### 🥉 jsMind (`hizzgdev/jsmind`)

- 라이선스 **BSD** / Canvas + SVG 렌더링
- 가볍고 안정적이나 기능 폭이 좁다. 뷰어·임베드 용도로 적합.
- **평가**: 코어 후보에서 제외. 단, "읽기 전용 임베드 뷰어"가 필요해지면 재검토.

---

### 참고용 (직접 채택은 부적합)

| 프로젝트 | 라이선스 | 메모 |
|---|---|---|
| **kityminder-core** (Baidu) | BSD | 완성도 높았으나 **유지보수 중단**. 레이아웃 알고리즘 참고용 |
| **Freeplane** | GPL | Java 데스크톱. `.mm` 포맷. **GPL이라 코드 차용 시 전염** — 참고만 |
| **My Mind** | MIT | 웹 앱, 단순. UX 아이디어 참고 |
| **markmap** | MIT | Markdown → 마인드맵. **뷰어**지 편집기가 아님. Markdown 파이프라인 참고 |

---

## 2. XMind 포맷 처리 라이브러리

| 프로젝트 | 라이선스 | 방향 | 용도 |
|---|---|---|---|
| **xmindltd/xmind-generator** | MIT | 쓰기 | **Xmind 공식**. `Workbook/RootTopic/Topic/Marker/Summary/Relationship` 빌더. 브라우저 `.archive()` 지원 → 우리 export의 **정답지** |
| **xmindltd/xmind-sdk-js** | MIT | 쓰기 | Xmind 공식 경량 SDK. Node/브라우저 |
| **tobyqin/xmindparser** (Python) | MIT | 읽기 | legacy/zen 자동 판별 로직 참고 |
| **jan-bar/xmind** (Go) | — (확인 필요) | 읽기/쓰기 | **스키마가 Go 구조체로 명시**되어 있어 스펙 문서 대용 |
| **jinzcdev/markxmind** | — (확인 필요) | 쓰기 | Markdown → .xmind. UX 참고 |

> **핵심 인사이트**: `xmind-generator`가 **Xmind 공식 조직(`xmindltd`)이 MIT로 공개한
> 파일 생성 라이브러리**라는 점이 결정적이다. "Xmind UI 앱과 동일한 방식으로 파일을 생성한다"고
> 명시하므로, **export 정확성의 기준선(reference implementation)으로 삼는다.**
> 우리 export 결과와 이 라이브러리 출력을 diff하는 테스트를 만들면 호환성 검증이 자동화된다.

---

## 3. 주변 기술 스택 후보

| 영역 | 후보 | 권고 |
|---|---|---|
| ZIP 입출력 | JSZip / fflate | **fflate** (더 빠르고 가벼움). JSZip은 기존 코드 호환용 |
| 상태/실행취소 | 자체 Command 패턴 / Immer + zundo | **자체 Command 패턴** — 패치형 저장(§01-5)과 결합해야 함 |
| 실시간 협업 | **Yjs** + y-websocket | Phase 4 이후. 트리 CRDT는 Yjs `Y.Map` 중첩으로 모델링 |
| 데스크톱 패키징 | **Tauri** vs Electron | **Tauri** — 번들 크기·메모리 우위. 파일 시스템 접근이 핵심 요구라 적합 |
| 리치텍스트 노드 | Tiptap(ProseMirror) / Quill | 노트 편집에 **Tiptap**. `realHTML` 필드와 매핑 자연스러움 |
| 렌더링 | SVG (simple-mind-map 기본) | 노드 1만 개 이상 시 Canvas 폴백 검토 |

---

## 4. 최종 채택 권고

```
코어 엔진      simple-mind-map (MIT) — npm 의존, UI는 자체 제작
XMind I/O      자체 구현 (신규)
               ├─ 읽기: preserve-and-patch AST 파서
               ├─ 쓰기: xmind-generator 출력을 정답지로 검증
               └─ 참고: jan-bar/xmind 스키마, xmindparser 판별 로직
UI 셸          React + TypeScript (신규)
데스크톱       Tauri
```

**"코어는 빌려오고, 호환성은 직접 만든다."** — 이것이 이 프로젝트의 한 줄 전략이다.

---

## 참고 자료

- [wanglin2/mind-map (SimpleMindMap)](https://github.com/wanglin2/mind-map)
- [ssshooter/mind-elixir-core](https://github.com/ssshooter/mind-elixir-core)
- [hizzgdev/jsmind](https://github.com/hizzgdev/jsmind)
- [xmindltd/xmind-generator](https://github.com/xmindltd/xmind-generator)
- [xmindltd/xmind-sdk-js](https://github.com/xmindltd/xmind-sdk-js)
- [tobyqin/xmindparser](https://github.com/tobyqin/xmindparser)
- [jan-bar/xmind](https://github.com/jan-bar/xmind)
- [jinzcdev/markxmind](https://github.com/jinzcdev/markxmind)
- [GitHub Topic: mind-mapping](https://github.com/topics/mind-mapping)
