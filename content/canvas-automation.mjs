import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_REFERENCE_BYTES = 1_900_000; // Canvas backend rejects inputs over 2 MiB.
const execFileAsync = promisify(execFile);
const IMAGE_SIZES = {
  "1k": { "1:1": "1024x1024", "3:4": "768x1024", "4:3": "1024x768", "9:16": "864x1536", "16:9": "1536x864" },
  "2k": { "1:1": "2048x2048", "3:4": "1536x2048", "4:3": "2048x1536", "9:16": "1152x2048", "16:9": "2048x1152" },
  "4k": { "1:1": "2880x2880", "3:4": "2480x3312", "4:3": "3312x2480", "9:16": "2160x3840", "16:9": "3840x2160" },
};

/** Parse the Markdown emitted by this project's Canvas sheet exporter. */
export function parseCanvasSheet(markdown, sheetPath) {
  markdown = markdown.replace(/\r\n/g, "\n");
  const settings = markdown.match(/^生成设置：(.+?)｜(.+?)｜(.+?)｜质量 (.+?)｜每次 (\d+) 张\s*$/m);
  if (!settings) throw new Error("制作单缺少可解析的生成设置");
  const headings = [...markdown.matchAll(/^## 第 (\d+) 页\s*$/gm)];
  if (!headings.length) throw new Error("制作单没有逐页节点");
  const pages = headings.map((heading, index) => {
    const section = markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length);
    const matches = [...section.matchAll(/^\d+\. \*\*(图片|文字)节点 ([\w-]+)：([^\n]+?)\*\*\s*$/gm)];
    if (!matches.length) throw new Error(`第 ${heading[1]} 页没有节点`);
    const nodes = matches.map((match, nodeIndex) => {
      const body = section.slice(match.index + match[0].length, matches[nodeIndex + 1]?.index ?? section.length);
      const id = match[2];
      if (match[1] === "图片") {
        const file = body.match(/^\s*放入：(.+?)\s*$/m)?.[1]?.trim();
        if (!file) throw new Error(`${id} 缺少图片文件路径`);
        return { id, kind: "image", label: match[3], file: path.isAbsolute(file) ? file : path.resolve(path.dirname(sheetPath), file) };
      }
      const text = body.match(/```text\n([\s\S]*?)\n```/)?.[1];
      if (!text) throw new Error(`${id} 缺少文字节点内容`);
      return { id, kind: "text", label: match[3], text };
    });
    const ids = nodes.map((node) => node.id);
    if (new Set(ids).size !== ids.length) throw new Error(`第 ${heading[1]} 页存在重复节点 ID`);
    const instructedIds = section.match(/^把 (.+?) \*\*全部连入同一个图片模式生成配置节点\*\*/m)?.[1]?.split("、");
    if (!instructedIds || instructedIds.length !== ids.length || instructedIds.some((id, i) => id !== ids[i])) {
      throw new Error(`第 ${heading[1]} 页节点列表与连线说明不一致`);
    }
    if (!nodes.some((node) => node.id.endsWith("-title")) || !nodes.some((node) => node.id.endsWith("-final"))) {
      throw new Error(`第 ${heading[1]} 页缺少标题或最终指令节点`);
    }
    return { number: Number(heading[1]), nodes };
  });
  if (pages.some((page, index) => page.number !== index + 1)) throw new Error("制作单页码必须从 1 连续递增");
  return { settings: { imageModel: settings[1].trim(), aspectRatio: settings[2].trim(), resolution: settings[3].trim().toLowerCase(), quality: settings[4].trim(), imageCount: Number(settings[5]) }, pages };
}

export function canvasImageSize(settings) {
  const size = IMAGE_SIZES[settings.resolution]?.[settings.aspectRatio];
  if (!size) throw new Error(`画布 v0.19.0 不支持 ${settings.resolution} / ${settings.aspectRatio} 的自动尺寸映射`);
  return size;
}

export async function loadCanvasImages(page) {
  const result = new Map();
  for (const node of page.nodes.filter((item) => item.kind === "image")) {
    let mimeType = IMAGE_MIME[path.extname(node.file).toLowerCase()];
    if (!mimeType) throw new Error(`${node.id} 的图片格式不支持：${node.file}`);
    let bytes = await fs.readFile(node.file);
    if (!bytes.length) throw new Error(`${node.id} 是空图片：${node.file}`);
    const sourceBytes = bytes.length;
    let dimensions = mimeType === "image/png" ? pngDimensions(bytes) : null;
    if (bytes.length > MAX_REFERENCE_BYTES) {
      const prepared = await prepareLargeImage(node.file, MAX_REFERENCE_BYTES);
      bytes = Buffer.from(prepared.base64, "base64");
      mimeType = prepared.mimeType;
      dimensions = { width: prepared.width, height: prepared.height };
    }
    result.set(node.id, {
      content: `data:${mimeType};base64,${bytes.toString("base64")}`,
      mimeType,
      bytes: bytes.length,
      sourceBytes,
      naturalWidth: dimensions?.width,
      naturalHeight: dimensions?.height,
    });
  }
  return result;
}

/** Canvas v0.19.0 accepts image data URLs as image-node content. */
export function buildCanvasPageOps(page, settings, images, { prefix, x = 0, model } = {}) {
  if (!prefix || !/^[\w-]+$/.test(prefix)) throw new Error("缺少合法的节点前缀");
  const configId = `${prefix}-p${page.number}-config`;
  const ids = new Map(page.nodes.map((node) => [node.id, `${prefix}-${node.id}`]));
  const ops = page.nodes.map((node, index) => {
    const column = index < 3 ? 0 : 1;
    const row = column ? index - 3 : index;
    const position = { x: x + column * 390, y: row * 285 };
    if (node.kind === "text") return { type: "add_node", id: ids.get(node.id), nodeType: "text", title: node.label, position, width: 340, height: 240, metadata: { content: node.text, status: "success", fontSize: 14 } };
    const image = images.get(node.id);
    if (!image) throw new Error(`${node.id} 的图片尚未加载`);
    const { sourceBytes: _sourceBytes, ...metadata } = image;
    const scale = Math.min(1, 340 / (image.naturalWidth || 340), 340 / (image.naturalHeight || 340));
    return { type: "add_node", id: ids.get(node.id), nodeType: "image", title: node.label, position, width: Math.max(80, Math.round((image.naturalWidth || 340) * scale)), height: Math.max(60, Math.round((image.naturalHeight || 340) * scale)), metadata: { ...metadata, status: "success" } };
  });
  ops.push({ type: "add_node", id: configId, nodeType: "config", title: `第 ${page.number} 页图片生成`, position: { x: x + 830, y: 285 }, width: 360, height: 300, metadata: { generationMode: "image", composerContent: "", prompt: "", status: "idle", ...(model ? { model } : {}), size: canvasImageSize(settings), quality: settings.quality, count: settings.imageCount } });
  ops.push(...page.nodes.map((node) => ({ type: "connect_nodes", fromNodeId: ids.get(node.id), toNodeId: configId })));
  return { configId, nodeIds: [...ids.values()], ops };
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") throw new Error("PNG 文件头无效");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function prepareLargeImage(file, maxBytes) {
  const helper = path.resolve(import.meta.dirname, "../scripts/prepare-canvas-image.py");
  const candidates = [process.env.XHS_CANVAS_PYTHON, managedPython(), "python3"].filter(Boolean);
  let missingPillow = false;
  for (const python of [...new Set(candidates)]) {
    try {
      const { stdout } = await execFileAsync(python, [helper, file, String(maxBytes)], { maxBuffer: 8_000_000 });
      return JSON.parse(stdout);
    } catch (error) {
      if (/No module named ['"]PIL['"]/.test(error.stderr || "")) { missingPillow = true; continue; }
      if (error.code === "ENOENT") continue;
      throw new Error(`参考图处理失败：${error.stderr?.trim() || error.message}`);
    }
  }
  throw new Error(missingPillow ? "缺少 Pillow；请重新运行素材 MCP 安装器以安装画布图片处理依赖" : "找不到可用的 Python 解释器");
}

function managedPython() {
  const home = os.homedir();
  const root = process.platform === "darwin" ? path.join(home, "Library", "Application Support")
    : process.platform === "win32" ? (process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"))
      : (process.env.XDG_DATA_HOME || path.join(home, ".local", "share"));
  return path.join(root, "material-library-mcp", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
}
