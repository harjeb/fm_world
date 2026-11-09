import type { FormationId, Lineup, Player, Position, RoleId, Tactics, TacticPreset } from './types.ts'
import { FORMATIONS, type FormationSlot } from './data/formations.ts'
import { ROLES, ROLES_BY_POSITION, roleFit, rolesForSlot } from './data/roles.ts'
import { PLAYABLE_PROFICIENCY, caOf, positionMultiplier } from './ca.ts'

/** 11 人制：首发人数（每个阵型都是 11 个槽位）。 */
export const STARTERS = 11
/** 替补席位数。 */
export const BENCH_SIZE = 7
/** 一场比赛最多换几次人（手动和自动共用）。 */
export const MAX_SUBS = 5
/** 一场比赛的完整名单：首发 + 替补。补青训、AI 名单都以它为下限。 */
export const FULL_SQUAD = STARTERS + BENCH_SIZE
/** 卖人 / 解约后至少要留几个人（首发 + 3 个替补）。 */
export const MIN_SQUAD = STARTERS + 3

export type LineupSlotView = {
  slotId: string
  position: Position
  label: string
  player: Player | null
  role: RoleId
  fit: number
  effectiveLoss: number
}

export function playerById(roster: Player[], id: string): Player | undefined {
  return roster.find((player) => player.id === id)
}

export function bestRoleForPlayer(player: Player, position: Position, slot?: { position: Position; x: number }): { role: RoleId; fit: number } {
  const roles = slot ? rolesForSlot(slot) : ROLES_BY_POSITION[position]
  let best = roles[0]
  let bestFit = -1
  for (const role of roles) {
    const fit = roleFit(player.attrs, role, player.positions.GK > 0) * positionMultiplier(player.positions[position])
    if (fit > bestFit) {
      bestFit = fit
      best = role
    }
  }
  return { role: best, fit: bestFit }
}

export function autoFillLineup(
  roster: Player[],
  formationId: FormationId,
  tactics?: Tactics,
  /** 旧阵容：同阵型时保留玩家自己摆的位置，并且总是保留命名预设。 */
  previous?: LineupLike,
): Lineup {
  const formation = FORMATIONS[formationId]
  const used = new Set<string>()
  const starters = [] as Lineup['starters']
  const orderedSlots = [...formation.slots].sort((a, b) => (a.position === 'GK' ? -1 : b.position === 'GK' ? 1 : 0))
  for (const slot of orderedSlots) {
    let bestPlayer: Player | null = null
    let bestRole: RoleId = slot.defaultRole
    let bestScore = -Infinity
    // 优先用学过这个位置的球员；实在没有，才让别的位置顶上（熟练度 0，属性折损最多）。
    const free = roster.filter((player) => !used.has(player.id))
    const learned = free.filter((player) => player.positions[slot.position] >= PLAYABLE_PROFICIENCY)
    for (const player of learned.length ? learned : free) {
      const multiplier = positionMultiplier(player.positions[slot.position])
      for (const role of rolesForSlot(slot)) {
        const score = roleFit(player.attrs, role, player.positions.GK > 0) * multiplier
        if (score > bestScore) {
          bestScore = score
          bestPlayer = player
          bestRole = role
        }
      }
    }
    if (bestPlayer) {
      used.add(bestPlayer.id)
      starters.push({ slotId: slot.id, playerId: bestPlayer.id, role: bestRole })
    }
  }
  const remaining = roster.filter((player) => !used.has(player.id))
  const bench = buildBench(remaining)
  return {
    formationId,
    starters,
    bench,
    tactics: tactics ?? { ...formation.defaultTactics },
    ...preservedExtras(previous ?? rememberedExtras(roster), formationId),
  }
}

/** 从没上首发的人里挑替补：门将、后卫、前锋各一个，再补中场和边路，让替补尽量覆盖所有位置。 */
function buildBench(remaining: Player[]): string[] {
  const bench: string[] = []
  const gk = remaining.find((player) => player.positions.GK > 0)
  if (gk) bench.push(gk.id)
  const defender = remaining
    .filter((player) => player.id !== gk?.id)
    .sort((a, b) => b.attrs.defPos + b.attrs.tackling - (a.attrs.defPos + a.attrs.tackling))[0]
  if (defender) bench.push(defender.id)
  const attacker = remaining
    .filter((player) => !bench.includes(player.id))
    .sort((a, b) => b.attrs.shooting + b.attrs.offBall - (a.attrs.shooting + a.attrs.offBall))[0]
  if (attacker) bench.push(attacker.id)
  // 后两席给中场和边路，让替补尽量覆盖所有位置；没人学过就挑外场里最合适的。
  const cover = (position: Position, score: (player: Player) => number) => {
    const free = remaining.filter((player) => !bench.includes(player.id) && player.positions.GK <= 0)
    const learned = free.filter((player) => player.positions[position] >= PLAYABLE_PROFICIENCY)
    const best = [...(learned.length ? learned : free)].sort((a, b) => score(b) - score(a))[0]
    if (best) bench.push(best.id)
  }
  cover('CM', (player) => player.attrs.passing + player.attrs.vision)
  cover('W', (player) => player.attrs.speed + player.attrs.dribbling)
  for (const player of remaining) {
    if (bench.length >= BENCH_SIZE) break
    if (!bench.includes(player.id)) bench.push(player.id)
  }
  return bench
}

/* ---------------------------------------------------------------- 战术页的自动分配 */

/**
 * 战术页“自动填充”的三种方式：
 * best 按 CA 和位置熟练度排最强阵容（体能只作很小的参考）；
 * half 先排最强阵容，再把体力最差的约一半主力换成体力更好的替补；
 * full 整套轮换：每个位置换上本赛季上场最少的那批人。
 */
export type AutoAssignMode = 'best' | 'half' | 'full'

export type AutoAssignContext = {
  /** 比赛体能 0–100。 */
  condition: (player: Player) => number
  /** 本赛季已上场分钟。 */
  minutes: (player: Player) => number
  /** 停赛的人不能首发，能不用就不用。 */
  suspended?: (player: Player) => boolean
  /** 带伤上场有效能力降低 30%。 */
  injured?: (player: Player) => boolean
}

/** 一名球员放在某个位置、担任某个职责的得分：CA 和职责适配度各占一部分，再乘位置熟练度。 */
function assignScore(player: Player, position: Position, role: RoleId, staminaWeight: number, context: AutoAssignContext): number {
  const gk = player.positions.GK > 0
  const fit = roleFit(player.attrs, role, gk)
  const ca = caOf(player.attrs, gk) / 5
  let score = (0.6 * fit + 0.4 * ca) * positionMultiplier(player.positions[position])
  const condition = Math.max(0, Math.min(100, context.condition(player)))
  score *= 1 - staminaWeight + (staminaWeight * condition) / 100
  if (context.injured?.(player)) score *= 0.7
  return score
}

function bestRoleFor(player: Player, slot: FormationSlot, staminaWeight: number, context: AutoAssignContext): { role: RoleId; score: number } {
  const position = slot.position
  let best = slot.defaultRole
  let bestScore = -Infinity
  for (const role of rolesForSlot(slot)) {
    const score = assignScore(player, position, role, staminaWeight, context)
    if (score > bestScore) {
      bestScore = score
      best = role
    }
  }
  return { role: best, score: bestScore }
}

/** 一个位置的候选人：优先用可踢这个位置的（熟练度 ≥ 80），实在没有才让别的位置顶上；停赛的能不用就不用。 */
function candidatesFor(free: Player[], position: Position, context: AutoAssignContext): Player[] {
  const available = free.filter((player) => !context.suspended?.(player))
  const pool = available.length ? available : free
  const learned = pool.filter((player) => player.positions[position] >= PLAYABLE_PROFICIENCY)
  return learned.length ? learned : pool
}

export function autoAssignLineup(
  roster: Player[],
  formationId: FormationId,
  tactics: Tactics | undefined,
  previous: Lineup | undefined,
  mode: AutoAssignMode,
  context: AutoAssignContext,
): Lineup {
  const formation = FORMATIONS[formationId]
  const orderedSlots = [...formation.slots].sort((a, b) => (a.position === 'GK' ? -1 : b.position === 'GK' ? 1 : 0))
  const used = new Set<string>()
  const starters = [] as Lineup['starters']

  if (mode === 'full') {
    // 整套轮换：每个位置挑本赛季上场最少的人（体力太差的先不考虑），并列时看得分。
    for (const slot of orderedSlots) {
      const free = roster.filter((player) => !used.has(player.id))
      const all = candidatesFor(free, slot.position, context)
      const rested = all.filter((player) => context.condition(player) >= 30)
      const pool = rested.length ? rested : all
      let chosen: Player | null = null
      let chosenRole: RoleId = slot.defaultRole
      let chosenMinutes = Infinity
      let chosenScore = -Infinity
      for (const player of pool) {
        const minutes = context.minutes(player)
        const { role, score } = bestRoleFor(player, slot, 0.08, context)
        if (minutes < chosenMinutes || (minutes === chosenMinutes && score > chosenScore)) {
          chosen = player
          chosenRole = role
          chosenMinutes = minutes
          chosenScore = score
        }
      }
      if (chosen) {
        used.add(chosen.id)
        starters.push({ slotId: slot.id, playerId: chosen.id, role: chosenRole })
      }
    }
  } else {
    // 最强阵容：CA 和位置熟练度优先，体能只占很小的权重。
    for (const slot of orderedSlots) {
      const free = roster.filter((player) => !used.has(player.id))
      let chosen: Player | null = null
      let chosenRole: RoleId = slot.defaultRole
      let chosenScore = -Infinity
      for (const player of candidatesFor(free, slot.position, context)) {
        const { role, score } = bestRoleFor(player, slot, 0.08, context)
        if (score > chosenScore) {
          chosen = player
          chosenRole = role
          chosenScore = score
        }
      }
      if (chosen) {
        used.add(chosen.id)
        starters.push({ slotId: slot.id, playerId: chosen.id, role: chosenRole })
      }
    }
    if (mode === 'half') rotateTiredStarters(roster, starters, used, formation.slots, context)
  }

  const remaining = roster.filter((player) => !used.has(player.id))
  return {
    formationId,
    starters,
    bench: buildBench(remaining),
    tactics: tactics ?? { ...formation.defaultTactics },
    ...preservedExtras(previous ?? rememberedExtras(roster), formationId),
  }
}

/** 部分轮换：把体力最差的约一半主力换成同位置体力更好的替补；没有更新鲜的人就不换。 */
function rotateTiredStarters(
  roster: Player[],
  starters: Lineup['starters'],
  used: Set<string>,
  slots: (typeof FORMATIONS)[FormationId]['slots'],
  context: AutoAssignContext,
): void {
  const byId = new Map(roster.map((player) => [player.id, player]))
  const target = Math.round(starters.length / 2)
  const hasBackupKeeper = roster.some((player) => !used.has(player.id) && player.positions.GK > 0)
  const tired = starters
    .map((starter) => ({ starter, player: byId.get(starter.playerId)!, slot: slots.find((slot) => slot.id === starter.slotId)! }))
    .filter((item) => item.player && item.slot && (item.slot.position !== 'GK' || hasBackupKeeper))
    .sort((a, b) => context.condition(a.player) - context.condition(b.player))
    .slice(0, target)
  for (const item of tired) {
    const free = roster.filter((player) => !used.has(player.id) && context.condition(player) > context.condition(item.player))
    const pool = candidatesFor(free, item.slot.position, context).filter((player) => player.positions[item.slot.position] >= PLAYABLE_PROFICIENCY)
    let chosen: Player | null = null
    let chosenRole: RoleId = item.starter.role
    let chosenScore = -Infinity
    for (const player of pool) {
      // 体力权重大：就是要把体力多的替补顶上去。
      const { role, score } = bestRoleFor(player, item.slot, 0.6, context)
      if (score > chosenScore) {
        chosen = player
        chosenRole = role
        chosenScore = score
      }
    }
    if (!chosen) continue
    used.delete(item.player.id)
    used.add(chosen.id)
    item.starter.playerId = chosen.id
    item.starter.role = chosenRole
  }
}

/**
 * 重置阵容时该跟着留下的东西：同阵型的自定义位置，和所有命名预设。
 * 换阵型时自定义位置失效（槽位变了），但预设必须保留。
 */
function preservedExtras(previous: LineupLike | undefined, formationId: FormationId): Pick<Lineup, 'customPositions' | 'presets'> {
  if (!previous) return {}
  const extras: Pick<Lineup, 'customPositions' | 'presets'> = {}
  if (previous.customPositions && previous.formationId === formationId) {
    const spots = Object.fromEntries(Object.entries(previous.customPositions).map(([slotId, spot]) => [slotId, { ...spot }]))
    if (Object.keys(spots).length) extras.customPositions = spots
  }
  if (previous.presets?.length) extras.presets = structuredClone(previous.presets)
  return extras
}

/** preservedExtras 只需要这几项，所以完整阵容和“记下的快照”都能传进来。 */
type LineupLike = Pick<Lineup, 'formationId' | 'customPositions' | 'presets'>

/**
 * 最近一次被校验过的玩家阵容里的“额外东西”。
 * world.ts 在换赛季/转会时会直接调 autoFillLineup(roster, formationId, tactics) 并且把结果写回存档，
 * 这个兜底路径不传旧阵容；用首发球员对象全部对得上作为“这是同一支玩家队”的凭据，
 * 电脑球队的名单不可能同时包含玩家 7 名首发，不会串数据。
 */
let rememberedSource: (LineupLike & { players: Player[] }) | null = null

function rememberedExtras(roster: Player[]): LineupLike | undefined {
  if (!rememberedSource) return undefined
  return rememberedSource.players.every((player) => roster.includes(player)) ? rememberedSource : undefined
}

/* ---------- 自由摆位 ---------- */

/**
 * 建队时要用的自定义位置。按球员对象记（WeakMap），所以电脑球队永远拿不到玩家的摆位，
 * 也不需要给 MatchTeamInput 加字段（那会动到别人正在改的 match/types.ts 和 setup.ts）。
 * 写入点是 validateLineup：比赛建队前 teamInputFromLineup 一定会先校验阵容。
 */
const customSpotByPlayer = new WeakMap<Player, { x: number; y: number }>()

/** 这名球员当前是否被玩家摆到了自定义位置。 */
export function customSpotFor(player: Player): { x: number; y: number } | undefined {
  return customSpotByPlayer.get(player)
}

/** 记下这套阵容的自定义位置；没摆过的首发球员清掉旧记录，避免换阵型后还在用旧坐标。 */
export function rememberLineupPositions(roster: Player[], lineup: Lineup): void {
  const custom = lineup.customPositions ?? {}
  for (const starter of lineup.starters) {
    const player = playerById(roster, starter.playerId)
    if (!player) continue
    const spot = custom[starter.slotId]
    if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y)) customSpotByPlayer.set(player, { x: spot.x, y: spot.y })
    else customSpotByPlayer.delete(player)
  }
  if (lineup.customPositions || lineup.presets?.length) {
    rememberedSource = {
      players: lineup.starters.flatMap((starter) => playerById(roster, starter.playerId) ?? []),
      formationId: lineup.formationId,
      customPositions: lineup.customPositions ? structuredClone(lineup.customPositions) : undefined,
      presets: lineup.presets ? structuredClone(lineup.presets) : undefined,
    }
  }
}

/** 某个首发位置现在的坐标：有自定义就用自定义，否则用阵型默认。 */
export function slotPosition(lineup: Lineup, slot: { id: string; x: number; y: number }): { x: number; y: number } {
  const custom = lineup.customPositions?.[slot.id]
  return custom && Number.isFinite(custom.x) && Number.isFinite(custom.y) ? { x: custom.x, y: custom.y } : { x: slot.x, y: slot.y }
}

/** 把某个首发位置摆到自定义坐标（原地修改 lineup）。不在当前阵型里的槽位忽略。 */
export function setSlotPosition(lineup: Lineup, slotId: string, spot: { x: number; y: number }): boolean {
  const slot = FORMATIONS[lineup.formationId]?.slots.find((item) => item.id === slotId)
  if (!slot || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return false
  // 摆回阵型默认坐标时就不再算自定义位置。
  if (Math.abs(spot.x - slot.x) < 1e-6 && Math.abs(spot.y - slot.y) < 1e-6) {
    if (lineup.customPositions) {
      delete lineup.customPositions[slotId]
      if (!Object.keys(lineup.customPositions).length) delete lineup.customPositions
    }
    return true
  }
  lineup.customPositions = { ...(lineup.customPositions ?? {}), [slotId]: { x: spot.x, y: spot.y } }
  return true
}

/** 把所有位置恢复成阵型默认。 */
export function clearSlotPositions(lineup: Lineup): boolean {
  if (!lineup.customPositions) return false
  delete lineup.customPositions
  return true
}

/* ---------- 命名预设 ---------- */

/** 战术名称的最大长度。 */
export const PRESET_NAME_LIMIT = 20

export type PresetOutcome = { ok: boolean; error?: string; preset?: TacticPreset }

/** 预设名重复比较用的归一化形式：去首尾空格、忽略大小写。 */
export function normalizePresetName(name: string): string {
  return name.trim().toLowerCase()
}

export function findTacticPreset(lineup: Lineup, id: string): TacticPreset | undefined {
  return (lineup.presets ?? []).find((preset) => preset.id === id)
}

/** 名称校验：不能为空，同一存档内不能重名（exceptId 用于重命名自己）。 */
export function presetNameError(lineup: Lineup, name: string, exceptId?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '战术名称不能为空'
  if ([...trimmed].length > PRESET_NAME_LIMIT) return `战术名称最多 ${PRESET_NAME_LIMIT} 个字`
  const wanted = normalizePresetName(trimmed)
  const duplicate = (lineup.presets ?? []).find((preset) => preset.id !== exceptId && normalizePresetName(preset.name) === wanted)
  return duplicate ? `已经有叫“${duplicate.name}”的战术了，换一个名字` : null
}

/** 当前配置（阵型 + 首发 + 替补 + 战术 + 自定义位置）的快照，不含预设列表本身。 */
export function snapshotLineup(lineup: Lineup): Omit<Lineup, 'presets'> {
  const { presets: _presets, ...rest } = lineup
  const snapshot = structuredClone(rest)
  // 存档里可能留着换阵型前的旧槽位，存预设时只保留当前阵型还在用的。
  if (snapshot.customPositions) {
    const slotIds = new Set(FORMATIONS[snapshot.formationId].slots.map((slot) => slot.id))
    const kept = Object.entries(snapshot.customPositions).filter(([slotId]) => slotIds.has(slotId))
    if (kept.length) snapshot.customPositions = Object.fromEntries(kept)
    else delete snapshot.customPositions
  }
  return snapshot
}

function nextPresetId(lineup: Lineup, createdAt: number): string {
  const presets = lineup.presets ?? []
  let seq = presets.length + 1
  while (presets.some((preset) => preset.id === `preset-${createdAt.toString(36)}-${seq}`)) seq++
  return `preset-${createdAt.toString(36)}-${seq}`
}

/** 把当前配置存成一个命名预设（原地修改 lineup.presets）。 */
export function saveTacticPreset(lineup: Lineup, name: string, createdAt = Date.now()): PresetOutcome {
  const error = presetNameError(lineup, name)
  if (error) return { ok: false, error }
  const presets = (lineup.presets ??= [])
  const preset: TacticPreset = { id: nextPresetId(lineup, createdAt), name: name.trim(), createdAt, lineup: snapshotLineup(lineup) }
  presets.push(preset)
  return { ok: true, preset }
}

/** 改名；重名、空名都会被拒绝。 */
export function renameTacticPreset(lineup: Lineup, id: string, name: string): PresetOutcome {
  const preset = findTacticPreset(lineup, id)
  if (!preset) return { ok: false, error: '找不到这个战术预设' }
  const error = presetNameError(lineup, name, id)
  if (error) return { ok: false, error }
  preset.name = name.trim()
  return { ok: true, preset }
}

export function deleteTacticPreset(lineup: Lineup, id: string): boolean {
  if (!findTacticPreset(lineup, id)) return false
  lineup.presets = (lineup.presets ?? []).filter((preset) => preset.id !== id)
  return true
}

/**
 * 取一份可以直接写回 game.lineup 的阵容：预设里的配置 + 当前预设列表。
 * 预设本身不存别的预设，所以应用时要把列表接回来。
 */
export function applyTacticPreset(lineup: Lineup, id: string): Lineup | null {
  const preset = findTacticPreset(lineup, id)
  if (!preset) return null
  const next: Lineup = { ...structuredClone(preset.lineup) }
  if (lineup.presets?.length) next.presets = structuredClone(lineup.presets)
  return next
}

export type LineupValidation = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateLineup(roster: Player[], lineup: Lineup): LineupValidation {
  // 校验是比赛建队的必经路径，顺手记下自定义摆位给 buildMatchTeam 用（见 customSpotFor）。
  rememberLineupPositions(roster, lineup)
  const errors: string[] = []
  const warnings: string[] = []
  const formation = FORMATIONS[lineup.formationId]
  if (!formation) errors.push('未知阵型')
  else if (formation.legacy) errors.push('旧的 7 人制阵型已经停用，请改用 11 人制阵型')
  if (lineup.starters.length !== STARTERS) errors.push(`首发必须是 ${STARTERS} 人`)
  const slotMap = new Map(formation?.slots.map((slot) => [slot.id, slot]) ?? [])
  const playerIds = new Set<string>()
  let gkCount = 0
  for (const starter of lineup.starters) {
    const slot = slotMap.get(starter.slotId)
    if (!slot) {
      errors.push(`阵型中没有位置 ${starter.slotId}`)
      continue
    }
    const player = playerById(roster, starter.playerId)
    if (!player) {
      errors.push(`${slot.label}：球员不存在`)
      continue
    }
    if (playerIds.has(player.id)) errors.push(`${player.name} 被重复安排`)
    playerIds.add(player.id)
    const role = ROLES[starter.role]
    if (!role || role.position !== slot.position) errors.push(`${player.name} 的职责与 ${slot.label} 不匹配`)
    if (slot.position === 'GK') gkCount++
    // 任何人都能踢任何位置，代价是按熟练度折损属性。
    if (slot.position === 'GK' && player.positions.GK <= 0) warnings.push(`${player.name} 不是门将，几乎扑不到球`)
    else if (player.positions[slot.position] < 65) warnings.push(`${player.name} 在 ${slot.label} 的熟练度仅 ${Math.round(player.positions[slot.position])}，属性会明显折损`)
  }
  if (gkCount !== 1) errors.push('阵容必须且只能有 1 名合法门将')
  if (formation) {
    const filled = new Set(lineup.starters.map((s) => s.slotId))
    for (const slot of formation.slots) {
      if (!filled.has(slot.id)) errors.push(`${slot.label} 无人`)
    }
  }
  if (lineup.bench.length > BENCH_SIZE) errors.push(`替补最多 ${BENCH_SIZE} 人`)
  const benchSet = new Set<string>()
  for (const id of lineup.bench) {
    if (playerIds.has(id)) errors.push('首发与替补不能重复')
    if (benchSet.has(id)) errors.push('替补重复')
    benchSet.add(id)
    if (!playerById(roster, id)) errors.push('替补球员不存在')
  }
  if (lineup.bench.length < BENCH_SIZE) warnings.push(`替补不足 ${BENCH_SIZE} 人，比赛中换人选择会受限`)
  return { valid: errors.length === 0, errors, warnings }
}

/**
 * 把球员放进首发位置（原地修改 lineup）。
 * 该球员若已在别的首发位置或替补席，就与这个位置原来的球员互换。
 */
export function assignStarter(lineup: Lineup, slotId: string, playerId: string): void {
  const formation = FORMATIONS[lineup.formationId]
  const slot = formation.slots.find((item) => item.id === slotId)
  if (!slot) return
  const here = lineup.starters.find((item) => item.slotId === slotId)
  const previous = here?.playerId
  if (previous === playerId) return
  const otherStarter = lineup.starters.find((item) => item.playerId === playerId)
  const benchFrom = lineup.bench.indexOf(playerId)
  if (here) here.playerId = playerId
  else lineup.starters.push({ slotId, playerId, role: slot.defaultRole })
  if (otherStarter && otherStarter !== here) {
    if (previous) otherStarter.playerId = previous
    else lineup.starters = lineup.starters.filter((item) => item !== otherStarter)
  }
  if (benchFrom >= 0) {
    if (previous) lineup.bench[benchFrom] = previous
    else lineup.bench.splice(benchFrom, 1)
  }
}

/** 把球员放进第 index 个替补位；已在替补席的球员与该位互换，数组不留空洞。 */
export function assignBench(lineup: Lineup, index: number, playerId: string): void {
  const other = lineup.bench.indexOf(playerId)
  if (other === index) return
  const previous = lineup.bench[index]
  if (other >= 0) {
    if (previous) lineup.bench[other] = previous
    else lineup.bench.splice(other, 1)
  }
  if (index < lineup.bench.length) lineup.bench[index] = playerId
  else lineup.bench.push(playerId)
}

/** 阵容里的一个去处：首发位置、第几个替补位，或者不进比赛名单。 */
export type LineupTarget = { slotId: string } | { benchIndex: number } | 'reserve'

/**
 * 把球员移到阵容的任意位置（原地修改 lineup），有人就互换；返回错误文案，成功时返回 null。
 * 首发挪到替补席时，替补席上原来的人顶上去；替补位是空的，这个首发位置就留空。
 */
export function movePlayer(roster: Player[], lineup: Lineup, playerId: string, target: LineupTarget): string | null {
  const player = playerById(roster, playerId)
  if (!player) return '球员不存在'
  if (target === 'reserve') {
    lineup.starters = lineup.starters.filter((item) => item.playerId !== playerId)
    lineup.bench = lineup.bench.filter((id) => id !== playerId)
    return null
  }
  if ('slotId' in target) {
    if (!FORMATIONS[lineup.formationId].slots.some((item) => item.id === target.slotId)) return '阵型中没有这个位置'
    assignStarter(lineup, target.slotId, playerId)
    return null
  }
  const index = Math.max(0, Math.min(target.benchIndex, BENCH_SIZE - 1))
  const starter = lineup.starters.find((item) => item.playerId === playerId)
  if (!starter) {
    assignBench(lineup, index, playerId)
    return null
  }
  const previous = lineup.bench[index]
  if (previous) starter.playerId = previous
  else lineup.starters = lineup.starters.filter((item) => item !== starter)
  if (index < lineup.bench.length) lineup.bench[index] = playerId
  else lineup.bench.push(playerId)
  return null
}

export function clearStarter(lineup: Lineup, slotId: string): void {
  lineup.starters = lineup.starters.filter((item) => item.slotId !== slotId)
}

export function clearBench(lineup: Lineup, index: number): void {
  lineup.bench.splice(index, 1)
}

export function lineupSlots(roster: Player[], lineup: Lineup): LineupSlotView[] {
  const formation = FORMATIONS[lineup.formationId]
  return formation.slots.map((slot) => {
    const starter = lineup.starters.find((entry) => entry.slotId === slot.id)
    const player = starter ? playerById(roster, starter.playerId) ?? null : null
    const role = starter?.role ?? slot.defaultRole
    const prof = player ? player.positions[slot.position] : 0
    return {
      slotId: slot.id,
      position: slot.position,
      label: slot.label,
      player,
      role,
      fit: player ? roleFit(player.attrs, role, player.positions.GK > 0) * positionMultiplier(prof) : 0,
      effectiveLoss: player ? 1 - positionMultiplier(prof) : 0,
    }
  })
}

/** 替换/确认球员后，自动修复不再合法的首发与替补。 */
export function repairLineup(roster: Player[], lineup: Lineup): { lineup: Lineup; changed: boolean } {
  if (validateLineup(roster, lineup).valid) return { lineup, changed: false }
  const fixed = autoFillLineup(roster, lineup.formationId, lineup.tactics, lineup)
  return { lineup: fixed, changed: true }
}
