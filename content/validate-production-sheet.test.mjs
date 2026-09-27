import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionSheet } from "./validate-production-sheet.mjs";

const references = {
  confirmed: true,
  selectedIds: ["ref-kept"],
  candidates: [{ id: "ref-kept" }, { id: "ref-excluded" }],
};

function canvasPlan({ logo = false, reference = false } = {}) {
  const plan = {
    stylePrompt: "春日校园场景，清爽明亮的编辑插画风格，主色采用浅蓝与暖白。",
    layoutPrompt: "主标题置于上方，说明文字分段放在中部，重点信息放入底部色块。",
  };
  if (logo) {
    plan.logoAssetName = "品牌 Logo";
    plan.logoPlacement = "右上角";
  }
  if (reference) plan.visualReference = {
    sourceId: "ref-kept",
    path: "/tmp/ref-kept-cover.png",
    purpose: "只借鉴标题位置和信息层级，不复制原图。",
  };
  return plan;
}

function page(cardId, options) {
  return {
    cardId,
    readerFacingCopy: { headline: `标题 ${cardId}`, body: "读者能看到的说明。" },
    canvasPlan: canvasPlan(options),
    sourceIds: [],
  };
}

function sheet(pages = [page("cover"), page("middle"), page("end")]) {
  return {
    referenceReviewStatus: "human-confirmed",
    selectedSourceIds: ["ref-kept"],
    claims: [{ claimId: "c1", text: "可追溯的结构观察", basis: "retained-reference", sourceIds: ["ref-kept"] }],
    title: "制作单标题",
    body: "供后续发布文案校准的初稿。",
    tags: ["示例"],
    brandRequirements: "品牌语气清晰克制，使用当前品牌色，不虚构课程或录取结果。",
    canvasDefaults: { imageModel: "GPT Image 2", resolution: "2k", aspectRatio: "3:4", quality: "high", imageCount: 1 },
    pages,
    editorNotes: [],
  };
}

test("接受 3–5 页、字段分离且仅引用人工保留资料的制作单", () => {
  const result = validateProductionSheet(sheet(), references);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("参考资料未确认时阻止制作单通过", () => {
  const result = validateProductionSheet(sheet(), { ...references, confirmed: false });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("人工核对并确认")));
});

test("拒绝少于 3 页或多于 5 页", () => {
  assert.ok(validateProductionSheet(sheet([page("one"), page("two")]), references).errors.some((error) => error.includes("3 到 5 页")));
  assert.ok(validateProductionSheet(sheet(Array.from({ length: 6 }, (_, index) => page(`p${index}`))), references).errors.some((error) => error.includes("3 到 5 页")));
});

test("拒绝排除来源进入来源清单、claim 或页面", () => {
  const candidate = sheet();
  candidate.pages[0].sourceIds = ["ref-excluded"];
  const result = validateProductionSheet(candidate, references);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("未获人工保留的来源：ref-excluded")));
});

test("拒绝把制作指引塞进读者文案字段", () => {
  const candidate = sheet();
  candidate.pages[0].readerFacingCopy.layoutPrompt = "三栏排版";
  const result = validateProductionSheet(candidate, references);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("readerFacingCopy.layoutPrompt 不在允许字段中")));
});

test("逐页使用唯一 readerFacingCopy，并按需映射 Logo 与人工保留的参考图", () => {
  const candidate = sheet();
  candidate.brandAssets = [{ name: "品牌 Logo", path: "/Users/me/brand/logo.svg", purpose: "作为画面右上角的品牌 Logo。" }];
  candidate.pages[0] = page("cover", { logo: true, reference: true });
  assert.deepEqual(validateProductionSheet(candidate, references), { valid: true, errors: [] });

  const missingLogo = structuredClone(candidate);
  missingLogo.pages[0].canvasPlan.logoAssetName = "未知 Logo";
  assert.ok(validateProductionSheet(missingLogo, references).errors.some((error) => error.includes("未对应已声明的 brandAssets 名称")));

  const missingPlacement = structuredClone(candidate);
  delete missingPlacement.pages[0].canvasPlan.logoPlacement;
  assert.ok(validateProductionSheet(missingPlacement, references).errors.some((error) => error.includes("logoPlacement 必须是非空")));

  const conflictingRequirement = structuredClone(candidate);
  conflictingRequirement.brandRequirements = "不出现任何机构 Logo，保持版面简洁。";
  assert.ok(validateProductionSheet(conflictingRequirement, references).errors.some((error) => error.includes("brandRequirements 禁止使用 Logo")));

  const excludedReference = structuredClone(candidate);
  excludedReference.pages[0].canvasPlan.visualReference.sourceId = "ref-excluded";
  assert.ok(validateProductionSheet(excludedReference, references).errors.some((error) => error.includes("未获人工保留的来源：ref-excluded")));
});

test("只拒绝场景或版式中的直接无文字、无 Logo、留白待排字矛盾指令", () => {
  const candidate = sheet();
  candidate.pages[0].canvasPlan.layoutPrompt = "标题放在顶部，不出现任何机构 Logo，不出现可辨认的文字，留白给文字后期排字。";
  const result = validateProductionSheet(candidate, references);
  assert.ok(result.errors.some((error) => error.includes("layoutPrompt 含有禁止生成文字或 Logo")));

  const ordinaryNegation = sheet();
  ordinaryNegation.pages[0].canvasPlan.stylePrompt = "避免复杂装饰，不要让配色过多，保留清楚层次。";
  assert.deepEqual(validateProductionSheet(ordinaryNegation, references), { valid: true, errors: [] });
});

test("场景或版式字段不能复制 readerFacingCopy 的实际文案", () => {
  const candidate = sheet();
  candidate.pages[0].canvasPlan.layoutPrompt = "把标题 cover 放在顶部，正文放在中部。";
  const result = validateProductionSheet(candidate, references);
  assert.ok(result.errors.some((error) => error.includes("layoutPrompt 重复了 readerFacingCopy 中的画面文案")));
});

test("画布默认设置采用当前节点可选项，并拒绝无效值", () => {
  const candidate = sheet();
  candidate.canvasDefaults.aspectRatio = "5:7";
  candidate.canvasDefaults.imageCount = 16;
  const result = validateProductionSheet(candidate, references);
  assert.ok(result.errors.some((error) => error.includes("aspectRatio")));
  assert.ok(result.errors.some((error) => error.includes("imageCount")));
});

test("视觉参考必须来自人工保留的素材并提供可用路径和用途", () => {
  const candidate = sheet();
  candidate.pages[0].canvasPlan.visualReference = {
    sourceId: "ref-excluded",
    path: "/tmp/ref-excluded.png",
    purpose: "构图参考",
  };
  const result = validateProductionSheet(candidate, references);
  assert.ok(result.errors.some((error) => error.includes("未获人工保留的来源：ref-excluded")));

  const missingReferenceDetails = sheet();
  missingReferenceDetails.pages[0].canvasPlan.visualReference = { sourceId: "ref-kept" };
  const incomplete = validateProductionSheet(missingReferenceDetails, references);
  assert.ok(incomplete.errors.some((error) => error.includes("visualReference.path")));
  assert.ok(incomplete.errors.some((error) => error.includes("visualReference.purpose")));
});

test("拒绝 retained-reference claim 缺少来源", () => {
  const candidate = sheet();
  candidate.claims[0].sourceIds = [];
  const result = validateProductionSheet(candidate, references);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("至少需要一个来源 ID")));
});
