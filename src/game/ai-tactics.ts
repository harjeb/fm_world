/**
 * AI 球队战术画像、临场战术调度与智能换人系统。
 *
 * 设计目标：
 * 1. 因材施教（赛前战术配置）：综合俱乐部的建队风格（`style` / 五项基础倾向 / 阵型结构 / 联赛级别）
 *    与当前首发阵容的真实球员能力（传控技术、边路冲击、锋线速度与争顶身高、后卫回追速度、全队体能耐力），
 *    为每支 AI 球队匹配最契合的 `STYLES_REV3` 战术风格并微调十二项战术指令。
 * 2. 临场应变（赛中动态调整）：AI 教练根据实时比分差、比赛分钟数、红牌人数劣势、场上体能与双方实力对比，
 *    在落后追分、末段搏命、一球守胜、两球控场、少人死守、平局破冰等局势下动态调整战术指令与心态。
 * 3. 智能换人（分波次轮换与局势换人）：除伤病与体能枯竭兜底外，按真实足球 56′（黄牌风险）、60′（首轮调整）、
 *    73′（次轮强攻/锁局/轮休主力）、82′（终场生力军）分波次派上位置匹配、体能充沛的替补球员。
 *
 * 全模块纯确定性（不消耗任何世界或比赛 RNG），确保联机 `MatchJob` 预计算与客户端 2D 回放 100% 逐帧一致。
 */
import type { AutoSubPlan, FormationId, Lineup, MatchMentality, Player, Position, RoleId, Tactics, TierId } from './types.ts'
import type { MatchPlayerState, MatchTeamState } from './match/types.ts'
import { FORMATIONS } from './data/formations.ts'
import { FULL_BACK_DEPTH, ROLES } from './data/roles.ts'
import { CA_SCALE, PLAYABLE_PROFICIENCY, caOf, costAttrs, positionMultiplier } from './ca.ts'
import { MAX_SUBS } from './squad.ts'
import { attrRating } from './scale.ts'
import {
   ACTIVE_STYLE_REVISION,
   applyMentalityOverlay,
   cloneInstructions,
   instructionsFromLegacyTactics,
   legacyTacticsFromInstructions,
   normalizeInstructions,
   styleByRevision,
   validateInstructions,
   type StyleId,
   type TacticalInstructionsV2,
} from './pes/tactics.ts'

export interface AITacticalProfileInput {
  players: readonly Player[]
  lineup: Pick<Lineup, 'formationId' | 'starters' | 'bench' | 'tactics'>
  /** 俱乐部文字风格注解（如皇马、巴萨或传奇球队历史注解） */
  clubStyle?: string
  /** 俱乐部预设五项基础战术倾向 */
  seedTactics?: Tactics
  /** 俱乐部星级 1–5 */
  strength?: number
  /** 所属联赛级别 */
  tier?: TierId
}

export interface AITacticalProfile {
  tacticalStyle: StyleId
  tacticalInstructions: TacticalInstructionsV2
  tactics: Tactics
}

const CANDIDATE_STYLES: readonly Exclude<StyleId, 'blank'>[] = [
  'control',
  'highPress',
  'tikiTaka',
  'verticalTiki',
  'wingPlay',
  'fluidCounter',
  'directCounter',
  'longBall',
  'catenaccio',
  'parkBus',
]

function ratingOf(player: Player, key: keyof Player['attrs']): number {
  return attrRating(key, player.attrs[key] ?? 0, player.positions.GK > 0)
}

function mean(values: readonly number[], fallback = 50): number {
  if (!values.length) return fallback
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** 计算比赛内球员（`attrs` 已是 0–100 评分尺度）的真实 CA（0–1500）。 */
export function matchPlayerCa(player: Pick<MatchPlayerState, 'attrs' | 'positions'>): number {
  const isGk = player.positions.GK > 0
  const keys = costAttrs(isGk)
  let sum = 0
  for (const key of keys) {
    const r = Math.max(0, Math.min(100, player.attrs[key] ?? 0))
    sum += (r / 100) ** 2
  }
  return (CA_SCALE * sum) / keys.length
}

/** 计算比赛内球员对指定职责的适配分（0–100）。 */
function matchRoleFit(player: Pick<MatchPlayerState, 'attrs'>, roleId: RoleId): number {
  const role = ROLES[roleId]
  if (!role) return 50
  let sum = 0
  let total = 0
  for (const [key, weight] of Object.entries(role.weights) as [keyof Player['attrs'], number][]) {
    sum += Math.max(0, Math.min(100, player.attrs[key] ?? 0)) * weight
    total += weight
  }
  return total > 0 ? sum / total : 50
}

/**
 * 根据俱乐部传统风格、阵型结构与首发 11 人的真实属性分布，推导最契合的战术风格与十二项指令。
 */
export function deriveAITacticalProfile(input: AITacticalProfileInput): AITacticalProfile {
  const formation = FORMATIONS[input.lineup.formationId] ?? FORMATIONS['4-4-2']
  const byId = new Map(input.players.map((p) => [p.id, p]))
  const slotMap = new Map(formation.slots.map((s) => [s.id, s]))

  const mapped = input.lineup.starters
    .map((s) => {
      const player = byId.get(s.playerId)
      const slot = slotMap.get(s.slotId)
      return player && slot ? { player, slot, role: s.role } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const outfield = mapped.filter((m) => m.slot.position !== 'GK')
  const cbs = outfield.filter((m) => m.slot.position === 'CB')
  const cms = outfield.filter((m) => m.slot.position === 'CM')
  const attackingWings = outfield.filter((m) => m.slot.position === 'W' && m.slot.x >= FULL_BACK_DEPTH)
  const allWings = outfield.filter((m) => m.slot.position === 'W')
  const sts = outfield.filter((m) => m.slot.position === 'ST')
  const frontPlayers = sts.length ? sts : outfield.slice(-2)

  const tech = mean(
    outfield.map(
      ({ player }) =>
        (ratingOf(player, 'passing')
          + ratingOf(player, 'firstTouch')
          + ratingOf(player, 'vision')
          + ratingOf(player, 'composure')
          + ratingOf(player, 'decisions')) / 5,
    ),
  )
  const endurance = mean(outfield.map(({ player }) => ratingOf(player, 'endurance')))
  const work = mean(
    outfield.map(
      ({ player }) =>
        (ratingOf(player, 'endurance')
          + ratingOf(player, 'teamwork')
          + ratingOf(player, 'anticipation')
          + ratingOf(player, 'tackling')) / 4,
    ),
  )
  const cbPace = mean(cbs.map(({ player }) => (ratingOf(player, 'speed') + ratingOf(player, 'acceleration')) / 2))
  const cbDef = mean(
    cbs.map(
      ({ player }) =>
        (ratingOf(player, 'defPos')
          + ratingOf(player, 'tackling')
          + ratingOf(player, 'strength')
          + ratingOf(player, 'heading')) / 4,
    ),
  )
  const cmPass = mean(
    (cms.length ? cms : outfield).map(
      ({ player }) =>
        (ratingOf(player, 'passing')
          + ratingOf(player, 'vision')
          + ratingOf(player, 'firstTouch')
          + ratingOf(player, 'decisions')) / 4,
    ),
  )
  const wingPool = attackingWings.length ? attackingWings : allWings
  const wingThreat = mean(
    wingPool.map(
      ({ player }) =>
        (ratingOf(player, 'speed')
          + ratingOf(player, 'acceleration')
          + ratingOf(player, 'dribbling')
          + ratingOf(player, 'passing')) / 4,
    ),
  )
  const stPace = mean(
    frontPlayers.map(
      ({ player }) => (ratingOf(player, 'speed') + ratingOf(player, 'acceleration') + ratingOf(player, 'offBall')) / 3,
    ),
  )
  const avgStHeight = mean(frontPlayers.map(({ player }) => player.height || 180), 180)
  const heightBonus = Math.max(-8, Math.min(10, (avgStHeight - 182) * 1.1))
  const stAerial =
    mean(frontPlayers.map(({ player }) => ratingOf(player, 'heading') * 0.65 + ratingOf(player, 'strength') * 0.35))
    + heightBonus
  const stLink = mean(
    frontPlayers.map(
      ({ player }) =>
        (ratingOf(player, 'passing')
          + ratingOf(player, 'firstTouch')
          + ratingOf(player, 'vision')
          + ratingOf(player, 'dribbling')) / 4,
    ),
  )

  const seed = input.seedTactics ?? input.lineup.tactics
  const fId: FormationId = input.lineup.formationId
  const wingSlotCount = formation.slots.filter((s) => s.position === 'W' && s.x >= FULL_BACK_DEPTH).length
  const strength = input.strength ?? (input.tier === 'champions' ? 4 : input.tier === 'division1' ? 3 : 2)
  const hint = (input.clubStyle ?? '').toLowerCase()

  const scores: Record<Exclude<StyleId, 'blank'>, number> = {
    control: 0,
    highPress: 0,
    tikiTaka: 0,
    verticalTiki: 0,
    wingPlay: 0,
    fluidCounter: 0,
    directCounter: 0,
    longBall: 0,
    catenaccio: 0,
    parkBus: 0,
  }

  // 1. 俱乐部五项基础战术基因对齐
  if (seed.passing === 'short') {
    scores.tikiTaka += 18
    scores.verticalTiki += 16
    scores.control += 15
    scores.fluidCounter += 6
    scores.longBall -= 22
    scores.directCounter -= 14
  } else if (seed.passing === 'mixed') {
    scores.control += 10
    scores.highPress += 10
    scores.wingPlay += 11
    scores.fluidCounter += 10
  } else {
    scores.directCounter += 16
    scores.longBall += 16
    scores.wingPlay += 8
    scores.catenaccio += 10
    scores.tikiTaka -= 24
    scores.verticalTiki -= 20
  }

  if (seed.attack === 'wing') {
    scores.wingPlay += 20
    scores.highPress += 6
    scores.verticalTiki -= 12
  } else if (seed.attack === 'middle') {
    scores.verticalTiki += 15
    scores.tikiTaka += 10
    scores.control += 8
    scores.catenaccio += 5
    scores.wingPlay -= 14
  } else {
    scores.control += 8
    scores.fluidCounter += 8
    scores.directCounter += 8
    scores.longBall += 6
  }

  if (seed.line === 'high') {
    scores.highPress += 14
    scores.tikiTaka += 11
    scores.verticalTiki += 10
    scores.control += 11
    scores.catenaccio -= 18
    scores.parkBus -= 24
    scores.directCounter -= 10
  } else if (seed.line === 'low') {
    scores.directCounter += 16
    scores.fluidCounter += 15
    scores.catenaccio += 15
    scores.longBall += 12
    scores.parkBus += 10
    scores.highPress -= 20
    scores.tikiTaka -= 14
  } else {
    scores.control += 7
    scores.wingPlay += 9
    scores.fluidCounter += 7
  }

  if (seed.press === 'high') {
    scores.highPress += 16
    scores.tikiTaka += 8
    scores.verticalTiki += 8
    scores.control += 7
    scores.fluidCounter += 6
    scores.catenaccio -= 16
    scores.parkBus -= 20
  } else if (seed.press === 'low') {
    scores.catenaccio += 15
    scores.parkBus += 12
    scores.directCounter += 6
    scores.highPress -= 22
  } else {
    scores.wingPlay += 6
    scores.fluidCounter += 6
    scores.longBall += 6
    scores.directCounter += 6
  }

  if (seed.tempo === 'fast') {
    scores.highPress += 12
    scores.wingPlay += 10
    scores.directCounter += 10
    scores.fluidCounter += 8
    scores.longBall += 8
    scores.control -= 6
    scores.tikiTaka -= 5
  } else if (seed.tempo === 'slow') {
    scores.tikiTaka += 10
    scores.control += 11
    scores.verticalTiki += 8
    scores.catenaccio += 11
    scores.parkBus += 8
    scores.highPress -= 10
  } else {
    scores.control += 6
    scores.fluidCounter += 6
    scores.verticalTiki += 6
  }

  // 2. 阵型几何结构契合度
  if (wingSlotCount === 0) {
    // 4-1-2-1-2 窄菱形等无前场边锋阵型
    scores.verticalTiki += 12
    scores.tikiTaka += 6
    scores.fluidCounter += 6
    scores.wingPlay -= 28
  } else if (wingSlotCount >= 2) {
    scores.wingPlay += 8
  }
  if (fId === '5-3-2') {
    scores.catenaccio += 10
    scores.directCounter += 9
    scores.fluidCounter += 8
    scores.longBall += 6
  } else if (fId === '3-5-2') {
    scores.fluidCounter += 7
    scores.verticalTiki += 5
    scores.catenaccio += 5
  } else if (fId === '3-4-3' || fId === '4-3-3') {
    scores.highPress += 6
    scores.wingPlay += 6
    scores.tikiTaka += 5
    scores.control += 5
  } else if (fId === '4-2-3-1' || fId === '4-1-4-1') {
    scores.control += 6
    scores.fluidCounter += 6
  } else if (fId === '4-4-2') {
    scores.wingPlay += 6
    scores.directCounter += 6
    scores.longBall += 6
  }

  // 3. 俱乐部文字描述 / 历史球队注解语义匹配
  if (/tiki|短传控球|传控|轮转/.test(hint)) {
    scores.tikiTaka += 16
    scores.control += 9
    scores.verticalTiki += 8
  }
  if (/高位压迫|前场逼抢|绞杀|疯抢/.test(hint)) {
    scores.highPress += 15
  }
  if (/边路传中|边路冲击|边路速度|两翼/.test(hint)) {
    scores.wingPlay += 15
  }
  if (/稳守反击|快速反击|低位防守.*反击/.test(hint)) {
    scores.directCounter += 12
    scores.fluidCounter += 11
  }
  if (/长传/.test(hint)) {
    scores.longBall += 15
  }
  if (/阵型紧凑|防守站位优先|链式|铁桶/.test(hint)) {
    scores.catenaccio += 13
    scores.fluidCounter += 5
  }
  if (/纵向直传|快速转换/.test(hint)) {
    scores.directCounter += 9
    scores.verticalTiki += 8
    scores.highPress += 6
  }

  // 4. 首发球员真实属性适配加权（让阵容决定上限与可行性）
  scores.tikiTaka += (tech - 53) * 0.65 + (cmPass - 54) * 0.55 + (stLink - 52) * 0.3
  scores.verticalTiki += (cmPass - 52) * 0.55 + (tech - 52) * 0.45 + (stPace - 52) * 0.35
  scores.control += (tech - 50) * 0.5 + (cmPass - 50) * 0.4
  scores.highPress += (work - 51) * 0.6 + (endurance - 51) * 0.45 + (stPace - 51) * 0.35 + (cbPace - 50) * 0.25
  scores.wingPlay += (wingThreat - 50) * 0.6 + (stAerial - 50) * 0.4
  scores.fluidCounter += (stPace - 50) * 0.5 + (tech - 48) * 0.3 + (cbDef - 50) * 0.25
  scores.directCounter += (stPace - 50) * 0.65 + (cbDef - 50) * 0.35
  scores.longBall += (stAerial - 52) * 0.75 + (cbDef - 50) * 0.25
  scores.catenaccio += (cbDef - 50) * 0.5 - (stPace - 55) * 0.2
  scores.parkBus += strength <= 1 ? 8 : -18

  if (tech < 46) {
    scores.tikiTaka -= 16
    scores.verticalTiki -= 12
  }
  if (endurance < 47) {
    scores.highPress -= 16
  }
  if (stAerial < 47) {
    scores.longBall -= 14
  }

  let bestStyle: Exclude<StyleId, 'blank'> = 'control'
  let bestScore = -Infinity
  for (const candidate of CANDIDATE_STYLES) {
    if (scores[candidate] > bestScore) {
      bestScore = scores[candidate]
      bestStyle = candidate
    }
  }

  // 5. 在基准风格模板上按球队短板与强项微调十二项指令
  const inst = cloneInstructions(styleByRevision(bestStyle, ACTIVE_STYLE_REVISION).instructions)

  // (a) 阵型宽度适配：无前场边路槽位的窄阵型不强打两翼拉开
  if (wingSlotCount === 0) {
    if (inst.possession.focus === 'wing') inst.possession.focus = 'middle'
    if (inst.possession.width === 'wide') inst.possession.width = 'narrow'
    inst.advanced = { ...inst.advanced, defense: { ...inst.advanced?.defense, width: 'narrow' } }
  } else if (wingSlotCount >= 2 && wingThreat >= cmPass + 7 && seed.attack === 'wing' && bestStyle !== 'verticalTiki') {
    inst.possession.focus = 'wing'
    inst.possession.width = 'wide'
  }

  // (b) 锋线空霸 / 速度型反越位 / 技术型回撤接应适配
  const hasTargetRole = frontPlayers.some((f) => f.role === 'st_target')
  const hasRunnerRole = frontPlayers.some((f) => f.role === 'st_runner')
  if ((stAerial >= 62 || hasTargetRole) && wingSlotCount >= 2 && inst.possession.passing !== 'short') {
    inst.advanced = {
      ...inst.advanced,
      possession: { ...inst.advanced?.possession, crossTiming: 'early' },
    }
  } else if (stAerial < 46 && !hasTargetRole && inst.advanced?.possession?.crossTiming === 'early') {
    inst.advanced = {
      ...inst.advanced,
      possession: { ...inst.advanced?.possession, crossTiming: 'balanced' },
    }
  }

  if ((hasRunnerRole || (stPace >= stLink + 6 && stPace >= 57)) && bestStyle !== 'tikiTaka' && bestStyle !== 'parkBus') {
    inst.advanced = {
      ...inst.advanced,
      possession: { ...inst.advanced?.possession, receiving: 'space' },
    }
  } else if (stLink >= stPace + 6 && tech >= 57 && inst.possession.passing === 'short') {
    inst.advanced = {
      ...inst.advanced,
      possession: { ...inst.advanced?.possession, receiving: 'feet' },
    }
  }

  // (c) 中卫速度与全队耐力安全保护：慢中卫不盲目造越位高防线，低耐力不双开疯抢
  if (inst.defense.line === 'high' && cbPace < 49) {
    inst.defense.line = 'mid'
  }
  if (endurance < 48 && inst.defense.intensity === 'high' && inst.transition.onLoss === 'counterpress') {
    inst.transition.onLoss = 'balanced'
  }

  const normalized = validateInstructions(normalizeInstructions(inst))
  return {
    tacticalStyle: bestStyle,
    tacticalInstructions: normalized,
    tactics: legacyTacticsFromInstructions(normalized),
  }
}

/** 将 AI 战术画像写入阵容（原地更新并返回同一份 `Lineup`）。 */
export function applyAITacticsToLineup(
  lineup: Lineup,
  options: Omit<AITacticalProfileInput, 'lineup'>,
): Lineup {
  const profile = deriveAITacticalProfile({ ...options, lineup })
  lineup.tacticalStyle = profile.tacticalStyle
  lineup.tacticalInstructions = profile.tacticalInstructions
  lineup.tactics = profile.tactics
  return lineup
}

/** 未显式传入俱乐部战术室阶段时，按级别 / 星级 / 首发平均 CA 估算合理的战术设施阶段（1–25）。 */
export function defaultAITacticsStage(ai: {
  tier?: TierId
  strength?: number
  players: readonly Player[]
  lineup?: Pick<Lineup, 'starters'>
}): number {
  const starterIds = new Set(ai.lineup?.starters.map((s) => s.playerId) ?? [])
  const starters = starterIds.size
    ? ai.players.filter((p) => starterIds.has(p.id))
    : ai.players.slice(0, 11)
  const avgCa = starters.length
    ? starters.reduce((sum, p) => sum + caOf(p.attrs, p.positions.GK > 0), 0) / starters.length
    : 550

  if (avgCa >= 1080) return 23
  if (avgCa >= 950) return 19
  if (ai.tier === 'champions' || (ai.strength ?? 0) >= 5 || avgCa >= 820) return 16
  if (ai.tier === 'division1' || (ai.strength ?? 0) === 4 || avgCa >= 680) return 11
  if ((ai.strength ?? 0) === 3 || avgCa >= 560) return 8
  return 5
}

/** AI 球队默认的基础自动换人兜底计划（伤病立即换人 + 下半场严重体能透支保护）。 */
export function defaultAIAutoSubs(): AutoSubPlan {
  return {
    timed: [],
    staminaBelow: 44,
    staminaMinMinute: 48,
    onInjury: true,
    preferBy: 'ca',
  }
}

/* ========================== 赛中临场战术调度 ========================== */

export interface AICoachTacticalContext {
  /** 比赛显示分钟（0–90） */
  minute: number
  /** 本场己方比分 - 对方比分 */
  scoreDiff: number
}

export interface AICoachPhaseDecision {
  phaseId: string
  mentality: MatchMentality
  instructions: TacticalInstructionsV2
  tactics: Tactics
  aggression: number
  staminaMul: number
  announcement: string | null
}

function patchInst(
  base: TacticalInstructionsV2,
  mutate: (draft: TacticalInstructionsV2) => void,
): TacticalInstructionsV2 {
  const draft = cloneInstructions(base)
  mutate(draft)
  return normalizeInstructions(draft)
}

function stepLineDown(line: 'low' | 'mid' | 'high'): 'low' | 'mid' | 'high' {
  return line === 'high' ? 'mid' : 'low'
}

function stepLineUp(line: 'low' | 'mid' | 'high'): 'low' | 'mid' | 'high' {
  return line === 'low' ? 'mid' : 'high'
}

/**
 * 评估 AI 教练在当前比赛时刻的临场战术阶段。
 * 返回 `null` 表示维持当前阶段不变；阶段切换时返回新的指令、心态与场边调度播报。
 */
export function evaluateAICoachTactics(
  team: MatchTeamState,
  opponent: MatchTeamState,
  ctx: AICoachTacticalContext,
  isKickoff = false,
): AICoachPhaseDecision | null {
  if (!team.aiCoach) return null
  if (team.matchPlan && team.matchPlan !== 'standard') return null

  const base = team.baseInstructions ?? team.instructions ?? instructionsFromLegacyTactics(team.baseTactics ?? team.tactics)
  const prevPhase = team.aiCoachPhase ?? 'base'
  const { minute, scoreDiff } = ctx

  const onPitch = team.players.filter((p) => p.onPitch)
  const oppOnPitch = opponent.players.filter((p) => p.onPitch)
  const myRedCards = [...team.players, ...team.bench].filter((p) => p.sentOff).length
  const oppRedCards = [...opponent.players, ...opponent.bench].filter((p) => p.sentOff).length
  const avgStaminaPct = onPitch.length
    ? onPitch.reduce((sum, p) => sum + (p.stamina / Math.max(1, p.maxStamina)) * 100, 0) / onPitch.length
    : 100
  const myAvgCa = onPitch.length ? onPitch.reduce((sum, p) => sum + matchPlayerCa(p), 0) / onPitch.length : 600
  const oppAvgCa = oppOnPitch.length ? oppOnPitch.reduce((sum, p) => sum + matchPlayerCa(p), 0) / oppOnPitch.length : 600
  const strengthDiff = myAvgCa - oppAvgCa

  const build = (
    phaseId: string,
    mentality: MatchMentality,
    instructions: TacticalInstructionsV2,
    aggression: number,
    staminaMul: number,
    announcement: string | null,
  ): AICoachPhaseDecision | null => {
    if (phaseId === prevPhase) return null
    return {
      phaseId,
      mentality,
      instructions,
      tactics: legacyTacticsFromInstructions(instructions),
      aggression,
      staminaMul,
      announcement: isKickoff ? null : announcement,
    }
  }

  // 开场前 20 分钟稳住赛前部署（除非 15 分钟后少打一人）
  if (minute >= 15 && myRedCards > oppRedCards && !(scoreDiff < 0 && minute >= 78)) {
    const inst = patchInst(base, (d) => {
      d.defense.line = stepLineDown(base.defense.line)
      d.defense.engagement = 'low'
      d.defense.intensity = 'mid'
      d.transition.onLoss = 'regroup'
      d.transition.onGain = 'counter'
      d.advanced = { ...d.advanced, defense: { ...d.advanced?.defense, width: 'narrow' } }
    })
    return build(
      'ai_red_compact',
      'defend',
      inst,
      0.42,
      0.94,
      '教练临场变阵：少打一人，全队回收中低位防线改打紧凑防反。',
    )
  }

  if (minute < 28) {
    return build('base', 'balanced', cloneInstructions(base), 0.5, 1, null)
  }

  // 上半场中后段已两球以上落后：提前打破保守站位主动反击
  if (minute < 56 && scoreDiff <= -2) {
    const inst = patchInst(base, (d) => {
      d.defense.line = stepLineUp(base.defense.line)
      if (d.defense.engagement === 'low') d.defense.engagement = 'mid'
      d.possession.tempo = 'fast'
      d.transition.onGain = 'counter'
      d.advanced = { ...d.advanced, possession: { ...d.advanced?.possession, receiving: 'space' } }
    })
    return build(
      'ai_early_chase',
      'attack',
      inst,
      0.62,
      1.05,
      '教练临场调整：两球落后，提前前压阵型加快反击推进！',
    )
  }

  // 下半场两球以上领先：慢节奏稳控球权、降低逼抢消耗保护主力体能
  if (minute >= 55 && scoreDiff >= 2) {
    const inst = patchInst(base, (d) => {
      d.possession.tempo = 'slow'
      d.transition.onGain = 'hold'
      if (d.transition.onLoss === 'counterpress') d.transition.onLoss = 'balanced'
      if (d.defense.line === 'high') d.defense.line = 'mid'
      d.defense.engagement = 'mid'
      d.defense.intensity = 'low'
    })
    return build(
      'ai_cruise_cushion',
      'balanced',
      inst,
      0.38,
      0.88,
      '教练临场调整：两球优势在握，放慢节奏稳控球权节省体能。',
    )
  }

  // 76 分钟后仍落后：孤注一掷全线压上强攻
  if (minute >= 76 && scoreDiff < 0) {
    const inst = patchInst(base, (d) => {
      d.possession.passing = 'direct'
      d.possession.tempo = 'fast'
      d.possession.width = 'wide'
      d.transition.onGain = 'counter'
      d.transition.onLoss = 'counterpress'
      d.defense.line = 'high'
      d.defense.engagement = 'high'
      d.defense.intensity = 'high'
      d.advanced = {
        ...d.advanced,
        possession: { ...d.advanced?.possession, receiving: 'space', crossTiming: 'early' },
      }
    })
    return build(
      'ai_late_siege',
      'attack',
      inst,
      0.78,
      1.14,
      '教练孤注一掷：终场前比分落后，全线压上直传冲吊围攻禁区！',
    )
  }

  // 56–76 分钟处于落后：切换进攻心态并提速高压追分
  if (minute >= 56 && scoreDiff < 0) {
    const overlaid = applyMentalityOverlay(base, 'attack')
    const inst = patchInst(overlaid, (d) => {
      d.possession.tempo = 'fast'
      d.transition.onGain = 'counter'
      d.transition.onLoss = 'counterpress'
      d.advanced = { ...d.advanced, possession: { ...d.advanced?.possession, receiving: 'space' } }
    })
    return build(
      'ai_second_half_chase',
      'attack',
      inst,
      0.66,
      1.08,
      '教练临场调整：下半场比分落后，前压防线加快反抢与向前渗透！',
    )
  }

  // 82 分钟后一球领先：深度锁门保胜果
  if (minute >= 82 && scoreDiff === 1) {
    const inst = patchInst(base, (d) => {
      d.possession.tempo = 'slow'
      d.possession.width = 'narrow'
      d.transition.onGain = 'hold'
      d.transition.onLoss = 'regroup'
      d.defense.line = 'low'
      d.defense.engagement = 'low'
      d.defense.intensity = 'low'
      d.advanced = { ...d.advanced, defense: { ...d.advanced?.defense, width: 'narrow' } }
    })
    return build(
      'ai_late_lockdown',
      'defend',
      inst,
      0.34,
      0.9,
      '教练临场锁局：比赛进入最后阶段，全员退守低位力保一球胜果！',
    )
  }

  // 70–82 分钟一球领先：回收防线稳守反击
  if (minute >= 70 && scoreDiff === 1) {
    const overlaid = applyMentalityOverlay(base, 'defend')
    const inst = patchInst(overlaid, (d) => {
      d.advanced = { ...d.advanced, defense: { ...d.advanced?.defense, width: 'narrow' } }
    })
    return build(
      'ai_protect_lead',
      'defend',
      inst,
      0.42,
      0.94,
      '教练临场调整：一球领先进入末段，适度回收阵型稳固防守伺机反击。',
    )
  }

  // 72 分钟后平局：优势方/高压风格且体能充沛则提速争胜；劣势方或体能见底则守平抢分
  if (minute >= 72 && scoreDiff === 0) {
    const aggressiveStyle = team.tacticalStyle === 'highPress' || team.tacticalStyle === 'wingPlay'
    if ((strengthDiff >= 40 || myRedCards < oppRedCards || aggressiveStyle) && avgStaminaPct >= 46) {
      const inst = applyMentalityOverlay(base, 'attack')
      return build(
        'ai_seek_winner',
        'attack',
        inst,
        0.64,
        1.06,
        '教练临场调整：僵局之下主动提速前压，加强攻势寻求绝杀进球！',
      )
    }
    if (minute >= 75 && (strengthDiff <= -50 || avgStaminaPct < 42)) {
      const overlaid = applyMentalityOverlay(base, 'defend')
      const inst = patchInst(overlaid, (d) => {
        d.advanced = { ...d.advanced, defense: { ...d.advanced?.defense, width: 'narrow' } }
      })
      return build(
        'ai_hold_draw',
        'defend',
        inst,
        0.38,
        0.9,
        '教练临场调整：末段体能承压，收缩防线优先稳住平局。',
      )
    }
  }

  // 局势回归均衡（如刚扳平比分或被扳平）：恢复赛前基准战术
  return build(
    'base',
    'balanced',
    cloneInstructions(base),
    0.5,
    1,
    prevPhase !== 'base' ? '教练临场调整：场上比分改写，恢复赛前基准战术稳步推进。' : null,
  )
}

/* ========================== 赛中智能换人系统 ========================== */

export interface AICoachSubOptions {
  team: MatchTeamState
  clockSeconds: number
  durationSeconds: number
  /** 本场己方比分 - 对方比分 */
  scoreDiff: number
  availableBench: () => MatchPlayerState[]
  substitute: (outId: string, inId: string, reason: 'stamina' | 'tactical') => boolean
}

function staminaRatio(player: MatchPlayerState): number {
  return Math.max(0, Math.min(1, player.stamina / Math.max(1, player.maxStamina)))
}

function effectivePitchScore(player: MatchPlayerState, role: RoleId, position: Position): number {
  const ca = matchPlayerCa(player)
  const fit = matchRoleFit(player, role)
  const baseQuality = ca * 0.65 + (fit / 100) * CA_SCALE * 0.35
  const staminaFactor = 0.52 + 0.48 * staminaRatio(player)
  return baseQuality * staminaFactor * positionMultiplier(player.positions[position])
}

const CHASE_PRIORITY: Record<Position, number> = { ST: 0, W: 1, CM: 2, CB: 3, GK: 9 }
const PROTECT_PRIORITY: Record<Position, number> = { CB: 0, CM: 1, W: 2, ST: 3, GK: 9 }
const BALANCED_PRIORITY: Record<Position, number> = { W: 0, CM: 1, ST: 2, CB: 3, GK: 9 }

/**
 * 执行 AI 教练的分波次战术与体能换人（在 `executeTeamAutoSubs` 伤病/极限低体能换人之后调用）。
 *
 * 波次规划：
 * - 56′+：身背黄牌且体力下滑（< 68%）的防守/中前场球员保护性换下；
 * - 60′+：第一波战术/生力军调整（累计最多用至 2 个名额，落后 2 球以上放宽至 3 个）；
 * - 73′+：第二波针对性调整（落后派锋线冲击、一球领先补防守生力军、两球领先轮休核心，累计最多用至 4 个名额）；
 * - 82′+：终场收官换人（用满剩余换人名额补充场上最疲惫位置）。
 */
export function executeAICoachSubs(options: AICoachSubOptions): void {
  const { team, clockSeconds, durationSeconds, scoreDiff, availableBench, substitute } = options
  if (!team.aiCoach || team.subsUsed >= MAX_SUBS) return
  const minute = durationSeconds > 0 ? (clockSeconds / durationSeconds) * 90 : 0
  if (minute < 56) return

  const waveCap =
    minute >= 82
      ? MAX_SUBS
      : minute >= 73
        ? 4
        : minute >= 60
          ? (scoreDiff <= -2 ? 3 : 2)
          : 1 // 56–60′ 仅限黄牌风险保护换人

  if (team.subsUsed >= waveCap) return

  // 单一时刻最多完成 2 人同时换下，呈现真实的场边分批换人节奏
  const stepLimit = Math.min(waveCap - team.subsUsed, 2)
  let madeThisStep = 0

  const posPriority =
    scoreDiff < 0 ? CHASE_PRIORITY : scoreDiff === 1 && minute >= 70 ? PROTECT_PRIORITY : BALANCED_PRIORITY

  // 按波次设定允许被换下的最高体力阈值与替补战力容忍系数
  const maxOutStaminaPct =
    minute < 60
      ? 68 // 56–60′ 仅看身背黄牌且体力低于 68% 的球员
      : scoreDiff < 0
        ? (minute >= 73 ? 84 : 78)
        : scoreDiff >= 2 && minute >= 73
          ? 85 // 两球领先主动轮休主力保存联赛体能
          : minute >= 82
            ? 72
            : 75

  // 系数 < 1 表示允许略低 CA 但满血的替补换下疲惫主力（如两球领先轮休、落后搏命冲刺、身背黄牌防红牌）
  const qualityThresholdFactor =
    scoreDiff >= 2 && minute >= 73
      ? 0.80
      : scoreDiff < 0 && minute >= 70
        ? 0.88
        : 0.92

  while (madeThisStep < stepLimit && team.subsUsed < waveCap) {
    const bench = availableBench().filter((b) => !b.injured && b.positions.GK === 0)
    if (!bench.length) break

    const candidates = team.players.filter((p) => {
      if (!p.onPitch || p.subbedOn || p.position === 'GK') return false
      const pct = staminaRatio(p) * 100
      if (minute < 60) return p.yellowCards >= 1 && pct < maxOutStaminaPct
      return pct < maxOutStaminaPct || (p.yellowCards >= 1 && pct < 78)
    })

    if (!candidates.length) break

    let bestPair: { out: MatchPlayerState; incoming: MatchPlayerState; gainScore: number; reason: 'stamina' | 'tactical' } | null = null

    for (const out of candidates) {
      const outPct = staminaRatio(out) * 100
      const outEff = effectivePitchScore(out, out.role, out.position)
      const compatible = bench.filter(
        (b) =>
          b.positions[out.position] >= PLAYABLE_PROFICIENCY
          && staminaRatio(b) * 100 >= Math.max(72, outPct + 12),
      )
      for (const incoming of compatible) {
        const inEff = effectivePitchScore(incoming, out.role, out.position)
        const cardFactor = out.yellowCards >= 1 ? 0.86 : 1
        if (inEff < outEff * qualityThresholdFactor * cardFactor && outPct >= 54) continue

        const priorityBonus = (4 - (posPriority[out.position] ?? 3)) * 18
        const fatigueUrgency = Math.max(0, 80 - outPct) * 3.2
        const cardBonus = out.yellowCards >= 1 ? 45 : 0
        const restStarBonus = scoreDiff >= 2 && minute >= 73 ? (matchPlayerCa(out) / 1500) * 55 : 0
        const effDelta = (inEff - outEff) * 0.18
        const gainScore = effDelta + fatigueUrgency + priorityBonus + cardBonus + restStarBonus

        if (!bestPair || gainScore > bestPair.gainScore) {
          const reason: 'stamina' | 'tactical' = outPct < 58 ? 'stamina' : 'tactical'
          bestPair = { out, incoming, gainScore, reason }
        }
      }
    }

    if (!bestPair) break
    if (!substitute(bestPair.out.id, bestPair.incoming.id, bestPair.reason)) break
    madeThisStep++
  }
}
