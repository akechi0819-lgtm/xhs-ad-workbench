# 母版状态与归档代码迁移

来源仓库：[EthanYoQ/agent-xiaohongshu-workbench](https://github.com/EthanYoQ/agent-xiaohongshu-workbench)，固定提交 `6e58278984cb891524ead60c9a5f116b6561b4cc`，许可见本目录上级的 `LICENSE`。

| 母版文件 | 本项目文件 | 调整原因 |
| --- | --- | --- |
| `server/default-state.mjs`、`server/workspace-editor.mjs` | `src/task-state.mjs` | 保留任务进度、人工编辑与确认的持久化机制；改为一个线程一个任务，新增参考候选和人工保留/排除状态，去除内容账号、热点、角色、故事线与发布状态。 |
| `server/output-archive.mjs` | `src/output-archive.mjs` | 保留版本化输出和图片复制机制；按任务保存最终图片、文案、来源及 manifest，并让人工审批状态同步写入归档。 |
| `server/agent-runner.mjs` | 当前不整体迁移 | 母版直接调用 `codex exec`，且同文件承担热点研究、角色生图、渲染与发布。双客户端由当前对话执行模型步骤，项目共享任务校验与落盘，不引入第二套运行平台。 |

母版 `server/index.mjs`、`src/App.jsx`、`desktop/`、OpenCLI 研究和发布链路不进入一期。后续只在双端实测表明集中审核需要界面时，重新评估前端裁剪范围。
