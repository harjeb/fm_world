import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createFmMcpServer } from '../mcp/server.ts'

afterEach(() => vi.unstubAllGlobals())

describe('细分位置 MCP', () => {
  it('位置训练请求保留细分位置及 ST 区分标记', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = createFmMcpServer({ server: 'http://example.test', token: 'test' })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const request = { kind: 'activity', activityId: 'position', position: 'DL', detailed: true }
      const result = await client.callTool({ name: 'training_action', arguments: { playerId: 'p1', request } })
      expect(result.isError).toBeFalsy()
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(JSON.parse(String(init.body))).toMatchObject({ action: 'training_action', playerId: 'p1', request })
      const legacy = { kind: 'position', position: 'ST', detailed: true }
      const result2 = await client.callTool({ name: 'training_action', arguments: { playerId: 'p1', request: legacy } })
      expect(result2.isError).toBeFalsy()
      const [, init2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
      expect(JSON.parse(String(init2.body)).request).toEqual(legacy)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
