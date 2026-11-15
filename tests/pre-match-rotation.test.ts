import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { FORMATIONS } from '../src/game/data/formations.ts'
import { DETAILED_POSITIONS, DETAILED_TO_POSITION } from '../src/game/detailed-positions.ts'
import { emptyAutoSubs, validateAutoSubPlan, validateLiveAutoSubPlan } from '../src/game/match/management.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { rotatePreMatch } from '../src/game/pre-match-rotation.ts'
import type { AutoSubPlan, Player, Position } from '../src/game/types.ts'

function fixture() {
  const game = createInitialGame(12)
  const lineup = structuredClone(game.lineup)
  const roster = structuredClone(game.roster)
  const byId = (id: string) => roster.find(p => p.id === id)!
  const slots = FORMATIONS[lineup.formationId].slots
  for (const p of roster) p.condition = 100
  const field = lineup.starters.filter(s => slots.find(slot => slot.id === s.slotId)!.position !== 'GK')
  const position = (slotId: string) => slots.find(s => s.id === slotId)!.position
  const makeBench = (index: number, pos: Position, condition = 80, prof = 90): Player => {
    const p = byId(lineup.bench[index])
    p.positions = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0 }
    p.positions[pos] = prof
    p.detailedPositions = Object.fromEntries(DETAILED_POSITIONS.map(d => [d, p.positions[DETAILED_TO_POSITION[d]]]))
    p.condition = condition
    return p
  }
  for (let i = 0; i < lineup.bench.length; i++) makeBench(i, 'GK', 10)
  const plan: AutoSubPlan = { ...emptyAutoSubs(), preMatchStaminaBelow: 60 }
  return { game, lineup, roster, byId, field, position, makeBench, plan, slots }
}

describe('赛前体能轮换', () => {
  it('默认关闭，非法阈值关闭，首发等于阈值不轮换', () => {
    const f = fixture(), out = f.field[0]
    f.byId(out.playerId).condition = 59
    f.makeBench(0, f.position(out.slotId))
    for (const value of [undefined, null, NaN, Infinity, 0, 100]) {
      expect(rotatePreMatch(f.roster, f.lineup, { ...f.plan, preMatchStaminaBelow: value }).changes).toEqual([])
    }
    expect(rotatePreMatch(f.roster, f.lineup, undefined).changes).toEqual([])
    f.byId(out.playerId).condition = 60
    expect(rotatePreMatch(f.roster, f.lineup, f.plan).changes).toEqual([])
    f.byId(out.playerId).condition = 59
    f.makeBench(0, f.position(out.slotId), 60)
    expect(rotatePreMatch(f.roster, f.lineup, f.plan).changes).toHaveLength(1)
  })

  it('最疲劳优先，熟练度、体能、替补顺序决定选择；交换且不改输入', () => {
    const f = fixture(), [a, b] = f.field
    const pos = f.position(a.slotId)
    f.byId(a.playerId).condition = 40
    f.byId(b.playerId).condition = 20
    const p0 = f.makeBench(0, pos, 90, 80)
    const p1 = f.makeBench(1, pos, 60, 95)
    p1.positions[f.position(b.slotId)] = 95
    for (const d of DETAILED_POSITIONS) p1.detailedPositions![d] = p1.positions[DETAILED_TO_POSITION[d]]
    const before = structuredClone({ roster: f.roster, lineup: f.lineup, plan: f.plan })
    const result = rotatePreMatch(f.roster, f.lineup, f.plan)
    expect(result.changes).toEqual([
      { outId: b.playerId, inId: p1.id, slotId: b.slotId },
      { outId: a.playerId, inId: p0.id, slotId: a.slotId },
    ])
    expect(result.lineup.bench.slice(0, 2)).toEqual([a.playerId, b.playerId])
    expect(result.lineup.starters[0].role).toBe(f.lineup.starters[0].role)
    expect({ roster: f.roster, lineup: f.lineup, plan: f.plan }).toEqual(before)
  })

  it('跳过伤停、不熟练和门将；同熟练度优先体能及原顺序', () => {
    const f = fixture(), out = f.field[0], pos = f.position(out.slotId)
    f.byId(out.playerId).condition = 30
    const unavailable = f.makeBench(0, pos, 100, 100)
    f.makeBench(1, pos, 100, 79)
    const gk = f.makeBench(2, pos, 100, 100); gk.positions.GK = 90
    const best = f.makeBench(3, pos, 80, 90)
    f.makeBench(4, pos, 80, 90)
    expect(rotatePreMatch(f.roster, f.lineup, f.plan, new Set([unavailable.id])).changes[0]?.inId).toBe(best.id)
  })

  it('赛前换边后卫时按目标左右位置而非粗边路选择', () => {
    const f = fixture()
    const out = f.lineup.starters.find(s => s.slotId === 'lb')!
    f.byId(out.playerId).condition = 20
    const wrong = f.makeBench(0, 'W', 100, 100)
    wrong.detailedPositions = { DL: 0, DR: 100 }
    const correct = f.makeBench(1, 'W', 80, 85)
    correct.detailedPositions = { DL: 85, DR: 0 }
    expect(rotatePreMatch(f.roster, f.lineup, f.plan).changes[0]?.inId).toBe(correct.id)
  })

  it('门将只接受熟练的真正门将，且无合适人选时不换', () => {
    const f = fixture(), out = f.lineup.starters.find(s => f.position(s.slotId) === 'GK')!
    f.byId(out.playerId).condition = 20
    const no = f.makeBench(0, 'GK', 80, 79)
    expect(rotatePreMatch(f.roster, f.lineup, f.plan).changes).toEqual([])
    no.positions.GK = 80
    expect(rotatePreMatch(f.roster, f.lineup, f.plan).changes[0].inId).toBe(no.id)
  })

  it('过滤轮换后失效的定时和指定球员规则，保留仍有效的规则且不改变原计划', () => {
    const f = fixture(), [a, b] = f.field
    f.byId(a.playerId).condition = 20
    const incoming = f.makeBench(0, f.position(a.slotId))
    const other = f.lineup.bench[1]
    f.plan.timed = [
      { atMinute: 10, outId: a.playerId, inId: other },
      { atMinute: 20, outId: b.playerId, inId: incoming.id },
      { atMinute: 30, outId: b.playerId, inId: other },
    ]
    f.plan.conditionRules = [
      { targetKind: 'player', targetValue: a.playerId, staminaBelow: 40 },
      { targetKind: 'any', inId: incoming.id, staminaBelow: 40 },
      { targetKind: 'player', targetValue: b.playerId, inId: other, staminaBelow: 40 },
      { targetKind: 'slot', targetValue: a.slotId, staminaBelow: 40 },
    ]
    const before = structuredClone(f.plan)
    const result = rotatePreMatch(f.roster, f.lineup, f.plan)
    expect(result.autoSubs!.timed).toEqual([before.timed[2]])
    expect(result.autoSubs!.conditionRules).toEqual(before.conditionRules!.slice(2))
    expect(f.plan).toEqual(before)
    expect(validateAutoSubPlan(f.roster, result.lineup, result.autoSubs)).toEqual([])
  })

  it('赛前和赛中校验一致支持可选有限阈值 1–99/null', () => {
    const f = fixture()
    const input = teamInputFromLineup(f.game.roster, f.game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const team = new MatchEngine({ seed: 12, home: input, away: input, knockout: false }).getTeam('home')
    for (const value of [undefined, null, 1, 50.5, 99]) {
      const plan = { ...emptyAutoSubs(), preMatchStaminaBelow: value }
      expect(validateAutoSubPlan(f.roster, f.lineup, plan)).toEqual([])
      expect(validateLiveAutoSubPlan(team, plan)).toEqual([])
    }
    for (const value of [0, 100, NaN, Infinity, '50']) {
      const plan = { ...emptyAutoSubs(), preMatchStaminaBelow: value }
      expect(validateAutoSubPlan(f.roster, f.lineup, plan)).not.toEqual([])
      expect(validateLiveAutoSubPlan(team, plan)).not.toEqual([])
    }
  })
})
