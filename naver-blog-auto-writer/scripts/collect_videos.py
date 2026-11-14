#!/usr/bin/env python3
"""
구글 드라이브·외장 드라이브에서 사이클카트·칼리·에듀카트 동영상을 모아
BGM을 깔고(원본 소리는 덮는다) videos/ 에 넣고, 편별 배정 계획을 세운다.

사진(rebuild_images.py)과 다른 점이 셋 있다.

1. 원본 소리를 BGM 으로 덮는다.
   교육·회의 영상에는 사람 목소리가 들어 있다. 공개 블로그에 올릴 때
   그 목소리는 초상권·음성권 문제가 된다. BGM 으로 덮으면 그 걱정이 없고,
   현장 소음(바람·엔진)도 정리된다. 되살릴 일이 있으면 --keep-audio.

2. 한 편에 영상 1~3개를 묶는다.
   영상 하나에 글 하나면 수십 편이 된다. 폴더가 곧 주제이므로
   폴더 단위로 묶어 편을 만든다.

3. 네이버 업로드가 느리다.
   영상은 올린 뒤 서버에서 인코딩을 기다려야 한다. 한 편에 몇 분이 걸린다.
   그래서 이 스크립트는 '준비'까지만 한다. 올리는 일은 kart 가 맡는다.

사용법:
    python3 scripts/collect_videos.py --scan-only        # 어디에 몇 개 있는지만
    python3 scripts/collect_videos.py --dry-run          # 편별 배정 계획만
    python3 scripts/collect_videos.py --bgm music/a.mp3  # 실제 준비
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# 경로 정규화·쓰레기 판정은 사진 쪽과 같은 규칙을 쓴다. 규칙이 갈라지면
# 사진에서는 걸러지는 서류가 영상에서는 통과하는 일이 생긴다.
from rebuild_images import norm, is_junk, walk_images  # noqa: E402  (walk 규칙 재사용)
from rebuild_images import SKIP_DIRS, SKIP_DIR_SUFFIXES  # noqa: E402
# 검색할 루트도 사진 쪽 것을 그대로 쓴다. 여기에 따로 만들어 뒀던 함수는
# 구글 드라이브만 봤다 — 외장 드라이브(/Volumes)와 로컬 작업폴더를 빼먹었고,
# 드라이브 하위도 '공유 문서함'을 몰랐다. 사진은 13,067장이 잡히는데
# 영상은 몇 개밖에 안 잡히던 이유가 이것이다.
from rebuild_images import find_roots  # noqa: E402
# 중복 판정도 사진 쪽 것을 쓴다 (크기 + 앞뒤 64KB 해시).
from rebuild_images import _content_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SCAN_CACHE = ROOT / "state" / "video_scan.json"
USED = ROOT / "state" / "video_used.json"
VIDEOS = ROOT / "videos"
PLAN = ROOT / "state" / "video_plan.json"

VID_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}

# 우리 영상이 있는 폴더 이름. 사진 쪽 힌트와 겹치지만 영상 폴더는
# 이름이 더 분명해서 따로 둔다.
VIDEO_HINTS = [
    "에듀카트", "edu-kart", "edukart", "카트 영상", "조립 영상", "조립관련 영상",
    "칼리", "kalli", "사이클카트", "cyclekart", "cycle kart", "뉴트로", "newtro",
    "실측 확인 영상", "차량주행", "탑승영상", "운행영상", "주행 test",
    "교육 동영상", "교육 관련 영상", "고프로", "송부 동영상", "동영상 임시 백업",
    # 스캔에서 제외 쪽에 있던 우리 폴더들.
    "알루미늄 차체", "공도주행", "시승회",
]

# 파일 이름에서는 이것만 본다 — 우리 제품에만 붙는 이름.
#
# 폴더 이름과 달리 파일 이름은 남의 영상에도 그럴듯하게 붙는다. 내려받은 영상은
# 제목이 곧 파일 이름이라 'CycleKart racing.mp4' 같은 이름을 갖는다. 실제 스캔에서
# 'Kart Racing'·'모빌리티 관련 동영상' 폴더가 파일 이름의 cycle kart 로 채택됐다.
# 사이클카트는 미국에서 시작된 취미의 이름이지 우리 제품 이름이 아니다.
# '운행영상'·'조립 영상' 같은 말도 누구의 영상에나 붙는다.
BRAND_HINTS = ["칼리", "kalli", "newtro", "뉴트로", "에듀카트", "edukart", "edu-kart"]

# 남의 영상 — 참조용으로 모아둔 것들. 사진에서와 같은 이유로 제외한다.
#
# '미래모빌리티포럼'·'발표영상': 포럼 발표에 쓰려고 모은 남의 영상이다.
# 실제로 'Airbus debuts a concept car…', 'Air-Train', 'Floating Solar Islands' 가
# 그 폴더에서 편에 배정됐다. 올라가지 않은 것은 운이었다 (그 파일들이 마침
# 읽을 수 없는 ._ 파일이었다). 처음에 이 폴더 이름을 채택 힌트에 넣은 것이 잘못이었다.
EXCLUDE_HINTS = ["참고동영상", "참고 동영상", "참조", "reference", "레퍼런스", "벤치마",
                 "미래모빌리티포럼", "발표영상", "칼리그라"]

# 한 편에 넣을 영상 수. 1편에 하나면 편수가 너무 많고,
# 넷 이상이면 한 편이 너무 무겁다(업로드·인코딩 시간).
PER_ARTICLE = (1, 3)

# 네이버 블로그가 받는 한 편당 용량에는 한계가 있다. 큰 원본을 그대로 올리면
# 업로드가 길어지고 실패하기도 한다. 가로 1280 으로 줄이고 비트레이트를 묶는다.
TARGET_WIDTH = 1280
TARGET_VBITRATE = "2500k"
MAX_SECONDS = 90          # 이보다 긴 영상은 앞부분만 쓴다


def ffmpeg():
    """ffmpeg 실행 파일. 시스템 것을 먼저 보고, 없으면 playwright 것을 쓴다."""
    p = shutil.which("ffmpeg")
    if p:
        return p
    try:
        out = subprocess.run(
            ["node", "-e", "console.log(require('./src/ffmpeg-path').resolve())"],
            cwd=ROOT, capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        if out and Path(out).exists():
            return out
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def ffprobe():
    """ffprobe 실행 파일. PATH 에 없으면 ffmpeg 옆에 있는 것을 쓴다.

    homebrew 로 깐 ffmpeg 에는 ffprobe 가 같이 들어오지만, setup.sh 가
    playwright 쪽 ffmpeg 을 쓰게 된 기기에서는 PATH 에 ffprobe 가 없다.
    그때 길이·해상도를 못 읽어 캡션의 '○초'가 조용히 빠졌다.
    """
    p = shutil.which("ffprobe")
    if p:
        return p
    exe = ffmpeg()
    if exe:
        cand = Path(exe).with_name("ffprobe")
        if cand.exists():
            return str(cand)
    return None


def probe(path):
    """길이(초)·가로·세로. 못 읽으면 None."""
    exe = ffprobe()
    if not exe:
        return None
    try:
        out = subprocess.run([
            exe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "json", str(path),
        ], capture_output=True, text=True, timeout=60).stdout
        d = json.loads(out)
        st = (d.get("streams") or [{}])[0]
        dur = float((d.get("format") or {}).get("duration") or 0)
        return {"w": st.get("width"), "h": st.get("height"), "sec": round(dur, 1)}
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
        return None


def walk_videos(root, max_depth=14):
    """영상 파일을 훑는다. 폴더 제외 규칙은 사진 쪽과 같다."""
    root = Path(root)
    base = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        if len(Path(dirpath).parts) - base >= max_depth:
            dirnames[:] = []
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".")
            and d not in SKIP_DIRS
            and not d.lower().endswith(SKIP_DIR_SUFFIXES)
        ]
        for fn in filenames:
            # 점으로 시작하는 파일은 영상이 아니다. 맥은 exFAT·FAT 외장 드라이브에
            # 파일마다 '._이름' 이라는 4KB 짜리 짝을 만든다(확장속성 보관용).
            # 확장자가 같아서 영상으로 잡혔고, 이름순으로 맨 앞에 오는 바람에
            # 한 편에 들어갈 세 개를 전부 차지했다. 실제로 10편 중 5편이 이것만
            # 배정받아 통째로 실패했다 ("Invalid data found").
            if fn.startswith("."):
                continue
            if Path(fn).suffix.lower() in VID_EXTS:
                yield Path(dirpath) / fn


# 폴더 이름이 내용을 말해주지 않는 것들. '칼리/동영상/a.mp4' 처럼
# 바로 위가 주제를 말해주는 경우가 있어서, 이 이름일 때만 한 단계 더 본다.
# 이 목록에 없는 폴더(Photos-001·Mopetta·사람 이름)는 자기 이름으로만 판정한다.
GENERIC_DIRS = {
    "동영상", "영상", "영상자료", "video", "videos", "vid", "clip", "clips",
    "mp4", "mov", "movie", "movies", "업로딩", "업로드", "출력", "export",
}


def tail(path, n=2):
    """파일명 + 그 위 폴더. 채택 판정은 여기서만 한다.

    예전에는 경로 전체에서 힌트를 찾았다. 그래서 조상 폴더 하나가
    '칼리'면 그 아래 사진 라이브러리 덤프(Photos-001 277개)와 사람 이름
    폴더(카메라 촬영_홍성욱 60개)까지 전부 끌려 들어왔다.

    증거는 스캔 출력에 있었다 — '모빌리티 관련 동영상'이 채택 70개와
    제외 70개 양쪽에 똑같이 찍혔다. 폴더 이름이 같은데 결과가 갈린 것은
    판정이 그 폴더가 아니라 조상 경로로 되고 있었다는 뜻이다.

    그래서 자기 폴더만 본다(n=2: 파일명 + 그 폴더). 폴더가 곧 주제다
    (theme_of). 다만 폴더 이름이 '동영상'·'VIDEO' 처럼 내용이 없을 때만
    한 단계 더 본다 — GENERIC_DIRS 와 matched_hints 를 보라.

    느슨하게 잡아 영상을 더 건지는 쪽보다 좁게 잡는 쪽을 골랐다.
    빠진 영상은 그냥 빠진 영상이지만, 잘못 들어간 영상은 남의 얼굴이나
    남의 차가 공개 블로그에 올라가는 일이다. 무게가 다르다.
    """
    return _nospace(norm("/".join(Path(path).parts[-n:])))


def _nospace(s):
    """공백을 뺀다. 띄어쓰기 한 칸 차이로 놓치지 않기 위해서다.

    '교육관련 영상'(170개)과 '1차 교육 관련 영상'(58개)이 둘 다 제외 쪽에
    있었다. 힌트에는 '교육 관련 영상' 이라고 적혀 있었는데, 앞의 것은
    '관련' 앞에 공백이 없어 문자열이 달랐다. 폴더 이름의 띄어쓰기는
    사람이 그때그때 다르게 적으므로 비교에서 빼는 편이 맞다.
    """
    return re.sub(r"\s+", "", s)


def matched_hints(path):
    """어느 힌트로 채택됐는지. 스캔 출력에서 오탐을 눈으로 잡기 위한 것.

    자기 폴더로 본다. 그 폴더 이름이 내용을 말해주지 않으면(GENERIC_DIRS)
    한 단계 위까지 본다 — '칼리/동영상/a.mp4' 는 살리고
    '칼리/Photos-001/a.mov' 와 '칼리/카메라 촬영_홍성욱/a.mp4' 는 버린다.
    """
    p = Path(path)
    own = _nospace(norm(p.parent.name))
    folder = own
    if own in GENERIC_DIRS:
        folder = _nospace(norm(p.parent.parent.name)) + "/" + own
    fname = _nospace(norm(p.name))
    hits = [h for h in VIDEO_HINTS if _nospace(norm(h)) in folder]
    hits += [h for h in BRAND_HINTS if _nospace(norm(h)) in fname and h not in hits]
    return hits


def is_ours(path):
    """우리가 찍은 영상인가. 참조 폴더와 서류성 파일은 뺀다."""
    # 제외는 경로 전체에서 본다. 조상이 '참조' 폴더면 그 아래는 전부 남의 것이다.
    if any(norm(h) in norm(path) for h in EXCLUDE_HINTS):
        return False
    if is_junk(path):
        return False
    # 채택은 가까운 데서만 본다.
    return bool(matched_hints(path))


# 이보다 짧으면 영상으로 치지 않는다. 실제로 0.1~0.2초짜리 파일 셋이 한 편을
# 이뤄 올라갔다. 액션캠이 남긴 조각이거나 복사가 끊긴 파일이다.
MIN_SECONDS = 3


def usable(path, meta):
    """올릴 만한 영상인가. meta 는 {경로: 길이(초) 또는 None} — 스캔 때 잰 값."""
    sec = meta.get(str(path))
    return sec is not None and sec >= MIN_SECONDS


def theme_of(path):
    """이 영상이 무엇인가. 바로 위 폴더 이름을 주제로 쓴다."""
    return unicodedata.normalize("NFC", path.parent.name).strip()


def group_into_articles(vids):
    """폴더(주제)별로 묶고, 한 편에 1~3개씩 나눈다.

    폴더가 곧 주제다. '조립 영상 제작' 21개를 한 편에 넣을 수는 없으니
    같은 주제 안에서 여러 편으로 쪼갠다. 주제가 섞이지 않는 게 중요하다 —
    사진에서 인증 이야기에 컨퍼런스 사진이 붙었던 것과 같은 실수를 막는다.
    """
    by_theme = {}
    for v in vids:
        by_theme.setdefault(theme_of(v), []).append(v)

    articles = []
    for theme in sorted(by_theme, key=lambda t: (-len(by_theme[t]), t)):
        group = sorted(by_theme[theme])
        i = 0
        while i < len(group):
            take = group[i:i + PER_ARTICLE[1]]
            # 마지막 조각이 1개뿐이면 앞 편에 붙인다. 다만 앞 편이 이미 상한이면
            # 붙이지 않는다 — 한 편에 영상 4개가 들어가면 업로드가 너무 무겁다.
            if (len(take) == 1 and articles and articles[-1]["theme"] == theme
                    and len(articles[-1]["videos"]) < PER_ARTICLE[1]):
                articles[-1]["videos"].extend(take)
            else:
                articles.append({"theme": theme, "videos": list(take)})
            i += PER_ARTICLE[1]
    return articles


def pick_articles(articles, cap):
    """편수를 cap 개로 줄인다. 주제를 돌아가며 뽑는다.

    앞에서부터 잘라내면 안 된다. group_into_articles 가 영상이 많은 주제를
    먼저 놓으므로, 10편을 앞에서 자르면 '교육관련 영상' 한 주제로 열 편이
    채워진다. 주제마다 한 편씩 돌아가며 뽑아야 열 편이 열 가지 이야기가 된다.
    """
    if cap <= 0 or len(articles) <= cap:
        return articles
    by_theme = {}
    for a in articles:
        by_theme.setdefault(a["theme"], []).append(a)
    # 영상이 많은 주제부터 — 그쪽이 더 할 말이 있는 주제다
    order = sorted(by_theme, key=lambda t: (-sum(len(x["videos"]) for x in by_theme[t]), t))
    out = []
    while len(out) < cap and any(by_theme[t] for t in order):
        for t in order:
            if by_theme[t]:
                out.append(by_theme[t].pop(0))
                if len(out) >= cap:
                    break
    return out


# 영상의 종류 → 배경음악. 종류는 폴더 이름이 말해주는 만큼만 안다
# (make_video_articles.kind_of). 영상을 보고 고르는 것이 아니다.
#   달리는 영상에는 빠른 곡, 만드는 영상에는 통통 튀는 곡,
#   교육에는 따뜻한 곡, 그 밖에는 담담한 곡.
# 곡은 scripts/make_bgm.py 가 직접 작곡·합성한 것이다.
MUSIC = ROOT / "music"
BGM_BY_KIND = {
    "주행": "bgm_drive.mp3", "공도": "bgm_drive.mp3", "시승": "bgm_drive.mp3",
    "조립": "bgm_build.mp3",
    "교육": "bgm_learn.mp3",
}
BGM_DEFAULT = "bgm_story.mp3"


def bgm_for(theme):
    """이 주제(폴더)에 붙일 곡. 파일이 없으면 예전의 조용한 패드로 물러난다."""
    import make_video_articles as mva
    name = BGM_BY_KIND.get(mva.kind_of(theme), BGM_DEFAULT)
    for cand in (MUSIC / name, MUSIC / BGM_DEFAULT, MUSIC / "bgm_quiet_90s.mp3"):
        if cand.exists():
            return cand
    return None


def mix_bgm(src, dst, bgm, exe, keep_audio=False, seconds=None):
    """영상을 규격에 맞추고 BGM을 깐다. 원본 소리는 덮는다.

    원본 소리를 남기지 않는 이유: 교육·회의 영상에 사람 목소리가 들어 있다.
    공개 블로그에 올리면 그 목소리까지 공개된다. BGM 으로 덮으면 그 문제가
    사라지고 현장 소음도 정리된다.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    # 가로·세로 둘 다 상한을 두고, 원본보다 키우지 않는다.
    #
    # 예전에는 scale=1280:-2:force_original_aspect_ratio=decrease 였다.
    # 치수를 한쪽만 줘서 force_original_aspect_ratio 가 아무 일도 하지 않았고,
    # 세로 영상(1080×1920)이 1280×2276 으로 늘어났다. 블로그 본문에 2,276px
    # 높이 영상이 들어가고 업로드만 무거워진다. 작은 영상(640×360)도
    # 1280×720 으로 억지로 확대돼 화질은 그대로인데 파일만 커졌다.
    cap = TARGET_WIDTH
    vf = (f"scale='min({cap},iw)':'min({cap},ih)':force_original_aspect_ratio=decrease,"
          "scale=trunc(iw/2)*2:trunc(ih/2)*2")
    cmd = [exe, "-y", "-hide_banner", "-loglevel", "error", "-t", str(MAX_SECONDS),
           "-i", str(src)]
    if bgm and not keep_audio:
        # BGM 이 영상보다 짧으면 반복, 길면 영상 길이에서 끊는다.
        cmd += ["-stream_loop", "-1", "-i", str(bgm)]
    cmd += ["-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
            "-b:v", TARGET_VBITRATE, "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    if bgm and not keep_audio:
        # BGM 이 유일한 소리라 많이 줄일 이유가 없다. 음원 자체를 -18 LUFS 로
        # 맞춰 뒀으므로 여기서는 살짝만 손댄다. 예전에는 0.35(-9dB)를 걸어
        # 거의 안 들렸다.
        #
        # 영상이 끝나는 자리에서 음악이 뚝 끊기지 않게 마지막 1.5초에 걸쳐 줄인다.
        # 멜로디가 있는 곡은 중간에서 잘리면 조용한 패드보다 훨씬 거슬린다.
        af = "volume=0.9"
        if seconds and seconds > 4:
            end = min(seconds, MAX_SECONDS)
            af += f",afade=t=out:st={end - 1.5:.2f}:d=1.5"
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "128k",
                "-af", af, "-shortest"]
    elif keep_audio:
        cmd += ["-map", "0:v:0", "-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"]
    else:
        cmd += ["-an"]          # BGM 이 없으면 소리를 아예 뺀다 (목소리 보호)
    cmd += [str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        return False, (r.stderr or "").strip().splitlines()[-1:] or ["알 수 없는 오류"]
    return True, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", action="append", default=[], metavar="경로")
    ap.add_argument("--only-src", action="store_true",
                    help="--src 로 준 폴더만 본다 (자동 인식 끔)")
    ap.add_argument("--scan-only", action="store_true", help="어디에 몇 개인지만")
    ap.add_argument("--dry-run", action="store_true", help="편별 배정 계획만")
    ap.add_argument("--bgm", metavar="음원", help="깔 BGM 파일 (mp3/m4a/wav)")
    ap.add_argument("--keep-audio", action="store_true",
                    help="원본 소리를 남긴다 (사람 목소리가 공개될 수 있다)")
    ap.add_argument("--limit", type=int, default=0, help="영상 수 상한 (시험용)")
    ap.add_argument("--rescan", action="store_true",
                    help="지난 스캔 결과를 쓰지 않고 드라이브를 다시 훑는다")
    ap.add_argument("--max-articles", type=int, default=0, metavar="N",
                    help="편수 상한. 주제를 돌아가며 N편만 만든다")
    args = ap.parse_args()

    if args.only_src and not args.src:
        sys.exit("--only-src 는 --src <경로> 와 함께 써야 합니다.")
    roots = find_roots(args.src, only_src=args.only_src)
    if not roots:
        sys.exit("영상을 찾을 폴더가 없습니다. 구글 드라이브가 연결됐는지 보거나 --src 를 주세요.")
    print("검색할 폴더:")
    for label, r in roots:
        print(f"  [{label}] {r}")

    # 외장 드라이브 두 개를 훑는 데 몇 분이 걸린다. 스캔만 하고, 계획만 보고,
    # 실제로 만들 때마다 그 몇 분을 다시 쓸 이유가 없다. 하루 안의 결과는 다시 쓴다.
    # 채택 규칙(힌트)이 바뀌면 결과도 달라지므로 규칙의 지문을 같이 적어둔다.
    cache_key = hashlib.md5(json.dumps(
        ["v3", sorted(str(r) for _l, r in roots), VIDEO_HINTS, BRAND_HINTS, EXCLUDE_HINTS,
         sorted(GENERIC_DIRS)],
        ensure_ascii=False).encode()).hexdigest()
    cached = None
    if not args.rescan and SCAN_CACHE.exists():
        try:
            c = json.loads(SCAN_CACHE.read_text(encoding="utf-8"))
            age = time.time() - c.get("at", 0)
            if c.get("key") == cache_key and age < 86400:
                cached = c
        except (OSError, ValueError):
            cached = None
    if cached:
        vids = [Path(x) for x in cached["vids"] if Path(x).exists()]
        skipped, rejected = cached["skipped"], cached["rejected"]
        print(f"\n지난 스캔 결과를 씁니다 ({int((time.time() - cached['at']) / 60)}분 전, "
              f"영상 {len(vids)}개). 다시 훑으려면 --rescan")
        return finish(args, vids, skipped, rejected, cached.get("meta") or {})

    found, skipped = [], 0
    # 걸러진 영상이 어느 폴더에 있었는지 센다.
    # 0개가 잡히면 "폴더 이름을 확인하세요"만 봐서는 무엇을 확인할지 모른다.
    # 실제 폴더 이름을 보여줘야 VIDEO_HINTS 에 무엇을 더할지 알 수 있다.
    rejected = {}

    # 루트를 찍고 나서 끝까지 아무 말이 없으면 끝난 줄 알게 된다.
    # 구글 드라이브 스트리밍 마운트는 폴더마다 네트워크로 목록을 받아와
    # 몇 분씩 걸린다. 외장 드라이브 두 개까지 합치면 더 길다.
    # 그래서 살아 있다는 표시를 주기적으로 찍는다. \r 은 쓰지 않는다 —
    # 터미널 출력을 그대로 복사해 붙이는 일이 많다.
    print("\n훑는 중입니다. 드라이브가 크면 몇 분 걸립니다.")
    for label, r in roots:
        print(f"  [{label}] …", flush=True)
        n_here, ours_here, last = 0, 0, time.monotonic()
        for p in walk_videos(r):
            n_here += 1
            if is_ours(p):
                found.append(p)
                ours_here += 1
            else:
                skipped += 1
                th = theme_of(p)
                if th and not any(norm(h) in norm(p) for h in EXCLUDE_HINTS):
                    # 왜 빠졌는지도 센다. '힌트에 안 걸림'과 '서류·개인정보로
                    # 걸러짐'은 손쓸 방법이 다르다. 전자는 힌트를 더하면 되고,
                    # 후자는 is_junk 규칙을 봐야 한다.
                    why = "junk" if is_junk(p) else "no-hint"
                    cur = rejected.setdefault(th, {"no-hint": 0, "junk": 0})
                    cur[why] += 1
            now = time.monotonic()
            if now - last >= 15:
                print(f"      … 영상 파일 {n_here}개 확인, 우리 것 {ours_here}개",
                      flush=True)
                last = now
        print(f"      → 영상 파일 {n_here}개 중 우리 것 {ours_here}개", flush=True)
    # 같은 영상이 여러 폴더에 있을 수 있다. 내용 지문으로 한 번만 쓴다.
    #
    # 예전에는 (파일명, 크기) 였다. 그래서 폴더가 다르고 내용도 다른 영상이
    # 이름과 크기만 같으면 뒤에 온 쪽이 버려졌다. 카메라·편집기가 붙이는
    # 이름(v1.mp4, output.mp4, GX010012.MP4)은 폴더마다 되풀이되고,
    # 고정 비트레이트로 같은 길이를 내보내면 크기까지 맞는다.
    # 시험에서 '칼리-여수' 폴더가 통째로 사라진 것이 이 때문이었다.
    #
    # 지문은 파일 앞뒤 64KB 를 읽는다. 구글 드라이브 스트리밍 마운트에서는
    # 그 조각을 받아오느라 파일마다 시간이 걸리니 여기도 진행을 찍는다.
    seen, vids = set(), []
    if found:
        print(f"\n중복 확인 중 ({len(found)}개)…", flush=True)
    last = time.monotonic()
    for i, p in enumerate(sorted(found), 1):
        key = _content_key(p)
        if key is None:          # 읽을 수 없는 파일은 쓸 수 없다
            continue
        if key not in seen:
            seen.add(key)
            vids.append(p)
        now = time.monotonic()
        if now - last >= 15:
            print(f"      … {i}/{len(found)}", flush=True)
            last = now
    # 길이를 잰다. 깨진 파일과 너무 짧은 조각을 편에 배정하기 전에 걸러야 한다.
    # 배정한 뒤에 실패하면 그 편이 비거나 통째로 사라진다.
    meta = {}
    if vids:
        print(f"\n영상 길이 확인 중 ({len(vids)}개)…", flush=True)
    last = time.monotonic()
    for i, v in enumerate(vids, 1):
        info = probe(v)
        meta[str(v)] = info["sec"] if info and info.get("w") else None
        now = time.monotonic()
        if now - last >= 15:
            print(f"      … {i}/{len(vids)}", flush=True)
            last = now
    try:
        SCAN_CACHE.parent.mkdir(parents=True, exist_ok=True)
        SCAN_CACHE.write_text(json.dumps({
            "key": cache_key, "at": time.time(), "vids": [str(v) for v in vids],
            "skipped": skipped, "rejected": rejected, "meta": meta,
        }, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return finish(args, vids, skipped, rejected, meta)


def load_used():
    try:
        d = json.loads(USED.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    d.setdefault("done", [])
    d.setdefault("sources", [])
    d.setdefault("keys", [])
    d.setdefault("titles", {})
    d.setdefault("last_no", 0)
    return d


def sync_used():
    """지난 계획 가운데 실제로 올라간 편의 영상을 '쓴 것'으로 적어둔다.

    이게 없으면 다시 돌릴 때마다 같은 폴더의 같은 앞쪽 영상이 또 뽑힌다.
    편 번호가 달라지면 파일 이름도 달라져서, 이미 올린 영상이 새 글로 한 번 더
    올라간다. 올라갔는지는 진행 기록(progress.json)이 말해준다 — 계획에 있었다는
    것만으로 쓴 것으로 치지 않는다. 올리다 실패한 편의 영상은 다시 쓸 수 있어야 한다.
    """
    import make_video_articles as mva
    led = load_used()
    try:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        posted = json.loads((ROOT / "state" / "progress.json").read_text(encoding="utf-8")).get("posted", [])
    except (OSError, ValueError):
        return led
    posted = {unicodedata.normalize("NFC", x) for x in posted}
    entries = plan.get("articles") or []
    names = [e.get("article") for e in entries]
    if not all(names):                      # 이름을 적어두기 전에 만든 계획
        names = mva.article_names(entries, 1)
    for e, name in zip(entries, names):
        name = unicodedata.normalize("NFC", name)
        if name not in posted or name in led["done"]:
            continue
        led["done"].append(name)
        led["sources"] += [v["source"] for v in e["videos"]]
        # 경로만 적어두면 같은 영상의 사본이 다른 폴더에 있을 때 못 알아본다.
        # 이 드라이브에는 사본이 많다 (채택 1,509개 중 425개가 중복이었다).
        for v in e["videos"]:
            k = _content_key(Path(v["source"]))
            if k and k not in led["keys"]:
                led["keys"].append(k)
        base = e.get("base") or mva.base_title(e)
        led["titles"][base] = led["titles"].get(base, 0) + 1
        m = re.match(r"(\d+)_", name)
        if m:
            led["last_no"] = max(led["last_no"], int(m.group(1)))
    try:
        USED.parent.mkdir(parents=True, exist_ok=True)
        USED.write_text(json.dumps(led, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass
    return led


def finish(args, vids, skipped, rejected, meta):
    """스캔 결과로 계획을 세우고 영상을 만든다."""
    total = len(vids)
    bad = [v for v in vids if not usable(v, meta)]
    vids = [v for v in vids if usable(v, meta)]
    led = sync_used()
    used, used_keys = set(led["sources"]), set(led["keys"])

    def was_used(v):
        return str(v) in used or (bool(used_keys) and _content_key(v) in used_keys)

    again = [v for v in vids if was_used(v)]
    vids = [v for v in vids if not was_used(v)]
    if bad or again:
        print(f"\n채택된 {total}개 가운데")
        if bad:
            print(f"  {len(bad):3}개 제외 — 읽을 수 없거나 {MIN_SECONDS}초보다 짧음")
        if again:
            print(f"  {len(again):3}개 제외 — 이미 올린 편에 쓴 영상")
    if args.limit:
        vids = vids[:args.limit]

    print(f"\n우리 영상 {len(vids)}개 (관계없는 것 {skipped}개는 뺐습니다)")
    by_theme = {}
    for v in vids:
        by_theme.setdefault(theme_of(v), []).append(v)
    print("\n주제(폴더)별:   (← 어느 힌트로 채택됐는지)")
    for t in sorted(by_theme, key=lambda x: -len(by_theme[x])):
        hs = sorted({h for v in by_theme[t] for h in matched_hints(v)})
        why = f"   ← {', '.join(hs)}" if hs else ""
        print(f"  {len(by_theme[t]):3}개  {t}{why}")

    if rejected and (args.scan_only or not vids):
        top = sorted(rejected.items(), key=lambda kv: -sum(kv[1].values()))[:25]
        print(f"\n걸러진 영상이 있던 폴더 (상위 {len(top)}개 · 참조 폴더는 제외):")
        for t, d in top:
            tag = "" if not d["junk"] else f"  (서류·개인정보로 걸러짐 {d['junk']}개)"
            print(f"  {sum(d.values()):3}개  {t}{tag}")
        print("\n  위에 우리 영상 폴더가 섞여 있으면 그 이름을")
        print("  scripts/collect_videos.py 의 VIDEO_HINTS 에 넣으면 잡힙니다.")
        print("  '서류·개인정보' 표시가 붙은 건 힌트를 더해도 안 잡힙니다.")

    if args.scan_only:
        return
    if not vids:
        sys.exit("\n쓸 영상이 없습니다. --src 로 폴더를 직접 주거나 폴더 이름을 확인하세요.")

    articles = group_into_articles(vids)
    if args.max_articles:
        whole = len(articles)
        articles = pick_articles(articles, args.max_articles)
        if whole > len(articles):
            print(f"\n전체 {whole}편 중 {len(articles)}편만 만듭니다 "
                  f"(--max-articles {args.max_articles}, 주제를 돌아가며 뽑음)")
    print(f"\n{len(articles)}편으로 묶었습니다 (편당 {PER_ARTICLE[0]}~{PER_ARTICLE[1]}개)\n")
    for i, a in enumerate(articles, 1):
        print(f"  {i:2}. [{a['theme']}] {len(a['videos'])}개")
        for v in a["videos"]:
            info = probe(v) if not args.dry_run else None
            extra = f"  ({info['sec']}초 {info['w']}×{info['h']})" if info else ""
            print(f"        {v.name}{extra}")

    if args.dry_run:
        print("\n(--dry-run 이므로 파일을 만들지 않았습니다)")
        return

    exe = ffmpeg()
    if not exe:
        sys.exit("ffmpeg 을 찾지 못했습니다. bash scripts/setup.sh 를 먼저 돌리세요.")
    if not args.bgm and not args.keep_audio:
        print("\n⚠️  --bgm 이 없어 소리를 뺀 채로 만듭니다.")
        print("    교육·회의 영상에는 사람 목소리가 들어 있어, 그대로 올리면")
        print("    목소리까지 공개됩니다. BGM 을 준 뒤 다시 돌리는 편이 낫습니다.")
    # --bgm auto: 편마다 종류에 맞는 곡을 고른다. 파일을 주면 전부 그 곡으로 한다.
    auto = (args.bgm or "").strip().lower() == "auto"
    bgm = None if auto else (Path(args.bgm).expanduser() if args.bgm else None)
    if bgm and not bgm.exists():
        sys.exit(f"BGM 파일이 없습니다: {bgm}")

    if VIDEOS.exists():
        shutil.rmtree(VIDEOS)
    VIDEOS.mkdir(parents=True)

    plan, made, failed = [], 0, []
    n = 0
    print()
    for i, a in enumerate(articles, 1):
        entry = {"theme": a["theme"], "videos": []}
        for v in a["videos"]:
            n += 1
            dst = VIDEOS / f"kalli_v{n:02d}.mp4"
            track = bgm_for(a["theme"]) if auto else bgm
            ok, err = mix_bgm(v, dst, track, exe, args.keep_audio, seconds=meta.get(str(v)))
            if not ok:
                failed.append((v.name, err))
                continue
            made += 1
            info = probe(dst) or {}
            entry["videos"].append({
                "file": dst.name,
                "source": str(v),
                "sec": info.get("sec"),
                "mb": round(dst.stat().st_size / 1e6, 1),
            })
            if track and not args.keep_audio:
                entry["videos"][-1]["bgm"] = track.name
            note = f" · {track.stem.replace('bgm_', '♪ ')}" if track and not args.keep_audio else ""
            print(f"  {dst.name}  ←  {v.name}  ({entry['videos'][-1]['mb']}MB{note})")
        if entry["videos"]:
            plan.append(entry)

    PLAN.parent.mkdir(parents=True, exist_ok=True)
    PLAN.write_text(json.dumps({
        "bgm": "auto (편마다 종류에 맞는 곡)" if auto else (str(bgm) if bgm else None),
        "audio": "원본 유지" if args.keep_audio else ("BGM" if bgm else "무음"),
        "articles": plan,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n영상 {made}개 준비 완료 → {VIDEOS}")
    print(f"편별 계획 → {PLAN}  ({len(plan)}편)")
    if failed:
        print(f"\n⚠️  {len(failed)}개 실패:")
        for name, err in failed[:10]:
            print(f"    {name}: {'; '.join(err or [])}")


if __name__ == "__main__":
    main()
