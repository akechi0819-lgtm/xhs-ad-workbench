import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Selective MIT-licensed adaptation of the upstream output archive at
// agent-xiaohongshu-workbench commit 6e58278984cb891524ead60c9a5f116b6561b4cc.
// The account-oriented index and publish status were replaced by task revisions
// whose manifest records human reference selection and approval state.

function safeTaskId(value) {
  const taskId = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(taskId) || taskId === "." || taskId === "..") {
    throw new Error("taskId 只能包含字母、数字、点、下划线和连字符");
  }
  return taskId;
}

function safeRevisionPath(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("归档路径超出项目目录");
  }
  return resolved;
}

function extensionFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ".png";
}

function archiveImageName(image, existingNames) {
  const original = path.basename(String(image.originalName || "")).trim();
  const extension = extensionFor(original || image.sourcePath);
  const base = original ? path.basename(original, path.extname(original)) : `image-${image.id.slice(0, 8)}`;
  let fileName = `${base}${extension}`;
  if (existingNames.has(fileName.toLowerCase())) fileName = `${base}-${image.id.slice(0, 8)}${extension}`;
  let suffix = 2;
  while (existingNames.has(fileName.toLowerCase())) {
    fileName = `${base}-${image.id.slice(0, 8)}-${suffix}${extension}`;
    suffix += 1;
  }
  existingNames.add(fileName.toLowerCase());
  return fileName;
}

async function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function nextRevisionNumber(taskOutputDirectory) {
  const entries = await fs.readdir(taskOutputDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const revisions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^revision-(\d{3,})$/.exec(entry.name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return Math.max(0, ...revisions) + 1;
}

function validateReadyTask(task) {
  if (!task || task.stage !== "awaiting_approval" || task.approval?.status !== "awaiting_approval") {
    throw new Error("只能归档已提交人工确认的任务");
  }
  if (!task.productionSheet?.pages?.length || !task.finalCopy || !task.finalImages?.orderConfirmed) {
    throw new Error("归档需要制作单、校准文案和已确认顺序的成品图");
  }
  if (!task.references?.confirmed) throw new Error("归档前必须完成人工参考资料核对");
}

export async function archiveTaskRevision({ root, task }) {
  validateReadyTask(task);
  const taskId = safeTaskId(task.taskId);
  const approvedReferenceIds = [...(task.productionSheet.approvedReferenceIds || [])];
  const selected = new Set(task.references.selectedIds || []);
  const used = new Set(approvedReferenceIds);
  const approvedReferences = (task.references.candidates || []).filter((reference) => used.has(reference.id));
  if (task.productionSheet.approvedReferenceIds?.some((id) => !selected.has(id))) {
    throw new Error("制作单包含未获人工确认的参考资料");
  }

  const taskOutputDirectory = path.join(root, "output", taskId);
  await fs.mkdir(taskOutputDirectory, { recursive: true });
  const revisionNumber = await nextRevisionNumber(taskOutputDirectory);
  const revision = `revision-${String(revisionNumber).padStart(3, "0")}`;
  const relativePath = path.posix.join("output", taskId, revision);
  const destination = safeRevisionPath(root, relativePath);
  const staging = path.join(taskOutputDirectory, `.pending-${revision}-${crypto.randomUUID()}`);
  await fs.mkdir(path.join(staging, "images"), { recursive: true });

  try {
    const byId = new Map(task.finalImages.items.map((image) => [image.id, image]));
    const usedNames = new Set();
    const archivedImages = [];
    for (const imageId of task.finalImages.order) {
      const image = byId.get(imageId);
      if (!image) throw new Error(`确认顺序引用了未知成品图：${imageId}`);
      const fileName = archiveImageName(image, usedNames);
      const sourcePath = path.resolve(image.sourcePath);
      await fs.copyFile(sourcePath, path.join(staging, "images", fileName));
      archivedImages.push({ id: image.id, file: `images/${fileName}`, alt: image.alt || "" });
    }

    await atomicWriteJson(path.join(staging, "copy.json"), task.finalCopy);
    await atomicWriteJson(path.join(staging, "production-sheet.json"), task.productionSheet);
    await atomicWriteJson(path.join(staging, "risk-review.json"), {
      preflight: task.preflightRisk,
      preflightResolution: task.preflightResolution,
      final: task.finalRisk,
      resolution: task.riskResolution,
    });
    await atomicWriteJson(path.join(staging, "sources.json"), approvedReferences);
    const generatedAt = new Date().toISOString();
    const manifest = {
      version: 1,
      taskId,
      threadId: task.threadId,
      revision,
      generatedAt,
      status: "awaiting_approval",
      approval: {
        status: "awaiting_approval",
        requestedAt: task.approval.requestedAt,
        approvedAt: null,
        approvedBy: null,
        note: null,
      },
      brief: task.brief,
      approvedReferenceIds,
      files: {
        copy: "copy.json",
        productionSheet: "production-sheet.json",
        riskReview: "risk-review.json",
        sources: "sources.json",
        images: archivedImages,
      },
    };
    await atomicWriteJson(path.join(staging, "manifest.json"), manifest);
    await fs.rename(staging, destination);

    const archive = {
      revision,
      relativePath,
      generatedAt,
      status: "awaiting_approval",
      approvedReferenceIds,
      imageCount: archivedImages.length,
    };
    task.archive = archive;
    return archive;
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function updateArchivedApproval({ root, task, status }) {
  if (!task?.archive?.relativePath) throw new Error("任务尚无输出归档");
  if (!new Set(["awaiting_approval", "approved"]).has(status)) throw new Error(`不支持的归档审批状态：${status}`);
  const revisionDirectory = safeRevisionPath(root, task.archive.relativePath);
  const manifestPath = path.join(revisionDirectory, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.taskId !== task.taskId || manifest.revision !== task.archive.revision) {
    throw new Error("归档清单与当前任务版本不一致");
  }
  const approval = {
    status,
    requestedAt: task.approval?.requestedAt || manifest.approval?.requestedAt || null,
    approvedAt: status === "approved" ? task.approval?.approvedAt || new Date().toISOString() : null,
    approvedBy: status === "approved" ? task.approval?.approvedBy || null : null,
    note: status === "approved" ? task.approval?.note || null : null,
  };
  manifest.status = status;
  manifest.approval = approval;
  manifest.updatedAt = new Date().toISOString();
  await atomicWriteJson(manifestPath, manifest);
  task.archive.status = status;
  task.archive.updatedAt = manifest.updatedAt;
  return manifest;
}
