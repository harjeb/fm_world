import type { AITeam } from './types.ts'
import { caOf } from './ca.ts'
import { ALL_ATTRIBUTES } from './types.ts'
import { attrHardLimit, attrLimit, attrRating, attrStorage, mainAttrsFor } from './scale.ts'

/** 以实际首发而非名单前 11 人/最高 CA 的 11 人核算。 */
export function startingCa(team: AITeam): number {
  const ids = new Set(team.lineup.starters.map((entry) => entry.playerId))
  const players = team.players.filter((player) => ids.has(player.id))
  return players.reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / (players.length || 1)
}

/** Calibrate generated PvE opponents while retaining their profile; never use for club training. */
export function alignPveStrength(source: AITeam, target: number): AITeam {
  if (!(target > 0 && target <= 1500)) throw new Error('PvE 目标 CA 必须在 (0, 1500]')
  const team = structuredClone(source)
  let low = 0, high = 8
  const rebuild = (power: number) => {
    for (let i = 0; i < team.players.length; i++) {
      const player = team.players[i], base = source.players[i]
      const gk = player.positions.GK > 0
      for (const key of ALL_ATTRIBUTES) {
        const cap = attrLimit(key, gk)
        player.attrs[key] = cap === 0 ? 0 : attrStorage(key, 100 * Math.pow(Math.max(0.001, attrRating(key, base.attrs[key], gk) / 100), power), gk)
      }
    }
  }
  for (let step = 0; step < 50; step++) {
    const power = (low + high) / 2
    rebuild(power)
    if (startingCa(team) > target) low = power
    else high = power
  }
  rebuild((low + high) / 2)
  // 残差消除，防止同目标 CA 的相邻两关因浮点/取整出现倒退。
  let residual = (target - startingCa(team)) * team.lineup.starters.length
  for (const starter of team.lineup.starters) {
    const player = team.players.find((entry) => entry.id === starter.playerId)!
    const gk = player.positions.GK > 0
    const count = gk ? 22 : 18
    for (const key of mainAttrsFor(gk)) {
      if (Math.abs(residual) < 1e-9) break
      const before = caOf(player.attrs, gk)
      const squared = (attrRating(key, player.attrs[key], gk) / 100) ** 2
      player.attrs[key] = attrStorage(key, 100 * Math.sqrt(Math.max(0, Math.min(1, squared + residual * count / 1500))), gk)
      residual -= caOf(player.attrs, gk) - before
    }
  }
  for (const player of team.players) {
    player.ceilings = { ...player.attrs }; player.baseAttrs = { ...player.attrs }
    player.pa = caOf(player.attrs, player.positions.GK > 0)
  }
  return team
}

/** 传奇杯高强度校准：在硬上限（主属性 2000、隐藏属性 20）内将整队对齐到最高 1940 首发 CA，同时保留每名球员原有属性画像。 */
export function alignHighCaTeam(source: AITeam, target: number): AITeam {
  if (!(target > 0 && target <= 1940)) throw new Error('高强度目标 CA 必须在 (0, 1940]')
  const team = structuredClone(source)
  let low = 0, high = 8
  const rebuild = (power: number) => {
    for (let i = 0; i < team.players.length; i++) {
      const player = team.players[i], base = source.players[i]
      const gk = player.positions.GK > 0
      for (const key of ALL_ATTRIBUTES) {
        const hard = attrHardLimit(key, gk)
        if (hard === 0) {
          player.attrs[key] = 0
          continue
        }
        const maxRating = attrRating(key, hard, gk)
        const baseRatio = Math.max(0.001, Math.min(1, attrRating(key, base.attrs[key], gk) / 100))
        const rating = maxRating * Math.pow(baseRatio, power)
        player.attrs[key] = Math.min(hard, attrStorage(key, rating, gk))
      }
    }
  }
  for (let step = 0; step < 60; step++) {
    const power = (low + high) / 2
    rebuild(power)
    if (startingCa(team) > target) low = power
    else high = power
  }
  rebuild((low + high) / 2)
  let residual = (target - startingCa(team)) * team.lineup.starters.length
  for (const starter of team.lineup.starters) {
    const player = team.players.find((entry) => entry.id === starter.playerId)!
    const gk = player.positions.GK > 0
    const count = gk ? 22 : 18
    for (const key of mainAttrsFor(gk)) {
      if (Math.abs(residual) < 1e-9) break
      const hard = attrHardLimit(key, gk)
      const maxSq = (attrRating(key, hard, gk) / 100) ** 2
      const before = caOf(player.attrs, gk)
      const squared = (attrRating(key, player.attrs[key], gk) / 100) ** 2
      const nextSq = Math.max(0, Math.min(maxSq, squared + residual * count / 1500))
      player.attrs[key] = Math.min(hard, attrStorage(key, 100 * Math.sqrt(nextSq), gk))
      residual -= caOf(player.attrs, gk) - before
    }
  }
  for (const player of team.players) {
    player.ceilings = { ...player.attrs }; player.baseAttrs = { ...player.attrs }
    player.pa = caOf(player.attrs, player.positions.GK > 0)
  }
  return team
}

/**
 * 只给特别 Boss 使用：保留当前 attrs/首发 CA 不变，把 ceilings/PA 拉到球星上限。
 * 比赛只读 attrs，所以不会改变关卡难度；潜力数据用于展示和未来的成长玩法。
 */
export function applyStarPotential(team: AITeam, targets: Record<string, number>): AITeam {
  const result = structuredClone(team)
  for (const player of result.players) {
    const target = Math.max(caOf(player.attrs, player.positions.GK > 0), targets[player.enName] ?? 1300)
    const mini = structuredClone(team)
    mini.players = [structuredClone(player)]
    mini.playerNames = [player.name]
    const starter = mini.lineup.starters[0] ?? { slotId: 'solo', playerId: player.id, role: 'st_finisher' as const }
    mini.lineup = { ...mini.lineup, starters: [{ ...starter, playerId: player.id }], bench: [] }
    const scaled = alignPveStrength(mini, target).players[0]
    player.ceilings = { ...scaled.attrs }
    player.pa = scaled.pa
  }
  return result
}
