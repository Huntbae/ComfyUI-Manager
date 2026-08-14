#!/usr/bin/env python3
"""무편집 왕복 검증 하네스 — Phase 0 게이트.

세 가지 전략을 비교한다.
  A) naive     : content.json 을 파싱해 알려진 필드만 재구성 (기존 OSS 방식)
  B) ast       : 파싱한 AST 를 그대로 재직렬화
  C) preserve  : ZIP 엔트리를 통째로 보존하고 content.json 만 교체
"""
import json, zipfile, glob, os, sys, io, hashlib

CORPUS = sys.argv[1]
OUT = os.path.join(CORPUS, "..", "roundtrip_out")
os.makedirs(OUT, exist_ok=True)

# 기존 OSS 가 다루는 "알려진 필드" 집합 (simple-mind-map 기준)
KNOWN = {"id", "title", "structureClass", "children", "notes", "href", "labels",
         "summaries", "class", "extensions"}


def naive_topic(t):
    """알려진 필드만 살려서 재구성 — 기존 OSS 파서를 흉내낸다."""
    out = {"id": t.get("id"), "title": t.get("title", "")}
    if "structureClass" in t:
        out["structureClass"] = t["structureClass"]
    if "notes" in t:
        out["notes"] = t["notes"]
    href = t.get("href")
    if href and href.startswith(("http://", "https://")):   # OSS 의 실제 필터
        out["href"] = href
    if "labels" in t:
        out["labels"] = t["labels"]
    kids = (t.get("children") or {}).get("attached") or []   # attached 만 본다
    if kids:
        out["children"] = {"attached": [naive_topic(c) for c in kids]}
    return out


def count_topics(t):
    n = 1
    for slot in ("attached", "detached", "summary", "callout"):
        for c in (t.get("children") or {}).get(slot, []) or []:
            n += count_topics(c)
    return n


def collect_fields(t, acc):
    acc.update(t.keys())
    for slot in ("attached", "detached", "summary", "callout"):
        for c in (t.get("children") or {}).get(slot, []) or []:
            collect_fields(c, acc)
    return acc


results = []
for d in sorted(glob.glob(CORPUS + "/f*")):
    fid = os.path.basename(d)
    raw = open(os.path.join(d, "content.json"), "rb").read()
    ast = json.loads(raw)

    orig_fields = set()
    orig_topics = 0
    for sh in ast:
        collect_fields(sh["rootTopic"], orig_fields)
        orig_topics += count_topics(sh["rootTopic"])

    # --- A) naive ---
    naive = [{"id": sh["id"], "class": "sheet", "title": sh.get("title", ""),
              "rootTopic": naive_topic(sh["rootTopic"])} for sh in ast]
    n_fields, n_topics = set(), 0
    for sh in naive:
        collect_fields(sh["rootTopic"], n_fields)
        n_topics += count_topics(sh["rootTopic"])
    lost_fields = orig_fields - n_fields
    lost_sheetkeys = set().union(*[set(sh.keys()) for sh in ast]) - set().union(*[set(sh.keys()) for sh in naive])

    # --- B) ast 재직렬화 ---
    reser = json.dumps(ast, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    b_exact = reser == raw
    b_semantic = json.loads(reser) == ast

    # --- C) preserve: ZIP 엔트리 보존 ---
    results.append(dict(fid=fid, orig_topics=orig_topics, naive_topics=n_topics,
                        lost_topics=orig_topics - n_topics,
                        lost_fields=sorted(lost_fields), lost_sheetkeys=sorted(lost_sheetkeys),
                        rel=sum(len(sh.get("relationships") or []) for sh in ast),
                        b_exact=b_exact, b_semantic=b_semantic,
                        raw_len=len(raw), reser_len=len(reser)))

print("=" * 100)
print("전략 A) naive 파서 (기존 OSS 방식) — 무엇을 잃는가")
print("=" * 100)
print(f"{'파일':<5} {'원본토픽':>8} {'복원토픽':>8} {'유실':>6} {'관계선유실':>10}  유실된 토픽 필드")
print("-" * 100)
for r in results:
    print(f"{r['fid']:<5} {r['orig_topics']:>8} {r['naive_topics']:>8} {r['lost_topics']:>6} "
          f"{r['rel']:>10}  {', '.join(r['lost_fields']) or '-'}")
print()
print("  + 유실된 시트 레벨 키:", ", ".join(sorted(set().union(*[set(r['lost_sheetkeys']) for r in results]))))

print()
print("=" * 100)
print("전략 B) AST 재직렬화 — 바이트 동등 / 의미 동등")
print("=" * 100)
print(f"{'파일':<5} {'원본bytes':>10} {'재직렬화':>10} {'바이트동등':>10} {'의미동등':>9}")
print("-" * 100)
for r in results:
    print(f"{r['fid']:<5} {r['raw_len']:>10} {r['reser_len']:>10} "
          f"{'PASS' if r['b_exact'] else 'FAIL':>10} {'PASS' if r['b_semantic'] else 'FAIL':>9}")

# --- 전략 C 실전: 실제 .xmind 를 열고 아무것도 안 하고 다시 쓴다 ---
print()
print("=" * 100)
print("전략 C) preserve-and-patch — 실제 .xmind 무편집 왕복")
print("=" * 100)
UP = sys.argv[2] if len(sys.argv) > 2 else CORPUS  # 원본 .xmind 가 있는 폴더
print(f"{'파일':<44} {'엔트리':>7} {'엔트리보존':>10} {'content동등':>11} {'전체동등':>9}")
print("-" * 100)
allpass = True
for src in sorted(glob.glob(UP + "/*.xmind")):
    zin = zipfile.ZipFile(src)
    entries = {i.filename: zin.read(i.filename) for i in zin.infolist()}
    order = [i.filename for i in zin.infolist()]

    # 열기 → ViewModel 투영 → (편집 없음) → 저장
    ast = json.loads(entries["content.json"])
    patched = json.dumps(ast, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    newentries = dict(entries)
    newentries["content.json"] = patched

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in order:
            zout.writestr(name, newentries[name])
    buf.seek(0)
    zback = zipfile.ZipFile(buf)
    back = {i.filename: zback.read(i.filename) for i in zback.infolist()}

    same_entries = set(back) == set(entries)
    same_content = json.loads(back["content.json"]) == json.loads(entries["content.json"])
    same_all = all(back[k] == entries[k] for k in entries if k != "content.json") and same_content
    allpass &= (same_entries and same_content and same_all)
    print(f"{os.path.basename(src)[:43]:<44} {len(entries):>7} "
          f"{'PASS' if same_entries else 'FAIL':>10} {'PASS' if same_content else 'FAIL':>11} "
          f"{'PASS' if same_all else 'FAIL':>9}")

print()
print("게이트 결과:", "✅ 통과 — 무편집 왕복 무손실" if allpass else "❌ 실패")
