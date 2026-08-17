#!/usr/bin/env node
/**
 * Figwright-Plus 控制台
 * ----------------------------------------------------------------------------
 * 一个零依赖的本地 Web 控制台（默认 http://127.0.0.1:3056），用来：
 *   1. 一键启动 / 停止 / 重启 figwright MCP server（LAN 模式）
 *   2. 网页里查看运行状态、配置、已连同伴、连接日志
 *   3. 生成连接指引：本机插件邀请串 + 每令牌专属的远程 MCP 命令（合并自原「访问令牌」「连接指引」）
 *   4. 在线管理访问令牌（新增 / 删除 / 轮换 / 设定每令牌只读权限），并可在「连接与伙伴」卡里改监听端口并保存重启
 *
 * 设计原则：
 *   - 只绑 localhost，控制台不暴露给局域网（它只是给你自己用的操作面板）。
 *   - 不改 figwright 核心代码，通过子进程 + 抓日志拿到同伴信息，fork 保持干净。
 *   - 配置文件 scripts/.figwright-dashboard.json 存 token 等机密，已被 .gitignore 忽略。
 *
 * 用法：
 *   node scripts/dashboard.mjs            # 启动控制台（会自动拉起 server 并开浏览器）
 *   node scripts/dashboard.mjs --no-open  # 不自动开浏览器
 *   DASH_PORT=3057 node scripts/dashboard.mjs   # 自定义控制台端口
 */
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { networkInterfaces, platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_ENTRY = join(REPO_ROOT, 'packages/mcp/dist/index.mjs');
const CONFIG_PATH = join(__dirname, '.figwright-dashboard.json');
const DASH_HTML = join(__dirname, 'dashboard.html');
const DASH_PORT = Number(process.env.DASH_PORT ?? 3056);

// Figwright-Plus version shown as a small badge after the console title. Format mirrors the plugin
// panel and the git release: `v<MAJOR>.<MINOR>-<short-git-sha>`. MAJOR was bumped to 1 at the 1.0
// release; MINOR starts at 0 and increments by 1 on each release; the commit hash is read live so
// the console always matches the build it runs from.
const APP_MAJOR = 1;
const APP_MINOR = '1'; // bump +1 on each release
function appVersion() {
  let sha = 'dev';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    // leave 'dev'
  }
  return `v${APP_MAJOR}.${APP_MINOR}-${sha}`;
}

// 默认值：沿用已分发给对方/插件的 token 作为 primary，避免改了以后连不上。
// tokens 是多令牌数组，每个 { value, label?, readonly? }；readonly 由各令牌独立控制远端权限。
// host 固定 0.0.0.0（LAN 模式：绑到非回环地址，让同网段伙伴能连；本地插件走 127.0.0.1 同样可用）
// —— 控制台不再暴露该字段（永远 0.0.0.0，没必要让用户改）。
// 不再下发 FIGWRIGHT_READONLY：本机永远双向，远端权限完全由各令牌的 readonly 决定。
const DEFAULT_CONFIG = {
  host: '0.0.0.0',
  port: 3055,
  tokens: [{ value: 'Psk7WEW2FoheR1zMGOoMr-fQtaqViIhG', label: 'primary' }],
  // 资源传送：默认内联（save 工具直接回 base64）。可切到 webdav / sftp，配置后远程伙伴用
  // fetch_asset(token) 取图，凭据仅存于服务端、不泄露给伙伴。凭据为机密，存于本 gitignored 配置文件。
  transfer: { mode: 'inline' },
};

const generateToken = () => randomBytes(24).toString('base64url');

const primaryTokenOf = (cfg) => {
  const list = cfg.tokens ?? [];
  return (list.find((t) => t.label === 'primary') ?? list[0])?.value ?? '';
};

// ----------------------------------------------------------------------------
// 配置读写
// ----------------------------------------------------------------------------
function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_PATH)) {
    try {
      cfg = { ...cfg, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
    } catch {
      /* 损坏就回退默认，不致命 */
    }
  }
  // 迁移：旧的单一 token 字段 → tokens 数组（保持现有连接不中断）
  if ((!Array.isArray(cfg.tokens) || cfg.tokens.length === 0) && typeof cfg.token === 'string' && cfg.token) {
    cfg.tokens = [{ value: cfg.token, label: 'primary' }];
  }
  if (!Array.isArray(cfg.tokens)) cfg.tokens = [];
  delete cfg.token; // 单字段已废弃，避免与 tokens 混淆
  delete cfg.readonly; // 全局只读已从控制台移除（本机永远双向，远端权限由令牌决定）
  return cfg;
}
let config = loadConfig();
function saveConfig() {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}
saveConfig(); // 确保文件存在，方便用户之后手动改

// ----------------------------------------------------------------------------
// 子进程管理（figwright MCP server）
// ----------------------------------------------------------------------------
let serverProc = null;
let startedAt = 0;
const logLines = []; // 滚动日志
// ip -> { type, tokenLabel, firstSeen, lastSeen, count, connected }
const peers = new Map();
const audit = []; // { ts, peer, ip, token, tool, ok, durMs }

function recordPeer(ip, patch) {
  const now = Date.now();
  const prev = peers.get(ip) || { firstSeen: now, count: 0 };
  const next = { ...prev, ...patch, lastSeen: now };
  if (patch.connected === true) next.count = prev.count + 1;
  peers.set(ip, next);
}

// 本地时间 HH:MM:SS（服务端跑在用户本机 Mac，与查看者同一时区；不再用 toISOString 的 UTC）
function tsLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function pushLog(line) {
  const ts = tsLocal();
  logLines.push(`[${ts}] ${line}`);
  if (logLines.length > 500) logLines.shift();

  // 解析 server 发出的结构化日志，构造可观测数据：
  //   [peer] connect type=local-plugin|remote-plugin|remote-agent ip=.. token=..
  //   [peer] disconnect type=.. ip=..
  //   [audit] tool_call peer=.. ip=.. token=.. tool=.. ok=true durMs=..
  //   [mcp-http] ... from <ip>  （远程 agent 的兜底来源）
  let m;
  m = line.match(/\[peer\] connect type=(\S+) ip=(\S+) token=(\S+)/);
  if (m) recordPeer(m[2], { type: m[1], tokenLabel: m[3], connected: true });
  m = line.match(/\[peer\] disconnect type=(\S+) ip=(\S+)/);
  if (m) recordPeer(m[2], { connected: false });
  m = line.match(/\[mcp-http\][^\n]*from\s+([\d.a-fA-F:]+)/);
  if (m) {
    const ip = m[1];
    if (!peers.has(ip)) recordPeer(ip, { type: 'remote-agent' });
    else if (peers.get(ip).type === undefined) peers.get(ip).type = 'remote-agent';
  }
  m = line.match(
    /\[audit\] tool_call peer=(\S+) ip=(\S+) token=(\S+) tool=(\S+) ok=(\S+) durMs=(\d+)/,
  );
  if (m) {
    audit.push({
      ts,
      peer: m[1],
      ip: m[2],
      token: m[3],
      tool: m[4],
      ok: m[5] === 'true',
      durMs: Number(m[6]),
    });
    if (audit.length > 500) audit.shift();
  }
}

function startServer() {
  if (serverProc) return { ok: false, msg: 'server 已在运行' };
  if (!existsSync(DIST_ENTRY)) {
    return {
      ok: false,
      msg: 'dist 缺失，请先构建：pnpm --filter @figwright/mcp build',
    };
  }
  const env = {
    ...process.env,
    FIGWRIGHT_HOST: config.host, // 固定 0.0.0.0（LAN 模式），控制台不暴露该字段
    FIGWRIGHT_PORT: String(config.port),
    // 多令牌：把 tokens 数组以 JSON 传给 server（server 优先读 FIGWRIGHT_TOKENS）。
    // 同时保留 FIGWRIGHT_TOKEN = primary 以兼容只认单令牌的旧路径。
    FIGWRIGHT_TOKENS: JSON.stringify(config.tokens ?? []),
    FIGWRIGHT_TOKEN: primaryTokenOf(config),
    // 不再下发 FIGWRIGHT_READONLY：本机永远双向；远端权限由各令牌的 readonly 决定。
    // 资源传送配置：以 JSON 传给 server（FIGWRIGHT_TRANSFER），server 据此初始化 TransferManager。
    FIGWRIGHT_TRANSFER: JSON.stringify(config.transfer ?? { mode: 'inline' }),
  };
  // 去掉可能污染子进程的 NODE_OPTIONS（如某些环境带 --use-system-ca，figwright 自带 node 不认）
  delete env.NODE_OPTIONS;
  // 注意：stdin 必须保持 'pipe' 且不要关闭。figwright server 的 wireShutdown 会把
  // stdin 的 EOF 当作「客户端断开」而优雅退出（process.exit(0)）——若设成 'ignore'，
  // 子进程 stdin 立刻 EOF，server 一启动就退。保持 pipe 并永不 end 即可让它常驻。
  const child = spawn('node', [DIST_ENTRY], {
    env,
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) =>
    String(d).split('\n').forEach((l) => l.trim() && pushLog(l)),
  );
  child.stderr.on('data', (d) =>
    String(d).split('\n').forEach((l) => l.trim() && pushLog('ERR ' + l)),
  );
  child.on('exit', (code, sig) => {
    pushLog(`server 退出 code=${code ?? ''} sig=${sig ?? ''}`);
    serverProc = null;
    startedAt = 0;
  });
  child.on('error', (err) => pushLog('启动失败: ' + err.message));
  serverProc = child;
  startedAt = Date.now();
  pushLog(`启动 figwright MCP server (host=${config.host} port=${config.port})`);
  return { ok: true };
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc) {
      resolve({ ok: false, msg: 'server 未在运行' });
      return;
    }
    // 标记所有同伴为断开，避免控制台残留「已连接」状态
    for (const p of peers.values()) p.connected = false;
    const c = serverProc;
    serverProc = null;
    startedAt = 0;
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    // 等旧进程真正退出（graceful shutdown 会释放 3055），再允许新进程接管端口
    c.once('exit', () => {
      pushLog('server 已停止');
      done({ ok: true });
    });
    c.kill('SIGTERM');
    pushLog('已发送 SIGTERM 停止 server');
    // 兜底：3s 内没退就强杀，避免卡死
    setTimeout(() => {
      try {
        c.kill('SIGKILL');
      } catch {
        /* 已退 */
      }
      done({ ok: true });
    }, 3000);
  });
}

async function restartServer() {
  await stopServer();
  // 再多等一拍，确保 OS 释放监听套接字
  await new Promise((r) => setTimeout(r, 300));
  return startServer();
}

// ----------------------------------------------------------------------------
// 连接指引生成
// ----------------------------------------------------------------------------
function getLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

function buildGuide() {
  const lanIp = getLanIp();
  const { port } = config;
  return {
    lanIp,
    // 本地 Figma 插件用回环地址（同机），粘贴进「粘贴邀请」——插件走本地 relay，无需 token，永远可读可写
    invite: `figwright://connect?host=127.0.0.1&port=${port}`,
    // 远程 MCP 客户端（对方 VSCode/Cursor）的 mcp-remote 命令在前端按各令牌拼装（每个伙伴用各自的令牌），
    // 因此这里不再返回单一 mcpRemote；也不再提供 SSH 端口转发指引。
  };
}

// ----------------------------------------------------------------------------
// 资源传送连通性测试（WebDAV / SFTP）
// 仅在用户点「测试连接」时运行，用控制台填写的凭据（未保存也可测）探测远端是否可达、
// 认证是否有效、以及暂存所需的写入权限是否具备。凭据不出本机。
// ----------------------------------------------------------------------------
async function loadSftpClient() {
  // dashboard.mjs 在 scripts/，而 ssh2-sftp-client 装在 @figwright/mcp 包里。pnpm 严格模式下
  // 裸名 ``ssh2-sftp-client`` 从 scripts/ 解析不到；直接 ``import()`` symlink 目录又会触发
  // ERR_UNSUPPORTED_DIR_IMPORT（Node ESM 只允许 import 文件或走包解析的裸名）。
  // 因此先用 createRequire 把包的真实入口文件解析出来，再 import 该文件——无论是否被 hoist 都能命中。
  const req = createRequire(import.meta.url);
  const candidates = [
    // 1) 裸名（若已被 hoist 到可解析位置）
    () => import('ssh2-sftp-client'),
    // 2) 解析 @figwright/mcp 包内的真实入口文件后 import
    () => {
      const entry = req.resolve('ssh2-sftp-client', {
        paths: [join(REPO_ROOT, 'packages/mcp/node_modules')],
      });
      return import(entry);
    },
  ];
  let lastErr;
  for (const attempt of candidates) {
    try {
      const mod = await attempt();
      if (mod.default) return mod.default;
      if (mod.Client) return mod.Client;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('SFTP 依赖未安装：请先在 @figwright/mcp 包运行 pnpm --filter @figwright/mcp add ssh2-sftp-client');
}

async function testWebDav(cfg) {
  const url = String(cfg.url ?? '').trim().replace(/\/+$/, '');
  const username = String(cfg.username ?? '').trim();
  const password = String(cfg.password ?? '');
  const sub = String(cfg.path ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'WebDAV URL 无效（需以 http:// 或 https:// 开头）' };
  if (!username || !password) return { ok: false, error: '缺少用户名或密码' };

  const target = [url, sub].filter(Boolean).join('/');
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);

  const classify = (status) => {
    if (status === 401 || status === 403) return { ok: false, error: '认证失败（401/403）：用户名或密码错误' };
    if (status === 404) return { ok: false, error: '路径不存在（404）：检查 URL 或子目录是否正确' };
    if (status === 405) return 'propfind-unsupported';
    if (status >= 400) return { ok: false, error: `服务器返回 ${status}` };
    return 'ok';
  };

  try {
    // 1) 读探针：探测可达 + 认证
    let probe;
    try {
      probe = await fetch(target, {
        method: 'PROPFIND',
        headers: { Authorization: auth, Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
        signal: ctrl.signal,
        redirect: 'manual',
      });
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, error: '连接超时（10s）：检查 URL 与网络' };
      const code = e.cause?.code || e.code || '';
      return { ok: false, error: '无法连接：' + (code || e.message) };
    }
    const r1 = classify(probe.status);
    if (r1 !== 'ok' && r1 !== 'propfind-unsupported') return r1;

    // 2) 写探针：暂存需要可写，放一个临时文件再删
    const probeKey = '.figwright-test-' + randomBytes(6).toString('hex');
    const putUrl = [url, sub, probeKey].filter(Boolean).join('/');
    const parent = putUrl.slice(0, putUrl.lastIndexOf('/'));
    await fetch(parent, { method: 'MKCOL', headers: { Authorization: auth }, signal: ctrl.signal }).catch(() => {});
    let putRes;
    try {
      putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/octet-stream' },
        body: Buffer.from('figwright-connection-test'),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, error: '写入超时（10s）' };
      return { ok: false, error: '写入失败：' + (e.cause?.code || e.message) };
    }
    if (!putRes.ok) {
      if (putRes.status === 401 || putRes.status === 403)
        return { ok: false, error: '认证失败（写入被拒 401/403）' };
      return { ok: false, error: `写入被拒（${putRes.status}）：账号可能无写入权限，暂存需要可写` };
    }
    await fetch(putUrl, { method: 'DELETE', headers: { Authorization: auth }, signal: ctrl.signal }).catch(() => {});
    await fetch(parent, { method: 'DELETE', headers: { Authorization: auth }, signal: ctrl.signal }).catch(() => {});
    return { ok: true, error: '连接成功，且可写入远程目录' };
  } catch (e) {
    return { ok: false, error: '测试异常：' + (e.message || String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

async function testSftp(cfg) {
  const host = String(cfg.host ?? '').trim();
  const username = String(cfg.username ?? '').trim();
  const password = String(cfg.password ?? '');
  const port = Number.isInteger(cfg.port) ? cfg.port : 22;
  // 与 packages/mcp/src/transfer.ts 的 SftpStore.remotePath 保持一致：路径视为绝对路径。
  // 去掉首尾斜杠后再补前导 /，空路径回退到当前目录(.)。避免裸相对路径被 OpenSSH sftp-server
  // 解析到 $HOME 之下导致 “No such file”。用户填写 `/home/user/xxx` 或 `home/user/xxx` 均可。
  const rawDir = String(cfg.path ?? '').trim();
  const remoteDir = rawDir ? '/' + rawDir.replace(/^\/+|\/+$/g, '') : '.';
  if (!host) return { ok: false, error: '缺少主机地址' };
  if (!username || !password) return { ok: false, error: '缺少用户名或密码' };

  let Client;
  try {
    Client = await loadSftpClient();
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const client = new Client();
  try {
    await client.connect({ host, port, username, password, timeout: 10000 });
    const list = await client.list(remoteDir);
    const probeKey = '.figwright-test-' + randomBytes(6).toString('hex');
    const probePath = remoteDir === '.' ? probeKey : remoteDir + '/' + probeKey;
    await client.put(Buffer.from('figwright-connection-test'), probePath);
    await client.delete(probePath);
    return { ok: true, error: `连接成功（目录 ${list.length} 项），且可写入远程目录` };
  } catch (e) {
    const msg = e.message || String(e);
    if (/auth|password|denied|permission|bad/i.test(msg))
      return { ok: false, error: '认证失败：用户名或密码错误' };
    if (/getaddrinfo|ENOTFOUND|ECONNREFUSED|timed out|timeout|ETIMEDOUT/i.test(msg))
      return { ok: false, error: '连接失败：检查主机 / 端口 / 网络（' + msg + '）' };
    return { ok: false, error: 'SFTP 测试失败：' + msg };
  } finally {
    await client.end().catch(() => {});
  }
}

// ----------------------------------------------------------------------------
// HTTP 服务
// ----------------------------------------------------------------------------
function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${DASH_PORT}`);

  // 首页 / 仪表盘
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
    if (!existsSync(DASH_HTML)) {
      res.writeHead(404);
      res.end('dashboard.html 缺失');
      return;
    }
    let html = readFileSync(DASH_HTML, 'utf8');
    html = html.replace(/(<span id="verBadge"[^>]*>)[^<]*(<\/span>)/, `$1${appVersion()}$2`); // stamp the live version into the badge
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 状态
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const guide = buildGuide();
    sendJson(res, {
      running: !!serverProc,
      pid: serverProc ? serverProc.pid : null,
      uptimeSec: serverProc && startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
      config: { ...config },
      guide,
      tokens: config.tokens,
      primaryToken: primaryTokenOf(config),
      peers: [...peers.entries()].map(([ip, v]) => ({
        ip,
        type: v.type,
        tokenLabel: v.tokenLabel,
        connected: v.connected !== false,
        count: v.count,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
      })),
      audit: audit.slice(-100).reverse(),
      logs: logLines.slice(-120),
    });
    return;
  }

  // 启停控制
  if (req.method === 'POST' && url.pathname === '/api/control') {
    const body = await readBody(req);
    const action = body.action;
    let r;
    if (action === 'start') r = startServer();
    else if (action === 'stop') r = await stopServer();
    else if (action === 'restart') r = await restartServer();
    else r = { ok: false, msg: '未知 action' };
    sendJson(res, r, r.ok ? 200 : 400);
    return;
  }

  // 保存配置（若运行中则重启生效）
  if (req.method === 'POST' && url.pathname === '/api/config') {
    const body = await readBody(req);
    // 仅保留端口可改；host 固定 0.0.0.0（LAN），全局 readonly 已从控制台移除（由令牌控制）。
    if (Number.isInteger(body.port) && body.port > 0 && body.port <= 65535)
      config.port = body.port;
    // 资源传送配置：合并模式与凭据（凭据来自控制台填写、存于本配置文件，不出现在 UI 外）。
    if (body.transfer && typeof body.transfer === 'object') {
      const t = body.transfer;
      config.transfer = {
        mode: t.mode === 'webdav' || t.mode === 'sftp' ? t.mode : 'inline',
        // 直链模式：save 返回下载 URL（零 base64）。需配合 publicBaseUrl。
        ...(t.directUrl === true ? { directUrl: true } : {}),
        ...(typeof t.publicBaseUrl === 'string' && t.publicBaseUrl.trim()
          ? { publicBaseUrl: t.publicBaseUrl.trim() }
          : {}),
        ...(t.webdav && typeof t.webdav === 'object'
          ? { webdav: { url: String(t.webdav.url ?? ''), path: t.webdav.path ? String(t.webdav.path) : undefined, username: String(t.webdav.username ?? ''), password: String(t.webdav.password ?? '') } }
          : {}),
        ...(t.sftp && typeof t.sftp === 'object'
          ? { sftp: { host: String(t.sftp.host ?? ''), port: Number.isInteger(t.sftp.port) ? t.sftp.port : undefined, path: t.sftp.path ? String(t.sftp.path) : undefined, username: String(t.sftp.username ?? ''), password: String(t.sftp.password ?? '') } }
          : {}),
      };
      // 凭据缺失时不启用远端模式，回退内联
      if (config.transfer.mode !== 'inline') {
        const c = config.transfer.mode === 'webdav' ? config.transfer.webdav : config.transfer.sftp;
        if (!c || !c.username || !c.password || (config.transfer.mode === 'webdav' && !c.url) || (config.transfer.mode === 'sftp' && !c.host)) {
          config.transfer = { mode: 'inline' };
        }
      }
    }
    saveConfig();
    let r = { ok: true, msg: '已保存' };
    if (serverProc) {
      await restartServer();
      r.msg = '已保存并重启 server 生效';
    }
    sendJson(res, r);
    return;
  }

  // 测试资源传送配置（WebDAV / SFTP 连通性 + 认证 + 写入权限）
  if (req.method === 'POST' && url.pathname === '/api/test-transfer') {
    const body = await readBody(req);
    const mode = body.mode;
    let r;
    if (mode === 'webdav') r = await testWebDav(body.webdav || {});
    else if (mode === 'sftp') r = await testSftp(body.sftp || {});
    else r = { ok: false, error: '请先选择 WebDAV 或 SFTP 模式' };
    sendJson(res, r, r.ok ? 200 : 400);
    return;
  }

  // 令牌管理：列出 / 新增 / 删除 / 轮换
  if (req.method === 'GET' && url.pathname === '/api/tokens') {
    sendJson(res, { tokens: config.tokens, primaryToken: primaryTokenOf(config) });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/tokens') {
    const body = await readBody(req);
    const action = body.action;
    let r;
    if (action === 'add') {
      const label =
        typeof body.label === 'string' && body.label.trim()
          ? body.label.trim()
          : `peer-${config.tokens.length + 1}`;
      const t = { value: generateToken(), label, readonly: body.readonly === true };
      config.tokens.push(t);
      saveConfig();
      if (serverProc) await restartServer();
      r = { ok: true, token: t, msg: '已新增令牌' + (serverProc ? '，已重启生效' : '') };
    } else if (action === 'remove') {
      const value = body.value;
      if (!value) {
        r = { ok: false, msg: '缺少 value' };
      } else {
        const before = config.tokens.length;
        config.tokens = config.tokens.filter((t) => t.value !== value);
        if (config.tokens.length === before) {
          r = { ok: false, msg: '未找到该令牌' };
        } else {
          saveConfig();
          if (serverProc) await restartServer();
          r = { ok: true, msg: '已删除令牌' + (serverProc ? '，已重启生效' : '') };
        }
      }
    } else if (action === 'rotate') {
      // 轮换 primary：生成新令牌替换旧的 primary（保留其它已发令牌）
      const value = generateToken();
      const idx = config.tokens.findIndex((t) => t.label === 'primary');
      if (idx >= 0) config.tokens[idx].value = value;
      else config.tokens.unshift({ value, label: 'primary' });
      saveConfig();
      if (serverProc) await restartServer();
      r = { ok: true, token: { value, label: 'primary' }, msg: '已轮换 primary 令牌' + (serverProc ? '，已重启生效' : '') };
    } else if (action === 'setReadonly') {
      // 调整某令牌的远端权限：只读（对方只能 figma-to-code）或读写（可 code-to-figma）
      const value = body.value;
      const ro = body.readonly === true;
      const t = config.tokens.find((x) => x.value === value);
      if (!t) {
        r = { ok: false, msg: '未找到该令牌' };
      } else {
        t.readonly = ro;
        saveConfig();
        if (serverProc) await restartServer();
        r = { ok: true, msg: '已更新令牌权限' + (serverProc ? '，已重启生效' : '') };
      }
    } else {
      r = { ok: false, msg: '未知 action' };
    }
    sendJson(res, r, r.ok ? 200 : 400);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

// ----------------------------------------------------------------------------
// 优雅退出：控制台被关掉（Ctrl-C / 被杀）时，必须先把子进程 server 一起带走，
// 否则 3055 会被孤儿进程占着，下次启动会 EADDRINUSE。
// ----------------------------------------------------------------------------
async function shutdown(signal) {
  pushLog(`控制台收到 ${signal}，正在停止 figwright server 后退出 ...`);
  await stopServer(); // 内部已做 SIGTERM + 3s SIGKILL 兜底
  try {
    server.close();
  } catch {
    /* 已关 */
  }
  process.exit(0);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    shutdown(sig);
  });
}

// 兜底：任何原因退出时（含未被信号拦截的情况），同步强杀子进程，避免孤儿
process.on('exit', () => {
  if (serverProc) {
    try {
      serverProc.kill('SIGKILL');
    } catch {
      /* 已退 */
    }
  }
});

server.listen(DASH_PORT, '127.0.0.1', () => {
  const open = !process.argv.includes('--no-open');
  console.log(`\n  Figwright-Plus 控制台已启动: http://127.0.0.1:${DASH_PORT}`);
  console.log(`  配置文件: ${CONFIG_PATH}`);
  console.log(`  自动拉起 figwright MCP server ...\n`);
  startServer();
  if (open && platform() === 'darwin') {
    spawn('open', [`http://127.0.0.1:${DASH_PORT}`]);
  }
});
