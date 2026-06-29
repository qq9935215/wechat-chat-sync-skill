# First Use And Platform Notes

## What is verified

The macOS flow was verified on this machine with WeChat 4.1.7 and `jackwener/wx-cli` 0.3.0. The reliable path was:

1. Use `wx-cli`, not the older `wechat-cli`.
2. Use `wx history "<chat>" --json --with-meta`, not `wx export`.
3. Use a short private runtime home to avoid macOS Unix socket path limits.
4. If multiple WeChat account folders exist, select the account whose `db_storage/message` directory has the latest modification time, unless the user specifies another account.
5. Keep runtime key/config outside the knowledge base.

## macOS first setup

WeChat local databases are encrypted. `wx-cli` extracts database keys by reading the local running WeChat process. On macOS this may require ad-hoc signing WeChat with `get-task-allow`.

Side effects to explain once:

- It does not delete chat records.
- It changes the local app signature of `/Applications/WeChat.app`.
- macOS may later show prompts like "微信想访问其他 App 的数据".
- Reinstalling official WeChat restores the official signature.
- After WeChat updates, setup may need to be rerun.

Avoid repeatedly quitting/restarting WeChat. Only sign/restart during first setup or when setup cannot read keys.

## Windows status

`wx-cli` exposes a Windows binary and scans `Weixin.exe`. This skill's wrapper script detects Windows account directories by reading `%APPDATA%\Tencent\xwechat\config\*.ini`, resolving the configured data root, then looking for `xwechat_files\<wxid>\db_storage`. For Windows:

- Keep WeChat open and logged in before running `setup`, `chats`, or `sync`.
- Use Administrator PowerShell when memory access fails.
- If no sessions are listed, distinguish these causes: WeChat is not logged in, the Windows xwechat config file is absent, memory scanning lacks permission, or the selected account has no readable `db_storage`.
- Keep the same state/dedupe rules.
- Windows support is implemented in the wrapper, but each Windows machine still needs first-run verification because WeChat storage paths and permissions can differ.

## Incremental safety

Never decide "already synced" from time alone. Use separate state per chat and use both:

- A checkpoint: latest `timestamp` and `local_id`
- A fingerprint set: `chat identity + local_id + timestamp + sha256(content)`

Use a lookback window, default 24 hours, so messages with close timestamps or delayed writes are not missed. Deduping prevents repeated imports.

## Incremental versus full scan

Use `--mode incremental` by default. It continues from the last checkpoint with a lookback window, then dedupes by fingerprint.

Use `--mode full` only when the user explicitly asks to pull all history, rescan from the beginning, or fill possible gaps. Full mode should scan all available local history for the selected chat, but it must still use the same fingerprint state and skip already imported messages. Full mode is not permission to duplicate existing Markdown content.

On first use, incremental mode has no prior state, so it creates the baseline from the fetched history. That is usually enough for non-technical users unless they specifically ask for a full rescan later.

## Output location

Do not assume the user has a folder named "第二大脑". Prefer explicit `--vault` or `--output-root`. If none is provided, auto-detect common local knowledge-base folder names under `~/Documents` only when exactly one candidate exists. If detection is ambiguous or absent, use the current workspace `work/wechat-chat-sync-preview/微信聊天记录` and report it as a temporary preview, not the final knowledge-base location.

## Chat selection

For `filehelper`, `--chat-username filehelper` is stable.

For private chats and group chats, display names are not stable enough for repeatable sync. They can contain emoji, change over time, or collide with another contact/group. Use this flow:

1. Run `chats --limit 50`.
2. Let the user confirm by human-readable `chat`, last time, and summary preview if needed.
3. Sync with `--chat-username <username>`.

For groups, usernames usually end with `@chatroom`; for many private contacts, usernames may start with `wxid_`. Treat the `username` as the durable machine key and the display name only as a label for humans.

If the user did not explicitly ask for 文件传输助手/filehelper, never go straight to `sync --chat-username filehelper`. Run `chats --limit 50` and present choices first. If `chats` cannot list sessions, fix setup/login/permission first instead of defaulting to filehelper.
