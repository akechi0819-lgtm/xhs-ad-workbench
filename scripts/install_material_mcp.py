#!/usr/bin/env python3
"""Install 素材库MCP locally with Teedy credentials entered in a hidden terminal prompt."""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from mcp_server.settings import credentials_file_path, installation_dir

MCP_ID = "material-library"
SKILL_SOURCE = ROOT / "skills" / "material-library"
CODEX_SKILL_DESTINATION = Path.home() / ".agents" / "skills" / MCP_ID
WORKBUDDY_SKILL_DESTINATION = Path.home() / ".workbuddy-ai" / "skills" / MCP_ID
SERVER = ROOT / "mcp_server" / "server.py"
VERIFY = ROOT / "scripts" / "verify_teedy_account.py"


def python_in_venv() -> Path:
    if os.name == "nt":
        return ROOT / ".venv" / "Scripts" / "python.exe"
    return ROOT / ".venv" / "bin" / "python"


def copy_managed_install() -> Path:
    destination = installation_dir()
    if ROOT.resolve() == destination.resolve():
        return ROOT

    destination.mkdir(parents=True, exist_ok=True)
    for directory in ("mcp_server", "skills/material-library"):
        shutil.copytree(
            ROOT / directory,
            destination / directory,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
        )
    for file_name in ("requirements-mcp.txt", "scripts/install_material_mcp.py", "scripts/verify_teedy_account.py"):
        target = destination / file_name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / file_name, target)
    return destination


def prepare_runtime() -> Path:
    venv_python = python_in_venv()
    if not venv_python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(ROOT / ".venv")], check=True)
    subprocess.run(
        [str(venv_python), "-m", "pip", "install", "-r", str(ROOT / "requirements-mcp.txt")],
        check=True,
    )
    return venv_python


def write_pending_credentials(base_url: str, username: str, password: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.parent.chmod(0o700)
    data = "\n".join([
        f"MATERIAL_LIBRARY_TEEDY_BASE_URL={base_url}",
        f"MATERIAL_LIBRARY_TEEDY_USERNAME={username}",
        f"MATERIAL_LIBRARY_TEEDY_PASSWORD={password}",
        "",
    ])
    file_descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(file_descriptor, "w", encoding="utf-8") as credentials_file:
        credentials_file.write(data)
    if os.name != "nt":
        path.chmod(0o600)


def verify_credentials(venv_python: Path, path: Path) -> bool:
    child_env = dict(os.environ)
    for name in (
        "MATERIAL_LIBRARY_TEEDY_BASE_URL",
        "MATERIAL_LIBRARY_TEEDY_USERNAME",
        "MATERIAL_LIBRARY_TEEDY_PASSWORD",
    ):
        child_env.pop(name, None)
    child_env["MATERIAL_LIBRARY_TEEDY_CREDENTIALS_FILE"] = str(path)
    result = subprocess.run([str(venv_python), str(VERIFY)], cwd=ROOT, env=child_env, check=False)
    return result.returncode == 0


def install_skill(client_mode: str) -> Path:
    destination = WORKBUDDY_SKILL_DESTINATION if client_mode == "workbuddy" else CODEX_SKILL_DESTINATION
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SKILL_SOURCE, destination, dirs_exist_ok=True)
    return destination


def register_codex(venv_python: Path, credentials_path: Path) -> None:
    codex = shutil.which("codex")
    if not codex:
        raise RuntimeError("Codex CLI was not found in this terminal environment")

    subprocess.run(
        [codex, "mcp", "remove", MCP_ID],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    subprocess.run(
        [
            codex,
            "mcp",
            "add",
            MCP_ID,
            "--env",
            f"MATERIAL_LIBRARY_TEEDY_CREDENTIALS_FILE={credentials_path}",
            "--",
            str(venv_python),
            str(SERVER),
        ],
        check=True,
    )
    subprocess.run([codex, "mcp", "list"], check=True)


def register_workbuddy(venv_python: Path, credentials_path: Path) -> Path:
    config_path = Path.home() / ".workbuddy-ai" / ".mcp.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"WorkBuddy MCP config is not valid JSON: {config_path}") from exc
    else:
        config = {}

    servers = config.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        raise RuntimeError(f"mcpServers must be a JSON object in {config_path}")
    servers[MCP_ID] = {
        "type": "stdio",
        "command": str(venv_python),
        "args": [str(SERVER)],
        "env": {"MATERIAL_LIBRARY_TEEDY_CREDENTIALS_FILE": str(credentials_path)},
        "description": "素材库MCP",
    }
    pending = config_path.with_name(f"{config_path.name}.pending")
    pending.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(pending, config_path)
    return config_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--client", choices=("codex", "workbuddy"), required=True)
    parser.add_argument("--installed-copy", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if not sys.stdin.isatty():
        parser.error("run this installer in an interactive terminal; the Teedy password is entered without echo")

    client_mode = args.client

    if not args.installed_copy:
        destination = copy_managed_install()
        if destination.resolve() != ROOT.resolve():
            result = subprocess.run(
                [sys.executable, str(destination / "scripts" / "install_material_mcp.py"), "--installed-copy", "--client", client_mode],
                check=False,
            )
            return result.returncode

    print("Installing 素材库MCP. Use your Teedy Reader or ADMIN account.")
    venv_python = prepare_runtime()
    base_url = input("Remote Teedy HTTPS URL: ").strip()
    username = input("Your Teedy username: ").strip()
    password = getpass.getpass("Your Teedy password (hidden): ")

    credentials_path = credentials_file_path()
    pending_path = credentials_path.with_name("teedy.env.pending")
    write_pending_credentials(base_url, username, password, pending_path)
    del password
    try:
        verified = verify_credentials(venv_python, pending_path)
    except BaseException:
        pending_path.unlink(missing_ok=True)
        raise
    if not verified:
        pending_path.unlink(missing_ok=True)
        print("Credentials were not installed. Confirm the HTTPS URL and Teedy account's READ access.", file=sys.stderr)
        return 1

    try:
        os.replace(pending_path, credentials_path)
    except OSError:
        pending_path.unlink(missing_ok=True)
        raise
    skill_path = install_skill(client_mode)
    if client_mode == "codex":
        register_codex(venv_python, credentials_path)
        print(f"Installed skill to {skill_path}. Start a new Codex task in the workbench project; its Agent can search when the request is clear.")
    elif client_mode == "workbuddy":
        config_path = register_workbuddy(venv_python, credentials_path)
        print(f"Registered 素材库MCP in {config_path}.")
        print("In WorkBuddy, open Experts · Skills · Connectors → Connectors → Custom Connector, trust and enable material-library, then start a new workbench task. The Agent can search when the request is clear.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
