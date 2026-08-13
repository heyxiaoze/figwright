<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg">
  <img alt="Figwright" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/logo-full-light.svg" width="480" height="240">
</picture>

Playwright 驱动浏览器，Figwright 驱动 Figma。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![LAN listen mode](https://img.shields.io/badge/Feature-LAN%20listen%20mode-8a2be2)](https://github.com/heyxiaoze/figwright#lan-mode-connect-across-machines)

</div>

## Figwright 是什么？

Figwright 通过本地 WebSocket 中继，把一个 **MCP 服务器** 连接到一个 **Figma 插件**，让 AI 智能体——Claude Code、Cursor、Codex，或任何支持 MCP 的客户端——能够真正「操作」Figma，而不只是看着它。

它的能力是双向的：

**读取**——将 Figma 选区转换为「懂框架」的代码，基于忠实且去重的设计上下文（布局、排版、变量、组件）。

<p align="center">
  <img alt="Figwright turning a Figma selection into code" src="https://raw.githubusercontent.com/awdr74100/figwright/HEAD/.github/figma-to-code.gif" width="820">
</p>

**写入**——直接在画布上创作与编辑：画框、文本、自动布局、样式、变量、组件，乃至完整界面。

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

## 快速开始

### 1. 从本仓库构建并运行服务器

本仓库的 LAN 监听模式**尚未**发布到 npm，因此请从源码构建服务器：

```bash
git clone https://github.com/heyxiaoze/figwright.git
cd figwright
pnpm install
pnpm -C packages/mcp build
```

然后把你的 MCP 客户端指向构建好的服务器。以 Claude Code 为例，把下面内容加入你的 `.mcp.json`（其他客户端格式相同）：

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

若要启用 LAN 模式，请添加一个 `env` 字段，写入 `FIGWRIGHT_HOST` 和 `FIGWRIGHT_TOKEN`——详见 [LAN 模式](#lan-mode-connect-across-machines) 与 `.mcp.json.lan.example`。

### 2. 安装 Figma 插件

该插件尚未上架 Figma 社区市场，请从最新的 Release 安装：

1. 从 [**最新 GitHub Release**](https://github.com/heyxiaoze/figwright/releases/latest) 下载插件 zip 并解压。
2. 在 Figma **桌面客户端**中：**菜单 → 插件 → 开发 → 从清单导入插件…**，选择解压后的 `manifest.json`。

### 3. 连接

在 Figma 中打开 Figwright 插件（**插件 → 开发 → Figwright**）。它会自动连接到本地服务器并显示 **已连接**。让智能体运行 `ping` 以确认链路通畅。

### 4.（可选）安装技能

[技能](#技能) 让智能体在恰当的时机调用 Figwright，并遵循这些扎根于上下文的工作流：

```bash
npx skills add heyxiaoze/figwright/skills
```

### 5. 上手试试

在 Figma 中选中一个画框，给你的智能体这样提示：

> _Code this Figma selection as a React component._

或者反过来：

> _Build a pricing section in Figma from this spec._

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

Figwright 提供 **112 tools**（共 **112 个 MCP 工具**），分为三组：

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

Figwright 完全运行在你的机器上：你的客户端通过 stdio 启动服务器，服务器通过 `127.0.0.1:3055` 上的 WebSocket 把消息中继给插件，数据不会发往任何别处。插件只使用 Figma 公开的 Plugin API，因此它只能访问你当前打开的文件，不会越界。

回环地址本身并不是一道边界——你访问的网页仍可能连上本地端口——因此中继对每一个请求都基于两个网页无法伪造的请求头进行校验：**`Host`**（必须指向回环地址，这正是阻止 DNS 重绑定的关键）与 **`Origin`**（仅放行插件沙箱内的握手，拒绝来自其他浏览器的请求）。领导者的 HTTP 端点还要求一种不经过 CORS 预检就无法发送的内容类型。更宏观的视角请参见 [MCP 安全最佳实践](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)；Figwright 的威胁模型、范围边界以及漏洞私下上报方式，详见 [SECURITY.md](./SECURITY.md)。

**Figwright 不能替代你对智能体行为的审查。** 它的写入工具会改动你的 Figma 文件，导出工具会把文件写到智能体所选的路径；一个针对恶意设计或被提示注入操控的智能体，可能滥用这两者。真正起作用的边界，是你 MCP 客户端的工具审批控制。

## LAN mode (connect across machines)

默认情况下，中继只监听 `127.0.0.1`——即仅回环——因此插件必须与你的 MCP 客户端运行在**同一台机器**上。LAN 模式改为把中继绑定到某个网络接口，这样**同一网络下另一台机器**上的插件（或通过本机 LAN 地址访问的本机插件）就能连上来。

### 配置服务器

服务器读取三个环境变量。`FIGWRIGHT_PORT` 此前已存在；另外两个新变量用于开关 LAN 模式：

| 变量 | 默认值 | 含义 |
| :--- | :--- | :--- |
| `FIGWRIGHT_HOST` | `127.0.0.1` | 中继绑定的主机。填一个 LAN IP（如 `192.168.1.42`）或 `0.0.0.0` 即可监听所有接口。**任何非回环的值都会开启 LAN 模式。** |
| `FIGWRIGHT_TOKEN` | *(自动)* | 连接插件必须出示的共享密钥。在 LAN 模式下，若未设置，服务器会在启动时生成一个随机的 24 字节令牌并打印到日志。请设成一个稳定值，这样插件配置在重启后依然有效。 |
| `FIGWRIGHT_PORT` | `3055` | 中继端口。 |

`.mcp.json` 示例（开箱即用的副本见 [`.mcp.json.lan.example`](./.mcp.json.lan.example)）：

```json
{
  "mcpServers": {
    "figwright": {
      "command": "npx",
      "args": ["-y", "@figwright/mcp"],
      "env": {
        "FIGWRIGHT_HOST": "0.0.0.0",
        "FIGWRIGHT_TOKEN": "replace-with-a-long-random-string"
      }
    }
  }
}
```

使用 `0.0.0.0` 时，中继监听所有接口；此时 `ping` 会返回一个 `lanUrl`，列出每个可达的 `ws://<ip>:<port>` 目标。绑定到具体的 LAN IP 则收紧一些。

### 连接插件

最快的方式是使用服务器启动时打印的**邀请串（invite）**：

- 服务器在 LAN 模式下启动后，日志里会有一行 `invite: figwright://connect?host=…&port=3055&token=…`。
- 在另一台机器的 Figma 中打开插件，切到 **设置（Settings）** 标签页，把这一整行粘贴进顶部的「快速连接（邀请）」输入框，点 **填入**——Host / Port / Token 会一次性自动填好，免去手抄长令牌。

也可以手动逐项填写：

- **主机（Host）**——服务器所在机器的 LAN IP（或 `0.0.0.0` 所报告的网络接口地址之一）。
- **端口（Port）**——`FIGWRIGHT_PORT`（默认 `3055`）。
- **令牌（Token）**——你设置的 `FIGWRIGHT_TOKEN`（或服务器日志中自动生成的那个）。

保存后，插件会重新连接到远程中继。设置标签页会在主机非回环时强制要求填写令牌；而 **恢复为回环** 按钮会回到默认的 `127.0.0.1:3055` 且不含令牌。

#### 连接诊断

连不上时不必瞎猜：设置标签页的 **连接诊断** 区块会显示当前状态，并把失败原因翻译成人话——

- **Token 被拒 / 握手失败** → 令牌不对，或服务器没开 LAN 模式；
- **无法连接 / 超时** → Host 或端口填错、服务器没启动、或本机网络不可达。

你也可以在保存前点 **测试连接**，用当前表单的 Host / Port / Token 临时握手一次（不影响已保存的连接），立刻知道能不能通。插件顶部的状态条在断开时也会直接显示失败原因。

你也可以让智能体运行 `ping`：在 LAN 模式下，其结果会包含 `lanUrl`、`token` 和一个可直接粘贴的 `invite` 字段，于是智能体能把连接信息一次性交给你。

### LAN 模式下的安全模型

把中继暴露到网络上，**会移除默认部署所依赖的回环边界**，因此 LAN 模式与安全的「仅本地」部署 *并不* 等同。为此：

- **令牌认证是强制的。** 每一次 WebSocket 升级都必须以 WebSocket 子协议 *和* `$hello` 握手两种方式出示令牌；每一个会改变状态的 HTTP POST（`/rpc`、`/abdicate`）都必须携带 `x-figwright-token` 请求头。缺少有效令牌的请求会被拒绝（403）。回环模式下则不使用令牌。
- **`Host` 闸门依然开启**，只是范围放宽。中继仍会校验 `Host` 头——现在除了回环地址，也放行 LAN 地址，但拒绝任何指向外部主机的请求——从而保住 DNS 重绑定防御。只读的 `/ping` 仍可被公开访问，便于你发现服务器，但它绝不会泄露超出连接信息之外的内容。
- **链路本地与仅内部的地址会被过滤**——在公布的 `lanUrl` 中剔除这类地址，避免你不小心给出一个不可达的目标。

请把令牌当作密码对待：任何人只要得知它（且能访问该端口），就能驱动你的 Figma 插件。请将 LAN 模式置于可信网络之后，固定 `FIGWRIGHT_TOKEN`，并不要让端口越过防火墙暴露出去。如果你只需要在同一台机器上使用插件，就保持默认的回环绑定——无令牌，也无任何网络暴露面。

## 常见问题（FAQ）

<details>
<summary><strong>服务器无法启动——<code>command not found</code>，或以 <code>-32000</code>（"Connection closed"）失败/断开。</strong></summary>

两者都源于你的 MCP 客户端启动服务器的方式：它直接 `spawn` 那个 `command`，**而非**通过你的交互式 shell，因此它不会继承你在 shell 里设置的任何环境。当 Node 由版本管理器（**fnm、nvm、asdf、volta、mise**）管理时，这一点最致命——它们通过只在真实终端里才运行的 shell 钩子来配置 `PATH` 和 npm。这并非 Figwright 特有——任何以 `npx` 启动的 MCP 服务器都会受影响。下面有两种症状，对应两种不同的修复。

**`command not found`——客户端在 `PATH` 上找不到 `npx` / `node`。**

- **使用绝对路径。** 在普通终端里运行 `which npx`（或 `which node`），把得到的完整路径作为 `command`：

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "/Users/you/.local/share/fnm/node-versions/v24.x.x/installation/bin/npx",
        "args": ["-y", "@figwright/mcp@latest"]
      }
    }
  }
  ```

- **或者通过 `env` 传递 `PATH`。** 若你的客户端支持按服务器的 `env`，把版本管理器的 `bin` 目录加入 `env.PATH`。

**`-32000` / "Connection closed" / 始终连不上——`npx` 能跑起来，但服务器在握手前就退出了。**

`npx … @latest` 会在**每次**启动时都重新从注册表解析包。在直接 spawn 的环境里，这一步可能失败或卡住——npm 配置为空或与预期不同、公司代理或私有注册表在那里未配置、或根本没有网络——于是进程在 MCP 连接前就死掉，客户端便报告连接已关闭。（二进制脚本的 shebang 找不到 `node` 也会落到这里。）

修复办法是把包安装好，让启动不再需要拉取注册表：

- **作为项目依赖——最快的解法。** 先安装它，然后从配置里**去掉 `@latest`**。`@latest` 这个标签正是强制走注册表的元凶；去掉后，`npx` 会直接用 `node_modules` 里已有的副本（像 Claude Code 的 `.mcp.json` 这种项目级配置，会从你的项目根目录运行）：

  ```bash
  pnpm add -D @figwright/mcp   # or: npm i -D @figwright/mcp
  ```

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "npx",
        "args": ["-y", "@figwright/mcp"]
      }
    }
  }
  ```

- **或者全局安装，直接指向二进制。** 安装一次，然后把 `command` 直接指向它——没有 `npx`，也没有每次启动的解析。用 `which figwright-mcp` 得到的绝对路径：

  ```bash
  npm i -g @figwright/mcp
  which figwright-mcp
  ```

  ```json
  {
    "mcpServers": {
      "figwright": {
        "command": "/absolute/path/to/figwright-mcp"
      }
    }
  }
  ```

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
- **Dev Mode**（检查面板）——仅读取与导出。Figma 在该模式下让插件处于只读状态，因此截图、PDF 导出以及所有检查工具都能用，而所有写入都会失败——节点、页面、变量、样式全都如此。这契合代码生成方向；要构建请使用 Design 模式。
- **FigJam**——画框、分区、图形与文本可用；组件、变量、样式以及 Motion 在该编辑器中并不存在，因此针对它们的工具不适用。

`get_metadata` 会报告编辑器（`editorType` / `mode`），任何因编辑器限制而失败的工具也会在错误中说明，于是智能体可以重新规划，而不是盲目重试。

</details>

<details>
<summary><strong>多个智能体能同时使用同一个插件吗？</strong></summary>

可以。多个 MCP 服务器可以通过领导者/追随者 **选举** 机制共享同一个插件——一个主导，其余跟随；若领导者退出，会平滑交接。

</details>

## 贡献指南

欢迎贡献。关于如何搭建环境并提交 Pull Request，请参阅 **[CONTRIBUTING.md](./CONTRIBUTING.md)**；关于架构、仓库布局、技术栈与规范，请参阅 **[AGENTS.md](./AGENTS.md)**。

## 名称由来

`figwright` 沿用了 **_-wright_** 的传统——这是一个古英语词，意为「制造者」或「工匠」：playwright 写戏剧，shipwright 造船，wheelwright 造轮子。这个名字也向自动化的浏览器工具 [**Playwright**](https://playwright.dev) 致意。Playwright 驱动浏览器，**Figwright** 驱动 Figma——一个既读取画布、又把作品创作回画布上的「设计工匠」。

## 致谢

Figwright 起源于 [**@awdr74100**](https://github.com/awdr74100)（Roya）发布的 [**figwright**](https://github.com/awdr74100/figwright)，采用 MIT 许可证。本项目建立在这一基础之上——感谢其开源。

## 许可证

[MIT](./LICENSE) © Roya
