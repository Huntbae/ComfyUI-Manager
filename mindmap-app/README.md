# XMind 호환 마인드맵 앱 — 자료조사 및 개발 전략

XMind(.xmind) 파일을 **읽고 · 편집하고 · 다시 저장**할 수 있는 마인드맵 앱을 만들기 위한
사전 조사 결과와 개발 전략 문서 모음입니다.

## 목표

1. 기존에 XMind로 만든 `.xmind` 파일을 **손실 없이 열어서 편집하고 다시 저장**한다.
2. xmind.net(Xmind 웹/데스크톱)의 핵심 기능과 UX를 분석해 동등한 수준의 편집 경험을 제공한다.
3. GitHub 등의 오픈소스를 최대한 활용해 개발 기간과 리스크를 줄인다.

## 문서 목차

| 문서 | 내용 |
|---|---|
| [01. XMind 파일 포맷 분석](docs/01-xmind-format.md) | `.xmind` 아카이브 구조, `content.json` 스키마, 레거시 XML 포맷, 왕복(round-trip) 보존 전략 |
| [02. 오픈소스 지형 조사](docs/02-oss-landscape.md) | 후보 라이브러리 12종 비교, 라이선스, 채택 권고 |
| [03. Xmind 기능·디자인 분석](docs/03-feature-analysis.md) | 기능 인벤토리, 우선순위(MoSCoW), UX/디자인 패턴 |
| [04. 아키텍처 및 기술 스택](docs/04-architecture.md) | 레이어 설계, 데이터 모델, 렌더링/명령/영속성 계층, 배포 형태 |
| [05. 개발 로드맵](docs/05-roadmap.md) | 6단계 마일스톤, 산출물, 검증 기준, 리스크 대응 |
| [06. 법적·라이선스 검토](docs/06-legal-risk.md) | 포맷 호환의 적법성, 상표/트레이드드레스, OSS 라이선스 의무 |
| **[07. 실측 결과](docs/07-corpus-measurement.md)** | 📊 **실제 `.xmind` 5개(252 토픽) 분석 — 스키마 확정, 왕복 게이트 통과** |

## 분석 도구

`tools/` 에 실행 가능한 스크립트가 있다. 새 샘플이 생기면 바로 돌려볼 수 있다.

```bash
mkdir -p corpus/f1 && unzip -q your.xmind -d corpus/f1
python3 tools/schema_extract.py corpus   # JSON 경로·타입·샘플값 집계
python3 tools/topic_fields.py   corpus   # Sheet/Topic 필드 인벤토리
python3 tools/roundtrip.py      corpus /path/to/xmind/files   # 왕복 게이트
```

## 30초 요약

- **베이스 채택**: `simple-mind-map`(MIT, 12.6k★)을 코어 엔진으로 포크/의존한다.
  XMind import/export가 이미 구현되어 있고 구조·테마·노드 요소가 Xmind와 가장 근접하다.
- **차별화 지점**: 이 라이브러리의 XMind 지원은 **비손실(lossless)이 아니다.**
  경계선(boundary)·관계선·플로팅 토픽·마커·다중 시트 등이 왕복 시 유실된다.
  → **"무손실 왕복"을 제품의 1번 기능으로 삼는다.** 이것이 기존 OSS 대비 유일한 해자다.
- **핵심 기술 결정**: 원본 `.xmind` ZIP을 통째로 보관하고, 편집한 필드만 덮어쓰는
  **패치형 저장(preserve-and-patch)** 방식을 채택한다. 파싱하지 못한 필드도 그대로 살아남는다.
  → **실제 파일 5개로 검증 완료. 무편집 왕복이 바이트 단위로 동일하다.**
- **배포 형태**: 웹(브라우저 로컬 파일 편집) → Tauri 데스크톱 → 협업 서버 순으로 확장.

## 실측 검증 현황 (Phase 0)

실제 Xmind로 작성된 `.xmind` 5개(252 토픽)를 분석했다. [상세](docs/07-corpus-measurement.md)

| 항목 | 결과 |
|---|---|
| 무편집 왕복 무손실 | ✅ **5/5 통과** |
| `content.json` 바이트 동등 | ✅ **5/5 통과** (예상보다 강한 보증) |
| naive 파서(기존 OSS) 유실량 | ❌ **131개 데이터 포인트** — 플로팅 토픽 3, 관계선 18, 이미지 1 포함 |
| 스키마 확정 | detached · image · position · customWidth · attributedTitle · relationships |
| 미확정 | 마커 · 경계선 · 요약 · 말풍선 (**해당 기능을 쓴 샘플 필요**) |

### 실측으로 드러난 함정 3가지

1. **`content.xml`은 콘텐츠가 아니라 경고 스텁이다.** modern 파일에도 들어 있고
   5개 파일 MD5가 동일하다. 이걸 먼저 읽는 파서는 사용자 맵 대신 "경고"를 연다.
2. **`manifest.json`은 완전한 등록부가 아니다.** `content.xml`이 실재하는데 등록돼 있지 않다.
   재생성하지 말고 리소스 항목만 증분 동기화해야 한다.
3. **`attributedTitle`이 `title`과 텍스트를 이중 저장한다.** 하나만 고치면
   XMind에서 옛 글자가 보인다.

## 다음 단계

1. **마커 · 경계선 · 요약 · 말풍선을 사용한 `.xmind` 샘플 추가 수집** ← 지금 필요한 것
   (추가로 다중 시트, legacy(XMind 8), 대형 맵 1,000+ 노드)
2. `packages/xmind-format` 리더/라이터 구현 — 목표를 **바이트 동등**으로 설정
3. `attributedTitle` 동기화 규칙과 구조 3중 저장 동기화를 테스트로 고정
4. Phase 2 MVP 편집기 착수
