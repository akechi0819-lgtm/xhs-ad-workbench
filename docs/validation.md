# 一期验收记录（2026-09-26）

## 已完成的本地验证

- 独立分享包已包含只读 Teedy MCP、Python 安装器与两个互不覆盖的技能。公开别名文件为空，不带公司特定品牌和校区词。`npm run test:mcp-package` 的隔离用户目录测试 6 项通过；该测试不安装依赖、不连接 Teedy，也不读取真实员工配置。

- `npm test`：12 项通过。覆盖人工来源筛选、无来源时明确确认、排除来源拦截、3—5 页结构、三个 schema 的 JSON 解析与 Codex schema 生成、单线程单任务、成品图顺序与归档审批状态。命令行集成测试从两份模拟参考候选推进至最终图片、文案、待审素材包和批准，核对输出图片、实际使用来源、制作单与 manifest。
- `npm run self-check`：项目必要文件齐全。
- 技能安装脚本以临时 `HOME` 对 Codex 与 WorkBuddy 两种目标目录分别执行，两个落盘 `SKILL.md` 与项目源文件逐字一致。未改动员工真实用户目录。
- Codex CLI 使用 `gpt-6-sol`、`model_reasoning_effort="medium"`、只读沙箱从项目目录读取文件，正确说明了“候选展示 → 人工保留/排除 → `select --human-confirmed` → 制作单校验保存”的流程。该次 CLI 输出曾提示本机模型元数据未找到，使用了回退元数据；不能据此断言所有员工环境的模型配置相同。
- Codex CLI 对一个完全虚构、无历史来源的主题实际生成了 3 页制作单；生成结果经 `validateProductionSheet` 校验通过，来源 ID 为空。初次直接传完整 JSON Schema 时，接口拒绝 `uniqueItems`；现用 `scripts/build-codex-schema.mjs` 生成受支持的输出结构，业务规则继续由本地校验器执行。结构化输出支持部分 JSON Schema 关键字的限制见[官方文档](https://developers.openai.com/api/docs/guides/structured-outputs)。
- 上游内容指南的 MIT 与 MIT-0 许可副本已按固定提交逐字核对。移植范围见 `upstream-content.md` 与 `upstream-state.md`。

## 待实机验证

- 用户已明确将 WorkBuddy 端技能、文件读写及素材 MCP 联通验收后置；待并行进行的普通员工 MCP 测试完成后，再做一次完整端到端测试。本次 Computer Use 只读查看 WorkBuddy AI 界面曾被自动审批拒绝，返回“Computer Use was not approved to use WorkBuddy AI”。临时目录的技能复制测试不等于 WorkBuddy 应用验收。
- Codex CLI 已验证读取与流程理解，但尚未在正式用户技能目录安装并从新任务检验自动技能发现。该步骤需要真实安装后新开任务。
- 普通员工 `$素材库MCP` 的 WorkBuddy 验证由并行测试完成后补入；本轮没有调用素材 MCP。后续一次端到端验收依次核对真实素材检索、结构化文档与预览图片、人工筛选、制作单、现有无限画布产图、最终图片回读和发布文案校准。当前集成测试的图片是本地测试夹具，不能替代画布往返与图片理解验收。

上述待验项完成前，一期不能标为双端验收通过。
