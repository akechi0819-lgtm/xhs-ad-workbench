import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadRiskLexicon, reviewFinalRisk, reviewSheetRisk } from "../content/risk-review.mjs";
import { calibrateCopy, createTaskState, recordFinalImages, requestApproval, resolveFinalRisk, resolvePreflightRisk, setTaskBrief } from "../src/task-state.mjs";
process.env.XHS_RISK_LEXICON = new URL("./fixtures/risk-lexicon.json", import.meta.url).pathname;

test("公开包在没有私有 runs 目录或 HTML 源文件时默认扫描随包词库", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-risk-lexicon-package-"));
  const tempContent = path.join(tempRoot, "content");
  fs.mkdirSync(tempContent);
  fs.copyFileSync(new URL("../content/risk-review.mjs", import.meta.url), path.join(tempContent, "risk-review.mjs"));
  fs.copyFileSync(new URL("../content/risk-lexicon.json", import.meta.url), path.join(tempContent, "risk-lexicon.json"));
  const priorOverride = process.env.XHS_RISK_LEXICON;
  try {
    delete process.env.XHS_RISK_LEXICON;
    const isolatedModule = await import(`${pathToFileURL(path.join(tempContent, "risk-review.mjs")).href}?package-check=${Date.now()}`);
    assert.equal(fs.existsSync(path.join(tempRoot, "runs")), false);
    assert.equal(isolatedModule.loadRiskLexicon().length, 990);
    const report = isolatedModule.reviewFinalRisk({ images: [{ visibleText: ["保录取"], textReadability: "clear" }], copy: { title: "", body: "", tags: [] } });
    assert.equal(report.hits[0].term, "保录取");
  } finally {
    if (priorOverride === undefined) delete process.env.XHS_RISK_LEXICON;
    else process.env.XHS_RISK_LEXICON = priorOverride;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("需求状态不把某个业务主题写死成特殊规则", () => {
  const state = createTaskState({ taskId: "brief", threadId: "thread" });
  setTaskBrief(state, { topic: "示例业务主题", audience: "目标读者", requirements: "图文任务要求" });
  assert.equal(state.brief.topic, "示例业务主题");
});

test("终稿同一词项的重复来源合并成一处人工判断", () => {
  const report = reviewFinalRisk({ images: [{ id: "p1", visibleText: ["保录取"], textReadability: "clear" }], copy: { title: "申请", body: "", tags: [] } });
  assert.equal(report.hits.length, 1);
  assert.equal(report.hits[0].location, "第1张图片(p1)可见文字第1行");
  assert.deepEqual(report.hits[0].categories, ["education", "study_abroad"]);
  assert.equal(loadRiskLexicon().length, 4);
});

test("制作单预检与终稿共用词库，未处理命中不能推进到画布成品", () => {
  const state = createTaskState({ taskId: "preflight", threadId: "thread-preflight" });
  state.stage = "production_sheet_ready";
  state.preflightRisk = reviewSheetRisk({ pages: [{ readerFacingCopy: { headline: "保录取", body: "申请说明" } }] });
  assert.equal(state.preflightRisk.ruleCount, loadRiskLexicon().length);
  assert.equal(state.preflightRisk.hits[0].term, "保录取");
  assert.throws(() => recordFinalImages(state, [{ sourcePath: "/tmp/demo.png" }]), /尚未逐项判断/);
  const hit = state.preflightRisk.hits[0];
  resolvePreflightRisk(state, [{ location: hit.location, term: hit.term, offset: hit.offset, decision: "保留并说明依据", note: "交人工复核后决定" }]);
  recordFinalImages(state, [{ sourcePath: "/tmp/demo.png" }]);
  assert.equal(state.stage, "final_images_received");
});

test("终稿指明实际图片、文案位置及看不清的文字", () => {
  const report = reviewFinalRisk({
    images: [{ id: "img-1", visibleText: ["零风险申请"], textReadability: "unclear" }],
    copy: { title: "申请指南", body: "欢迎了解", tags: ["百分百成功"], cta: "联系顾问" },
  });
  assert.deepEqual(report.hits.map((hit) => hit.location), ["第1张图片(img-1)可见文字第1行", "终稿.tags[0]"]);
  assert.match(report.unreadable[0], /待人工核对/);
  assert.match(report.note, /不代表发布合规/);
});

test("终稿风险需逐项判断；改文案后旧判断失效", () => {
  const state = createTaskState({ taskId: "risk", threadId: "thread-risk" });
  state.stage = "final_images_received";
  state.finalImages = {
    items: [{ id: "p1", sourcePath: "/tmp/fixture.png", visibleText: ["零风险"], textReadability: "clear" }],
    order: ["p1"], orderConfirmed: true,
  };
  calibrateCopy(state, { title: "申请提示", body: "仅供参考", tags: [] });
  assert.throws(() => requestApproval(state), /逐项判断/);
  const hit = state.finalRisk.hits[0];
  resolveFinalRisk(state, {
    hits: [{ location: hit.location, term: hit.term, offset: hit.offset, decision: "保留并说明依据", note: "人工会核对原图后决定" }],
    unreadable: [],
  });
  calibrateCopy(state, { title: "新的标题", body: "仅供参考", tags: [] });
  assert.equal(state.riskResolution, null);
  assert.throws(() => requestApproval(state), /逐项判断/);
});

test("看不清的图中文字即使有说明也不能提交为通过", () => {
  const state = createTaskState({ taskId: "unclear", threadId: "thread-unclear" });
  state.stage = "final_images_received";
  state.finalImages = { items: [{ id: "p1", sourcePath: "/tmp/fixture.png", visibleText: [], textReadability: "unclear" }], order: ["p1"], orderConfirmed: true };
  calibrateCopy(state, { title: "申请提示", body: "仅供参考", tags: [] });
  assert.throws(() => requestApproval(state), /图上文字核对/);
});

test("标记清晰却没有任何图上文字记录不能当作已审图", () => {
  const state = createTaskState({ taskId: "empty-read", threadId: "thread-empty" });
  state.stage = "final_images_received";
  state.finalImages = { items: [{ id: "p1", sourcePath: "/tmp/fixture.png", visibleText: [], textReadability: "clear" }], order: ["p1"], orderConfirmed: true };
  calibrateCopy(state, { title: "图文标题", body: "正文", tags: [] });
  assert.match(state.finalRisk.unreadable[0], /未记录任何图上文字/);
  assert.throws(() => requestApproval(state), /图上文字核对/);
});
