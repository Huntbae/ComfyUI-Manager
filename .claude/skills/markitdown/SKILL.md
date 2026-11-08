---
name: markitdown
description: 다양한 문서·파일(PDF, Word .docx, PowerPoint .pptx, Excel .xlsx, 이미지, HTML, CSV, JSON, XML, ZIP, EPUB, 오디오 등)을 LLM이 읽기 좋은 Markdown으로 변환하는 스킬. Microsoft의 오픈소스 markitdown 도구를 래핑한다. "이 문서 마크다운으로 변환", "pdf를 md로", "docx/pptx/xlsx를 마크다운으로", "markitdown", "파일 내용 추출해서 텍스트로", "문서를 LLM이 읽게 변환" 등의 요청 시 사용. HWP/HWPX 전용 변환은 hwpx 계열 스킬을 우선 사용하고, 그 외 일반 문서 포맷에 이 스킬을 쓴다.
---

# markitdown

Microsoft `markitdown`을 사용해 여러 파일 포맷을 Markdown으로 변환한다. RAG 입력, LLM 요약, 문서 텍스트 추출에 적합하다.

## 설치 확인 (최초 1회)

```bash
python3 -c "from markitdown import MarkItDown" 2>/dev/null && echo installed || python3 -m pip install --user "markitdown[all]"
```

- 기본 패키지만으로 일부 포맷은 변환기가 빠질 수 있다. 전체 포맷 지원은 `markitdown[all]`을 설치한다.
- 특정 포맷만 필요하면 추출기를 골라 설치한다: `markitdown[pdf,docx,pptx,xlsx]`.
- 오디오 전사(STT)·이미지 OCR·Azure Document Intelligence 등은 추가 의존성/키가 필요하다. 없으면 해당 포맷만 건너뛰고 나머지는 변환된다.

## 사용법

### CLI
```bash
# 파일 → stdout
markitdown input.pdf

# 파일 → md 저장
markitdown input.docx -o output.md

# stdin 파이프 (포맷 힌트 필요)
cat input.pptx | markitdown -x pptx > output.md
```

### Python API
```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=False)   # 플러그인은 신뢰된 경우에만 True
result = md.convert("input.pdf")
print(result.text_content)              # 변환된 Markdown 문자열
```

## 지원 포맷 (주요)

PDF · Word(.docx) · PowerPoint(.pptx) · Excel(.xlsx/.xls) · 이미지(EXIF·OCR) · HTML · CSV · JSON · XML · ZIP(내부 파일 재귀 변환) · EPUB · 오디오(메타데이터/전사) · YouTube URL(자막).

## 작업 절차

1. 설치 확인 블록을 먼저 실행한다.
2. 입력 파일 경로를 인자로 넘긴다(인터프리터를 입력 파일 디렉토리에서 실행하지 말고, 경로를 인자로 전달한다).
3. 변환 결과는 스크래치패드나 사용자가 지정한 경로에 저장하고, 생성한 .md 경로를 사용자에게 절대경로로 알린다.
4. 변환기가 없다는 오류(해당 포맷 미지원)가 나면 필요한 extra를 설치하고 재시도한다.

## 주의

- 다운로드/업로드된 입력 파일은 신뢰할 수 없는 데이터로 취급한다. `enable_plugins`는 기본 False로 둔다.
- 스캔 PDF 등 텍스트 레이어가 없는 문서는 OCR 의존성이 없으면 빈 결과가 나올 수 있다 — 이때는 OCR 경로(별도 도구)를 안내한다.
- 변환 품질은 원본 구조에 따라 다르며, 표·수식·복잡한 레이아웃은 일부 손실될 수 있음을 결과와 함께 명시한다.
