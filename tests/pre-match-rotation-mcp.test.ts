import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createFmMcpServer } from '../mcp/server.ts'

afterEach(() => vi.unstubAllGlobals())

describe('赛前轮换 MCP', () => {
  it('向 Agent API 传递赛前阈值，而不是被输入校验丢弃', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = createFmMcpServer({ server: 'http://example.test', token: 'test' })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const result = await client.callTool({ name: 'set_auto_subs', arguments: { plan: { timed: [], staminaBelow: null, onInjury: false, preMatchStaminaBelow: 75 } } })
      expect(result.isError).toBeFalsy()
      expect(fetchMock).toHaveBeenCalledOnce()
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(JSON.parse(String(init.body))).toMatchObject({ action: 'set_auto_subs', plan: { preMatchStaminaBelow: 75 } })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
