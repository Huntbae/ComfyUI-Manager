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
]

# 남의 영상 — 참조용으로 모아둔 것들. 사진에서와 같은 이유로 제외한다.
EXCLUDE_HINTS = ["참고동영상", "참고 동영상", "참조", "reference", "레퍼런스", "벤치마"]

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
            if Path(fn).suffix.lower() in VID_EXTS:
                yield Path(dirpath) / fn


def is_ours(path):
    """우리가 찍은 영상인가. 참조 폴더와 서류성 파일은 뺀다."""
    low = norm(path)
    if any(norm(h) in low for h in EXCLUDE_HINTS):
        return False
    if is_junk(path):
        return False
    return any(norm(h) in low for h in VIDEO_HINTS)


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


def mix_bgm(src, dst, bgm, exe, keep_audio=False):
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
        cmd += ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "128k",
                "-af", "volume=0.9", "-shortest"]
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
    args = ap.parse_args()

    if args.only_src and not args.src:
        sys.exit("--only-src 는 --src <경로> 와 함께 써야 합니다.")
    roots = find_roots(args.src, only_src=args.only_src)
    if not roots:
        sys.exit("영상을 찾을 폴더가 없습니다. 구글 드라이브가 연결됐는지 보거나 --src 를 주세요.")
    print("검색할 폴더:")
    for label, r in roots:
        print(f"  [{label}] {r}")

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
                    rejected[th] = rejected.get(th, 0) + 1
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
    if args.limit:
        vids = vids[:args.limit]

    print(f"\n우리 영상 {len(vids)}개 (관계없는 것 {skipped}개는 뺐습니다)")
    by_theme = {}
    for v in vids:
        by_theme.setdefault(theme_of(v), []).append(v)
    print("\n주제(폴더)별:")
    for t in sorted(by_theme, key=lambda x: -len(by_theme[x])):
        print(f"  {len(by_theme[t]):3}개  {t}")

    if rejected and (args.scan_only or not vids):
        top = sorted(rejected.items(), key=lambda kv: -kv[1])[:20]
        print(f"\n걸러진 영상이 있던 폴더 (상위 {len(top)}개 · 참조 폴더는 제외):")
        for t, c in top:
            print(f"  {c:3}개  {t}")
        print("\n  위에 우리 영상 폴더가 섞여 있으면 그 이름을")
        print("  scripts/collect_videos.py 의 VIDEO_HINTS 에 넣으면 잡힙니다.")

    if args.scan_only:
        return
    if not vids:
        sys.exit("\n쓸 영상이 없습니다. --src 로 폴더를 직접 주거나 폴더 이름을 확인하세요.")

    articles = group_into_articles(vids)
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
    bgm = Path(args.bgm).expanduser() if args.bgm else None
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
            ok, err = mix_bgm(v, dst, bgm, exe, args.keep_audio)
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
            print(f"  {dst.name}  ←  {v.name}  ({entry['videos'][-1]['mb']}MB)")
        if entry["videos"]:
            plan.append(entry)

    PLAN.parent.mkdir(parents=True, exist_ok=True)
    PLAN.write_text(json.dumps({
        "bgm": str(bgm) if bgm else None,
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
