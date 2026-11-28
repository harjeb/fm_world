import { describe, expect, it } from 'vitest'
import { MAX_SUBS } from '../src/game/squad.ts'
import { createInitialGame } from '../src/game/state.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import type { MatchPlayerState, MatchTeamState } from '../src/game/match/types.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { emptyAutoSubs, MATCH_TACTICS, validateAutoSubPlan, validateLiveAutoSubPlan } from '../src/game/match/management.ts'
import { changeMatchAutoSubs, restoreActiveEngine, startSingleChallenge } from '../src/game/actions.ts'
import { applyAgentAction } from '../server/agent.ts'
import { APP_VERSION, CHANGELOG_RELEASES, CHANGELOG_STORAGE_KEY, hasSeenLatestChangelog, markChangelogSeen } from '../src/game/changelog.ts'

function engine() {
  const game = createInitialGame(12)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
  return { game, engine: new MatchEngine({ seed: 12, home: input, away: input, knockout: false }) }
}

function compatible(e: MatchEngine, side: 'home' | 'away' = 'home') {
  const team = e.getTeam(side)
  const out = team.players.find(p => team.bench.some(b => b.positions[p.position] > 0))!
  const incoming = team.bench.find(b => b.positions[out.position] > 0)!
  return { team, out, incoming }
}

describe('比赛管理', () => {
  it('严格验证计划及心态', () => {
    const { game, engine: e } = engine()
    expect(validateAutoSubPlan(game.roster, game.lineup, emptyAutoSubs())).toEqual([])
    expect(validateAutoSubPlan(game.roster, game.lineup, { timed: [], staminaBelow: NaN, onInjury: 1 })).not.toEqual([])
    expect(e.setTactics('attack').ok).toBe(true)
    expect(e.getTeam('home').tactics).toEqual(MATCH_TACTICS.attack)
    expect(e.setTactics('balanced').ok).toBe(true)
    expect(e.getTeam('home').tactics).toEqual(MATCH_TACTICS.balanced)
    expect(e.state.commentary!.at(-1)!.text).toContain('均衡')
    expect(MatchEngine.restore(structuredClone(e.serialize()), false).getTeam('home').mentality).toBe('balanced')
    expect(e.setTactics('defend').ok).toBe(true)
    expect(e.setTactics('other' as never).ok).toBe(false)
  })
  it('均衡站位处于进攻和防守之间，主客场均适用', () => {
    const { engine: e } = engine()
    const target = (player: MatchPlayerState, team: MatchTeamState, opponent: MatchTeamState, carrier: MatchPlayerState) =>
      (e as unknown as { desiredTarget: (p: MatchPlayerState, attacking: boolean, t: MatchTeamState, o: MatchTeamState, c: MatchPlayerState, choice: unknown, presser: null, marking: Map<string, string>) => { x: number } })
        .desiredTarget(player, true, team, opponent, carrier, { kind: 'pass' }, null, new Map())
    for (const side of ['home', 'away'] as const) {
      const team = e.getTeam(side)
      const opponent = e.getTeam(side === 'home' ? 'away' : 'home')
      const player = team.players.find((p) => p.position === 'CM')!
      const carrier = team.players.find((p) => p.id !== player.id)!
      e.setTactics('attack', side)
      const attack = target(player, team, opponent, carrier).x
      e.setTactics('balanced', side)
      const balanced = target(player, team, opponent, carrier).x
      e.setTactics('defend', side)
      const defend = target(player, team, opponent, carrier).x
      expect((attack - defend) * (side === 'home' ? 1 : -1)).toBeCloseTo(10)
      expect(balanced).toBeCloseTo((attack + defend) / 2)
      expect(MatchEngine.restore(structuredClone(e.serialize()), false).getTeam(side).mentality).toBe('defend')
    }
  })

  it('定时规则在边界执行，恢复后不重复，旧档无计划也能运行', () => {
    const { engine: e } = engine()
    const { team, out, incoming } = compatible(e)
    team.autoSubs = { timed: [{ atMinute: 10, outId: out.sourceId, inId: incoming.sourceId }], staminaBelow: null, onInjury: false }
    e.state.clock = 99
    e.step()
    expect(team.subsUsed).toBe(0)
    expect(team.autoSubs.timed).toHaveLength(1)
    e.state.clock = 100
    const restored = MatchEngine.restore(structuredClone(e.serialize()), false)
    restored.step()
    expect(restored.getTeam('home').subsUsed).toBe(1)
    expect(restored.state.log.filter(l => l.type === 'sub').map(l => l.clock)).toEqual([100])
    expect(restored.state.log.find(l => l.type === 'sub')?.text).toContain('自动换人（定时）')
    const again = MatchEngine.restore(structuredClone(restored.serialize()), false)
    again.step()
    expect(again.getTeam('home').subsUsed).toBe(1)
    expect(again.getTeam('home').autoSubs!.timed).toEqual([])
    delete (again.getTeam('away') as Partial<typeof team>).autoSubs
    expect(() => again.step()).not.toThrow()
  })

  it('手动与自动共享换人额度（MAX_SUBS），且没有合适替补时不换人', () => {
    const { engine: e } = engine()
    const { team, out, incoming } = compatible(e)
    expect(e.substitute(out.id, incoming.id).ok).toBe(true)
    for (const p of team.players) p.stamina = p.maxStamina * 0.5
    team.autoSubs = { timed: [], staminaBelow: 99, onInjury: false }
    e.step()
    expect(team.subsUsed).toBe(MAX_SUBS)
    const next = compatible(e)
    expect(e.substitute(next.out.id, next.incoming.id).ok).toBe(false)
    e.step()
    expect(team.subsUsed).toBe(MAX_SUBS)

    const other = engine().engine
    const t = other.getTeam('home')
    for (const b of t.bench) for (const p of t.players) b.positions[p.position] = 0
    t.players[0].injured = true
    t.autoSubs = { timed: [], staminaBelow: 99, onInjury: true }
    other.step()
    expect(t.subsUsed).toBe(0)
  })

  it('伤病优先于定时，定时优先于体力；体力严格低于阈值且选最疲惫的可替换球员', () => {
    const { engine: e } = engine()
    const team = e.getTeam('home')
    // All bench players can play every starting position; make selection deterministic.
    for (const b of team.bench) for (const p of team.players) b.positions[p.position] = 1
    const [injured, timed, tired, boundary] = team.players
    injured.injured = true
    injured.stamina = injured.maxStamina * 0.9
    timed.stamina = timed.maxStamina * 0.8
    tired.stamina = tired.maxStamina * 0.1
    boundary.stamina = boundary.maxStamina * 0.5
    const timedIn = team.bench[1]
    team.autoSubs = { timed: [{ atSeconds: 0, outId: timed.sourceId, inId: timedIn.sourceId }], staminaBelow: 50, onInjury: true }
    e.step()
    expect(team.subsUsed).toBe(3)
    expect(e.state.instructions.filter(i => i.kind === 'sub').map(i => i.outId)).toEqual([injured.id, timed.id, tired.id])
    expect(team.players.some(p => p.id === boundary.id)).toBe(true)
  })

  it('体力选择跳过不适合位置的替补，阈值相等不触发', () => {
    const { engine: e } = engine()
    const { team, out, incoming } = compatible(e)
    for (const p of team.players) p.stamina = p.maxStamina
    for (const b of team.bench) b.positions[out.position] = 0
    incoming.positions[out.position] = 1
    out.stamina = out.maxStamina * 0.5
    team.autoSubs = { timed: [], staminaBelow: 50, onInjury: false }
    e.step()
    expect(team.subsUsed).toBe(0)
    out.stamina = out.maxStamina * 0.2
    e.step()
    expect(team.subsUsed).toBe(1)
    expect(team.players.some(p => p.id === incoming.id)).toBe(true)
  })

  it('体力换人不会派上同样低于阈值的替补', () => {
    const { engine: e } = engine()
    const { team, out, incoming } = compatible(e)
    for (const player of team.players) player.stamina = player.maxStamina
    for (const player of team.bench) player.stamina = player.maxStamina * 0.4
    out.stamina = out.maxStamina * 0.1
    team.autoSubs = { timed: [], staminaBelow: 50, onInjury: false }
    e.step()
    expect(team.subsUsed).toBe(0)
    incoming.stamina = incoming.maxStamina * 0.7
    e.step()
    expect(team.subsUsed).toBe(1)
    expect(team.players.some((player) => player.id === incoming.id)).toBe(true)
    e.step()
    expect(team.subsUsed).toBe(1)
  })

  it('换下控球队员时球权不会丢失', () => {
    const { engine: e } = engine()
    const { out, incoming } = compatible(e)
    e.state.ball.ownerId = out.id
    expect(e.substitute(out.id, incoming.id).ok).toBe(true)
    expect(e.state.ball.ownerId).toBe(incoming.id)
  })

  it('伤员能力下降，禁用伤病换人时留在场上；替补体力不复原且主客独立', () => {
    const { engine: e } = engine()
    const home = compatible(e, 'home')
    const away = compatible(e, 'away')
    const healthy = e.eff(home.out, 'speed')
    home.out.injured = true
    expect(e.eff(home.out, 'speed')).toBeCloseTo(healthy * 0.7)
    home.team.autoSubs = { timed: [], staminaBelow: null, onInjury: false }
    away.incoming.stamina = away.incoming.maxStamina * 0.37
    expect(e.substitute(away.out.id, away.incoming.id, 'away').ok).toBe(true)
    const entered = away.team.players.find(p => p.id === away.incoming.id)!
    expect(entered.stamina / entered.maxStamina).toBeCloseTo(0.37)
    e.step()
    expect(home.team.subsUsed).toBe(0)
    expect(home.team.players.find(p => p.id === home.out.id)?.injured).toBe(true)
    expect(away.team.subsUsed).toBe(1)
  })

  it('真实比赛可随机受伤，伤病与身体接触发生在同一步', () => {
    let found = false
    // 伤病很少见，多试几个比赛种子，找到一次就够了。
    const game = createInitialGame(1)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    for (let seed = 1; seed <= 400 && !found; seed++) {
      const e = new MatchEngine({ seed, home: input, away: input, knockout: false })
      while (!e.state.finished && !found) {
        const start = e.state.log.length
        e.step()
        const entries = e.state.log.slice(start)
        const injury = entries.find(l => l.type === 'injury')
        if (injury) {
          expect(entries.some(l => l.type === 'tackle' || l.type === 'foul')).toBe(true)
          expect(injury.team === 'home' || injury.team === 'away').toBe(true)
          expect(e.getTeam(injury.team as 'home' | 'away').players.some(p => p.id === injury.playerId && p.injured)).toBe(true)
          expect(['tackle', 'foul']).toContain(entries[entries.indexOf(injury) - 1]?.type)
          found = true
        }
      }
    }
    expect(found).toBe(true)
  }, 30_000)

  it('两队伤员换人并保留替补体力，试跑不影响原状态', () => {
    const { engine: e } = engine()
    for (const team of e.state.teams) {
      const out = team.players.find(p => team.bench.some(b => b.positions[p.position] > 0))!
      out.injured = true
      team.autoSubs = { timed: [], staminaBelow: null, onInjury: true }
    }
    const before = structuredClone(e.serialize())
    const restored = MatchEngine.fromState(structuredClone(before))
    restored.step()
    expect(e.serialize()).toEqual(before)
    expect(e.state.teams[0].subsUsed).toBe(0)
    expect(restored.state.teams.map(t => t.subsUsed)).toEqual([1, 1])
    expect(restored.state.log.filter(l => l.type === 'sub').every(l => l.clock === 0)).toBe(true)
  })

  it('全局体力换人支持按指定位置筛选、最早触发分钟与替补挑选策略', () => {
    const { engine: e } = engine()
    const team = e.getTeam('home')
    for (const b of team.bench) {
      b.stamina = b.maxStamina
      for (const p of team.players) b.positions[p.position] = 80
    }
    const cb = team.players.find((p) => p.position === 'CB')!
    const st = team.players.find((p) => p.position === 'ST')!
    for (const p of team.players) p.stamina = p.maxStamina * 0.95
    cb.stamina = cb.maxStamina * 0.25
    st.stamina = st.maxStamina * 0.35

    // 只允许换 ST / W，且最早 60 分钟后触发
    team.autoSubs = {
      timed: [],
      staminaBelow: 55,
      staminaPositions: ['ST', 'W'],
      staminaMinMinute: 60,
      preferBy: 'stamina',
      onInjury: false,
    }
    // 30 分钟（clock = duration * 30 / 90）时未达最早分钟，不应换人
    e.state.clock = (e.state.durationSeconds * 30) / 90
    e.step()
    expect(team.subsUsed).toBe(0)

    // 调整替补体力：让 bench[2] 熟练度较低但体力 100%，bench[0] 熟练度更高但体力 70%
    team.bench[0].positions.ST = 100
    team.bench[0].stamina = team.bench[0].maxStamina * 0.7
    for (const b of team.bench.slice(1)) b.stamina = b.maxStamina * 0.65
    team.bench[2].positions.ST = 75
    team.bench[2].stamina = team.bench[2].maxStamina * 1.0

    // 65 分钟（下半场）触发：CB 虽更疲惫（25%），但不在 staminaPositions 中；ST 被替换为体力最充沛的 bench[2]
    e.state.half = 2
    e.state.clock = (e.state.durationSeconds * 65) / 90
    e.step()
    expect(team.subsUsed).toBe(1)
    expect(team.players.some((p) => p.id === cb.id && p.onPitch)).toBe(true)
    expect(team.players.some((p) => p.id === st.id && p.onPitch)).toBe(false)
    const subbedOn = team.players.find((p) => p.subbedOn)!
    expect(subbedOn).toBeDefined()
    expect(subbedOn.positions.ST).toBe(75)
    expect(e.state.instructions.at(-1)).toMatchObject({ kind: 'sub', outId: st.id, inId: subbedOn.id })
  })

  it('条件换人规则支持按位置/槽位/球员、比分状态与指定替补触发（MatchEngine 与 PesEngine 一致）', () => {
    const { game, engine: e } = engine()
    const team = e.getTeam('home')
    for (const b of team.bench) {
      b.stamina = b.maxStamina
      b.positions.ST = 85
      b.positions.CM = 85
    }
    for (const p of team.players) p.stamina = p.maxStamina * 0.95
    const st = team.players.find((p) => p.position === 'ST')!
    const cm = team.players.find((p) => p.position === 'CM')!
    const designatedSub = team.bench[1]
    st.stamina = st.maxStamina * 0.6
    cm.stamina = cm.maxStamina * 0.58

    const plan = {
      timed: [],
      staminaBelow: null,
      conditionRules: [
        // 落后时且 55 分钟后，若 ST 体力 < 70%，换上指定替补
        { targetKind: 'position' as const, targetValue: 'ST', staminaBelow: 70, minMinute: 55, scoreState: 'trailing' as const, inId: designatedSub.sourceId },
        // 领先时才换 CM
        { targetKind: 'slot' as const, targetValue: cm.slotId, staminaBelow: 70, minMinute: 55, scoreState: 'leading' as const },
      ],
      onInjury: false,
    }
    expect(validateAutoSubPlan(game.roster, game.lineup, plan)).toEqual([])
    team.autoSubs = structuredClone(plan)
    e.state.half = 2
    e.state.clock = (e.state.durationSeconds * 60) / 90

    // 平局时两条都不满足比分条件
    e.state.score = { home: 0, away: 0 }
    e.step()
    expect(team.subsUsed).toBe(0)

    // 落后时触发第一条：ST 被指定替补换下，CM 留在场上
    e.state.score = { home: 0, away: 1 }
    e.step()
    expect(team.subsUsed).toBe(1)
    expect(team.players.some((p) => p.sourceId === designatedSub.sourceId && p.onPitch)).toBe(true)
    expect(team.players.some((p) => p.id === cm.id && p.onPitch)).toBe(true)

    // PesEngine 赛中实时设置自动换人并按位置条件触发
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const pes = new PesEngine({ seed: 21, home: input, away: input, knockout: false, durationSeconds: 90 })
    const pesHome = pes.getTeam('home')
    for (const b of pesHome.bench) {
      b.positions.CM = 90
      b.stamina = b.maxStamina
    }
    const liveRes = pes.setAutoSubs({
      timed: [],
      staminaBelow: null,
      conditionRules: [{ targetKind: 'position', targetValue: 'CM', staminaBelow: 75, minMinute: 0, scoreState: 'any' }],
      onInjury: false,
    }, 'home')
    expect(liveRes.ok).toBe(true)
    // 让物理层一位 CM 体力低于 75% 并推进比赛时钟跨过整数秒边界
    const cmPlayer = pesHome.players.find((p) => p.position === 'CM')!
    const cmPhys = pes.game.match.teams[0].players.find((q) => q.ref === cmPlayer.id)!
    cmPhys.stamina = 0.5
    pes.advanceTo(2)
    expect(pes.getTeam('home').subsUsed).toBeGreaterThanOrEqual(1)
  })

  it('比赛进行中可通过教练调整与 Agent API 实时修改自动换人并可选同步默认配置', () => {
    const g = createInitialGame(33)
    const opp = g.aiTeams[0]
    expect(startSingleChallenge(g, opp.id).ok).toBe(true)
    const activeEngine = restoreActiveEngine(g)!
    const side = g.activeMatch!.context.homeAway
    const liveTeam = activeEngine.getTeam(side)

    const invalidPlan = { timed: [{ atMinute: 70, outId: 'non-existent', inId: 'non-existent' }], staminaBelow: null, onInjury: false }
    expect(validateLiveAutoSubPlan(liveTeam, invalidPlan)).not.toEqual([])
    expect(changeMatchAutoSubs(g, activeEngine, invalidPlan, true).ok).toBe(false)

    const updatedPlan = {
      timed: [],
      staminaBelow: 62,
      staminaPositions: ['W' as const, 'CM' as const, 'ST' as const],
      staminaMinMinute: 55,
      preferBy: 'stamina' as const,
      onInjury: true,
    }
    const res = changeMatchAutoSubs(g, activeEngine, updatedPlan, true)
    expect(res.ok).toBe(true)
    expect(activeEngine.getTeam(side).autoSubs).toEqual(updatedPlan)
    expect(g.autoSubs).toEqual(updatedPlan)

    // Agent API set_match_auto_subs 也可在赛中更新
    const agentOutcome = applyAgentAction(g, {
      action: 'set_match_auto_subs',
      plan: {
        timed: [],
        staminaBelow: 48,
        staminaPositions: ['ST'],
        onInjury: true,
      },
      syncDefault: false,
    })
    expect(agentOutcome.ok).toBe(true)
    const reloaded = restoreActiveEngine(g)!
    expect(reloaded.getTeam(side).autoSubs?.staminaBelow).toBe(48)
    expect(reloaded.getTeam(side).autoSubs?.staminaPositions).toEqual(['ST'])
    // syncDefault=false 时不影响赛前默认配置
    expect(g.autoSubs?.staminaBelow).toBe(62)
  })

  it('版本更新说明带版本号，首次未读自动识别并在确认后持久化', () => {
    expect(APP_VERSION).toMatch(/^v\d+\.\d+\.\d+$/)
    expect(CHANGELOG_RELEASES[0]?.version).toBe(APP_VERSION)
    expect(CHANGELOG_RELEASES[0]?.items.length).toBeGreaterThanOrEqual(2)

    const backing = new Map<string, string>()
    const prevDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => { backing.set(k, String(v)) },
        removeItem: (k: string) => { backing.delete(k) },
      },
    })
    try {
      expect(hasSeenLatestChangelog()).toBe(false)
      markChangelogSeen()
      expect(backing.get(CHANGELOG_STORAGE_KEY)).toBe(APP_VERSION)
      expect(hasSeenLatestChangelog()).toBe(true)
      // 旧版本号升级后再次触发首次弹窗
      markChangelogSeen('v0.1.0')
      expect(hasSeenLatestChangelog()).toBe(false)
    } finally {
      if (prevDescriptor) Object.defineProperty(globalThis, 'localStorage', prevDescriptor)
      else delete (globalThis as Record<string, unknown>).localStorage
    }
  })
})
