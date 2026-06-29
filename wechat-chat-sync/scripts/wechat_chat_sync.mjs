#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const WX_CLI_VERSION = '0.3.0';
const command = process.argv[2] || 'status';
const args = process.argv.slice(3);

function argValue(name, fallback = '') {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function exists(p) {
  return Boolean(p) && fs.existsSync(p);
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function run(cmd, cmdArgs, options = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    stdio: options.stdio || 'pipe',
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
  });
  if (options.check !== false && res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    const stdout = (res.stdout || '').trim();
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${res.status})\n${stderr || stdout}`);
  }
  return res;
}

function shellWhich(bin) {
  const cmd = process.platform === 'win32' ? 'where' : 'command';
  const cmdArgs = process.platform === 'win32' ? [bin] : ['-v', bin];
  const res = run(cmd, cmdArgs, { check: false });
  if (res.status === 0) return res.stdout.split(/\r?\n/).filter(Boolean)[0]?.trim();
  return '';
}

function platformPackage() {
  const key = `${process.platform}-${process.arch}`;
  const map = {
    'darwin-arm64': '@jackwener/wx-cli-darwin-arm64',
    'darwin-x64': '@jackwener/wx-cli-darwin-x64',
    'linux-x64': '@jackwener/wx-cli-linux-x64',
    'linux-arm64': '@jackwener/wx-cli-linux-arm64',
    'win32-x64': '@jackwener/wx-cli-win32-x64',
  };
  if (!map[key]) throw new Error(`Unsupported platform for bundled wx-cli install: ${key}`);
  return map[key];
}

function resolveVaultInfo() {
  const explicit = expandHome(argValue('--vault', ''));
  if (explicit) {
    return { root: explicit, mode: 'explicit-vault', reason: '--vault provided' };
  }
  const docs = path.join(os.homedir(), 'Documents');
  const names = [
    '第二大脑',
    '第三大脑',
    '第五大脑',
    '知识库',
    '个人知识库',
    'Second Brain',
    'Obsidian',
    'Knowledge Base',
  ];
  const matches = names.map(n => path.join(docs, n)).filter(exists);
  if (matches.length === 1) {
    return { root: matches[0], mode: 'auto-detected-vault', reason: 'one common knowledge-base folder found under ~/Documents' };
  }
  return {
    root: path.join(process.cwd(), 'work', 'wechat-chat-sync-preview'),
    mode: 'temporary-preview',
    reason: matches.length > 1
      ? `ambiguous knowledge-base folders: ${matches.join(', ')}`
      : 'no common knowledge-base folder found',
  };
}

function resolveChatSelection() {
  const username = argValue('--chat-username', argValue('--username', ''));
  if (username) return { target: username, mode: 'stable-username' };
  const chat = argValue('--chat', argValue('--chat-name', ''));
  if (chat) return { target: chat, mode: 'display-or-username' };
  return { target: 'filehelper', mode: 'default-filehelper' };
}

const chatSelection = resolveChatSelection();
const targetChat = chatSelection.target;
const explicitOutputRoot = expandHome(argValue('--output-root', ''));
const vaultInfo = explicitOutputRoot
  ? { root: '', mode: 'explicit-output-root', reason: '--output-root provided' }
  : resolveVaultInfo();
function defaultOutputRoot() {
  if (vaultInfo.mode === 'temporary-preview') {
    return path.join(vaultInfo.root, '微信聊天记录');
  }
  const inbox = path.join(vaultInfo.root, '00 Notes', '00 Inbox 收件箱');
  if (exists(inbox)) return path.join(inbox, '微信聊天记录');
  return path.join(vaultInfo.root, '微信聊天记录');
}
const outputRoot = explicitOutputRoot || defaultOutputRoot();
const outputMode = explicitOutputRoot ? 'explicit-output-root' : vaultInfo.mode;
const stateDir = path.join(outputRoot, '_sync_state');
function slug(input) {
  const raw = String(input || 'chat')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'chat';
  return `${raw}-${sha256(String(input || 'chat')).slice(0, 10)}`;
}
const chatSlug = slug(targetChat);
const statePath = expandHome(argValue('--state', path.join(stateDir, `${chatSlug}_sync_state.json`)));
const runtimeHome = expandHome(argValue(
  '--runtime-home',
  process.platform === 'win32'
    ? path.join(os.homedir(), '.wxfs')
    : path.join(os.homedir(), '.wxfs'),
));
const lookbackHours = Number(argValue('--lookback-hours', '24'));
const limit = Number(argValue('--limit', '100000'));
const sessionLimit = Number(argValue('--session-limit', argValue('--limit', '50')));
const syncMode = (() => {
  const requested = argValue('--mode', argValue('--sync-mode', hasFlag('--full') ? 'full' : 'incremental'));
  if (!['incremental', 'full'].includes(requested)) {
    throw new Error(`Invalid sync mode: ${requested}. Use --mode incremental or --mode full.`);
  }
  return requested;
})();

function readJson(p, fallback) {
  if (!exists(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJsonAtomic(p, data) {
  mkdirp(path.dirname(p));
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

function state() {
  return readJson(statePath, {
    version: 1,
    chat: targetChat,
    username: targetChat,
    imported: {},
    importedCount: 0,
    lastSyncedTimestamp: 0,
    lastSyncedLocalId: 0,
    lastRunAt: '',
    outputFiles: [],
  });
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
}

function fingerprint(m, identity = targetChat) {
  return [
    identity,
    m.local_id ?? '',
    m.timestamp ?? '',
    sha256(m.content ?? ''),
  ].join('|');
}

function monthFromTime(time) {
  const match = String(time || '').match(/^(\d{4})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}`;
  return new Date().toISOString().slice(0, 7);
}

function safeLine(s) {
  return String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function formatMarkdownMessage(m) {
  const content = safeLine(m.content) || '(空内容或非文本内容)';
  return [
    `## ${m.time || ''}`,
    '',
    `- 发送者：${m.sender || ''}`,
    `- 类型：${m.type || ''}`,
    `- 本地 ID：${m.local_id ?? ''}`,
    '',
    content,
    '',
  ].join('\n');
}

function appendMessages(messages) {
  const grouped = new Map();
  for (const m of messages) {
    const ym = monthFromTime(m.time);
    if (!grouped.has(ym)) grouped.set(ym, []);
    grouped.get(ym).push(m);
  }
  const written = [];
  for (const [ym, list] of grouped) {
    const chatName = list[0]?._chatDisplay || targetChat;
    const file = path.join(outputRoot, `${ym}-${slug(chatName).replace(/-[0-9a-f]{10}$/, '')}.md`);
    mkdirp(path.dirname(file));
    if (!exists(file)) {
      fs.writeFileSync(file, [
        `# ${ym} ${chatName}`,
        '',
        '来源：本机微信聊天记录增量同步',
        '',
        '---',
        '',
      ].join('\n'), 'utf8');
    }
    const body = list.map(formatMarkdownMessage).join('\n');
    fs.appendFileSync(file, `\n${body}`, 'utf8');
    written.push(file);
  }
  return [...new Set(written)];
}

function realHome() {
  return os.homedir();
}

function macWechatBase() {
  return path.join(realHome(), 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files');
}

function candidateAccountDirs() {
  if (process.platform === 'darwin') {
    const base = macWechatBase();
    if (!exists(base)) return [];
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => path.join(base, d.name))
      .filter(d => exists(path.join(d, 'db_storage')));
  }
  return [];
}

function accountMtime(accountDir) {
  const targets = [
    path.join(accountDir, 'db_storage/message'),
    path.join(accountDir, 'db_storage'),
  ];
  for (const t of targets) {
    try {
      return fs.statSync(t).mtimeMs;
    } catch {}
  }
  return 0;
}

function selectAccountDir() {
  const provided = expandHome(argValue('--account-dir', ''));
  if (provided) {
    if (!exists(path.join(provided, 'db_storage'))) {
      throw new Error(`--account-dir must point to xwechat_files/<wxid>; missing db_storage: ${provided}`);
    }
    return provided;
  }
  const dirs = candidateAccountDirs().sort((a, b) => accountMtime(b) - accountMtime(a));
  if (!dirs.length) throw new Error('No WeChat account dir found. Start WeChat first.');
  return dirs[0];
}

function runtimeEnv() {
  const env = { ...process.env, HOME: runtimeHome };
  if (process.platform === 'win32') env.USERPROFILE = runtimeHome;
  return env;
}

function prepareRuntimeHome(accountDir) {
  mkdirp(runtimeHome);
  if (process.platform !== 'darwin') return;
  const destBase = path.join(runtimeHome, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files');
  mkdirp(destBase);
  const link = path.join(destBase, path.basename(accountDir));
  if (exists(link)) {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() || st.isDirectory()) fs.rmSync(link, { recursive: true, force: true });
  }
  fs.symlinkSync(accountDir, link, 'dir');
}

function ensureWxBinary() {
  const explicit = expandHome(argValue('--wx-bin', process.env.WX_CLI_BINARY || ''));
  if (explicit && exists(explicit)) return explicit;
  const pathWx = shellWhich(process.platform === 'win32' ? 'wx.exe' : 'wx');
  if (pathWx) return pathWx;

  const toolDir = path.join(runtimeHome, 'tools', `wx-cli-${WX_CLI_VERSION}`);
  const wxName = process.platform === 'win32' ? 'wx.exe' : 'wx';
  const installed = path.join(toolDir, 'package', 'bin', wxName);
  if (exists(installed)) return installed;

  const npm = shellWhich(process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (!npm) {
    throw new Error('Cannot find wx binary or npm. Install Node/npm or pass --wx-bin.');
  }
  mkdirp(toolDir);
  const pkg = platformPackage();
  run(npm, ['pack', `${pkg}@${WX_CLI_VERSION}`], { cwd: toolDir, stdio: 'inherit' });
  const tgz = fs.readdirSync(toolDir).find(f => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack did not produce tgz in ${toolDir}`);
  run('tar', ['-xzf', tgz], { cwd: toolDir, stdio: 'inherit' });
  if (process.platform !== 'win32') fs.chmodSync(installed, 0o755);
  return installed;
}

function macHasGetTaskAllow() {
  if (process.platform !== 'darwin') return true;
  const res = run('sh', ['-lc', "codesign -d --entitlements :- /Applications/WeChat.app 2>/dev/null | plutil -p - 2>/dev/null | grep -q 'get-task-allow'"], { check: false });
  return res.status === 0;
}

function macAutoSignIfRequested() {
  if (process.platform !== 'darwin' || macHasGetTaskAllow()) return;
  if (!hasFlag('--auto-sign')) {
    throw new Error('macOS WeChat is not prepared for memory scan. Rerun setup with --auto-sign after explaining the signing side effect.');
  }
  const plist = path.join(runtimeHome, 'wechat_min_entitlements.plist');
  mkdirp(runtimeHome);
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>\n`, 'utf8');
  run('osascript', ['-e', 'tell application "WeChat" to quit'], { check: false });
  run('sh', ['-lc', 'sleep 5; killall WeChat >/dev/null 2>&1 || true'], { check: false });
  run('sudo', ['codesign', '--force', '--deep', '--sign', '-', '--entitlements', plist, '/Applications/WeChat.app'], { stdio: 'inherit' });
  run('open', ['-a', 'WeChat'], { check: false });
}

function setup() {
  const accountDir = selectAccountDir();
  prepareRuntimeHome(accountDir);
  const wx = ensureWxBinary();
  const keysPath = path.join(runtimeHome, '.wx-cli', 'all_keys.json');
  const existingKeys = readJson(keysPath, {});
  const existingKeyCount = Object.keys(existingKeys).length;
  if (existingKeyCount > 0 && !hasFlag('--force-init')) {
    return { accountDir, wx, keyCount: existingKeyCount, runtimeHome, reused: true };
  }
  macAutoSignIfRequested();
  const initRes = run(wx, ['init', '--force'], { env: runtimeEnv(), stdio: 'pipe', check: false });
  if (initRes.status !== 0) {
    throw new Error(`wx init failed.\n${initRes.stderr || initRes.stdout}`);
  }
  const keys = readJson(keysPath, {});
  const keyCount = Object.keys(keys).length;
  if (keyCount === 0) {
    throw new Error('wx init produced 0 keys. Ensure the correct WeChat account is active; on macOS rerun with --auto-sign if not already prepared.');
  }
  return { accountDir, wx, keyCount, runtimeHome };
}

function fetchHistory(wx) {
  const args = ['history', targetChat, '-n', String(limit), '--with-meta', '--json'];
  const st = state();
  if (syncMode === 'incremental' && st.lastSyncedTimestamp && lookbackHours >= 0) {
    const sinceMs = Math.max(0, (Number(st.lastSyncedTimestamp) * 1000) - lookbackHours * 3600 * 1000);
    const since = new Date(sinceMs).toISOString().slice(0, 10);
    args.push('--since', since);
  }
  const res = run(wx, args, { env: runtimeEnv(), check: false });
  if (res.status !== 0) throw new Error(`wx history ${targetChat} failed.\n${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout);
}

function fetchSessions(wx) {
  const res = run(wx, ['sessions', '-n', String(sessionLimit), '--json', '--with-meta'], { env: runtimeEnv(), check: false });
  if (res.status !== 0) throw new Error(`wx sessions failed.\n${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout);
}

function compactSessions(data) {
  const sessions = Array.isArray(data) ? data : (data.sessions || []);
  return sessions.map((s, index) => ({
    index: index + 1,
    chat: s.chat || '',
    username: s.username || '',
    chat_type: s.chat_type || (s.is_group ? 'group' : 'private'),
    is_group: Boolean(s.is_group),
    last_time: s.time || '',
    timestamp: s.timestamp || 0,
    summary_preview: safeLine(s.summary || '').slice(0, 120),
    sync_with: s.username ? `--chat-username ${s.username}` : '',
  }));
}

function chats() {
  const setupInfo = setup();
  const data = fetchSessions(setupInfo.wx);
  const sessions = compactSessions(data);
  return {
    count: sessions.length,
    selectionRule: 'Use username with --chat-username for stable matching; use chat display name only for human review.',
    sessions,
    meta: data.meta || {},
  };
}

function sync() {
  const setupInfo = setup();
  const data = fetchHistory(setupInfo.wx);
  const messages = data.messages || [];
  const st = state();
  const newMessages = [];
  let duplicates = 0;
  const identity = data.username || data.chat || targetChat;
  for (const m of messages) {
    const fp = fingerprint(m, identity);
    if (st.imported[fp]) {
      duplicates++;
      continue;
    }
    newMessages.push({ ...m, _fingerprint: fp, _chatDisplay: data.chat || targetChat });
  }
  newMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.local_id || 0) - (b.local_id || 0));
  const outputFiles = appendMessages(newMessages);
  for (const m of newMessages) {
    st.imported[m._fingerprint] = {
      timestamp: m.timestamp || 0,
      local_id: m.local_id || 0,
      time: m.time || '',
    };
    st.lastSyncedTimestamp = Math.max(st.lastSyncedTimestamp || 0, m.timestamp || 0);
    st.lastSyncedLocalId = Math.max(st.lastSyncedLocalId || 0, m.local_id || 0);
  }
  st.version = 1;
  st.chat = data.chat || '文件传输助手';
  st.username = data.username || targetChat;
  st.importedCount = Object.keys(st.imported).length;
  st.lastRunAt = new Date().toISOString();
  st.wxCliVersion = WX_CLI_VERSION;
  st.platform = `${process.platform}-${process.arch}`;
  st.runtimeHome = runtimeHome;
  st.outputRoot = outputRoot;
  st.outputFiles = [...new Set([...(st.outputFiles || []), ...outputFiles])];
  st.lastMeta = data.meta || {};
  st.chatSelectionMode = chatSelection.mode;
  st.outputMode = outputMode;
  st.outputPlacementReason = vaultInfo.reason;
  st.lastSyncMode = syncMode;
  writeJsonAtomic(statePath, st);
  return {
    mode: syncMode,
    fetched: messages.length,
    new: newMessages.length,
    duplicates,
    statePath,
    outputFiles,
    outputRoot,
    outputMode,
    outputPlacementReason: vaultInfo.reason,
    chat: st.chat,
    username: st.username,
    chatSelectionMode: chatSelection.mode,
    status: data.meta?.status || 'unknown',
    lastSyncedTimestamp: st.lastSyncedTimestamp,
  };
}

function status() {
  const st = state();
  return {
    statePath,
    outputRoot,
    outputMode,
    outputPlacementReason: vaultInfo.reason,
    runtimeHome,
    chat: targetChat,
    chatSelectionMode: chatSelection.mode,
    defaultSyncMode: syncMode,
    exists: exists(statePath),
    importedCount: st.importedCount || 0,
    lastSyncedTimestamp: st.lastSyncedTimestamp || 0,
    lastRunAt: st.lastRunAt || '',
    outputFiles: st.outputFiles || [],
  };
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

try {
  if (command === 'status') print(status());
  else if (command === 'setup') print(setup());
  else if (command === 'sessions') {
    const setupInfo = setup();
    print(fetchSessions(setupInfo.wx));
  }
  else if (command === 'chats') print(chats());
  else if (command === 'sync') print(sync());
  else {
    throw new Error(`Unknown command: ${command}. Use status, setup, chats, sessions, or sync.`);
  }
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
