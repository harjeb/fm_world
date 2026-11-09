import { describe, expect, it } from 'vitest'
import type { MatchState, MatchTeamInput } from '../match/types.ts'
import { MATCH_DISPLAY_SECONDS, displayClock } from '../match/time.ts'
import { baselineTeams } from './baseline.ts'
import { PesEngine } from './engine.ts'
import { fixtureTeam } from './fixtures.ts'
import { PesGame } from './game.ts'
import { PesMatch } from './sim.ts'
import { GAME_FATIGUE_PER_METER, GAME_RULES, NATIVE_RULES, makePitch7 } from './spec.ts'

const teams = baselineTeams(1)
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

function input(source: MatchTeamInput): MatchTeamInput {
  const copy = structuredClone(source)
  for (const player of [...copy.starters.map((starter) => starter.player), ...copy.bench]) player.condition = 100
  // 不让自动换人把体力低的首发换走，误把新上场替补的体力当成整场消耗。
  copy.autoSubs = { timed: [], staminaBelow: null, onInjury: false }
  return copy
}

function make(seed: number, duration = 900, fatiguePerMeter = GAME_FATIGUE_PER_METER): PesEngine {
  return new PesEngine(new PesGame({
    seed, home: input(teams.home), away: input(teams.away), durationSeconds: duration,
    rules: { fatiguePerMeter },
  }))
}

const fullTimeOutfield = (state: MatchState) => state.teams.flatMap((team) => [...team.players, ...team.bench])
  .filter((player) => player.position !== 'GK' && !player.sentOff && player.stats.minutes >= 89.99)
  .map((player) => player.stats.staminaLeft)

function endStamina(duration: number, rate = GAME_FATIGUE_PER_METER): number[] {
  return [101, 102, 103, 104].flatMap((seed) => fullTimeOutfield(make(seed, duration, rate).simulate()))
}

describe('PES 比赛体力：90 分钟约消耗 70%', () => {
  it('普通满体力外场球员终场平均剩约 30%，不是只在战报里改数字', () => {
    const results: number[] = []
    for (const seed of [101, 102, 103, 104]) {
      const engine = make(seed)
      engine.advanceTo(450)
      const half = engine.getTeam('home').players.filter((player) => player.position !== 'GK')
      expect(mean(half.map((player) => player.stamina / player.maxStamina * 100))).toBeLessThan(75)
      expect(mean(half.map((player) => player.stamina / player.maxStamina * 100))).toBeGreaterThan(45)
      const state = engine.simulate()
      expect(displayClock(state.clock, state.durationSeconds)).toBe(MATCH_DISPLAY_SECONDS)
      results.push(...fullTimeOutfield(state))
      for (const team of engine.game.match.teams) for (const physical of team.players) {
        const player = state.teams[physical.ti].players.find((item) => item.id === physical.ref)!
        expect(player.stamina / player.maxStamina).toBeCloseTo(physical.stamina, 6)
        expect(player.stats.staminaLeft).toBe(Math.round(physical.stamina * 100))
      }
      // 门将的运动负荷不同，不为了全队数字好看强行扣 70%。
      for (const keeper of state.teams.flatMap((team) => team.players).filter((player) => player.position === 'GK')) {
        expect(keeper.stats.staminaLeft).toBeGreaterThan(80)
      }
    }
    expect(results.length).toBeGreaterThan(40)
    expect(mean(results)).toBeGreaterThan(25)
    expect(mean(results)).toBeLessThan(40)
  })

  it('不同压缩模拟时长都代表 90 分钟，不会把 450 秒场次的消耗再减半', () => {
    const standard = mean(endStamina(900))
    const shorter = mean(endStamina(450))
    expect(shorter).toBeGreaterThan(20)
    expect(shorter).toBeLessThan(45)
    expect(Math.abs(shorter - standard)).toBeLessThan(8)
  })

  it('高耐力球员仍比低耐力球员更省体力，保留 0–100% 边界', () => {
    const results = [0.2, 0.95].map((endurance) => {
      const home = fixtureTeam('1-2-3-1', { seed: 1 })
      const away = fixtureTeam('1-2-3-1', { seed: 2 })
      for (const team of [home, away]) for (const player of team.players) player.abilities.stamina = endurance
      const match = new PesMatch({ seed: 101, spec: makePitch7(), home, away, rules: GAME_RULES })
      match.run()
      for (const player of match.players) {
        expect(player.stamina).toBeGreaterThanOrEqual(0)
        expect(player.stamina).toBeLessThanOrEqual(1)
      }
      return mean(match.teams.flatMap((team) => team.players).filter((player) => player.role !== 'GK').map((player) => player.stamina))
    })
    expect(results[1] - results[0]).toBeGreaterThan(0.1)
  })

  it('晚出场替补只扣上场后的体力，未出场替补和已下场球员不再扣', () => {
    const engine = make(51, 450)
    engine.advanceTo(337.5) // 显示 67.5 分钟
    const team = engine.getTeam('home')
    const outgoing = team.players.find((player) => player.position === 'CM' && player.onPitch)!
    const incoming = engine.availableBench('home').find((player) => player.positions.CM > 0)!
    const neverUsed = engine.availableBench('home').find((player) => player.id !== incoming.id)!
    const beforeOut = outgoing.stamina / outgoing.maxStamina
    const untouched = neverUsed.stamina
    expect(incoming.stamina / incoming.maxStamina).toBe(1)
    expect(engine.substitute(outgoing.id, incoming.id).ok).toBe(true)
    engine.simulate()
    const all = [...team.players, ...team.bench]
    const out = all.find((player) => player.id === outgoing.id)!
    const replacement = all.find((player) => player.id === incoming.id)!
    expect(out.stamina / out.maxStamina).toBeCloseTo(beforeOut, 8)
    expect(out.stats.minutes).toBeCloseTo(67.5, 1)
    expect(replacement.stats.minutes).toBeCloseTo(22.5, 1)
    expect(replacement.stats.staminaLeft).toBeGreaterThan(65)
    expect(replacement.stats.staminaLeft).toBeLessThan(100)
    expect(neverUsed.stamina).toBe(untouched)
  })

  it('中途读档继续的体力和直接跑完全相同', () => {
    const straight = make(105, 450)
    straight.advanceTo(180)
    const saved = JSON.parse(JSON.stringify(straight.serialize())) as MatchState
    const resumed = PesEngine.restore(saved)
    straight.simulate()
    resumed.simulate()
    expect(resumed.serialize()).toEqual(straight.serialize())
  })

  it('旧比赛保留存档里的消耗系数，native 原版的差分基线也不改', () => {
    expect(NATIVE_RULES).toMatchObject({ fatigue: 'native', fatiguePerMeter: 2e-4 })
    const old = make(106, 450, 2e-4)
    old.advanceTo(180)
    const saved = JSON.parse(JSON.stringify(old.serialize())) as MatchState
    const restored = PesEngine.restore(saved)
    expect(restored.game.match.rules.fatiguePerMeter).toBe(2e-4)
    expect(make(106, 450).game.match.rules.fatiguePerMeter).toBe(GAME_FATIGUE_PER_METER)
    old.simulate()
    restored.simulate()
    expect(restored.serialize()).toEqual(old.serialize())
    expect(mean(fullTimeOutfield(old.state))).toBeGreaterThan(55)
  })
})
