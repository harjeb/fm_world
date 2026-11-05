import { describe, expect, it } from 'vitest'
import {
  MOTION_TICK_HZ,
  MOTION_TICK_SECONDS,
  MotionAgent,
  MotionField,
  PHYSICAL,
  motionProfileOf,
  MotionClock,
  motionTicksForFrames,
  planBallFlight,
  SNAP_DISTANCE,
  sampleBallFlight,
  turnRateAt,
} from '../src/game/match/motion.ts'
import { createInitialGame } from '../src/game/state.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { samplePlaybackFrame } from '../src/game/match/visualization.ts'
import { planMatchReplay } from '../src/game/match/replay.ts'

const profile = (overrides: Partial<Parameters<typeof motionProfileOf>[0]> = {}) =>
  motionProfileOf({ speed: 70, acceleration: 70, agility: 70, stamina: 1, ...overrides })

describe('连续运动层', () => {
  it('属性越高跑得越快、起步越猛；体能下降会掉速', () => {
    const slow = motionProfileOf({ speed: 10, acceleration: 10, agility: 10, stamina: 1 })
    const fast = motionProfileOf({ speed: 95, acceleration: 95, agility: 95, stamina: 1 })
    expect(fast.maxSpeed).toBeGreaterThan(slow.maxSpeed)
    expect(fast.acceleration).toBeGreaterThan(slow.acceleration)
    expect(fast.turnRate).toBeGreaterThan(slow.turnRate)
    const tired = motionProfileOf({ speed: 95, acceleration: 95, agility: 95, stamina: 0.3 })
    expect(tired.maxSpeed).toBeLessThan(fast.maxSpeed)
    // 速度不超过 FM 的最高速档位。
    expect(fast.maxSpeed).toBeLessThanOrEqual(PHYSICAL.topSpeed)
  })

  it('转向速率按速度分三档：走路 192、慢跑 104、全速 53 度/秒', () => {
    const p = profile()
    const walk = turnRateAt(p, 1)
    const jog = turnRateAt(p, 3.5)
    const run = turnRateAt(p, 7.5)
    expect(walk).toBeGreaterThan(jog)
    expect(jog).toBeGreaterThan(run)
    expect(walk / PHYSICAL.turnRateWalk).toBeCloseTo(run / PHYSICAL.turnRateRun, 5)
  })

  it('加速度、最高速度和刹车都受限，停下来后不再漂移', () => {
    const p = profile({ speed: 100, acceleration: 100, agility: 100 })
    const agent = new MotionAgent(p, { x: 0, y: 0 })
    let lastSpeed = 0
    for (let i = 0; i < 400; i++) {
      agent.step({ x: 100, y: 0 })
      const speed = agent.speed
      expect(speed).toBeLessThanOrEqual(p.maxSpeed + 1e-9)
      expect(speed - lastSpeed).toBeLessThanOrEqual(p.acceleration * MOTION_TICK_SECONDS + 1e-9)
      lastSpeed = speed
    }
    // 到了目标附近会来回微调，但不会无限加速冲出场外。
    expect(agent.x).toBeGreaterThan(95)
    expect(agent.x).toBeLessThanOrEqual(104.6)
    // 目标就在脚下时收油停住。
    const resting = new MotionAgent(p, { x: 50, y: 30 })
    for (let i = 0; i < 20; i++) resting.step({ x: 50, y: 30 })
    expect(resting.speed).toBeLessThan(0.05)
  })

  it('一 tick 里的转向角不超过当前速度允许的转向速率', () => {
    const p = profile()
    const agent = new MotionAgent(p, { x: 0, y: 0 })
    // 先加速一段，让转向限制进入“全速跑”档。
    for (let i = 0; i < 30; i++) agent.step({ x: 200, y: 0 })
    const before = agent.heading
    agent.step({ x: agent.x, y: agent.y + 50 })
    const delta = Math.abs(Math.atan2(Math.sin(agent.heading - before), Math.cos(agent.heading - before)))
    const limit = (turnRateAt(p, agent.speed) * Math.PI) / 180 * MOTION_TICK_SECONDS
    expect(delta).toBeLessThanOrEqual(limit + 1e-9)
  })

  it('10 Hz 推进：1 秒 10 个 tick，两个 tick 之间平滑插值', () => {
    const profiles = new Map([['a', profile()]])
    const field = new MotionField(profiles, [{ id: 'a', x: 10, y: 10 }])
    const start = field.sample(0)[0]
    for (let i = 0; i < 10; i++) field.tick(new Map([['a', { x: 40, y: 10 }]]))
    expect(field.ticks).toBe(10)
    expect(MOTION_TICK_SECONDS * MOTION_TICK_HZ).toBeCloseTo(1)
    const latest = field.sample(1)[0]
    expect(latest.x).toBeGreaterThan(start.x)
    // 同一份输入重复跑，结果完全一致。
    const again = new MotionField(profiles, [{ id: 'a', x: 10, y: 10 }])
    for (let i = 0; i < 10; i++) again.tick(new Map([['a', { x: 40, y: 10 }]]))
    expect(again.sample(0)).toEqual(field.sample(0))
    // alpha 在 0 和 1 之间时落在两个 tick 中间。
    // 渲染取最近两个 tick 之间的插值：0 = 上一个 tick，1 = 最新 tick。
    const from = field.sample(0)[0]
    const mid = field.sample(0.5)[0]
    expect(mid.x).toBeGreaterThanOrEqual(Math.min(from.x, latest.x) - 1e-9)
    expect(mid.x).toBeLessThanOrEqual(Math.max(from.x, latest.x) + 1e-9)
  })

  it('按帧时长换算出 10 Hz 的 tick 总数：226 步 ≈ 9000 tick', () => {
    const frames = [
      { from: { clock: 0 }, to: { clock: 4 } },
      { from: { clock: 4 }, to: { clock: 6.5 } },
    ]
    expect(motionTicksForFrames(frames)).toBe(40 + 25)
    expect(motionTicksForFrames([])).toBe(0)
  })

  it('播放倍速换算成 tick：慢放 1 秒要补足对应的比赛时间，不能只走 10 个 tick', () => {
    const clock = new MotionClock()
    // 实时（1×）：1 秒 10 个 tick。
    expect(clock.add(1, 1)).toBe(10)
    expect(clock.alpha).toBeCloseTo(0, 6)
    // 慢放档：1 秒现实 ≈ 6.2 秒比赛，需要 62 个 tick。
    clock.reset()
    expect(clock.add(1, 6.2)).toBe(62)
    // 快放：一帧只走 0.7 个 tick 的零头会累到下一帧。
    clock.reset()
    expect(clock.add(1 / 60, 1.5)).toBe(0)
    expect(clock.add(1 / 60, 1.5)).toBe(0)
    expect(clock.alpha).toBeGreaterThan(0)
    expect(clock.alpha).toBeLessThan(1)
    // 暂停（rate 0）不推进。
    clock.reset()
    expect(clock.add(1, 0)).toBe(0)
    expect(clock.alpha).toBe(0)
    // 切后台回来不能一次补上千个 tick。
    clock.reset()
    expect(clock.add(600, 6)).toBe(240)
  })

  it('慢放 6 倍速时整场跟跑不瞬移：误差中位 < 0.6 米、90% < 4 米', () => {
    const game = createInitialGame(41)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
    const engine = new MatchEngine({ seed: 41, home: input, away: structuredClone(input), knockout: false, durationSeconds: LOGIC_MATCH_SECONDS })
    const frames = planMatchReplay(engine).frames
    const profiles = new Map(engine.state.teams.flatMap((team) => team.players.map((player) => [player.id, motionProfileOf({
      speed: player.attrs.speed,
      acceleration: player.attrs.acceleration,
      agility: player.attrs.agility,
      stamina: player.stamina / Math.max(1, player.maxStamina),
    })] as const)))
    const field = new MotionField(profiles, frames[0].from.players)
    const clock = new MotionClock()
    const rate = 6.2
    const lags: number[] = []
    for (const frame of frames) {
      if (frame.restart) {
        field.reset(frame.to.players)
        clock.reset()
        continue
      }
      const duration = Math.max(0.2, frame.to.clock - frame.from.clock)
      const ticks = clock.add(duration / rate, rate)
      for (let index = 1; index <= ticks; index++) {
        const step = samplePlaybackFrame(frame, index / ticks)
        field.tick(new Map(step.players.map((player) => [player.id, { x: player.x, y: player.y }])))
      }
      const target = samplePlaybackFrame(frame, 1)
      for (const point of field.sample(0)) {
        const wanted = target.players.find((player) => player.id === point.id)
        if (wanted) lags.push(Math.hypot(point.x - wanted.x, point.y - wanted.y))
      }
    }
    lags.sort((a, b) => a - b)
    const pct = (q: number) => lags[Math.min(lags.length - 1, Math.floor(lags.length * q))]
    expect(pct(0.5)).toBeLessThan(0.6)
    expect(pct(0.9)).toBeLessThan(4)
    // 只有引擎瞬移（定位球站位）才会对齐，且远少于 5% 的球员 tick。
    expect(field.snaps / (field.ticks * 14)).toBeLessThan(0.05)
  })

  it('球：踢出瞬间算好整条飞行，起终点精确、长传才有弧线', () => {
    const shortPass = planBallFlight({ from: { x: 0, y: 0 }, to: { x: 12, y: 0 }, kind: 'pass', duration: 4 })
    expect(sampleBallFlight(shortPass, 0).point).toEqual({ x: 0, y: 0 })
    expect(sampleBallFlight(shortPass, 1).point).toEqual({ x: 12, y: 0 })
    expect(shortPass.apex).toBe(0)
    expect(shortPass.duration).toBeLessThanOrEqual(4)
    const longBall = planBallFlight({ from: { x: 0, y: 0 }, to: { x: 60, y: 0 }, kind: 'pass', duration: 6 })
    expect(longBall.apex).toBeGreaterThan(1)
    const mid = sampleBallFlight({ ...longBall, launch: 0, landing: 1 }, 0.5)
    expect(mid.height).toBeGreaterThan(1)
    expect(mid.airborne).toBe(true)
    // 飞行时间越长，说明球速越慢；射门最快。
    const shot = planBallFlight({ from: { x: 0, y: 0 }, to: { x: 25, y: 0 }, kind: 'shot', duration: 4 })
    expect(shot.duration).toBeLessThan(longBall.duration)
  })
})

describe('运动层不改变比赛结果', () => {
  const simulate = () => {
    const game = createInitialGame(41)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
    const engine = new MatchEngine({ seed: 41, home: input, away: structuredClone(input), knockout: false, durationSeconds: LOGIC_MATCH_SECONDS })
    return engine.simulate()
  }

  it('同一场球跑两遍：比分、事件、随机数完全一致', () => {
    const a = simulate()
    const b = simulate()
    expect(b.score).toEqual(a.score)
    expect(b.log).toEqual(a.log)
    expect(b.decisionRng).toEqual(a.decisionRng)
    expect(b.resultRng).toEqual(a.resultRng)
    expect(b.teams).toEqual(a.teams)
  })

  it('把回放帧喂给运动层不会反过来修改帧或赛果', () => {
    const state = simulate()
    const frames = state.playbackFrames ?? []
    expect(frames.length).toBeGreaterThan(0)
    const snapshot = JSON.stringify(frames)
    const profiles = new Map(state.teams.flatMap((team) => team.players.map((player) => [player.id, motionProfileOf({
      speed: player.attrs.speed,
      acceleration: player.attrs.acceleration,
      agility: player.attrs.agility,
      stamina: player.stamina / Math.max(1, player.maxStamina),
    })] as const)))
    const first = frames[0]
    const field = new MotionField(profiles, first.from.players)
    for (const frame of frames) {
      const target = samplePlaybackFrame(frame, 1)
      field.tick(new Map(target.players.map((player) => [player.id, player])))
    }
    // 帧、比分、事件都没被运动层改写。
    expect(JSON.stringify(frames)).toBe(snapshot)
    expect(state.score).toEqual(simulate().score)
    expect(field.ticks).toBe(frames.length)
  })

  it('整场跟跑：画面位置贴近引擎目标，只有引擎瞬移时才对齐', () => {
    const game = createInitialGame(41)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
    const engine = new MatchEngine({ seed: 41, home: input, away: structuredClone(input), knockout: false, durationSeconds: LOGIC_MATCH_SECONDS })
    const frames = planMatchReplay(engine).frames
    const profiles = new Map(engine.state.teams.flatMap((team) => team.players.map((player) => [player.id, motionProfileOf({
      speed: player.attrs.speed,
      acceleration: player.attrs.acceleration,
      agility: player.attrs.agility,
      stamina: player.stamina / Math.max(1, player.maxStamina),
    })] as const)))
    const field = new MotionField(profiles, frames[0].from.players)
    const lags: number[] = []
    for (const frame of frames) {
      // 定位球/开球/进球后的重置：画面直接对齐，不要求跑过去。
      if (frame.restart) {
        field.reset(frame.to.players)
        continue
      }
      const duration = Math.max(0.2, frame.to.clock - frame.from.clock)
      const ticks = Math.max(1, Math.round(duration * MOTION_TICK_HZ))
      for (let index = 1; index <= ticks; index++) {
        const target = samplePlaybackFrame(frame, index / ticks)
        field.tick(new Map(target.players.map((player) => [player.id, { x: player.x, y: player.y }])))
      }
      const target = new Map(samplePlaybackFrame(frame, 1).players.map((player) => [player.id, player]))
      for (const point of field.sample(0)) {
        const wanted = target.get(point.id)
        if (wanted) lags.push(Math.hypot(point.x - wanted.x, point.y - wanted.y))
      }
    }
    lags.sort((a, b) => a - b)
    const pct = (q: number) => lags[Math.min(lags.length - 1, Math.floor(lags.length * q))]
    expect(lags.length).toBeGreaterThan(500)
    expect(pct(0.5)).toBeLessThan(1)
    expect(pct(0.9)).toBeLessThan(4)
    // 超过阈值就单人对齐，所以永远追不出一条街。
    expect(pct(0.99)).toBeLessThanOrEqual(SNAP_DISTANCE + 0.5)
  })

  it('整场运动层的位置都留在球场内，速度不超过属性上限', () => {
    const state = simulate()
    const frames = state.playbackFrames ?? []
    const profiles = new Map(state.teams.flatMap((team) => team.players.map((player) => [player.id, motionProfileOf({
      speed: player.attrs.speed,
      acceleration: player.attrs.acceleration,
      agility: player.attrs.agility,
      stamina: player.stamina / Math.max(1, player.maxStamina),
    })] as const)))
    const field = new MotionField(profiles, frames[0].from.players)
    for (const frame of frames) {
      const target = samplePlaybackFrame(frame, 1)
      field.tick(new Map(target.players.map((player) => [player.id, player])))
      for (const point of field.sample(1)) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(104.6)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(63.6)
        const cap = profiles.get(point.id)!.maxSpeed
        expect(point.speed).toBeLessThanOrEqual(cap + 1e-6)
      }
    }
  })
})
