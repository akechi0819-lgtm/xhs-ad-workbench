"""Read-only Teedy HTTP client. Write methods are blocked in this process."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

import httpx

from mcp_server.settings import credentials_file_path

REQUIRED_SETTINGS = (
    "MATERIAL_LIBRARY_TEEDY_BASE_URL",
    "MATERIAL_LIBRARY_TEEDY_USERNAME",
    "MATERIAL_LIBRARY_TEEDY_PASSWORD",
)


class TeedyError(RuntimeError):
    pass


def load_user_env(path: Path | None = None) -> dict[str, str]:
    """Load this employee's Teedy account settings from env or a private file."""
    env_path = path
    if env_path is None:
        configured_path = os.environ.get("MATERIAL_LIBRARY_TEEDY_CREDENTIALS_FILE")
        if configured_path:
            env_path = Path(configured_path).expanduser()
        elif credentials_file_path().is_file():
            env_path = credentials_file_path()

    out: dict[str, str] = {}
    if env_path:
        if not env_path.is_file():
            raise TeedyError(f"missing Teedy credentials file: {env_path}; run scripts/install_material_mcp.py")
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            if not raw.strip() or raw.lstrip().startswith("#") or "=" not in raw:
                continue
            key, value = raw.split("=", 1)
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            out[key.strip()] = value

    for key in REQUIRED_SETTINGS:
        if not out.get(key):
            value = os.environ.get(key)
            if value:
                out[key] = value
        if not out.get(key):
            raise TeedyError(f"missing {key}; run scripts/install_material_mcp.py")

    parsed = urlsplit(out["MATERIAL_LIBRARY_TEEDY_BASE_URL"])
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        raise TeedyError("MATERIAL_LIBRARY_TEEDY_BASE_URL must be the remote Teedy server's HTTPS URL")
    return out


class TeedyClient:
    def __init__(self, base: str, username: str, password: str, readonly: bool = True):
        self.base = base.rstrip("/")
        self.username = username
        self.password = password
        self.readonly = readonly
        self._logged_in = False
        self._http = httpx.Client(base_url=self.base, timeout=30.0, follow_redirects=True)

    def close(self) -> None:
        try:
            if self._logged_in:
                try:
                    self._http.post("/api/user/logout")
                except httpx.HTTPError:
                    pass
        finally:
            self._logged_in = False
            self._http.close()

    def login(self) -> None:
        response = self._http.post("/api/user/login", data={"username": self.username, "password": self.password})
        if response.status_code >= 400:
            raise TeedyError(f"login failed for {self.username}: HTTP {response.status_code} {response.text[:300]}")
        self._logged_in = True

    def _check(self, method: str, path: str) -> None:
        method = method.upper()
        if method == "POST" and path.rstrip("/") == "/api/user/login":
            return
        if method in {"GET", "HEAD"}:
            return
        if self.readonly:
            raise PermissionError(f"readonly Teedy client blocked {method} {path}")

    def json(self, method: str, path: str, form: dict[str, Any] | list[tuple[str, Any]] | None = None, params: dict[str, Any] | None = None) -> Any:
        self._check(method, path)
        kwargs: dict[str, Any] = {}
        if params:
            kwargs["params"] = params
        if form is not None:
            kwargs["data"] = form
        response = self._http.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise TeedyError(f"{method} {path} HTTP {response.status_code}: {response.text[:500]}")
        if not response.content:
            return {}
        try:
            return response.json()
        except json.JSONDecodeError as exc:
            raise TeedyError(f"{method} {path} returned non-JSON") from exc

    def get_bytes(self, path: str, params: dict[str, Any] | None = None) -> tuple[bytes, str, str | None]:
        self._check("GET", path)
        response = self._http.get(path, params=params)
        if response.status_code >= 400:
            raise TeedyError(f"GET {path} HTTP {response.status_code}: {response.text[:300]}")
        content_type = response.headers.get("content-type") or "application/octet-stream"
        filename = None
        disposition = response.headers.get("content-disposition") or ""
        if "filename=" in disposition:
            filename = disposition.split("filename=", 1)[1].strip().strip('"')
        return response.content, content_type, filename

    def whoami(self) -> dict[str, Any]:
        return self.json("GET", "/api/user")

    def list_tags(self) -> list[dict[str, Any]]:
        return self.json("GET", "/api/tag/list").get("tags") or []

    def search_documents(self, search: str, limit: int = 10) -> dict[str, Any]:
        return self.json("GET", "/api/document/list", params={"search": search, "limit": limit})

    def get_document(self, document_id: str) -> dict[str, Any]:
        return self.json("GET", f"/api/document/{document_id}")

    def list_files(self, document_id: str) -> list[dict[str, Any]]:
        return self.json("GET", "/api/file/list", params={"id": document_id}).get("files") or []


def user_client() -> TeedyClient:
    creds = load_user_env()
    client = TeedyClient(
        creds["MATERIAL_LIBRARY_TEEDY_BASE_URL"],
        creds["MATERIAL_LIBRARY_TEEDY_USERNAME"],
        creds["MATERIAL_LIBRARY_TEEDY_PASSWORD"],
        readonly=True,
    )
    try:
        client.login()
        return client
    except Exception:
        client.close()
        raise


def file_download_url(base: str, file_id: str) -> str:
    return f"{base.rstrip('/')}/api/file/{file_id}/data"


def file_preview_url(base: str, file_id: str, size: str = "web") -> str:
    return f"{base.rstrip('/')}/api/file/{file_id}/data?{urlencode({'size': size})}"


def zip_download_url(base: str, document_id: str) -> str:
    return f"{base.rstrip('/')}/api/file/zip?{urlencode({'id': document_id})}"


def encode_query(search: str, limit: int) -> str:
    return urlencode({"search": search, "limit": str(limit)})
