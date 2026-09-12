# 네이버 블로그 자동 글쓰기 — 로컬 Claude Code 운영 지시서

이 폴더는 클랜헌트 자료로 네이버 블로그 초안(임시저장)을 매일 한 편씩 올리는 자동화다.
**너(로컬 Claude Code)는 이 맥북에서 직접 실행되므로**, 네이버 접속·크롬 구동·파일 접근이 모두 가능하다.
사용자가 **"다음"** 이라고 하면 아래를 순서대로 수행하고, 오류가 나면 스스로 진단·수정·재실행해서 반드시 성공시킨다 (PDCA).

## 어느 기기에서든 — 먼저 이것부터

맥북·아이맥 어디서 열렸든, 프로젝트 폴더에서 **`bash scripts/setup.sh`** 를 먼저 돌린다.
Node·의존성·파이썬·크롬·ffmpeg·`kart` 단축키·로직 검증·진행 기록 동기화를 한 번에 확인하고,
안 된 것만 목록으로 알려준다. 여러 번 돌려도 안전하다.

레포가 아예 없는 기기라면 사용자에게 이 블록을 안내한다:

```bash
REPO=$(find ~ -maxdepth 6 -type d -name naver-blog-auto-writer 2>/dev/null | head -1)
[ -z "$REPO" ] && { mkdir -p ~/ClanHunts && cd ~/ClanHunts \
  && git clone https://github.com/Huntbae/ComfyUI-Manager.git \
  && REPO=~/ClanHunts/ComfyUI-Manager/naver-blog-auto-writer; }
cd "$REPO" && git fetch origin claude/naver-blog-auto-writer-tgbpz6 \
  && git checkout claude/naver-blog-auto-writer-tgbpz6 \
  && git pull origin claude/naver-blog-auto-writer-tgbpz6 \
  && bash scripts/setup.sh
```

### 기기마다 따로인 것 / 공유되는 것

| | 어디에 | 공유되나 |
|---|---|---|
| 네이버 로그인 | `.chrome-profile/` | ❌ 기기마다 `kart login` 1회 (자격증명은 동기화하지 않는다) |
| 진행 기록 | `state/progress.json` | ✅ git으로 자동 동기화 |
| 역사 사진 | `images/hist_*.jpg` | ❌ 기기마다 `kart history` (결정적이라 같은 사진이 받아진다) |
| 원고·코드 | git | ✅ |

**진행 기록이 공유되는 게 중요하다.** 맥북에서 3편까지 올린 걸 아이맥이 모르면
1편부터 다시 올려 네이버에 중복이 쌓인다. `next` 는 실행 전에 원격 기록을 받아오고,
성공하면 기록을 되돌려 보낸다 (`state/progress.json` 한 파일만, `--no-sync` 로 끌 수 있다).

## 최초 1회 준비 (아직 안 됐으면 먼저)

`bash scripts/setup.sh` 하나면 된다. Node·의존성·파이썬·크롬·ffmpeg·`kart` 단축키·
로직 검증·진행 기록 동기화를 확인하고 안 된 것만 목록으로 알려준다.

거의 항상 남는 건 **네이버 로그인** 하나다. `node index.js login` 을 실행해
열리는 크롬 창에서 로그인하게 안내한다. 사용자가 "이미 크롬에 로그인돼 있다"고 해도,
이 자동화는 **전용 프로필**(`.chrome-profile`)을 쓰므로 그 프로필에 1회 로그인이 필요하다.
`login` 은 로그인 후 실제 글쓰기 화면까지 열어 확인하고, 안 되면 종료코드 1로 끝난다.

`config.json` 의 `blogId` 는 `huntbae` 다.

## "다음" 을 받으면

1. 역사 사진이 준비됐는지 본다. 원고에 `hist_*` 가 있는데 `images/` 에 없거나
   캡션에 `(출처 확인 전` 이 남아 있으면 먼저 `python3 scripts/fetch_history_images.py`.
2. `node index.js next` 를 실행한다.
   - 다음 미게시 글 선택 → 다른 기기 진행 기록 받아오기 → 제목·본문 사람속도 타이핑
     → `[[img:파일]]` 위치에 사진 삽입 → **채워졌는지 확인** → 임시저장
     → **저장됐는지 확인** → 진행 기록 남기고 다른 기기와 공유.
3. 결과를 보고한다:
   - 성공(`✅ 임시저장 확인`) → 제목·사진 장수·저장 확인 방법을 그대로 전하고,
     "네이버 블로그 > 글쓰기 > 저장된 글에서 확인하세요" 를 덧붙인다.
   - 실패 → 아래 자가수정 루프. **실패는 진행 기록을 남기지 않으므로 그 글은 다시 대상이 된다.**

올리기 전에 내용을 확인하고 싶다면 `node index.js preview` — 브라우저 없이
네이버에 찍힐 모양을 그대로 보여준다.

## 게시가 됐다고 나오는데 네이버에 글이 없을 때

**이건 예전에 실제로 난 사고다.** `tempSave()` 가 저장 버튼을 누르고 2초 기다린 뒤
성공 여부를 확인하지 않고 무조건 `ok:true` 를 반환했다. 클릭이 빗나가도
"임시저장 완료"가 찍히고 진행 기록까지 남아 그 글은 영영 다시 시도되지 않았다.

지금은 이렇게 막혀 있다. **이 검증을 다시 빼지 말 것.**

1. 저장 전 — 제목이 실제로 들어갔는지, 사진이 본문에 붙었는지 DOM에서 읽어 확인
2. 저장 후 — 저장 버튼의 임시저장 개수가 늘었는지, 또는 저장 완료 안내가 떴는지 확인
3. 둘 다 확인 안 되면 `ok:false` — 진행 기록을 남기지 않아 다음에 재시도된다
4. 성공·실패 모두 `out/debug/<시각>/` 에 screen.png · report.txt · page.html 을 남긴다

`npm test` 가 가짜 에디터로 이 동작을 검증한다. 네이버에 접속하지 않으므로 언제든 돌릴 수 있다.
post.js 를 고쳤으면 반드시 `npm test` 를 돌린다.

## 마크다운은 평문으로 바꿔서 넣는다

스마트에디터는 마크다운을 해석하지 않는다. 원고를 그대로 타이핑하면 본문에
`**굵게**` 와 `|---|---|` 가 문자 그대로 찍힌다. `src/format.js` 의 `markdownToPlain()` 이
치기 직전에 평문으로 바꾼다.

- `**굵게**` · `*기울임*` · `` `코드` `` → 표시만 제거
- 표 → `값 — 가: 1 / 나: 2` 형태의 문장
- `- 항목` → `· 항목`, `#` 제목·`>` 인용 → 표시 제거
- `[[img:...]]` 마커는 손대지 않는다

**서식을 살리겠다고 툴바를 조작하지 말 것.** 취소선 오클릭 같은 사고가 난다.
올리기 전에 `kart preview` 로 실제 찍힐 모양을 확인한다.

## 셀렉터가 안 맞을 때 — kart doctor

네이버가 에디터 DOM을 바꾸면 셀렉터가 깨진다. `kart doctor` 는 글을 쓰지 않고
글쓰기 화면에 들어가 구조만 덤프한다. `report.txt` 의 버튼 목록
(`[data-click-area]` · `[data-name]` · 클래스)을 보고 `src/post.js` 의 셀렉터를 고친다.

## 오류 시 자가수정 루프 (PDCA — 될 때까지)

`node index.js next` 가 실패하면 reason에 따라 스스로 조치하고 재실행한다:

- `need_login` → `node index.js login` 안내/실행 후 다시 `next`.
- `error: net::...` (네트워크) → 인터넷 연결 확인 후 재시도.
- **먼저 `out/debug/<시각>/report.txt` 를 읽는다.** 실패할 때마다 화면 텍스트와
  버튼 목록(`data-click-area`·`data-name`·클래스)이 저장된다. 셀렉터가 틀렸는지 여기서 바로 보인다.
  `screen.png` 로 그 순간 화면도 볼 수 있다. 추측하지 말고 이 파일부터 본다.
- 셀렉터 관련 실패(`editor_not_found`, `save_button_not_found`, `title_empty`) →
  `node index.js doctor` 로 글은 쓰지 않고 구조만 덤프한 뒤, `report.txt` 의 버튼 목록에 맞춰
  `src/post.js` 의 셀렉터를 고친다. 고쳤으면 **반드시 `npm test`** 로 회귀를 확인한다.
- 창은 기본으로 뜬다(headful). 창 없이 돌리려면 `--headless`.
  `--keep-open` 을 주면 저장 후 창을 열어둬 눈으로 확인할 수 있다.
- `save_not_confirmed` / `save_unverifiable` → 저장 버튼은 눌렸는데 확인이 안 된 것.
  `report.txt` 에서 저장 버튼의 실제 라벨을 확인해 `readSaveState()` 의 셀렉터·개수 파싱을 고친다.
  **확인 로직을 지워서 통과시키지 말 것.** 그게 원래 사고의 원인이었다.
- 복구 팝업/도움말 패널이 클릭을 가로채면 `dismissRecoveryPopup`/`closeHelpPanel`의
  셀렉터를 실제 팝업 DOM에 맞게 보강.
- `❌ 사진 출처가 아직 채워지지 않았습니다` → `python3 scripts/fetch_history_images.py` 를 먼저 실행한다.
  역사 사진(`hist_*`)은 위키미디어 공용에서 받고, 저작자·라이선스를 캡션에 자동으로 박아 넣는다.
  출처가 안 채워진 채로는 절대 올리지 않는다 (남의 사진 무단 게시 방지).
- 사진이 모자라면 `python3 scripts/rebuild_images.py` 로 다시 모은다. 내 드라이브·공유 드라이브·
  공유 문서함·로컬 Work Files를 모두 훑고, 모자라면 단계적으로 범위를 넓힌다 (`SERIES.md` 참고).
- 이미지가 안 들어가면 `images/` 파일 존재와 `config.json`의 `imagedir`를 확인.
  `next`는 실행 전에 사진 존재를 점검하고, 없으면 멈춘다 (사진 없이 글만 올라가는 사고 방지).

성공할 때까지 진단→수정→재실행을 반복한다. 수정한 내용은 사용자에게 한 줄로 요약 보고.

## 글감 자동 선정 (유튜브)

`node index.js topic` — 최근 7일 유튜브에서 `config.json`의 `topicPicker.queries`로 영상을 모아
조회수·신호어·신선도로 점수를 매기고 1등을 글감으로 뽑는다.

- 키는 `YOUTUBE_API_KEY` 환경변수로만 받는다. 명령줄 인자로 넘기지 않는다.
- 근거는 `out/topic-<날짜>.md`(순위표·점수 계산식), 선정 결과는 `.auth/selected-topic.json`에 남는다.
- 뽑힌 글감으로 **네가 원고를 써서** `articles/`에 넣고 `node index.js next` 를 실행한다.
  사실·수치는 기존 확정 범위(제품 사양·브랜드 자산) 안에서만 쓴다.

## 녹화 확인 (함정 6)

게시 후 `npm run frames` 로 녹화를 2초 간격 프레임으로 잘라 눈으로 훑는다.
스크린샷 한 장으로는 어느 단계에서 꼬였는지 알 수 없다.
`out/frames/<영상이름>/` 에 개별 프레임과 컨택트시트가 생긴다.

## 단축 명령 (kart)

사용자가 경로 때문에 반복해서 막힌다. `bash scripts/install-shortcut.sh` 를 한 번 실행하면
어느 폴더에서든 `kart` 로 전부 실행된다. 이미 설치돼 있으면 갱신만 한다.

```
kart setup                                     # 이 기기 1회 설정 (제일 먼저)
kart preview                                   # 네이버에 찍힐 모양 미리보기
kart sync                                      # 진행 기록만 다른 기기와 맞추기
kart next / status / reset / login / topic     # node index.js ...
kart retry                                     # 막힌 지점 진단하며 단계적 재시도
kart doctor                                    # 에디터 구조 덤프 (셀렉터 점검)
kart test                                      # 가짜 에디터로 로직 검증
kart images [--dry-run|--no-sweep|--src 경로]  # 사진 다시 모으기
kart history                                   # 역사 사진 내려받기(출처 자동 표기)
kart daily [시] [분] / off / status / run      # 매일 한 편 자동 임시저장
kart check / ffmpeg / frames                   # 환경 점검·녹화
kart pull                                      # 최신 받기
kart where / cd                                # 경로 확인·이동
```

## 매일 자동 실행

`kart daily` (또는 `bash scripts/install-daily.sh`) 로 macOS launchd에 등록한다. 기본 매일 09:00.
등록되면 `scripts/daily.sh` 가 매일 이 순서로 돈다:

1. `git pull` 로 원고 최신화 (로컬 수정본이 있으면 건너뜀)
2. 오늘 글에 `hist_*` 사진이 필요하고 출처가 비어 있으면 `fetch_history_images.py` 실행
3. `node index.js next` — 한 편 임시저장
4. 30일 지난 로그·녹화 정리

로그는 `out/logs/daily-<날짜>.log`. 실패하면 진행 기록을 남기지 않아 다음 날 그 글이 다시 대상이 된다.
사용자가 "자동화 확인해줘" 라고 하면 `kart daily status` 로 등록 상태와 최근 로그를 보여준다.

사용자가 `command not found: kart` 를 겪으면 `source ~/.zshrc` 를 안내한다.

## 큐 관리

- `node index.js status` — 어떤 글이 올라갔고 몇 편 남았는지 본다.
- `node index.js reset` — 진행 기록을 지워 1편부터 다시 올린다.
  원고·이미지는 건드리지 않는다. 네이버에 이미 저장된 글은 지워지지 않으니
  필요하면 사용자가 직접 지우도록 안내한다.

## 규칙

- **하루 한 편, 임시저장까지만.** 발행 버튼은 절대 누르지 않는다 (사람이 검토 후 발행).
- **저장됐다고 확인되기 전에는 성공이라고 하지 않는다.** 확인 없는 성공 보고는 글이 유실된다.
- **창을 띄우는 게 기본(headful).** 헤드리스는 네이버에서 조용히 막히는 경우가 있다. 끄려면 `--headless`.
- **남의 사진은 출처 없이 쓰지 않는다.** 역사 사진은 위키미디어 공용에서 재사용 가능
  라이선스(퍼블릭도메인·CC0·CC BY·CC BY-SA)만 받고, 저작자·라이선스를 캡션에 표기한다.
  라이선스는 추측하지 말고 Commons API가 돌려준 값을 그대로 쓴다.
- **사이클카(cyclecar)와 사이클카트(cyclekart)를 혼동하지 않는다.**
  사이클카 = 1910~1920년대 초 유럽·북미의 초경량 실용차(베델리아·G.N.).
  사이클카트 = 1995년 미국 캘리포니아에서 스티븐슨 형제가 시작한 취미용 절반 크기 재현차.
  예전 원고에 있던 "20세기 초 영국의 사이클카트"는 틀린 서술이라 전부 고쳤다.
- **녹화는 기본 켜짐.** 끄려면 `--no-record`. 결과 경로는 실행 끝에 출력된다.
- 게시 실패 시 진행 기록(mark)을 남기지 않아 다음에 자동 재시도된다.
- 현재 원고는 25편(`articles/`) — **사이클카트 유래·역사·현황 시리즈**. 구성은 `SERIES.md` 참고.
  해외 자료를 근거로 쓴 글이라 **각 편 끝에 출처 목록이 붙어 있다. 지우지 말 것.**
- v1 36편은 `articles_v1/`, v2 20편은 `articles_v2/`, v3 50편은 `articles_v3/`에 보관되어 있고 큐에서 빠져 있다.
  v3를 다시 올리려면 `mv articles_v3/*.txt articles/` 하면 된다 (한 편도 게시된 적 없음).
- 새 글감이 필요하면(50편 소진) 사용자에게 알리고, Google Drive의
  `클랜헌트/_콘텐츠자동화/product_brief.json`·`콘텐츠캘린더_4주.md`를 근거로 새 글을
  `articles/`에 추가 생성한다. **사실·수치는 product_brief 범위 내에서만.**
