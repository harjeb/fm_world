import { describe, expect, it } from 'vitest'
import { setLineup } from '../src/game/actions.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { roleFit } from '../src/game/data/roles.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { emptyAutoSubs, validateAutoSubPlan } from '../src/game/match/management.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { createInitialGame } from '../src/game/state.ts'
import { autoFillLineup, bestRoleForPlayer, movePlayer, validateLineup } from '../src/game/squad.ts'
import type { GameState, Player, Position } from '../src/game/types.ts'

const identity = (id: string) => ({ id, name: id, color: '#123456', accent: '#ffffff' })

/** 一名外场球员和他没学过的外场位置。 */
function unlearned(game: GameState): { player: Player; slotId: string; position: Position } {
  const formation = FORMATIONS[game.lineup.formationId]
  for (const player of game.roster) {
    if (player.positions.GK > 0) continue
    const slot = formation.slots.find((item) => item.position !== 'GK' && player.positions[item.position] <= 0)
    if (slot) return { player, slotId: slot.id, position: slot.position }
  }
  const player = game.roster.find((item) => item.positions.GK <= 0)!
  const slot = formation.slots.find((item) => item.position !== 'GK')!
  player.positions[slot.position] = 0
  return { player, slotId: slot.id, position: slot.position }
}

function simulate(game: GameState, seed = 5) {
  const engine = new MatchEngine({
    seed,
    home: teamInputFromLineup(game.roster, game.lineup, identity('player')),
    away: teamInputFromLineup(game.aiTeams[0].players, game.aiTeams[0].lineup, identity(game.aiTeams[0].id)),
    knockout: false,
  })
  return engine.simulate()
}

describe('任何球员都能踢任何位置', () => {
  it('没学过的位置可以首发并保存，只给折损提示', () => {
    const game = createInitialGame(51)
    const { player, slotId, position } = unlearned(game)
    expect(player.positions[position]).toBe(0)
    const lineup = structuredClone(game.lineup)
    expect(movePlayer(game.roster, lineup, player.id, { slotId })).toBeNull()
    const check = validateLineup(game.roster, lineup)
    expect(check.valid).toBe(true)
    expect(check.warnings.some((text) => text.includes(player.name) && text.includes('熟练度仅 0'))).toBe(true)
    expect(setLineup(game, lineup, emptyAutoSubs()).ok).toBe(true)
  })

  it('外场球员踢门将、门将踢前锋也合法，比赛能踢完，比分正常', () => {
    const game = createInitialGame(52)
    const formation = FORMATIONS[game.lineup.formationId]
    const gkId = game.lineup.starters.find((item) => formation.slots.find((slot) => slot.id === item.slotId)?.position === 'GK')!.playerId
    const striker = game.lineup.starters.find((item) => formation.slots.find((slot) => slot.id === item.slotId)?.position === 'ST')!
    const strikerId = striker.playerId
    expect(movePlayer(game.roster, game.lineup, gkId, { slotId: striker.slotId })).toBeNull()
    const check = validateLineup(game.roster, game.lineup)
    expect(check.valid).toBe(true)
    expect(check.warnings.some((text) => text.includes('不是门将'))).toBe(true)
    const inGoal = game.lineup.starters.find((item) => item.playerId === strikerId)!
    expect(formation.slots.find((slot) => slot.id === inGoal.slotId)?.position).toBe('GK')
    for (const seed of [5, 6, 7]) {
      const state = simulate(game, seed)
      expect(state.finished).toBe(true)
      expect(Number.isFinite(state.score.home)).toBe(true)
      expect(Number.isFinite(state.score.away)).toBe(true)
    }
  })

  it('比赛里按熟练度折损：同一球员在没学过的位置，有效属性只有 60%', () => {
    const game = createInitialGame(53)
    const engine = new MatchEngine({
      seed: 9,
      home: teamInputFromLineup(game.roster, game.lineup, identity('player')),
      away: teamInputFromLineup(game.aiTeams[0].players, game.aiTeams[0].lineup, identity(game.aiTeams[0].id)),
      knockout: false,
    })
    const mp = engine.getTeam('home').players.find((item) => item.position !== 'GK')!
    mp.stamina = mp.maxStamina
    mp.traitId = 'none' as never
    mp.positions[mp.position] = 100
    const full = engine.eff(mp, 'passing')
    mp.positions[mp.position] = 0
    expect(engine.eff(mp, 'passing')).toBeCloseTo(Math.max(1, full * 0.6), 5)
  })

  it('手动换人和定时换人可以换上没学过这个位置的替补', () => {
    const game = createInitialGame(54)
    const engine = new MatchEngine({
      seed: 11,
      home: teamInputFromLineup(game.roster, game.lineup, identity('player')),
      away: teamInputFromLineup(game.aiTeams[0].players, game.aiTeams[0].lineup, identity(game.aiTeams[0].id)),
      knockout: false,
    })
    const team = engine.getTeam('home')
    const out = team.players.find((item) => item.position !== 'GK')!
    const incoming = team.bench[0]
    incoming.positions[out.position] = 0
    expect(engine.substitute(out.id, incoming.id).ok).toBe(true)
    expect(team.players.some((item) => item.id === incoming.id && item.position === out.position)).toBe(true)

    const second = team.players.find((item) => item.position !== 'GK' && item.id !== incoming.id)!
    const timedIn = team.bench.find((item) => !item.cameOff)!
    timedIn.positions[second.position] = 0
    team.autoSubs = { timed: [{ atSeconds: 0, outId: second.sourceId, inId: timedIn.sourceId }], staminaBelow: null, onInjury: false }
    engine.step()
    expect(team.subsUsed).toBe(2)
    expect(team.players.some((item) => item.id === timedIn.id)).toBe(true)
  })

  it('换人计划校验不再看位置，但人要在阵容里', () => {
    const game = createInitialGame(55)
    const starter = game.lineup.starters[1]
    const benchId = game.lineup.bench[0]
    const formation = FORMATIONS[game.lineup.formationId]
    const slot = formation.slots.find((item) => item.id === starter.slotId)!
    game.roster.find((player) => player.id === benchId)!.positions[slot.position] = 0
    const plan = { timed: [{ atMinute: 10, outId: starter.playerId, inId: benchId }], staminaBelow: null, onInjury: false }
    expect(validateAutoSubPlan(game.roster, game.lineup, plan)).toEqual([])
    const outsider = game.roster.find((player) => !game.lineup.bench.includes(player.id) && !game.lineup.starters.some((item) => item.playerId === player.id))!
    expect(validateAutoSubPlan(game.roster, game.lineup, { ...plan, timed: [{ atMinute: 10, outId: starter.playerId, inId: outsider.id }] })).not.toEqual([])
  })

  it('自动填充优先用学过这个位置的球员，门将位不会被外场球员抢走', () => {
    const game = createInitialGame(56)
    const lineup = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
    const formation = FORMATIONS[lineup.formationId]
    for (const starter of lineup.starters) {
      const slot = formation.slots.find((item) => item.id === starter.slotId)!
      expect(game.roster.find((player) => player.id === starter.playerId)!.positions[slot.position]).toBeGreaterThan(0)
    }
  })

  it('自动填充在没人学过某个位置时也能排满，不留空', () => {
    const game = createInitialGame(57)
    for (const player of game.roster) player.positions.ST = 0
    const lineup = autoFillLineup(game.roster, game.lineup.formationId, game.lineup.tactics)
    expect(lineup.starters).toHaveLength(7)
    expect(validateLineup(game.roster, lineup).valid).toBe(true)
  })

  it('门将和外场互相客串时，有效评分按球员自己的属性尺度算', () => {
    const game = createInitialGame(58)
    const keeper = game.roster.find((player) => player.positions.GK > 0)!
    const field = game.roster.find((player) => player.positions.GK <= 0)!
    // 门将踢中场：隐藏的外场属性按 0–20 尺度换算，不能被当成 0–1500。
    expect(roleFit(keeper.attrs, 'cm_organizer', true)).toBeGreaterThan(10)
    expect(bestRoleForPlayer(keeper, 'CM').fit).toBeGreaterThan(5)
    // 外场球员踢门将几乎没有扑救能力。
    expect(bestRoleForPlayer(field, 'GK').fit).toBeLessThan(bestRoleForPlayer(keeper, 'GK').fit / 2)
    // 同类球员的结果和默认参数一致。
    expect(roleFit(field.attrs, 'cm_organizer', false)).toBe(roleFit(field.attrs, 'cm_organizer'))
    expect(roleFit(keeper.attrs, 'gk_line', true)).toBe(roleFit(keeper.attrs, 'gk_line'))
  })
})
