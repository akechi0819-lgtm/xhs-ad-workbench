"""Offline tests for candidate filtering and Teedy request counts."""
from __future__ import annotations

import importlib
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))


def _install_missing_dependency_stubs() -> None:
    """Allow offline unit tests to import the server without installing MCP extras."""
    if importlib.util.find_spec("httpx") is None:
        httpx = types.ModuleType("httpx")
        httpx.HTTPError = type("HTTPError", (Exception,), {})
        httpx.Client = object
        sys.modules["httpx"] = httpx

    if importlib.util.find_spec("mcp") is None:
        mcp = types.ModuleType("mcp")
        server_package = types.ModuleType("mcp.server")

        class FastMCP:
            def __init__(self, *args, **kwargs):
                pass

            def tool(self):
                return lambda function: function

            def run(self, *args, **kwargs):
                pass

        fastmcp = types.ModuleType("mcp.server.fastmcp")
        fastmcp.FastMCP = FastMCP
        sys.modules.update({
            "mcp": mcp,
            "mcp.server": server_package,
            "mcp.server.fastmcp": fastmcp,
        })


_install_missing_dependency_stubs()
server = importlib.import_module("mcp_server.server")


class FakeTeedyClient:
    base = "https://teedy.example"

    def __init__(self, documents: list[dict], files: dict[str, list[dict]], tags: list[str] | None = None):
        self.documents = documents
        self.files = files
        self.tags = tags or []
        self.calls: list[tuple] = []
        self.closed = False

    def list_tags(self):
        self.calls.append(("list_tags",))
        return [{"name": name} for name in self.tags]

    def search_documents(self, search: str, limit: int = 10):
        self.calls.append(("search_documents", search, limit))
        return {"documents": self.documents[:limit], "total": len(self.documents)}

    def list_files(self, document_id: str):
        self.calls.append(("list_files", document_id))
        return self.files.get(document_id, [])

    def close(self):
        self.closed = True


class MaterialSearchTest(unittest.TestCase):
    def make_document(self, document_id: str, title: str, tags: list[str], **extra) -> dict:
        return {
            "id": document_id,
            "title": title,
            "description": "留学经验",
            "tags": [{"name": name} for name in tags],
            "file_count": 2,
            **extra,
        }

    def test_hard_concepts_and_image_filter_exclude_video_even_with_cover(self):
        documents = [
            self.make_document("jp-high", "日本高中留学", ["日本", "高中", "留学"]),
            self.make_document("kr-adult", "韩国成人留学", ["韩国", "成人", "留学"]),
            self.make_document("jp-college", "日本大学留学", ["日本", "大学", "留学"]),
            self.make_document("jp-video", "日本高中留学视频", ["日本", "高中", "留学"]),
        ]
        files = {
            "jp-high": [{"id": "f1", "name": "page.jpg", "mimetype": "image/jpeg"}],
            "kr-adult": [{"id": "f2", "name": "cover.png", "mimetype": "image/png"}],
            "jp-college": [{"id": "f3", "name": "page.webp", "mimetype": "image/webp"}],
            # The image cover does not make this a graphic article.
            "jp-video": [
                {"id": "f4-cover", "name": "cover.jpg", "mimetype": "image/jpeg"},
                {"id": "f4-video", "name": "clip.mp4", "mimetype": "video/mp4"},
            ],
        }
        client = FakeTeedyClient(documents, files, tags=["留学"])

        with mock.patch.object(server, "_client", return_value=client):
            result = server.search_materials(
                tags=["留学"],
                query="留学经验",
                required_concepts=[["日本", "韩国"], ["高中生", "高中"]],
                limit=4,
            )

        self.assertEqual([item["id"] for item in result["items"]], ["jp-high"])
        self.assertEqual(result["media_filter"]["excluded_video"], 1)
        self.assertEqual(result["rejected_required_concepts"], 2)
        self.assertEqual(result["items"][0]["media_type"], "image")
        self.assertEqual(len(result["items"][0]["previews"]), 1)
        self.assertNotIn("files", result["items"][0])
        self.assertTrue(result["items"][0]["zip_url"].endswith("id=jp-high"))
        self.assertEqual(sum(call[0] == "list_tags" for call in client.calls), 1)
        self.assertEqual(sum(call[0] == "search_documents" for call in client.calls), 1)
        self.assertEqual(sum(call[0] == "list_files" for call in client.calls), 4)
        self.assertFalse(any(call[0] == "get_document" for call in client.calls))
        self.assertTrue(client.closed)

    def test_video_source_metadata_wins_over_image_cover(self):
        document = self.make_document(
            "video-source", "游学分享", ["留学"], source="小红书视频笔记"
        )
        client = FakeTeedyClient(
            [document],
            {"video-source": [{"id": "cover", "name": "cover.png", "mimetype": "image/png"}]},
        )

        with mock.patch.object(server, "_client", return_value=client):
            result = server.search_materials(query="留学", limit=3)

        self.assertEqual(result["items"], [])
        self.assertEqual(result["media_filter"]["excluded_video"], 1)
        self.assertEqual(sum(call[0] == "list_tags" for call in client.calls), 0)
        self.assertEqual(sum(call[0] == "search_documents" for call in client.calls), 1)
        self.assertEqual(sum(call[0] == "list_files" for call in client.calls), 1)

    def test_no_results_do_not_trigger_tag_or_keyword_fallback(self):
        client = FakeTeedyClient([], {}, tags=["日本", "留学"])

        with mock.patch.object(server, "_client", return_value=client):
            result = server.search_materials(tags=["日本"], query="高中留学")

        self.assertEqual(result["items"], [])
        searches = [call for call in client.calls if call[0] == "search_documents"]
        self.assertEqual(searches, [("search_documents", "tag:日本 高中留学", server.DEFAULT_LIMIT)])
        self.assertEqual(sum(call[0] == "list_tags" for call in client.calls), 1)

    def test_default_pool_returns_all_available_candidates_and_one_file_request_each(self):
        docs = [self.make_document(f"d{i}", f"资料{i}", []) for i in range(5)]
        files = {
            f"d{i}": [{"id": f"f{i}", "name": f"page{i}.jpg", "mimetype": "image/jpeg"}]
            for i in range(5)
        }
        client = FakeTeedyClient(docs, files)

        with mock.patch.object(server, "_client", return_value=client):
            result = server.search_materials(query="留学")

        self.assertEqual(result["total"], 5)
        search = next(call for call in client.calls if call[0] == "search_documents")
        self.assertEqual(search, ("search_documents", "留学", server.DEFAULT_LIMIT))
        self.assertEqual(result["search_limit"], server.DEFAULT_LIMIT)
        self.assertFalse(result["search_truncated"])
        self.assertEqual(sum(call[0] == "list_files" for call in client.calls), 5)
        self.assertTrue(all(len(item["previews"]) == 1 for item in result["items"]))
        self.assertTrue(all("files" not in item for item in result["items"]))

    def test_candidate_pool_limit_is_configurable_and_capped(self):
        docs = [self.make_document(f"d{i}", f"资料{i}", []) for i in range(25)]
        files = {
            f"d{i}": [{"id": f"f{i}", "name": f"page{i}.jpg", "mimetype": "image/jpeg"}]
            for i in range(25)
        }
        client = FakeTeedyClient(docs, files)

        with mock.patch.object(server, "_client", return_value=client):
            result = server.search_materials(query="留学", limit=100)

        search = next(call for call in client.calls if call[0] == "search_documents")
        self.assertEqual(search, ("search_documents", "留学", server.MAX_LIMIT))
        self.assertEqual(result["search_limit"], server.MAX_LIMIT)
        self.assertTrue(result["search_truncated"])
        self.assertEqual(result["total"], server.MAX_LIMIT)
        self.assertEqual(sum(call[0] == "list_files" for call in client.calls), server.MAX_LIMIT)


if __name__ == "__main__":
    unittest.main()
