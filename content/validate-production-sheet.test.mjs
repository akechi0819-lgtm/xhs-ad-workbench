import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionSheet } from "./validate-production-sheet.mjs";

const references = {
  confirmed: true,
  selectedIds: ["ref-kept"],
  candidates: [{ id: "ref-kept" }, { id: "ref-excluded" }],
};

function page(cardId) {
  return {
    cardId,
    readerFacingCopy: { headline: `标题 ${cardId}`, body: "读者能看到的说明。" },
    visualPrompt: { promptText: "留白清楚，突出正文层级。", textTreatment: "leave-space-for-manual-typesetting" },
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

test("拒绝 retained-reference claim 缺少来源", () => {
  const candidate = sheet();
  candidate.claims[0].sourceIds = [];
  const result = validateProductionSheet(candidate, references);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("至少需要一个来源 ID")));
});
