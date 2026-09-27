#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { parseCanvasSheet, loadCanvasImages, buildCanvasPageOps } from "../content/canvas-automation.mjs";
import { canvasAgentClient, loadCanvasAgentConfig, runCanvasSheet } from "../content/canvas-agent-runner.mjs";

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const sheetPath = value("--sheet");
if (!sheetPath) {
  process.stderr.write("用法：node scripts/run-canvas-sheet.mjs --sheet /路径/canvas-sheet.md [--page 1 | --from-page 2] [--plan] [--no-generate] [--wait-seconds 420]\n");
  process.exit(2);
}
try {
  const absoluteSheet = path.resolve(sheetPath);
  const sheet = parseCanvasSheet(await fs.readFile(absoluteSheet, "utf8"), absoluteSheet);
  const pageNumber = value("--page") ? Number(value("--page")) : null;
  const fromPage = value("--from-page") ? Number(value("--from-page")) : null;
  if (pageNumber && fromPage) throw new Error("--page 与 --from-page 只能使用一个");
  const pages = pageNumber ? sheet.pages.filter((page) => page.number === pageNumber) : fromPage ? sheet.pages.filter((page) => page.number >= fromPage) : sheet.pages;
  if (!pages.length) throw new Error(`制作单不存在指定页码：${pageNumber || fromPage}`);
  if (args.includes("--plan")) {
    for (const page of pages) {
      const images = await loadCanvasImages(page);
      const plan = buildCanvasPageOps(page, sheet.settings, images, { prefix: "preview" });
      process.stdout.write(`第 ${page.number} 页：${page.nodes.length} 个输入节点（${images.size} 张本地图片），${page.nodes.length} 条连线，尺寸 ${plan.ops.find((op) => op.id === plan.configId).metadata.size}\n`);
    }
  } else {
    const config = await loadCanvasAgentConfig(value("--agent-config") || undefined);
    const client = canvasAgentClient(config);
    const results = await runCanvasSheet(sheet, client, {
      pages,
      generate: !args.includes("--no-generate"),
      waitSeconds: Number(value("--wait-seconds") || 420),
      onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    });
    process.stdout.write(`${JSON.stringify({ complete: true, results })}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
