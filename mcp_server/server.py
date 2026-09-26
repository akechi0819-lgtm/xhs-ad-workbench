#!/usr/bin/env python3
"""Read-only MCP for the remote Teedy material library."""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mcp.server.fastmcp import FastMCP

from mcp_server.teedy import (
    TeedyClient,
    TeedyError,
    file_download_url,
    file_preview_url,
    load_user_env,
    user_client,
    zip_download_url,
)
from mcp_server.vocab import extract_tags_from_query, remaining_keywords, resolve_tags

DOWNLOAD_DIR = ROOT / "runs" / "mcp_downloads"
MAX_LIMIT = 20
DEFAULT_LIMIT = 8
PREVIEW_LIMIT = 3

mcp = FastMCP(
    name="素材库MCP",
    log_level="WARNING",
    instructions=(
        "仅当用户在本轮明确写下 $素材库MCP 时使用这些工具。"
        "普通编程、其他项目、随口提到小红书或考试都不要搜。"
        "先 list_tags，把口语映射到标签 name，再 search_materials。"
        "以当前已配置的 Teedy 账号访问；账号可以是 ADMIN 或具备 READ 的 Reader。MCP 工具只检索、预览和下载，不上传、改标签或删文档。"
        "当前标签是 v0。结果必须给出预览图 URL 和 zip/文件下载链接，不要只给仓库打开页。"
        "这些链接受 Teedy 登录和权限保护；打开链接的浏览器需要登录同一个 Teedy 服务器。"
    ),
)


def _client() -> TeedyClient:
    return user_client()


def _strip_highlight(raw: str | None) -> str | None:
    if not raw:
        return None
    text = re.sub(r"<[^>]+>", "", raw)
    text = html.unescape(text)
    text = " ".join(text.split())
    return text[:240] if text else None


def _is_image(file: dict[str, Any]) -> bool:
    mime = (file.get("mimetype") or "").lower()
    name = (file.get("name") or "").lower()
    return mime.startswith("image/") or name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))


def attach_media(client: TeedyClient, document_id: str, preview_limit: int = PREVIEW_LIMIT) -> dict[str, Any]:
    files = client.list_files(document_id)
    out_files = []
    previews = []
    for file in files:
        file_id = file.get("id")
        rec = {
            "id": file_id,
            "name": file.get("name"),
            "mimetype": file.get("mimetype"),
            "size": file.get("size"),
        }
        if file_id:
            rec["download_url"] = file_download_url(client.base, file_id)
            if _is_image(file) and len(previews) < preview_limit:
                previews.append({
                    "id": file_id,
                    "name": file.get("name"),
                    "preview_url": file_preview_url(client.base, file_id, "web"),
                    "download_url": rec["download_url"],
                })
        out_files.append(rec)
    return {
        "zip_url": zip_download_url(client.base, document_id),
        "previews": previews,
        "files": out_files,
    }


def _summarize_doc(client: TeedyClient, doc: dict[str, Any], reason: str) -> dict[str, Any]:
    tags = [t.get("name") for t in (doc.get("tags") or []) if t.get("name")]
    media = attach_media(client, doc["id"]) if doc.get("id") else {"zip_url": None, "previews": [], "files": []}
    return {
        "id": doc.get("id"),
        "title": doc.get("title"),
        "summary": doc.get("description") or "",
        "tags": tags,
        "file_count": doc.get("file_count"),
        "zip_url": media.get("zip_url"),
        "previews": media.get("previews") or [],
        "match": reason,
        "highlight": _strip_highlight(doc.get("highlight")),
    }


def _canonical_tag_names(client: TeedyClient) -> list[str]:
    return [t["name"] for t in client.list_tags() if t.get("name")]


@mcp.tool()
def list_tags() -> dict[str, Any]:
    """列出仓库当前标签和口语别名。检索前先调用，把用户说法映射到 name。"""
    from mcp_server.vocab import load_alias_map

    client = _client()
    try:
        tags = client.list_tags()
        alias_map = load_alias_map()
        items = []
        for tag in tags:
            name = tag.get("name")
            items.append({
                "name": name,
                "id": tag.get("id"),
                "aliases": alias_map.get(name, []),
            })
        return {
            "vocab_version": "v0",
            "note": "临时标签，未规范化。请使用 name 作为 search_materials 的 tags 参数。",
            "tags": items,
        }
    finally:
        client.close()


@mcp.tool()
def search_materials(tags: list[str] | None = None, query: str | None = None, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """按标签搜索素材，返回预览图和 zip 下载链接。tags 用 list_tags 的 name。"""
    tags = [t for t in (tags or []) if str(t).strip()]
    query = (query or "").strip() or None
    if not tags and not query:
        return {"error": "provide_tags_or_query", "message": "请先 list_tags，再传入 tags 或 query。"}
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))

    client = _client()
    try:
        canonical = _canonical_tag_names(client)
        resolved, unknown = resolve_tags(tags, canonical)
        inferred = []
        if query:
            inferred = [name for name in extract_tags_from_query(query, canonical) if name not in resolved]
        if unknown:
            return {
                "error": "unknown_tags",
                "unknown": unknown,
                "resolved": resolved,
                "available": canonical,
                "message": "存在无法映射的标签。请改用 list_tags 中的 name 或 aliases。",
            }

        used_tags = list(resolved)
        for name in inferred:
            if name not in used_tags:
                used_tags.append(name)

        empty_tags: list[str] = []
        usable_tags: list[str] = []
        for name in used_tags:
            tag_payload = client.search_documents(f"tag:{name}", limit=1)
            if tag_payload.get("documents") or int(tag_payload.get("total") or 0) > 0:
                usable_tags.append(name)
            else:
                empty_tags.append(name)
        used_tags = usable_tags
        leftover = remaining_keywords(query, used_tags, canonical) if query else ""

        def run(search: str, reason: str) -> list[dict[str, Any]]:
            payload = client.search_documents(search, limit=limit)
            return [_summarize_doc(client, doc, reason) for doc in payload.get("documents") or []]

        items: list[dict[str, Any]] = []
        match = "none"
        if used_tags:
            tags_query = " ".join(f"tag:{name}" for name in used_tags)
            and_query = tags_query
            if leftover:
                and_query = f"{and_query} {leftover}"
            items = run(and_query, "tag_and")
            match = "tag_and"
            if not items and leftover:
                items = run(tags_query, "tag_and")
        elif query:
            items = run(query, "keyword")
            match = "keyword"

        return {
            "match": match,
            "used_tags": used_tags,
            "inferred_tags": inferred,
            "empty_tags": empty_tags,
            "keywords": leftover or None,
            "total": len(items),
            "items": items,
        }
    except TeedyError as exc:
        return {"error": "teedy_error", "message": str(exc)}
    finally:
        client.close()


@mcp.tool()
def get_material(document_id: str) -> dict[str, Any]:
    """查看一份素材的摘要、预览图和下载链接。document_id 来自 search_materials。"""
    document_id = (document_id or "").strip()
    if not document_id:
        return {"error": "missing_document_id"}
    client = _client()
    try:
        doc = client.get_document(document_id)
        media = attach_media(client, document_id, preview_limit=12)
        return {
            "id": doc.get("id"),
            "title": doc.get("title"),
            "summary": doc.get("description") or "",
            "source": doc.get("source"),
            "folder": doc.get("subject"),
            "language": doc.get("language"),
            "tags": [t.get("name") for t in (doc.get("tags") or []) if t.get("name")],
            "writable": bool(doc.get("writable")),
            "zip_url": media.get("zip_url"),
            "previews": media.get("previews") or [],
            "files": media.get("files") or [],
        }
    except TeedyError as exc:
        return {"error": "teedy_error", "message": str(exc)}
    finally:
        client.close()


@mcp.tool()
def download_file(file_id: str, filename: str | None = None) -> dict[str, Any]:
    """用当前员工的 Teedy 账号把文件下载到本地 runs/mcp_downloads。"""
    file_id = (file_id or "").strip()
    if not file_id:
        return {"error": "missing_file_id"}
    client = _client()
    try:
        data, content_type, header_name = client.get_bytes(f"/api/file/{file_id}/data")
        name = (filename or header_name or file_id).replace("/", "_")
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        path = DOWNLOAD_DIR / f"{file_id}_{name}"
        path.write_bytes(data)
        return {
            "file_id": file_id,
            "path": str(path),
            "bytes": len(data),
            "content_type": content_type,
            "name": name,
        }
    except TeedyError as exc:
        return {"error": "teedy_error", "message": str(exc)}
    finally:
        client.close()


if __name__ == "__main__":
    try:
        load_user_env()
    except TeedyError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2) from exc
    mcp.run(transport="stdio")
