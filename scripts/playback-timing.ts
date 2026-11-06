/**
 * 2D 比赛节奏基线：
 *   stageA —— 同样的 v2 已确认轨迹，旧画法 vs 新动作时间线的出脚等待。
 *   stageB —— v3 权威子帧：10 Hz 轨迹是否首尾相接、球是否贴脚、每动作多少帧。
 *
 *   npm run match:timing
 *
 * 只读：预演在隔离副本上运行，不修改任何存档。
 */
import { createInitialGame } from '../src/game/state.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { planMatchReplay } from '../src/game/match/replay.ts'
import { playbackTimeline, samplePlaybackFrame } from '../src/game/match/visualization.ts'
import { friendlyStepMs } from '../src/ui/match-timing.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import type { MatchPlaybackFrame } from '../src/game/match/types.ts'

const seeds = Array.from({ length: 8 }, (_, index) => 2024 + index)
const NORMAL_SPEED = 2700
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
const round3 = (value: number) => Number(value.toFixed(3))

function engineFor(seed: number, rulesVersion: 2 | 3, recordPlayback = true): MatchEngine {
  const game = createInitialGame(seed)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#34d399', accent: '#052e1b' })
  return new MatchEngine({
    seed,
    home: input,
    away: structuredClone(input),
    knockout: false,
    durationSeconds: LOGIC_MATCH_SECONDS,
    rulesVersion,
    recordPlayback,
  })
}

function replay(seed: number, rulesVersion: 2 | 3): MatchPlaybackFrame[] {
  return planMatchReplay(engineFor(seed, rulesVersion)).frames
}

// ── 阶段 A：v2 轨迹 + 新时间线 ────────────────────────────────────────
type StageARow = {
  kind: string
  logicalRelease: number
  wallBeforeKick: number
  wallTotal: number
  logicalSettle: number
  fallback: boolean
  stationaryCarrier: boolean
  endError: number
  oldWallWait: number
}

const stageA: StageARow[] = []
for (const seed of seeds) {
  const frames = replay(seed, 2)
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    if (!frame.motion || frame.motion.kind === 'dribble') continue
    const plan = playbackTimeline(frame, frames[index - 1], frames[index + 1])
    const duration = Math.max(0.01, frame.to.clock - frame.from.clock)
    const wallTotal = friendlyStepMs(duration, NORMAL_SPEED) / 1000
    const carrier = frame.from.players.find((player) => player.id === frame.from.ball.ownerId)
    const carrierEnd = frame.to.players.find((player) => player.id === frame.from.ball.ownerId)
    const end = samplePlaybackFrame(frame, 1).ball
    // 射偏/出界的 to.ball 是下一次定位球位置，这一段球应落到 motion.to。
    const expected = !frame.goal && !frame.to.ball.ownerId ? frame.motion.to : frame.to.ball
    // 旧画法：arrival=0.9，flight = distance/23/duration（上限 0.65），release = arrival - flight。
    const travel = Math.hypot(frame.motion.to.x - frame.motion.from.x, frame.motion.to.y - frame.motion.from.y)
    const oldFlight = Math.max(0.2, Math.min(frame.motion.via ? 0.78 : 0.65, travel / 23 / duration))
    const oldRelease = Math.max(0, 0.9 - oldFlight) * duration
    stageA.push({
      kind: frame.motion.kind,
      logicalRelease: plan.release,
      wallBeforeKick: wallTotal * (plan.release / duration),
      wallTotal,
      logicalSettle: duration - plan.arrival,
      fallback: plan.fallback,
      stationaryCarrier: !!carrier && !!carrierEnd && Math.hypot(carrier.x - carrierEnd.x, carrier.y - carrierEnd.y) < 0.01,
      endError: Math.hypot(end.x - expected.x, end.y - expected.y),
      oldWallWait: wallTotal * (oldRelease / duration),
    })
  }
}

const passes = stageA.filter((row) => row.kind === 'pass')
const byKind = Object.fromEntries([...new Set(stageA.map((row) => row.kind))].map((kind) => {
  const subset = stageA.filter((row) => row.kind === kind)
  return [kind, {
    samples: subset.length,
    wallBeforeKick: round3(mean(subset.map((row) => row.wallBeforeKick))),
    oldWallWait: round3(mean(subset.map((row) => row.oldWallWait))),
    settle: round3(mean(subset.map((row) => row.logicalSettle))),
    fallback: round3(subset.filter((row) => row.fallback).length / subset.length),
  }]
}))

// ── 阶段 B：v3 权威子帧 ──────────────────────────────────────────────
type StageBRow = {
  frames: number
  actions: number
  framesPerAction: number
  substepShare: number
  contiguousShare: number
  ballSeamMax: number
  playerSeamMax: number
  /** 死球重启是明确的硬切，单独统计，不算“意外瞬移”。 */
  restartCuts: number
  restartSeamMax: number
  ownerGlueMax: number
  spanMax: number
  seqContiguous: boolean
  staticBallShare: number
  releaseOffsetMean: number
  carrierMoveMean: number
}

const stageB: StageBRow[] = []
for (const seed of seeds) {
  const frames = replay(seed, 3)
  const actions = new Set(frames.map((frame) => frame.step)).size
  let ballSeamMax = 0
  let playerSeamMax = 0
  let restartCuts = 0
  let restartSeamMax = 0
  let ownerGlueMax = 0
  let spanMax = 0
  let contiguous = 0
  let staticBall = 0
  let seqContiguous = true
  const releaseOffsets: number[] = []
  const carrierMoves: number[] = []
  const groups = new Map<number, MatchPlaybackFrame[]>()
  for (const frame of frames) {
    const group = groups.get(frame.step) ?? []
    group.push(frame)
    groups.set(frame.step, group)
  }
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    spanMax = Math.max(spanMax, frame.to.clock - frame.from.clock)
    if (index > 0) {
      const previous = frames[index - 1]
      if (frame.seq !== undefined && previous.seq !== undefined && frame.seq !== previous.seq + 1) seqContiguous = false
      if (Math.abs(frame.from.clock - previous.to.clock) < 1e-9) contiguous++
      const ballSeam = Math.hypot(frame.from.ball.x - previous.to.ball.x, frame.from.ball.y - previous.to.ball.y)
      let playerSeam = 0
      const before = new Map(previous.to.players.map((player) => [player.id, player]))
      for (const player of frame.from.players) {
        const old = before.get(player.id)
        if (old) playerSeam = Math.max(playerSeam, Math.hypot(player.x - old.x, player.y - old.y))
      }
      if (frame.restart) {
        restartCuts++
        restartSeamMax = Math.max(restartSeamMax, ballSeam, playerSeam)
      } else {
        ballSeamMax = Math.max(ballSeamMax, ballSeam)
        playerSeamMax = Math.max(playerSeamMax, playerSeam)
      }
    }
    if (frame.from.ball.ownerId && frame.from.ball.ownerId === frame.to.ball.ownerId) {
      if (Math.hypot(frame.to.ball.x - frame.from.ball.x, frame.to.ball.y - frame.from.ball.y) < 0.01) staticBall++
    }
    if (frame.to.ball.ownerId) {
      const owner = frame.to.players.find((player) => player.id === frame.to.ball.ownerId)
      if (owner) ownerGlueMax = Math.max(ownerGlueMax, Math.hypot(owner.x - frame.to.ball.x, owner.y - frame.to.ball.y))
    }
  }
  for (const group of groups.values()) {
    if (group.length === 0) continue
    // 出脚帧：上一帧球还在脚下，这一帧球已离脚。
    const release = group.find((frame) => frame.from.ball.ownerId && !frame.to.ball.ownerId)
    if (!release) continue
    releaseOffsets.push(release.from.clock - group[0].from.clock)
    const start = group[0].from.players.find((player) => player.id === release.from.ball.ownerId)
    const at = release.from.players.find((player) => player.id === release.from.ball.ownerId)
    if (start && at) carrierMoves.push(Math.hypot(at.x - start.x, at.y - start.y))
  }
  stageB.push({
    frames: frames.length,
    actions,
    framesPerAction: frames.length / Math.max(1, actions),
    substepShare: frames.filter((frame) => frame.substep).length / Math.max(1, frames.length),
    contiguousShare: contiguous / Math.max(1, frames.length - 1),
    ballSeamMax,
    playerSeamMax,
    restartCuts,
    restartSeamMax,
    ownerGlueMax,
    spanMax,
    seqContiguous,
    staticBallShare: staticBall / Math.max(1, frames.length),
    releaseOffsetMean: mean(releaseOffsets),
    carrierMoveMean: mean(carrierMoves),
  })
}

const average = <K extends keyof StageBRow>(key: K, pick: (value: StageBRow[K]) => number = (value) => Number(value)) =>
  mean(stageB.map((row) => pick(row[key])))

// 性能：同一批种子、同样采集轨迹，v2 整步 vs v3 0.1 秒步进。
const timings = ([2, 3] as const).map((rulesVersion) => {
  const runs: number[] = []
  for (const seed of seeds.slice(0, 5)) {
    const engine = engineFor(seed, rulesVersion)
    const started = performance.now()
    engine.simulate()
    runs.push(performance.now() - started)
  }
  return { rulesVersion, avgMs: Number(mean(runs).toFixed(1)), maxMs: Number(Math.max(...runs).toFixed(1)) }
})

console.log(JSON.stringify({
  stageA: {
    samples: stageA.length,
    passes: passes.length,
    meanWallBeforeKick: round3(mean(stageA.map((row) => row.wallBeforeKick))),
    passMeanWallBeforeKick: round3(mean(passes.map((row) => row.wallBeforeKick))),
    oldModelMeanWallWait: round3(mean(stageA.map((row) => row.oldWallWait))),
    meanWallTotal: round3(mean(stageA.map((row) => row.wallTotal))),
    meanLogicalRelease: round3(mean(stageA.map((row) => row.logicalRelease))),
    meanLogicalSettle: round3(mean(stageA.map((row) => row.logicalSettle))),
    fallbackShare: round3(stageA.filter((row) => row.fallback).length / Math.max(1, stageA.length)),
    passFallbackShare: round3(passes.filter((row) => row.fallback).length / Math.max(1, passes.length)),
    stationaryCarrierShare: round3(stageA.filter((row) => row.stationaryCarrier).length / Math.max(1, stageA.length)),
    endErrorMax: Number(Math.max(...stageA.map((row) => row.endError)).toFixed(4)),
    byKind,
  },
  stageB: {
    matches: stageB.length,
    meanFrames: round3(average('frames')),
    meanActions: round3(average('actions')),
    framesPerAction: round3(average('framesPerAction')),
    substepShare: round3(average('substepShare')),
    contiguousShare: round3(average('contiguousShare')),
    ballSeamMax: Number(average('ballSeamMax').toFixed(6)),
    playerSeamMax: Number(average('playerSeamMax').toFixed(6)),
    restartCuts: stageB.reduce((sum, row) => sum + row.restartCuts, 0),
    restartCutsPerMatch: round3(average('restartCuts')),
    restartSeamMax: Number(Math.max(...stageB.map((row) => row.restartSeamMax)).toFixed(3)),
    ownerGlueMax: Number(average('ownerGlueMax').toFixed(6)),
    spanMax: Number(average('spanMax').toFixed(4)),
    seqContiguous: stageB.every((row) => row.seqContiguous),
    staticBallShare: round3(average('staticBallShare')),
    releaseOffsetMean: round3(average('releaseOffsetMean')),
    carrierMoveMean: round3(average('carrierMoveMean')),
  },
  timings,
}, null, 2))
