import { describe, expect, it } from 'vitest'
import { abilityOf, DEFAULT_ABILITY_CALIBRATION } from './ability.ts'
import { fixtureTeam } from './fixtures.ts'
import { formationRows } from './formation.ts'
import { runWithMonitor, type HealthReport } from './health.ts'
import { makePair, referenceAvailable, runDiff, type RefRow } from './reference.ts'
import { PesMatch } from './sim.ts'
import { makePitch7, makePitchSpec, type PesMatchSnapshot, type PesTactics } from './spec.ts'
import type { FormationId } from '../types.ts'

function match(options: { seed?: number; home?: FormationId; away?: FormationId; duration?: number; homeTactics?: Partial<PesTactics>; awayTactics?: Partial<PesTactics>; recordHz?: number; level?: number } = {}): PesMatch {
  return new PesMatch({
    spec: makePitch7(options.duration ?? 300),
    seed: options.seed ?? 1,
    recordHz: options.recordHz,
    home: fixtureTeam(options.home ?? '1-2-3-1', { seed: 1, prefix: 'H', tactics: options.homeTactics, level: options.level }),
    away: fixtureTeam(options.away ?? '1-2-3-1', { seed: 2, prefix: 'A', tactics: options.awayTactics, level: options.level }),
  })
}

function steps(m: PesMatch, count: number): void {
  for (let i = 0; i < count && m.phase !== 'end'; i++) m.step()
}

describe('阵型 → 站位行', () => {
  it('三个 7 人制阵型和试跑时用的表完全一致', () => {
    const rows = (id: FormationId): RefRow[] => formationRows(id).map((row): RefRow => [row.role, row.nx, row.ny, row.line])
    expect(rows('1-2-3-1')).toEqual([
      ['GK', 0.05, 0.5, 0], ['CB', 0.22, 0.34, 0.1], ['CB', 0.22, 0.66, 0.1],
      ['CM', 0.4, 0.5, 0.45], ['LW', 0.58, 0.16, 0.8], ['RW', 0.58, 0.84, 0.8], ['ST', 0.73, 0.5, 0.9],
    ])
    expect(rows('1-3-2-1')).toEqual([
      ['GK', 0.05, 0.5, 0], ['CB', 0.2, 0.26, 0.1], ['CB', 0.19, 0.5, 0.08], ['CB', 0.2, 0.74, 0.1],
      ['CM', 0.42, 0.35, 0.45], ['CM', 0.42, 0.65, 0.45], ['ST', 0.68, 0.5, 0.9],
    ])
    expect(rows('1-2-2-2')).toEqual([
      ['GK', 0.05, 0.5, 0], ['CB', 0.22, 0.35, 0.1], ['CB', 0.22, 0.65, 0.1],
      ['CM', 0.42, 0.35, 0.45], ['CM', 0.42, 0.65, 0.45], ['ST', 0.66, 0.36, 0.9], ['ST', 0.66, 0.64, 0.9],
    ])
  })

  it('玩家自己摆的位置只改站位，不改角色和线位', () => {
    const rows = formationRows('1-2-3-1', { wl: { x: 0.7, y: 0.1 } })
    const wl = rows.find((row) => row.slotId === 'wl')!
    expect(wl).toMatchObject({ role: 'LW', nx: 0.7, ny: 0.1, line: 0.8 })
    expect(rows.find((row) => row.slotId === 'wr')).toMatchObject({ role: 'RW', nx: 0.58, ny: 0.84 })
  })
})

describe('属性 → 运动层能力', () => {
  const typical = Object.fromEntries(['speed', 'acceleration', 'agility', 'endurance', 'firstTouch', 'dribbling', 'composure', 'passing', 'shooting', 'tackling', 'defPos', 'anticipation', 'decisions', 'teamwork', 'reflexes', 'handling', 'rushing'].map((key) => [key, DEFAULT_ABILITY_CALIBRATION.anchor]))

  it('典型球员（评分 = 均值）所有能力都是 0.65', () => {
    for (const value of Object.values(abilityOf(typical))) expect(value).toBeCloseTo(0.65, 12)
  })

  it('评分越高能力越高，且限制在 0–1', () => {
    const low = abilityOf({ ...typical, speed: 5, acceleration: 5, passing: 5 })
    const high = abilityOf({ ...typical, speed: 95, acceleration: 95, passing: 95 })
    expect(high.pace).toBeGreaterThan(low.pace)
    expect(high.accel).toBeGreaterThan(low.accel)
    expect(high.passing).toBeGreaterThan(low.passing)
    const extreme = abilityOf({ ...typical, speed: 1000, acceleration: -1000 })
    for (const value of Object.values(extreme)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('门将能力来自反应 / 手型 / 出击；校准权重和全局灵敏度可调', () => {
    const base = abilityOf({ ...typical, reflexes: 80 })
    expect(base.handling).toBeGreaterThan(abilityOf(typical).handling)
    const damped = abilityOf({ ...typical, reflexes: 80 }, { ...DEFAULT_ABILITY_CALIBRATION, global: 0.5 })
    expect(damped.handling).toBeLessThan(base.handling)
    expect(damped.handling).toBeGreaterThan(abilityOf(typical).handling)
    const weighted = abilityOf({ ...typical, passing: 50 }, { ...DEFAULT_ABILITY_CALIBRATION, weights: { passing: 2 } })
    expect(weighted.passing - 0.65).toBeCloseTo(2 * (abilityOf({ ...typical, passing: 50 }).passing - 0.65), 12)
  })
})

describe('确定性与存档', () => {
  it('同种子跑两次：每一帧的录像、最终状态逐位一致；换种子结果不同', () => {
    const a = match({ seed: 5, recordHz: 5 })
    const b = match({ seed: 5, recordHz: 5 })
    a.run()
    b.run()
    expect(a.frames.length).toBeGreaterThan(1000)
    expect(a.frames).toEqual(b.frames)
    expect(a.serialize()).toEqual(b.serialize())
    const c = match({ seed: 6, recordHz: 5 })
    c.run()
    expect(c.frames).not.toEqual(a.frames)
  })

  it('中途 serialize → restore 后继续，与不间断运行逐位一致（含 JSON 往返）', () => {
    const options = { seed: 9, recordHz: 5, duration: 200 }
    const full = match(options)
    full.run()
    const fullSnapshot = full.serialize()
    // 用一遍预跑数出总帧数，并找到下半场开始的那一帧
    const probe = match(options)
    let total = 0
    let halfAt = -1
    while (probe.phase !== 'end') {
      probe.step()
      total++
      if (halfAt < 0 && probe.half === 2) halfAt = total
    }
    expect(halfAt).toBeGreaterThan(0)
    const cuts = [1, 777, 4321, halfAt - 1, halfAt, halfAt + 2, total - 50]
    for (const cut of cuts) {
      const first = match(options)
      steps(first, cut)
      const snapshot = first.serialize()
      const viaJson = JSON.parse(JSON.stringify(snapshot)) as PesMatchSnapshot
      for (const [label, source] of [['直接', snapshot], ['JSON', viaJson]] as const) {
        const second = PesMatch.restore(source)
        second.run()
        expect(second.serialize(), `第 ${cut} 帧存档（${label}）`).toEqual(fullSnapshot)
        // 存档之后产生的录像帧 = 不间断运行里同一时刻之后的帧
        expect(second.frames, `第 ${cut} 帧存档（${label}）的录像`).toEqual(full.frames.slice(full.frames.length - second.frames.length))
      }
      first.run() // 取过存档的原对象继续跑，也不受影响
      expect(first.serialize()).toEqual(fullSnapshot)
    }
  })

  it('存档是纯数据：JSON 往返不丢任何值，且与运行中的对象互不影响', () => {
    const m = match({ seed: 3 })
    steps(m, 5000)
    const snapshot = m.serialize()
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    // 改存档不影响比赛
    snapshot.teams[0].players[1].pos.x = 12345
    snapshot.ball.x = 999
    expect(m.teams[0].players[1].pos.x).not.toBe(12345)
    expect(m.ball.x).not.toBe(999)
    // 改比赛不影响已取出的存档
    const again = m.serialize()
    steps(m, 100)
    expect(again.time).toBeLessThan(m.time)
  })

  it('随机数状态在存档里：读档后继续抽到的数和原来一样', () => {
    const m = match({ seed: 4 })
    steps(m, 3000)
    const snapshot = m.serialize()
    const restored = PesMatch.restore(snapshot)
    expect(restored.rng.float()).toBe(m.rng.float())
    expect(restored.rng.float()).toBe(m.rng.float())
  })
})

describe('时长 D 与场地参数', () => {
  it('整场模拟时长由 D 决定：半场在 D/2，终场在 D（死球等待不算）', () => {
    for (const duration of [200, 450]) {
      const m = match({ duration, seed: 2 })
      let halfTime = -1
      while (m.phase !== 'end') {
        m.step()
        if (halfTime < 0 && m.half === 2) halfTime = m.time
      }
      expect(halfTime).toBeCloseTo(duration / 2, 1)
      expect(m.time).toBeGreaterThanOrEqual(duration - 1e-6)
      expect(m.time).toBeLessThan(duration + 0.05)
      expect(m.events.at(-1)?.type).toBe('end')
      expect(m.events.filter((e) => e.type === 'half')).toHaveLength(1)
    }
  })

  it('7 人制场地：60×40 米，球门宽 7.5 米，战术距离系数 60/105', () => {
    const spec = makePitch7()
    expect(spec).toMatchObject({ L: 60, W: 40, HL: 30, HW: 20, GOAL_HALF: 3.75, HALF: 450 })
    expect(spec.K).toBeCloseTo(60 / 105, 12)
    expect(makePitchSpec({ length: 80, width: 50 }).K).toBeCloseTo(80 / 105, 12)
  })
})

describe('自由运行（暂不接结算）的健康检查', () => {
  const reports: HealthReport[] = []
  const formations: [FormationId, FormationId][] = [['1-2-3-1', '1-2-3-1'], ['1-3-2-1', '1-2-2-2'], ['1-2-2-2', '1-2-3-1']]

  it('球员不出界、不扎堆、球不卡死', { timeout: 120_000 }, () => {
    for (const [i, [home, away]] of formations.entries()) {
      for (const seed of [1, 2]) {
        const m = match({ seed: seed * 10 + i, home, away, duration: 600 })
        reports.push(runWithMonitor(m))
      }
    }
    for (const report of reports) {
      expect(report.outOfBounds).toBe(0)
      expect(report.stackRatio).toBeLessThan(0.03)
      expect(report.stuckBall).toBe(0)
      expect(report.deadBallRatio).toBeLessThan(0.3)
      expect(report.seconds).toBeGreaterThan(590)
    }
  })

  it('一场完整的 15 分钟比赛在合理时间内跑完，且有进球 / 射门 / 越位 / 犯规等事件', { timeout: 120_000 }, () => {
    const m = match({ seed: 42, duration: 900 })
    const started = Date.now()
    m.run()
    const ms = Date.now() - started
    expect(ms).toBeLessThan(20_000)
    const types = new Set(m.events.map((e) => e.type))
    for (const type of ['shot', 'goal', 'throwin', 'goalkick', 'half', 'end'] as const) expect(types.has(type), type).toBe(true)
    expect(m.teams[0].stats.shots + m.teams[1].stats.shots).toBeGreaterThan(10)
    // 控球秒数之和不超过比赛时间
    expect(m.teams[0].stats.possession + m.teams[1].stats.possession).toBeLessThanOrEqual(m.time + 1e-6)
    // 球员之间以 pid 互相引用：所有引用都指向存在的球员
    const pids = new Set(m.players.map((p) => p.pid))
    for (const e of m.events) for (const actor of e.actors) expect(pids.has(actor)).toBe(true)
  })

  it('阵型随战术滑杆变化：宽度、防线高度、逼抢', { timeout: 120_000 }, () => {
    const run = (tactics: Partial<PesTactics>): HealthReport[] =>
      [1, 2, 3].map((seed) => runWithMonitor(match({ seed, duration: 300, homeTactics: tactics, awayTactics: { aggression: 0.1 } })))
    const mean = (rs: HealthReport[], pick: (r: HealthReport) => number): number => rs.reduce((s, r) => s + pick(r), 0) / rs.length
    const narrow = run({ width: 0 })
    const wide = run({ width: 1 })
    // 我方控球时的阵型宽度
    expect(mean(wide, (r) => r.teams[0].attacking.width)).toBeGreaterThan(mean(narrow, (r) => r.teams[0].attacking.width) + 1.5)
    const deep = run({ line: 0, press: 0 })
    const high = run({ line: 1, press: 1 })
    // 对方控球时我方防线（最后一名外场球员）和整体位置：高位逼抢的阵线更靠前
    expect(mean(high, (r) => r.teams[0].defending.backLineLx)).toBeGreaterThan(mean(deep, (r) => r.teams[0].defending.backLineLx) + 1.5)
    expect(mean(high, (r) => r.teams[0].defending.meanLx)).toBeGreaterThan(mean(deep, (r) => r.teams[0].defending.meanLx) + 1.5)
    // 我方控球时阵线也跟着抬高
    expect(mean(high, (r) => r.teams[0].attacking.meanLx)).toBeGreaterThan(mean(deep, (r) => r.teams[0].attacking.meanLx) + 1)
  })
})

describe.skipIf(!referenceAvailable())('与 pes2d 原版逐位对照（需要 F:\\FIFA_test\\pes2d\\sim.js，或 PES2D_SRC）', () => {
  const rows7: Record<string, RefRow[]> = Object.fromEntries(
    (['1-2-3-1', '1-3-2-1', '1-2-2-2'] as FormationId[]).map((id) => [id, formationRows(id).map((row): RefRow => [row.role, row.nx, row.ny, row.line])]),
  )

  it('7 人制（战术距离乘 K）：200 秒内每一帧逐位一致', { timeout: 120_000 }, () => {
    const spec = makePitch7(200)
    const { ref, pes } = makePair({ label: 'diff-7', spec, scaled: true, formations: rows7, homeFormation: '1-2-3-1', awayFormation: '1-3-2-1', seed: 7, rngSeed: 700, homeStrength: 0.8, awayStrength: 0.55 })
    const result = runDiff(ref, pes, 40_000)
    expect(result.mismatch).toBeNull()
    expect(result.steps).toBeGreaterThan(12_000)
  })

  it('11 人制原版常数（K = 1）：200 秒内每一帧逐位一致', { timeout: 120_000 }, () => {
    const spec = makePitchSpec({ length: 105, width: 68, goalHalf: 3.66, penDepth: 16.5, penWidth: 40.32, circle: 9.15, duration: 200 })
    const { ref, pes } = makePair({ label: 'diff-11', spec, scaled: false, homeFormation: '4-3-3', awayFormation: '4-4-2', seed: 3, rngSeed: 300 })
    const result = runDiff(ref, pes, 40_000)
    expect(result.mismatch).toBeNull()
    expect(result.steps).toBeGreaterThan(12_000)
  })
})
