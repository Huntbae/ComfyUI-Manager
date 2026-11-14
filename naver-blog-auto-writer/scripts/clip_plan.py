#!/usr/bin/env python3
"""
네이버 클립에 올릴 영상 목록을 만든다 (state/clip_plan.json).

영상은 드라이브 스캔에서 찾은 것 전체에서 고른다 (state/video_scan.json).
블로그에 이미 올린 편의 영상이 있으면 그것부터 넣고, 모자라는 만큼 다른 영상을
더 찾아 채운다. 그래서 돌릴 때마다 아직 안 올린 다음 영상들이 나온다.

클립은 올리면 바로 공개된다. 그래서 블로그보다 좁게 고른다.

1. 교육 현장 영상은 뺀다. 학생 얼굴이 찍혀 있고 미성년자가 포함된다. 블로그는
   임시저장이라 발행 전에 사람이 볼 수 있었지만, 클립에는 그 기회가 없다.
   폴더 이름뿐 아니라 경로 어디에든 '교육'·'수업'이 있으면 뺀다. 차량 영상이
   몇 개 같이 빠지더라도 그쪽이 낫다.

2. 무엇을 찍었는지 알 수 없는 영상은 뺀다. 폴더 이름으로 제품도 종류도 가릴 수
   없는 것 ('동영상 임시 백업' 같은). 넣으려면 --include-unknown.

3. 이미 클립에 올린 영상은 뺀다 (state/clip_done.json — 내용 지문으로 기억한다.
   kalli_v04.mp4 같은 파일 이름은 묶음마다 다시 쓰이므로 믿을 수 없다).

고른 영상 가운데 아직 배경음악을 입히지 않은 것은 여기서 입혀 videos_clip/ 에 둔다.

    python3 scripts/clip_plan.py              # 10개
    python3 scripts/clip_plan.py --count 20
    python3 scripts/clip_plan.py --dry-run    # 고르기만 하고 영상은 만들지 않는다
"""

import argparse
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect_videos as cv  # noqa: E402
import make_video_articles as mva  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / "state" / "video_plan.json"
PROGRESS = ROOT / "state" / "progress.json"
OUT = ROOT / "state" / "clip_plan.json"
DONE = ROOT / "state" / "clip_done.json"
VIDEOS = ROOT / "videos"
CLIP_VIDEOS = ROOT / "videos_clip"

# 클립 제목은 짧아야 한다. 화면의 제목칸이 더 짧으면 올리는 쪽이 거기에 맞춘다.
TITLE_MAX = 40

# 클립 설명에 넣는 제품 소개. 블로그 원고의 긴 설명(mva.FACTS)을 두세 문장으로 줄인 것.
# 여기도 확정된 사실만 쓴다 — 가격·주행거리·'최초' 같은 말은 없다.
ABOUT = {
    "edu": ("에듀카트(eDu Kart)는 클랜헌트가 만든 교육용 전기카트 키트입니다. "
            "부품 상태에서 직접 조립해 보면서 전기차가 어떻게 움직이는지를 배웁니다."),
    "kalli": ("칼리(Kalli)는 클랜헌트가 기획하고 개발한 1인승 전기차입니다. "
              "공인시험 33종을 거쳐 번호판을 달고 도로를 달립니다. "
              "최고속도 60km/h, 교환식 배터리를 씁니다."),
    "none": ("클랜헌트(ClanHunts)는 교육용 전기카트 '에듀카트'와 1인승 전기차 "
             "'칼리(Kalli)'를 직접 기획하고 개발합니다."),
}

# 경로 어디에든 이 말이 있으면 교육 현장 영상으로 본다.
EDUCATION_WORDS = ["교육", "수업", "교안", "학교", "고등학교", "중학교", "초등학교", "학생"]


def nfc(s):
    return unicodedata.normalize("NFC", str(s))


def load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def cta(blog_id):
    where = f" (blog.naver.com/{blog_id})" if blog_id else ""
    return f"궁금한 점은 댓글로 남겨 주세요. 더 많은 영상과 개발 이야기는 블로그{where}에 있습니다."


def is_education(path):
    p = nfc(path)
    return any(w in p for w in EDUCATION_WORDS)


def load_done():
    d = load(DONE, {})
    d.setdefault("keys", [])        # 올린 영상의 내용 지문
    d.setdefault("sources", [])     # 올린 영상의 원본 경로
    d.setdefault("counts", {})      # 제목 종류별로 몇 개 올렸나 (번호를 이어 붙이려고)
    d.setdefault("log", [])
    return d


def round_robin(groups, order):
    """주제를 돌아가며 하나씩. 한 폴더의 영상만 줄줄이 나오지 않게."""
    out = []
    while any(groups[t] for t in order):
        for t in order:
            if groups[t]:
                out.append(groups[t].pop(0))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=10, help="이번에 고를 영상 수 (기본 10)")
    ap.add_argument("--include-unknown", action="store_true",
                    help="무엇을 찍었는지 알 수 없는 폴더의 영상도 넣는다")
    ap.add_argument("--dry-run", action="store_true", help="고르기만 하고 영상은 만들지 않는다")
    args = ap.parse_args()

    scan = load(cv.SCAN_CACHE, None)
    if not scan or not scan.get("vids"):
        sys.exit("드라이브 스캔 결과가 없습니다. 먼저 한 번 훑어야 합니다:\n"
                 '    kart videos --scan-only --only-src --src "/Volumes/Mac Data" --src /Volumes/Samsung_T5')
    meta = scan.get("meta") or {}
    done = load_done()
    done_keys, done_src = set(done["keys"]), set(done["sources"])
    blog_id = load(ROOT / "config.json", {}).get("blogId", "")

    # 블로그에 올린 편에 들어간 영상은 이미 배경음악까지 입혀져 있다. 그것부터 쓴다.
    ready = {}
    posted = {nfc(x) for x in load(PROGRESS, {}).get("posted", [])}
    for e in (load(PLAN, {}) or {}).get("articles", []):
        if nfc(e.get("article") or "") not in posted:
            continue
        for v in e["videos"]:
            f = VIDEOS / v["file"]
            if f.exists():
                ready[v["source"]] = f

    skipped = {"짧음": 0, "교육": 0, "모름": 0, "올림": 0, "없음": 0}
    pool = []
    for src in scan["vids"]:
        p = Path(src)
        if not cv.usable(p, meta):
            skipped["짧음"] += 1
            continue
        if is_education(src):
            skipped["교육"] += 1
            continue
        theme = cv.theme_of(p)
        product = mva.product_of(theme, [src])
        kind = mva.kind_of(theme)
        if product == "none" and kind == "기록" and not args.include_unknown:
            skipped["모름"] += 1
            continue
        if src in done_src:
            skipped["올림"] += 1
            continue
        pool.append(dict(src=src, theme=theme, product=product, kind=kind))

    # 블로그에 올린 것 먼저, 그다음은 주제를 돌아가며.
    first = [x for x in pool if x["src"] in ready]
    rest = [x for x in pool if x["src"] not in ready]
    groups = {}
    for x in sorted(rest, key=lambda x: x["src"]):
        groups.setdefault(x["theme"], []).append(x)
    order = sorted(groups, key=lambda t: (-len(groups[t]), t))
    ordered = first + round_robin(groups, order)

    exe = cv.ffmpeg()
    if not exe and not args.dry_run:
        sys.exit("ffmpeg 을 찾지 못했습니다. bash scripts/setup.sh 를 먼저 돌리세요.")

    items, counts = [], dict(done["counts"])
    for x in ordered:
        if len(items) >= args.count:
            break
        src = Path(x["src"])
        if not src.exists():
            skipped["없음"] += 1          # 드라이브가 안 꽂혀 있다
            continue
        key = cv._content_key(src)
        if not key or key in done_keys or any(it["id"] == key for it in items):
            skipped["올림" if key in done_keys else "없음"] += 1
            continue
        t = mva.pick(x["product"], x["kind"])
        counts[t["vkw"]] = counts.get(t["vkw"], 0) + 1
        title = f"{t['vkw']} {counts[t['vkw']]}"
        tail = t["title"].split(" — ", 1)[-1]
        if len(title) + 3 + len(tail) <= TITLE_MAX:
            title = f"{title} — {tail}"
        sec = meta.get(x["src"])
        items.append({
            "id": key,
            "source": x["src"],
            "vkw": t["vkw"],
            "title": title[:TITLE_MAX],
            # 설명은 두 가지 길이로 준비한다. 클립의 설명칸이 몇 자까지 받는지는
            # 화면에서 읽어야 안다. 올리는 쪽이 칸에 들어가는 가장 긴 것을 고른다.
            "description": f"{t['hook']}\n\n{ABOUT[x['product']]}\n\n{cta(blog_id)}",
            "description_short": f"{t['hook']} {cta(blog_id)}",
            "tags": [w.lstrip("#") for w in mva.TAGS[x["product"]].split()],
            "theme": x["theme"],
            "kind": f"{x['product']}/{x['kind']}",
            "sec": min(sec, cv.MAX_SECONDS) if sec else None,
            "ready": str(ready[x["src"]]) if x["src"] in ready else None,
        })

    print(f"클립에 올릴 영상 {len(items)}개 (아직 안 올린 차량 영상 {len(pool)}개 가운데)\n")
    for i, it in enumerate(items, 1):
        sec = f" · {int(it['sec'])}초" if it.get("sec") else ""
        print(f"  {i:2}. {it['title']}")
        print(f"        {Path(it['source']).name}{sec} · 폴더 '{it['theme']}' · {it['kind']}"
              f"{' · 블로그에 올린 영상' if it['ready'] else ''}")
    if items:
        print("\n설명은 이렇게 들어갑니다 (첫 영상):")
        for line in items[0]["description"].splitlines():
            print(f"    {line}")
        print("    " + " ".join(f"#{t}" for t in items[0]["tags"]))
    why = {
        "교육": "교육 현장 영상 (학생 얼굴 — 클립은 바로 공개되어 미리 볼 수 없다)",
        "모름": "무엇을 찍었는지 알 수 없는 폴더 (넣으려면 --include-unknown)",
        "올림": "이미 클립에 올린 영상",
        "짧음": f"읽을 수 없거나 {cv.MIN_SECONDS}초보다 짧은 영상",
        "없음": "원본을 읽을 수 없음 (드라이브가 꽂혀 있는지 확인)",
    }
    if any(skipped.values()):
        print("\n뺀 것:")
        for k in ("교육", "모름", "올림", "짧음", "없음"):
            if skipped[k]:
                print(f"  {skipped[k]:3}개  {why[k]}")

    if args.dry_run:
        print("\n(--dry-run 이므로 영상을 만들지 않았고 목록도 저장하지 않았습니다)")
        return

    # 배경음악을 입힌다. 블로그에 올린 영상은 이미 입혀져 있으니 그대로 쓴다.
    todo = [it for it in items if not it["ready"]]
    if todo:
        print(f"\n배경음악 입히는 중 ({len(todo)}개)…", flush=True)
    CLIP_VIDEOS.mkdir(parents=True, exist_ok=True)
    good = []
    for it in items:
        if it["ready"]:
            it["path"] = it["ready"]
        else:
            dst = CLIP_VIDEOS / f"clip_{it['id'][:12]}.mp4"
            if not dst.exists():
                track = cv.bgm_for(it["theme"])
                ok, err = cv.mix_bgm(Path(it["source"]), dst, track, exe, seconds=meta.get(it["source"]))
                if not ok:
                    print(f"  ⚠️  {Path(it['source']).name}: {'; '.join(err or [])} — 건너뜁니다")
                    continue
                print(f"  {dst.name}  ←  {Path(it['source']).name}"
                      f"  ({dst.stat().st_size / 1e6:.1f}MB · ♪ {track.stem.replace('bgm_', '') if track else '없음'})",
                      flush=True)
            it["path"] = str(dst)
        it["file"] = Path(it["path"]).name
        del it["ready"]
        good.append(it)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"items": good}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n목록 {len(good)}개 → {OUT}")


if __name__ == "__main__":
    main()
