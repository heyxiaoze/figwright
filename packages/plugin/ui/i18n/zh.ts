/**
 * 简体中文文案，与 `en.ts` 的键一一对应。
 *
 * 译文遵循「专业、一致」的原则：不直译口语化表达，保持产品语气统一。占位符 `{name}` 由 `t()` 填充。
 */

import type { Messages } from './en.js';

export const zh: Messages = {
  // --- 标签页 --------------------------------------------------------------------------------
  'tab.activity': '活动',
  'tab.context': '上下文',
  'tab.debug': '调试',
  'tab.settings': '设置',

  // --- 连接状态（顶部） ----------------------------------------------------------------------
  'status.idle': '空闲',
  'status.connecting': '连接中',
  'status.connected': '已连接',
  'status.reconnecting': '重连中',
  'status.disconnected': '已断开',

  // --- 底栏 ----------------------------------------------------------------------------------
  'footer.calls': '{n} 次调用',
  'footer.failed': '{n} 次失败',

  // --- 窗口控件 ------------------------------------------------------------------------------
  'bg.title': '后台运行 —— 隐藏面板但保持中继连接。再次运行插件即可恢复。',
  'bg.label': '后台运行',
  'grip.title': '拖动以调整大小',

  // --- 复制按钮 / 数据块 ---------------------------------------------------------------------
  'copy.copied': '已复制',
  'payload.truncatedBlock': '仅显示前半部分 —— 完整结果更长。',
  'payload.truncatedPreview': '…（为显示已截断）',

  // --- 活动标签页 ----------------------------------------------------------------------------
  'activity.connectedIdle': '已连接，空闲中',
  'activity.waitingClient': '等待 MCP 客户端',
  'activity.idleHint': '你的智能体发起的工具调用会显示在这里。',
  'activity.waitHint': '启动你的智能体 —— 本面板会自动连接。',

  // --- 活动行 --------------------------------------------------------------------------------
  'row.revealAria': '在画布上定位 {method} 涉及的节点',
  'row.revealTitle': '选中并放大到本次调用涉及的节点',
  'row.started': '开始时间 {time}',
  'row.error': '错误',
  'row.request': '请求',
  'row.payloadLlm': '发送至 LLM 的数据',

  // --- 上下文标签页 --------------------------------------------------------------------------
  'ctx.file': '文件',
  'ctx.page': '页面',
  'ctx.editor': '编辑器',
  'ctx.selection': '选区（{n}）',
  'ctx.more': '…另有 {n} 个',
  'ctx.nothingSelected': '未选择任何内容',
  'ctx.waiting': '正在等待插件上下文……',
  'editor.dev':
    '开发模式禁止一切写入操作 —— 节点、页面、变量与样式均不可写。读取、导出（截图、PDF）及插件数据仍可正常使用。' +
    '如需修改，请将文件切换到设计模式。',
  'editor.figjam':
    'FigJam 没有组件、变量或样式，因此读取或编辑它们的工具会在该环境下失败 —— 但画框、分区、形状与文本均正常。' +
    '其余功能请在 Figma Design 文件中使用。',

  // --- 调试标签页 ----------------------------------------------------------------------------
  'dbg.connection': '连接',
  'dbg.session': '会话',
  'dbg.resumed': '（已恢复）',
  'dbg.reconnects': '重连次数',
  'dbg.plugin': '插件',
  'dbg.server': '服务器',
  'dbg.calls': '调用',
  'dbg.total': '总数',
  'dbg.failed': '失败',
  'dbg.avg': '平均（近期）',
  'dbg.recentErrors': '近期错误',
  'dbg.noErrors': '无错误。',
  'dbg.diagnostics': '诊断',
  'dbg.copyBundle': '复制诊断包',
  'dbg.bundleHint': '用于错误报告 · 包含你的设计内容。',

  // --- 设置标签页 ----------------------------------------------------------------------------
  'set.language': '语言',
  'set.quickConnect': '快速连接（邀请串）',
  'set.quickConnectHint':
    '将服务器启动日志中的“invite”一行完整粘贴进来，即可自动填写主机 / 端口，无需手动输入。',
  'set.invitePlaceholder': 'figwright://connect?host=…&port=3055',
  'set.fillIn': '填入',
  'set.inviteError': '无法识别的邀请串：应以 figwright://connect? 开头，且包含 host / port。',
  'set.connection': '连接',
  'set.connectionHint':
    '插件通过该地址连接到 Figwright 服务器。中继仅限本地回环，因此插件必须与服务器运行在同一台机器上 —— ' +
    '默认的 127.0.0.1 即可让一切保持本地连通。仅当服务器绑定了其他本地地址时，才需要修改主机 / 端口。',
  'set.host': '主机',
  'set.hostPlaceholder': '127.0.0.1',
  'set.port': '端口',
  'set.portError': '请输入 1 到 65535 之间的端口。',
  'set.connectionTarget': '连接地址',
  'set.copy': '复制',
  'set.copied': '{label}已复制',
  'set.copyFailed': '{label}复制失败',
  'set.saveReconnect': '保存并重新连接',
  'set.resetLoopback': '重置为本地回环',
  'set.diagnostics': '连接诊断',
  'set.connected': '已连接',
  'set.connectedServer': '（服务器 v{v}）',
  'set.currentStatus': '当前状态：{status}',
  'set.versionNotice': '版本提示：{notice}',
  'set.testConnection': '测试连接',
  'set.testing': '测试中……',
  'set.testTimeout': '超时：3 秒内未能建立连接。',
  'set.connError':
    '无法连接 —— 请确认主机 / IP 与端口正确、服务器已启动，且本机网络可以访问该地址。',
  'set.testHandshakeHint': '使用当前表单的主机 / 端口临时握手一次，不影响已保存的连接。',
  'set.copyTargetLabel': '连接地址',

  // --- Relay 客户端（连接错误，由插件内生成） ------------------------------------------------
  'relay.noServer':
    '尚未在 :{ports} 上发现 Figwright 服务器 —— MCP 服务器启动后会自动连接；若始终未连接，可能是其他进程占用了该端口。',
  'relay.socketErrorPort': '端口 {port} 发生套接字错误',
  'relay.decodeFailure': '解码失败：{message}',
  'relay.helloRejected': '握手被拒绝：{message}',
  'relay.socketClosed': '端口 {port} 在握手前套接字已关闭',
  'relay.socketError': '套接字错误',
  'relay.noHandler': '未注册对应的工具处理器（method={method}）',

  // --- 数据预览 ------------------------------------------------------------------------------
  'payload.elided': '‹已省略 {n} 个字符›',

  // --- 相对时间 ------------------------------------------------------------------------------
  'time.now': '刚刚',
  'time.seconds': '{s}秒',
  'time.minutes': '{m}分',
  'time.hours': '{h}时',

  // --- 致命挂载错误（面向开发者） ------------------------------------------------------------
  'fatal.error': '错误：{msg}',
  'fatal.rejection': '未处理的拒绝：{msg}',

  // --- 来自服务器的提示（版本偏差 / 协议不匹配） ----------------------------------------------
  'notice.protocolMismatch':
    '协议版本不匹配：服务器使用 {server}，插件使用 {plugin}。请更新其中较旧的一半使两者一致' +
    '（服务器端：@figwright/mcp；插件端：重新导入最新版本），然后在 Figma 中重新打开本插件。',
  'notice.skew':
    'Figwright 插件（v{plugin}）低于服务器（v{server}）；本次结果未经校验 —— 部分编辑可能未生效，读取可能不完整。' +
    '请更新插件：从 {url} 下载最新 Figwright-Plus 并重新导入 Figma（Plugins → Development → Import plugin from manifest）。',
};
