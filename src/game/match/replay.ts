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
  let steps = 0
  while (!preview.state.finished && steps++ < maxSteps) {
    preview.step()
    const frame = preview.state.playbackFrames?.at(-1)
    if (frame) frames.push(frame)
  }
  return { frames, score: { ...preview.state.score }, finished: preview.state.finished }
}
