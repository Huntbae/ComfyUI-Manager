# naver-blog-auto-writer

playwright-core + 시스템 크로미움으로 네이버 스마트에디터에 제목·본문을
사람 속도로 타이핑하고, 문단 사이에 이미지를 넣고, **임시저장까지만** 하는 도구.
(발행은 사람이 검토 후 직접 — 사고 방지 + 계정 보호)

## 요구사항

- Node 18+ (`npm run check`로 점검)
- 크로미움: 기본 `/opt/pw-browsers/chromium`, 다른 경로는 `CHROMIUM_PATH`로 지정
- 네이버 **부계정 권장** (자동화는 본인 계정 책임)

## 1. 쿠키 저장 (최초 1회)

비밀번호 로그인 대신 NID 쿠키를 재사용한다.

1. 크롬에서 naver.com 로그인 ("로그인 상태 유지" 체크)
2. F12 → Application 탭 → Cookies → https://www.naver.com
3. 필터에 `NID` 입력 → `NID_AUT`, `NID_SES` 값 복사
   - 필터에 아무것도 안 나오면 그 창은 로그인이 안 된 상태다
4. 저장:

```bash
NID_AUT='값' NID_SES='값' node index.js cookies
```

쿠키는 `.auth/cookies.json`(.gitignore 경로)에 저장된다.
**NID 쿠키는 아이디+비번급 민감정보다. 공개 채팅방·저장소에 올리지 말 것.**

## 2. 글 쓰기

```bash
node index.js post --blog 블로그ID --title "제목" --file content.txt \
  --images photo1.jpg,photo2.jpg
```

- 크롬이 뜨고 → 제목이 또박또박 → 본문이 문단별로 → 사진이 문단 사이에 → 임시저장
- 전 과정 녹화 영상이 `out/`에 저장된다 (`--no-record`로 끌 수 있음)
- 발행: 네이버 블로그 앱/웹에서 초안 열어 검토 후 발행 버튼만 누르면 됨

## 반영된 실전 함정 6가지

1. **"취소" ≠ "취소선"** — 복구 팝업의 취소 버튼은 팝업 범위 안에서 텍스트
   정확 일치(text-is)로만 찾는다. 부분 일치로 찾으면 툴바 "취소선"을 눌러
   본문 전체가 취소선으로 써진다.
2. **진입 URL은 신형만** — `blog.naver.com/{블로그ID}/postwrite`.
   구형(GoBlogWrite.naver 등)은 재로그인으로 튕긴다.
3. **복구 팝업 처리** — 에디터 진입 시 "작성 중인 글 복구" 팝업이 뜨면
   팝업 안의 "취소"(=새로 쓰기)를 누른다.
4. **쿠키 형식** — domain(`.naver.com`)/path(`/`) 누락 시 "domain/path pair"
   에러로 전체 실패. 쿠키를 하나씩 주입해 실패 시 범인을 특정한다.
5. **녹화용 ffmpeg** — Playwright 녹화는 번들 ffmpeg가 필요. 없으면:
   `ln -s $(which ffmpeg) $PLAYWRIGHT_BROWSERS_PATH/ffmpeg-<버전>/ffmpeg-linux`
6. **문제 추적은 녹화로** — 스크린샷 한 장으론 언제부터 꼬였는지 모른다.
   `out/`의 영상을 몇 초 간격으로 잘라 확인하면 문제 지점이 바로 보인다.

## 안전 수칙

| 항목 | 권장 |
|------|------|
| 계정 | 부계정으로 시작 |
| 발행 | 자동 저장 + 사람이 검토 후 발행 |
| 빈도 | 하루 1~2건 (대량 자동발행 금지) |
| 속도 | 사람 속도 타이핑(delay) 유지 |
| 쿠키 | gitignore 경로 보관, 공개 금지 |

참고: 네이버 공식 "글쓰기 API"는 없다(오픈 API는 검색만 제공, 2026 기준).
그래서 실제 에디터를 조작하는 방식이며, 그만큼 계정 보호 수칙을 지켜야 한다.
