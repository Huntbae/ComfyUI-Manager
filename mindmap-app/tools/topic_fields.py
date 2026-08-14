#!/usr/bin/env python3
"""토픽 재귀를 정규화해서 Topic/Sheet 레벨 필드를 집계한다."""
import json, glob, os, sys
from collections import defaultdict

topic_fields = defaultdict(lambda: {"types": set(), "files": set(), "n": 0, "samples": []})
sheet_fields = defaultdict(lambda: {"types": set(), "files": set(), "n": 0, "samples": []})
struct_classes = defaultdict(set)
marker_ids = defaultdict(set)
style_props = defaultdict(set)
counters = defaultdict(lambda: defaultdict(int))


def tn(v):
    if v is None: return "null"
    if isinstance(v, bool): return "bool"
    if isinstance(v, int): return "int"
    if isinstance(v, float): return "float"
    if isinstance(v, str): return "string"
    if isinstance(v, list): return "array"
    if isinstance(v, dict): return "object"
    return "?"


def rec(reg, key, val, fid):
    e = reg[key]
    e["types"].add(tn(val)); e["files"].add(fid); e["n"] += 1
    if not isinstance(val, (dict, list)) and val is not None:
        s = repr(val)
        if len(s) > 45: s = s[:45] + "…"
        if s not in e["samples"] and len(e["samples"]) < 3:
            e["samples"].append(s)


def walk_topic(t, fid, kind="attached"):
    counters[fid]["topics"] += 1
    counters[fid]["topic_" + kind] += 1
    for k, v in t.items():
        rec(topic_fields, k, v, fid)
    if "structureClass" in t:
        struct_classes[t["structureClass"]].add(fid)
    for m in t.get("markers", []) or []:
        if isinstance(m, dict) and "markerId" in m:
            marker_ids[m["markerId"]].add(fid)
    st = t.get("style")
    if isinstance(st, dict):
        for p in (st.get("properties") or {}):
            style_props[p].add(fid)
    for key in ("boundaries", "summaries", "notes", "labels", "image", "href",
                "attributedTitle", "position", "customWidth", "numberFormat", "extensions"):
        if key in t:
            counters[fid][key] += 1
    ch = t.get("children") or {}
    for slot in ("attached", "detached", "summary", "callout"):
        for c in ch.get(slot, []) or []:
            walk_topic(c, fid, slot)


for fp in sorted(glob.glob(sys.argv[1] + "/f*/content.json")):
    fid = os.path.basename(os.path.dirname(fp))
    sheets = json.load(open(fp, encoding="utf-8"))
    counters[fid]["sheets"] = len(sheets)
    for sh in sheets:
        for k, v in sh.items():
            rec(sheet_fields, k, v, fid)
        counters[fid]["relationships"] += len(sh.get("relationships") or [])
        walk_topic(sh["rootTopic"], fid, "root")


def dump(title, reg):
    print(f"\n## {title}\n")
    print(f"{'필드':<20} {'타입':<16} {'파일':<5} {'출현':<6} 샘플")
    print("-" * 108)
    for k in sorted(reg, key=lambda x: (-len(reg[x]["files"]), x)):
        e = reg[k]
        print(f"{k:<20} {'|'.join(sorted(e['types'])):<16} {len(e['files']):<5} {e['n']:<6} {', '.join(e['samples'])[:46]}")


dump("Sheet 레벨 필드", sheet_fields)
dump("Topic 레벨 필드 (재귀 정규화)", topic_fields)

print("\n## structureClass 실측값\n")
for s in sorted(struct_classes):
    print(f"  {s:<45} ({len(struct_classes[s])}개 파일)")

print("\n## markerId 실측값\n")
print("  (없음)" if not marker_ids else "")
for m in sorted(marker_ids):
    print(f"  {m:<40} ({len(marker_ids[m])}개 파일)")

print("\n## style.properties 키 실측값\n")
for p in sorted(style_props):
    print(f"  {p:<36} ({len(style_props[p])}개 파일)")

print("\n## 파일별 통계\n")
keys = ["sheets", "topics", "topic_root", "topic_attached", "topic_detached", "topic_summary",
        "topic_callout", "relationships", "boundaries", "summaries", "notes", "labels",
        "image", "href", "attributedTitle", "position", "customWidth", "extensions"]
print(f"{'항목':<18}" + "".join(f"{f:>8}" for f in sorted(counters)))
print("-" * 62)
for k in keys:
    print(f"{k:<18}" + "".join(f"{counters[f].get(k,0):>8}" for f in sorted(counters)))
