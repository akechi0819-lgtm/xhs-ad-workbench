import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLexicon = path.join(projectRoot, "content", "risk-lexicon.json");
const rank = { low: 1, medium: 2, high: 3 };

export function loadRiskLexicon(filePath = process.env.XHS_RISK_LEXICON || defaultLexicon) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`无法读取风险词库：${filePath}`);
    throw error;
  }
  if (!Array.isArray(payload.entries) || payload.entries.some((entry) =>
    !entry || typeof entry.word !== "string" || !entry.word || !rank[entry.riskLevel] || typeof entry.category !== "string")) {
    throw new Error("本机词库格式无效");
  }
  return payload.entries;
}

function scanLocation(location, value, rules) {
  if (typeof value !== "string") throw new Error(`${location} 必须是文字`);
  const grouped = new Map();
  for (const rule of rules) {
    let at = value.indexOf(rule.word);
    while (at >= 0) {
      const key = `${at}|${rule.word}`;
      const current = grouped.get(key) || {
        location, term: rule.word, offset: at, categories: [], riskLevel: "low",
        reasons: [], suggestions: [], sourceIndices: [], decision: "待人工判断",
      };
      if (!current.categories.includes(rule.category)) current.categories.push(rule.category);
      if (rank[rule.riskLevel] > rank[current.riskLevel]) current.riskLevel = rule.riskLevel;
      if (rule.description && !current.reasons.includes(rule.description)) current.reasons.push(rule.description);
      if (rule.suggestion && !current.suggestions.includes(rule.suggestion)) current.suggestions.push(rule.suggestion);
      if (Number.isInteger(rule.index)) current.sourceIndices.push(rule.index);
      grouped.set(key, current);
      at = value.indexOf(rule.word, at + rule.word.length);
    }
  }
  return [...grouped.values()].sort((a, b) => a.offset - b.offset || b.term.length - a.term.length);
}

export function reviewSheetRisk(sheet, { rules = loadRiskLexicon() } = {}) {
  if (!Array.isArray(sheet?.pages)) throw new Error("制作单预检需要逐页图上文字");
  const hits = [];
  for (const [index, page] of sheet.pages.entries()) {
    for (const [field, value] of Object.entries(page.readerFacingCopy || {})) {
      hits.push(...scanLocation(`第${index + 1}页图上文字.${field}`, value, rules));
    }
  }
  return { phase: "制作单预检", ruleCount: rules.length, hits, note: "制作单预检用于减少生图返工；终稿仍须按实际图片与发布文案重新复核。词项未命中不代表发布合规。" };
}

export function reviewFinalRisk({ images, copy }, { rules = loadRiskLexicon() } = {}) {
  if (!Array.isArray(images) || images.length === 0) throw new Error("终稿风险检查需要成品图文字记录");
  const hits = [];
  const unreadable = [];
  for (const [index, image] of images.entries()) {
    const location = `第${index + 1}张图片${image.id ? `(${image.id})` : ""}`;
    if (!Array.isArray(image.visibleText)) throw new Error(`${location} 缺少实际可见文字记录`);
    if (image.textReadability === "unclear") unreadable.push(`${location}：图上文字看不清，待人工核对`);
    else if (image.textReadability !== "clear") throw new Error(`${location} 需标记 textReadability 为 clear 或 unclear`);
    if (image.textReadability === "clear" && !image.visibleText.some((line) => typeof line === "string" && line.trim())) {
      unreadable.push(`${location}：未记录任何图上文字，需实际读图核对是否漏字`);
    }
    for (const [line, value] of image.visibleText.entries()) hits.push(...scanLocation(`${location}可见文字第${line + 1}行`, value, rules));
  }
  for (const field of ["title", "body", "cta"]) {
    if (copy[field] !== undefined) hits.push(...scanLocation(`终稿.${field}`, copy[field], rules));
  }
  for (const [index, tag] of (copy.tags || []).entries()) hits.push(...scanLocation(`终稿.tags[${index}]`, tag, rules));
  return { phase: "终稿复核", ruleCount: rules.length, hits, unreadable, note: "词项命中仅供人工判断；未命中当前词库不代表发布合规。原 HTML 的替换建议和法律描述不自动采用。" };
}
