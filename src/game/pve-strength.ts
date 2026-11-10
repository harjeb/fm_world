import type { AITeam } from './types.ts'
import { caOf } from './ca.ts'
import { ALL_ATTRIBUTES } from './types.ts'
import { attrLimit, attrRating, attrStorage, mainAttrsFor } from './scale.ts'

/** 以实际首发而非名单前 11 人/最高 CA 的 11 人核算。 */
export function startingCa(team: AITeam): number {
  const ids = new Set(team.lineup.starters.map((entry) => entry.playerId))
  const players = team.players.filter((player) => ids.has(player.id))
  return players.reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / (players.length || 1)
}

/** 仅用于离线生成 PvE 内容：保留强弱次序，精确校准首发平均；绝不用于玩家/AI 培养。 */
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

/**
 * 只给特别 Boss 使用：保留当前 attrs/首发 CA 不变，把 ceilings/PA 拉到球星上限。
 * 比赛只读 attrs，所以不会改变关卡难度；潜力数据用于展示和未来的成长玩法。
 */
export function applyStarPotential(team: AITeam, potentialCa = 1500): AITeam {
  const result = structuredClone(team)
  const potential = alignPveStrength(structuredClone(team), potentialCa)
  const byId = new Map(potential.players.map((player) => [player.id, player]))
  for (const player of result.players) {
    const target = byId.get(player.id)!
    player.ceilings = { ...target.attrs }
    player.pa = target.pa
  }
  return result
}
