import { baselineTeams } from '../src/game/pes/baseline.ts'
import { autoFillLineup } from '../src/game/squad.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { attrLimit, attrStorage } from '../src/game/scale.ts'
import { ALL_ATTRIBUTES } from '../src/game/types.ts'
import type { MatchTeamInput } from '../src/game/match/types.ts'
import { makeExactMirror } from './tactics-experiment-helpers.ts'

export type AblationFormation = '4-4-2' | '4-3-3'

/**
 * 固定 18 人球员池，统一属性后按阵型自动排阵；双方完整复制同一阵容但保留不同球队身份。
 * 不修改 baselineTeams 缓存的球员。跨阵型可能更换首发 / 职责，实验报告必须披露。
 */
export function ablationFixture(formation: AblationFormation): { home: MatchTeamInput; away: MatchTeamInput } {
  const base = baselineTeams(1)
  let home = structuredClone(base.home)
  const away = structuredClone(base.away)
  for (const team of [home, away]) {
    delete team.autoSubs
    delete team.chemistry
    for (const player of [...team.starters.map((s) => s.player), ...team.bench]) {
      player.condition = 100
      const gk = player.positions.GK > 0
      for (const key of ALL_ATTRIBUTES) {
        const limit = attrLimit(key, gk)
        player.attrs[key] = limit <= 0 ? 0 : Math.min(limit, Math.round(attrStorage(key, 67, gk)))
      }
    }
  }
  if (formation !== '4-4-2') {
    const roster = [...home.starters.map((s) => s.player), ...home.bench]
    const lineup = autoFillLineup(roster, formation, home.tactics)
    home = teamInputFromLineup(roster, lineup, { id: home.id, name: home.name, color: home.color, accent: home.accent })
  }
  makeExactMirror(home, away)
  return { home, away }
}
