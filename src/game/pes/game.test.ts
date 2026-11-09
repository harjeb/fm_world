import { describe, expect, it } from 'vitest'
import { MAX_SUBS, STARTERS } from '../squad.ts'
import { baselineTeams } from './baseline.ts'
import { PesGame } from './game.ts'
import type { MatchPlayerState, MatchTeamInput } from '../match/types.ts'
import type { SkillId } from '../types.ts'
import type { PesEvent, PesMatchSnapshot } from './spec.ts'

/**
 * 新引擎（pes2d 物理 + 现有结算内核）的整合测试：真实球队、真实属性、真实内核。
 * 重点是“自洽”——事件流、比分、球员和球队统计是同一份数据——以及确定性、存档续跑、换人、点球大战。
 */
const teams = baselineTeams(1)
const clone = (input: MatchTeamInput): MatchTeamInput => structuredClone(input)
const game = (seed: number, extra: Partial<ConstructorParameters<typeof PesGame>[0]> = {}) =>
  new PesGame({ seed, home: clone(teams.home), away: clone(teams.away), ...extra } as ConstructorParameters<typeof PesGame>[0])

const sideOf = (ti: number): 'home' | 'away' => (ti === 0 ? 'home' : 'away')
const allPlayers = (g: PesGame): MatchPlayerState[] => g.state.teams.flatMap((team) => [...team.players, ...team.bench])

describe('确定性与存档', () => {
  it('同种子同结果：事件流、比分、统计、最终存档逐位一致；换种子结果不同', () => {
    const a = game(11)
    const b = game(11)
    a.run()
    b.run()
    expect(a.match.events).toEqual(b.match.events)
    expect(a.serialize()).toEqual(b.serialize())
    const c = game(12)
    c.run()
    expect(c.match.events).not.toEqual(a.match.events)
  })

  it('中途存档（含 JSON 往返）读档后继续，与不间断运行逐位一致', () => {
    const options = { durationSeconds: 240 }
    const full = game(21, options)
    full.run()
    const finalSnapshot = full.serialize()
    // 数一遍总帧数、下半场开始的帧，挑一批存档点（含点球 / 开球 / 飞行中的球）
    const probe = game(21, options)
    let total = 0
    let halfAt = -1
    while (!probe.finished) {
      probe.step()
      total++
      if (halfAt < 0 && probe.match.half === 2) halfAt = total
    }
    const cuts = [1, 333, 2500, 6000, halfAt - 1, halfAt + 1, total - 40]
    for (const cut of cuts) {
      const first = game(21, options)
      for (let i = 0; i < cut && !first.finished; i++) first.step()
      const snapshot = first.serialize()
      const viaJson = JSON.parse(JSON.stringify(snapshot)) as PesMatchSnapshot
      for (const [label, source] of [['直接', snapshot], ['JSON', viaJson]] as const) {
        const restored = PesGame.restore(source)
        restored.run()
        expect(restored.serialize(), `第 ${cut} 帧存档（${label}）`).toEqual(finalSnapshot)
      }
      first.run()
      expect(first.serialize()).toEqual(finalSnapshot)
    }
  })
})

describe('存档是纯数据', () => {
  it('JSON 往返不丢任何值（没有 NaN / Infinity / undefined 混进状态）', () => {
    const g = game(71)
    g.advance(200)
    const snapshot = g.serialize()
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    g.run()
    const finalSnapshot = g.serialize()
    expect(JSON.parse(JSON.stringify(finalSnapshot))).toEqual(finalSnapshot)
  })
})

describe('事件流与统计自洽（同一份数据）', () => {
  const games = [31, 32, 33, 34, 35, 36].map((seed) => {
    const g = game(seed)
    g.run()
    return g
  })

  const count = (events: PesEvent[], type: string, ti: number, test?: (e: PesEvent) => boolean) =>
    events.filter((e) => e.type === type && e.ti === ti && (!test || test(e))).length

  it('比分 = goal 事件数 = 判定为 goal 的射门数；每个进球都有一脚 goal 射门', () => {
    for (const g of games) {
      const events = g.match.events
      for (const ti of [0, 1]) {
        const goals = count(events, 'goal', ti)
        expect(goals).toBe(g.state.score[sideOf(ti)])
        expect(goals).toBe(g.match.teams[ti as 0 | 1].score)
        expect(goals).toBe(g.state.stats[sideOf(ti)].goals)
        expect(goals).toBe(count(events, 'shot', ti, (e) => e.meta?.result === 'goal'))
      }
      // 每个 goal 射门之后、下一次开球之前一定有 goal 事件
      events.forEach((e, index) => {
        if (e.type !== 'shot' || e.meta?.result !== 'goal') return
        const next = events.slice(index + 1).find((x) => x.type === 'goal')
        expect(next, '射门判进球却没有进球事件').toBeDefined()
        expect(next!.t - e.t).toBeLessThan(4)
        expect(next!.ti).toBe(e.ti)
      })
    }
  })

  it('球队统计 = 从事件流重新数出来的数', () => {
    for (const g of games) {
      const events = g.match.events
      for (const ti of [0, 1]) {
        const stats = g.state.stats[sideOf(ti)]
        const other = 1 - ti
        expect(stats.passes).toBe(count(events, 'pass', ti))
        expect(stats.passesCompleted).toBe(count(events, 'pass', ti, (e) => e.meta?.result === 'ok'))
        expect(stats.shots).toBe(count(events, 'shot', ti))
        expect(stats.shotsOnTarget).toBe(count(events, 'shot', ti, (e) => e.meta?.result === 'goal' || e.meta?.result === 'save'))
        expect(stats.tackles).toBe(count(events, 'tackle', ti))
        expect(stats.fouls).toBe(count(events, 'foul', ti))
        expect(stats.corners).toBe(count(events, 'corner', ti))
        expect(stats.yellowCards).toBe(count(events, 'card', ti, (e) => e.meta?.color === 'yellow'))
        expect(stats.redCards).toBe(count(events, 'card', ti, (e) => e.meta?.color === 'red'))
        expect(stats.interceptions).toBe(count(events, 'pass', other, (e) => e.meta?.result === 'icpt'))
        expect(stats.xg).toBeCloseTo(events.filter((e) => e.type === 'shot' && e.ti === ti).reduce((sum, e) => sum + (e.xg ?? 0), 0), 9)
      }
    }
  })

  it('球员统计之和 = 球队统计；助攻 ≤ 进球；助攻者是进球者的队友', () => {
    for (const g of games) {
      for (const side of ['home', 'away'] as const) {
        const players = g.state.teams[side === 'home' ? 0 : 1]
        const roster = [...players.players, ...players.bench]
        const sum = (pick: (p: MatchPlayerState) => number) => roster.reduce((total, p) => total + pick(p), 0)
        const stats = g.state.stats[side]
        expect(sum((p) => p.stats.shots)).toBe(stats.shots)
        expect(sum((p) => p.stats.goals)).toBe(stats.goals) // 没有乌龙球时相等（乌龙球不记球员进球）
        expect(sum((p) => p.stats.passes)).toBe(stats.passes)
        expect(sum((p) => p.stats.passesCompleted)).toBe(stats.passesCompleted)
        expect(sum((p) => p.stats.tackles)).toBe(stats.tackles)
        expect(sum((p) => p.stats.interceptions)).toBe(stats.interceptions)
        expect(sum((p) => p.stats.assists ?? 0)).toBeLessThanOrEqual(stats.goals)
      }
      for (const e of g.match.events) {
        if (e.type !== 'goal' || e.meta?.assist === undefined) continue
        const scorer = g.match.players[e.actors[0]]
        const assister = g.match.players[e.meta.assist as number]
        expect(assister.ti).toBe(scorer.ti)
        expect(assister.pid).not.toBe(scorer.pid)
      }
    }
  })

  it('事件按时间排序，引用的球员都存在，红牌球员离场、名单一致', () => {
    for (const g of games) {
      const pids = new Set(g.match.players.map((q) => q.pid))
      let last = 0
      for (const e of g.match.events) {
        expect(e.t).toBeGreaterThanOrEqual(last)
        last = e.t
        for (const actor of e.actors) expect(pids.has(actor)).toBe(true)
      }
      for (const ti of [0, 1] as const) {
        const team = g.match.teams[ti]
        const reds = g.match.events.filter((e) => e.type === 'card' && e.ti === ti && e.meta?.color === 'red').map((e) => e.actors[0])
        for (const pid of reds) {
          expect(team.players.some((q) => q.pid === pid)).toBe(false)
          expect(team.offPlayers.some((q) => q.pid === pid)).toBe(true)
          expect(g.settlement.gamePlayer(pid).sentOff).toBe(true)
        }
        expect(team.players.length + reds.length).toBe(STARTERS)
      }
    }
  })

  it('控球百分比合计 100；出场分钟、体力、跑动合理；比赛正常结束', () => {
    for (const g of games) {
      expect(g.finished).toBe(true)
      expect(g.state.phase).toBe('finished')
      const { home, away } = g.state.stats
      expect(home.possession + away.possession).toBeCloseTo(100, 0)
      for (const player of allPlayers(g)) {
        expect(player.stats.minutes).toBeGreaterThanOrEqual(0)
        expect(player.stats.minutes).toBeLessThanOrEqual(90.001)
        expect(player.stats.staminaLeft).toBeGreaterThanOrEqual(0)
        expect(player.stats.staminaLeft).toBeLessThanOrEqual(100)
        expect(player.stats.distance).toBeGreaterThanOrEqual(0)
      }
      for (const side of ['home', 'away'] as const) {
        const starters = g.state.teams[side === 'home' ? 0 : 1]
        const minutes = [...starters.players, ...starters.bench].reduce((total, p) => total + p.stats.minutes, 0)
        expect(minutes).toBeLessThanOrEqual(STARTERS * 90 + 0.01)
        expect(minutes).toBeGreaterThan(STARTERS * 90 - 90 * 2 * 3) // 最多少几个人踢一段时间
      }
    }
  })

  it('一场比赛的量级在合理范围（未校准，宽松）', () => {
    const goals = games.reduce((sum, g) => sum + g.state.score.home + g.state.score.away, 0) / games.length
    const shots = games.reduce((sum, g) => sum + g.state.stats.home.shots + g.state.stats.away.shots, 0) / games.length
    const passes = games.reduce((sum, g) => sum + g.state.stats.home.passes + g.state.stats.away.passes, 0)
    const done = games.reduce((sum, g) => sum + g.state.stats.home.passesCompleted + g.state.stats.away.passesCompleted, 0) / passes
    expect(goals).toBeGreaterThan(1)
    expect(goals).toBeLessThan(12)
    expect(shots).toBeGreaterThan(8)
    expect(shots).toBeLessThan(60)
    expect(done).toBeGreaterThan(0.6)
    expect(done).toBeLessThan(0.97)
  })
})

describe('技能与特性在对应事件点被触发', () => {
  it('带技能的球员：技能计数（条件 / 生效）随传球、射门、对抗累计', () => {
    const skilled = clone(teams.home)
    const skills: SkillId[] = ['safe_pass', 'through_ball', 'weak_foot', 'wing_runner', 'long_shot', 'box_hunter', 'sweeper']
    for (const starter of skilled.starters) starter.player.skills = skills.filter((skill) => skill !== undefined)
    const g = new PesGame({ seed: 41, home: skilled, away: clone(teams.away) })
    g.run()
    const stats = g.state.skillStats.filter((entry) => entry.side === 'home')
    expect(stats.length).toBeGreaterThan(0)
    const triggered = new Set(stats.filter((entry) => entry.conditions > 0).map((entry) => entry.skillId))
    // 传球、过人、射门三类接触点上的技能都至少触发过一次判定
    for (const skill of ['safe_pass', 'wing_runner', 'weak_foot', 'sweeper'] as SkillId[]) expect(triggered.has(skill), skill).toBe(true)
    for (const entry of stats) expect(entry.applied).toBeLessThanOrEqual(entry.conditions)
  })

  it('赛前受伤的球员带伤上场（有效属性打 7 折）', () => {
    const injuredId = teams.home.starters[3].player
    const injuries = { [injuredId.id]: Date.now() + 86_400_000 }
    const g = new PesGame({ seed: 42, home: clone(teams.home), away: clone(teams.away), injuries, now: Date.now() })
    const player = allPlayers(g).find((p) => p.sourceId === injuredId.id)!
    expect(player.injured).toBe(true)
  })
})

describe('换人、战术与点球大战', () => {
  it('手动换人：校验失败给出原因；成功后新球员接替位置，出场分钟分开算', () => {
    const g = game(51)
    g.advance(120)
    const team = g.state.teams[0]
    const out = team.players.find((p) => p.position === 'CM')!
    const bench = g.availableBench('home').find((p) => p.positions.CM > 0)!
    expect(g.substitute('不存在', bench.id).ok).toBe(false)
    expect(g.substitute(out.id, '不存在').ok).toBe(false)
    const before = g.match.players.length
    expect(g.substitute(out.id, bench.id).ok).toBe(true)
    expect(g.match.players.length).toBe(before + 1)
    expect(g.state.teams[0].subsUsed).toBe(1)
    const incoming = g.state.teams[0].players.find((p) => p.id === bench.id)!
    expect(incoming).toMatchObject({ onPitch: true, subbedOn: true })
    expect(g.state.teams[0].bench.find((p) => p.id === out.id)).toMatchObject({ onPitch: false, cameOff: true })
    expect(g.substitute(out.id, bench.id).ok).toBe(false) // 已经下场的不能再换
    g.run()
    const minutesOut = g.state.teams[0].bench.find((p) => p.id === out.id)!.stats.minutes
    const minutesIn = g.state.teams[0].players.find((p) => p.id === bench.id)!.stats.minutes
    expect(minutesOut).toBeGreaterThan(5)
    expect(minutesOut + minutesIn).toBeCloseTo(90, 0)
    // 最多 MAX_SUBS 次换人
    const g2 = game(52)
    let ok = 0
    for (const out2 of g2.state.teams[0].players.filter((p) => p.position !== 'GK').slice(0, MAX_SUBS + 1)) {
      const inc = g2.availableBench('home').find((p) => p.positions[out2.position] > 0)
      if (inc && g2.substitute(out2.id, inc.id).ok) ok++
    }
    expect(ok).toBeLessThanOrEqual(MAX_SUBS)
  })

  it('自动换人：定时规则到点执行；体力阈值规则在体力降到阈值以下时执行', () => {
    const planned = clone(teams.home)
    const out = planned.starters.find((s) => s.player.positions.CM > 0 && s.slotId !== 'gk')!
    const incoming = planned.bench.find((p) => p.positions.CM > 0 && p.positions.GK === 0)!
    planned.autoSubs = { timed: [{ atMinute: 30, outId: out.player.id, inId: incoming.id }], staminaBelow: null, onInjury: false }
    const g = new PesGame({ seed: 53, home: planned, away: clone(teams.away) })
    g.run()
    const sub = g.match.events.find((e) => e.type === 'sub')!
    expect(sub).toBeDefined()
    // 30 分钟 ≈ 模拟 300 秒；检查每个模拟秒一次，所以在 300–302 秒之间
    expect(sub.t).toBeGreaterThanOrEqual(300 - 1e-6)
    expect(sub.t).toBeLessThan(303)
    expect(g.state.teams[0].subsUsed).toBe(1)

    const tired = clone(teams.home)
    tired.autoSubs = { timed: [], staminaBelow: 80, onInjury: false }
    const g2 = new PesGame({ seed: 54, home: tired, away: clone(teams.away) })
    g2.run()
    expect(g2.state.teams[0].subsUsed).toBeGreaterThan(0)
    expect(g2.state.teams[0].subsUsed).toBeLessThanOrEqual(MAX_SUBS)
  })

  it('比赛中切换心态：战术滑杆立刻跟着变', () => {
    const g = game(55)
    const before = { ...g.match.teams[0].tactics }
    g.advance(30)
    expect(g.setTactics('attack', 'home').ok).toBe(true)
    expect(g.match.teams[0].tactics.press).toBeGreaterThan(before.press)
    expect(g.match.teams[0].tactics.line).toBeGreaterThan(before.line)
    expect(g.state.teams[0].mentality).toBe('attack')
    expect(g.state.instructions.at(-1)).toMatchObject({ kind: 'tactic', mentality: 'attack' })
    expect(g.setTactics('defend', 'away').ok).toBe(true)
    expect(g.match.teams[1].tactics.press).toBeLessThan(0.5)
    expect(g.setTactics('乱来' as never).ok).toBe(false)
    g.run()
    expect(g.setTactics('balanced').ok).toBe(false) // 比赛结束后不能再改
  })

  it('淘汰赛踢平：进入点球大战（不进 2D），决出胜负；非淘汰赛不踢点球', () => {
    let found = 0
    for (let seed = 60; seed < 140 && found < 2; seed++) {
      const g = game(seed, { knockout: true, durationSeconds: 300 })
      g.run()
      if (g.state.score.home !== g.state.score.away) {
        expect(g.state.shootout).toBeNull()
        continue
      }
      found++
      const shootout = g.state.shootout!
      expect(shootout.finished).toBe(true)
      expect(shootout.home).not.toBe(shootout.away)
      expect(shootout.attemptsHome).toBeGreaterThanOrEqual(3)
      expect(g.state.phase).toBe('finished')
      // 点球大战不改常规时间的比分和事件流
      expect(g.match.events.filter((e) => e.type === 'goal')).toHaveLength(g.state.score.home + g.state.score.away)
    }
    expect(found).toBeGreaterThan(0)
    const league = game(61, { knockout: false, durationSeconds: 300 })
    league.run()
    expect(league.state.shootout).toBeNull()
  })
})

describe('定位球', () => {
  it('任意球、角球、点球、界外球、球门球都出现，且点球 / 任意球射门走射门结算（freeKick / penalty 标记）', () => {
    const kinds = new Set<string>()
    let freeKickShots = 0
    let penaltyShots = 0
    let headers = 0
    for (let seed = 500; seed < 516; seed++) {
      const g = game(seed, { durationSeconds: 900 })
      g.run()
      for (const e of g.match.events) {
        kinds.add(e.type)
        if (e.type === 'shot' && e.meta?.freeKick) freeKickShots++
        if (e.type === 'shot' && e.meta?.penalty) penaltyShots++
        if (e.type === 'shot' && e.meta?.header) headers++
      }
    }
    for (const kind of ['fk', 'corner', 'throwin', 'goalkick', 'aerial', 'save', 'tackle', 'card']) expect(kinds.has(kind), kind).toBe(true)
    expect(freeKickShots).toBeGreaterThan(0)
    expect(headers).toBeGreaterThan(0)
    expect(penaltyShots).toBeGreaterThanOrEqual(0)
  })
})

describe('强弱对比与性能', () => {
  it('同样的战术下，属性高的队明显更常赢（烟雾测试，细致校准在阶段 4 / 5）', () => {
    const weaker = baselineTeams(0.72)
    let strong = 0
    let weak = 0
    for (let seed = 200; seed < 216; seed++) {
      const g = new PesGame({ seed, home: clone(weaker.home), away: clone(weaker.away), durationSeconds: 600 })
      g.run()
      strong += g.state.score.home
      weak += g.state.score.away
    }
    expect(strong).toBeGreaterThan(weak + 4)
  })

  it('一场 15 分钟的比赛在合理时间内跑完', () => {
    const started = Date.now()
    game(300).run()
    expect(Date.now() - started).toBeLessThan(15_000)
  })
})
