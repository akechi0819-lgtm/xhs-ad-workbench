import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/workbench.mjs");

function call(root, command, ...args) {
  return JSON.parse(execFileSync(process.execPath, [cli, command, "--root", root, ...args], { encoding: "utf8" }));
}

function jsonFile(root, name, value) {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(value), "utf8");
  return file;
}

test("命令行先展示候选和接受人工选择，然后才保存制作单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-cli-"));
  const brief = jsonFile(root, "brief.json", { topic: "历史课程", audience: "家长", requirements: "三页图文" });
  const first = call(root, "init", "--task", "example", "--thread", "thread-example", "--file", brief);
  assert.equal(first.stage, "brief");

  const candidates = jsonFile(root, "candidates.json", [
    { id: "keep", title: "资料甲", sourceKind: "teedy", summary: "结构参考", previewUrl: "https://example.test/preview", zipUrl: "https://example.test/zip", proposedUse: "封面结构", factCaveat: "现行信息待核" },
    { id: "drop", title: "资料乙", sourceKind: "teedy", summary: "旧信息", proposedUse: "信息节奏", factCaveat: "活动已过期" },
  ]);
  const pending = call(root, "candidates", "--task", "example", "--file", candidates);
  assert.equal(pending.stage, "references_pending_review");
  assert.equal(pending.references.candidates.length, 2);

  const selection = jsonFile(root, "selection.json", ["keep"]);
  assert.throws(() => call(root, "select", "--task", "example", "--file", selection), /人工确认/);
  const reviewed = call(root, "select", "--task", "example", "--file", selection, "--human-confirmed");
  assert.deepEqual(reviewed.references.rejectedIds, ["drop"]);

  const sheet = {
    referenceReviewStatus: "human-confirmed",
    selectedSourceIds: ["keep"],
    claims: [],
    title: "历史课程怎么选",
    body: "参考现行课程资料核对。",
    tags: ["历史学习"],
    pages: [1, 2, 3].map((n) => ({
      cardId: `card-${n}`,
      readerFacingCopy: { headline: `第 ${n} 页`, body: "示例文案" },
      visualPrompt: { promptText: "简洁信息图", textTreatment: "leave-space-for-manual-typesetting" },
      sourceIds: n === 1 ? ["keep"] : [],
    })),
    editorNotes: [],
  };
  const sheetFile = jsonFile(root, "sheet.json", sheet);
  const saved = call(root, "sheet", "--task", "example", "--file", sheetFile);
  assert.equal(saved.stage, "production_sheet_ready");
  assert.deepEqual(saved.productionSheet.approvedReferenceIds, ["keep"]);
  assert.equal(call(root, "show", "--thread", "thread-example").taskId, "example");

  const imagePath = path.join(root, "selected.png");
  fs.writeFileSync(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64"));
  const imagesFile = jsonFile(root, "images.json", [{ sourcePath: imagePath, originalName: "selected.png" }]);
  assert.equal(call(root, "images", "--task", "example", "--file", imagesFile, "--order-clear").stage, "final_images_received");
  const copyFile = jsonFile(root, "copy.json", { title: "最终图片对应标题", body: "已根据最终图片校准的正文。", tags: ["历史学习"] });
  assert.equal(call(root, "copy", "--task", "example", "--file", copyFile).stage, "copy_calibrated");
  const awaiting = call(root, "submit", "--task", "example");
  assert.equal(awaiting.archive.status, "awaiting_approval");
  const archiveDir = path.join(root, awaiting.archive.relativePath);
  assert.equal(fs.existsSync(path.join(archiveDir, "images", "selected.png")), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(archiveDir, "sources.json"), "utf8")).map((source) => source.id), ["keep"]);
  assert.throws(() => call(root, "approve", "--task", "example"), /人工确认/);
  assert.equal(call(root, "approve", "--task", "example", "--human-confirmed").stage, "approved");
  assert.equal(JSON.parse(fs.readFileSync(path.join(archiveDir, "manifest.json"), "utf8")).status, "approved");
});
