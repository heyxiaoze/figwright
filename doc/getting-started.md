# Getting Started

Launch the full Figwright Plus stack: the MCP relay that talks to Figma, and the web console that manages it.

![Console overview](screenshot/Figwright-Plus_console.png)
![Run state](screenshot/Figwright-Plus_status.png)

## Prerequisites

- **Node.js** 20.19+ or 22.12+ (Node 18/21 and 22.0–22.11 are not supported).
- **pnpm** (the workspace uses pnpm).
- **Figma desktop client** — required to import the plugin in development mode. The free Figma plan is enough.
- An **MCP client** (Claude Code, Cursor, or any MCP-capable agent).

## 1. Install & build

```bash
git clone https://github.com/heyxiaoze/figwright.git
cd figwright-plus
pnpm install
pnpm --filter @figwright/mcp build
```

> The LAN console and remote-MCP capabilities are not published to npm — build from source.

## 2. Launch the console (recommended)

The console is a zero-dependency web UI that also **starts and supervises the MCP relay** for you:

```bash
node scripts/dashboard.mjs            # starts relay + opens console at http://127.0.0.1:3056
node scripts/dashboard.mjs --no-open  # don't auto-open the browser
```

Open **http://127.0.0.1:3056** in your browser. The console shows the run state and auto-launches the relay on port **3055**.

![Run state panel](screenshot/Figwright-Plus_status.png)

Console configuration lives in `scripts/.figwright-dashboard.json` (git-ignored, contains token secrets — never commit it).

## 3. Install the Figma plugin

The plugin is not on the Figma Community — install it from the latest GitHub Release:

1. Download the plugin zip from the [**latest release**](https://github.com/heyxiaoze/figwright/releases/latest) and unzip it.
2. In the **Figma desktop client**: menu → **Plugins → Development → Import plugin from manifest…**, then select the unzipped `manifest.json`.

## 4. Connect & verify

Open the Figwright plugin in Figma (**Plugins → Development → Figwright**). It connects to the local relay and shows **Connected**. Ask your agent to run `ping` to confirm the link is alive.

## 5. (Optional) Install the agent skills

```bash
npx skills add heyxiaoze/figwright/skills
```

See [Skills](./skills.md) for what they do and how they trigger.

## Try it

Select a frame in Figma and tell your agent:

> *Turn this Figma selection into a React component.*

Or the other way around:

> *Build a pricing block in Figma from this spec.*

---

# 快速开始

启动完整的 Figwright Plus 技术栈：与 Figma 通信的 MCP 中继，以及管理它的网页控制台。

![控制台总览](screenshot/Figwright-Plus_console.png)
![运行状态](screenshot/Figwright-Plus_status.png)

## 环境要求

- **Node.js** 20.19+ 或 22.12+（不支持 Node 18/21 及 22.0–22.11）。
- **pnpm**（工作区使用 pnpm）。
- **Figma 桌面客户端** —— 开发模式导入插件所需。免费版 Figma 即可。
- 一个 **MCP 客户端**（Claude Code、Cursor 或任意支持 MCP 的智能体）。

## 1. 安装与构建

```bash
git clone https://github.com/heyxiaoze/figwright.git
cd figwright-plus
pnpm install
pnpm --filter @figwright/mcp build
```

> 局域网控制台与远程 MCP 能力尚未发布到 npm，请从源码构建。

## 2. 启动控制台（推荐）

控制台是一个零依赖网页界面，还会**自动启动并托管 MCP 中继**：

```bash
node scripts/dashboard.mjs            # 启动中继并打开控制台 http://127.0.0.1:3056
node scripts/dashboard.mjs --no-open  # 不自动打开浏览器
```

在浏览器打开 **http://127.0.0.1:3056**。控制台显示运行状态，并自动在 **3055** 端口拉起中继。

![运行状态面板](screenshot/Figwright-Plus_status.png)

控制台配置保存在 `scripts/.figwright-dashboard.json`（已被 git 忽略，含令牌机密，请勿提交）。

## 3. 安装 Figma 插件

插件尚未上架 Figma 社区，请从最新 GitHub Release 安装：

1. 从[**最新 Release**](https://github.com/heyxiaoze/figwright/releases/latest) 下载插件 zip 并解压。
2. 在 **Figma 桌面客户端**中：菜单 → **插件 → 开发 → 从清单导入插件…**，选择解压后的 `manifest.json`。

## 4. 连接并验证

在 Figma 中打开 Figwright 插件（**插件 → 开发 → Figwright**），它会自动连接本机中继并显示**已连接**。让智能体运行 `ping` 确认链路通畅。

## 5.（可选）安装智能体技能

```bash
npx skills add heyxiaoze/figwright/skills
```

技能的作用与触发方式见[技能](./skills.md)。

## 上手试试

在 Figma 中选一个画框，对你的智能体说：

> *把这个 Figma 选区写成一个 React 组件。*

或者反过来：

> *根据这个规格在 Figma 里搭一个定价区块。*
