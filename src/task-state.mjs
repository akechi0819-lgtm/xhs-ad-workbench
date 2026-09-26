import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { archiveTaskRevision, updateArchivedApproval } from "./output-archive.mjs";
import { validateProductionSheet } from "../content/validate-production-sheet.mjs";

// Derived from the MIT-licensed agent-xiaohongshu-workbench state and editor
// mechanics at commit 6e58278984cb891524ead60c9a5f116b6561b4cc. Account,
// hotspot, storyline, publishing, and renderer state were intentionally removed.

export const TASK_STAGES = Object.freeze([
  "brief",
  "references_pending_review",
  "references_confirmed",
  "production_sheet_ready",
  "final_images_received",
  "copy_calibrated",
  "awaiting_approval",
  "approved",
]);

const stageIndex = new Map(TASK_STAGES.map((stage, index) => [stage, index]));

function now() {
  return new Date().toISOString();
}

function requiredText(value, label, maxLength = 10000) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label}不能为空`);
  if (result.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
  return result;
}

function safeTaskId(value) {
  const taskId = requiredText(value, "taskId", 120);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(taskId) || taskId === "." || taskId === "..") {
    throw new Error("taskId 只能包含字母、数字、点、下划线和连字符");
  }
  return taskId;
}

function taskPath(root, taskId) {
  return path.join(root, "runs", "tasks", safeTaskId(taskId), "task.json");
}

function touch(state) {
  state.updatedAt = now();
  return state;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertStage(state, expected, action) {
  if (state?.stage !== expected) {
    throw new Error(`${action}要求任务处于 ${expected} 阶段，当前为 ${state?.stage || "未知"}`);
  }
}

function assertReferenceIdsKnown(state, ids, label = "参考文献") {
  if (!Array.isArray(ids)) throw new Error(`${label}必须是 ID 数组`);
  const known = new Set((state.references?.candidates || []).map((reference) => reference.id));
  const seen = new Set();
  for (const rawId of ids) {
    const id = requiredText(rawId, `${label} ID`, 300);
    if (seen.has(id)) throw new Error(`${label} ID 重复：${id}`);
    if (!known.has(id)) throw new Error(`${label}包含未展示的 ID：${id}`);
    seen.add(id);
  }
  return [...seen];
}

function collectCitedReferenceIds(value, key = "", found = []) {
  if (Array.isArray(value)) {
    if (/^(references|citations)$/i.test(key)) {
      for (const item of value) {
        if (typeof item === "string") found.push(item);
        else if (item && typeof item === "object" && item.id != null) found.push(String(item.id));
      }
    }
    for (const item of value) collectCitedReferenceIds(item, key, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [childKey, childValue] of Object.entries(value)) {
    if (/^(approvedReferenceIds|referenceIds|sourceReferenceIds|citationIds|selectedSourceIds|sourceIds)$/i.test(childKey)) {
      const values = Array.isArray(childValue) ? childValue : [childValue];
      for (const id of values) if (id != null && String(id).trim()) found.push(String(id));
    }
    collectCitedReferenceIds(childValue, childKey, found);
  }
  return found;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("参考文献候选必须是对象");
  }
  const id = requiredText(candidate.id ?? candidate.documentId ?? candidate.document_id, "参考文献 ID", 300);
  const title = requiredText(candidate.title ?? candidate.name, `参考文献 ${id} 标题`, 500);
  const sourceKind = String(candidate.sourceKind ?? candidate.source_kind ?? candidate.source ?? "unknown").trim() || "unknown";
  const summary = String(candidate.summary ?? candidate.excerpt ?? candidate.description ?? "").trim();
  const previewUrl = String(candidate.previewUrl ?? candidate.preview_url ?? candidate.previewImageUrl ?? candidate.preview_image_url ?? candidate.previews?.[0]?.preview_url ?? "").trim();
  const fileUrl = String(candidate.zipUrl ?? candidate.zip_url ?? candidate.fileUrl ?? candidate.file_url ?? candidate.downloadUrl ?? "").trim();
  const proposedUse = String(candidate.proposedUse ?? candidate.proposed_use ?? "").trim();
  const factCaveat = String(candidate.factCaveat ?? candidate.fact_caveat ?? candidate.caveat ?? "").trim();
  const isTeedy = /teedy/i.test(sourceKind);
  const evidenceWarnings = [];
  if (!summary) evidenceWarnings.push("缺少摘要或正文摘录，需人工打开原文核对");
  if (!previewUrl) evidenceWarnings.push(isTeedy ? "Teedy 预览图链接缺失" : "预览图链接缺失");
  if (!fileUrl) evidenceWarnings.push(isTeedy ? "Teedy 文件/zip 链接缺失" : "文件下载链接缺失");
  if (!proposedUse) evidenceWarnings.push("尚未说明这份资料拟用于哪一页或哪项事实");
  if (!factCaveat) evidenceWarnings.push("尚未记录事实边界或待核对事项");
  return {
    ...cloneJson(candidate),
    id,
    title,
    sourceKind,
    summary,
    previewUrl: previewUrl || null,
    fileUrl: fileUrl || null,
    proposedUse,
    factCaveat,
    evidenceAvailability: {
      summary: Boolean(summary),
      preview: Boolean(previewUrl),
      file: Boolean(fileUrl),
    },
    evidenceWarnings,
  };
}

export function createTaskState({ taskId = crypto.randomUUID(), threadId, brief = null } = {}) {
  const id = safeTaskId(taskId);
  const thread = requiredText(threadId, "threadId", 500);
  const timestamp = now();
  const state = {
    schemaVersion: 1,
    taskId: id,
    threadId: thread,
    stage: "brief",
    createdAt: timestamp,
    updatedAt: timestamp,
    brief: null,
    references: {
      candidates: [],
      selectedIds: [],
      rejectedIds: [],
      confirmed: false,
      reviewedAt: null,
    },
    productionSheet: null,
    finalImages: {
      items: [],
      order: [],
      orderConfirmed: false,
      receivedAt: null,
    },
    finalCopy: null,
    approval: {
      status: "not_requested",
      requestedAt: null,
      approvedAt: null,
      approvedBy: null,
      note: null,
    },
    archive: null,
  };
  if (brief) setTaskBrief(state, brief);
  return state;
}

export function setTaskBrief(state, brief) {
  assertStage(state, "brief", "填写制作需求");
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) throw new Error("制作需求必须是对象");
  state.brief = {
    ...cloneJson(brief),
    topic: requiredText(brief.topic, "选题", 1000),
    audience: requiredText(brief.audience, "受众", 1000),
    requirements: requiredText(Array.isArray(brief.requirements) ? brief.requirements.join("\n") : brief.requirements, "制作要求", 6000),
  };
  touch(state);
  return state;
}

export function presentReferencesForReview(state, candidates) {
  assertStage(state, "brief", "展示参考资料");
  if (!state.brief) throw new Error("请先填写选题、受众和制作要求");
  if (!Array.isArray(candidates)) throw new Error("参考资料候选必须是数组");
  const normalized = candidates.map(normalizeCandidate);
  const ids = new Set();
  for (const candidate of normalized) {
    if (ids.has(candidate.id)) throw new Error(`参考文献 ID 重复：${candidate.id}`);
    ids.add(candidate.id);
  }
  state.references = {
    candidates: normalized,
    selectedIds: [],
    rejectedIds: [],
    confirmed: false,
    reviewedAt: null,
  };
  state.stage = "references_pending_review";
  touch(state);
  return state;
}

export function confirmReferenceSelection(state, selectedIds) {
  assertStage(state, "references_pending_review", "确认参考资料");
  if (!Array.isArray(selectedIds)) throw new Error("请提交人工选择的参考资料 ID 数组；无资料需要时提交空数组");
  const selected = assertReferenceIdsKnown(state, selectedIds);
  const selectedSet = new Set(selected);
  const candidateIds = state.references.candidates.map((reference) => reference.id);
  state.references = {
    ...state.references,
    selectedIds: selected,
    rejectedIds: candidateIds.filter((id) => !selectedSet.has(id)),
    confirmed: true,
    reviewedAt: now(),
  };
  state.stage = "references_confirmed";
  touch(state);
  return state;
}

export function createProductionSheet(state, sheet) {
  if (!state.references?.confirmed) throw new Error("参考资料尚未完成人工核对");
  if (!["references_confirmed", "production_sheet_ready"].includes(state.stage)) {
    throw new Error(`制作单只能在参考确认后、接收成品图前生成或修改；当前为 ${state.stage}`);
  }
  if (!Array.isArray(state.references.selectedIds)) {
    throw new Error("参考资料尚未完成明确的人工核对");
  }
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) throw new Error("制作单必须是对象");
  if (!Array.isArray(sheet.pages) || sheet.pages.length < 3 || sheet.pages.length > 5) {
    throw new Error("制作单必须包含 3 到 5 页");
  }
  if (sheet.pages.some((page) => !page || typeof page !== "object" || Array.isArray(page))) {
    throw new Error("制作单每一页都必须是对象");
  }
  const selected = new Set(state.references.selectedIds);
  const cited = collectCitedReferenceIds(sheet);
  for (const id of cited) {
    if (!selected.has(id)) {
      const rejected = state.references.rejectedIds.includes(id);
      throw new Error(rejected ? `制作单引用了人工排除的参考资料：${id}` : `制作单引用了未获人工确认的参考资料：${id}`);
    }
  }
  const validation = validateProductionSheet(sheet, state.references);
  if (!validation.valid) throw new Error(`制作单未通过校验：${validation.errors.join("；")}`);
  const usedIds = new Set(sheet.selectedSourceIds);
  const selectedReferences = state.references.candidates.filter((reference) => usedIds.has(reference.id));
  state.productionSheet = {
    ...cloneJson(sheet),
    pages: cloneJson(sheet.pages),
    approvedReferenceIds: [...sheet.selectedSourceIds],
    approvedReferences: cloneJson(selectedReferences),
    createdAt: now(),
  };
  state.stage = "production_sheet_ready";
  touch(state);
  return state;
}

function normalizeFinalImage(image) {
  const record = typeof image === "string" ? { sourcePath: image } : image;
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("成品图必须是路径或对象");
  const sourcePath = requiredText(record.sourcePath ?? record.path ?? record.filePath ?? record.absolutePath, "成品图路径", 4000);
  const imageId = requiredText(record.id ?? crypto.randomUUID(), "成品图 ID", 300);
  const originalName = path.basename(String(record.originalName ?? record.fileName ?? sourcePath));
  return { id: imageId, sourcePath, originalName: originalName || null, alt: String(record.alt ?? "").trim() };
}

export function recordFinalImages(state, images, { orderConfirmed = false } = {}) {
  if (!["production_sheet_ready", "approved"].includes(state.stage)) {
    throw new Error(`接收成品图要求制作单已就绪，或对已批准任务开启新交付版本；当前为 ${state.stage}`);
  }
  if (!Array.isArray(images) || images.length === 0) throw new Error("至少需要一张用户选定的最终成品图");
  const items = images.map(normalizeFinalImage);
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("成品图 ID 不能重复");
  state.finalImages = {
    items,
    order: orderConfirmed ? ids : [],
    orderConfirmed: Boolean(orderConfirmed),
    receivedAt: now(),
  };
  state.finalCopy = null;
  state.approval = { status: "not_requested", requestedAt: null, approvedAt: null, approvedBy: null, note: null };
  state.archive = null;
  state.stage = "final_images_received";
  touch(state);
  return state;
}

export function confirmFinalImageOrder(state, orderedImageIds) {
  assertStage(state, "final_images_received", "确认成品图顺序");
  if (!Array.isArray(orderedImageIds)) throw new Error("成品图顺序必须用图片 ID 数组提交");
  const submitted = orderedImageIds.map((id) => requiredText(id, "成品图 ID", 300));
  const known = state.finalImages.items.map((item) => item.id);
  if (submitted.length !== known.length || new Set(submitted).size !== submitted.length || known.some((id) => !submitted.includes(id))) {
    throw new Error("顺序必须恰好包含每张成品图一次；可按图片 ID 确认，无需按文件名编号");
  }
  state.finalImages.order = submitted;
  state.finalImages.orderConfirmed = true;
  state.finalImages.orderConfirmedAt = now();
  touch(state);
  return state;
}

export function calibrateCopy(state, copy) {
  assertStage(state, "final_images_received", "校准终稿文案");
  if (!state.finalImages.orderConfirmed) throw new Error("请先确认最终图片与制作页的对应顺序；顺序不清时应先询问人工");
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) throw new Error("终稿文案必须是对象");
  if (!Array.isArray(copy.tags)) throw new Error("终稿标签必须是数组");
  const tags = [...new Set(copy.tags.map((tag) => String(tag ?? "").trim().replace(/^#/, "")).filter(Boolean))];
  state.finalCopy = {
    ...cloneJson(copy),
    title: requiredText(copy.title, "标题", 300),
    body: requiredText(copy.body, "正文", 20000),
    tags,
    calibratedAt: now(),
  };
  state.stage = "copy_calibrated";
  state.approval = { status: "not_requested", requestedAt: null, approvedAt: null, approvedBy: null, note: null };
  touch(state);
  return state;
}

export function requestApproval(state) {
  assertStage(state, "copy_calibrated", "提交人工确认");
  state.stage = "awaiting_approval";
  state.approval = {
    status: "awaiting_approval",
    requestedAt: now(),
    approvedAt: null,
    approvedBy: null,
    note: null,
  };
  touch(state);
  return state;
}

export function validateTaskState(state) {
  if (!state || typeof state !== "object") throw new Error("任务状态必须是对象");
  if (state.schemaVersion !== 1) throw new Error(`不支持的任务状态版本：${state.schemaVersion}`);
  safeTaskId(state.taskId);
  requiredText(state.threadId, "threadId", 500);
  if (!stageIndex.has(state.stage)) throw new Error(`未知任务阶段：${state.stage}`);
  if (state.stage !== "brief" && !state.brief) throw new Error("非 brief 阶段缺少制作需求");
  if (stageIndex.get(state.stage) >= stageIndex.get("references_confirmed") && !state.references?.confirmed) {
    throw new Error("制作阶段缺少已确认的参考资料选择");
  }
  if (state.references?.confirmed) {
    const candidateIds = new Set((state.references.candidates || []).map((reference) => reference.id));
    const reviewedIds = new Set([...(state.references.selectedIds || []), ...(state.references.rejectedIds || [])]);
    if (reviewedIds.size !== candidateIds.size || [...candidateIds].some((id) => !reviewedIds.has(id))) {
      throw new Error("参考资料核对必须明确覆盖全部候选，包括被排除项");
    }
    for (const id of state.references.selectedIds) if (!candidateIds.has(id)) throw new Error(`已选参考资料未出现在候选中：${id}`);
    for (const id of state.references.rejectedIds) if (!candidateIds.has(id)) throw new Error(`已排除参考资料未出现在候选中：${id}`);
  }
  if (stageIndex.get(state.stage) >= stageIndex.get("production_sheet_ready")) {
    if (!state.productionSheet || !Array.isArray(state.productionSheet.pages) || state.productionSheet.pages.length < 3 || state.productionSheet.pages.length > 5) {
      throw new Error("制作单必须包含 3 到 5 页");
    }
    const selected = new Set(state.references.selectedIds);
    if (state.productionSheet.approvedReferenceIds?.some((id) => !selected.has(id))) throw new Error("制作单含未获人工确认的参考资料");
    if (collectCitedReferenceIds(state.productionSheet).some((id) => !selected.has(id))) throw new Error("制作单引用了未获人工确认的参考资料");
  }
  if (stageIndex.get(state.stage) >= stageIndex.get("final_images_received")) {
    if (!Array.isArray(state.finalImages?.items) || state.finalImages.items.length === 0) {
      throw new Error("至少需要一张用户选定的最终成品图");
    }
    const imageIds = state.finalImages.items.map((image) => image.id);
    if (new Set(imageIds).size !== imageIds.length) throw new Error("成品图 ID 不能重复");
    if (state.finalImages.orderConfirmed) {
      const ordered = state.finalImages.order;
      if (!Array.isArray(ordered) || ordered.length !== imageIds.length || new Set(ordered).size !== ordered.length || imageIds.some((id) => !ordered.includes(id))) {
        throw new Error("已确认的成品图顺序必须包含每张成品图一次");
      }
    } else if (state.finalImages.order?.length) {
      throw new Error("未确认的成品图顺序不能作为已确定顺序保存");
    }
  }
  if (stageIndex.get(state.stage) >= stageIndex.get("copy_calibrated") && !state.finalImages?.orderConfirmed) {
    throw new Error("校准文案前必须确认成品图顺序");
  }
  if (stageIndex.get(state.stage) >= stageIndex.get("copy_calibrated") && !state.finalCopy) throw new Error("终稿文案尚未校准");
  if (stageIndex.get(state.stage) >= stageIndex.get("awaiting_approval") && state.approval?.status !== "awaiting_approval" && state.approval?.status !== "approved") {
    throw new Error("人工确认状态与任务阶段不一致");
  }
  if (state.stage === "approved" && (state.approval?.status !== "approved" || !state.approval.approvedAt || state.archive?.status !== "approved")) {
    throw new Error("approved 阶段缺少批准记录或同步归档状态");
  }
  return state;
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeTask({ root, state }) {
  validateTaskState(state);
  touch(state);
  await atomicWriteJson(taskPath(root, state.taskId), state);
  return state;
}

export async function readTask({ root, taskId }) {
  const filePath = taskPath(root, taskId);
  let state;
  try {
    state = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`任务不存在：${taskId}`);
    throw new Error(`无法读取任务 ${taskId}：${error.message}`);
  }
  validateTaskState(state);
  return state;
}

export async function readTaskByThread({ root, threadId }) {
  const wanted = requiredText(threadId, "threadId", 500);
  const directory = path.join(root, "runs", "tasks");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const state = await readTask({ root, taskId: entry.name });
      if (state.threadId === wanted) matches.push(state);
    } catch (error) {
      if (!String(error.message).startsWith("任务不存在：")) throw error;
    }
  }
  if (matches.length > 1) throw new Error(`threadId 对应多个任务，违反一线程一任务：${wanted}`);
  return matches[0] || null;
}

export async function createTask({ root, taskId = crypto.randomUUID(), threadId, brief = null } = {}) {
  const existing = await readTaskByThread({ root, threadId });
  if (existing) throw new Error(`此对话线程已有任务 ${existing.taskId}；请读取并续做现有任务`);
  const destination = taskPath(root, taskId);
  try {
    await fs.access(destination);
    throw new Error(`任务 ID 已存在：${taskId}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const state = createTaskState({ taskId, threadId, brief });
  await writeTask({ root, state });
  return state;
}

export async function updateTask({ root, taskId, update }) {
  if (typeof update !== "function") throw new Error("updateTask 需要同步更新函数");
  const state = await readTask({ root, taskId });
  const result = update(state);
  if (result && typeof result.then === "function") throw new Error("updateTask 更新函数必须同步完成");
  const next = result && typeof result === "object" ? result : state;
  return writeTask({ root, state: next });
}

export async function archiveTaskForApproval({ root, taskId }) {
  const state = await readTask({ root, taskId });
  const archive = await archiveTaskRevision({ root, task: state });
  state.archive = archive;
  await writeTask({ root, state });
  return state;
}

export async function approveTask({ root, taskId, approvedBy = "", note = "" }) {
  const state = await readTask({ root, taskId });
  assertStage(state, "awaiting_approval", "批准交付");
  if (!state.archive?.relativePath) throw new Error("请先生成 awaiting_approval 版本归档");
  const previous = cloneJson(state);
  state.stage = "approved";
  state.approval = {
    ...state.approval,
    status: "approved",
    approvedAt: now(),
    approvedBy: String(approvedBy ?? "").trim() || null,
    note: String(note ?? "").trim() || null,
  };
  touch(state);
  try {
    await updateArchivedApproval({ root, task: state, status: "approved" });
    validateTaskState(state);
    await atomicWriteJson(taskPath(root, state.taskId), state);
  } catch (error) {
    await updateArchivedApproval({ root, task: previous, status: "awaiting_approval" }).catch(() => {});
    throw error;
  }
  return state;
}
