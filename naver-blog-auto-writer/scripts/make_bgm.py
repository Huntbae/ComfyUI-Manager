#!/usr/bin/env python3
"""
멜로디가 있는 배경음악 네 곡을 만든다. 직접 작곡하고 직접 합성한다.

왜 직접 만드나: 남의 음원은 홍보용 블로그에 쓸 수 있는지를 곡마다 확인해야 한다.
AI 음원 서비스도 무료 요금제에서는 상업적 이용이 안 되는 경우가 많다.
여기서 만든 곡은 음표부터 소리까지 전부 이 파일에서 나오므로 권리가 분명하다.

네 곡은 영상의 종류에 맞춘다 (collect_videos.py 가 폴더 이름으로 종류를 가린다):

    bgm_drive   주행·공도·시승   빠르고 밝게. 달리는 느낌.
    bgm_build   조립·제작        통통 튀는 마림바. 만드는 재미.
    bgm_learn   교육             따뜻한 피아노. 차분하지만 밝게.
    bgm_story   그 밖의 기록     느린 종소리와 패드. 담담하게.

짧은 영상에도 멜로디가 들리도록 전주 없이 첫 마디부터 멜로디가 나온다.

    python3 scripts/make_bgm.py            # 네 곡 모두 music/ 에
    python3 scripts/make_bgm.py drive      # 한 곡만

numpy 와 ffmpeg 가 필요하다. 만들어진 mp3 는 저장소에 들어 있으므로
올리는 기기에서는 이 스크립트를 돌릴 필요가 없다.
"""

import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "music"
SR = 44100
LENGTH = 90.0          # 초. 영상도 90초에서 자른다 (collect_videos.MAX_SECONDS)

MAJOR = [0, 2, 4, 5, 7, 9, 11]
CHORDS = {"I": (1, 3, 5), "ii": (2, 4, 6), "iii": (3, 5, 7),
          "IV": (4, 6, 8), "V": (5, 7, 9), "vi": (6, 8, 10)}


def midi(deg, key):
    """음계의 몇 번째 음인가 → MIDI 번호. 8 은 한 옥타브 위의 1."""
    d = deg - 1
    return key + 12 * (d // 7) + MAJOR[d % 7]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


# ── 악기 ─────────────────────────────────────────────────────────
# 배음마다 (배수, 크기, 감쇠) 를 준다. 감쇠가 큰 배음은 빨리 사라져
# 처음엔 밝고 뒤로 갈수록 둥글어진다. 실제 현·건반이 그렇게 들린다.
VOICES = {
    "pluck":   dict(h=[(1, 1, 0), (2, .45, 5), (3, .25, 8), (4, .12, 11)], decay=2.6, rel=14),
    "marimba": dict(h=[(1, 1, 0), (4, .35, 14), (10, .08, 30)], decay=5.5, rel=18),
    "piano":   dict(h=[(1, 1, 0), (2, .5, 1.5), (3, .3, 3), (4, .18, 4.5), (5, .1, 6), (6, .06, 8)],
                    decay=2.2, rel=9, stretch=0.0004),
    "bell":    dict(h=[(1, 1, 0), (2.76, .35, 3), (5.4, .15, 6), (8.9, .06, 10)], decay=2.0, rel=5),
    "bass":    dict(h=[(1, 1, 0), (2, .4, 3), (3, .12, 6)], decay=3.2, rel=20),
}


def tone(voice, f, dur):
    v = VOICES[voice]
    n = int((dur + 0.5) * SR)
    t = np.arange(n) / SR
    w = np.zeros(n)
    for k, (mult, amp, dec) in enumerate(v["h"]):
        ff = f * mult * (1 + v.get("stretch", 0) * k * k)
        if ff > SR / 2.2:
            continue
        w += amp * np.sin(2 * np.pi * ff * t) * np.exp(-t * dec)
    env = np.exp(-t * v["decay"])
    env *= np.where(t < dur, 1.0, np.exp(-(t - dur) * v["rel"]))     # 건반을 뗀 뒤
    a = int(0.004 * SR)
    env[:a] *= np.linspace(0, 1, a)                                  # 딸깍 소리 방지
    return w * env


def pad(freqs, dur):
    """느리게 차오르는 화음. 살짝 어긋난 사인파 셋을 겹쳐 두께를 준다."""
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    w = np.zeros(n)
    for f in freqs:
        for det in (0.997, 1.0, 1.004):
            w += np.sin(2 * np.pi * f * det * t) + 0.25 * np.sin(2 * np.pi * 2 * f * det * t)
    att = np.minimum(t / 0.45, 1.0)
    rel = np.where(t < dur, 1.0, np.exp(-(t - dur) * 5))
    return w * att * rel / (3 * len(freqs))


def kick():
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = 45 + 85 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 13)


def hat(rng, length=0.05):
    n = int(length * SR)
    x = rng.standard_normal(n)
    x = np.diff(x, prepend=0)                 # 높은 쪽만 남긴다
    return x * np.exp(-np.arange(n) / SR * 70)


def clap(rng):
    n = int(0.16 * SR)
    x = rng.standard_normal(n)
    x = np.convolve(x, np.ones(6) / 6, mode="same")
    x = np.diff(x, prepend=0)
    return x * np.exp(-np.arange(n) / SR * 26)


# ── 곡 ───────────────────────────────────────────────────────────
# 멜로디는 마디마다 8칸(8분음표)으로 적는다.
#   숫자 = 음계의 몇 번째 음 (8 = 한 옥타브 위의 1, 10 = 위의 3)
#   -    = 앞의 음을 끈다
#   .    = 쉰다
# 마디의 첫 음과 긴 음은 그 마디 화음의 구성음으로 골랐다. 그래야 어긋나지 않는다.
SONGS = {
    # 달리는 느낌. 한 마디 안에서 위로 뛰었다 내려온다.
    "drive": dict(
        bpm=118, key=67, acc=55, bass=43, lead="pluck",
        A=(["I", "V", "vi", "IV"],
           ["3 - 5 8 - 5 3 5", "2 - 5 7 - 5 2 5", "3 - 6 8 - 6 3 6", "4 - 6 8 - 6 5 4"]),
        A2=(["I", "V", "vi", "IV"],
            ["10 - 9 8 - 5 - 8", "9 - 7 5 - 7 9 -", "10 - 8 6 - 8 10 -", "11 10 8 6 - 8 9 -"]),
        B=(["IV", "V", "vi", "V", "IV", "V", "I", "I"],
           ["6 - 8 6 - 4 - 6", "7 - 9 7 - 5 - 7", "8 - 10 8 - 6 - 8", "9 - 7 5 - 2 5 7",
            "6 - 8 6 - 8 11 -", "7 - 9 7 - 9 12 -", "10 - - 8 - 5 - 8", "8 - - - . . 5 7"]),
        arp=[0, 1, 2, 1, 0, 1, 2, 1], arp_gain=.10, pad_gain=.05,
        bass_slots=[0, 3, 4, 6], kick=[0, 2, 4, 6], hat=[1, 3, 5, 7], clap=[2, 6],
    ),
    # 만드는 재미. 올라가는 분산화음 뒤에 숨을 한 번 쉰다.
    "build": dict(
        bpm=104, key=72, acc=60, bass=36, lead="marimba",
        A=(["I", "vi", "IV", "V"],
           ["1 3 5 8 . 5 3 .", "3 6 8 10 . 8 6 .", "4 6 8 11 . 8 6 .", "5 7 9 12 . 9 7 5"]),
        A2=(["I", "vi", "IV", "V"],
            ["8 . 8 10 9 8 5 .", "8 . 8 10 9 8 6 .", "8 . 8 11 10 8 6 .", "9 . 9 12 11 9 7 ."]),
        B=(["IV", "V", "iii", "vi", "IV", "V", "I", "I"],
           ["6 - 8 - 11 - 8 -", "7 - 9 - 12 - 9 -", "5 - 7 - 10 - 7 -", "6 - 8 - 10 - 8 -",
            "4 6 8 6 4 6 8 11", "5 7 9 7 5 7 9 12", "8 - - - 5 - 3 -", "1 - - - . . 3 5"]),
        arp=None, stab=[1, 3, 5, 7], arp_gain=.08, pad_gain=.04,
        bass_slots=[0, 4, 6], kick=[0, 4, 5], hat=[0, 1, 2, 3, 4, 5, 6, 7], clap=[2, 6],
    ),
    # 따뜻하게. 멜로디는 길게 끌고, 아래에서 피아노가 잔잔하게 흐른다.
    "learn": dict(
        bpm=96, key=65, acc=53, bass=41, lead="piano",
        A=(["I", "V", "vi", "IV"],
           ["5 - - - 3 - 5 -", "5 - - - 2 - 5 -", "6 - - - 3 - 6 -", "6 - 4 - 8 - 6 -"]),
        A2=(["I", "V", "vi", "IV"],
            ["8 - - 7 8 - 10 -", "9 - - 7 5 - 7 -", "8 - - 6 8 - 10 -", "11 - 10 - 8 - 6 -"]),
        B=(["IV", "V", "I", "vi", "IV", "V", "I", "I"],
           ["4 - 6 - 8 - - -", "5 - 7 - 9 - - -", "8 - 10 - 12 - 10 -", "10 - 8 - 6 - - -",
            "4 - 6 - 8 - 11 -", "9 - 7 - 5 - 7 -", "8 - - - - - - -", "8 - - - . . 3 5"]),
        arp=[0, 1, 2, 1, 0, 1, 2, 1], arp_voice="piano", arp_gain=.11, pad_gain=.05,
        bass_slots=[0, 4], kick=[0], hat=[], clap=[4],
    ),
    # 담담하게. 종소리가 천천히 한 음씩.
    "story": dict(
        bpm=84, key=74, acc=50, bass=38, lead="bell",
        A=(["I", "V", "vi", "IV"],
           ["3 - - - 5 - - -", "2 - - - 5 - - -", "3 - - - 6 - - -", "4 - - - 6 - 5 -"]),
        A2=(["I", "V", "vi", "IV"],
            ["8 - - - 5 - 3 -", "7 - - - 5 - 2 -", "8 - - - 6 - 3 -", "6 - 8 - 6 - 4 -"]),
        B=(["IV", "V", "I", "vi", "IV", "V", "I", "I"],
           ["6 - - - 8 - - -", "7 - - - 9 - - -", "10 - - - 8 - 5 -", "10 - 8 - 6 - - -",
            "11 - - - 8 - 6 -", "9 - - - 7 - 5 -", "8 - - - - - - -", "8 - - - . . . ."]),
        arp=[0, None, 1, None, 2, None, 1, None], arp_voice="piano", arp_gain=.08, pad_gain=.10,
        bass_slots=[0], kick=[], hat=[], clap=[],
    ),
}


def parse(bar):
    """'3 - 5 8 . 5 3 5' → [(칸, 길이, 음)]"""
    out, cur = [], None
    for i, tok in enumerate(bar.split()):
        if tok == "-":
            if cur:
                cur[1] += 1
        elif tok == ".":
            cur = None
        else:
            cur = [i, 1, int(tok)]
            out.append(cur)
    return [tuple(x) for x in out]


def render(name):
    s = SONGS[name]
    rng = np.random.default_rng(sum(map(ord, name)))      # 곡마다 같은 결과가 나오게
    bar = 4 * 60.0 / s["bpm"]
    slot = bar / 8

    # 처음부터 멜로디. 첫 바퀴는 가볍게, 둘째 바퀴부터 리듬을 다 넣는다.
    order = [("A", 1), ("A2", 1), ("A", 2), ("A2", 2), ("B", 2), ("A", 2), ("A2", 2),
             ("B", 2), ("A", 2), ("A2", 2)]
    bars = []
    for sec, level in order:
        chords, mel = s[sec]
        bars += [(c, m, level) for c, m in zip(chords, mel)]
        if len(bars) * bar >= LENGTH + bar:
            break

    total = int((len(bars) * bar + 3) * SR)
    L, R = np.zeros(total), np.zeros(total)

    def put(sig, at, gain, pan=0.0):
        i = int(at * SR)
        j = min(i + len(sig), total)
        if i >= total:
            return
        seg = sig[: j - i] * gain
        L[i:j] += seg * (1 - max(pan, 0))
        R[i:j] += seg * (1 + min(pan, 0))

    k_, c_ = kick(), None
    for b, (chord, mel, level) in enumerate(bars):
        t0 = b * bar
        degs = CHORDS[chord]

        # 멜로디
        for st, ln, deg in parse(mel):
            vel = 0.30 * (1.0 if st % 2 == 0 else 0.88) * rng.uniform(0.94, 1.0)
            put(tone(s["lead"], hz(midi(deg, s["key"])), ln * slot * 0.96), t0 + st * slot, vel, 0.05)

        # 화음 (패드)
        put(pad([hz(midi(d, s["acc"])) for d in degs], bar), t0, s["pad_gain"])

        # 반주: 분산화음 또는 엇박 화음
        voice = s.get("arp_voice", "pluck")
        if s.get("arp"):
            for st, idx in enumerate(s["arp"]):
                if idx is None:
                    continue
                put(tone(voice, hz(midi(degs[idx], s["acc"])), slot * 0.9),
                    t0 + st * slot, s["arp_gain"], -0.35 if st % 2 else 0.35)
        for st in s.get("stab", []):
            for d in degs:
                put(tone("pluck", hz(midi(d, s["acc"])), slot * 0.35), t0 + st * slot,
                    s["arp_gain"] * 0.6, 0.3 if st % 4 == 1 else -0.3)

        # 베이스: 화음의 밑음
        for st in s["bass_slots"]:
            put(tone("bass", hz(midi(degs[0], s["bass"])), slot * 1.6), t0 + st * slot, 0.24)

        # 리듬. 첫 바퀴(level 1)는 킥만 가볍게.
        for st in s["kick"]:
            if level == 1 and st not in (0, 4):
                continue
            put(k_, t0 + st * slot, 0.26 if level == 2 else 0.18)
        if level == 2:
            for st in s["hat"]:
                put(hat(rng), t0 + st * slot, 0.035 if st % 2 else 0.022, 0.2)
            for st in s["clap"]:
                c_ = clap(rng)
                put(c_, t0 + st * slot, 0.075, -0.1)

    n = int(LENGTH * SR)
    mix = np.stack([L[:n], R[:n]], axis=1)
    mix /= max(np.abs(mix).max(), 1e-9) / 0.9
    return mix


def save(name, mix):
    OUT.mkdir(parents=True, exist_ok=True)
    wav = OUT / f"_{name}.wav"
    with wave.open(str(wav), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype("<i2").tobytes())
    mp3 = OUT / f"bgm_{name}.mp3"
    # 울림을 조금 주고(aecho), 날카로운 끝을 깎고(lowpass), 크기를 다른 곡과 맞춘다(loudnorm).
    # 끝은 3초에 걸쳐 줄인다 — 90초를 다 쓰는 영상에서 뚝 끊기지 않게.
    af = ("aecho=0.8:0.6:70|140:0.22|0.12,lowpass=f=11000,"
          "loudnorm=I=-18:TP=-2:LRA=11,"
          f"afade=t=in:st=0:d=0.15,afade=t=out:st={LENGTH - 3}:d=3")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav),
                    "-af", af, "-ar", "44100", "-b:a", "128k", str(mp3)], check=True)
    wav.unlink()
    return mp3


def main():
    names = sys.argv[1:] or list(SONGS)
    for name in names:
        if name not in SONGS:
            sys.exit(f"모르는 곡: {name} (가능: {', '.join(SONGS)})")
        mp3 = save(name, render(name))
        print(f"  {mp3.name}  {SONGS[name]['bpm']}BPM  {mp3.stat().st_size / 1e6:.1f}MB")


if __name__ == "__main__":
    main()
