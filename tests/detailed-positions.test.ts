import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { addTrainedCard, equipCard, untrainedPlayer } from '../src/game/cards.ts'
import { createTrainingSession, performTrainingAction } from '../src/game/training.ts'
import { pickExchangeOpponent } from '../src/game/actions.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION, detailedPositionValue, readDetailedPositions, slotPositionValue } from '../src/game/detailed-positions.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { emptyAutoSubs, executeTeamAutoSubs } from '../src/game/match/management.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { agentView, applyAgentAction } from '../server/agent.ts'

function fixture() {
  const game = createInitialGame(12)
  const player = game.roster.find(p => p.positions.GK === 0)!
  player.positions.CB = player.basePositions.CB = 0
  player.detailedPositions = { DL: 0, DR: 17, ST: 0 }
  player.baseDetailedPositions = { ...player.detailedPositions }
  return { game, player }
}

describe('detailed positions', () => {
  it('reads legacy positions without inventing sides, clamps and preserves GK', () => {
    const { player } = fixture()
    delete player.detailedPositions
    const table = readDetailedPositions(player)
    for (const pos of DETAILED_POSITIONS) expect(table[pos]).toBe(player.positions[DETAILED_TO_POSITION[pos]])
    player.detailedPositions = { DL: 120, DR: -5, GK: 88 }
    expect(detailedPositionValue(player, 'DL')).toBe(100)
    expect(detailedPositionValue(player, 'DR')).toBe(0)
    expect(detailedPositionValue(player, 'GK')).toBe(0)
  })
  it('trains a detailed target, preserves it through coarse training and card lifecycle', () => {
    const { game, player } = fixture()
    const session = createTrainingSession(player, 123)
    delete session.scheduleVersion
    expect(performTrainingAction(session, { kind: 'position', position: 'DL' }, undefined, 0, { silent: true }).ok).toBe(true)
    const dl = detailedPositionValue(session.candidate, 'DL')
    expect(dl).toBeGreaterThan(0)
    expect(detailedPositionValue(player, 'DL')).toBe(0)
    expect(performTrainingAction(session, { kind: 'position', position: 'CB' }, undefined, 0, { silent: true }).ok).toBe(true)
    expect(detailedPositionValue(session.candidate, 'DL')).toBe(dl)
    expect(detailedPositionValue(session.candidate, 'DR')).toBe(17)
    const card = addTrainedCard(game, session)
    expect(equipCard(game, player.id, card.id).ok).toBe(true)
    expect(detailedPositionValue(player, 'DL')).toBe(dl)
    expect(detailedPositionValue(untrainedPlayer(player), 'DL')).toBe(0)
    expect(equipCard(game, player.id, null).ok).toBe(true)
    expect(detailedPositionValue(player, 'DL')).toBe(0)
    expect(detailedPositionValue(JSON.parse(JSON.stringify(card)), 'DL')).toBe(dl)
  })
  it('交流赛使用对手原始细分位置，不携带装备卡的熟练度', () => {
    const { game } = fixture()
    const team = structuredClone(game.aiTeams[0])
    const player = team.players[0]
    player.equippedCardId = 'trained'
    player.version = 2
    player.detailedPositions = { DL: 12, DR: 98 }
    player.baseDetailedPositions = { DL: 75, DR: 19 }
    const opponent = pickExchangeOpponent([team], 1000, 1, [])
    expect(opponent.team.players.find(item => item.id === player.id)!.detailedPositions).toEqual({ DL: 75, DR: 19 })
    expect(player.detailedPositions).toEqual({ DL: 12, DR: 98 })
  })

  it('maps every formation slot to its legacy coarse value, then respects side and depth', () => {
    const { player } = fixture()
    delete player.detailedPositions
    player.positions.W = 23
    player.positions.CB = 91
    for (const formation of Object.values(FORMATIONS)) for (const slot of formation.slots) {
      expect(slotPositionValue(player, slot)).toBe(player.positions[slot.position])
    }
    const slots = FORMATIONS['4-4-2'].slots
    player.detailedPositions = { DL: 85, DR: 12, ML: 42 }
    expect(slotPositionValue(player, slots.find(s => s.id === 'lb')!)).toBe(85)
    expect(slotPositionValue(player, slots.find(s => s.id === 'rb')!)).toBe(12)
    expect(slotPositionValue(player, slots.find(s => s.id === 'lm')!)).toBe(42)
  })
  it('projects detailed gains to the coarse interface without raising other slots', () => {
    const { player } = fixture()
    player.positions.W = 0
    player.detailedPositions = { DL: 0, DR: 0 }
    const session = createTrainingSession(player, 123)
    delete session.scheduleVersion
    expect(performTrainingAction(session, { kind: 'position', position: 'DL', detailed: true }, undefined, 0, { silent: true }).ok).toBe(true)
    expect(session.candidate.positions.W).toBeGreaterThan(0)
    expect(detailedPositionValue(session.candidate, 'DR')).toBe(0)
    expect(detailedPositionValue(session.candidate, 'ML')).toBe(0)
  })
  it('赛中自动换人根据左右后卫细分熟练度选替补，旧比赛仍按粗位置', () => {
    const { game } = fixture()
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const team = new MatchEngine({ seed: 12, home: input, away: input, knockout: false }).getTeam('home')
    const out = team.players.find(player => player.slotId === 'lb')!
    expect(out.detailedPosition).toBe('DL')
    out.stamina = 1
    team.autoSubs = { ...emptyAutoSubs(), staminaBelow: 50 }
    for (const player of team.bench) { player.detailedPositions = { DL: 0, DR: 100 }; player.positions.W = 0 }
    const [left, right] = team.bench
    left.detailedPositions!.DL = 95; left.positions.W = 40
    right.detailedPositions!.DL = 10; right.positions.W = 90
    const picked: string[] = []
    const execute = () => executeTeamAutoSubs({ team, clockSeconds: 300, durationSeconds: 600, scoreDiff: 0, availableBench: () => team.bench, substitute: (_out, incoming) => { picked.push(incoming); return true } })
    execute()
    expect(picked).toEqual([left.id])
    picked.length = 0
    delete out.detailedPosition // 已进行的旧比赛没有新字段，继续按旧规则判断。
    execute()
    expect(picked).toEqual([right.id])
  })

  it('Agent 可查看并训练细分位置，错误字段不会改变培养状态', () => {
    const { game, player } = fixture()
    player.positions.W = player.basePositions.W = 0
    expect(applyAgentAction(game, { action: 'start_training', playerId: player.id }).ok).toBe(true)
    const session = game.training[player.id]
    delete session.scheduleVersion
    const request = { kind: 'position', position: 'DL', detailed: true }
    expect(applyAgentAction(game, { action: 'preview_training', playerId: player.id, request }).ok).toBe(true)
    expect(applyAgentAction(game, { action: 'training_action', playerId: player.id, request: { ...request, detailed: 'yes' } }).ok).toBe(false)
    expect(session.action).toBe(0)
    expect(applyAgentAction(game, { action: 'training_action', playerId: player.id, request }).ok).toBe(true)
    const candidate = agentView(game).trainingSessions.find(item => item.playerId === player.id)!.candidate
    expect(candidate.detailedPositions.DL).toBeGreaterThan(0)
    expect(candidate.detailedPositions.DR).toBe(17)
  })

  it('supports activity and independent ST via detailed flag', () => {
    const { player } = fixture()
    player.positions.ST = 100
    let session = createTrainingSession(player, 0)
    for (let seed = 0; seed < 1000; seed++) {
      session = createTrainingSession(player, seed)
      session.action = 1
      if (trainingOptions(session).some(option => option.id === 'position')) break
    }
    expect(trainingOptions(session).some(option => option.id === 'position')).toBe(true)
    expect(performTrainingAction(session, { kind: 'activity', activityId: 'position', position: 'ST', detailed: true }, undefined, 0, { silent: true }).ok).toBe(true)
    expect(detailedPositionValue(session.candidate, 'ST')).toBeGreaterThan(0)
    expect(session.candidate.positions.ST).toBe(100)
  })
})
