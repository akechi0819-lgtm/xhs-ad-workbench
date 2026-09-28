#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "skills", "xhs-ad-workbench");
const clients = {
  codex: path.join(os.homedir(), ".agents", "skills", "xhs-ad-workbench"),
  workbuddy: path.join(os.homedir(), ".workbuddy", "skills", "xhs-ad-workbench"),
};
const args = process.argv.slice(2);
const client = args.find((arg) => arg === "codex" || arg === "workbuddy");
const dryRun = args.includes("--dry-run");

if (!client || args.some((arg) => ![client, "--dry-run"].includes(arg))) {
  process.stderr.write("用法: node scripts/install-skill.mjs codex|workbuddy [--dry-run]\n");
  process.exitCode = 2;
} else {
  const destination = clients[client];
  if (!fs.existsSync(path.join(source, "SKILL.md"))) throw new Error("缺少 SKILL.md");
  if (!dryRun) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: true });
  }
  process.stdout.write(`${dryRun ? "将安装" : "已安装"}: ${source} -> ${destination}\n请在 ${client === "codex" ? "Codex" : "WorkBuddy"} 新开一个任务加载技能。\n`);
}
