#!/usr/bin/env python3
"""Statically extract WORDS_DB from a user-supplied local HTML file; never execute it."""
from __future__ import annotations

import argparse
import ast
import json
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "content" / "risk-lexicon.json"


def extract(html: str) -> list[dict[str, str | int]]:
    match = re.search(r"const\s+WORDS_DB\s*=\s*\[(.*?)^\];", html, re.M | re.S)
    if not match:
        raise ValueError("未找到完整 WORDS_DB 数组")
    rows = []
    for line_number, line in enumerate(match.group(1).splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        if not stripped.startswith("[") or not stripped.endswith(("],", "]")):
            raise ValueError(f"词库第 {line_number} 行格式无法静态解析")
        values = ast.literal_eval(stripped.removesuffix(","))
        if not isinstance(values, list) or len(values) != 6 or any(not isinstance(value, str) for value in values):
            raise ValueError(f"词库第 {line_number} 行不是六项文字记录")
        word, category, risk_level, suggestion, legal_ref, description = values
        if not word or risk_level not in {"high", "medium", "low"}:
            raise ValueError(f"词库第 {line_number} 行词项或风险等级无效")
        rows.append({
            "index": len(rows), "word": word, "category": category, "riskLevel": risk_level,
            "suggestion": suggestion, "legalRef": legal_ref, "description": description,
        })
    if not rows:
        raise ValueError("WORDS_DB 没有词项")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, help="用户本机 HTML 文件")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source = args.html.read_text(encoding="utf-8")
    rows = extract(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"source": args.html.name, "entries": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已静态提取 {len(rows)} 条词库记录到 {args.output}")


if __name__ == "__main__":
    main()
