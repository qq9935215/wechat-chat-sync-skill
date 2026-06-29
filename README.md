# wechat-chat-sync Skill

这是一个 Codex Skill，用来把本机微信聊天记录同步到本地 Markdown 知识库。

核心能力：

- 支持文件传输助手、私聊、群聊。
- 默认增量同步，只拉新增内容。
- 可选全量扫描，但仍会去重，避免重复写入。
- 优先用微信内部 `username` 选择聊天对象，避免群名、昵称、表情导致识别不准。
- 找不到明确知识库目录时，只写入当前工作区临时预览目录。

## 安装

把仓库里的 `wechat-chat-sync` 文件夹复制到本机 Codex 技能目录：

```bash
mkdir -p ~/.codex/skills
cp -R wechat-chat-sync ~/.codex/skills/wechat-chat-sync
```

安装后，在 Codex 里可以这样触发：

```text
使用 $wechat-chat-sync 帮我同步微信聊天记录
```

也可以说：

```text
帮我导出微信聊天记录到知识库，只拉新增
帮我同步微信文件传输助手，全量扫一遍
帮我同步某个微信群聊到 Obsidian
```

## 隐私说明

这个仓库只包含 Skill 规则和本地同步脚本，不包含微信聊天记录、数据库密钥、账号数据或导出结果。

同步过程默认只在本机运行，不会上传微信数据。用户应只同步自己有权处理的聊天记录。

## 平台状态

macOS 流程已验证。Windows 已补充账号目录检测逻辑，会读取 `%APPDATA%\Tencent\xwechat\config\*.ini` 来定位本机微信数据；Windows 首次使用前需要保持微信打开并已登录，必要时用管理员 PowerShell 运行。

## Skill 本体

真正的 Codex Skill 在：

```text
wechat-chat-sync/
```

其中：

- `SKILL.md`：触发描述和执行规则。
- `scripts/wechat_chat_sync.mjs`：本地同步脚本。
- `references/first-use-and-platforms.md`：首次使用、Mac/Windows、聊天选择等补充说明。
- `agents/openai.yaml`：Codex 界面显示信息。
