#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCanvasSheet } from "../content/export-canvas-sheet.mjs";
import { readTask } from "../src/task-state.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? null : args[index + 1];
};
const taskId = option("task");
if (!taskId) {
  process.stderr.write("用法: node scripts/export-canvas-sheet.mjs --task 任务ID [--root 项目目录] [--output 文件路径]\n");
  process.exitCode = 2;
} else {
  try {
    const root = path.resolve(option("root") || path.dirname(fileURLToPath(import.meta.url)), option("root") ? "." : "..");
    const state = await readTask({ root, taskId });
    if (!state.productionSheet?.pages?.every((page) => page.canvasPlan)) throw new Error("任务尚无新版 Canvas 完整海报制作单");
    const markdown = renderCanvasSheet(state.productionSheet);
    const output = option("output");
    if (output) {
      await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
      await fs.writeFile(path.resolve(output), markdown, "utf8");
      process.stdout.write(`${path.resolve(output)}\n`);
    } else process.stdout.write(markdown);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
