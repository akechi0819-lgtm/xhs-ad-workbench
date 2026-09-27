"""v0 tag aliases. Canonical names come from Teedy; this file only maps spoken variants."""
from __future__ import annotations

import json
from pathlib import Path

ALIAS_PATH = Path(__file__).resolve().parent / "tag_aliases.json"


def load_alias_map() -> dict[str, list[str]]:
    return json.loads(ALIAS_PATH.read_text(encoding="utf-8"))


def _fold(text: str) -> str:
    return text.strip().casefold()


def build_lookup(canonical_names: list[str], alias_map: dict[str, list[str]] | None = None) -> dict[str, str]:
    alias_map = alias_map or load_alias_map()
    lookup: dict[str, str] = {}
    names = {name: name for name in canonical_names}
    for name in canonical_names:
        lookup[_fold(name)] = name
    for canonical, aliases in alias_map.items():
        target = names.get(canonical)
        if target is None:
            continue
        lookup.setdefault(_fold(canonical), target)
        for alias in aliases:
            key = _fold(alias)
            if key:
                lookup.setdefault(key, target)
    return lookup


def resolve_tags(raw_tags: list[str], canonical_names: list[str]) -> tuple[list[str], list[str]]:
    lookup = build_lookup(canonical_names)
    resolved: list[str] = []
    unknown: list[str] = []
    seen: set[str] = set()
    for item in raw_tags:
        if not item or not str(item).strip():
            continue
        key = _fold(str(item))
        name = lookup.get(key)
        if name is None:
            unknown.append(str(item).strip())
            continue
        if name not in seen:
            seen.add(name)
            resolved.append(name)
    return resolved, unknown
