# Skills — Agent Workflows

Skills are packaged agent workflows that tell an MCP-capable client *when* and *how* to drive Figwright. They are model-triggered: when a task matches a skill's description, your agent loads it automatically and follows the embedded, context-grounded procedure.

Figwright Plus ships two skills:

| Skill | Direction | What it does |
| :--- | :--- | :--- |
| `figma-codegen` | **Figma → code** | Turns a Figma selection into framework-aware code, reusing your existing components, design tokens, and icons. |
| `figma-build` | **code → Figma** | Builds a Figma design from code or a description, reusing components and styles already in the file. |

## Install

Install both into any supported agent (Claude Code, Cursor, etc.):

```bash
npx skills add heyxiaoze/figwright/skills
```

Or just one:

```bash
npx skills add https://github.com/heyxiaoze/figwright/tree/main/skills/figma-codegen
```

> A skill is only useful when the `@figwright/mcp` relay is connected — without it, the skill has no tools to drive.

## How they trigger

You don't invoke skills manually. Describe the work in natural language and the agent picks the right one:

- *"Make this Figma card a React + Tailwind component."* → `figma-codegen`
- *"Recreate this section in Figma from the spec."* → `figma-build`

## Tips & best practices

1. **Keep the relay connected.** Skills fail silently if the plugin isn't open or the relay is down — open the plugin in Figma first.
2. **Scope with tokens.** For a remote colleague, issue a **read-only** token so `figma-codegen` (read) works while `figma-build` (write) is blocked on their side.
3. **Let the agent drive the selection.** Select the frame in Figma *before* prompting; the skill reads the current selection rather than guessing.
4. **Combine with the console.** Watch the **Activity** and **Live log** cards in the console to see exactly what the skill sent to the model and to Figma — useful when output looks off.
5. **Iterate in Figma.** Because `figma-build` writes to the canvas, review the result in Figma and ask for adjustments; the skill reuses existing components so follow-ups stay consistent.

---

# 技能 — 智能体工作流

技能是封装好的智能体工作流，告诉支持 MCP 的客户端*何时*以及*如何*驱动 Figwright。它由模型触发：当任务与某技能的描述匹配时，智能体会自动加载并遵循其中扎根于上下文的流程。

Figwright Plus 内置两个技能：

| 技能 | 方向 | 作用 |
| :--- | :--- | :--- |
| `figma-codegen` | **Figma → 代码** | 将 Figma 选区转换为懂框架的代码，复用你已有的组件、设计令牌与图标。 |
| `figma-build` | **代码 → Figma** | 从代码或描述在 Figma 中搭建设计，复用文件中已有的组件与样式。 |

## 安装

安装到任意支持的智能体（Claude Code、Cursor 等）：

```bash
npx skills add heyxiaoze/figwright/skills
```

或只装一个：

```bash
npx skills add https://github.com/heyxiaoze/figwright/tree/main/skills/figma-codegen
```

> 技能只有在 `@figwright/mcp` 中继已连接时才有用——没有它，技能无可驱动的工具。

## 触发方式

无需手动调用技能。用自然语言描述工作，智能体会自动选用合适的那一个：

- *"把这个 Figma 卡片做成 React + Tailwind 组件。"* → `figma-codegen`
- *"按规格在 Figma 里复刻这个区块。"* → `figma-build`

## 技巧与最佳实践

1. **保持中继连接。** 若插件没打开或中继宕机，技能会静默失败——先在 Figma 打开插件。
2. **用令牌分权。** 对远程同事签发**只读**令牌，`figma-codegen`（读）可用而 `figma-build`（写）在其侧被拦截。
3. **让智能体读取选区。** 提问前先在 Figma 选中画框；技能读取当前选区，而非猜测。
4. **配合控制台使用。** 在控制台**活动**与**实时日志**卡片中，可看清技能究竟向模型与 Figma 发了什么——输出不对时很有用。
5. **在 Figma 中迭代。** `figma-build` 会写入画布，在 Figma 里检查结果并提出调整；技能复用已有组件，后续修改保持一致。
