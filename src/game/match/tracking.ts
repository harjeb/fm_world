import { LEAGUE_REALTIME_SECONDS } from './time.ts'
import { PITCH_LENGTH, PITCH_WIDTH } from './team.ts'
import type { MatchPlaybackFrame, MatchPlayerState } from './types.ts'
import { samplePlaybackFrame } from './visualization.ts'

/** soccerAnimate 的 Metrica tidy-data 入口；它固定按 25fps 读取轨迹。 */
export const TRACKING_FPS = 25
export const TRACKING_COLUMNS = ['period', 'frame', 'time', 'second', 'player', 'x', 'y', 'team', 'is_gk', 'dx', 'dy', 'v_mod', 'speed', 'height', 'source_id'] as const
export type TrackingRow = {
  period: number; frame: number; time: number; second: number
  player: string; x: number; y: number; team: 'home' | 'away' | 'ball'; is_gk: boolean
  dx: number; dy: number; v_mod: number; speed: number; height: number; source_id: string
}

/**
 * 把同一份视觉脚本采样成 tracking data，不复制 soccerAnimate 的 R/GPL 实现。
 * 默认缩放到 105×68：上游部分禁区/分析图仍硬编码这个尺寸，不能仅传自定义尺寸。
 * time 是 600 秒回放时间，不是显示出来的 90 分钟比赛钟；second 必须是 floor(time)。
 */
export function* matchTrackingRows(frames: MatchPlaybackFrame[], roster: Pick<MatchPlayerState, 'id' | 'side' | 'number' | 'position'>[], durationSeconds: number, options: { fromSeconds?: number; toSeconds?: number } = {}): Generator<TrackingRow> {
  if (!frames.length || durationSeconds <= 0) return
  const sideNumbers = { home: 0, away: 0 }
  const players = new Map(roster.map((player) => {
    const fallback = ++sideNumbers[player.side]
    return [player.id, { ...player, number: player.number > 0 ? player.number : fallback }]
  }))
  const scale = durationSeconds / LEAGUE_REALTIME_SECONDS
  const start = Math.max(0, options.fromSeconds ?? frames[0].from.clock / scale)
  const end = Math.min(LEAGUE_REALTIME_SECONDS, options.toSeconds ?? frames.at(-1)!.to.clock / scale)
  const history = new Map<string, { x: number; y: number }[]>()
  let index = 0
  let lastFrameStep = -1
  // 先采样前 .8 秒，截取片段的首帧也有正确速度；不会跨越定位球重置计算速度。
  const first = Math.max(0, Math.ceil(start * TRACKING_FPS) - 20)
  for (let sampleIndex = first; sampleIndex <= Math.floor(end * TRACKING_FPS); sampleIndex++) {
    const time = sampleIndex / TRACKING_FPS
    const clock = time * scale
    while (index + 1 < frames.length && frames[index].to.clock <= clock) index++
    const frame = frames[index]
    if (frame.step !== lastFrameStep && (frame.restart || frames[index - 1]?.goal)) history.clear()
    lastFrameStep = frame.step
    if (clock < frame.from.clock || clock > frame.to.clock) continue
    const progress = (clock - frame.from.clock) / Math.max(0.001, frame.to.clock - frame.from.clock)
    const sample = samplePlaybackFrame(frame, progress, frames[index - 1], frames[index + 1])
    const entries = [
      ...sample.players.map((point) => ({ id: point.id, point, height: 0 })),
      { id: 'ball', point: sample.ball, height: sample.ball.height },
    ]
    for (const entry of entries) {
      const player = players.get(entry.id)
      if (!player && entry.id !== 'ball') continue
      const x = entry.point.x / PITCH_LENGTH * 105
      const y = (1 - entry.point.y / PITCH_WIDTH) * 68
      const prior = history.get(entry.id) ?? []
      const past = prior.length === 20 ? prior[0] : { x, y }
      const dx = x - past.x
      const dy = y - past.y
      prior.push({ x, y })
      if (prior.length > 20) prior.shift()
      history.set(entry.id, prior)
      if (time < start) continue
      const v_mod = Math.hypot(dx, dy)
      yield {
        period: clock < durationSeconds / 2 ? 1 : 2,
        frame: sampleIndex, time, second: Math.floor(time),
        player: player ? String(player.number) : '', x, y,
        team: player?.side ?? 'ball', is_gk: player?.position === 'GK',
        dx, dy, v_mod, speed: v_mod / 0.8, height: entry.height, source_id: entry.id,
      }
    }
  }
}

export function trackingCsvRow(row: TrackingRow): string {
  return TRACKING_COLUMNS.map((column) => {
    const value = row[column]
    if (typeof value === 'number') return Number(value.toFixed(5)).toString()
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    return `"${value.replaceAll('"', '""')}"`
  }).join(',')
}
