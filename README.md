<div align="center">

# Figwright Plus

**Let AI agents drive your Figma — across the room or across the LAN.**

A self-hosted bridge between Figma and any MCP-capable agent (Claude Code, Cursor, and more), with a web console to manage the whole stack, remote access for collaborators, and per-peer permission scoping.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Console](https://img.shields.io/badge/Feature-Web%20Console-8a2be2)](./doc/console.md)
[![Remote MCP](https://img.shields.io/badge/Feature-Remote%20MCP-2e8b57)](./doc/peers.md)
[![Bilingual](https://img.shields.io/badge/UI-中文%20%2F%20English-ff8c00)](./doc/README.md)

</div>

> 📘 **Documentation:** Full guides are in [`doc/`](./doc/README.md) — available in **English and 中文**.
> 🀄 **中文文档：** 完整使用指南见 [`doc/README.md`](./doc/README.md)（中英双语）。

---

## What it is

Figwright Plus connects a **local MCP server** to the **Figma plugin** on your machine, so an AI agent can actually *operate* Figma — read a selection into framework-aware code, or build designs back onto the canvas — instead of just looking at it.

On top of that core bridge, Figwright Plus adds what teams need to use it for real:

- **Web console** — manage the whole stack from the browser: start/stop/restart the relay, watch live state, manage tokens and peers, audit activity.
- **Remote MCP** — expose a Streamable HTTP endpoint so a colleague's agent reaches *your* Figma without installing the plugin.
- **Per-peer tokens** — issue scoped **read-only** or **read-write** tokens so you decide exactly what each collaborator can do.
- **Structured audit** — the server emits `[peer]` / `[audit]` log lines the console parses into a live activity feed.
- **Asset transfer** — hand generated assets to peers via Inline, WebDAV, or SFTP.
- **Bilingual UI** — the console and plugin switch between **中文 / English**, with preferences saved locally.

Everything runs on your machine and talks to Figma through the official Plugin API — **no Figma Dev Mode seat and no paid plan required**.

## How it works

```text
 MCP CLIENTS (Claude Code · Cursor · remote agents)
        │  stdio  ·  /mcp (Streamable HTTP for peers)
        ▼
 @figwright/mcp  ── local WebSocket (msgpack) ──▶  FIGMA plugin  ──▶  Canvas
        ▲                                                   │
   Web Console (:3056, 127.0.0.1)              Figma Plugin API
   starts & supervises the relay
```

The console (`:3056`) launches and supervises the relay (`:3055`). Local agents connect over stdio; peers connect over the HTTP `/mcp` endpoint or a `figwright://` invite link. All state-changing requests require a valid token.

## Features at a glance

| Capability | Notes |
| :--- | :--- |
| **Bidirectional** | **113 MCP tools** — read designs *and* write them back to the canvas. |
| **Stack-aware codegen** | Reuses your real components, design tokens, and icons. |
| **Web console** | Zero-dependency dashboard; live stats, tokens, peers, audit, log. |
| **Remote collaboration** | `mcp-remote` or `http` MCP clients connect to your relay over LAN. |
| **Token scoping** | Read-only / read-write per peer; rotate anytime. |
| **Audit & observability** | Structured logs parsed into a live activity feed. |
| **Asset transfer** | Inline / WebDAV / SFTP for handing assets to peers. |
| **Bilingual** | 中文 / English in both console and plugin. |

## Quick start

```bash
git clone https://github.com/heyxiaoze/figwright.git
cd figwright          # rename the folder to figwright-plus if you like
pnpm install
pnpm --filter @figwright/mcp build
node scripts/dashboard.mjs        # console at http://127.0.0.1:3056
```

Then import the plugin from the latest GitHub Release and open it in Figma. Full steps → [doc/getting-started.md](./doc/getting-started.md).

## Documentation

| Guide | English | 中文 |
| :--- | :--- | :--- |
| Documentation hub | [doc/README.md](./doc/README.md) | [doc/README.md](./doc/README.md) |
| Getting started | [doc/getting-started.md](./doc/getting-started.md) | [doc/getting-started.md](./doc/getting-started.md) |
| Peers & collaboration | [doc/peers.md](./doc/peers.md) | [doc/peers.md](./doc/peers.md) |
| Skills | [doc/skills.md](./doc/skills.md) | [doc/skills.md](./doc/skills.md) |
| Console reference | [doc/console.md](./doc/console.md) | [doc/console.md](./doc/console.md) |

Every guide is bilingual — switch languages via the link at the top of each page.

## Security

Figwright Plus runs entirely on your machine. Exposing the relay to a network (LAN / remote) **removes the default loopback boundary**, so:

- **Token auth is mandatory** for any non-loopback connection.
- The relay validates `Host` (blocks DNS rebinding) and `Origin` on every request.
- Keep LAN / remote mode behind a trusted network, pin `FIGWRIGHT_TOKEN`, and don't expose port `3055` past your firewall.

Treat tokens like passwords. Figwright Plus does not replace your own review of agent actions — its write tools modify your Figma files.

## Attribution

Figwright Plus is a fork of [**Figwright**](https://github.com/awdr74100/figwright) by **[@awdr74100 (Roya)](https://github.com/awdr74100)**, released under the **MIT License**. This project builds on that work and is grateful for the original author's open-source contribution.

- Original repository: <https://github.com/awdr74100/figwright>
- This fork's repository: <https://github.com/heyxiaoze/figwright>

We do not regularly upstream changes. For the official version or to contribute upstream, please visit the original repository.

## License

[MIT](./LICENSE) © Roya — see [LICENSE](./LICENSE).
