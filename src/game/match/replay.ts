import type { MatchEngine } from './engine.ts'
import type { MatchPlaybackFrame } from './types.ts'

/** 友谊赛预演：只推进隔离副本，联赛应播放服务器已经确认的 frames。 */
export function planMatchReplay(engine: MatchEngine, maxSteps = 20000): {
  frames: MatchPlaybackFrame[]
  score: { home: number; away: number }
  finished: boolean
} {
  const preview = engine.clone()
  const frames: MatchPlaybackFrame[] = []
  const ring = preview.state.playbackFrames ?? []
  let lastKey = ring.length ? (ring.at(-1)!.seq ?? ring.at(-1)!.step) : 0
  let steps = 0
  while (!preview.state.finished && steps++ < maxSteps) {
    preview.step()
    // v3 一步会写入多帧（每 0.2 秒一帧），必须按 seq 收集这一步行增的全部轨迹。
    for (const frame of preview.state.playbackFrames ?? []) {
      const key = frame.seq ?? frame.step
      if (key > lastKey) {
        frames.push(frame)
        lastKey = key
      }
    }
  }
  return { frames, score: { ...preview.state.score }, finished: preview.state.finished }
}
