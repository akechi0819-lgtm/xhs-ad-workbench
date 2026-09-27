import assert from "node:assert/strict";
import test from "node:test";
import { renderCanvasSheet } from "./export-canvas-sheet.mjs";

test("单份精确文案自动拆为节点并合入风格、Logo 和最终生成指令", () => {
  const sheet = {
    title: "示例图文", brandRequirements: "深蓝主色，清楚易读",
    brandAssets: [{ name: "公司 Logo", path: "/brand/logo.png" }],
    canvasDefaults: { imageModel: "GPT Image 2", aspectRatio: "3:4", resolution: "2k", quality: "high", imageCount: 1 },
    pages: [{
      readerFacingCopy: { kicker: "家长指南", headline: "申请准备顺序", body: "先定目标，再核要求", callout: "逐校核对" },
      canvasPlan: {
        stylePrompt: "米白纸张与深蓝信息卡",
        layoutPrompt: "标题置顶，正文居中，强调语置底",
        logoAssetName: "公司 Logo", logoPlacement: "右上角",
        visualReference: { sourceId: "ref1", path: "/references/one.png", purpose: "借鉴信息层级" },
      },
    }],
  };
  const markdown = renderCanvasSheet(sheet);
  for (const [earlier, later] of [["p1-logo", "p1-title"], ["p1-title", "p1-copy"], ["p1-copy", "p1-reference"], ["p1-reference", "p1-style"], ["p1-style", "p1-final"]]) {
    assert.ok(markdown.indexOf(`节点 ${earlier}`) < markdown.indexOf(`节点 ${later}`));
  }
  assert.match(markdown, /\/brand\/logo.png/);
  assert.match(markdown, /\/references\/one.png/);
  assert.match(markdown, /主标题：申请准备顺序/);
  assert.match(markdown, /正文：先定目标，再核要求/);
  assert.match(markdown, /深蓝主色，清楚易读\n米白纸张与深蓝信息卡/);
  assert.match(markdown, /公司 Logo 图片放在右上角/);
  assert.match(markdown, /编辑提示词保持空白/);
  assert.equal((markdown.match(/主标题：申请准备顺序/g) || []).length, 1);
});
