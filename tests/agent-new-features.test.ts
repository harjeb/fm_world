import { describe, expect, it } from 'vitest'
import { applyAgentAction, agentView } from '../server/agent.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { createInitialGame } from '../src/game/state.ts'

describe('agent economy, market and training', () => {
  it('sanitizes market players and validates economy and market actions', () => {
    const game = createInitialGame(3)
    const view = agentView(game)
    expect(view.economy.facilities.length).toBe(5)
    expect(JSON.stringify(view)).not.toContain('injuryProneness')
    expect(JSON.stringify(game)).not.toContain('injuryProneness')
    expect(applyAgentAction(game, { action: 'upgrade_facility', facilityId: 'medical' }).ok).toBe(true)
    expect(applyAgentAction(game, { action: 'upgrade_facility', facilityId: 'constructor' }).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'list_player', playerId: game.roster[0].id, price: '100' }).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'list_player', playerId: game.roster[0].id, price: Infinity }).ok).toBe(false)
    if (game.freeStars.length) {
      const id = game.freeStars[0].id
      const result = applyAgentAction(game, { action: 'buy_free_agent', playerId: id })
      expect(result.ok).toBe(true)
      expect(JSON.stringify(result)).not.toContain('injuryProneness')
    }
  })

  it('returns raw visible event gains and hides other attributes', () => {
    const game = createInitialGame(3)
    const player = game.roster.find(item => item.positions.GK === 0)!
    expect(applyAgentAction(game, { action: 'start_training', playerId: player.id }).ok).toBe(true)
    const session = game.training[player.id]
    const action = applyAgentAction(game, { action: 'training_action', playerId: player.id, request: { kind: 'activity', activityId: trainingOptions(session)[0].id } })
    expect(action.ok).toBe(true)
    const pending = agentView(game).trainingSessions[0].pendingEvent!
    expect(pending.options[0].hint).toContain('第一脚触球 +0.5')
    expect((action.result as { event: unknown }).event).toEqual(pending)
    expect(JSON.stringify(action.result)).not.toContain('"effect"')
    const result = applyAgentAction(game, { action: 'training_event_choice', playerId: player.id, optionId: 'passing' })
    expect(result.ok).toBe(true)
    const gains = (result.result as { gains: Record<string, number> }).gains
    const log = session.log.at(-1)!
    expect(gains.passing).toBeCloseTo(log.gains!.passing!)
    expect(gains.firstTouch).toBeUndefined()
    expect(JSON.stringify(result.result)).not.toContain('"effect"')
    player.energy = 100
    expect(agentView(game).trainingSessions[0].energy).toBe(100)
  })

  it('presents historical and active legacy log gains in stored units', () => {
    const game = createInitialGame(3)
    const player = game.roster.find(item => item.positions.GK === 0)!
    const entry = { action: 1, week: 1, kind: 'event' as const, title: '旧记录', text: '已完成。（传球 +2）', gains: { passing: 30 } }
    player.history = [entry]
    expect(applyAgentAction(game, { action: 'start_training', playerId: player.id }).ok).toBe(true)
    game.training[player.id].log.push(entry)
    expect(agentView(game).trainingSessions[0].log.at(-1)?.text).toBe('已完成。（传球 +30）')
    const result = applyAgentAction(game, { action: 'get_player', playerId: player.id })
    expect(JSON.stringify(result.result)).toContain('已完成。（传球 +30）')
    expect(entry.text).toBe('已完成。（传球 +2）')
  })

  it('validates and previews new training requests without mutating the session', () => {
    const game = createInitialGame(4)
    const playerId = game.roster[0].id
    expect(applyAgentAction(game, { action: 'start_training', playerId }).ok).toBe(true)
    const session = game.training[playerId]
    const request = { kind: 'activity', activityId: trainingOptions(session)[0].id }
    const before = JSON.stringify(session)
    expect(applyAgentAction(game, { action: 'preview_training', playerId, request }).result).toMatchObject({ valid: true })
    expect(JSON.stringify(session)).toBe(before)
    expect(applyAgentAction(game, { action: 'preview_training', playerId, request: { kind: 'activity', activityId: 'bad' } }).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'preview_training', playerId, request: { kind: 'drill', attr: 'passing' } }).ok).toBe(false)
    expect(applyAgentAction(game, { action: 'training_action', playerId, request }).ok).toBe(true)
    expect(session.action).toBe(1)
    const options = agentView(game).trainingSessions[0].options
    expect(options.length).toBeGreaterThan(1)
    expect(options.every(option => !('gains' in option) && !('goalkeeperGains' in option))).toBe(true)
    expect(JSON.stringify(agentView(game))).not.toContain('injuryProneness')
  })
})
