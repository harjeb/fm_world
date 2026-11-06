import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { samplePlaybackFrame } from '../src/game/match/visualization.ts'
import type { MatchPlaybackFrame } from '../src/game/match/types.ts'
import { inputFor, makeTeams } from './helpers.ts'

const { roster, lineup } = makeTeams()

/** 用户正在看的比赛：v3 连续仿真 + 轨迹采集。 */
function match(seed: number, recordPlayback = true): MatchEngine {
  return new MatchEngine({
    seed,
    home: inputFor(roster, lineup, 'home', 'Home'),
    away: inputFor(roster, lineup, 'away', 'Away'),
    knockout: false,
    rulesVersion: 3,
    recordPlayback,
  })
}

describe('v3 连续仿真：确定性、存档与子帧', () => {
  it('一次 step 与按任意切片 advanceTo 得到相同的赛果、日志和轨迹', () => {
    const direct = match(11)
    direct.simulate()
    const sliced = match(11)
    let guard = 0
    while (!sliced.state.finished && guard++ < 5000) {
      sliced.advanceTo(Math.min(900, sliced.state.clock + 7.3))
    }
    expect(sliced.state.score).toEqual(direct.state.score)
    expect(sliced.state.log).toEqual(direct.state.log)
    expect(sliced.state.step).toBe(direct.state.step)
    expect(sliced.state.tick).toBe(direct.state.tick)
    expect(sliced.state.clock).toBe(direct.state.clock)
    expect(sliced.state.playbackFrames).toEqual(direct.state.playbackFrames)
  })

  it('JSON 存档在动作中途恢复后仍与不中断的引擎逐字段一致', () => {
    const live = match(12)
    live.advanceTo(321.7)
    expect(live.state.action).not.toBeNull()
    const saved = JSON.parse(JSON.stringify(live.serialize()))
    const restored = MatchEngine.restore(saved, false)
    live.simulate()
    restored.simulate()
    expect(restored.state.log).toEqual(live.state.log)
    expect(restored.state.score).toEqual(live.state.score)
    expect(restored.state.step).toBe(live.state.step)
    expect(restored.state.tick).toBe(live.state.tick)
    expect(restored.state.clock).toBe(live.state.clock)
    expect(restored.state.playbackFrames).toEqual(live.state.playbackFrames)
    expect(restored.state.recordAssist).toEqual(live.state.recordAssist)
  })

  it('advanceTo 不产生目标时刻之后的事件，也不在目标时刻追加新动作', () => {
    const engine = match(13)
    const result = engine.advanceTo(300)
    expect(engine.state.clock).toBeLessThanOrEqual(300)
    expect(engine.state.log.every((entry) => entry.clock <= 300)).toBe(true)
    expect(result.entries.every((entry) => entry.clock <= 300)).toBe(true)
    const step = engine.state.step
    expect(engine.advanceTo(300).changed).toBe(false)
    expect(engine.state.step).toBe(step)
  })

  it('每个 0.1 秒记录一帧，seq/时钟/球/球员首尾相接，且标记 substep', () => {
    const engine = match(14)
    engine.step()
    const frames = engine.state.playbackFrames ?? []
    expect(frames.length).toBeGreaterThan(1)
    expect(frames.every((frame) => frame.substep === true)).toBe(true)
    expect(frames.every((frame) => frame.step === 1)).toBe(true)
    expect(frames[0].seq).toBe(1)
    expect(frames.every((frame) => frame.to.clock - frame.from.clock <= 0.1 + 1e-9)).toBe(true)
    for (let index = 1; index < frames.length; index++) {
      const previous = frames[index - 1]
      const frame = frames[index]
      expect(frame.seq).toBe(previous.seq! + 1)
      expect(frame.from.clock).toBe(previous.to.clock)
      expect(frame.from.ball).toEqual(previous.to.ball)
      expect(frame.from.players).toEqual(previous.to.players)
    }
    expect(frames.some((frame) => frame.motion?.kind === 'pass')).toBe(true)
  })

  it('子帧按权威位置线性插值；同一持球人时球贴住画出来的球员', () => {
    const pass: MatchPlaybackFrame = {
      step: 1,
      seq: 1,
      substep: true,
      from: { clock: 0, ball: { x: 0, y: 0, ownerId: null, justReceived: false }, players: [{ id: 'a', x: 0, y: 0 }] },
      to: { clock: 0.2, ball: { x: 10, y: 20, ownerId: null, justReceived: false }, players: [{ id: 'a', x: 2, y: 4 }] },
    }
    const middle = samplePlaybackFrame(pass, 0.5)
    expect(middle.ball.x).toBeCloseTo(5)
    expect(middle.ball.y).toBeCloseTo(10)
    expect(middle.players[0].x).toBeCloseTo(1)
    expect(middle.players[0].y).toBeCloseTo(2)
    expect(samplePlaybackFrame(pass, 1).ball).toMatchObject({ x: 10, y: 20 })

    const carry: MatchPlaybackFrame = {
      ...pass,
      from: { clock: 0, ball: { x: 0, y: 0, ownerId: 'a', justReceived: true }, players: [{ id: 'a', x: 0, y: 0 }] },
      to: { clock: 0.2, ball: { x: 2, y: 0, ownerId: 'a', justReceived: true }, players: [{ id: 'a', x: 2, y: 0 }] },
    }
    expect(samplePlaybackFrame(carry, 0.5).ball).toMatchObject({ x: 1, y: 0, ownerId: 'a' })
  })

  it('全场仍为 190–300 个动作、9000 个 0.1 秒 tick，并保留最近 180 帧', () => {
    const engine = match(15)
    engine.simulate()
    expect(engine.state.clock).toBe(900)
    expect(engine.state.tick).toBe(9000)
    expect(engine.state.step).toBeGreaterThanOrEqual(190)
    expect(engine.state.step).toBeLessThanOrEqual(300)
    expect(engine.state.playbackFrames!.length).toBeLessThanOrEqual(180)
    expect(engine.state.playbackSeq!).toBeGreaterThan(engine.state.playbackFrames!.length)
  })
})
