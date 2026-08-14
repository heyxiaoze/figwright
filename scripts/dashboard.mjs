#!/usr/bin/env node
/**
 * Figwright-Plus 控制台
 * ----------------------------------------------------------------------------
 * 一个零依赖的本地 Web 控制台（默认 http://127.0.0.1:3056），用来：
 *   1. 一键启动 / 停止 / 重启 figwright MCP server（LAN 模式）
 *   2. 网页里查看运行状态、配置、已连同伴、连接日志
 *   3. 生成「怎么让别人连」的连接指引（本地插件邀请串 + 远程 MCP 命令）
 *   4. 在线编辑配置（host / port / token / readonly）并保存重启
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
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { networkInterfaces, platform } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DIST_ENTRY = join(REPO_ROOT, 'packages/mcp/dist/index.mjs');
const CONFIG_PATH = join(__dirname, '.figwright-dashboard.json');
const DASH_HTML = join(__dirname, 'dashboard.html');
const DASH_PORT = Number(process.env.DASH_PORT ?? 3056);

// 默认值：沿用已分发给对方/插件的 token，避免改了以后连不上
const DEFAULT_CONFIG = {
  host: '0.0.0.0', // 0.0.0.0 => 非回环 => LAN 模式（本地插件走 127.0.0.1 同样可用）
  port: 3055,
  token: 'Psk7WEW2FoheR1zMGOoMr-fQtaqViIhG',
  readonly: true,
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
const peers = new Map(); // ip -> { firstSeen, lastSeen, count }

function pushLog(line) {
  const ts = new Date().toISOString().slice(11, 19);
  logLines.push(`[${ts}] ${line}`);
  if (logLines.length > 500) logLines.shift();

  // 抓同伴连接：
  //   1) HTTP MCP 远程客户端：[mcp-http] POST /mcp from 192.168.x.x
  //   2) WebSocket relay 插件：[relay] session xxx hello (resumed=...)
  let peerIp = null;
  const m = line.match(/\[mcp-http\][^\n]*from\s+([\d.a-fA-F:]+)/);
  if (m) {
    peerIp = m[1];
  } else if (line.match(/\[relay\]\s+session\s+\S+\s+hello/)) {
    // WS relay 连接没有 IP（同机 loopback），用 "plugin (local)" 标识
    peerIp = 'plugin (local)';
  }
  if (peerIp) {
    const now = Date.now();
    const prev = peers.get(peerIp) || { firstSeen: now, count: 0 };
    prev.lastSeen = now;
    prev.count += 1;
    peers.set(peerIp, prev);
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
    FIGWRIGHT_HOST: config.host,
    FIGWRIGHT_PORT: String(config.port),
    FIGWRIGHT_TOKEN: config.token,
    FIGWRIGHT_READONLY: config.readonly ? 'true' : 'false',
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
  pushLog(`启动 figwright MCP server (host=${config.host} port=${config.port} readonly=${config.readonly})`);
  return { ok: true };
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc) {
      resolve({ ok: false, msg: 'server 未在运行' });
      return;
    }
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
  const { port, token, readonly } = config;
  return {
    lanIp,
    // 本地 Figma 插件用回环地址（同机），粘贴进「粘贴邀请」
    invite: `figwright://connect?host=127.0.0.1&port=${port}&token=${encodeURIComponent(token)}`,
    // 远程 MCP 客户端（对方 VSCode/Cursor）：用 mcp-remote 走明文 http 桥接
    mcpRemote: `npx -y mcp-remote http://${lanIp}:${port}/mcp --allow-http --header "x-figwright-token: ${token}"`,
    // 或者 SSH 端口转发（更安全，且 VSCode 原生支持 localhost）
    sshTunnel: `ssh -N -L ${port}:localhost:${port} <你的用户名>@${lanIp}`,
    sshMcpUrl: `http://localhost:${port}/mcp`,
    readonly,
  };
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(readFileSync(DASH_HTML));
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
      peers: [...peers.entries()].map(([ip, v]) => ({
        ip,
        count: v.count,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
      })),
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
    if (typeof body.host === 'string') config.host = body.host.trim();
    if (Number.isInteger(body.port) && body.port > 0 && body.port <= 65535)
      config.port = body.port;
    if (typeof body.token === 'string' && body.token.trim()) config.token = body.token.trim();
    if (typeof body.readonly === 'boolean') config.readonly = body.readonly;
    saveConfig();
    let r = { ok: true, msg: '已保存' };
    if (serverProc) {
      await restartServer();
      r.msg = '已保存并重启 server 生效';
    }
    sendJson(res, r);
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
