import type { MatchPlayerState, MatchSide } from './types.ts'
import { GOAL_Y, PITCH_LENGTH } from './team.ts'

/**
 * 球场几何与概率换算的小函数。原先写在 engine.ts 顶部，结算内核（resolution.ts）、
 * 评分（ratings.ts）和引擎都要用，所以单独成文件。函数体与搬出前完全一致。
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-9) return distance(point, a)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1)
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

export function logit(p: number): number {
  const safe = clamp(p, 0.001, 0.999)
  return Math.log(safe / (1 - safe))
}

export function dirOf(side: MatchSide): number {
  return side === 'home' ? 1 : -1
}

export function goalXOf(side: MatchSide): number {
  return side === 'home' ? PITCH_LENGTH : 0
}

export function ownGoalXOf(side: MatchSide): number {
  return side === 'home' ? 0 : PITCH_LENGTH
}

export function progressOf(side: MatchSide, x: number): number {
  return clamp(side === 'home' ? x / PITCH_LENGTH : (PITCH_LENGTH - x) / PITCH_LENGTH, 0, 1)
}

export function inBox(side: MatchSide, point: { x: number; y: number }): boolean {
  const x = side === 'home' ? point.x : PITCH_LENGTH - point.x
  return x >= 84 && point.y >= 18 && point.y <= 46
}

export function wideZone(point: { x: number; y: number }): boolean {
  return point.y < 17 || point.y > 47
}

export function weakFoot(player: MatchPlayerState): boolean {
  if (player.foot === 'B') return false
  const offensiveLeft = player.side === 'home' ? player.y < GOAL_Y : player.y > GOAL_Y
  return (player.foot === 'L') !== offensiveLeft
}
