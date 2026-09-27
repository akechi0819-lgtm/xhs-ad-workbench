import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildCanvasPageOps, loadCanvasImages } from "./canvas-automation.mjs";

export async function loadCanvasAgentConfig(file = path.join(os.homedir(), ".infinite-canvas", "canvas-agent.json")) {
  const config = JSON.parse(await fs.readFile(file, "utf8"));
  if (!/^https?:\/\//.test(config.url || "") || !config.token) throw new Error("Canvas Agent 配置缺少 URL 或连接 Token");
  return config;
}

export function canvasAgentClient(config, request = fetch) {
  return async (name, input = {}) => {
    const response = await request(`${config.url.replace(/\/$/, "")}/api/tools`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-canvas-agent-token": config.token },
      body: JSON.stringify({ name, input }),
      signal: AbortSignal.timeout(40_000),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(`${name}: ${body.error || `HTTP ${response.status}`}`);
    return body.result;
  };
}

export function chooseCanvasModel(config, requestedName) {
  const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = normalized(requestedName);
  const options = Array.isArray(config.models) ? config.models : [];
  const current = options.find((item) => item.value === config.current?.model);
  if (!wanted) return config.current?.model;
  if (current && [current.label, config.current?.modelName, current.value].some((value) => normalized(value).includes(wanted))) return current.value;
  const matches = options.filter((item) => [item.label, item.value].some((value) => normalized(value).includes(wanted)));
  if (matches.length === 1) return matches[0].value;
  if (matches.length > 1) throw new Error(`多个画布模型匹配 ${requestedName}，请先在画布中选定其中一个`);
  throw new Error(`画布没有配置制作单要求的图片模型：${requestedName}`);
}

export function verifyCanvasPage(snapshot, plan) {
  const nodes = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
  if (!nodes.has(plan.configId) || plan.nodeIds.some((id) => !nodes.has(id))) throw new Error("画布未收到制作单的全部节点");
  const edges = new Set((snapshot.connections || []).map((edge) => `${edge.fromNodeId}>${edge.toNodeId}`));
  if (plan.nodeIds.some((id) => !edges.has(`${id}>${plan.configId}`))) throw new Error("画布节点连线不完整");
  return true;
}

export async function runCanvasSheet(sheet, client, { pages = sheet.pages, prefix = `xhs-${Date.now().toString(36)}`, generate = true, waitSeconds = 420, onEvent = () => {} } = {}) {
  const target = await client("canvas_get_state");
  if (!target?.projectId) throw new Error("当前没有已连接的画布编辑页");
  onEvent({ step: "target", projectId: target.projectId, title: target.title });
  const modelConfig = await client("workbench_image_get_config");
  const model = chooseCanvasModel(modelConfig, sheet.settings.imageModel);
  const results = [];
  for (const page of pages) {
    const before = await client("canvas_get_state");
    const x = (before.nodes || []).reduce((max, node) => Math.max(max, node.position.x + node.width), 0) + 160;
    const images = await loadCanvasImages(page);
    const plan = buildCanvasPageOps(page, sheet.settings, images, { prefix, x, model });
    onEvent({ page: page.number, step: "placing", nodes: plan.nodeIds.length, images: images.size });
    const applied = await client("canvas_apply_ops", { ops: plan.ops });
    verifyCanvasPage(applied, plan);
    onEvent({ page: page.number, step: "connected", configId: plan.configId });
    if (!generate) {
      results.push({ page: page.number, configId: plan.configId, status: "connected" });
      continue;
    }
    await client("canvas_run_generation", { nodeId: plan.configId, mode: "image" });
    onEvent({ page: page.number, step: "generating", configId: plan.configId });
    const imageId = await waitForCanvasImage(client, plan.configId, waitSeconds);
    results.push({ page: page.number, configId: plan.configId, imageId, status: "succeeded" });
    onEvent({ page: page.number, step: "succeeded", imageId });
  }
  return results;
}

async function waitForCanvasImage(client, configId, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const state = await client("canvas_get_state");
    const config = (state.nodes || []).find((node) => node.id === configId);
    if (config?.metadata?.status === "error") throw new Error(`图片生成失败：${config.metadata.errorDetails || configId}`);
    const outputIds = new Set((state.connections || []).filter((edge) => edge.fromNodeId === configId).map((edge) => edge.toNodeId));
    const outputs = (state.nodes || []).filter((node) => outputIds.has(node.id) && node.type === "image");
    const success = outputs.find((node) => node.metadata?.status === "success");
    if (success) return success.id;
    const failure = outputs.find((node) => node.metadata?.status === "error");
    if (failure) throw new Error(`图片生成失败：${failure.metadata?.errorDetails || failure.title}`);
    const statuses = await client("generation_get_status", { scope: "canvas", nodeIds: [configId] });
    const status = (statuses.tasks || []).find((task) => task.id === configId);
    if (status?.status === "failed") throw new Error(`图片生成失败：${status.error || configId}`);
  }
  throw new Error(`等待画布生图超过 ${waitSeconds} 秒，可在原画布检查或重试该页`);
}
