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

function validateBrandAssets(assets, errors) {
  const names = new Set();
  if (!Array.isArray(assets)) {
    errors.push("brandAssets 必须是数组");
    return names;
  }
  assets.forEach((asset, index) => {
    const path = `brandAssets[${index}]`;
    if (!isRecord(asset)) {
      errors.push(`${path} 必须是对象`);
      return;
    }
    checkKeys(asset, ["name", "path", "purpose"], path, errors);
    for (const field of ["name", "path", "purpose"]) checkText(asset[field], `${path}.${field}`, errors);
    if (typeof asset.name === "string" && asset.name.trim()) {
      if (names.has(asset.name)) errors.push(`brandAssets 中名称重复：${asset.name}`);
      names.add(asset.name);
    }
  });
  return names;
}

function validateCanvasDefaults(value, errors) {
  const path = "canvasDefaults";
  if (!isRecord(value)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(value, ["imageModel", "resolution", "aspectRatio", "quality", "imageCount"], path, errors);
  checkText(value.imageModel, `${path}.imageModel`, errors);
  if (!["1k", "2k", "4k", "auto"].includes(value.resolution)) errors.push(`${path}.resolution 必须是 1k、2k、4k 或 auto`);
  if (!["1:1", "2:3", "3:2", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21", "auto"].includes(value.aspectRatio)) {
    errors.push(`${path}.aspectRatio 不是当前画布支持的比例`);
  }
  if (!["auto", "high", "medium", "low"].includes(value.quality)) errors.push(`${path}.quality 必须是 auto、high、medium 或 low`);
  if (!Number.isInteger(value.imageCount) || value.imageCount < 1 || value.imageCount > 15) errors.push(`${path}.imageCount 必须是 1 到 15 的整数`);
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

function hasDirectLayoutContradiction(prompt) {
  const rules = [
    /(?:不出现|不要出现|禁止(?:出现|添加)?|不得出现|不允许出现|不添加|不要添加|不带|不包含|不需要)\s*(?:任何(?:(?:机构|品牌)?(?:可辨认的|可识别的|清晰可辨的)?)?|可辨认的|可识别的|清晰可辨的)?\s*(?:logo|标志|徽标|文字|文本|字样)/iu,
    /(?:logo|标志|徽标|文字|文本|字样)(?:不要出现|不得出现|不出现|禁止出现|禁止添加|不得添加)/iu,
    /(?:后期排字|后期加字|后期添加文字|留白给(?:文字|文本|标题|文案)|预留(?:文字|文本|标题|文案)(?:排版|添加))/iu,
    /\bno\s+(?:visible\s+)?(?:text|logos?)\b/iu,
    /\b(?:do not|don't|never)\s+(?:include|render|show|add)\s+(?:any\s+)?(?:visible\s+)?(?:text|logo)\b/iu,
    /\b(?:text|logo)\s+(?:will be|to be)\s+(?:added|typeset)\s+later\b/iu,
    /\bleave\s+(?:blank\s+)?space\s+for\s+(?:text|copy)\b/iu,
  ];
  return rules.some((rule) => rule.test(prompt));
}

function hasDirectLogoProhibition(text) {
  return /(?:不出现|不要出现|禁止(?:出现|添加)?|不得出现|不允许出现|不添加|不要添加|不带|不包含|不需要)\s*(?:任何(?:机构|品牌)?|机构|品牌)?\s*(?:logo|标志|徽标)/iu.test(text)
    || /(?:logo|标志|徽标)(?:不要出现|不得出现|不出现|禁止出现|禁止添加|不得添加)/iu.test(text)
    || /\bno\s+(?:company\s+)?logos?\b/iu.test(text)
    || /\b(?:do not|don't|never)\s+(?:include|show|add)\s+(?:the\s+)?logo\b/iu.test(text);
}

function validateCanvasPlan(plan, page, path, errors, approvedIds, selectedIds, brandAssetNames, brandRequirements) {
  if (!isRecord(plan)) {
    errors.push(`${path}.canvasPlan 必须是对象`);
    return;
  }
  checkKeys(plan, ["stylePrompt", "layoutPrompt", "logoAssetName", "logoPlacement", "visualReference"], `${path}.canvasPlan`, errors);
  checkText(plan.stylePrompt, `${path}.canvasPlan.stylePrompt`, errors);
  checkText(plan.layoutPrompt, `${path}.canvasPlan.layoutPrompt`, errors);

  const copy = isRecord(page.readerFacingCopy) ? page.readerFacingCopy : {};
  const exactCopy = ["kicker", "headline", "body", "callout"]
    .map((field) => copy[field])
    .filter((text) => typeof text === "string" && text.trim().length > 0);

  for (const field of ["stylePrompt", "layoutPrompt"]) {
    const prompt = plan[field];
    if (typeof prompt === "string") {
      if (hasDirectLayoutContradiction(prompt)) {
        errors.push(`${path}.canvasPlan.${field} 含有禁止生成文字或 Logo、留白待排字等矛盾指令`);
      }
      for (const text of exactCopy) {
        if (prompt.includes(text)) errors.push(`${path}.canvasPlan.${field} 重复了 readerFacingCopy 中的画面文案：${text}`);
      }
    }
  }

  if (hasOwn(plan, "logoAssetName")) {
    checkText(plan.logoAssetName, `${path}.canvasPlan.logoAssetName`, errors);
    checkText(plan.logoPlacement, `${path}.canvasPlan.logoPlacement`, errors);
    if (typeof plan.logoAssetName === "string" && !brandAssetNames.has(plan.logoAssetName)) {
      errors.push(`${path}.canvasPlan.logoAssetName 未对应已声明的 brandAssets 名称：${plan.logoAssetName}`);
    }
    if (typeof brandRequirements === "string" && hasDirectLogoProhibition(brandRequirements)) {
      errors.push(`${path}.brandRequirements 禁止使用 Logo，与 canvasPlan.logoAssetName 冲突`);
    }
  } else if (hasOwn(plan, "logoPlacement")) {
    checkText(plan.logoPlacement, `${path}.canvasPlan.logoPlacement`, errors);
    errors.push(`${path}.canvasPlan.logoPlacement 需要同时提供 logoAssetName`);
  }

  if (hasOwn(plan, "visualReference")) {
    const reference = plan.visualReference;
    const referencePath = `${path}.canvasPlan.visualReference`;
    if (!isRecord(reference)) {
      errors.push(`${referencePath} 必须是对象`);
      return;
    }
    checkKeys(reference, ["sourceId", "path", "purpose"], referencePath, errors);
    checkText(reference.sourceId, `${referencePath}.sourceId`, errors);
    checkText(reference.path, `${referencePath}.path`, errors);
    checkText(reference.purpose, `${referencePath}.purpose`, errors);
    if (typeof reference.sourceId === "string" && reference.sourceId.trim()) {
      const usedIds = new Set();
      checkSourceIds([reference.sourceId], `${referencePath}.sourceId`, errors, approvedIds, usedIds);
      if (selectedIds && !selectedIds.has(reference.sourceId)) {
        errors.push(`${referencePath}.sourceId 中的 ${reference.sourceId} 不在制作单 selectedSourceIds 中`);
      }
    }
  }
}

function validatePage(page, index, errors, approvedIds, selectedIds, brandAssetNames, brandRequirements) {
  const path = `pages[${index}]`;
  if (!isRecord(page)) {
    errors.push(`${path} 必须是对象`);
    return;
  }
  checkKeys(page, ["cardId", "readerFacingCopy", "canvasPlan", "sourceIds"], path, errors);
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
  validateCanvasPlan(page.canvasPlan, page, path, errors, approvedIds, selectedIds, brandAssetNames, brandRequirements);
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
  checkKeys(sheet, ["referenceReviewStatus", "selectedSourceIds", "claims", "title", "body", "tags", "brandRequirements", "brandAssets", "canvasDefaults", "pages", "editorNotes"], "制作单", errors);

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
  checkText(sheet.brandRequirements, "brandRequirements", errors);
  const brandAssetNames = hasOwn(sheet, "brandAssets") ? validateBrandAssets(sheet.brandAssets, errors) : new Set();
  validateCanvasDefaults(sheet.canvasDefaults, errors);
  if (!Array.isArray(sheet.editorNotes) || sheet.editorNotes.some((note) => typeof note !== "string")) errors.push("editorNotes 必须是字符串数组");

  if (!Array.isArray(sheet.claims)) {
    errors.push("claims 必须是数组");
  } else {
    sheet.claims.forEach((claim, index) => validateClaim(claim, index, errors, approvedIds, selectedIds));
  }

  if (!Array.isArray(sheet.pages) || sheet.pages.length < 3 || sheet.pages.length > 5) {
    errors.push("pages 必须包含 3 到 5 页");
  } else {
    sheet.pages.forEach((page, index) => validatePage(page, index, errors, approvedIds, selectedIds, brandAssetNames, sheet.brandRequirements));
  }

  return { valid: errors.length === 0, errors };
}
