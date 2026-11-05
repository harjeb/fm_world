import { describe, expect, it, vi } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { capturePlaybackPose, PLAYBACK_FRAME_LIMIT } from '../src/game/match/playback.ts'
import { planMatchReplay } from '../src/game/match/replay.ts'
import type { MatchPlaybackPose, MatchSide } from '../src/game/match/types.ts'
import { inputFor, makeTeams } from './helpers.ts'

const { roster, lineup } = makeTeams()

function match(seed = 1, knockout = false, durationSeconds?: number) {
  return new MatchEngine({
    seed,
    home: inputFor(roster, lineup, 'home', 'Home'),
    away: inputFor(roster, lineup, 'away', 'Away'),
    knockout,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  })
}

describe('纯视觉比赛轨迹与隔离预演', () => {
  it('预演不改变原状态、随机流或对象引用，与随后 simulate 的比分、日志和轨迹一致', () => {
    const engine = match(7)
    for (let i = 0; i < 19; i++) engine.step()
    const before = structuredClone(engine.state)
    const references = {
      state: engine.state,
      teams: engine.state.teams,
      log: engine.state.log,
      frames: engine.state.playbackFrames,
      decisionRng: engine.state.decisionRng,
      resultRng: engine.state.resultRng,
    }
    const control = MatchEngine.restore(structuredClone(before), false)
    const plan = planMatchReplay(engine)

    expect(engine.state).toEqual(before)
    expect(engine.state).toBe(references.state)
    expect(engine.state.teams).toBe(references.teams)
    expect(engine.state.log).toBe(references.log)
    expect(engine.state.playbackFrames).toBe(references.frames)
    expect(engine.state.decisionRng).toBe(references.decisionRng)
    expect(engine.state.resultRng).toBe(references.resultRng)
    expect(plan.finished).toBe(true)
    expect(plan.frames[0].step).toBe(before.step + 1)
    expect(plan.frames[0].from).toEqual(capturePlaybackPose(before))

    const expected = control.simulate()
    const actual = engine.simulate()
    expect(plan.score).toEqual(actual.score)
    expect(actual.score).toEqual(expected.score)
    expect(actual.log).toEqual(expected.log)
    expect(actual.commentary).toEqual(expected.commentary)
    expect(actual.decisionRng).toEqual(expected.decisionRng)
    expect(actual.resultRng).toEqual(expected.resultRng)
    expect(actual).toEqual(expected)
    expect(plan.frames).toHaveLength(actual.step - before.step)
    expect(plan.frames.slice(-PLAYBACK_FRAME_LIMIT)).toEqual(actual.playbackFrames)
  })

  it('轻量位置、球和 motion 不别名引用真实状态，外部改动视觉数据不影响赛果', () => {
    const engine = match()
    engine.step()
    const frame = engine.state.playbackFrames!.at(-1)!
    const before = structuredClone(engine.state)
    const control = MatchEngine.restore(structuredClone(before), false)
    const pose = capturePlaybackPose(engine.state)
    const player = engine.state.teams.flatMap((team) => team.players).find((item) => item.id === pose.players[0].id)!

    expect(Object.keys(pose).sort()).toEqual(['ball', 'clock', 'players'])
    expect(Object.keys(pose.players[0]).sort()).toEqual(['id', 'x', 'y'])
    expect(pose.ball).not.toBe(engine.state.ball)
    expect(pose.players[0]).not.toBe(player)
    expect(frame.to.ball).not.toBe(engine.state.ball)
    expect(frame.motion).not.toBe(engine.state.ballMotion)
    expect(frame.motion?.to).not.toBe(engine.state.ballMotion?.to)
    pose.players[0].x = -100
    pose.ball.x = -100
    frame.from.players[0].x = -200
    frame.to.players[0].x = -300
    frame.to.ball.x = -300
    if (frame.motion) frame.motion.to.x = -400
    expect(player.x).toBe(before.teams[0].players.find((item) => item.id === player.id)!.x)
    expect(engine.state.ball).toEqual(before.ball)
    expect(engine.state.ballMotion).toEqual(before.ballMotion)
    expect(engine.state.teams).toEqual(before.teams)
    expect(frame.to.players[0]).not.toBe(frame.from.players[0])

    const plan = planMatchReplay(engine, 2)
    const stateBeforePlanMutation = structuredClone(engine.state)
    plan.frames[0].to.players[0].x = -500
    plan.frames[0].to.ball.x = -500
    plan.score.home = 999
    expect(engine.state).toEqual(stateBeforePlanMutation)
    const actual = engine.simulate()
    const expected = control.simulate()
    expect(actual.log).toEqual(expected.log)
    expect(actual.score).toEqual(expected.score)
    expect(actual.teams).toEqual(expected.teams)
    expect(actual.decisionRng).toEqual(expected.decisionRng)
    expect(actual.resultRng).toEqual(expected.resultRng)
  })

  it('每步记录步前位置、最终时钟与开始时的 restart，recent ring 至多 12 条', () => {
    const engine = match()
    expect(PLAYBACK_FRAME_LIMIT).toBe(12)
    for (let i = 0; i < 30; i++) {
      const from = capturePlaybackPose(engine.state)
      const restart = engine.state.pendingSetPiece?.type
      engine.step()
      const frames = engine.state.playbackFrames!
      const latest = frames.at(-1)!
      expect(frames).toHaveLength(Math.min(i + 1, PLAYBACK_FRAME_LIMIT))
      expect(latest.step).toBe(engine.state.step)
      expect(latest.from).toEqual(from)
      expect(latest.to.clock).toBe(engine.state.clock)
      expect(latest.restart).toBe(restart)
      expect(latest.motion).toEqual(engine.state.ballMotion)
      expect(frames.map((frame) => frame.step)).toEqual(
        Array.from({ length: frames.length }, (_, index) => engine.state.step - frames.length + 1 + index),
      )
    }
  })

  it('进球与半场保留首次重置前的球员位置，进球视觉球到球门而非中圈', () => {
    const engine = match()
    const internals = engine as unknown as { resetKickoffPositions(side: MatchSide): void }
    const reset = internals.resetKickoffPositions.bind(engine)
    let beforeReset: MatchPlaybackPose | undefined
    const spy = vi.spyOn(internals, 'resetKickoffPositions').mockImplementation((side) => {
      beforeReset ??= capturePlaybackPose(engine.state)
      reset(side)
    })
    let sawGoal = false
    let sawHalf = false
    try {
      while (!engine.state.finished && (!sawGoal || !sawHalf)) {
        beforeReset = undefined
        const logStart = engine.state.log.length
        engine.step()
        const events = engine.state.log.slice(logStart)
        const goal = events.find((event) => event.type === 'goal')
        const half = events.some((event) => event.type === 'half')
        if (!goal && !half) continue
        const frame = engine.state.playbackFrames!.at(-1)!
        expect(beforeReset).toBeDefined()
        expect(frame.to.players).toEqual(beforeReset!.players)
        expect(frame.to.players).not.toEqual(capturePlaybackPose(engine.state).players)
        expect(frame.to.clock).toBe(engine.state.clock)
        if (goal) {
          sawGoal = true
          expect(frame.goal).toBe(true)
          expect(frame.motion?.kind).toBe('shot')
          expect(frame.to.ball).toMatchObject({ ...frame.motion!.to, ownerId: null })
          expect(frame.to.ball.x).toBe(goal.team === 'home' ? 100 : 0)
          expect(engine.state.ball).toMatchObject({ x: 50, ownerId: null })
          expect(engine.state.pendingSetPiece?.type).toBe('kickoff')
        }
        if (half) sawHalf = true
      }
    } finally {
      spy.mockRestore()
    }
    expect(sawGoal).toBe(true)
    expect(sawHalf).toBe(true)
  })

  it('实时中场在动作前切换场地，记录的是下半场开球的起终点', () => {
    const engine = match(19)
    while (engine.state.clock < engine.state.durationSeconds / 2) engine.step(true)
    expect(engine.state.half).toBe(1)
    const internals = engine as unknown as { resetKickoffPositions(side: MatchSide): void }
    const reset = internals.resetKickoffPositions.bind(engine)
    let afterReset: MatchPlaybackPose | undefined
    const spy = vi.spyOn(internals, 'resetKickoffPositions').mockImplementation((side) => {
      reset(side)
      afterReset = capturePlaybackPose(engine.state)
    })
    try {
      engine.step(true)
      const frame = engine.state.playbackFrames!.at(-1)!
      expect(engine.state.half).toBe(2)
      expect(afterReset).toBeDefined()
      expect(frame.from).toEqual(afterReset)
      expect(frame.restart).toBe('kickoff')
      expect(frame.motion?.from).toEqual({ x: 50, y: 32 })
      expect(frame.to).toEqual(capturePlaybackPose(engine.state))
    } finally { spy.mockRestore() }
  })

  it('旧存档可缺视觉字段；JSON serialize/restore 后后续轨迹与日志一致', () => {
    const engine = match(23)
    for (let i = 0; i < 42; i++) engine.step()
    const serialized = JSON.parse(JSON.stringify(engine.serialize()))
    const restored = MatchEngine.restore(serialized, false)
    expect(restored.state.playbackFrames).toEqual(engine.state.playbackFrames)
    const oldSave = structuredClone(engine.state)
    delete oldSave.playbackFrames
    delete oldSave.ballMotion
    const legacy = MatchEngine.fromState(oldSave)
    expect(legacy.state.playbackFrames).toBeUndefined()

    for (let i = 0; i < 20; i++) {
      engine.step()
      restored.step()
      legacy.step()
      expect(restored.state.playbackFrames).toEqual(engine.state.playbackFrames)
      expect(legacy.state.playbackFrames!.at(-1)).toEqual(engine.state.playbackFrames!.at(-1))
      expect(legacy.state.log).toEqual(engine.state.log)
      expect(legacy.state.decisionRng).toEqual(engine.state.decisionRng)
      expect(legacy.state.resultRng).toEqual(engine.state.resultRng)
    }
    expect(legacy.state.playbackFrames).toEqual(engine.state.playbackFrames)
    const roundTrip = MatchEngine.restore(JSON.parse(JSON.stringify(restored.serialize())), false)
    expect(roundTrip.state.playbackFrames).toEqual(restored.state.playbackFrames)
    expect(roundTrip.simulate()).toEqual(engine.simulate())
    expect(restored.simulate()).toEqual(engine.state)
    expect(legacy.simulate()).toEqual(engine.state)
  })

  it('后台 AI 可关闭视觉采集，比分、事件与随机流不受影响', () => {
    const visible = match(31)
    const background = new MatchEngine({
      seed: 31, knockout: false, recordPlayback: false,
      home: inputFor(roster, lineup, 'home', 'Home'),
      away: inputFor(roster, lineup, 'away', 'Away'),
    })
    const a = visible.simulate()
    const b = background.simulate()
    expect(b.playbackFrames).toBeUndefined()
    expect(b.score).toEqual(a.score)
    expect(b.log).toEqual(a.log)
    expect(b.commentary).toEqual(a.commentary)
    expect(b.teams).toEqual(a.teams)
    expect(b.decisionRng).toEqual(a.decisionRng)
    expect(b.resultRng).toEqual(a.resultRng)
  })

  it('预演步数上限不会强制终场，已结束比赛不再记录帧', () => {
    const engine = match()
    const before = structuredClone(engine.state)
    expect(planMatchReplay(engine, 0)).toEqual({ frames: [], score: { home: 0, away: 0 }, finished: false })
    const partial = planMatchReplay(engine, 3)
    expect(partial.frames).toHaveLength(3)
    expect(partial.finished).toBe(false)
    expect(engine.state).toEqual(before)
    engine.simulate()
    const finished = structuredClone(engine.state)
    expect(planMatchReplay(engine)).toEqual({ frames: [], score: finished.score, finished: true })
    engine.step()
    expect(engine.state).toEqual(finished)
  })

  it('隔离副本保留淘汰赛模式，点球大战仍按原引擎规则执行', () => {
    const engine = match(1, true, 1)
    const before = structuredClone(engine.state)
    const plan = planMatchReplay(engine)
    expect(engine.state).toEqual(before)
    const actual = engine.simulate()
    expect(actual.shootout?.finished).toBe(true)
    expect(plan.finished).toBe(true)
    expect(plan.score).toEqual(actual.score)
    expect(plan.frames).toHaveLength(actual.step)
    expect(plan.frames.slice(-PLAYBACK_FRAME_LIMIT)).toEqual(actual.playbackFrames)
  })
})
