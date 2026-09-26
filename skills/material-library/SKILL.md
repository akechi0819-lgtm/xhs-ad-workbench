---
name: 素材库MCP
description: >
  使用素材库MCP检索远端 Teedy 素材。仅在用户明确写下 $素材库MCP 时调用；
  单独提到小红书、考试或素材不构成检索授权。
---

# 素材库MCP

只在用户本轮明确写下 `$素材库MCP` 时检索。未出现触发词就不要调用素材库工具。

MCP 使用当前配置的 Teedy Reader 或 ADMIN 账号。MCP 工具只检索、查看、预览和下载；不要通过 MCP 上传素材、改标签或删除文档。`get_material` 返回的 `writable` 表示 Teedy 对该账号的 ACL，不代表 MCP 提供写工具。

## 检索流程

1. 调用 `list_tags`，将用户说法与 Teedy 当前返回的标签 `name` 对齐。公开分享包不含业务专属别名；不要自行猜测未列出的别名。
2. 调用 `search_materials`；标签优先，关键词补充。
3. 需要更多细节时调用 `get_material`。
4. 返回素材时给出预览、单文件下载链接和 `zip_url`。用户点击链接前须在浏览器登录同一远端 Teedy；需要把文件保存到本机时调用 `download_file`。

不得编造素材或生成新文案。当前标签仍以 Teedy 中实际返回的名称为准。
