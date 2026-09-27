function block(value) {
  return `\n\`\`\`text\n${value}\n\`\`\`\n`;
}

function pageNodes(sheet, page, pageNumber) {
  const prefix = `p${pageNumber}`;
  const copy = page.readerFacingCopy;
  const plan = page.canvasPlan;
  const nodes = [];
  if (plan.logoAssetName) {
    const asset = (sheet.brandAssets || []).find((item) => item.name === plan.logoAssetName);
    nodes.push({ id: `${prefix}-logo`, label: "公司 Logo 图片", kind: "image", path: asset?.path || plan.logoAssetName });
  }
  const title = [copy.kicker && `眉题：${copy.kicker}`, `主标题：${copy.headline}`].filter(Boolean).join("\n");
  nodes.push({ id: `${prefix}-title`, label: "精确标题文字", kind: "text", text: title });
  const body = [copy.body && `正文：${copy.body}`, copy.callout && `强调语：${copy.callout}`].filter(Boolean).join("\n");
  if (body) nodes.push({ id: `${prefix}-copy`, label: "精确正文文字", kind: "text", text: body });
  if (plan.visualReference) nodes.push({
    id: `${prefix}-reference`, label: "视觉参考图片", kind: "image",
    path: plan.visualReference.path, purpose: plan.visualReference.purpose,
  });
  nodes.push({
    id: `${prefix}-style`, label: "画风与品牌要求", kind: "text",
    text: `${sheet.brandRequirements}\n${plan.stylePrompt}`,
  });
  const finalInstructions = [
    `生成一张可直接使用的完整小红书图文海报，画幅比例 ${sheet.canvasDefaults.aspectRatio}。`,
    `按以下布局安排已连接的标题、正文和画风节点：${plan.layoutPrompt}`,
    "将已连接的标题与正文文字节点中的原文清楚、准确地呈现在海报上，每段只出现一次；直接输出有文字的完整成品。",
  ];
  if (plan.logoAssetName) finalInstructions.push(`将已连接的公司 Logo 图片放在${plan.logoPlacement}，作为成品海报的一部分。`);
  if (plan.visualReference) finalInstructions.push(`已连接的参考图片用途：${plan.visualReference.purpose}`);
  nodes.push({ id: `${prefix}-final`, label: "最终生成指令", kind: "text", text: finalInstructions.join("\n") });
  return nodes;
}

/** Turn one validated sheet into a ready-to-copy, ordered Canvas node recipe. */
export function renderCanvasSheet(sheet) {
  const defaults = sheet.canvasDefaults;
  const hasLogo = sheet.pages.some((page) => Boolean(page.canvasPlan.logoAssetName));
  const lines = [
    `# ${sheet.title}｜Canvas 逐页制作单`,
    "",
    `每页照顺序放节点、连线并生成完整海报${hasLogo ? "（含已提供的公司 Logo）" : ""}。生成配置节点的编辑提示词保持空白；最后一个文字节点已经包含最终生成指令。`,
    "",
    `生成设置：${defaults.imageModel}｜${defaults.aspectRatio}｜${defaults.resolution}｜质量 ${defaults.quality}｜每次 ${defaults.imageCount} 张`,
  ];
  for (const [index, page] of sheet.pages.entries()) {
    const nodes = pageNodes(sheet, page, index + 1);
    lines.push("", `## 第 ${index + 1} 页`, "");
    for (const [position, node] of nodes.entries()) {
      lines.push(`${position + 1}. **${node.kind === "image" ? "图片" : "文字"}节点 ${node.id}：${node.label}**`);
      if (node.kind === "image") {
        lines.push(`   放入：${node.path}`);
        if (node.purpose) lines.push(`   用途：${node.purpose}`);
      } else lines.push(block(node.text));
    }
    lines.push("", `把 ${nodes.map((node) => node.id).join("、")} **全部连入同一个图片模式生成配置节点**，保持配置节点编辑提示词空白，按上方设置点击生成。`);
    lines.push(`生成后检查图上文字${page.canvasPlan.logoAssetName ? "、Logo" : ""}和信息层级；有具体问题只修改该页对应节点后重做。`);
  }
  return `${lines.join("\n")}\n`;
}
