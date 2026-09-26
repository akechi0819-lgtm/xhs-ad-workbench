#!/usr/bin/env python3
"""Verify one configured Teedy login and its ability to access the library."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import httpx

from mcp_server.teedy import TeedyError, user_client


def main() -> int:
    client = None
    try:
        client = user_client()
        identity = client.whoami()
        groups = identity.get("groups") or []
        base_functions = identity.get("base_functions") or []
        is_admin = "ADMIN" in base_functions
        can_read = is_admin or "READ" in base_functions or "readers" in groups
        if not can_read:
            raise TeedyError("account is valid but has no Teedy READ access; grant READ access or add it to the readers group")

        role = "admin" if is_admin else "reader"
        print(f"Teedy login=ok user={identity.get('username')} access={role}")
        return 0
    except (TeedyError, httpx.HTTPError, OSError) as exc:
        print(f"Teedy account verification failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    raise SystemExit(main())
