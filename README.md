<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg">
  <img alt="Figwright" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg" width="480" height="240">
</picture>

**Playwright 驱动浏览器，Figwright 驱动 Figma。**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![LAN Dashboard](https://img.shields.io/badge/Feature-LAN%20Dashboard-8a2be2)](https://github.com/heyxiaoze/figwright#局域网控制台-lan-dashboard)
[![Remote MCP](https://img.shields.io/badge/Feature-Remote%20MCP-2e8b57)](https://github.com/heyxiaoze/figwright#远程协作对方智能体直连你的服务器)
[![Bilingual](https://img.shields.io/badge/UI-中文%20%2F%20English-ff8c00)](https://github.com/heyxiaoze/figwright#中英双语)

</div>

## ⭐ 致谢与原项目（请先读这里）

> **本仓库是 [`figwright`](https://github.com/awdr74100/figwright) 的一个 fork（二次开发增强版），并非原作者的官方仓库。**

衷心感谢原作者 **[@awdr74100（Roya）](https://github.com/awdr74100)** 开源了 Figwright，并采用 **MIT 许可证** 发布。本版本的全部增强都建立在这份优秀的工作之上——**感谢原作者的开源精神**。

| | |
| :--- | :--- |
| 原项目仓库 | <https://github.com/awdr74100/figwright> |
| 原作者 | **@awdr74100（Roya）** |
| 许可证 | MIT © Roya |

我们在自己的 fork 上做二次开发，**暂不定期向原项目回流改动**。如果你在寻找官方版本或想参与上游贡献，请移步上面的原项目仓库。

---

## Figwright 是什么？

Figwright 通过本地 WebSocket 中继，把一个 **MCP 服务器** 连接到一个 **Figma 插件**，让 AI 智能体——Claude Code、Cursor、Codex，或任何支持 MCP 的客户端——能够真正「操作」Figma，而不只是看着它。

它的能力是双向的：

**读取（figma-to-code）**——将 Figma 选区转换为「懂框架」的代码，基于忠实且去重的设计上下文（布局、排版、变量、组件）。

<p align="center">
  <img alt="Figwright turning a Figma selection into code" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/figma-to-code.gif" width="820">
</p>

**写入（code-to-figma）**——直接在画布上创作与编辑：画框、文本、自动布局、样式、变量、组件，乃至完整界面。

<p align="center">
  <img alt="Figwright building a design directly on the Figma canvas" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/code-to-figma.gif" width="820">
</p>

一切都运行在你的机器上，通过插件与 Figma 通信，因此**不需要 Figma Dev Mode 席位**，也**不需要付费套餐**。

## 为什么选择 Figwright

- **免费**——无需 Figma Dev Mode 或付费席位。官方的 Dev Mode MCP 有门槛，Figwright 没有。
- **双向**——不只是只读。**112 个工具**覆盖画布的读取与写入，智能体既能实现设计，也能构建设计。
- **以技术栈优先的代码生成**——Figwright 会识别你真实的技术栈（框架 + 样式系统），并复用你已有的组件、设计令牌与图标，而不是吐出一套你得重写的通用标记。
- **任意 MCP 客户端**——Claude Code、Cursor 及其他支持 MCP 的智能体，工作方式完全一致。
- **开放可扩展**——读写工作流以可安装的 [技能](#技能) 形式提供，你可采纳或直接 fork。

## 工作原理

你的 MCP 客户端通过 stdio 与 `@figwright/mcp` 服务器通信；服务器通过本地 WebSocket 把消息中继到 Figma 插件。多个客户端可以共享同一个插件——它们会选举出一个「领导者」来独占这条连接——并且传输层天生能扛住掉线重连：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ MCP CLIENTS  —  one per agent                                       │
│ Claude Code · Cursor · Claude · any MCP-capable client              │
└─────────────────────────────────────────────────────────────────────┘
                                   │  MCP protocol over stdio
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ @figwright/mcp  —  your client launches one; they elect a leader    │
│                                                                     │
│ LEADER   (owns the single plugin connection)                        │
│    • WebSocket relay · request idempotency                          │
│    • routes to the most-recently-active file                        │
│    • session resume · "busy ≠ dead" heartbeat                       │
│    • endpoints:  /ws (plugin) · /ping (health) · /rpc (followers)   │
│    • remote MCP:  /mcp (Streamable HTTP, for peers across LAN)      │
│                                                                     │
│ FOLLOWERS                                                           │
│    • forward tool calls to the leader over HTTP /rpc                │
│    • take over automatically if the leader exits                    │
└─────────────────────────────────────────────────────────────────────┘
                                   │  local WebSocket · msgpack (binary)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ FIGMA  (desktop or browser)                                         │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Figwright plugin                                                │ │
│ │   • UI (Vue 3 iframe): WebSocket client + heartbeat             │ │
│ │   • sandbox: executes Figma Plugin API calls                    │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│              │ Figma Plugin API                                     │
│              ▼                                                      │
│            Canvas                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

Figwright 在设计上就是 **以技术栈优先** 的：它不采用固定的编译管线，而是把忠实的设计上下文呈现出来，让模型生成契合 *你* 代码库的代码。[`figma-codegen`](#技能) 技能把这套方法固化了下来。

## 插件

Figma 这一侧的插件不是黑盒。它会实时显示每一次调用，让你检查发送给模型的精确载荷，并展示自身的连接健康状态。

<p align="center">
  <img alt="The Figwright panel: an activity log of tool calls, an expanded call showing the exact payload sent to the model, and a debug tab with connection and call statistics" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-panel.png" width="820">
</p>

<p align="center">
  <sub><b>活动</b>——每一次调用，带耗时并可跳转到它触及的节点 · <b>载荷</b>——模型实际收到的内容 · <b>调试</b>——健康状态、版本号，以及一键诊断包</sub>
</p>

而且它会跟随你的 Figma 主题，明亮或暗色皆可。

<p align="center">
  <img alt="The same panel side by side in Figma's light and dark themes" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-theme.png" width="616">
</p>

窗口随你摆放。拖动右下角即可缩放——面板越高，日志可见区域越大，并且尺寸会被记住，下次打开依旧。或者把它放到后台：面板让位给你，但连接保持活跃，这样长时间运行的智能体能持续工作。

<p align="center">
  <img alt="The same panel at two sizes: a narrow one showing three calls with its resize corner highlighted, and a wider one showing five, with the run-in-background button highlighted in the header" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/plugin-window.png" width="602">
</p>

<p align="center">
  <sub><b>缩放</b>——拖动角落，尺寸生效 · <b>后台</b>——面板隐藏，中继依然连接</sub>
</p>

## 本版本新增（Figwright-Plus）

在原作者的基础上，本 fork 增加了面向「局域网协作」与「可观测性」的能力：

### 1. 局域网控制台（LAN Dashboard）

`scripts/dashboard.mjs` + `scripts/dashboard.html`（默认 **:3056**，仅绑 `127.0.0.1`）。一个零依赖的网页控制台，让你在浏览器里管理整个 Figwright：

- 一键**启动 / 停止 / 重启** Figwright MCP server（作为子进程托管，关闭控制台会带走子进程，不留孤儿）；
- 实时查看运行状态（模式 / 监听地址 / 端口 / 运行时长 / PID）；
- 在线编辑配置（host / port / token / 只读）并保存重启；
- **访问令牌管理**：新增 / 删除 / 轮换令牌，每条令牌独立设置**只读**或**读写**；
- **已连同伴**列表：识别本地插件、远程插件、远程智能体，并显示连接状态；
- **活动与审计**：调用数、成功率、同伴数、近 1 分钟活动，以及实时工具调用表；
- **亮 / 暗主题**切换、**中 / 英双语**切换。

运行：

```bash
node scripts/dashboard.mjs            # 启动并自动打开浏览器
node scripts/dashboard.mjs --no-open  # 不自动打开浏览器
```

控制台配置保存在 `scripts/.figwright-dashboard.json`（已被 `.gitignore` 忽略，含令牌机密，请勿提交）。

### 2. 远程 MCP（Streamable HTTP）

服务器在本地 stdio 之外，额外在 `http://<你的 LAN IP>:3055/mcp` 暴露一个 **Streamable HTTP** 端点。对方（例如同一局域网下、使用 VSCode / Cursor 的前端同事）可以用 `mcp-remote` 直接连到你的服务器，读取（或读写）你的 Figma——**无需把插件装到对方机器上**。

### 3. 多令牌与分权

支持多条访问令牌（`FIGWRIGHT_TOKENS` JSON 数组，或兼容单条 `FIGWRIGHT_TOKEN`）。**每条令牌可独立设置「只读」或「读写」**，从而精确控制每位同伴的权限。无令牌的 LAN 模式会自动生成随机令牌。控制台可随时新增 / 删除 / 轮换令牌，改动立即生效。

### 4. 结构化审计日志

服务器输出一致前缀的日志行（`[peer] connect/disconnect`、`[audit] tool_call`），控制台据此实时解析并展示连接与调用活动，便于排查与审计。

### 5. 中英双语

插件面板与局域网控制台均内置 **中文 / 英文** 切换，语言偏好本地持久化。

### 6. 统一版本号

采用 `v<大版本>.<小版本>-<提交码>`（如 `v0.05-99544e5`）规则，**插件页脚、控制台徽标、GitHub Release 三处版本号自动对齐**，一眼就能确认服务端 / 客户端是否同源同版本。

## 快速开始

### 1. 构建并运行服务器

本仓库的 LAN / 远程能力**尚未**发布到 npm，请从源码构建：

```bash
git clone https://github.com/heyxiaoze/figwright.git
cd figwright
pnpm install
pnpm -C packages/mcp build
```

把你的 MCP 客户端指向构建好的服务器。以 Claude Code 为例，在 `.mcp.json` 加入：

```json
{
  "mcpServers": {
    "figwright": {
      "command": "node",
      "args": ["packages/mcp/dist/index.mjs"]
    }
  }
}
```

### 2. 安装 Figma 插件

插件尚未上架 Figma 社区市场，请从最新的 Release 安装：

1. 从 [**最新 GitHub Release**](https://github.com/heyxiaoze/figwright/releases/latest) 下载插件 zip 并解压。
2. 在 Figma **桌面客户端**中：**菜单 → 插件 → 开发 → 从清单导入插件…**，选择解压后的 `manifest.json`。

### 3. 连接

在 Figma 中打开 Figwright 插件（**插件 → 开发 → Figwright**）。它会自动连接到本机服务器并显示 **已连接**。让智能体运行 `ping` 确认链路通畅。

### 4.（可选）安装技能

[技能](#技能) 让智能体在恰当的时机调用 Figwright，并遵循这些扎根于上下文的工作流：

```bash
npx skills add heyxiaoze/figwright/skills
```

### 5. 上手试试

在 Figma 中选中一个画框，给你的智能体这样提示：

> _把这个 Figma 选区写成一个 React 组件。_

或者反过来：

> _根据这个规格在 Figma 里搭一个定价区块。_

## 远程协作：对方智能体直连你的服务器

最常见的协作场景：**你的 Figma 与插件在本机，同事在他的 VSCode / Cursor 里通过 MCP 直接连到你的服务器**，读取（或读写）你的 Figma。你通过服务器配置决定对方「只读」还是「读写」。

前提：服务器的 `FIGWRIGHT_HOST` 必须绑定非回环地址（你的 LAN IP 或 `0.0.0.0`），且 `FIGWRIGHT_TOKEN` 必填。

最简方式是用**局域网控制台**生成对方专属的连接命令：

1. 打开控制台（`node scripts/dashboard.mjs`）；
2. 在「访问令牌」里新增一条令牌，设置**只读**或**读写**；
3. 复制该令牌对应的 `mcp-remote` 命令，发给同事。

对方在他的 MCP 客户端里这样配置（以 `http` 类型为例）：

```json
{
  "mcp": {
    "servers": {
      "figwright": {
        "type": "http",
        "url": "http://192.168.1.42:3055/mcp",
        "headers": {
          "x-figwright-token": "对方令牌"
        }
      }
    }
  }
}
```

> 若对方的客户端只支持 stdio 的 MCP（如部分 VSCode 配置），用 `mcp-remote` 桥接：
> ```bash
> npx -y mcp-remote http://192.168.1.42:3055/mcp --allow-http --header "x-figwright-token: 对方令牌"
> ```
> 令牌两种携带方式都支持：`x-figwright-token` 请求头（Figwright 原生），或标准的 `Authorization: Bearer <token>`。请用你给对方的**同一条**令牌。

权限由 `FIGWRIGHT_READONLY` 决定：你在本机开启只读，对方联上来就**只看到读工具**、无法改你的文件——无需在对方机器上做任何额外设置。

> 该 HTTP 端点与本地 stdio **共用同一进程与端口**：本机智能体走 stdio，远端智能体走 `/mcp`，两者看到的是同一套（按只读策略过滤后的）工具。
>
> 防火墙提示：若对方连不上，请确认你 Mac 的防火墙允许入站到 `3055` 端口（macOS：系统设置 → 网络 → 防火墙）。同一 LAN 内通常无需额外路由配置。

## 只读模式

默认情况下，连上来的智能体拥有全部工具，**既能读取设计（figma-to-code）也能写回修改（code-to-figma）**。当你把服务器开放给另一台机器（例如让一位前端同事远程读取你的 Figma 来生成代码）时，可以用 `FIGWRIGHT_READONLY` 把它限制为**只读**——服务器只会向智能体暴露读取类与代码生成辅助类工具，**所有写工具（创建 / 编辑 / 删除节点、批量编辑、Motion 写入等）一律不出现**，对方因此只能读取、无法改你的文件。

| 变量 | 默认值 | 含义 |
| :--- | :--- | :--- |
| `FIGWRIGHT_READONLY` | `false` | 设为 `1` / `true` / `yes` / `on` 时开启只读：隐藏全部 `kind: 'write'` 工具，仅保留读取与本地辅助工具。 |

> 只读模式与 LAN / 远程模式**正交**：即便走本地 stdio（不开 LAN），也能用它限制本机智能体的权限。在远程下开启只读时，仍建议同时固定 `FIGWRIGHT_TOKEN`——只读不代表无需认证，对方仍要先凭令牌连上才能读到你的设计。

## 环境变量

| 变量 | 默认值 | 含义 |
| :--- | :--- | :--- |
| `FIGWRIGHT_HOST` | `127.0.0.1` | 中继绑定的主机。填一个 LAN IP（如 `192.168.1.42`）或 `0.0.0.0` 即可监听所有接口。**任何非回环的值都会开启 LAN / 远程模式。** |
| `FIGWRIGHT_PORT` | `3055` | 中继端口（同时承载 stdio 对应的本地中继与 `/mcp` HTTP 端点）。 |
| `FIGWRIGHT_TOKEN` | *(自动)* | 单条共享密钥。在 LAN / 远程模式下，若未设置，服务器会在启动时生成随机令牌并打印到日志；请设成稳定值，使配置重启后依然有效。 |
| `FIGWRIGHT_TOKENS` | — | 多条令牌的 JSON 数组，每条可带 `readonly` 字段，用于分权（见 [多令牌与分权](#3-多令牌与分权)）。 |
| `FIGWRIGHT_READONLY` | `false` | 全局只读开关（隐藏全部写工具）。 |

## 技能

智能体技能编排 Figwright 的工具。它们由模型触发——当任务与描述匹配时，你的智能体会自动加载对应的技能。

| 技能 | 作用 |
| :--- | :--- |
| [`figma‑codegen`](./skills/figma-codegen/SKILL.md) | 把 Figma 选区转换成懂框架的代码，基于你的技术栈与已有组件。 |
| [`figma‑build`](./skills/figma-build/SKILL.md) | 从代码或描述构建 Figma 设计，复用文件中已有的组件与样式。 |

通过 [`skills`](https://www.skills.sh) CLI 安装到任意支持的智能体：

```bash
npx skills add heyxiaoze/figwright/skills      # both
npx skills add https://github.com/heyxiaoze/figwright/tree/main/skills/figma-codegen  # one
```

> [!NOTE]
> 技能需要 `@figwright/mcp` 服务器处于连接状态——离开了它，技能本身没有任何工具可驱动。

## 工具

Figwright 提供 **112 个 MCP 工具**，分为三组：

- **读取**——选区、文档与节点检查、样式、变量、组件、字体、反应（reactions）、动效（motion）状态、截图、原始图片填充资源、PDF 导出，以及动画画框的视频导出（MP4 / GIF / WebM）。
- **写入**——创建并编辑画框、文本、图形、自动布局、效果、样式、变量、组件（含编写布尔/文本/实例替换属性）、页面、反应，以及 Motion 动画（关键帧、动画风格预设、时间轴）；外加一个 `batch` 工具可一次性应用大量编辑。
- **上下文夯实**——`get_design_context` 提供忠实且去重的设计上下文；`component_map` / `token_map` / `icon_map` 把 Figma 数据与你的代码库关联起来，让代码生成复用你已有的东西；另有 `design_diff`，它能报告设计相对已存基线的变动，使你只更新受影响的代码。

> [!TIP]
> 你的 MCP 客户端在连接时会列出全部工具——那才是最权威、最新的清单。

## 运行要求

- 一个 **MCP 客户端**（Claude Code、Cursor……）。
- **Node.js 20.19+ 或 22.12+**——服务器通过 `npx` 作为独立进程运行，因此与你项目构建所用的 Node 版本无关。（这是现代 Node 基线；Node 18/21 以及 22.0–22.11 不受支持。）
- **Figma**——免费版即可满足；开发模式下导入插件需要桌面客户端。

## 安全

Figwright 完全运行在你的机器上：你的客户端通过 stdio 启动服务器，服务器通过 `127.0.0.1:3055` 上的 WebSocket 把消息中继给插件，数据不会发往任何别处。插件只使用 Figma 公开的 Plugin API，因此它只能访问你当前打开的文件，不会越界。远程 `/mcp` HTTP 端点与本地中继共用同一套令牌认证，所有改变状态的请求都必须携带有效令牌。

回环地址本身并不是一道边界——你访问的网页仍可能连上本地端口——因此中继对每一个请求都基于两个网页无法伪造的请求头进行校验：**`Host`**（必须指向回环地址，这正是阻止 DNS 重绑定的关键）与 **`Origin`**（仅放行插件沙箱内的握手，拒绝来自其他浏览器的请求）。领导者的 HTTP 端点还要求一种不经过 CORS 预检就无法发送的内容类型。更宏观的视角请参见 [MCP 安全最佳实践](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)；Figwright 的威胁模型、范围边界以及漏洞私下上报方式，详见 [SECURITY.md](./SECURITY.md)。

**Figwright 不能替代你对智能体行为的审查。** 它的写入工具会改动你的 Figma 文件，导出工具会把文件写到智能体所选的路径；一个针对恶意设计或被提示注入操控的智能体，可能滥用这两者。真正起作用的边界，是你 MCP 客户端的工具审批控制。

把中继暴露到网络上（LAN / 远程模式）**会移除默认部署所依赖的回环边界**，因此：

- **令牌认证是强制的。** 每一次 WebSocket 升级都必须以 WebSocket 子协议 *和* `$hello` 握手两种方式出示令牌；每一个会改变状态的 HTTP POST（`/rpc`、`/abdicate`）以及 `/mcp` 的写请求都必须携带 `x-figwright-token`（或 `Authorization: Bearer`）请求头。缺少有效令牌的请求会被拒绝（403）。回环模式下则不使用令牌。
- **`Host` 闸门依然开启**，只是范围放宽。中继仍会校验 `Host` 头——现在除了回环地址，也放行 LAN 地址，但拒绝任何指向外部主机的请求——从而保住 DNS 重绑定防御。
- **链路本地与仅内部的地址会被过滤**——在公布的连接信息中剔除这类地址，避免你不小心给出一个不可达的目标。

请把令牌当作密码对待：任何人只要得知它（且能访问该端口），就能驱动你的 Figma 插件。请将 LAN / 远程模式置于可信网络之后，固定 `FIGWRIGHT_TOKEN`，并不要让端口越过防火墙暴露出去。如果你只需要在同一台机器上使用插件，就保持默认的回环绑定——无令牌，也无任何网络暴露面。

## 常见问题（FAQ）

<details>
<summary><strong>服务器无法启动——<code>command not found</code>，或以 <code>-32000</code>（"Connection closed"）失败/断开。</strong></summary>

两者都源于你的 MCP 客户端启动服务器的方式：它直接 `spawn` 那个 `command`，**而非**通过你的交互式 shell，因此它不会继承你在 shell 里设置的任何环境。当 Node 由版本管理器（**fnm、nvm、asdf、volta、mise**）管理时，这一点最致命。下面有两种症状，对应两种不同的修复。

**`command not found`——客户端在 `PATH` 上找不到 `npx` / `node`。** 用 `which npx`（或 `which node`）得到完整路径，把绝对路径作为 `command`；或通过 `env` 把版本管理器的 `bin` 目录加入 `env.PATH`。

**`-32000` / "Connection closed" / 始终连不上——`npx` 能跑起来，但服务器在握手前就退出了。** `npx … @latest` 会在每次启动时重新从注册表解析包，在直接 spawn 的环境里可能失败或卡住。修复办法是把包安装好，让启动不再需要拉取注册表：作为项目依赖 `pnpm add -D @figwright/mcp` 并去掉 `@latest`，或全局安装后把 `command` 直接指向 `figwright-mcp` 的绝对路径。

</details>

<details>
<summary><strong>插件一直停留在"Waiting"，始终连不上。</strong></summary>

服务器由你的 MCP 客户端启动，因此只有当该客户端开着时它才运行。请检查：

- 你的 MCP 客户端正在运行，且已配置 Figwright（试试 `ping`）；
- 插件已在**同一**台机器的同一个 Figma 应用中打开（中继仅本地，`127.0.0.1`）；
- 没有任何东西阻断本地回环连接（某些防火墙/安全软件会这么做）。

</details>

<details>
<summary><strong>我需要付费的 Figma 套餐或 Dev Mode 吗？</strong></summary>

不需要。Figwright 通过插件与 Figma 通信，因此免费版就够——无需 Dev Mode 席位，也无需付费套餐。

</details>

<details>
<summary><strong>它在 Dev Mode 和 FigJam 中可用吗？</strong></summary>

这两个环境它都能运行，但可用能力少于 Figma Design——这是因为那些编辑器给插件的权限更少，并非 Figwright 有所保留。

- **Figma Design**——一切功能。
- **Dev Mode**（检查面板）——仅读取与导出。Figma 在该模式下让插件处于只读状态，因此截图、PDF 导出以及所有检查工具都能用，而所有写入都会失败。这契合代码生成方向；要构建请使用 Design 模式。
- **FigJam**——画框、分区、图形与文本可用；组件、变量、样式以及 Motion 在该编辑器中并不存在，因此针对它们的工具不适用。

`get_metadata` 会报告编辑器（`editorType` / `mode`），任何因编辑器限制而失败的工具也会在错误中说明，于是智能体可以重新规划，而不是盲目重试。

</details>

<details>
<summary><strong>多个智能体能同时使用同一个插件吗？</strong></summary>

可以。多个 MCP 服务器可以通过领导者/追随者 **选举** 机制共享同一个插件——一个主导，其余跟随；若领导者退出，会平滑交接。

</details>

## 名称由来

`figwright` 沿用了 **_-wright_** 的传统——这是一个古英语词，意为「制造者」或「工匠」：playwright 写戏剧，shipwright 造船，wheelwright 造轮子。这个名字也向自动化的浏览器工具 [**Playwright**](https://playwright.dev) 致意。Playwright 驱动浏览器，**Figwright** 驱动 Figma——一个既读取画布、又把作品创作回画布上的「设计工匠」。

## 许可证

[MIT](./LICENSE) © Roya

---

基于 [**@awdr74100/figwright**](https://github.com/awdr74100/figwright) 的 MIT 许可 fork。**再次感谢原作者 @awdr74100（Roya）的开源工作。**
