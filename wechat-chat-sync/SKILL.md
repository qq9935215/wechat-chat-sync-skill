---
name: wechat-chat-sync
description: Incrementally or fully sync local WeChat chats and 微信聊天记录 into a Markdown knowledge base without duplicate imports. Use when the user asks to 导出微信聊天记录, 同步微信聊天记录, 拉取微信聊天记录, 更新微信记录, 拉全部微信聊天记录, 只拉新增微信聊天记录, maintain WeChat chat records for Obsidian, a local knowledge base, 第二大脑, 文件传输助手/filehelper, 微信文件传输助手, private chats, 私聊, group chats, 群聊, first-time setup, later incremental updates, full scan, deduplication, or cross-computer reuse.
---

# WeChat Chat Sync

## Purpose

Use this skill to turn local WeChat chats into repeatable Markdown knowledge-base inboxes. Default behavior is incremental: read one target chat, skip already-imported messages, append only new messages to Markdown, and update sync state only after writing succeeds.

## Core Rules

- Communicate with the user in Chinese.
- Treat the current computer as local-only; do not upload WeChat data.
- Default to `filehelper` / `文件传输助手`, but accept other private chats, group chats, or sessions.
- Prefer `--chat-username <username>` for stable chat selection. Use `--chat <显示名>` only for quick attempts or when the name is unambiguous.
- If the target is not `filehelper`, first list sessions with `chats` or `sessions` and select the row by its stable `username`, not by display name. Display names can contain emoji, change over time, or collide.
- Prefer `wx history "<chat>" --json --with-meta` over `wx export`; `wx export` can fail even when `history` works.
- Keep keys/config in a private runtime directory, not in the knowledge base.
- Do not invent a permanent knowledge-base folder. If no explicit or unique knowledge-base location is available, write only to a temporary preview folder in the current workspace.
- Do not delete WeChat data. Do not modify global WeChat signing unless needed for first-time setup or after WeChat update, and explain the side effect first.
- Always preserve and use sync state. Never rely only on memory or "last time".
- Default to incremental mode: `--mode incremental`, meaning continue from the previous sync and append only new messages.
- If the user asks to "拉全部", "全量", "从头扫一遍", or wants to fill possible gaps, use `--mode full`. Full mode scans all available local history but still uses fingerprints to skip records already imported.

## Scripts

Primary script:

```bash
SCRIPT="<this skill folder>/scripts/wechat_chat_sync.mjs"
node "$SCRIPT" status
node "$SCRIPT" setup
node "$SCRIPT" chats --limit 50
node "$SCRIPT" sessions
node "$SCRIPT" sync --chat-username filehelper
node "$SCRIPT" sync --chat-username filehelper --mode full
```

Useful options:

- `--vault <path>`: second-brain vault root.
- `--output-root <path>`: exact Markdown archive root.
- `--chat-username <username>`: stable WeChat username from `chats` / `sessions`; preferred for private chats and group chats.
- `--chat <name>`: chat display name, remark name, group name, or username. Use only when unambiguous. Default `filehelper`.
- `--runtime-home <path>`: private wx-cli runtime home. Keep short on macOS.
- `--account-dir <path>`: exact `xwechat_files/<wxid>` account directory.
- `--lookback-hours <n>`: overlap window for dedupe, default 24.
- `--limit <n>`: max messages fetched from wx history, default 100000.
- `--mode incremental|full`: choose update mode. `incremental` is default and continues from the previous sync; `full` scans all available local history while still deduping.
- `--full`: alias for `--mode full`.
- `--auto-sign`: macOS only, allow the script to ad-hoc sign WeChat when needed.
- `--force-init`: rescan WeChat database keys; use after WeChat updates or key/config errors.

## First-Time Workflow

When the user is using this skill for the first time on a computer, set a single ALGO-style goal:

> Complete local WeChat incremental sync setup on this computer: install or locate wx-cli, prepare local permissions, select the active WeChat account, list available sessions if needed, import the requested chat once, write sync state, and make later syncs incremental.

Then run:

```bash
SCRIPT="<this skill folder>/scripts/wechat_chat_sync.mjs"
node "$SCRIPT" setup
node "$SCRIPT" sync --chat-username filehelper --mode incremental
```

On the first run, incremental mode has no previous state, so it imports the fetched history and creates the baseline state. Later runs continue from that state.

For a private chat or group chat, do not ask the user to type an emoji-heavy display name. List sessions and pick the stable `username`:

```bash
SCRIPT="<this skill folder>/scripts/wechat_chat_sync.mjs"
node "$SCRIPT" chats --limit 50
node "$SCRIPT" sync --chat-username "<username>"
```

If setup fails on macOS with `task_for_pid` or zero keys:

1. Explain that WeChat local databases are encrypted and key extraction needs local process access.
2. Explain that ad-hoc signing may cause macOS prompts like "微信想访问其他 App 的数据"; reinstalling official WeChat restores the official signature.
3. Run setup again with `--auto-sign` only after this explanation:

```bash
SCRIPT="<this skill folder>/scripts/wechat_chat_sync.mjs"
node "$SCRIPT" setup --auto-sign
```

On Windows, run setup from Administrator PowerShell if memory scanning fails. This skill includes Windows path handling, but macOS is the verified platform from this machine.

## Incremental Workflow

For later updates, use incremental mode unless the user explicitly asks for full/all history. Run:

```bash
SCRIPT="<this skill folder>/scripts/wechat_chat_sync.mjs"
node "$SCRIPT" sync --chat-username "<username>" --mode incremental
```

The script should:

1. Load previous state.
2. Fetch target chat history with an overlap window.
3. Compute stable fingerprints from `username + local_id + timestamp + content hash`.
4. Append only unseen messages to monthly Markdown files.
5. Update state only after successful write.
6. Report fetched, new, duplicate, and output path.

## Full Scan Workflow

If the user chooses full/all history, run:

```bash
SCRIPT="<this skill folder>/scripts/wechat_chat_sync.mjs"
node "$SCRIPT" sync --chat-username "<username>" --mode full
```

Full mode should:

1. Fetch all available local history for the target chat without the last-sync `--since` checkpoint.
2. Still compare every message against the existing fingerprint state.
3. Append only records that are not already imported.
4. Update the same state after successful write.
5. Report clearly: "全量扫描已读取 N 条，其中新增 X 条，跳过重复 Y 条".

## Default Paths

- Default vault: choose `--vault` when provided; otherwise auto-detect exactly one common local knowledge-base folder under `~/Documents`; otherwise use a temporary preview folder.
- Default output root: `<vault>/00 Notes/00 Inbox 收件箱/微信聊天记录` when that inbox exists; otherwise `<vault>/微信聊天记录`; otherwise `<cwd>/work/wechat-chat-sync-preview/微信聊天记录`.
- Default state: `<output root>/_sync_state/<chat-slug>_sync_state.json`.
- Default private runtime home: `~/.wxfs` on macOS/Linux, `%USERPROFILE%\\.wxfs` on Windows.
- If no knowledge-base folder is detected, or multiple possible folders are detected, do not invent "第二大脑" or pick one silently. Write under the current workspace `work/wechat-chat-sync-preview/微信聊天记录` and report that it is temporary.
- Permanent imports should use explicit `--vault <path>` or `--output-root <path>` once the user confirms where the knowledge base lives.

## Reporting

After setup or sync, report:

- 本次读取多少条
- 新增多少条
- 跳过重复多少条
- 文件写到哪里
- 如果是临时预览目录，要明确说“这还不是正式知识库目录”
- 状态是否更新
- 用户如何自己验证

Keep routine reports short. Read `references/first-use-and-platforms.md` when explaining first-time setup, macOS signing, or Windows differences.
