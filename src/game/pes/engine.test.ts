import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../match/engine.ts'
import type { MatchState } from '../match/types.ts'
import { baselineTeams } from './baseline.ts'
import { isPesState, PES_RULES_VERSION, PesEngine, restoreEngine } from './engine.ts'

/**
 * 新引擎的游戏适配器（`PesEngine`）：对游戏和界面暴露和 `MatchEngine` 同样的接口。
 * 这里测适配层自己的约定：存档是一份纯数据的 `MatchState`、按存档选引擎、按目标时刻推进、联赛里教练调整的播报时刻。
 */
const teams = baselineTeams(1)
const make = (seed: number, durationSeconds = 240, knockout = false) =>
  new PesEngine({ seed, home: structuredClone(teams.home), away: structuredClone(teams.away), knockout, durationSeconds })

describe('存档与按存档选引擎', () => {
  it('存档是纯数据（rulesVersion 4），JSON 往返后读档继续，与不间断运行逐位一致', () => {
    const full = make(5)
    full.simulate()
    const partial = make(5)
    partial.advanceTo(80)
    const saved = JSON.parse(JSON.stringify(partial.serialize())) as MatchState
    expect(saved.rulesVersion).toBe(PES_RULES_VERSION)
    expect(isPesState(saved)).toBe(true)
    // 游戏层的状态（比分、统计、文字直播……）和物理比赛存档在同一份里
    expect(saved.log.length).toBeGreaterThan(0)
    expect(saved.pes).toBeDefined()
    const resumed = PesEngine.restore(saved)
    resumed.simulate()
    expect(resumed.serialize()).toEqual(full.serialize())
    expect(resumed.state.finished).toBe(true)
  })

  it('restoreEngine 按存档的样子选引擎；旧引擎的存档仍走旧引擎，新引擎拒绝读旧存档', () => {
    const pes = make(6)
    pes.advanceTo(20)
    const restored = restoreEngine(pes.serialize(), false)
    expect(restored).toBeInstanceOf(PesEngine)
    expect(restored.ruleSet).toBe('pes')

    const old = new MatchEngine({ seed: 6, home: structuredClone(teams.home), away: structuredClone(teams.away), knockout: false, durationSeconds: 100, rulesVersion: 3 })
    for (let i = 0; i < 20; i++) old.step()
    const oldState = old.serialize()
    expect(isPesState(oldState)).toBe(false)
    const back = restoreEngine(oldState, false)
    expect(back).toBeInstanceOf(MatchEngine)
    expect(back.ruleSet).toBe('v3')
    expect(() => PesEngine.restore(oldState)).toThrow()
  })

  it('serialize 不改动引擎自己：存完继续跑，结果和没存过一样', () => {
    const a = make(8)
    const b = make(8)
    a.advanceTo(50)
    a.serialize()
    b.advanceTo(50)
    a.simulate()
    b.simulate()
    expect(a.serialize()).toEqual(b.serialize())
  })
})

describe('advanceTo / step', () => {
  it('分段推进与一次推进逐位一致；最多越过目标一个物理步；重复调用不变', () => {
    const a = make(7)
    const b = make(7)
    for (const t of [10, 25.5, 60, 100]) {
      a.advanceTo(t)
      // 文字直播只有已经发生的事：条目的时钟都不晚于目标时刻
      expect(a.state.log.every((entry) => entry.clock <= t)).toBe(true)
    }
    b.advanceTo(100)
    expect(a.serialize()).toEqual(b.serialize())
    const m = a.game.match
    expect(m.time).toBeGreaterThanOrEqual(100)
    expect(m.time).toBeLessThan(100 + m.spec.DT + 1e-9)
    const before = a.serialize()
    const result = a.advanceTo(100)
    expect(result.changed).toBe(false)
    expect(result.entries).toEqual([])
    expect(a.serialize()).toEqual(before)
  })

  it('推进到终场时标记结束；终场之后再推进什么也不做', () => {
    const e = make(3)
    expect(e.advanceTo(240).changed).toBe(true)
    expect(e.state.finished).toBe(true)
    expect(e.state.clock).toBe(240)
    const done = e.serialize()
    expect(e.advanceTo(300).changed).toBe(false)
    expect(e.serialize()).toEqual(done)
  })

  it('step() 推进约一个模拟秒，并带回这一秒新增的直播条目', () => {
    const e = make(3)
    e.advanceTo(5)
    const t0 = e.game.match.time
    const logLength = e.state.log.length
    const result = e.step()
    expect(e.game.match.time - t0).toBeGreaterThan(0)
    expect(e.game.match.time - t0).toBeLessThanOrEqual(1.02)
    expect(result.state).toBe(e.state)
    expect(result.entry === null ? e.state.log.length === logLength : e.state.log.at(-1) === result.entry).toBe(true)
  })

  it('每个模拟秒同步比分、控球秒数和球员体力，比赛页的数据条读它们', () => {
    const e = make(12)
    e.advanceTo(120)
    const s = e.state
    expect(s.clock).toBeGreaterThan(119)
    expect(s.score).toEqual({ home: e.game.match.teams[0].score, away: e.game.match.teams[1].score })
    expect(s.stats.home.possession + s.stats.away.possession).toBeGreaterThan(30)
    const onPitch = s.teams[0].players.filter((player) => player.onPitch)
    expect(onPitch.some((player) => player.stamina < player.maxStamina)).toBe(true)
    // 实时联赛按秒存档：状态里的时钟推进过，不是停在开球
    expect(e.snapshot().clock).toBe(s.clock)
  })
})

describe('教练调整', () => {
  it('联赛里按“现实时钟对应的比赛时刻”记入播报，不早于已有条目', () => {
    const e = make(9)
    e.advanceTo(30)
    expect(e.setTactics('attack', 'home', 30).ok).toBe(true)
    const entry = e.state.log.at(-1)!
    expect(entry.type).toBe('tactic')
    expect(entry.clock).toBe(30)
    expect(e.getTeam('home').mentality).toBe('attack')
    expect(e.state.instructions.at(-1)).toMatchObject({ kind: 'tactic', mentality: 'attack' })
    // 给的时刻比最后一条直播还早：不能让播报倒序
    const late = e.state.log.at(-1)!.clock
    expect(e.setTactics('defend', 'home', late - 5).ok).toBe(true)
    expect(e.state.log.at(-1)!.clock).toBeGreaterThanOrEqual(late)
    expect(e.setTactics('nonsense' as never, 'home').ok).toBe(false)
  })

  it('换人：写进指令和直播，被换下的不能再上；比赛结束后拒绝', () => {
    const e = make(51)
    e.advanceTo(40)
    const out = e.getTeam('home').players.find((p) => p.position === 'CM')!
    const incoming = e.availableBench('home').find((p) => p.positions.CM > 0)!
    expect(e.substitute(out.id, incoming.id, 'home', 40).ok).toBe(true)
    expect(e.getTeam('home').subsUsed).toBe(1)
    expect(e.state.instructions.at(-1)).toMatchObject({ kind: 'sub', outId: out.id, inId: incoming.id })
    expect(e.state.log.at(-1)).toMatchObject({ type: 'sub', clock: 40 })
    expect(e.availableBench('home').some((p) => p.id === out.id)).toBe(false)
    expect(e.substitute(incoming.id, out.id, 'home').ok).toBe(false)
    e.simulate()
    expect(e.substitute(incoming.id, out.id, 'home').ok).toBe(false)
    expect(e.setTactics('attack', 'home').ok).toBe(false)
  })
})

describe('整场结果', () => {
  it('淘汰赛踢平会进点球大战；结果状态和旧引擎同一种类型，可直接生成战报', () => {
    let shootouts = 0
    for (let seed = 1; seed <= 12 && shootouts < 1; seed++) {
      const e = make(seed, 120, true)
      const state = e.simulate()
      expect(state.finished).toBe(true)
      expect(state.stats.home.shots + state.stats.away.shots).toBeGreaterThan(0)
      expect(state.commentary?.length ?? 0).toBeGreaterThan(5)
      if (state.shootout) {
        shootouts++
        expect(state.shootout.home).not.toBe(state.shootout.away)
        expect(state.log.some((entry) => entry.type === 'penalty')).toBe(true)
      }
    }
    expect(shootouts).toBeGreaterThan(0)
  })
})
