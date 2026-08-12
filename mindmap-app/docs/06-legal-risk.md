# 06. 법적·라이선스 검토

> ⚠️ **면책**: 이 문서는 공개 자료를 근거로 한 기술 실무 관점의 정리이며 법률 자문이 아니다.
> 상업적 배포 전에는 반드시 변호사 검토를 받을 것. 특히 상표·트레이드드레스 항목이 그렇다.

---

## 1. 파일 포맷 호환 — 문제 없음

**결론: `.xmind` 파일을 읽고 쓰는 것 자체는 정당하다.**

근거:

1. **XMind 3은 EPL v1.0 + LGPL v3 듀얼 라이선스 오픈소스였다.** 소스코드가 공개돼 있고
   ([juliuskunze/xmind](https://github.com/juliuskunze/xmind)), 당시 포맷은
   OpenDocument/OOXML 원칙을 따르는 **공개 포맷(open format)으로 명시**되어 있었다.
2. **Xmind가 직접 MIT 라이선스로 파일 생성 SDK를 공개했다** —
   [`xmindltd/xmind-generator`](https://github.com/xmindltd/xmind-generator),
   [`xmindltd/xmind-sdk-js`](https://github.com/xmindltd/xmind-sdk-js).
   제3자가 `.xmind` 파일을 만들 수 있게 회사가 스스로 도구를 제공한 것이다.
3. 일반론적으로 **파일 포맷 자체(데이터 구조·인터페이스)는 저작권 보호 대상으로 보기 어렵고**,
   상호운용성을 위한 구현은 광범위하게 인정되어 왔다.

**따라서 리버스 엔지니어링·파서 구현·읽기/쓰기 지원은 진행해도 된다.**

---

## 2. 상표 · 트레이드드레스 — 여기가 진짜 위험 지점

`.xmind` 파일 호환은 괜찮지만, **"xmind.net과 동일한 앱"을 문자 그대로 만드는 것은 위험하다.**

### ❌ 하지 말아야 할 것

| 항목 | 이유 |
|---|---|
| "XMind" 를 제품명·도메인·앱 이름에 사용 | 상표권 침해 |
| Xmind 로고·워드마크 사용 | 상표권 침해 |
| Xmind 앱에서 아이콘/마커 **이미지 파일을 추출해 재배포** | 저작권 침해 |
| Xmind 내장 테마의 그래픽 리소스(배경·손그림 텍스처 등) 복사 | 저작권 침해 |
| UI를 픽셀 단위로 복제해 혼동을 유발 | 트레이드드레스 분쟁 소지 |
| Xmind 앱 바이너리를 디컴파일해 코드를 옮겨 심기 | 저작권 침해 + EULA 위반 |

### ✅ 해도 되는 것

| 항목 | 이유 |
|---|---|
| `.xmind` 파일 읽기/쓰기 | §1 |
| 동일한 **기능 집합** 제공 (구조 종류, 요약·경계선·관계선 등) | 기능·아이디어는 저작권 대상 아님 |
| 업계 관행적 키보드 단축키 (Tab/Enter 등) | 사실상 표준 |
| 일반적 편집기 레이아웃 (툴바 상단, 속성 우측, 캔버스 중앙) | 산업 공통 패턴 |
| **"XMind 파일과 호환됩니다"** 라는 사실적 서술 | 명목적 사용(nominative use). 단 "XMind의 제품이다/제휴했다"는 인상을 주면 안 됨 |
| `markerId` 문자열 보존 | 데이터 식별자일 뿐 |

### 실무 지침

- **제품명은 XMind와 무관한 새 이름**을 쓴다.
- 마커·아이콘은 **직접 그리거나 오픈 라이선스 세트**(Lucide MIT, Phosphor MIT, Material Symbols Apache-2.0)를
  `markerId → 우리 아이콘` 매핑 테이블로 연결한다.
  → 왕복 호환은 유지되고 에셋 저작권 문제는 사라진다.
- 테마도 **이름과 색상 팔레트를 우리가 새로 정의**하고, 원본 테마 객체는 파일 안에서 보존만 한다.
- 홍보 문구는 `"Compatible with .xmind files"` 수준으로. `"XMind Pro"` 같은 표현 금지.

---

## 3. 사용할 오픈소스의 라이선스 의무

| 프로젝트 | 라이선스 | 의무 | 상용화 가능 |
|---|---|---|---|
| `simple-mind-map` | **MIT** | 저작권 고지 + 라이선스 전문 포함 | ✅ |
| `xmind-generator` | **MIT** | 동일 | ✅ |
| `xmind-sdk-js` | **MIT** | 동일 | ✅ |
| `xmindparser` | **MIT** | 동일 | ✅ |
| `mind-elixir-core` | **MIT** | 동일 | ✅ |
| `jsMind` | **BSD** | 고지 + (3-clause라면) 이름 이용 광고 금지 | ✅ |
| `Yjs` | MIT | 고지 | ✅ |
| `fflate` | MIT | 고지 | ✅ |
| Tiptap | MIT (일부 Pro 확장은 상용) | Pro 확장 사용 시 유료 | ⚠️ 확장별 확인 |
| Tauri | MIT / Apache-2.0 | 고지 | ✅ |
| **Freeplane** | **GPL** | **파생물 전체 GPL 전염** | ❌ **코드 차용 금지** |
| `kityminder-core` | BSD | 고지 | ✅ (단 유지보수 중단) |
| `jan-bar/xmind` | 미확인 | **확인 필요** | ⚠️ |
| `markxmind` | 미확인 | **확인 필요** | ⚠️ |

### 반드시 지킬 것

1. **GPL 프로젝트(Freeplane 등)의 코드는 한 줄도 복사하지 않는다.**
   포맷 아이디어를 "보고 배우는" 것과 코드를 옮기는 것은 다르다. 후자는 전염된다.
2. `simple-mind-map`을 **포크(vendoring)하는 경우 MIT 고지 파일을 반드시 유지**하고,
   원본 저작권 표시를 지우지 않는다.
3. 배포물에 **`THIRD-PARTY-NOTICES.md`** 를 자동 생성해 포함한다
   (`license-checker` 등으로 CI에서 생성).
4. 라이선스 미확인 항목(`jan-bar/xmind`, `markxmind`)은 **코드를 쓰기 전에 확인**한다.
   스키마를 "읽고 이해하는" 참고 용도는 문제없지만 코드 이식은 라이선스 확인 후.

---

## 4. 사용자 데이터 관점

로컬 우선(local-first) 설계는 법적으로도 유리하다.

- 서버에 맵 데이터를 저장하지 않으면 **개인정보 처리 범위가 극적으로 축소**된다.
- AI 기능을 붙이는 순간(Phase 5) 사용자 콘텐츠가 외부 API로 나간다 →
  **명시적 옵트인 + 개인정보처리방침 고지**가 필요해진다. 기본값은 off.
- 협업 서버를 운영하면 그때부터 GDPR/개인정보보호법 적용 대상이 된다.
  Phase 4 이전에 이 결정을 내리지 말 것.

---

## 5. 체크리스트 (배포 전)

- [ ] 제품명·도메인이 XMind 상표와 혼동 가능성 없음
- [ ] 앱에 Xmind 로고/워드마크 미사용
- [ ] 모든 아이콘/이미지 에셋이 자체 제작 또는 오픈 라이선스 (출처 기록됨)
- [ ] `THIRD-PARTY-NOTICES.md` 생성 및 포함
- [ ] GPL 코드 유입 없음 (의존성 트리 스캔)
- [ ] 라이선스 미확인 의존성 0건
- [ ] 홍보 문구가 제휴·인증을 암시하지 않음
- [ ] AI/클라우드 기능이 있다면 기본 off + 옵트인 + 처리방침 고지
- [ ] 변호사 최종 검토 완료

---

## 참고 자료

- [juliuskunze/xmind (XMind 3 원본, EPL/LGPL)](https://github.com/juliuskunze/xmind)
- [xmindltd/xmind-generator (Xmind 공식, MIT)](https://github.com/xmindltd/xmind-generator)
- [xmindltd/xmind-sdk-js (Xmind 공식, MIT)](https://github.com/xmindltd/xmind-sdk-js)
- [XMind — Wikipedia](https://en.wikipedia.org/wiki/XMind)
- [XMind Open-Source 정리](https://docsopensource.github.io/docs/Popular_Projects/6.85_XMind)
