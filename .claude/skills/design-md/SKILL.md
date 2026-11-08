---
name: design-md
description: AI 에이전트가 읽고 특정 브랜드/무드의 UI를 일관되게 재현하도록 하는 DESIGN.md(구글 Stitch 포맷) 문서를 생성·적용하는 스킬. 프로젝트 루트에 DESIGN.md를 두면 코딩/디자인 에이전트가 색상·타이포·컴포넌트·레이아웃 규칙을 그대로 따른다. "DESIGN.md 만들어줘", "이 브랜드처럼 디자인", "디자인 시스템 문서 작성", "stripe/vercel/apple 느낌 UI 규칙", "design.md", "우리 제품 디자인 가이드 md로", "AI가 읽는 디자인 시스템" 등의 요청 시 사용. awesome-design-md(VoltAgent) 포맷 기반.
---

# design-md

`DESIGN.md`는 디자인 에이전트가 읽어 UI를 일관되게 생성하도록 만든 **플레인 텍스트 디자인 시스템 문서**다(구글 Stitch 개념). 프로젝트 루트에 두면 "이 문서처럼 만들어줘" 한 마디로 픽셀 단위까지 톤이 맞는 UI를 얻는다. 파싱·툴링이 필요 없고 Markdown이라 LLM이 가장 잘 읽는다.

- `AGENTS.md` = 코딩 에이전트용(어떻게 빌드하나)
- `DESIGN.md` = 디자인 에이전트용(어떻게 보이고 느껴지나)

## DESIGN.md 표준 구조 (9섹션)

생성하는 모든 DESIGN.md는 아래 순서를 따른다.

| # | 섹션 | 담는 내용 |
|---|------|-----------|
| 1 | Visual Theme & Atmosphere | 무드, 밀도, 디자인 철학 |
| 2 | Color Palette & Roles | 시맨틱 이름 + HEX + 기능적 역할 |
| 3 | Typography Rules | 폰트 패밀리, 전체 위계 표(크기/굵기/행간) |
| 4 | Component Stylings | 버튼·카드·입력·내비 + 상태(hover/active/disabled) |
| 5 | Layout Principles | 스페이싱 스케일, 그리드, 여백 철학 |
| 6 | Depth & Elevation | 그림자 시스템, 표면 위계 |
| 7 | Do's and Don'ts | 디자인 가드레일·안티패턴 |
| 8 | Responsive Behavior | 브레이크포인트, 터치 타깃, 접힘 전략 |
| 9 | Agent Prompt Guide | 색상 빠른참조 + 바로 쓰는 프롬프트 |

## 작업 절차

### A. 새 DESIGN.md 생성 (브랜드/무드 기반)
1. 대상 입력을 받는다: 브랜드명, 참고 스크린샷/URL, 또는 무드 설명("미니멀·고대비·핀테크").
2. 색상은 **시맨틱 이름 + HEX + 역할**을 함께 적는다(예: `primary #635BFF — 주요 CTA·링크`). 역할 없는 색 나열 금지.
3. 타이포는 표로 위계를 모두 적는다(Display/H1/H2/Body/Caption × 크기·굵기·행간).
4. 9섹션을 모두 채우고, 마지막 9번에 "이 디자인으로 로그인 페이지 만들어줘" 식 즉시 사용 프롬프트를 넣는다.
5. 결과는 프로젝트 루트의 `DESIGN.md`로 저장한다.

### B. 기존 DESIGN.md 적용 (UI 생성)
1. 프로젝트 루트의 `DESIGN.md`를 먼저 읽는다.
2. 2~6섹션의 토큰(색/폰트/스페이싱/그림자)을 **그대로** 코드에 반영한다. 임의 색·폰트 추가 금지.
3. 7번 Do's/Don'ts를 체크리스트로 검증한 뒤 산출한다.

## 브랜드 레퍼런스 인덱스 (awesome-design-md, 58종)

airbnb, airtable, apple, bmw, cal, claude, clay, clickhouse, cohere, coinbase, composio, cursor, elevenlabs, expo, ferrari, figma, framer, hashicorp, ibm, intercom, kraken, lamborghini, linear.app, lovable, minimax, mintlify, miro, mistral.ai, mongodb, notion, nvidia, ollama, opencode.ai, pinterest, posthog, raycast, renault, replicate, resend, revolut, runwayml, sanity, semrush, sentry, spacex, spotify, stripe, supabase, superhuman, tesla, together.ai, uber, vercel, voltagent, warp, webflow, wise, x.ai, zapier

- 각 브랜드의 **완성 DESIGN.md 원문**은 `https://getdesign.md/<brand>/design-md` 에 있다(예: `getdesign.md/stripe/design-md`).
- 주의: 일부 실행 환경은 네트워크 정책상 `getdesign.md` 접속이 차단될 수 있다. 차단 시 원문을 가져오지 못하므로, 그 사실을 사용자에게 알리고 위 9섹션 포맷으로 직접 작성하거나(브랜드 공개 가이드·스크린샷 근거) 네트워크 허용을 안내한다. 원문을 보지 못한 채 특정 브랜드의 정확한 HEX·폰트를 추측해 단정하지 않는다.

## 연계

- 테마 프리셋 적용은 `theme-factory`, Anthropic 브랜드 적용은 `brand-guidelines` 스킬과 함께 쓴다.
- 차트/대시보드 색은 `dataviz` 스킬 규칙을 따른다.
