# 本地任务文件操作

Codex 和 WorkBuddy 都在本项目目录内运行 `scripts/workbench.mjs`。模型负责阅读资料、写制作单和回读最终图；脚本负责持久状态、人工选择门禁、格式校验与归档。一个对话只创建一个任务，续做时用 `show` 读回状态。`--thread` 使用客户端能取得的会话 ID；若客户端不提供，首次在该对话内选一个唯一标识，并在后续消息中沿用。

```bash
node scripts/workbench.mjs init --task example-001 --thread conversation-001 --file brief.json
node scripts/workbench.mjs show --task example-001
```

`brief.json` 至少包含 `topic`、`audience`、`requirements`，建议在要求中写清业务范围、具体问题和内容目标。它不是必填表单；若现有信息不足以形成明确图文检索问题，Agent 只追问关键缺口。Agent 可添加现行资料位置，不能写入凭据。运行时 JSON 保存在 `runs/tasks/<taskId>/task.json`，已被 Git 忽略。

需求已明确且历史参考有助于制作时，Agent 直接调用已配置的只读素材 MCP，无需用户另写触发词。按实际命中和相关性展示图文候选后落盘；命中少时可全部展示，较多时优先高相关、互补的候选：

```bash
node scripts/workbench.mjs candidates --task example-001 --file candidates.json
```

每个候选至少有 `id` 与 `title`。Teedy 结果还应携带摘要、预览链接、`zipUrl`、拟借鉴点 `proposedUse` 和事实口径风险 `factCaveat`；缺项会在状态中明确警示。Agent 应在对话中展示这些信息，等待用户逐项指定保留和排除。人明确答复后，将**保留 ID 数组**写入 `selected-ids.json`；空数组代表人工明确排除全部候选。

```bash
node scripts/workbench.mjs select --task example-001 --file selected-ids.json --human-confirmed
```

工作台随包提供 990 条词库记录（985 个不同词项），制作单预检和终稿复核默认读取同一个 `content/risk-lexicon.json`；无需提供原 HTML，也无需额外导入。要基于更新后的 HTML 替换随包词库时，可静态重新提取，默认输出就是该文件：

```bash
python3 scripts/extract-risk-lexicon.py '/你的本机路径/违禁词审核工具2.0(2).html'
```

只有完成参考筛选，才能保存制作单。`sheet.json` 须符合 `content/schemas/draft.schema.json`，包括 3—5 个 `pages`；每页的 `readerFacingCopy` 是唯一的精确图上文字源，`canvasPlan` 只写画风、布局及按需 Logo/视觉参考。标题、正文、画风和最终指令节点与连线由导出器自动生成；`selectedSourceIds` 和各项 `sourceIds` 只能引用已保留资料。

制作单须包含每套共用品牌要求，以及逐页完整海报的精确图上文字、画风、布局和按需 Logo/参考图。保存 `sheet` 时自动导出可直接照着复制的 `runs/tasks/<任务ID>/canvas-sheet.md`，其中列出每个节点放什么和全部连线；配置节点的编辑提示词留空，让 Canvas 汇总所有已连的文字与图片。具体操作见 [Canvas 制作单指南](../content/guides/canvas-production-sheet.md)。同一步会用随包词库预检唯一的拟上图文字；命中时由人决定修改或说明保留依据，并运行 `preflight-review --file 决定数组.json --human-confirmed`。改制作单后旧预检判断失效，须重新扫描。预检不能替代最后按实际成图的终稿复核。

Codex 使用 `--output-schema` 时，先运行 `npm run schema:codex`，把生成的 `runs/schemas/draft.codex.schema.json` 交给 Codex。原始 schema 中的部分 JSON Schema 约束不受模型结构化输出接口支持；项目校验器仍会在 `sheet` 保存前检查完整业务约束。WorkBuddy 也通过同一 `sheet` 命令验收制作单。

```bash
node scripts/workbench.mjs sheet --task example-001 --file sheet.json
```

需要重导制作单时运行 `npm run canvas:export -- --task example-001 --output runs/tasks/example-001/canvas-sheet.md`。导出只整理已保存的制作单，不调用画布或生图。

用户确认制作单后，若 Infinite Canvas v0.19.0 的本地 Canvas Agent 已启动并与目标画布连接，Agent 直接运行 `npm run canvas:run -- --sheet runs/tasks/<任务ID>/canvas-sheet.md`。该命令从 MD 确定性地读取文字、本地 Logo／参考图路径和连线说明，按页创建节点并触发生图；大于 2 MiB 的参考图会自动缩小为可用输入，不改原件。失败时用 `--page N` 或 `--from-page N` 续做；`--plan` 只检查文件和节点，不触发生图。连接方法见 [README](../README.md#按制作单自动操作无限画布)。

后续用户在画布选好成品图，Agent **实际打开并放大查看每张图**，先向用户指出具体页/位置的文字错漏、信息层级、手机可读性、Logo 和图文对应问题，再依次运行 `images`、必要时 `order`、`copy`。每个 `images.json` 项须有 `sourcePath`、逐行 `visibleText`，以及 `textReadability`（`clear` 或 `unclear`）；标成 `clear` 却没有任何实际文字记录时，不能作为已审图提交。看不清时仍记录能辨认的字并标 `unclear`。`copy` 用同一份随包词库生成终稿风险报告，覆盖图上字、标题、正文、标签和可选 `cta`；它只做文字扫描，不替代前面的视觉审核。也可单独执行 `node scripts/check-final-copy.mjs --file final-review-input.json` 查看报告；该 JSON 含 `images` 与 `copy`。

有词项命中时，人逐项决定后运行 `risk-review --file 决定.json --human-confirmed`，说明修改复核或保留依据。报告中的位置、词项和偏移须原样对应。看不清的字即使有说明也不能提交为通过，须先人工核对并重新运行 `images`、`copy`；修改文案后重新运行 `copy`，旧风险判断自动失效。

Agent 先给用户看逐图问题与配套文案；需要修改时继续用 `images`、`copy` 复审，不要提前运行 `submit`。用户认可当前图文后，`submit` 生成 `output/<taskId>/revision-NNN/` 待审包，含最终图、`copy.json`、`production-sheet.json`、`sources.json`、`risk-review.json` 和 `manifest.json`。只有用户明确审核通过才运行 `approve --human-confirmed`；重新回传成品则建立新版本并重审。归档图片暂不可读时 `submit` 不推进状态，修复文件后可重试。详细参数可查看 `scripts/workbench.mjs`。

`workbench.mjs` 不调用素材 MCP、画布或发布平台；`canvas:run` 只操作用户当前连接的画布并触发生图，不发布平台内容。
