"""Offline packaging and install-location checks for the public MCP bundle."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
import contextlib
import io
from pathlib import Path
from unittest import mock

from mcp_server import settings
from scripts import install_material_mcp as installer


class MaterialMcpPackageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.home = Path(self.temp_dir.name)
        self.env_patch = mock.patch.dict(
            os.environ,
            {
                "HOME": str(self.home),
                "USERPROFILE": str(self.home),
                "APPDATA": str(self.home / "AppData" / "Roaming"),
                "LOCALAPPDATA": str(self.home / "AppData" / "Local"),
                "XDG_CONFIG_HOME": str(self.home / ".config"),
                "XDG_DATA_HOME": str(self.home / ".local" / "share"),
            },
        )
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.home_patch = mock.patch.object(Path, "home", return_value=self.home)
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_public_bundle_has_required_files_and_no_private_aliases(self) -> None:
        root = installer.ROOT
        required = (
            "mcp_server/server.py",
            "mcp_server/settings.py",
            "mcp_server/teedy.py",
            "mcp_server/vocab.py",
            "mcp_server/tag_aliases.json",
            "requirements-mcp.txt",
            "scripts/install_material_mcp.py",
            "scripts/verify_teedy_account.py",
            "skills/material-library/SKILL.md",
            "skills/material-library/agents/openai.yaml",
            "skills/xhs-ad-workbench/SKILL.md",
        )
        for relative in required:
            with self.subTest(relative=relative):
                self.assertTrue((root / relative).is_file(), relative)

        aliases = json.loads((root / "mcp_server/tag_aliases.json").read_text(encoding="utf-8"))
        self.assertEqual(aliases, {})

    def test_managed_install_uses_temporary_user_data_directory(self) -> None:
        destination = installer.copy_managed_install()
        self.assertEqual(destination, settings.installation_dir())
        self.assertTrue((destination / "mcp_server/server.py").is_file())
        self.assertTrue((destination / "mcp_server/tag_aliases.json").is_file())
        self.assertTrue((destination / "scripts/install_material_mcp.py").is_file())
        self.assertTrue((destination / "scripts/verify_teedy_account.py").is_file())
        self.assertTrue((destination / "skills/material-library/SKILL.md").is_file())
        self.assertFalse((destination / ".venv").exists())
        self.assertFalse((destination / "AGENTS.md").exists())
        self.assertFalse((destination / "runs").exists())
        self.assertEqual(
            json.loads((destination / "mcp_server/tag_aliases.json").read_text(encoding="utf-8")),
            {},
        )

    @unittest.skipUnless(shutil.which("node"), "Node.js is required to test workbench skill installation")
    def test_both_skills_coexist_in_isolated_client_skill_directories(self) -> None:
        root = installer.ROOT
        targets = {
            "codex": (self.home / ".agents" / "skills", installer.CODEX_SKILL_DESTINATION),
            "workbuddy": (self.home / ".workbuddy" / "skills", installer.WORKBUDDY_SKILL_DESTINATION),
        }
        for client, (skill_root, original_destination) in targets.items():
            workbench_skill = skill_root / "xhs-ad-workbench"
            subprocess.run(
                ["node", str(root / "scripts/install-skill.mjs"), client],
                check=True,
                env=dict(os.environ),
                capture_output=True,
                text=True,
            )
            self.assertTrue((workbench_skill / "SKILL.md").is_file())

            # The installed workbench skill is a sentinel: MCP installation must not replace it.
            marker = workbench_skill / "local-note.txt"
            marker.write_text("keep the workbench skill", encoding="utf-8")
            destination = skill_root / "material-library"
            with mock.patch.object(installer, "CODEX_SKILL_DESTINATION", self.home / ".agents" / "skills" / "material-library"), \
                 mock.patch.object(installer, "WORKBUDDY_SKILL_DESTINATION", self.home / ".workbuddy" / "skills" / "material-library"):
                self.assertEqual(installer.install_skill(client), destination)

            self.assertTrue((destination / "SKILL.md").is_file())
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep the workbench skill")
            self.assertNotEqual(destination, workbench_skill)
            self.assertNotEqual(destination, original_destination)

    def test_workbuddy_registration_writes_only_to_temporary_home(self) -> None:
        config_path = self.home / ".workbuddy" / "mcp.json"
        config_path.parent.mkdir(parents=True)
        config_path.write_text(
            json.dumps({"mcpServers": {"other-server": {"command": "other"}, "existing-library": {}}}),
            encoding="utf-8",
        )
        venv_python = self.home / ".local" / "share" / "material-library-mcp" / ".venv" / "bin" / "python"
        credentials_path = self.home / ".config" / "material-library-mcp" / "teedy.env"

        result = installer.register_workbuddy(venv_python, credentials_path)

        self.assertEqual(result, config_path)
        config = json.loads(config_path.read_text(encoding="utf-8"))
        self.assertIn("other-server", config["mcpServers"])
        self.assertIn("existing-library", config["mcpServers"])
        material = config["mcpServers"]["material-library"]
        self.assertEqual(material["command"], str(venv_python))
        self.assertEqual(material["args"], [str(installer.SERVER)])
        self.assertEqual(material["env"]["MATERIAL_LIBRARY_TEEDY_CREDENTIALS_FILE"], str(credentials_path))
        self.assertNotIn("PASSWORD", json.dumps(config))

    def test_codex_registration_passes_managed_paths_without_credentials(self) -> None:
        venv_python = self.home / "managed" / ".venv" / "bin" / "python"
        credentials_path = self.home / "private" / "teedy.env"
        with mock.patch.object(installer.shutil, "which", return_value="/fake/bin/codex"), \
             mock.patch.object(installer.subprocess, "run") as run:
            installer.register_codex(venv_python, credentials_path)

        calls = [call.args[0] for call in run.call_args_list]
        add_call = next(command for command in calls if command[1:3] == ["mcp", "add"])
        self.assertIn("material-library", add_call)
        self.assertIn(f"MATERIAL_LIBRARY_TEEDY_CREDENTIALS_FILE={credentials_path}", add_call)
        self.assertIn(str(venv_python), add_call)
        self.assertIn(str(installer.SERVER), add_call)
        self.assertNotIn("PASSWORD", " ".join(add_call))

    def test_noninteractive_installer_refuses_before_any_prompt_or_network_call(self) -> None:
        with mock.patch("sys.argv", ["install_material_mcp.py", "--client", "workbuddy"]), \
             mock.patch.object(installer.sys, "stdin", io.StringIO()), \
             mock.patch.object(installer.subprocess, "run") as run, \
             contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                installer.main()
        self.assertEqual(raised.exception.code, 2)
        run.assert_not_called()

    def test_credentials_file_requires_three_nonempty_lines_and_https_url(self) -> None:
        credentials_path = self.home / "teedy.txt"
        credentials_path.write_text(
            "\ufeffhttps://teedy.example/base\nreader\nsecret\n",
            encoding="utf-8",
        )
        self.assertEqual(
            installer.read_credentials_file(credentials_path),
            ("https://teedy.example/base", "reader", "secret"),
        )

        credentials_path.write_text(
            "https://teedy.example\nreader\n  secret with spaces  \n",
            encoding="utf-8",
        )
        self.assertEqual(
            installer.read_credentials_file(credentials_path),
            ("https://teedy.example", "reader", "  secret with spaces  "),
        )

        credentials_path.write_text("http://teedy.example\nreader\nsecret\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "HTTPS URL"):
            installer.read_credentials_file(credentials_path)

        credentials_path.write_text("https://teedy.example\n\nsecret\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "exactly three"):
            installer.read_credentials_file(credentials_path)

    def test_credentials_file_installs_without_tty_or_prompts(self) -> None:
        credentials_path = self.home / "teedy.txt"
        credentials_path.write_text(
            "https://teedy.example\nreader\nsecret-from-file\n",
            encoding="utf-8",
        )
        installed_credentials = self.home / ".config" / "material-library-mcp" / "teedy.env"
        argv = [
            "install_material_mcp.py",
            "--client",
            "workbuddy",
            "--credentials-file",
            str(credentials_path),
        ]
        with mock.patch("sys.argv", argv), \
             mock.patch.object(installer.sys, "stdin", io.StringIO()), \
             mock.patch.object(installer, "copy_managed_install", return_value=installer.ROOT), \
             mock.patch.object(installer, "prepare_runtime", return_value=self.home / "python"), \
             mock.patch.object(installer, "credentials_file_path", return_value=installed_credentials), \
             mock.patch.object(installer, "verify_credentials", return_value=True) as verify, \
             mock.patch.object(installer, "install_skill", return_value=self.home / "skill"), \
             mock.patch.object(installer, "register_workbuddy", return_value=self.home / "mcp.json"), \
             mock.patch("builtins.input", side_effect=AssertionError("unexpected prompt")), \
             mock.patch.object(installer.getpass, "getpass", side_effect=AssertionError("unexpected prompt")), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(installer.main(), 0)

        verify.assert_called_once_with(
            self.home / "python",
            installed_credentials.with_name("teedy.env.pending"),
        )
        self.assertIn(
            "MATERIAL_LIBRARY_TEEDY_PASSWORD=secret-from-file",
            installed_credentials.read_text(encoding="utf-8"),
        )

    def test_credentials_file_path_is_forwarded_to_managed_copy_as_absolute_path(self) -> None:
        credentials_path = self.home / "teedy.txt"
        credentials_path.write_text("https://teedy.example\nreader\nsecret\n", encoding="utf-8")
        managed_copy = self.home / "managed-install"
        with mock.patch("sys.argv", [
            "install_material_mcp.py", "--client", "workbuddy", "--credentials-file", str(credentials_path),
        ]), mock.patch.object(installer.sys, "stdin", io.StringIO()), \
             mock.patch.object(installer, "copy_managed_install", return_value=managed_copy), \
             mock.patch.object(installer.subprocess, "run", return_value=type("Result", (), {"returncode": 0})()) as run:
            self.assertEqual(installer.main(), 0)

        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--credentials-file") + 1], str(credentials_path.resolve()))

    def test_invalid_credentials_file_stops_before_install_work_without_echoing_content(self) -> None:
        credentials_path = self.home / "teedy.txt"
        credentials_path.write_text("http://teedy.example\nreader\nsecret-do-not-echo\n", encoding="utf-8")
        with mock.patch("sys.argv", [
            "install_material_mcp.py", "--client", "workbuddy", "--credentials-file", str(credentials_path),
        ]), mock.patch.object(installer.sys, "stdin", io.StringIO()), \
             mock.patch.object(installer, "copy_managed_install") as copy_install, \
             mock.patch.object(installer, "prepare_runtime") as prepare_runtime, \
             mock.patch.object(installer.subprocess, "run") as run, \
             contextlib.redirect_stderr(io.StringIO()) as stderr:
            with self.assertRaises(SystemExit) as raised:
                installer.main()

        self.assertEqual(raised.exception.code, 2)
        copy_install.assert_not_called()
        prepare_runtime.assert_not_called()
        run.assert_not_called()
        self.assertNotIn("secret-do-not-echo", stderr.getvalue())



if __name__ == "__main__":
    unittest.main()
