import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createFmMcpServer } from '../mcp/server.ts'

afterEach(() => vi.unstubAllGlobals())

async function connectMcp() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const server = createFmMcpServer({ server: 'http://example.test', token: 'test' })
  const client = new Client({ name: 'test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    fetchMock,
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

describe('MCP 与 Agent API 完整同步校验', () => {
  it('所有联机可用的 Agent API 动作均已注册为 MCP 工具，且移除已废弃工具', async () => {
    const { client, close } = await connectMcp()
    try {
      const { tools } = await client.listTools()
      const mcpTools = new Set(tools.map((tool) => tool.name))

      // 从 server/agent.ts 自动提取全部 switch case 动作，防止后续新增 API 漏同步 MCP
      const agentSrc = fs.readFileSync(path.resolve('server/agent.ts'), 'utf8')
      const agentActions = [...agentSrc.matchAll(/case '([a-z0-9_]+)':/g)].map((m) => m[1]!)
      const onlineExtraActions = [
        'bid_free_agent',
        'get_world',
        'get_chat',
        'send_chat',
        'sign_club_player',
        'respond_offer',
        'rename_club',
        'start_world_friendly',
      ]
      const excluded = new Set(['buy_free_agent']) // 单机专用，联机明确改用 bid_free_agent

      const expected = [...new Set([...agentActions, ...onlineExtraActions])].filter((name) => !excluded.has(name))
      const missing = expected.filter((name) => !mcpTools.has(name))
      expect(missing, `以下 Agent API 动作未同步注册到 mcp/server.ts：${missing.join(', ')}`).toEqual([])

      expect(mcpTools.has('get_state')).toBe(true)
      expect(mcpTools.has('get_docs')).toBe(true)
      expect(mcpTools.has('choose_club')).toBe(false)
    } finally {
      await close()
    }
  })

  it('新增与扩展参数（喊话、成就领取、autoShout、高级自动换人、2000 目标值）均完整透传不被 Zod 吞掉', async () => {
    const { client, fetchMock, close } = await connectMcp()
    try {
      // 1. match_shout（全队 + 单人点名）
      const r1 = await client.callTool({ name: 'match_shout', arguments: { kind: 'fire_up', targetPlayerId: 'home-p1' } })
      expect(r1.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'match_shout',
        kind: 'fire_up',
        targetPlayerId: 'home-p1',
      })

      // 2. set_auto_shout
      const r2 = await client.callTool({ name: 'set_auto_shout', arguments: { enabled: true } })
      expect(r2.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'set_auto_shout',
        enabled: true,
      })

      // 3. claim_achievement
      const r3 = await client.callTool({ name: 'claim_achievement', arguments: { id: 'feat_league_streak_5' } })
      expect(r3.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[2] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'claim_achievement',
        id: 'feat_league_streak_5',
      })

      // 4. set_lineup 保留 lineup.autoShout
      const r4 = await client.callTool({
        name: 'set_lineup',
        arguments: {
          lineup: {
            formationId: '4-4-2',
            starters: [{ slotId: 'gk', playerId: 'p1' }],
            bench: ['p2'],
            autoShout: true,
          },
        },
      })
      expect(r4.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[3] as unknown as [string, RequestInit])[1].body))).toMatchObject({
        action: 'set_lineup',
        lineup: { autoShout: true },
      })

      // 5. set_auto_subs 保留 staminaPositions / staminaMinMinute / preferBy / conditionRules
      const advancedPlan = {
        timed: [],
        staminaBelow: 55,
        preMatchStaminaBelow: 70,
        staminaPositions: ['W', 'CM', 'ST'],
        staminaMinMinute: 60,
        preferBy: 'stamina',
        conditionRules: [
          { targetKind: 'position', targetValue: 'ST', staminaBelow: 68, minMinute: 55, scoreState: 'trailing' },
        ],
        onInjury: true,
      }
      const r5 = await client.callTool({ name: 'set_auto_subs', arguments: { plan: advancedPlan } })
      expect(r5.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[4] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'set_auto_subs',
        plan: advancedPlan,
      })

      // 6. set_auto_training 允许 1501–2000 的突破/上限目标值
      const r6 = await client.callTool({
        name: 'set_auto_training',
        arguments: { playerId: 'p1', mode: 'targets', targets: { shooting: 1850 } },
      })
      expect(r6.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[5] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'set_auto_training',
        playerId: 'p1',
        mode: 'targets',
        targets: { shooting: 1850 },
      })

      // 7. set_training_books 与 start_training 允许第 3 赛季起的 5 张技能卡
      const fiveBooks = ['lg_drill_master:rainbow', 'lg_vision_master:rainbow', 'lg_marathon:rainbow', 'lg_low_drive:gold', 'lg_leader:gold']
      const r7 = await client.callTool({ name: 'set_training_books', arguments: { playerId: 'p1', bookKeys: fiveBooks } })
      expect(r7.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[6] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'set_training_books',
        playerId: 'p1',
        bookKeys: fiveBooks,
      })

      const r8 = await client.callTool({ name: 'start_training', arguments: { playerId: 'p1', bookKeys: fiveBooks } })
      expect(r8.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[7] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'start_training',
        playerId: 'p1',
        bookKeys: fiveBooks,
      })

      // 8. send_chat 支持附带晒角色卡与晒战报 share（且传 share 时 text 可省略）
      const r9 = await client.callTool({ name: 'send_chat', arguments: { share: { kind: 'card', cardId: 'card-7' } } })
      expect(r9.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[8] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'send_chat',
        share: { kind: 'card', cardId: 'card-7' },
      })

      const r10 = await client.callTool({
        name: 'send_chat',
        arguments: { text: '神级逆转！', share: { kind: 'match', recordId: 'match-99' } },
      })
      expect(r10.isError).toBeFalsy()
      expect(JSON.parse(String((fetchMock.mock.calls[9] as unknown as [string, RequestInit])[1].body))).toEqual({
        action: 'send_chat',
        text: '神级逆转！',
        share: { kind: 'match', recordId: 'match-99' },
      })
    } finally {
      await close()
    }
  })
})
