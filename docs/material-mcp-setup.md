# 素材库 MCP 安装说明

本分享包包含只读 Teedy MCP、Python 依赖清单、安装器和“素材库MCP”技能。每位使用者都用自己的 Teedy Reader 或 ADMIN 账号配置；安装过程不会搜索或下载素材。

## 环境要求

- Python 3.10 或更新版本，并带 `venv` 和 `pip`。
- 能访问自己 Teedy 服务的 HTTPS 地址。
- Codex 安装需要终端可运行 `codex` CLI；WorkBuddy 安装由安装器写入用户级配置。

## 安装

在下载后的工作台根目录打开交互终端，按使用的客户端运行一条命令：

```bash
python3 scripts/install_material_mcp.py --client codex
```

或：

```bash
python3 scripts/install_material_mcp.py --client workbuddy
```

安装器会把只读 MCP 文件复制到用户数据目录，再在那里创建独立 Python 环境并安装 `requirements-mcp.txt`。随后在终端输入 Teedy HTTPS 地址和用户名；密码由隐藏提示读取，不回显，也不会作为命令参数传递。安装器验证账号登录和只读访问权限后，保存本机凭据、注册 MCP，并安装“素材库MCP”技能。安装过程不调用素材检索工具。

Teedy 地址和凭据不会写入工作台目录、任务文件、Agent 对话或客户端配置中的明文值。Unix 系统的凭据文件权限限制为仅当前用户可读写。不要将本机配置目录打包或提交 Git。

## 安装工作台技能

MCP 安装器只安装“素材库MCP”技能。还要在工作台根目录单独安装“xhs-ad-workbench”技能：

```bash
npm run install:codex
```

或：

```bash
npm run install:workbuddy
```

两个技能有不同名称和安装目录，安装器不会互相覆盖。完成后在客户端新开任务，并把下载的工作台目录作为工作目录。

## 客户端首次连接

Codex 用户新开任务后检查 MCP 列表中是否出现 `material-library`。

WorkBuddy 用户需要在「专家·技能·连接器 → 连接器 → 自定义连接器」信任并启用 `material-library`，确认出现四个只读工具，再新开任务。客户端版本不同，界面名称可能变化。

仅当用户**本轮明确写下 `$素材库MCP`** 时，才允许检索。比如：

```text
$素材库MCP 请按“[Teedy 当前标签名]”检索，并列出候选摘要、预览和下载入口。
```

检索先调用 `list_tags`，并使用 Teedy 实际返回的标签名。公开分享包的 `mcp_server/tag_aliases.json` 是空映射，不包含品牌、校区或项目别名；可直接按 Teedy 标签名和关键词搜索。预览和下载链接受 Teedy 登录及权限保护。

## 本机数据位置

MCP 安装程序和虚拟环境位于用户数据目录，Teedy 凭据位于用户配置目录：

| 系统 | MCP 程序与虚拟环境 | 凭据文件 |
| --- | --- | --- |
| macOS | `~/Library/Application Support/material-library-mcp/` | `~/Library/Application Support/material-library-mcp/teedy.env` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/material-library-mcp/` | `${XDG_CONFIG_HOME:-~/.config}/material-library-mcp/teedy.env` |
| Windows | `%LOCALAPPDATA%\material-library-mcp\` | `%APPDATA%\material-library-mcp\teedy.env` |

通过 `download_file` 下载的附件保存在 MCP 用户数据目录下的 `runs/mcp_downloads/`。这些附件和配置都留在本机，不属于公开分享包。

## 故障处理

- 安装器必须在交互终端运行；不要通过 Agent 对话发送密码。
- 若提示 `Codex CLI was not found`，先安装 Codex CLI 并让当前终端找到 `codex` 命令，再重跑 Codex 安装器。
- 若账号验证失败，确认地址为可访问的远端 HTTPS URL，账号是 Teedy Reader 或 ADMIN，并具有读取权限。
- 若 WorkBuddy 提示连接未信任，回到自定义连接器信任并启用 `material-library`。
- 安装成功不代表双端已完成实机验收；先在新任务中确认技能与连接器已加载，再按触发词规则工作。

## 分享包维护检查

维护者可以运行下面的离线检查。单元测试用临时 HOME 验证安装落点与配置合并；不会安装 Python 依赖、读取真实用户配置或连接 Teedy。

```bash
npm run self-check
npm run test:mcp-package
```
