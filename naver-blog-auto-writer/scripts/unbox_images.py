#!/usr/bin/env python3
"""카드뉴스 슬라이드에서 안쪽 사진만 꺼낸다.

images/ 의 png 들은 카드뉴스 한 장이다 — 어두운 배경에 헤드라인·본문·
"ClanHunts." 푸터가 있고, 그 가운데 실제 사진이 사각 박스로 박혀 있다.
블로그에는 그 박스 처리 없이 사진만 들어가야 한다.

원본은 images_card/ 로 옮겨 보관하고, 잘라낸 사진을 images/ 에 같은 이름으로 쓴다.
되돌리려면 images_card/ 에서 도로 복사하면 된다.

  python3 scripts/unbox_images.py --dry-run      # 어디를 자를지만 본다
  python3 scripts/unbox_images.py --out 폴더      # 미리보기를 따로 저장
  python3 scripts/unbox_images.py                # 실제로 교체
"""
import argparse
import os
import re
import shutil
import sys

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, 'images')
BACKUP = os.path.join(ROOT, 'images_card')

DIFF_THRESHOLD = 28      # 배경과 이만큼 다르면 '내용'
ROW_FILL = 0.60          # 가로로 이만큼 차 있으면 사진 줄일 가능성
MIN_BAND = 40            # 이보다 얇으면 사진이 아니다
MIN_COLORS = 2000        # 색이 이보다 적으면 사진이 아니라 글자·단색 띠


def find_photo_box(im):
    """사진이 박힌 사각형을 찾는다. 못 찾으면 None.

    카드는 틀이 정해져 있다 — 맨 위 얇은 띠와 맨 아래 푸터는 화면 전체 폭이고,
    사진만 좌우로 여백을 두고 안쪽에 들어간다. 그래서 '전폭이 아닌' 구간만 본다.
    사진 속 어두운 부분은 배경색과 비슷해 구간이 몇 토막으로 끊기므로,
    좌우 범위가 같은 토막들은 하나로 잇는다.
    """
    rgb = im.convert('RGB')
    w, h = rgb.size
    colors = rgb.getcolors(maxcolors=w * h)
    if not colors:
        return None
    bg = max(colors)[1]                       # 가장 많이 쓰인 색 = 카드 배경
    diff = ImageChops.difference(rgb, Image.new('RGB', (w, h), bg)).convert('L')
    mask = diff.point(lambda v: 255 if v > DIFF_THRESHOLD else 0)

    rows = [mask.crop((0, y, w, y + 1)).histogram()[255] for y in range(h)]
    need = w * ROW_FILL

    raw, y = [], 0
    while y < h:
        if rows[y] >= need:
            y0 = y
            while y < h and rows[y] >= need:
                y += 1
            raw.append((y0, y))
        else:
            y += 1

    # 각 토막의 좌우 범위를 재고, 전폭 띠(상단 스트립·푸터)는 버린다
    segs = []
    for y0, y1 in raw:
        if y1 - y0 < 6:
            continue
        bh = y1 - y0
        band = mask.crop((0, y0, w, y1))
        xs = [x for x in range(w) if band.crop((x, 0, x + 1, bh)).histogram()[255] >= bh * ROW_FILL]
        if not xs:
            continue
        x0, x1 = xs[0], xs[-1] + 1
        if x0 <= 2 and x1 >= w - 2:           # 전폭 = 카드 장식이지 사진이 아니다
            continue
        segs.append((x0, y0, x1, y1))
    if not segs:
        return None

    # 좌우 범위가 같은 토막끼리 묶는다 (사진 한 장이 여러 토막으로 끊긴 경우)
    groups = {}
    for x0, y0, x1, y1 in segs:
        key = (round(x0 / 8), round(x1 / 8))
        g = groups.setdefault(key, [x0, y0, x1, y1])
        g[0] = min(g[0], x0)
        g[1] = min(g[1], y0)
        g[2] = max(g[2], x1)
        g[3] = max(g[3], y1)

    best, best_colors = None, 0
    for x0, y0, x1, y1 in groups.values():
        if (y1 - y0) < MIN_BAND:
            continue
        got = rgb.crop((x0, y0, x1, y1)).getcolors(maxcolors=200000)
        ncolors = 200000 if got is None else len(got)
        if ncolors < MIN_COLORS:              # 색이 거의 없으면 사진이 아니다
            continue
        if ncolors > best_colors:             # 가장 색이 풍부한 덩어리 = 사진
            best, best_colors = (x0, y0, x1, y1), ncolors
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--out', default=None, help='잘라낸 결과를 따로 저장할 폴더')
    ap.add_argument('--only', nargs='*', help='파일명 일부로 대상 좁히기')
    ap.add_argument('--all', action='store_true', help='원고가 안 쓰는 파일까지 전부')
    ap.add_argument('--inset', type=int, default=8, help='둥근 모서리 자국을 피해 안쪽으로 깎을 픽셀')
    args = ap.parse_args()

    names = sorted(f for f in os.listdir(IMAGES) if f.lower().endswith('.png'))
    if not args.all and not args.only:
        # 원고가 실제로 쓰는 사진만 건드린다 (안 쓰는 파일은 그대로 둔다)
        used = set()
        art = os.path.join(ROOT, 'articles')
        for f in os.listdir(art):
            if not f.lower().endswith(('.txt', '.md')):
                continue
            for m in re.finditer(r'\[\[\s*img\s*:\s*([^|\]]+)', open(os.path.join(art, f), encoding='utf-8').read()):
                used.add(m.group(1).strip())
        names = [n for n in names if n in used]
    if args.only:
        names = [n for n in names if any(k in n for k in args.only)]

    out_dir = args.out
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    ok, skipped = 0, []
    for name in names:
        src = os.path.join(IMAGES, name)
        with Image.open(src) as im:
            box = find_photo_box(im)
            if not box:
                skipped.append(name)
                print(f'  건너뜀 {name}: 사진 영역을 못 찾음')
                continue
            x0, y0, x1, y1 = box
            frac_area = ((x1 - x0) * (y1 - y0)) / (im.size[0] * im.size[1])
            # 이미 잘라낸 사진을 또 자르지 않는다. 카드는 사진이 한 귀퉁이만
            # 차지하지만, 잘라낸 사진은 찾아낸 영역이 거의 전체다.
            if frac_area > 0.60:
                skipped.append(name)
                print(f'  건너뜀 {name}: 이미 사진만 남아 있습니다 (카드가 아님)')
                continue
            i = args.inset
            crop_box = (x0 + i, y0 + i, x1 - i, y1 - i)
            frac = ((x1 - x0) * (y1 - y0)) / (im.size[0] * im.size[1])
            print(f'  {name}: {im.size[0]}x{im.size[1]} → '
                  f'{crop_box[2]-crop_box[0]}x{crop_box[3]-crop_box[1]} '
                  f'(원본의 {frac*100:.0f}%)')
            if args.dry_run:
                continue
            cropped = im.convert('RGB').crop(crop_box)
            if out_dir:
                cropped.save(os.path.join(out_dir, name))
            else:
                os.makedirs(BACKUP, exist_ok=True)
                if not os.path.exists(os.path.join(BACKUP, name)):
                    shutil.copy2(src, os.path.join(BACKUP, name))
                cropped.save(src)
            ok += 1

    print(f'\n처리 {ok}장 / 건너뜀 {len(skipped)}장')
    if skipped:
        print('건너뛴 파일 (사진 영역을 못 찾음):')
        for n in skipped:
            print('  -', n)
    return 1 if skipped else 0


if __name__ == '__main__':
    sys.exit(main())
