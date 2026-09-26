const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function checkKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} 不在允许字段中`);
  }
}

function checkText(value, path, errors, { required = true } = {}) {
  if (typeof value !== "string" || (required && value.trim().length === 0)) {
    errors.push(`${path} 必须是${required ? "非空" : "字符串"}`);
  }
}

function checkSourceIds(value, path, errors, approvedIds, usedIds) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`);
    return;
  }
  if (new Set(value).size !== value.length) errors.push(`${path} 不能包含重复 ID`);
  for (const [index, id] of value.entries()) {
    if (typeof id !== "string" || id.trim().length === 0) {
      errors.push(`${path}[${index}] 必须是非空字符串`);
      continue;
    }
    if (approvedIds && !approvedIds.has(id)) errors.push(`${path}[${index}] 引用了未获人工保留的来源：${id}`);
    usedIds?.add(id);
  }
}

function validateClaim(claim, index, errors, approvedIds, selectedIds) {
  const path = `claims[${index}]`;
  if (!isRecord(claim)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(claim, ["claimId", "text", "basis", "sourceIds"], path, errors);
  checkText(claim.claimId, `${path}.claimId`, errors);
  checkText(claim.text, `${path}.text`, errors);
  if (!["retained-reference", "human-brief", "editorial-opinion", "needs-verification"].includes(claim.basis)) {
    errors.push(`${path}.basis 不是支持的依据类型`);
  }
  const usedIds = new Set();
  checkSourceIds(claim.sourceIds, `${path}.sourceIds`, errors, approvedIds, usedIds);
  if (claim.basis === "retained-reference" && usedIds.size === 0) {
    errors.push(`${path}.basis 为 retained-reference 时至少需要一个来源 ID`);
  }
  if (selectedIds) {
    for (const id of usedIds) {
      if (!selectedIds.has(id)) errors.push(`${path}.sourceIds 中的 ${id} 不在制作单 selectedSourceIds 中`);
    }
  }
}

function validatePage(page, index, errors, approvedIds, selectedIds) {
  const path = `pages[${index}]`;
  if (!isRecord(page)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(page, ["cardId", "readerFacingCopy", "visualPrompt", "sourceIds"], path, errors);
  checkText(page.cardId, `${path}.cardId`, errors);
  if (!isRecord(page.readerFacingCopy)) {
    errors.push(`${path}.readerFacingCopy 必须是对象`);
  } else {
    checkKeys(page.readerFacingCopy, ["kicker", "headline", "body", "callout"], `${path}.readerFacingCopy`, errors);
    checkText(page.readerFacingCopy.headline, `${path}.readerFacingCopy.headline`, errors);
    checkText(page.readerFacingCopy.body, `${path}.readerFacingCopy.body`, errors, { required: false });
    for (const field of ["kicker", "callout"]) {
      if (hasOwn(page.readerFacingCopy, field)) checkText(page.readerFacingCopy[field], `${path}.readerFacingCopy.${field}`, errors, { required: false });
    }
  }
  if (!isRecord(page.visualPrompt)) {
    errors.push(`${path}.visualPrompt 必须是对象`);
  } else {
    checkKeys(page.visualPrompt, ["promptText", "textTreatment", "avoid"], `${path}.visualPrompt`, errors);
    checkText(page.visualPrompt.promptText, `${path}.visualPrompt.promptText`, errors);
    if (!["place-exact-copy-from-readerFacingCopy", "leave-space-for-manual-typesetting", "no-text"].includes(page.visualPrompt.textTreatment)) {
      errors.push(`${path}.visualPrompt.textTreatment 不是支持的值`);
    }
    if (hasOwn(page.visualPrompt, "avoid") && (!Array.isArray(page.visualPrompt.avoid) || page.visualPrompt.avoid.some((item) => typeof item !== "string"))) {
      errors.push(`${path}.visualPrompt.avoid 必须是字符串数组`);
    }
  }
  const usedIds = new Set();
  checkSourceIds(page.sourceIds, `${path}.sourceIds`, errors, approvedIds, usedIds);
  if (selectedIds) {
    for (const id of usedIds) {
      if (!selectedIds.has(id)) errors.push(`${path}.sourceIds 中的 ${id} 不在制作单 selectedSourceIds 中`);
    }
  }
}

/**
 * Validate the workbench production-sheet contract without third-party packages.
 * `referenceReview` is the persisted task.references value. Candidate metadata is
 * read only to confirm IDs; no candidate content needs to be copied into `sheet`.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProductionSheet(sheet, referenceReview) {
  const errors = [];
  if (!isRecord(sheet)) return { valid: false, errors: ["制作单必须是对象"] };
  checkKeys(sheet, ["referenceReviewStatus", "selectedSourceIds", "claims", "title", "body", "tags", "pages", "editorNotes"], "制作单", errors);

  if (sheet.referenceReviewStatus !== "human-confirmed") errors.push("referenceReviewStatus 必须为 human-confirmed");
  const refs = isRecord(referenceReview) ? referenceReview : {};
  if (refs.confirmed !== true) errors.push("参考资料必须先完成人工核对并确认");
  const approvedIds = new Set();
  if (!Array.isArray(refs.selectedIds)) {
    errors.push("任务参考资料 selectedIds 必须是数组");
  } else {
    for (const [index, id] of refs.selectedIds.entries()) {
      if (typeof id !== "string" || id.trim().length === 0) errors.push(`任务参考资料 selectedIds[${index}] 必须是非空字符串`);
      else if (approvedIds.has(id)) errors.push(`任务参考资料 selectedIds 中 ID 重复：${id}`);
      else approvedIds.add(id);
    }
    if (!Array.isArray(refs.candidates)) {
      errors.push("任务参考资料 candidates 必须是数组");
    } else {
      const candidateIds = new Set(refs.candidates.map((candidate) => isRecord(candidate) ? (candidate.id ?? candidate.sourceId) : undefined).filter((id) => typeof id === "string"));
      for (const id of approvedIds) if (!candidateIds.has(id)) errors.push(`任务已保留的来源未出现在候选清单中：${id}`);
    }
  }

  checkSourceIds(sheet.selectedSourceIds, "selectedSourceIds", errors, approvedIds);
  const selectedIds = Array.isArray(sheet.selectedSourceIds) ? new Set(sheet.selectedSourceIds.filter((id) => typeof id === "string")) : null;

  checkText(sheet.title, "title", errors);
  checkText(sheet.body, "body", errors, { required: false });
  if (!Array.isArray(sheet.tags) || sheet.tags.some((tag) => typeof tag !== "string")) errors.push("tags 必须是字符串数组");
  if (!Array.isArray(sheet.editorNotes) || sheet.editorNotes.some((note) => typeof note !== "string")) errors.push("editorNotes 必须是字符串数组");

  if (!Array.isArray(sheet.claims)) {
    errors.push("claims 必须是数组");
  } else {
    sheet.claims.forEach((claim, index) => validateClaim(claim, index, errors, approvedIds, selectedIds));
  }

  if (!Array.isArray(sheet.pages) || sheet.pages.length < 3 || sheet.pages.length > 5) {
    errors.push("pages 必须包含 3 到 5 页");
  } else {
    sheet.pages.forEach((page, index) => validatePage(page, index, errors, approvedIds, selectedIds));
  }

  return { valid: errors.length === 0, errors };
}
