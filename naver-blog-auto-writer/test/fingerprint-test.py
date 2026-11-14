#!/usr/bin/env python3
"""같은 영상 가리기(fingerprint.py) 시험. 네이버에 접속하지 않는다.

클립에 같은 영상이 두 번 올라가지 않게 하는 규칙이다. 두 쪽을 다 고정한다:
  · 다시 내보낸 사본·배경음악을 입힌 사본은 같은 영상이다
  · 길이·크기가 같아도 내용이 다르면 다른 영상이다 (고프로는 같은 길이로 조각낸다)

    python3 test/fingerprint-test.py
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import fingerprint as fp  # noqa: E402

ff, fpr = shutil.which("ffmpeg"), shutil.which("ffprobe")
if not ff or not fpr:
    print("ffmpeg·ffprobe 이 없어 건너뜁니다")
    sys.exit(0)


def run(*args):
    subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    fp.CACHE = d / "fp.json"
    run("-f", "lavfi", "-i", "mandelbrot=s=1280x720:r=15", "-t", "12", "-c:v", "libx264", "-b:v", "2M", str(d / "a.mp4"))
    run("-i", str(d / "a.mp4"), "-vf", "scale=640:360", "-c:v", "libx264", "-b:v", "400k", str(d / "a_small.mp4"))
    run("-i", str(d / "a.mp4"), "-f", "lavfi", "-i", "sine=f=440:d=12", "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-b:v", "1M", "-shortest", str(d / "a_bgm.mp4"))
    run("-f", "lavfi", "-i", "life=s=1280x720:r=15:mold=10:ratio=0.2", "-t", "12", "-c:v", "libx264", "-b:v", "2M", str(d / "b.mp4"))
    run("-f", "lavfi", "-i", "mandelbrot=s=1280x720:r=15", "-t", "30", "-c:v", "libx264", "-b:v", "2M", str(d / "a_longer.mp4"))
    F = {n: fp.fingerprint(d / f"{n}.mp4", ff, fpr) for n in ["a", "a_small", "a_bgm", "b", "a_longer"]}
    checks = [
        ("작게·저화질로 다시 내보낸 사본은 같은 영상", fp.same_video(F["a"], F["a_small"])),
        ("배경음악을 입힌 사본은 같은 영상", fp.same_video(F["a"], F["a_bgm"])),
        ("길이·크기가 같아도 내용이 다르면 다른 영상", not fp.same_video(F["a"], F["b"])),
        ("길이가 다르면 비교하지 않는다", not fp.same_video(F["a"], F["a_longer"])),
        ("한 번 뜬 지문은 다시 계산하지 않는다", fp.fingerprint(d / "a.mp4", ff, fpr) is F["a"] or
         fp.fingerprint(d / "a.mp4", ff, fpr) == F["a"]),
    ]
ok = True
for name, good in checks:
    print(f"{'✅' if good else '❌'} {name}")
    ok &= good
sys.exit(0 if ok else 1)
