# 内容工作流与许可来源

本项目内容生产结构以公开母版 [EthanYoQ/agent-xiaohongshu-workbench](https://github.com/EthanYoQ/agent-xiaohongshu-workbench) 的固定提交 [`6e58278984cb891524ead60c9a5f116b6561b4cc`](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/tree/6e58278984cb891524ead60c9a5f116b6561b4cc) 为检查基准。该提交日期为 2026-08-24。母版根目录为 MIT；其中的 Lingzao 内容和中文润色 Skill 各自保留独立许可。

## 采用与改编的内容

| 固定提交中的来源 | 许可 | 本项目承接位置 | 改编范围 |
| --- | --- | --- | --- |
| `server/schemas/deconstruct.schema.json` | 母版 MIT | `content/schemas/deconstruct.schema.json` | 保留内容拆解、证据和来源归属的结构化约束；新增人定选题与受众、参考候选展示、逐项人工保留/排除状态，以及制作单生成前的确认门。移除热点分析状态与账号运营前提。 |
| `server/schemas/draft.schema.json` | 母版 MIT | `content/schemas/draft.schema.json` | 保留标题、正文、标签、逐页内容与编辑说明；把原 1—6 张 `imageCards` 改成 3—5 页制作单，读者文案与视觉/画布指引分栏，并要求引用只来自人工保留的来源。移除 `characterAction` 和角色资产前提。 |
| `server/schemas/humanize.schema.json` | 母版 MIT | `content/schemas/humanize.schema.json` | 保留中文润色、诊断、修订记录与人工审批结构；改为接收用户回传的最终图、仅在顺序不清时提问，并追溯已选来源。 |
| `server/schemas/revise.schema.json` | 母版 MIT | 无独立副本 | 检查过该 schema。它与 `humanize` 共用逐页改写和视觉方向字段，并强制绑定品牌角色与 `assetMode`；一期的人在画布自由制作及终稿回读由 `draft` 与 `humanize` 两个阶段覆盖，不单独迁入该账号/角色编辑流程。 |
| `.agents/skills/lingzao/playbooks/single-note-breakdown-workflow.md` 与 `draft-rewrite-and-benchmark-workflow.md` | Lingzao 子组件 MIT-0 | `content/guides/lingzao-reference-analysis.md` | 只保留有来源证据的内容拆解、可迁移规律、不可照搬边界和转成逐页方案的方法。新增必须先展示素材候选、再等人工逐项筛选的项目流程。 |
| `.agents/skills/humanized-chinese-writing-polisher/SKILL.md`、`references/anti_ai_flavor_rules.md`、`references/quality_checklist.md` | MIT | `content/guides/chinese-copy-polisher.md` | 保留保原意、改自然中文、去套话/翻译腔和输出前自检的方法；收窄为小红书制作单及最终图片文案校准，增加业务口径与广告承诺不得臆造的约束。 |

以上两个指南是针对本项目的改编内容，不包含母版的完整 Skill，也不要求安装 Lingzao、调用其 API、搜索公共内容、读取账号或启动浏览器。`.agents/skills/lingzao/` 中列出的账号分析、热点发现、选题推荐、故事线、平台发布及图像服务不进入本工作台生产链。

## 来源人工核对流程

在任何历史素材进入制作单前，工作流先显示拟用文档的标题、ID、摘要、预览和下载入口、拟借鉴点及事实风险；用户逐项保留或排除。只有保留 ID 可用于后续分析和制作单。排除项不可作为内容依据；即使检索结果排名较高也不自动采用。候选材料的摘要和元数据可以用于向用户说明候选情况，但不替代阅读证据。

制作单中的每项历史事实或结构观察都归属到来源 ID，并说明实际阅读范围。现行课程、价格、活动和业务承诺只按当前内部资料核实。用户上传资料、用户要求、编辑建议和待核实事项应与历史参考分开标记。

## 许可文件

- 母版自身许可见项目根目录 [`LICENSE`](../LICENSE)。本项目继续沿用并保留母版 MIT 许可，不把依赖的子组件许可合并或替换。
- Lingzao 子组件使用 MIT No Attribution / MIT-0；许可副本保存在 [`content/licenses/lingzao-MIT-0.txt`](../content/licenses/lingzao-MIT-0.txt)。保留本说明和指南内的来源归属，便于追溯改编来源。
- 中文写作润色 Skill 使用 MIT，许可副本和原始版权/许可声明保存在 [`content/licenses/humanized-chinese-writing-polisher-MIT.txt`](../content/licenses/humanized-chinese-writing-polisher-MIT.txt)。

## 运行依赖

内容文件、JSON Schema 和改编指南不增加 npm 运行依赖。共享制作单校验器 [`content/validate-production-sheet.mjs`](../content/validate-production-sheet.mjs) 只使用 Node.js 内置能力；其聚焦测试位于同目录。该校验器验证本项目当前 `draft.schema.json` 的生产约束以及制作单引用是否属于持久状态中已确认保留的来源，不需要将素材库候选的完整内容复制进制作单。

## 定点来源链接

- [母版拆解 schema](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/server/schemas/deconstruct.schema.json)
- [母版初稿 schema](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/server/schemas/draft.schema.json)
- [母版终稿润色 schema](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/server/schemas/humanize.schema.json)
- [母版修订 schema（已检查，不单独迁移）](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/server/schemas/revise.schema.json)
- [母版单篇拆解 playbook](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/.agents/skills/lingzao/playbooks/single-note-breakdown-workflow.md)
- [母版改写 playbook](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/.agents/skills/lingzao/playbooks/draft-rewrite-and-benchmark-workflow.md)
- [母版中文润色 Skill](https://github.com/EthanYoQ/agent-xiaohongshu-workbench/blob/6e58278984cb891524ead60c9a5f116b6561b4cc/.agents/skills/humanized-chinese-writing-polisher/SKILL.md)
