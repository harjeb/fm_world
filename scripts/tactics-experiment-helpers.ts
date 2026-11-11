import path from 'node:path'
import type { MatchTeamInput } from '../src/game/match/types.ts'

export type Scenario = 'mirror' | 'technical' | 'lowTech' | 'speed'
export type MatchSpec = {
  seed: number
  scenario: Scenario
  aConfig: string
  famA: number
  bConfig?: string
  famB?: number
  aHome: boolean
}

/** 同一规格的一切结果都必须通过此键读写，缺省对手为 B0。 */
export const keyOf = (spec: MatchSpec): string =>
  `${spec.scenario}|${spec.aConfig}|${spec.famA}|${spec.bConfig ?? 'blank'}|${spec.famB ?? 1}|${spec.seed}|${spec.aHome}`

/** 保留客队身份，复制全部场上相关的阵型、战术、人员、技能和属性。 */
export function makeExactMirror(home: MatchTeamInput, away: MatchTeamInput): void {
  away.formationId = home.formationId
  away.tactics = structuredClone(home.tactics)
  away.starters = structuredClone(home.starters)
  away.bench = structuredClone(home.bench)
}

/** 实验画像独立文件，避免一个画像覆盖另一个画像。 */
export function defaultOutputPath(name: string, squad: number, exactMirror: boolean): string {
  const suffix = `${squad > 0 ? `-squad${squad}` : ''}${exactMirror ? '-mirror' : ''}`
  return path.join('docs', `${name}${suffix}.json`)
}
