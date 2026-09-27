#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProductionSheet } from "../content/validate-production-sheet.mjs";
import { renderCanvasSheet } from "../content/export-canvas-sheet.mjs";
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
  readTaskByThread,
  recordFinalImages,
  resolveFinalRisk,
  resolvePreflightRisk,
  updateTask,
} from "../src/task-state.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? null : args[index + 1];
}

function requiredOption(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) throw new Error(`缺少 --${name}`);
  return value;
}

const root = path.resolve(option("root") || projectRoot);

async function inputJson() {
  const file = requiredOption("file");
  return JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
}

function requireHumanConfirmation() {
  if (!args.includes("--human-confirmed")) {
    throw new Error("此步骤需人工确认；确认后添加 --human-confirmed");
  }
}

async function main() {
  let state;
  if (command === "init") {
    state = await createTask({
      root,
      taskId: option("task") || undefined,
      threadId: requiredOption("thread"),
      brief: await inputJson(),
    });
  } else if (command === "show") {
    state = option("thread")
      ? await readTaskByThread({ root, threadId: requiredOption("thread") })
      : await readTask({ root, taskId: requiredOption("task") });
    if (!state) throw new Error("该线程还没有任务");
  } else {
    const taskId = requiredOption("task");
    if (command === "candidates") {
      const candidates = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => presentReferencesForReview(task, candidates) });
    } else if (command === "select") {
      requireHumanConfirmation();
      const ids = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => confirmReferenceSelection(task, ids) });
    } else if (command === "sheet") {
      const sheet = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => {
        const validation = validateProductionSheet(sheet, task.references);
        if (!validation.valid) throw new Error(`制作单未通过校验：${validation.errors.join("；")}`);
        return createProductionSheet(task, sheet);
      } });
      await fs.writeFile(path.join(root, "runs", "tasks", taskId, "canvas-sheet.md"), renderCanvasSheet(state.productionSheet), "utf8");
    } else if (command === "preflight-review") {
      requireHumanConfirmation();
      const decisions = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => resolvePreflightRisk(task, decisions) });
    } else if (command === "images") {
      const images = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => recordFinalImages(task, images, { orderConfirmed: args.includes("--order-clear") }) });
    } else if (command === "order") {
      requireHumanConfirmation();
      const ids = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => confirmFinalImageOrder(task, ids) });
    } else if (command === "copy") {
      const copy = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => calibrateCopy(task, copy) });
    } else if (command === "risk-review") {
      requireHumanConfirmation();
      const resolution = await inputJson();
      state = await updateTask({ root, taskId, update: (task) => resolveFinalRisk(task, resolution) });
    } else if (command === "submit") {
      state = await archiveTaskForApproval({ root, taskId });
    } else if (command === "approve") {
      requireHumanConfirmation();
      state = await approveTask({ root, taskId, approvedBy: option("by") || "", note: option("note") || "" });
    } else {
      throw new Error("命令: init, show, candidates, select, sheet, preflight-review, images, order, copy, risk-review, submit, approve");
    }
  }
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
