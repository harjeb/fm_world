import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createInitialGame } from '../src/game/state.ts'
import { applyAgentAction, agentView } from '../server/agent.ts'
import { createFmMcpServer } from '../mcp/server.ts'
import { TRAINING_POINT_TIERS } from '../src/game/training.ts'
import type { PlayerCard } from '../src/game/types.ts'
import { detailedPositionForSlot, detailedPositionValue } from '../src/game/detailed-positions.ts'

afterEach(() => vi.unstubAllGlobals())

function cardFor(game: ReturnType<typeof createInitialGame>): PlayerCard {
  const player = game.roster.find(item => item.positions.GK === 0)!
  return {
    id: 'test-card', playerId: player.id, playerName: player.name, serial: 1,
    routeId: null, createdAt: 1,
    attrs: { ...player.attrs }, positions: { ...player.positions }, detailedPositions: player.detailedPositions && { ...player.detailedPositions },
    personality: { ...player.personality }, skills: [...player.skills], version: 0,
  }
}

describe('Agent API：球探、回收培养点和细分位置', () => {
  it('球探可委托、到期后可读估计属性与相对本队位置星级，并可删除', () => {
    const game = createInitialGame(9001)
    const team = game.aiTeams[0]
    const target = team.players.find(player => !game.roster.some(own => own.id === player.id))!
    const now = game.createdAt + 1000
    const started = applyAgentAction(game, { action: 'start_scouting', playerId: target.id, source: 'club', clubId: team.id, level: 1 }, now)
    expect(started.ok, started.error).toBe(true)
    const pending = (started.result as any).report
    expect(pending.estimatedAttrs).toBeUndefined()
    expect(pending.ready).toBe(false)
    const beforeReady = applyAgentAction(game, { action: 'get_scout_reports' }, now + 1000)
    expect((beforeReady.result as any).reports[0].estimatedAttrs).toBeUndefined()
    const readyAt = now + 4 * game.season.gameDayMs
    const ready = applyAgentAction(game, { action: 'get_scout_reports' }, readyAt).result as any
    expect(ready.reports[0].estimatedAttrs).toBeTruthy()
    expect(ready.reports[0].ready).toBe(true)
    expect(Array.isArray(ready.reports[0].positionRatings)).toBe(true)
    const deleted = applyAgentAction(game, { action: 'delete_scout_report', reportId: ready.reports[0].id }, readyAt)
    expect(deleted.ok).toBe(true)
    expect((deleted.result as any).reports).toHaveLength(0)
  })

  it('回收卡片获得培养点，锁定后不可回收；投入培养点会扣余额并出现在状态中', () => {
    const game = createInitialGame(9002)
    game.cards = [cardFor(game)]
    game.trainingPoints = 30
    const locked = applyAgentAction(game, { action: 'lock_card', cardId: 'test-card', locked: true })
    expect(locked.ok).toBe(true)
    expect(applyAgentAction(game, { action: 'recycle_cards', cardIds: ['test-card'] }).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'lock_card', cardId: 'test-card', locked: false }).ok).toBe(true)
    const recycled = applyAgentAction(game, { action: 'recycle_cards', cardIds: ['test-card'] })
    expect(recycled.ok).toBe(true)
    expect(game.cards).toHaveLength(0)
    expect(game.trainingPoints).toBeGreaterThan(30)
    const player = game.roster.find(item => item.energy >= 30)!
    const started = applyAgentAction(game, { action: 'start_training', playerId: player.id, points: 10 }, game.createdAt + 1000)
    expect(started.ok, started.error).toBe(true)
    expect(game.trainingPoints).toBeGreaterThan(0)
    expect(game.training[player.id].qualityBonusPoints).toBe(10)
    const state = agentView(game, game.createdAt + 1000)
    expect(state.trainingPoints).toBe(game.trainingPoints)
    expect(state.trainingPointTiers).toEqual(TRAINING_POINT_TIERS)
    expect(state.trainingSessions[0].qualityBonusPoints).toBe(10)
    expect(state.trainingSessions[0].qualityChances).toBeTruthy()
  })

  it('状态公开奖杯、杯赛上限和细分位置熟练度', () => {
    const game = createInitialGame(9003)
    game.pve!.trophies.push({ cupId: 'season-cross', cupName: '星联杯', seasonIndex: 1, wonAt: 1, finalOpponent: '对手', finalScore: { home: 1, away: 0 }, goldPrize: 1_500_000, ceilingBonus: 250 })
    const state = agentView(game, game.createdAt + 1000)
    expect(state.honors.trophies[0]).toMatchObject({ cupId: 'season-cross', goldPrize: 1_500_000, ceilingBonus: 250 })
    expect(state.honors.cupCeilingBonus).toBe(0)
    for (const slot of state.lineupAnalysis.starters) {
      const formation = state.formations.find(item => item.id === state.lineup.formationId)!
      const definition = formation.slots.find(item => item.id === slot.slotId)!
      expect(slot.detailedPosition).toBe(detailedPositionForSlot(definition as any))
      const player = game.roster.find(item => item.id === slot.playerId)!
      const expected = Math.round(detailedPositionValue(player, slot.detailedPosition))
      expect(slot.proficiency).toBe(expected)
    }
  })

  it('MCP 暴露新增的球探、回收、聊天和比赛中自动换人工具', async () => {
    const server = createFmMcpServer({ server: 'http://example.test', token: 'test' })
    const client = new Client({ name: 'test', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      const tools = (await client.listTools()).tools
      for (const name of ['start_scouting', 'get_scout_reports', 'delete_scout_report', 'recycle_cards', 'lock_card', 'get_chat', 'send_chat', 'set_match_auto_subs']) {
        expect(tools.some(tool => tool.name === name)).toBe(true)
      }
      const training = tools.find(tool => tool.name === 'start_training')!
      expect(JSON.stringify(training.inputSchema)).toContain('points')
    } finally {
      await client.close()
      await server.close()
    }
  })
})
