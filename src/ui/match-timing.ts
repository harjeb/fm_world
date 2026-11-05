import { LEAGUE_REALTIME_SECONDS } from '../game/match/time.ts'
import type { BallMotion } from '../game/match/types.ts'

/**
 * 友谊赛的播放速度档位（ms / 一次动作，动作平均 4.1 逻辑秒）：
 *   慢 4000 ≈ 一场 13–15 分钟，正常 2700 ≈ 9–10 分钟，快 1350 ≈ 4–5 分钟。
 * 联赛时长独立固定为 600 秒。
 */

/** 一步平均的逻辑秒数（900 秒约 250–300 步）。 */
const AVERAGE_STEP_SECONDS = 4.1

/** 友谊赛这一步在屏幕上播多久；也是下一步开始前要等的时间。 */
export function friendlyStepMs(logicalSeconds: number, matchSpeed: number): number {
  const ms = (logicalSeconds / AVERAGE_STEP_SECONDS) * matchSpeed
  return Math.max(matchSpeed * 0.3, Math.min(matchSpeed * 2.5, ms))
}

/** 联赛动作按真实时长入队；不额外填充等待，否则每步都会追不上时钟。 */
export function leagueTweenMs(logicalSeconds: number, durationSeconds: number): number {
  const real = durationSeconds > 0 ? (logicalSeconds / durationSeconds) * LEAGUE_REALTIME_SECONDS * 1000 : 0
  return Math.max(80, Math.min(12_000, real))
}

/**
 * 比赛进行时球员一直小幅走动（单位：米），定位球前的等待不至于整个画面静止。
 * 只影响画面，不影响比赛结果。每个人的节奏由 id 决定，不会步调一致。
 */
export function idleSway(id: string, seconds: number): { x: number; y: number } {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const phase = (hash % 628) / 100
  const speed = 0.7 + ((hash >>> 8) % 60) / 100
  return { x: Math.sin(seconds * speed + phase) * 0.8, y: Math.cos(seconds * speed * 0.8 + phase * 1.7) * 0.6 }
}

/** 传球沿两点间轨迹运动；长传略有弧度，盘带由控球人的逐帧坐标驱动。 */
export function ballPosition(progress: number, from: { x: number; y: number }, to: { x: number; y: number }, motion?: BallMotion): { x: number; y: number } {
  const progress01 = Math.max(0, Math.min(1, progress))
  const firstLeg = !!motion?.via && progress01 < 0.65
  const start = motion?.via && !firstLeg ? motion.via : from
  const end = motion?.via && firstLeg ? motion.via : to
  const t = motion?.via ? firstLeg ? progress01 / 0.65 : (progress01 - 0.65) / 0.35 : progress01
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dist = Math.hypot(dx, dy)
  const bend = ((motion?.kind === 'pass' || firstLeg) && dist > 22) ? Math.min(1.8, dist * 0.035) * Math.sin(Math.PI * t) : 0
  return { x: start.x + dx * t - (dist ? dy / dist : 0) * bend, y: start.y + dy * t + (dist ? dx / dist : 0) * bend }
}
