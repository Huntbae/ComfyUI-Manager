#!/usr/bin/env python3
"""
같은 영상인지 화면으로 가린다.

파일 내용 지문(collect_videos._content_key)은 똑같은 사본만 잡는다. 같은 영상을 다시
내보내거나(편집기·폰 공유) 이름을 바꿔 다른 폴더에 둔 것은 바이트가 달라서 못 잡는다.
실제 드라이브에 그런 쌍이 있다 — '조립 영상 제작/GH020505.MP4' 와
'Ver. 2 조립관련 영상/GH010505-021.MP4' 는 길이(531.5초)와 화면 크기(2704×1520)가 같다.

길이만 같다고 같은 영상으로 치면 안 된다. 고프로는 긴 촬영을 같은 길이의 조각으로
나눠 저장한다. 내용이 다른데 길이가 같은 조각이 흔하다.

그래서 화면을 본다. 영상의 15%·50%·85% 지점에서 한 장씩 떠서 9×8 흑백으로 줄이고,
옆 칸보다 밝은지 어두운지로 64비트를 만든다(dHash). 화질·크기·배경음악이 달라도
같은 장면이면 거의 같은 값이 나온다. 세 장 모두 가까우면 같은 영상이다.

비교는 비싸지 않게 한다: 길이가 1초 안쪽이고 화면 비율이 같은 짝만 본다.
"""

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "state" / "video_fp.json"

SPOTS = (0.15, 0.50, 0.85)
# 64비트 중 몇 비트까지 달라도 같은 장면으로 보나. 재인코딩·축소로는 보통 0~6.
# 다른 장면은 대개 20 이상. 세 장 모두 이 안이어야 한다.
TOLERANCE = 10

_cache = None


def _load():
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _cache = {}
    return _cache


def _save():
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(_cache or {}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def probe(path, ffprobe):
    """(길이, 가로, 세로). 못 읽으면 None."""
    try:
        out = subprocess.run([
            ffprobe, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration", "-of", "json", str(path),
        ], capture_output=True, text=True, timeout=60).stdout
        d = json.loads(out)
        st = (d.get("streams") or [{}])[0]
        sec = float((d.get("format") or {}).get("duration") or 0)
        w, h = st.get("width"), st.get("height")
        return (sec, w, h) if sec and w and h else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _dhash(path, at, ffmpeg):
    try:
        raw = subprocess.run([
            ffmpeg, "-v", "error", "-ss", f"{at:.2f}", "-i", str(path), "-frames:v", "1",
            "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-",
        ], capture_output=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    if len(raw) < 72:
        return None
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | (1 if raw[row * 9 + col] < raw[row * 9 + col + 1] else 0)
    return bits


def fingerprint(path, ffmpeg, ffprobe):
    """{'sec','w','h','hashes'} 또는 None. 같은 경로는 한 번만 계산한다 (state/video_fp.json)."""
    cache = _load()
    key = str(path)
    try:
        st = Path(path).stat()
        stamp = f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return None
    hit = cache.get(key)
    if hit and hit.get("stamp") == stamp:
        return hit
    info = probe(path, ffprobe)
    if not info:
        return None
    sec, w, h = info
    hashes = [_dhash(path, sec * s, ffmpeg) for s in SPOTS]
    if any(x is None for x in hashes):
        return None
    fp = {"stamp": stamp, "sec": round(sec, 2), "w": w, "h": h, "hashes": hashes}
    cache[key] = fp
    _save()
    return fp


def could_match(a, b):
    """비교해 볼 만한 짝인가. 길이가 1초 안쪽이고 화면 비율이 같다."""
    if not a or not b:
        return False
    if abs(a["sec"] - b["sec"]) > 1.0:
        return False
    ra, rb = a["w"] / a["h"], b["w"] / b["h"]
    return abs(ra - rb) / max(ra, rb) < 0.03


def same_video(a, b):
    if not could_match(a, b):
        return False
    return all(bin(x ^ y).count("1") <= TOLERANCE for x, y in zip(a["hashes"], b["hashes"]))
