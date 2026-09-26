import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approveTask,
  archiveTaskForApproval,
  calibrateCopy,
  confirmFinalImageOrder,
  confirmReferenceSelection,
  createProductionSheet,
  createTask,
  presentReferencesForReview,
  readTask,
  recordFinalImages,
  requestApproval,
  setTaskBrief,
  writeTask,
} from "../src/task-state.mjs";

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xhs-task-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function pages(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    cardId: `card-${index + 1}`,
    readerFacingCopy: { headline: `第 ${index + 1} 页`, body: "示例正文" },
    visualPrompt: { promptText: "清楚呈现内容层级", textTreatment: "leave-space-for-manual-typesetting" },
    sourceIds: [],
  }));
}

function sheet({ pageCount = 3, selectedSourceIds = [] } = {}) {
  return {
    referenceReviewStatus: "human-confirmed",
    selectedSourceIds,
    claims: [],
    title: "示例制作单",
    body: "发布文案待成品回读后校准",
    tags: [],
    pages: pages(pageCount),
    editorNotes: [],
  };
}

function completeBrief() {
  return { topic: "城市里的老建筑", audience: "高中生", requirements: "准确、有出处，语气轻松" };
}

test("参考资料需逐项由人工裁定，拒绝项不能进入制作单，空选择也可明确确认", () => {
  const state = {
    schemaVersion: 1,
    taskId: "task-ref-check",
    threadId: "thread-ref-check",
    stage: "brief",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: null,
    references: { candidates: [], selectedIds: [], rejectedIds: [], confirmed: false, reviewedAt: null },
    productionSheet: null,
    finalImages: { items: [], order: [], orderConfirmed: false, receivedAt: null },
    finalCopy: null,
    approval: { status: "not_requested", requestedAt: null, approvedAt: null, approvedBy: null, note: null },
    archive: null,
  };
  setTaskBrief(state, completeBrief());
  presentReferencesForReview(state, [
    { id: "keep", title: "地方志摘录", source: "Teedy", zip_url: "https://files.example/keep.zip", previews: [{ preview_url: "https://files.example/keep.png" }], summary: "建筑沿革记录" },
    { id: "drop", title: "年代不明的网络转帖", source: "Teedy" },
  ]);
  assert.equal(state.stage, "references_pending_review");
  assert.equal(state.references.candidates[0].previewUrl, "https://files.example/keep.png");
  assert.deepEqual(state.references.candidates[1].evidenceAvailability, { summary: false, preview: false, file: false });
  assert.ok(state.references.candidates[1].evidenceWarnings.some((warning) => warning.includes("预览图")));
  assert.ok(state.references.candidates[1].evidenceWarnings.some((warning) => warning.includes("zip")));

  assert.throws(() => createProductionSheet(state, sheet()), /人工核对/);
  assert.throws(() => confirmReferenceSelection(state, ["not-shown"]), /未展示/);
  confirmReferenceSelection(state, ["keep"]);
  assert.deepEqual(state.references.selectedIds, ["keep"]);
  assert.deepEqual(state.references.rejectedIds, ["drop"]);
  assert.throws(() => createProductionSheet(state, { ...sheet(), citations: [{ id: "drop" }] }), /人工排除/);
  assert.throws(() => createProductionSheet(state, sheet({ selectedSourceIds: ["drop"] })), /人工排除/);
  assert.throws(() => createProductionSheet(state, { ...sheet(), claims: [{ sourceIds: ["drop"] }] }), /人工排除/);

  createProductionSheet(state, sheet({ selectedSourceIds: ["keep"] }));
  assert.deepEqual(state.productionSheet.approvedReferenceIds, ["keep"]);
  assert.deepEqual(state.productionSheet.approvedReferences.map((reference) => reference.id), ["keep"]);
  assert.equal(Object.hasOwn(state.productionSheet, "rejectedReferenceIds"), false);

  const emptySelection = structuredClone(state);
  emptySelection.stage = "references_pending_review";
  emptySelection.productionSheet = null;
  confirmReferenceSelection(emptySelection, []);
  createProductionSheet(emptySelection, sheet());
  assert.deepEqual(emptySelection.references.selectedIds, []);
  assert.deepEqual(emptySelection.references.rejectedIds, ["keep", "drop"]);
  assert.deepEqual(emptySelection.productionSheet.approvedReferenceIds, []);
});

test("制作单限定 3 到 5 页；最终成品图可少于制作页数，顺序通过图片 ID 确认", async (t) => {
  const root = await temporaryRoot(t);
  const state = await createTask({ root, taskId: "order-check", threadId: "conversation-1", brief: completeBrief() });
  presentReferencesForReview(state, []);
  confirmReferenceSelection(state, []);
  assert.throws(() => createProductionSheet(state, sheet({ pageCount: 2 })), /3 到 5 页/);
  createProductionSheet(state, sheet());

  const imageFiles = [];
  for (const [index, id] of ["alpha", "beta"].entries()) {
    const filePath = path.join(root, `selected artwork ${id}.png`);
    await fs.writeFile(filePath, `image-${index}`);
    imageFiles.push({ id, sourcePath: filePath, originalName: `selected artwork ${id}.png` });
  }
  recordFinalImages(state, imageFiles);
  assert.throws(() => calibrateCopy(state, { title: "title", body: "body", tags: ["history"] }), /先确认最终图片/);
  assert.throws(() => confirmFinalImageOrder(state, ["alpha"]), /每张成品图一次/);
  confirmFinalImageOrder(state, ["beta", "alpha"]);
  calibrateCopy(state, { title: "一座老建筑的故事", body: "从门楼开始，看看城市如何留下记忆。", tags: ["#城市史", "历史"] });
  assert.deepEqual(state.finalImages.order, ["beta", "alpha"]);
  assert.deepEqual(state.finalCopy.tags, ["城市史", "历史"]);
});

test("一线程一任务；awaiting_approval 归档与批准后的 manifest 状态一致", async (t) => {
  const root = await temporaryRoot(t);
  const state = await createTask({ root, taskId: "archive-check", threadId: "same-conversation", brief: completeBrief() });
  assert.equal(state.stage, "brief");
  await assert.rejects(
    createTask({ root, taskId: "duplicate", threadId: "same-conversation", brief: completeBrief() }),
    /已有任务 archive-check/,
  );
  await assert.rejects(
    createTask({ root, taskId: "archive-check", threadId: "different-conversation", brief: completeBrief() }),
    /任务 ID 已存在/,
  );

  presentReferencesForReview(state, [
    { id: "history-book-1", title: "城市志", summary: "地方城市沿革", previewUrl: "https://files.example/preview.png", zipUrl: "https://files.example/source.zip", proposedUse: "第 2 页年代核对", factCaveat: "建成年份仍需交叉核对", sourceKind: "teedy" },
    { id: "history-book-unused", title: "建筑图册", summary: "另一种排版", previewUrl: "https://files.example/unused.png", zipUrl: "https://files.example/unused.zip", proposedUse: "备用视觉方向", factCaveat: "不引用具体事实", sourceKind: "teedy" },
  ]);
  confirmReferenceSelection(state, ["history-book-1", "history-book-unused"]);
  createProductionSheet(state, sheet({ selectedSourceIds: ["history-book-1"] }));

  const imageFiles = [];
  for (const name of ["opening.webp", "ending.webp"]) {
    const filePath = path.join(root, name);
    await fs.writeFile(filePath, name);
    imageFiles.push({ sourcePath: filePath, originalName: name });
  }
  recordFinalImages(state, imageFiles, { orderConfirmed: true });
  calibrateCopy(state, { title: "老城门里的时间", body: "城门见证了城区的变迁。", tags: ["城市历史", "建筑】"] });
  requestApproval(state);
  await writeTask({ root, state });
  const archivedTask = await archiveTaskForApproval({ root, taskId: state.taskId });
  assert.equal(archivedTask.archive.status, "awaiting_approval");

  const revisionPath = path.join(root, ...archivedTask.archive.relativePath.split("/"));
  const awaitingManifest = JSON.parse(await fs.readFile(path.join(revisionPath, "manifest.json"), "utf8"));
  assert.equal(awaitingManifest.status, "awaiting_approval");
  assert.equal(awaitingManifest.approval.status, "awaiting_approval");
  assert.deepEqual(awaitingManifest.approvedReferenceIds, ["history-book-1"]);
  assert.equal(awaitingManifest.files.productionSheet, "production-sheet.json");
  assert.equal(awaitingManifest.files.sources, "sources.json");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(revisionPath, "sources.json"), "utf8")).map((source) => source.id), ["history-book-1"]);
  assert.equal(JSON.parse(await fs.readFile(path.join(revisionPath, "production-sheet.json"), "utf8")).pages.length, 3);
  assert.deepEqual(awaitingManifest.files.images.map((image) => path.basename(image.file)).sort(), ["ending.webp", "opening.webp"]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(revisionPath, "copy.json"), "utf8")).tags, ["城市历史", "建筑】"]);

  const approved = await approveTask({ root, taskId: state.taskId, approvedBy: "reviewer", note: "确认可交付" });
  assert.equal(approved.stage, "approved");
  assert.equal(approved.archive.status, "approved");
  const stored = await readTask({ root, taskId: state.taskId });
  assert.equal(stored.approval.status, "approved");
  assert.equal(stored.archive.status, "approved");
  const approvedManifest = JSON.parse(await fs.readFile(path.join(revisionPath, "manifest.json"), "utf8"));
  assert.equal(approvedManifest.status, "approved");
  assert.equal(approvedManifest.approval.status, "approved");
  assert.equal(approvedManifest.approval.approvedBy, "reviewer");

  const replacement = path.join(root, "replacement.webp");
  await fs.writeFile(replacement, "replacement image");
  recordFinalImages(approved, [{ id: "replacement", sourcePath: replacement }], { orderConfirmed: true });
  assert.equal(approved.stage, "final_images_received");
  assert.equal(approved.archive, null);
  calibrateCopy(approved, { title: "新图对应的新标题", body: "根据新图重新校准的正文。", tags: ["历史"] });
  requestApproval(approved);
  await writeTask({ root, state: approved });
  const revised = await archiveTaskForApproval({ root, taskId: approved.taskId });
  assert.equal(revised.archive.revision, "revision-002");
  assert.equal(JSON.parse(await fs.readFile(path.join(root, revised.archive.relativePath, "manifest.json"), "utf8")).status, "awaiting_approval");
});
