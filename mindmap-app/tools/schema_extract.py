#!/usr/bin/env python3
"""content.json 의 모든 JSON 경로와 타입을 집계해 실측 스키마를 뽑는다."""
import json, sys, glob, os
from collections import defaultdict

paths = defaultdict(lambda: {"types": set(), "files": set(), "count": 0, "samples": []})


def typename(v):
    if v is None: return "null"
    if isinstance(v, bool): return "bool"
    if isinstance(v, int): return "int"
    if isinstance(v, float): return "float"
    if isinstance(v, str): return "string"
    if isinstance(v, list): return "array"
    if isinstance(v, dict): return "object"
    return type(v).__name__


def walk(node, path, fid):
    e = paths[path]
    e["types"].add(typename(node))
    e["files"].add(fid)
    e["count"] += 1
    if not isinstance(node, (dict, list)) and node is not None:
        s = repr(node)
        if len(s) > 60: s = s[:60] + "…"
        if s not in e["samples"] and len(e["samples"]) < 4:
            e["samples"].append(s)
    if isinstance(node, dict):
        for k, v in node.items():
            walk(v, f"{path}.{k}" if path else k, fid)
    elif isinstance(node, list):
        for v in node:
            walk(v, f"{path}[]", fid)


files = sorted(glob.glob(sys.argv[1] + "/f*/content.json"))
for fp in files:
    fid = os.path.basename(os.path.dirname(fp))
    with open(fp, encoding="utf-8") as f:
        walk(json.load(f), "", fid)

print(f"# content.json 실측 스키마 ({len(files)}개 파일)\n")
print(f"{'경로':<62} {'타입':<18} {'파일수':<6} {'출현':<7} 샘플값")
print("-" * 140)
for p in sorted(paths):
    if p == "": continue
    e = paths[p]
    depth = p.count(".") + p.count("[]")
    if depth > 9: continue
    print(f"{p:<62} {'|'.join(sorted(e['types'])):<18} {len(e['files']):<6} {e['count']:<7} {', '.join(e['samples'])[:60]}")
