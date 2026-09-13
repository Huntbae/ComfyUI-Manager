#!/usr/bin/env python3
"""
구글 드라이브(맥에 마운트된 CloudStorage)에서 제품 사진을 모아
images/ 를 다시 채우고, articles/ 의 [[img:...]] 마커를 겹치지 않게 재배정한다.

사진은 3단계로 넓혀가며 찾는다. 앞 단계로 채워지면 다음 단계는 실행하지 않는다.
  1단계 정밀 — 파일명·폴더명이 제품과 직접 맞는 것
  2단계 확장 — 활동·부품 키워드 (안전정비 교육, 조립, 아두이노, 시승 ...)
  3단계 전체 — 드라이브 전체 사진 중 품질 기준 통과분 (--no-sweep 으로 끌 수 있음)
서류·판촉물·개인정보성 파일은 모든 단계에서 제외하고, 상대 제품 사진도 섞이지 않게 막는다.
- 같은 이미지를 두 번 이상 쓰지 않는다 (한 편당 2장, 20편 = 40장 전부 서로 다름)
- 편마다 다른 스타일을 입힌다 (비율·톤·마감). 프리셋은 scripts/styles.py 참고.
  한 편 안의 2장은 같은 스타일로 묶어 글이 따로 놀지 않게 한다.

Pillow가 있으면 쓰고, 없으면 macOS 기본 도구 sips로 넘어간다(이 경우 비율까지만).
둘 다 없으면 원본을 복사한다.

사용법:
    python3 scripts/rebuild_images.py --dry-run   # 무엇을 쓸지·어떤 스타일일지 확인만
    python3 scripts/rebuild_images.py             # 수집 + 편별 스타일 + 마커 재배정
    python3 scripts/rebuild_images.py --no-style  # 스타일 없이 가로폭만
    python3 scripts/rebuild_images.py --no-sweep  # 드라이브 전체 훑기 없이 제품 사진만

Ver.5 사진을 따로 갖고 계시면 images_src/edukart_v5/ 에 넣어두면 우선 사용된다.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import styles  # noqa: E402

try:  # Pillow가 없으면 convert()가 sips 폴백으로 넘어간다
    from PIL import Image
except ImportError:
    Image = None

ROOT = Path(__file__).resolve().parent.parent
ARTICLES = ROOT / "articles"
IMAGES = ROOT / "images"
LOCAL_SRC = ROOT / "images_src"          # 사용자가 직접 넣어두는 추가 사진
# 손대지 않은 원본 보관소. --from-existing 은 여기서만 읽는다.
# 생성된 images/ 를 다시 원본으로 쓰면 크롭·보정이 누적돼 화면이 점점 확대된다.
MASTER = ROOT / "images_master"
IMG_EXTS = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}
# [[img:파일명]] 또는 [[img:파일명|사진 설명]]
MARKER = re.compile(r"\[\[\s*(?:img|image)\s*:\s*([^|\]]+?)\s*(?:\|\s*(.+?)\s*)?\]\]", re.I)

# 사진을 찾는 방식은 3단계다. 앞 단계에서 필요한 만큼 못 채우면 다음 단계로 넓힌다.
#   1단계 정밀 — 파일명/폴더명이 제품과 직접 맞는 것
#   2단계 확장 — 활동·부품 관련 키워드까지
#   3단계 전체 — 드라이브 전체 사진에서 품질 기준을 통과한 것
# 어느 단계에서 뽑혔는지는 실행 결과에 함께 표시된다.

# 1단계
EDUKART_HINTS = [
    "에듀카트 v4", "에듀카트 V4", "에듀카트 Ver 4", "에듀카트 Ver.4", "에듀카트 Ver 5",
    "에듀카트 Ver.5", "에듀카트 v5", "에듀카트 V5",
    "에듀카트 보드 설계도", "전장 구성도",
    "edu-kart", "eduKart", "edukart",
]
KALLI_DIR_HINTS = [
    "개발 차량 이미지", "CYCLEKART_IMAGE", "Kalli", "Kalli-RC",
    "Kalli Craft", "newtroM", "차량 이미지", "차량이미지",
]

# 2단계 — 활동·부품·현장 사진까지 넓힌다
EDUKART_HINTS_WIDE = [
    "안전정비 교육", "안전정비 실습", "시범 교육", "시범교육", "실습",
    "조립", "부품", "티어다운", "아두이노", "모터", "배터리", "배선", "프레임",
    "카트", "kart", "레이싱", "메이커", "워크숍", "워크샵",
]
KALLI_HINTS_WIDE = [
    "칼리", "달리", "뉴트로", "사이클카트", "cyclekart", "마실카",
    "시승", "체험", "전기차", "이모빌리티", "클래식", "빈티지",
]

# 어느 단계에서든 제외 — 블로그에 쓸 수 없는 것들
JUNK = [
    # 서류·행정
    "실측확인", "제원", "통보서", "계약", "견적", "재료비", "납품", "세금", "청구",
    "신청서", "공고", "입찰", "증빙", "보조금", "정산", "품의", "결재", "확인서",
    "사업자", "등기", "면허", "보험", "약관", "규정", "회의록", "출장",
    # 판촉물·화면
    "QR", "큐알", "현수막", "배너", "x배너", "포스터", "명함", "리플렛", "팜플렛",
    # 카드뉴스·상세페이지는 글자가 얹힌 디자인물이라 본문 사진으로 쓰면 어색하다
    "카드뉴스", "cardnews", "상세페이지", "썸네일", "표지", "cover", "시안",
    "스크린샷", "screenshot", "캡처", "화면", "페이지", "썸네일",
    "로고", "logo", "icon", "아이콘", "엠블럼", "폰트",
    # 개인정보 — 절대 블로그에 올라가면 안 되는 것
    "주민", "여권", "신분증", "통장", "이력서", "서명", "도장", "인감", "가족", "졸업",
    ".DS_Store",
]
# 하위 호환 (예전 이름을 참조하는 코드가 있어도 동작하도록)
KALLI_EXCLUDE = JUNK

# 3단계 전체 훑기의 품질 기준 — 아이콘·썸네일·문서 스캔을 거른다
SWEEP_MIN_BYTES = 120_000
SWEEP_MIN_WIDTH = 800
SWEEP_ASPECT = (0.45, 2.6)


# 구글 드라이브 마운트 안에서 볼 최상위들. 계정마다 이름이 한글/영문으로 갈린다.
DRIVE_SUBROOTS = [
    ("내 드라이브", "내 드라이브"), ("내 드라이브", "My Drive"),
    ("공유 드라이브", "공유 드라이브"), ("공유 드라이브", "Shared drives"),
    ("공유 문서함", "공유 문서함"), ("공유 문서함", "Shared with me"),
]
# 드라이브 밖에 따로 두는 작업 폴더 후보
LOCAL_CANDIDATES = [
    "Work Files", "WorkFiles", "Workfiles", "workfiles",
    "Documents/Work Files", "Documents/WorkFiles", "Documents/Workfiles",
    "Desktop/Work Files", "Desktop/WorkFiles",
]


def find_roots(extra=()):
    """사진을 찾을 최상위 폴더들을 모은다.

    구글 드라이브의 내 드라이브·공유 드라이브·공유 문서함을 모두 보고,
    드라이브 밖의 Work Files 류 폴더도 후보에 넣는다.
    --src 로 준 경로가 있으면 함께 본다.
    돌려주는 값: [(표시이름, 경로), ...]
    """
    roots, seen = [], set()

    def add(label, path):
        try:
            rp = Path(path).resolve()
        except OSError:
            return
        if rp in seen or not rp.exists():
            return
        seen.add(rp)
        roots.append((label, rp))

    for e in extra:
        add("직접 지정", e)

    base = Path.home() / "Library" / "CloudStorage"
    if base.exists():
        for entry in sorted(base.iterdir()):
            if not entry.name.startswith("GoogleDrive-"):
                continue
            acct = entry.name.replace("GoogleDrive-", "")
            for label, sub in DRIVE_SUBROOTS:
                add(f"{label} ({acct})", entry / sub)

    for rel in LOCAL_CANDIDATES:
        add("로컬 작업폴더", Path.home() / rel)

    return roots


def find_drive_root():
    """하위 호환 — 첫 번째 루트만 돌려준다."""
    roots = find_roots()
    return roots[0][1] if roots else None


def walk_images(root, max_depth=8):
    """root 아래 이미지 파일을 훑는다. 심볼릭 링크는 따라가지 않는다."""
    root = Path(root)
    base_depth = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        if len(Path(dirpath).parts) - base_depth >= max_depth:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if Path(fn).suffix in IMG_EXTS:
                yield Path(dirpath) / fn


def is_junk(path):
    """서류·판촉물·개인정보처럼 블로그에 쓸 수 없는 파일인가."""
    full = str(path).lower()
    return any(x.lower() in full for x in JUNK)


def passes_quality(path):
    """3단계 전체 훑기용 품질 기준. 아이콘·썸네일·문서 스캔을 거른다."""
    try:
        if path.stat().st_size < SWEEP_MIN_BYTES:
            return False
    except OSError:
        return False
    if Image is None:
        return True  # Pillow가 없으면 크기 기준만으로 통과
    try:
        with Image.open(path) as im:
            w, h = im.size
    except Exception:
        return False
    if w < SWEEP_MIN_WIDTH:
        return False
    ratio = w / h if h else 0
    return SWEEP_ASPECT[0] <= ratio <= SWEEP_ASPECT[1]


def collect_tiered(kind, roots, need, sweep=True):
    """3단계로 넓혀가며 사진을 모은다. (경로 리스트, 경로→단계 표시) 를 돌려준다.

    1단계에서 need 만큼 채워지면 거기서 멈춘다. 모자랄 때만 다음 단계로 간다.
    """
    tier_of = {}
    found = []

    def add(paths, tier):
        for p in paths:
            if p in tier_of or is_junk(p):
                continue
            tier_of[p] = tier
            found.append(p)

    # 0단계 — 사용자가 직접 넣어둔 사진이 최우선
    local = LOCAL_SRC / ("edukart_v5" if kind == "edukart" else "kalli")
    if local.exists():
        add(sorted(walk_images(local)), "직접 넣음")

    if not roots:
        return dedupe(found), tier_of

    # 폴더가 크다. 한 번만 훑고 재사용한다.
    all_images = []
    for _label, root in roots:
        all_images.extend(walk_images(root))

    # 1단계 — 정밀
    if kind == "edukart":
        hits = [p for p in all_images
                if any(h.lower() in p.name.lower() for h in EDUKART_HINTS)]
    else:
        hits = [p for p in all_images
                if any(h in str(p) for h in KALLI_DIR_HINTS)]
    add(hits, "1단계 정밀")
    if len(dedupe(found)) >= need:
        return dedupe(found), tier_of

    # 2단계 — 활동·부품 키워드까지 확장
    wide = EDUKART_HINTS_WIDE if kind == "edukart" else KALLI_HINTS_WIDE
    hits = [p for p in all_images
            if any(h.lower() in str(p).lower() for h in wide)]
    add(hits, "2단계 확장")
    if len(dedupe(found)) >= need:
        return dedupe(found), tier_of

    if not sweep:
        return dedupe(found), tier_of

    # 3단계 — 드라이브 전체에서 품질 기준을 통과한 사진
    # 최근 것부터 본다. 오래된 파일일수록 지금 브랜드와 안 맞을 가능성이 크다.
    # 상대 제품 사진은 뺀다. 에듀카트 자리에 칼리 사진이 들어가면 글과 맞지 않는다.
    if kind == "edukart":
        other = KALLI_DIR_HINTS + KALLI_HINTS_WIDE
    else:
        other = EDUKART_HINTS + EDUKART_HINTS_WIDE
    rest = [p for p in all_images
            if p not in tier_of
            and not is_junk(p)
            and not any(h.lower() in str(p).lower() for h in other)]
    try:
        rest.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        pass
    swept = []
    for p in rest:
        if passes_quality(p):
            swept.append(p)
        if len(dedupe(found)) + len(swept) >= need:
            break
    add(swept, "3단계 전체")

    return dedupe(found), tier_of


def dedupe(paths):
    """같은 내용(크기+파일명)의 중복을 제거하고 순서를 유지한다."""
    seen, out = set(), []
    for p in paths:
        try:
            key = (p.name, p.stat().st_size)
        except OSError:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def spread(paths, count):
    """후보가 필요 수보다 많으면 고르게 솎아 다양성을 확보한다."""
    if len(paths) <= count:
        return list(paths)
    step = len(paths) / count
    return [paths[int(i * step)] for i in range(count)]


def edge_color(im):
    """이미지 가장자리 평균색 — 여백을 채울 때 이질감이 덜하다."""
    w, h = im.size
    px = im.convert("RGB").load()
    step = max(1, w // 40)
    samples = [px[x, 0] for x in range(0, w, step)]
    samples += [px[x, h - 1] for x in range(0, w, step)]
    n = len(samples)
    return tuple(sum(c[i] for c in samples) // n for i in range(3))


def fit_to(im, size, allow_crop=None):
    """size에 맞춘다. 잘려나가는 양이 크면 자르지 않고 여백을 채운다.

    allow_crop 을 주면 그만큼까지는 잘라낸다 (카드에서 꺼낸 사진처럼
    이미 피사체에 딱 맞는 경우엔 여백보다 크롭이 자연스럽다).
    """
    from PIL import Image

    max_loss = styles.MAX_CROP_LOSS if allow_crop is None else allow_crop
    tw, th = size
    want = tw / th
    w, h = im.size
    keep = (h * want) / w if w / h > want else (w / want) / h
    if keep >= 1 - max_loss:
        # 손실이 작으면 중앙 크롭 (사진에 적합)
        if w / h > want:
            new_w = int(h * want)
            left = (w - new_w) // 2
            im = im.crop((left, 0, left + new_w, h))
        else:
            new_h = int(w / want)
            top = (h - new_h) // 2
            im = im.crop((0, top, w, top + new_h))
        return im.resize((tw, th), Image.LANCZOS)

    # 손실이 크면 자르지 않고 축소해 넣는다.
    # 카드뉴스처럼 글자가 있는 세로 이미지를 잘라먹지 않기 위한 처리.
    im = im.copy()
    im.thumbnail((tw, th), Image.LANCZOS)
    canvas = Image.new("RGB", (tw, th), edge_color(im))
    canvas.paste(im, ((tw - im.width) // 2, (th - im.height) // 2))
    return canvas


def apply_tint(im, tint):
    """채널별 배율로 색조를 민다. (1,1,1)이면 아무것도 하지 않는다."""
    if tuple(tint) == (1.0, 1.0, 1.0):
        return im
    r, g, b = im.split()[:3]
    lut = lambda k: [min(255, int(i * k)) for i in range(256)]
    return Image.merge("RGB", (r.point(lut(tint[0])),
                               g.point(lut(tint[1])),
                               b.point(lut(tint[2]))))


def apply_finish(im, finish):
    """흰 여백 테두리 / 둥근 모서리 마감."""
    from PIL import Image, ImageDraw

    if finish == "border":
        pad = styles.BORDER_PX
        inner = im.resize((im.width - pad * 2, im.height - pad * 2), Image.LANCZOS)
        canvas = Image.new("RGB", im.size, (255, 255, 255))
        canvas.paste(inner, (pad, pad))
        return canvas
    if finish == "round":
        radius = styles.ROUND_RADIUS
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1],
                                               radius=radius, fill=255)
        canvas = Image.new("RGB", im.size, (255, 255, 255))
        canvas.paste(im, (0, 0), mask)
        return canvas
    return im


def trim_flat_border(im):
    """가장자리에 완전히 균일한 색으로 채워진 띠가 있으면 잘라낸다.
    원본 사진의 여백이나 렌더 배경이 '박스'처럼 보이는 것을 막는다."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    tol = 3
    stepx, stepy = max(1, w // 60), max(1, h // 60)

    def row_flat(y):
        c0 = px[0, y]
        return all(abs(px[x, y][k] - c0[k]) <= tol
                   for x in range(0, w, stepx) for k in range(3))

    def col_flat(x):
        c0 = px[x, 0]
        return all(abs(px[x, y][k] - c0[k]) <= tol
                   for y in range(0, h, stepy) for k in range(3))

    top = 0
    while top < h // 3 and row_flat(top):
        top += 1
    bot = h
    while bot > h * 2 // 3 and row_flat(bot - 1):
        bot -= 1
    left = 0
    while left < w // 3 and col_flat(left):
        left += 1
    right = w
    while right > w * 2 // 3 and col_flat(right - 1):
        right -= 1

    if right - left < w * 0.5 or bot - top < h * 0.5:
        return rgb  # 너무 많이 잘리면 판정을 믿지 않는다
    if (left, top, right, bot) == (0, 0, w, h):
        return rgb
    return rgb.crop((left, top, right, bot))


def extract_photo(im, want_flag=False):
    """카드뉴스처럼 디자인 안에 사진이 박혀 있으면 그 사진만 잘라낸다.

    카드는 배경이 단색이고 글자 줄은 배경과 다른 픽셀 비율이 낮다.
    반면 사진 영역은 가로로 꽉 찬다. 그 성질로 위치를 찾는다.
    일반 사진(꽉 찬 이미지)은 건드리지 않는다.
    """
    from collections import Counter

    def result(img, ok):
        return (img, ok) if want_flag else img

    rgb = im.convert("RGB")
    w, h = rgb.size
    if w < 200 or h < 200:
        return result(im, False)
    px = rgb.load()
    sx, sy = max(1, w // 200), max(1, h // 250)

    bg = Counter(px[x, y] for y in range(0, h, sy)
                 for x in range(0, w, sx)).most_common(1)[0][0]
    tol = 42
    far = lambda c: abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2]) > tol
    cover = 0.55

    xs = range(0, w, sx)
    rowf = [sum(far(px[x, y]) for x in xs) / len(xs) for y in range(h)]
    rows = [y for y, f in enumerate(rowf) if f > cover]
    if len(rows) < 60:
        return result(im, False)

    # 가장 긴 연속 구간이 사진일 가능성이 높다
    best = cur = [rows[0], rows[0]]
    for y in rows[1:]:
        if y - cur[1] <= 3:
            cur[1] = y
        else:
            if cur[1] - cur[0] > best[1] - best[0]:
                best = cur
            cur = [y, y]
    if cur[1] - cur[0] > best[1] - best[0]:
        best = cur
    y0, y1 = best
    if y1 - y0 < 80:
        return result(im, False)

    ys = range(y0, y1, sy)
    colf = [sum(far(px[x, y]) for y in ys) / len(ys) for x in range(w)]
    cs = [x for x, f in enumerate(colf) if f > cover]
    if not cs:
        return result(im, False)

    box = (cs[0], y0, cs[-1] + 1, y1 + 1)
    area = (box[2] - box[0]) * (box[3] - box[1]) / (w * h)
    # 너무 작으면 오검출, 너무 크면 원래 꽉 찬 사진이라 자를 이유가 없다
    if not (0.12 <= area <= 0.85):
        return result(im, False)
    return result(rgb.crop(box), True)


def has_usable_photo(path):
    """카드 안에 사진이 들어 있는가. 글자만 있는 CTA 카드를 걸러내는 데 쓴다."""
    if Image is None:
        return True
    try:
        with Image.open(path) as im:
            _, ok = extract_photo(im, want_flag=True)
        return ok
    except Exception:
        return True


def convert_pillow(src, dst, style=None):
    """프리셋대로 비율·톤·마감을 적용한다. style이 None이면 가로폭만 맞춘다."""
    from PIL import Image, ImageEnhance

    im = Image.open(src)
    if im.mode != "RGB":
        im = im.convert("RGB")
    # 카드뉴스라면 안에 박힌 사진만 꺼낸다 (글자·디자인 제거)
    im, extracted = extract_photo(im, want_flag=True)
    # 원본에 남아 있는 균일한 여백 띠도 잘라낸다
    im = trim_flat_border(im)

    if style is None:
        w, h = im.size
        im = im.resize((styles.BASE_WIDTH, max(1, round(h * styles.BASE_WIDTH / w))),
                       Image.LANCZOS)
    else:
        # 추출한 사진은 카드 껍데기를 벗겨낸 것이라 여백을 두면 다시 '박스'처럼 보인다.
        # 얼마가 잘리든 꽉 채운다.
        im = fit_to(im, styles.size_for(style), allow_crop=1.0 if extracted else None)
        im = ImageEnhance.Contrast(im).enhance(style["contrast"])
        im = ImageEnhance.Color(im).enhance(style["color"])
        im = ImageEnhance.Brightness(im).enhance(style["brightness"])
        im = apply_tint(im, style["tint"])
        im = apply_finish(im, style["finish"])

    im.save(dst, "PNG")
    return True


def convert_sips(src, dst, style=None):
    """Pillow가 없을 때의 폴백. 비율까지만 맞추고 톤·마감은 생략된다."""
    subprocess.run(
        ["sips", "-s", "format", "png", str(src), "--out", str(dst)],
        check=True, capture_output=True,
    )
    if style is None:
        subprocess.run(["sips", "--resampleWidth", str(styles.BASE_WIDTH), str(dst)],
                       check=True, capture_output=True)
        return True
    tw, th = styles.size_for(style)
    subprocess.run(["sips", "--resampleHeightWidthMax", str(max(tw, th) * 2), str(dst)],
                   check=True, capture_output=True)
    # -c 는 중앙 기준 크롭(높이 너비 순)
    subprocess.run(["sips", "-c", str(th), str(tw), str(dst)],
                   check=True, capture_output=True)
    return True


def convert(src, dst, style=None):
    """규격·톤·마감을 적용해 dst(png)로 만든다. 단계적으로 폴백한다."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    for fn in (convert_pillow, convert_sips):
        try:
            return fn(src, dst, style)
        except Exception:
            continue
    try:
        shutil.copy2(src, dst)
        return True
    except OSError:
        return False


def article_files():
    return sorted(
        (p for p in ARTICLES.glob("*.txt")),
        key=lambda p: p.name,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="수집·재배정 계획만 출력")
    ap.add_argument("--no-style", action="store_true",
                    help="스타일 적용 없이 가로폭만 맞춘다")
    ap.add_argument("--src", action="append", default=[], metavar="경로",
                    help="검색할 폴더를 직접 추가한다 (여러 번 쓸 수 있음)")
    ap.add_argument("--no-sweep", action="store_true",
                    help="3단계(드라이브 전체 훑기)를 하지 않는다. 제품 사진만 쓴다")
    ap.add_argument("--from-existing", action="store_true",
                    help="구글 드라이브 대신 현재 images/ 사진을 돌려써서 채운다 "
                         "(같은 사진이 다른 스타일로 여러 번 쓰임 — 임시 방편)")
    args = ap.parse_args()

    arts = article_files()
    if not arts:
        sys.exit(f"원고가 없습니다: {ARTICLES}")

    # 각 원고가 필요한 이미지 수를 마커 개수로 센다
    needs = []
    for path in arts:
        text = path.read_text(encoding="utf-8")
        n = len(MARKER.findall(text))
        product = "edukart" if "edukart" in path.name else "kalli"
        needs.append((path, product, n))

    need_edu = sum(n for _, p, n in needs if p == "edukart")
    need_kal = sum(n for _, p, n in needs if p == "kalli")

    if args.from_existing:
        # 드라이브를 쓸 수 없을 때의 임시 방편.
        # 원본 사진 수가 모자라므로 같은 사진이 편마다 다른 스타일로 반복된다.
        # 원본 보관소가 있으면 거기서 읽는다 (재생성 시 열화 방지)
        src_dir = MASTER if MASTER.exists() and any(MASTER.glob("*.png")) else IMAGES
        if src_dir is IMAGES:
            print("    ⚠️  images_master/ 가 없어 생성본을 원본으로 씁니다. "
                  "반복 실행하면 사진이 점점 확대됩니다.")
        pool_e = sorted(src_dir.glob("edukart*.png")) or sorted(src_dir.glob("*.png"))
        pool_k = sorted(src_dir.glob("kalli*.png")) or sorted(src_dir.glob("*.png"))
        # 글자만 있는 CTA 카드는 본문 사진으로 쓸 수 없다
        before = len(pool_e) + len(pool_k)
        pool_e = [q for q in pool_e if has_usable_photo(q)] or pool_e
        pool_k = [q for q in pool_k if has_usable_photo(q)] or pool_k
        dropped = before - len(pool_e) - len(pool_k)
        if dropped:
            print(f"    사진이 없는 카드 {dropped}장은 제외했습니다.")
        if not pool_e or not pool_k:
            sys.exit(f"images/ 에 재활용할 사진이 없습니다: {IMAGES}")
        # finish()가 images/ 를 images_prev/ 로 옮기므로, 원본을 먼저 임시 폴더로 빼둔다.
        stage = ROOT / ".img_stage"
        shutil.rmtree(stage, ignore_errors=True)
        stage.mkdir(parents=True)
        pool_e = [shutil.copy2(p, stage / f"e_{i}{p.suffix}") for i, p in enumerate(pool_e)]
        pool_k = [shutil.copy2(p, stage / f"k_{i}{p.suffix}") for i, p in enumerate(pool_k)]
        pool_e = [Path(p) for p in pool_e]
        pool_k = [Path(p) for p in pool_k]
        edu = [pool_e[i % len(pool_e)] for i in range(need_edu)]
        kal = [pool_k[i % len(pool_k)] for i in range(need_kal)]
        print(f"⚠️  --from-existing: 원본 {len(pool_e)}+{len(pool_k)}장으로 "
              f"{need_edu}+{need_kal}장을 만듭니다. 같은 사진이 반복됩니다.")
        print("    지금 images/ 에 있는 것이 카드뉴스(글자가 얹힌 디자인물)라면")
        print("    결과물도 카드뉴스처럼 보입니다. 자연스러운 사진을 원하시면")
        print("    드라이브 수집(옵션 없이 실행)이나 images_src/ 직접 투입을 쓰세요.")
        return finish(needs, edu, kal, args, {})

    roots = find_roots(args.src)
    if not roots:
        print("⚠️  찾을 폴더가 없습니다.")
        print("    Finder에서 구글 드라이브가 연결돼 있는지 확인하세요.")
        print(f"    (또는 {LOCAL_SRC}/edukart_v5, {LOCAL_SRC}/kalli 에 사진을 직접 넣어두세요)")
        print("    특정 폴더를 직접 지정하려면 --src <경로> 를 쓰세요.")
    else:
        print("검색할 폴더:")
        for label, r in roots:
            print(f"  [{label}] {r}")

    print("사진을 찾는 중입니다. 드라이브 크기에 따라 1~2분 걸릴 수 있습니다...")
    print("  (1단계 정밀 → 모자라면 2단계 확장 → 그래도 모자라면 드라이브 전체)")
    sweep = not args.no_sweep
    edu, tier_edu = collect_tiered("edukart", roots, need_edu, sweep)
    kal, tier_kal = collect_tiered("kalli", roots, need_kal, sweep)
    tiers = {**tier_edu, **tier_kal}
    def by_tier(paths):
        from collections import Counter
        c = Counter(tiers.get(p, "?") for p in paths)
        return ", ".join(f"{k} {v}장" for k, v in c.items()) or "없음"

    print(f"  에듀카트 후보 {len(edu)}장 / 필요 {need_edu}장  ({by_tier(edu)})")
    print(f"  칼리 후보 {len(kal)}장 / 필요 {need_kal}장  ({by_tier(kal)})")

    swept = [p for p in edu + kal if tiers.get(p) == "3단계 전체"]
    if swept:
        print()
        print("⚠️  제품 사진이 모자라 드라이브 전체에서 " + str(len(swept)) + "장을 가져왔습니다.")
        print("    제품과 무관한 사진일 수 있으니 아래 목록을 꼭 확인하세요.")
        for q in swept:
            print(f"      {q}")
        print("    원치 않으면 --no-sweep 을 붙여 3단계를 끄거나,")
        print("    images_src/edukart_v5/ · images_src/kalli/ 에 직접 사진을 넣으세요.")
        print()

    short = []
    if len(edu) < need_edu:
        short.append(f"에듀카트 {need_edu - len(edu)}장 부족")
    if len(kal) < need_kal:
        short.append(f"칼리 {need_kal - len(kal)}장 부족")
    if short:
        print("\n❌ " + ", ".join(short) + " — 중복 없이 채울 수 없습니다.")
        print("   Ver.5 사진을 images_src/edukart_v5/ 에 넣고 다시 실행하거나,")
        print("   편당 이미지를 1장으로 줄이는 방법이 있습니다.")
        if not args.dry_run:
            sys.exit(1)

    edu = spread(edu, need_edu)
    kal = spread(kal, need_kal)
    return finish(needs, edu, kal, args, tiers)


def finish(needs, edu, kal, args, tiers=None):
    tiers = tiers or {}

    # 배정: 원고 순서대로 앞에서부터 하나씩 꺼내 쓴다 (재사용 없음)
    plan, used = [], set()
    ei = ki = 0
    for path, product, n in needs:
        picks = []
        for _ in range(n):
            if product == "edukart":
                src = edu[ei] if ei < len(edu) else None
                ei += 1
                idx = ei
            else:
                src = kal[ki] if ki < len(kal) else None
                ki += 1
                idx = ki
            if src is None:
                picks.append((None, None))
                continue
            dst_name = f"{product}_{idx:02d}.png"
            assert dst_name not in used, "이미지 이름이 겹쳤습니다"
            used.add(dst_name)
            picks.append((src, dst_name))
        plan.append((path, picks))

    print()
    for i, (path, picks) in enumerate(plan):
        names = ", ".join(d or "(없음)" for _, d in picks)
        st = "스타일 없음" if args.no_style else styles.style_for(i)["name"]
        print(f"  {path.name} [{st}] → {names}")
        for s, d in picks:
            if s:
                print(f"        {d}  ←  [{tiers.get(s, '-')}] {s}")

    if args.dry_run:
        print("\n(--dry-run 이므로 파일을 만들지 않았습니다)")
        return

    # 기존 images/ 를 보관하고 새로 만든다
    if IMAGES.exists():
        backup = ROOT / "images_prev"
        if backup.exists():
            shutil.rmtree(backup)
        IMAGES.rename(backup)
        print(f"\n기존 images/ → images_prev/ 로 보관했습니다.")
    IMAGES.mkdir(parents=True, exist_ok=True)

    made = 0
    for i, (path, picks) in enumerate(plan):
        st = None if args.no_style else styles.style_for(i)
        for src, dst_name in picks:
            if src and convert(src, IMAGES / dst_name, style=st):
                made += 1
    spec = "가로 810px, 스타일 없음" if args.no_style else "편마다 다른 스타일"
    print(f"이미지 {made}장 생성 완료 [{spec}] → {IMAGES}")

    # 원고 마커 재작성
    for path, picks in plan:
        text = path.read_text(encoding="utf-8")
        names = [d for _, d in picks]
        i = [0]

        def repl(_m):
            n = names[i[0]] if i[0] < len(names) else None
            i[0] += 1
            if not n:
                return _m.group(0)
            caption = _m.group(2)          # 사진 설명은 그대로 살린다
            return f"[[img:{n}|{caption}]]" if caption else f"[[img:{n}]]"

        path.write_text(MARKER.sub(repl, text), encoding="utf-8")
    print(f"원고 {len(plan)}편의 이미지 마커를 재배정했습니다.")

    # 검증
    seen = {}
    bad = False
    for path in article_files():
        for name, _caption in MARKER.findall(path.read_text(encoding="utf-8")):
            if not (IMAGES / name).exists():
                print(f"❌ 파일 없음: {name} ({path.name})")
                bad = True
            if name in seen:
                print(f"❌ 중복 사용: {name} ({seen[name]}, {path.name})")
                bad = True
            seen[name] = path.name
    shutil.rmtree(ROOT / ".img_stage", ignore_errors=True)
    print("✅ 검증 통과: 모든 이미지가 존재하고 중복 사용이 없습니다." if not bad
          else "⚠️ 위 문제를 확인하세요.")


if __name__ == "__main__":
    main()
