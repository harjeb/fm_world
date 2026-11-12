/**
 * 7 人制存档 → 11 人制的迁移。
 *
 * 只加随机生成的球员，不加球星：每支球队（玩家自己的、AI 的）补到 25 人，按位置缺口补人；
 * 阵型换成对应的 11 人制阵型并重新自动排首发，命名战术预设也按新阵型重排。
 * 判断条件是“还有没有旧 7 人制阵型”，所以可以反复调用，迁移过一次之后什么都不做。
 * 进行中的旧比赛不动：它的引擎状态自带 7 人制的阵型和场地，踢完照常结算。
 */
import type { AITeam, GameState, Lineup, Player, Position, TacticPreset } from './types.ts'
import { elevenFormationFor, isLegacyFormation } from './data/formations.ts'
import { createRandomPlayer, randomSquadPositionTemplate } from './data/random-players.ts'
import { autoFillLineup } from './squad.ts'
import { validateAutoSubPlan } from './match/management.ts'
import { splitSeed } from './rng.ts'
import { SQUAD_WAGE_SCALE, wageForPlayer } from './world.ts'

const TEMPLATE = randomSquadPositionTemplate()
/** 11 人制每队的人数。 */
export const ELEVEN_SQUAD_SIZE = TEMPLATE.length
const TARGET: Record<Position, number> = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0 }
for (const position of TEMPLATE) TARGET[position]++

function mainPosition(player: Player): Position {
  if (player.positions.GK > 0) return 'GK'
  return (['CB', 'W', 'CM', 'ST'] as const).reduce((best, position) => (player.positions[position] > player.positions[best] ? position : best), 'CM' as Position)
}

/** 按 25 人模板的位置配额，找缺得最多的位置（门将先补，保证至少 2 个）。 */
function nextPosition(players: Player[]): Position {
  const counts: Record<Position, number> = { GK: 0, CB: 0, W: 0, CM: 0, ST: 0 }
  for (const player of players) counts[mainPosition(player)]++
  if (counts.GK < 2) return 'GK'
  let best: Position = 'W'
  let gap = -Infinity
  for (const position of ['W', 'CB', 'CM', 'GK', 'ST'] as const) {
    const missing = TARGET[position] - counts[position]
    if (missing > gap) {
      gap = missing
      best = position
    }
  }
  return best
}

/** AI 球队实力 → 随机球员的档次（和世界生成一致）。 */
export function tierForStrength(strength: number): number {
  return strength >= 5 ? 4 : strength >= 3 ? 3 : 2
}

/**
 * 把一支球队补到 25 人，返回新补的人（不改原数组）。种子和 key 固定，所以同一支队补出来的人每次都一样。
 */
export function elevenReinforcements(players: Player[], options: { seed: number; key: string; tier: number }): Player[] {
  const used = new Set(players.flatMap((player) => [player.name, player.enName]))
  const added: Player[] = []
  for (let index = 0; players.length + added.length < ELEVEN_SQUAD_SIZE; index++) {
    const position = nextPosition([...players, ...added])
    added.push(createRandomPlayer({
      seed: splitSeed(options.seed, `eleven-${options.key}-${index}`),
      position,
      tier: options.tier,
      usedNames: used,
      idPrefix: `${options.key}-e${index + 1}`,
    }))
  }
  return added
}

/** 不带预设的 11 人制阵容（迁移用：旧的自定义摆位是 7 人制槽位的，不能沿用，但保留战术风格与十二项指令）。 */
function freshLineup(
  roster: Player[],
  formationId: string,
  tactics: Lineup['tactics'],
  source?: Pick<Lineup, 'tacticalStyle' | 'tacticalInstructions' | 'matchPlan'>,
): Omit<Lineup, 'presets'> {
  const id = elevenFormationFor(formationId)
  // 传一个空的“旧阵容”，避免 autoFillLineup 去拿最近校验过的 7 人制阵容里的摆位和预设。
  const { presets: _presets, ...lineup } = autoFillLineup(roster, id, tactics, {
    formationId: id,
    tacticalStyle: source?.tacticalStyle,
    tacticalInstructions: source?.tacticalInstructions,
    matchPlan: source?.matchPlan,
  })
  return lineup
}

/** 玩家阵容迁移：换阵型、重排首发，命名预设各自按新阵型重排。 */
export function elevenLineup(roster: Player[], lineup: Lineup): Lineup {
  const next: Lineup = freshLineup(roster, lineup.formationId, lineup.tactics, lineup)
  if (lineup.presets?.length) {
    next.presets = lineup.presets.map((preset): TacticPreset => ({
      ...preset,
      lineup: freshLineup(roster, preset.lineup.formationId, preset.lineup.tactics, preset.lineup),
    }))
  }
  return next
}

/** AI 球队迁移：补人、换阵型、重排首发。 */
export function elevenAITeam(team: AITeam, seed: number): AITeam {
  const formationId = elevenFormationFor(team.formationId)
  const extra = elevenReinforcements(team.players, { seed, key: team.id, tier: tierForStrength(team.strength) })
  const players = [...team.players, ...extra]
  return { ...team, formationId, players, lineup: freshLineup(players, formationId, team.lineup?.tactics ?? team.tactics) }
}

export function needsElevenUpgrade(game: Pick<GameState, 'lineup' | 'aiTeams' | 'world'>): boolean {
  return isLegacyFormation(game.lineup?.formationId ?? '')
    || (game.aiTeams ?? []).some((team) => isLegacyFormation(team.formationId) || isLegacyFormation(team.lineup?.formationId ?? ''))
    || (game.world?.clubs ?? []).some((club) => isLegacyFormation(club.formationId))
}

/** 存档迁移到 11 人制；没有要迁移的返回 false。 */
export function upgradeElevenASide(game: GameState): boolean {
  if (!game?.lineup || !Array.isArray(game.roster) || !needsElevenUpgrade(game)) return false
  if (isLegacyFormation(game.lineup.formationId)) {
    const club = game.world?.clubs.find((item) => item.id === 'player')
    const key = club?.squadKey ?? 'player'
    const extra = elevenReinforcements(game.roster, { seed: game.seed, key, tier: tierForStrength(club?.strength ?? 2) })
    // 已有合同的工资同比例下调（队伍变成 25 人，整队工资总额保持和 7 人制时相当）。
    for (const player of game.roster) {
      if (player.contract?.clubId === 'player') player.contract.wage = Math.max(500, Math.round((player.contract.wage * SQUAD_WAGE_SCALE) / 50) * 50)
    }
    for (const player of extra) {
      player.contract = { clubId: 'player', wage: wageForPlayer(player), expiresSeason: (game.season?.index ?? 1) + 2 }
    }
    game.roster = [...game.roster, ...extra]
    game.lineup = elevenLineup(game.roster, game.lineup)
    if (game.autoSubs && validateAutoSubPlan(game.roster, game.lineup, game.autoSubs).length) delete game.autoSubs
  }
  game.aiTeams = (game.aiTeams ?? []).map((team) => (isLegacyFormation(team.formationId) || isLegacyFormation(team.lineup?.formationId ?? '') ? elevenAITeam(team, game.seed) : team))
  for (const club of game.world?.clubs ?? []) {
    if (isLegacyFormation(club.formationId)) club.formationId = elevenFormationFor(club.formationId)
  }
  return true
}
