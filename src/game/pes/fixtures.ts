/**
 * 测试和脚本用的“合成球队”：按阵型摆好站位，属性围绕一个水平值随机（带一点位置倾向），再用 `abilityOf` 换算成运动层能力。
 * 不依赖世界生成，也不依赖 localStorage，几毫秒就能造好一队。
 */
import { derivedRng } from '../rng.ts'
import { ALL_ATTRIBUTES, type AttrKey, type FormationId } from '../types.ts'
import { abilityOf, type AttrRecord } from './ability.ts'
import { formationRows } from './formation.ts'
import type { PesTeamInit } from './sim.ts'
import type { PesTactics } from './spec.ts'

/** 各位置的属性倾向（相对水平值的加减）。 */
const BIAS: Record<string, Partial<Record<AttrKey, number>>> = {
  GK: { reflexes: 22, handling: 20, rushing: 14, oneOnOne: 16, speed: -8, shooting: -15, dribbling: -12 },
  CB: { tackling: 10, defPos: 10, strength: 9, heading: 9, shooting: -10, dribbling: -6 },
  CM: { passing: 8, vision: 8, firstTouch: 6, teamwork: 6, endurance: 6 },
  LB: { speed: 7, tackling: 7, defPos: 6, endurance: 6, shooting: -8 },
  RB: { speed: 7, tackling: 7, defPos: 6, endurance: 6, shooting: -8 },
  LW: { speed: 10, acceleration: 9, dribbling: 9, agility: 6, tackling: -8, defPos: -6 },
  RW: { speed: 10, acceleration: 9, dribbling: 9, agility: 6, tackling: -8, defPos: -6 },
  ST: { shooting: 12, composure: 8, offBall: 9, heading: 5, tackling: -10, defPos: -9 },
}

export interface FixtureOptions {
  /** 属性均值（0–100），默认 38.3（换算后能力约 0.65，典型球员） */
  level?: number
  /** 个体波动幅度（±），默认 8 */
  spread?: number
  seed?: number
  tactics?: Partial<PesTactics>
  /** 球员名前缀，默认 H / A */
  prefix?: string
}

export function fixtureTeam(formationId: FormationId, options: FixtureOptions = {}): PesTeamInit {
  const level = options.level ?? 38.3
  const spread = options.spread ?? 8
  const rng = derivedRng(options.seed ?? 1, 'pes-fixture', formationId, options.prefix ?? 'T')
  return {
    tactics: options.tactics,
    players: formationRows(formationId).map((row, index) => {
      const bias = BIAS[row.role] ?? {}
      const attrs: AttrRecord = {}
      for (const key of ALL_ATTRIBUTES) attrs[key] = level + (bias[key] ?? 0) + (rng.float() - 0.5) * 2 * spread
      return {
        name: `${options.prefix ?? 'T'}${index + 1}`,
        role: row.role,
        nx: row.nx,
        ny: row.ny,
        line: row.line,
        abilities: abilityOf(attrs),
      }
    }),
  }
}
