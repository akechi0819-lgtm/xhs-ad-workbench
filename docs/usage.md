# 本地任务文件操作

Codex 和 WorkBuddy 都在本项目目录内运行 `scripts/workbench.mjs`。模型负责阅读资料、写制作单和回读最终图；脚本负责持久状态、人工选择门禁、格式校验与归档。一个对话只创建一个任务，续做时用 `show` 读回状态。`--thread` 使用客户端能取得的会话 ID；若客户端不提供，首次在该对话内选一个唯一标识，并在后续消息中沿用。

```bash
node scripts/workbench.mjs init --task example-001 --thread conversation-001 --file brief.json
node scripts/workbench.mjs show --task example-001
```

`brief.json` 至少包含 `topic`、`audience`、`requirements`。Agent 可添加用户提供的现行资料位置，但不得把凭据写入任务。运行时 JSON 保存在 `runs/tasks/<taskId>/task.json`，已被 Git 忽略。

仅当用户本轮明确写 `$素材库MCP` 时，Agent 才能检索历史素材。将可能采用的结果转换为候选数组并呈现给用户后落盘：

```bash
node scripts/workbench.mjs candidates --task example-001 --file candidates.json
```

每个候选至少有 `id` 与 `title`。Teedy 结果还应携带摘要、预览链接、`zipUrl`、拟借鉴点 `proposedUse` 和事实口径风险 `factCaveat`；缺项会在状态中明确警示。Agent 应在对话中展示这些信息，等待用户逐项指定保留和排除。人明确答复后，将**保留 ID 数组**写入 `selected-ids.json`；空数组代表人工明确排除全部候选。

```bash
node scripts/workbench.mjs select --task example-001 --file selected-ids.json --human-confirmed
```

只有完成此步，才能保存制作单。`sheet.json` 须符合 `content/schemas/draft.schema.json`，包括 3—5 个 `pages`，每页把 `readerFacingCopy` 与 `visualPrompt` 分开；`selectedSourceIds` 和各项 `sourceIds` 只能引用已保留资料。

当前结构只校验读者文案、通用视觉提示与来源关联；它还没有 Logo/固定元素、精确文字布局、场景提示词和参考图各自对应的 Canvas 节点块。用户在 WorkBuddy 首轮试用中确认这一点影响直接复制使用。节点版制作单属于下一轮待施工范围，不应将现有 `visualPrompt` 描述为已完成画布深度融合。

Codex 使用 `--output-schema` 时，先运行 `npm run schema:codex`，把生成的 `runs/schemas/draft.codex.schema.json` 交给 Codex。原始 schema 中的部分 JSON Schema 约束不受模型结构化输出接口支持；项目校验器仍会在 `sheet` 保存前检查完整业务约束。WorkBuddy 也通过同一 `sheet` 命令验收制作单。

```bash
node scripts/workbench.mjs sheet --task example-001 --file sheet.json
```

后续用户在现有画布选好成品图，Agent 实际读图后可依次运行 `images`、必要时 `order`、`copy`、`submit`。`submit` 生成 `output/<taskId>/revision-NNN/` 待审包，含最终图、`copy.json`、`production-sheet.json`、`sources.json` 和 `manifest.json`。只有用户明确审核通过，才运行 `approve --human-confirmed`；重新回传成品则建立新版本并重审。详细参数可直接查看 `scripts/workbench.mjs`。

脚本不调用素材 MCP，也不连接画布或发布平台。
