#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createFmMcpServer } from './server.ts'

const token = process.env.FM_AGENT_TOKEN?.trim()
if (!token) {
  console.error('[fm-mcp] 缺少 FM_AGENT_TOKEN：请在游戏账号面板生成 fm_... 令牌，再填入 MCP 配置。')
  process.exit(1)
}

const serverUrl = (process.env.FM_SERVER?.trim() || 'http://127.0.0.1:8787').replace(/\/$/, '')
const server = createFmMcpServer({ server: serverUrl, token })
const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[fm-mcp] 已启动：${serverUrl}`)

const shutdown = () => {
  void server.close().finally(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
