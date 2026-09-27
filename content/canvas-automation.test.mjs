import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { renderCanvasSheet } from "./export-canvas-sheet.mjs";
import { buildCanvasPageOps, loadCanvasImages, parseCanvasSheet } from "./canvas-automation.mjs";
import { chooseCanvasModel, verifyCanvasPage } from "./canvas-agent-runner.mjs";

const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X+e0AAAAASUVORK5CYII=", "base64");

test("真实制作单导出格式可确定性转成 Logo、参考图、文字、配置和全部连线", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-canvas-"));
  try {
    const logo = path.join(root, "logo.png");
    const reference = path.join(root, "reference.png");
    await fs.writeFile(logo, tinyPng);
    await fs.writeFile(reference, tinyPng);
    const sheet = {
      title: "KET 内容测试", brandRequirements: "品牌要求", brandAssets: [{ name: "logo", path: logo }],
      canvasDefaults: { imageModel: "GPT Image 2", aspectRatio: "3:4", resolution: "2k", quality: "high", imageCount: 1 },
      pages: [{ readerFacingCopy: { kicker: "眉题", headline: "标题", body: "正文", callout: "提示" }, canvasPlan: {
        logoAssetName: "logo", logoPlacement: "顶部", visualReference: { path: reference, purpose: "借鉴版式" }, stylePrompt: "清晰明亮", layoutPrompt: "三段排布",
      } }],
    };
    const markdown = renderCanvasSheet(sheet);
    const parsed = parseCanvasSheet(markdown.replace(/\n/g, "\r\n"), path.join(root, "canvas-sheet.md"));
    const images = await loadCanvasImages(parsed.pages[0]);
    const plan = buildCanvasPageOps(parsed.pages[0], parsed.settings, images, { prefix: "task", model: "provider::gpt-image-2" });
    const added = plan.ops.filter((op) => op.type === "add_node");
    const edges = plan.ops.filter((op) => op.type === "connect_nodes");
    assert.equal(added.filter((op) => op.nodeType === "image").length, 2);
    assert.equal(added.filter((op) => op.nodeType === "text").length, 4);
    assert.equal(edges.length, 6);
    assert.ok(added.filter((op) => op.nodeType === "image").every((op) => op.metadata.content.startsWith("data:image/png;base64,")));
    assert.deepEqual(added.find((op) => op.id === plan.configId).metadata, { generationMode: "image", composerContent: "", prompt: "", status: "idle", model: "provider::gpt-image-2", size: "1536x2048", quality: "high", count: 1 });
    assert.ok(verifyCanvasPage({ nodes: added, connections: edges }, plan));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("只选当前已配置的同名画布模型，避免把制作单发给错误模型", () => {
  const config = { current: { model: "channel-3::gpt-image-2" }, models: [
    { value: "channel-3::gpt-image-2", label: "gpt-image-2（渠道 3）" },
    { value: "zzone::gpt-image-2", label: "gpt-image-2（ZZONE）" },
  ] };
  assert.equal(chooseCanvasModel(config, "GPT Image 2"), "channel-3::gpt-image-2");
  assert.throws(() => chooseCanvasModel({ ...config, current: { model: "other" } }, "GPT Image 2"), /多个画布模型匹配/);
});
