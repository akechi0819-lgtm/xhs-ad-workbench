#!/usr/bin/env python3
"""Read-only MCP for the remote Teedy material library."""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path
from typing import Any, Literal

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
from mcp_server.vocab import resolve_tags

DOWNLOAD_DIR = ROOT / "runs" / "mcp_downloads"
MAX_LIMIT = 20
DEFAULT_LIMIT = 12
PREVIEW_LIMIT = 1

mcp = FastMCP(
    name="素材库MCP",
    log_level="WARNING",
    instructions=(
        "仅在小红书投放素材生产工作台中，需求已足够明确且确实需要历史素材参考时使用这些工具；不要求用户输入特殊触发词。"
        "其他项目或普通编程任务不要搜索素材。"
        "只有要用标签筛选时才先 list_tags；纯关键词检索无需额外列标签。标签只按用户明确范围传入，不从 query 自动推断。"
        "search_materials 默认只返回图文，硬条件通过 required_concepts 表达；每组内为同义说法/备选范围（命中一个即可），不同组都必须命中。"
        "不要为扩大结果静默删除标签、关键词或 required_concepts；无结果时说明未命中并交给用户决定是否放宽。"
        "默认检索 12 项作为候选池，limit 可按需调节，最多 20 项；这是检索池大小，不是给用户展示的固定数量。候选较少时全部返回；候选较多时由 Agent 根据相关性筛选展示。每个候选只给 1 张预览和受 Teedy ACL 保护的 zip 下载链接。不要在人工保留前调用 get_material 或 download_file。"
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


def _is_video(file: dict[str, Any]) -> bool:
    mime = (file.get("mimetype") or "").lower()
    name = (file.get("name") or "").lower()
    return mime.startswith("video/") or name.endswith((
        ".3gp", ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".mts", ".ts", ".webm",
    ))


def _metadata_media_type(doc: dict[str, Any]) -> str | None:
    """Read explicit video markers; an image cover never overrides a video marker."""
    explicit_fields = (
        doc.get("media_type"), doc.get("mediaType"), doc.get("content_type"),
        doc.get("contentType"), doc.get("source_type"), doc.get("sourceType"),
        doc.get("type"), doc.get("source"),
    )
    marker = " ".join(str(value) for value in explicit_fields if value).casefold()
    if any(token in marker for token in ("video/", "video", "视频", "短视频")):
        return "video"
    return None


def classify_media_type(doc: dict[str, Any], files: list[dict[str, Any]]) -> str:
    """Classify attachments conservatively, prioritizing video evidence over cover images."""
    explicit = _metadata_media_type(doc)
    if explicit == "video" or any(_is_video(file) for file in files):
        return "video"
    has_preview_image = any(_is_image(file) and file.get("id") for file in files)
    if has_preview_image:
        return "image"
    return "unknown"


def _matches_required_concepts(doc: dict[str, Any], files: list[dict[str, Any]], groups: list[list[str]]) -> bool:
    """Every concept group must match; alternatives within a group are ORed."""
    values: list[str] = []
    for field in ("title", "description", "source", "subject", "media_type", "mediaType", "content_type", "contentType"):
        value = doc.get(field)
        if value:
            values.append(str(value))
    for tag in doc.get("tags") or []:
        if isinstance(tag, dict) and tag.get("name"):
            values.append(str(tag["name"]))
        elif tag:
            values.append(str(tag))
    values.extend(str(file.get("name")) for file in files if file.get("name"))
    searchable = " ".join(values).casefold()
    return all(any(str(term).strip().casefold() in searchable for term in group) for group in groups)


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


def _summarize_doc(client: TeedyClient, doc: dict[str, Any], files: list[dict[str, Any]], reason: str, media_type: str) -> dict[str, Any]:
    tags = [t.get("name") for t in (doc.get("tags") or []) if t.get("name")]
    image = next((file for file in files if _is_image(file) and file.get("id")), None)
    previews = []
    if image:
        previews.append({
            "id": image["id"],
            "name": image.get("name"),
            "preview_url": file_preview_url(client.base, image["id"], "web"),
            "download_url": file_download_url(client.base, image["id"]),
        })
    return {
        "id": doc.get("id"),
        "title": doc.get("title"),
        "summary": doc.get("description") or "",
        "tags": tags,
        "file_count": doc.get("file_count"),
        "media_type": media_type,
        "zip_url": zip_download_url(client.base, doc["id"]) if doc.get("id") else None,
        "previews": previews,
        "match": reason,
        "highlight": _strip_highlight(doc.get("highlight")),
    }


def _canonical_tag_names(client: TeedyClient) -> list[str]:
    return [t["name"] for t in client.list_tags() if t.get("name")]


@mcp.tool()
def list_tags() -> dict[str, Any]:
    """仅在需要按正式标签筛选时列出仓库当前标签和别名；纯关键词检索无需先调用。"""
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
def search_materials(
    tags: list[str] | None = None,
    query: str | None = None,
    required_concepts: list[list[str]] | None = None,
    media_type: Literal["image", "video", "any"] = "image",
    limit: int = DEFAULT_LIMIT,
) -> dict[str, Any]:
    """搜索候选池。limit 默认 12、最多 20；每个 required_concepts 子列表是一个硬条件组，组内任一词命中即可、不同组都须命中。"""
    tags = [t for t in (tags or []) if str(t).strip()]
    query = (query or "").strip() or None
    groups = [[str(term).strip() for term in group if str(term).strip()] for group in (required_concepts or [])]
    if any(not group for group in groups):
        return {"error": "empty_required_concept_group", "message": "required_concepts 的每一组都要包含至少一个明确说法。"}
    if media_type not in {"image", "video", "any"}:
        return {"error": "invalid_media_type", "allowed": ["image", "video", "any"]}
    if not tags and not query:
        return {"error": "provide_tags_or_query", "message": "请传入 tags 或 query；使用 tags 前先 list_tags 获取实际标签名。"}
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))

    client = _client()
    try:
        canonical = _canonical_tag_names(client) if tags else []
        resolved, unknown = resolve_tags(tags, canonical) if tags else ([], [])
        if unknown:
            return {
                "error": "unknown_tags",
                "unknown": unknown,
                "resolved": resolved,
                "available": canonical,
                "message": "存在无法映射的标签。请改用 list_tags 中的 name 或 aliases。",
            }

        used_tags = list(resolved)
        terms: list[str] = []
        if used_tags:
            terms.extend(f"tag:{name}" for name in used_tags)
        if query:
            terms.append(query)
        search = " ".join(terms)
        payload = client.search_documents(search, limit=limit)
        docs = payload.get("documents") or []
        items: list[dict[str, Any]] = []
        excluded_video = 0
        excluded_other = 0
        rejected_concepts = 0
        for doc in docs:
            document_id = doc.get("id")
            files = client.list_files(document_id) if document_id else []
            detected_media_type = classify_media_type(doc, files)
            if media_type != "any" and detected_media_type != media_type:
                if detected_media_type == "video":
                    excluded_video += 1
                else:
                    excluded_other += 1
                continue
            if groups and not _matches_required_concepts(doc, files, groups):
                rejected_concepts += 1
                continue
            reason = "tag_and" if used_tags and query else "tag" if used_tags else "keyword"
            items.append(_summarize_doc(client, doc, files, reason, detected_media_type))

        return {
            "match": "tag_and" if used_tags and query else "tag" if used_tags else "keyword",
            "used_tags": used_tags,
            "keywords": query,
            "search": search,
            "media_filter": {
                "requested": media_type,
                "excluded_video": excluded_video,
                "excluded_unclassified": excluded_other,
            },
            "required_concepts": groups,
            "rejected_required_concepts": rejected_concepts,
            "teedy_total": payload.get("total"),
            "search_limit": limit,
            "search_truncated": int(payload.get("total") or 0) > limit,
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
