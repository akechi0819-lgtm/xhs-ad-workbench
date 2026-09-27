#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "AGENTS.md", "README.md", "LICENSE",
  "skills/xhs-ad-workbench/SKILL.md", "scripts/workbench.mjs",
  "skills/material-library/SKILL.md", "mcp_server/server.py",
  "mcp_server/settings.py", "mcp_server/teedy.py", "mcp_server/vocab.py",
  "mcp_server/tag_aliases.json", "requirements-mcp.txt",
  "content/risk-lexicon.json",
  "scripts/install_material_mcp.py", "scripts/verify_teedy_account.py",
  "content/schemas/deconstruct.schema.json", "content/schemas/draft.schema.json",
  "content/schemas/humanize.schema.json", "content/validate-production-sheet.mjs",
  "src/task-state.mjs", "src/output-archive.mjs",
];
const missing = required.filter((entry) => !fs.existsSync(path.join(root, entry)));
let publicAliasMapIsEmpty = false;
let bundledLexiconIsValid = false;
try {
  const aliases = JSON.parse(fs.readFileSync(path.join(root, "mcp_server/tag_aliases.json"), "utf8"));
  publicAliasMapIsEmpty = aliases && typeof aliases === "object" && !Array.isArray(aliases) && Object.keys(aliases).length === 0;
} catch {
  publicAliasMapIsEmpty = false;
}
try {
  const lexicon = JSON.parse(fs.readFileSync(path.join(root, "content/risk-lexicon.json"), "utf8"));
  bundledLexiconIsValid = Array.isArray(lexicon.entries) && lexicon.entries.length > 0 && lexicon.entries.every((entry) =>
    entry && typeof entry.word === "string" && entry.word && typeof entry.category === "string" &&
    ["low", "medium", "high"].includes(entry.riskLevel));
} catch {
  bundledLexiconIsValid = false;
}
if (missing.length) {
  process.stderr.write(`缺少项目文件：${missing.join(", ")}\n`);
  process.exitCode = 1;
} else if (!publicAliasMapIsEmpty) {
  process.stderr.write("公开分享包的 mcp_server/tag_aliases.json 必须是空映射。\n");
  process.exitCode = 1;
} else if (!bundledLexiconIsValid) {
  process.stderr.write("公开分享包的 content/risk-lexicon.json 缺失或格式无效。\n");
  process.exitCode = 1;
} else {
  process.stdout.write("工作台、素材库 MCP 与词库文件齐全，公开标签别名映射为空。此自检不连接 Teedy。\n");
}
