/**
 * 俱乐部董事会系统（第 2 赛季起生效；休赛期提前发布下赛季三档目标与预算预览）。
 *
 * 核心设计：
 * 1. 赛季目标：联赛排名目标（70% 权重）+ 本级正式赛季杯赛目标（30% 权重），提供三档雄心可选
 *    （稳妥 safe / 基准推荐 expected / 野心 ambitious）；休赛期可预选，开季第 1–3 轮可最后确认或切换，
 *    第 4 轮自动锁定。
 * 2. 独立预算拨款：每赛季开启时董事会直接拨付「转会预算」（注入俱乐部余额）与「独立设施预算」（独立专用池）。
 *    - 升级设施优先扣除「独立设施预算」（不扣俱乐部余额），预算不足或用完时自动使用俱乐部自有余额补足，两者互不冲突。
 *    - 签人/竞拍同时校验余额、转会预算与每轮有效工资帽；卖人收入按信任度留存率（50%/75%/85%）回流至转会预算。
 * 3. 转会预算 ↔ 工资帽双向滑块：按 38:1（每赛季 38 轮）在转会预算与基础工资帽之间精确互转；
 *    滑块严格不与「设施预算」互通，守住设施进度上限。
 * 4. 赛季末考核奖惩闭环：按综合完成度评定 S/A/B/C/D，更新董事会信任度（15–100）、发放 S/A 达标奖金，
 *    并直接缩放下赛季转会预算、设施预算、工资帽与卖人留存率（未达目标下赛季预算明显削减）。
 */
import type {
  AITeam,
  BoardAmbition,
  BoardCupId,
  BoardCupStage,
  BoardEvaluation,
  BoardGoalOption,
  BoardGrade,
  BoardOffseasonPreview,
  BoardSeasonMandate,
  BoardState,
  EconomyState,
  GameState,
  Player,
  SeasonState,
  TierId,
  WorldState,
} from './types.ts'
import type { SeasonCups } from './season-cups.ts'
import { lineupRating } from './club-rating.ts'
import { economyOf, facilityRoundIncome } from './economy.ts'
import { MIN_SQUAD } from './squad.ts'
import { wageForPlayer, worldWageBill } from './wages.ts'
import { checkFacilityBudget, facilityBudgetAvailable, isBoardBudgetActive, spendFacilityBudget } from './board-budget.ts'
export { checkFacilityBudget, facilityBudgetAvailable, isBoardBudgetActive, spendFacilityBudget } from './board-budget.ts'

export const BOARD_INITIAL_CONFIDENCE = 60
export const BOARD_MIN_CONFIDENCE = 15
export const BOARD_MAX_CONFIDENCE = 100
/** 转会预算 ↔ 每轮工资帽滑块换算比率：1 赛季 38 轮联赛。 */
export const BOARD_WAGE_SLIDER_ROUNDS = 38
/** 开季后允许确认/调整目标档位的最大轮次（第 1–3 轮可调，第 4 轮起锁定）。 */
export const BOARD_CHOICE_MAX_ROUND = 3
/** 球迷商店 + 赞助商每轮收入的 30% 折算为额外商业工资帽空间。 */
export const BOARD_COMMERCIAL_WAGE_SHARE = 0.30
const BOARD_HISTORY_LIMIT = 20

export const BOARD_AMBITION_ORDER: readonly BoardAmbition[] = ['safe', 'expected', 'ambitious']

export const BOARD_AMBITION_META: Record<BoardAmbition, {
  label: string
  tagline: string
  budgetMul: number
  wageMul: number
  bonusMul: number
}> = {
  safe: {
    label: '稳妥档',
    tagline: '目标更宽松、保级/稳步发育优先，预算与工资帽略收缩',
    budgetMul: 0.85,
    wageMul: 0.90,
    bonusMul: 0.75,
  },
  expected: {
    label: '基准档',
    tagline: '匹配球队当前战力的董事会推荐方案，预算与风险均衡',
    budgetMul: 1.00,
    wageMul: 1.00,
    bonusMul: 1.00,
  },
  ambitious: {
    label: '野心档',
    tagline: '承诺更高联赛与杯赛目标，换取高额预算与丰厚奖金（失利扣更多信任度）',
    budgetMul: 1.25,
    wageMul: 1.12,
    bonusMul: 1.50,
  },
}

export const BOARD_TIER_BASE: Record<TierId, {
  transferGrant: number
  facilityGrant: number
  wageCap: number
  meetBonus: number
  exceedBonus: number
  cupId: BoardCupId
}> = {
  division2: {
    transferGrant: 1_200_000,
    facilityGrant: 300_000,
    wageCap: 55_000,
    meetBonus: 200_000,
    exceedBonus: 450_000,
    cupId: 'community',
  },
  division1: {
    transferGrant: 4_500_000,
    facilityGrant: 1_000_000,
    wageCap: 110_000,
    meetBonus: 800_000,
    exceedBonus: 1_800_000,
    cupId: 'league',
  },
  champions: {
    transferGrant: 14_000_000,
    facilityGrant: 2_500_000,
    wageCap: 240_000,
    meetBonus: 2_500_000,
    exceedBonus: 5_500_000,
    cupId: 'champions',
  },
}

export const BOARD_CUP_LABELS: Record<BoardCupId, string> = {
  community: '社区杯',
  league: '联盟杯',
  champions: '冠军杯',
}

export const BOARD_CUP_STAGE_RANK: Record<BoardCupStage, number> = {
  none: 0,
  qualified: 1,
  r16: 2,
  qf: 3,
  sf: 4,
  final: 5,
  champion: 6,
}

export const BOARD_CUP_STAGE_LABELS: Record<BoardCupStage, string> = {
  none: '无硬性要求',
  qualified: '获得参赛资格',
  r16: '打进 16 强',
  qf: '打进 8 强',
  sf: '打进 4 强',
  final: '晋级决赛',
  champion: '夺得冠军',
}

export const BOARD_GRADE_META: Record<BoardGrade, { label: string; tone: 'gold' | 'good' | 'info' | 'warn' | 'bad' }> = {
  S: { label: 'S · 大超预期', tone: 'gold' },
  A: { label: 'A · 达成目标', tone: 'good' },
  B: { label: 'B · 基本及格', tone: 'info' },
  C: { label: 'C · 未达目标', tone: 'warn' },
  D: { label: 'D · 严重失职', tone: 'bad' },
}

const GRADE_BUDGET_MUL: Record<BoardGrade, number> = {
  S: 1.06,
  A: 1.00,
  B: 0.94,
  C: 0.84,
  D: 0.72,
}

const GRADE_WAGE_MUL: Record<BoardGrade, number> = {
  S: 1.04,
  A: 1.00,
  B: 0.97,
  C: 0.92,
  D: 0.86,
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const roundThousand = (value: number): number => Math.max(0, Math.round(value / 1000) * 1000)
const roundFifty = (value: number): number => Math.max(0, Math.round(value / 50) * 50)

export function isBoardAmbition(value: unknown): value is BoardAmbition {
  return value === 'safe' || value === 'expected' || value === 'ambitious'
}

/** 获取或初始化董事会状态（不自动激活第 1 赛季预算限制，保证旧档与首赛季零侵入）。 */
export function ensureBoard(game: GameState): BoardState {
  if (!game.board || typeof game.board !== 'object') {
    game.board = {
      version: 1,
      confidence: BOARD_INITIAL_CONFIDENCE,
      history: [],
    }
  } else {
    if (game.board.version !== 1) game.board.version = 1
    if (!Number.isFinite(game.board.confidence)) game.board.confidence = BOARD_INITIAL_CONFIDENCE
    game.board.confidence = clamp(Math.round(game.board.confidence), BOARD_MIN_CONFIDENCE, BOARD_MAX_CONFIDENCE)
    if (!Array.isArray(game.board.history)) game.board.history = []
  }
  return game.board
}

/** 信任度 + 上季评级决定的下赛季转会/设施预算系数（0.55× – 1.40×）。 */
export function confidenceBudgetMultiplier(confidence: number, lastGrade?: BoardGrade): number {
  const c = clamp(confidence, BOARD_MIN_CONFIDENCE, BOARD_MAX_CONFIDENCE)
  // confidence=60 -> 1.00; 100 -> 1.32; 15 -> 0.64
  const confFactor = 1 + (c - BOARD_INITIAL_CONFIDENCE) * 0.008
  const gradeFactor = lastGrade ? GRADE_BUDGET_MUL[lastGrade] : 1
  return Math.round(clamp(confFactor * gradeFactor, 0.55, 1.40) * 1000) / 1000
}

/** 信任度 + 上季评级决定的下赛季基础工资帽系数（0.80× – 1.25×）。 */
export function confidenceWageCapMultiplier(confidence: number, lastGrade?: BoardGrade): number {
  const c = clamp(confidence, BOARD_MIN_CONFIDENCE, BOARD_MAX_CONFIDENCE)
  // confidence=60 -> 1.00; 100 -> 1.20; 15 -> 0.82
  const confFactor = 1 + (c - BOARD_INITIAL_CONFIDENCE) * (c >= BOARD_INITIAL_CONFIDENCE ? 0.005 : 0.004)
  const gradeFactor = lastGrade ? GRADE_WAGE_MUL[lastGrade] : 1
  return Math.round(clamp(confFactor * gradeFactor, 0.80, 1.25) * 1000) / 1000
}

/** 卖人收入回流至转会预算的比例：信任度 <40 为 50%，40–74 为 75%，>=75 为 85%。 */
export function transferRetentionRate(confidence: number): number {
  if (confidence >= 75) return 0.85
  if (confidence >= 40) return 0.75
  return 0.50
}

/** 球迷商店与赞助商每轮收入的 30% 转化为额外工资帽空间。 */
export function boardCommercialWageBonus(economy: EconomyState): number {
  const commercial = facilityRoundIncome(economy, 'shop') + facilityRoundIncome(economy, 'sponsor')
  return Math.round(commercial * BOARD_COMMERCIAL_WAGE_SHARE)
}

/** 当前有效每轮工资帽（基础工资帽 + 商业分成加成）；非激活赛季返回 null。 */
export function boardEffectiveWageCap(game: GameState): number | null {
  if (!isBoardBudgetActive(game)) return null
  const mandate = game.board!.current!
  const economy = economyOf(game)
  return mandate.wageCap + boardCommercialWageBonus(economy)
}

/** 赛季是否仍处于开季目标确认/切换窗口（第 1–3 轮且未锁定且未结束）。 */
export function canSwitchCurrentBoardAmbition(game: Pick<GameState, 'board' | 'season'>): boolean {
  if (!isBoardBudgetActive(game)) return false
  const mandate = game.board!.current!
  if (mandate.locked || game.season?.finished) return false
  const round = game.season?.round ?? 1
  return round <= BOARD_CHOICE_MAX_ROUND
}

/** 轮次推进到第 4 轮或赛季结束时自动锁定当季目标档位。 */
export function syncBoardLockState(game: Pick<GameState, 'board' | 'season'>): boolean {
  if (!isBoardBudgetActive(game)) return false
  const mandate = game.board!.current!
  if (!mandate.locked && ((game.season?.round ?? 1) > BOARD_CHOICE_MAX_ROUND || game.season?.finished)) {
    mandate.locked = true
    return true
  }
  return false
}

/* ---------- 预算与工资帽校验 & 记账 ---------- */

export function checkTransferBudget(
  game: GameState,
  amount: number,
  committedAuctions = 0,
): { ok: true } | { ok: false; error: string } {
  if (!isBoardBudgetActive(game)) return { ok: true }
  const mandate = game.board!.current!
  const available = mandate.transferBudget - Math.max(0, committedAuctions)
  if (available < amount) {
    const extra = committedAuctions > 0 ? `（其他领先竞拍已占用 ${committedAuctions.toLocaleString()}）` : ''
    return {
      ok: false,
      error: `转会预算不足：需要 ${amount.toLocaleString()}，可用转会预算 ${Math.max(0, available).toLocaleString()}${extra}（可在「俱乐部 → 董事会」出售球员回流或用滑块调拨预算）`,
    }
  }
  return { ok: true }
}

export function spendTransferBudget(game: GameState, amount: number): void {
  if (!isBoardBudgetActive(game)) return
  const mandate = game.board!.current!
  mandate.transferBudget = Math.max(0, mandate.transferBudget - Math.max(0, Math.round(amount)))
}

/** 卖人成交时按董事会留存率把部分收入回流至本季转会预算，返回回流金额。 */
export function creditTransferSale(game: GameState, proceeds: number): number {
  if (!isBoardBudgetActive(game) || proceeds <= 0) return 0
  const mandate = game.board!.current!
  const added = Math.round(proceeds * mandate.retentionRate)
  mandate.transferBudget += added
  return added
}

/** 签约新援前的每轮工资帽校验；青训球员或阵容不足最低人数时豁免。 */
export function checkWageCapForSigning(
  game: GameState,
  player: Pick<Player, 'attrs' | 'baseAttrs' | 'positions' | 'basePositions' | 'youthOrigin' | 'starKey'>,
): { ok: true } | { ok: false; error: string } {
  const cap = boardEffectiveWageCap(game)
  if (cap === null) return { ok: true }
  if (player.youthOrigin || game.roster.length < MIN_SQUAD) return { ok: true }
  const incomingWage = wageForPlayer(player as Player)
  const currentBill = worldWageBill(game)
  const projected = currentBill + incomingWage
  if (projected > cap) {
    return {
      ok: false,
      error: `超出每轮工资帽：签约后全队工资 ${projected.toLocaleString()}/轮（现 ${currentBill.toLocaleString()} + 新援 ${incomingWage.toLocaleString()}），高于有效工资帽 ${cap.toLocaleString()}/轮。请在「董事会」用预算滑块提高工资帽，或出售/解约高薪球员`,
    }
  }
  return { ok: true }
}

/** 续约涨薪前的工资帽校验；未涨薪时放行。 */
export function checkWageCapForRenewal(
  game: GameState,
  playerId: string,
  nextWage: number,
): { ok: true } | { ok: false; error: string } {
  const cap = boardEffectiveWageCap(game)
  if (cap === null) return { ok: true }
  const player = game.roster.find((item) => item.id === playerId)
  if (!player) return { ok: true }
  const oldWage = player.contract?.wage ?? 0
  const delta = nextWage - oldWage
  if (delta <= 0) return { ok: true }
  const currentBill = worldWageBill(game)
  const projected = currentBill + delta
  if (projected > cap) {
    return {
      ok: false,
      error: `续约后超出工资帽：预计每轮工资 ${projected.toLocaleString()}（+${delta.toLocaleString()}），高于有效工资帽 ${cap.toLocaleString()}。请先在「董事会」用预算滑块上调工资帽或腾出薪资空间`,
    }
  }
  return { ok: true }
}

/* ---------- 战力排位、杯赛战绩与目标方案生成 ---------- */

function targetPairForRank(tier: TierId, powerRank: number, totalClubs: number): Record<BoardAmbition, { leagueTarget: number; cupTarget: BoardCupStage }> {
  const cap = Math.max(1, totalClubs - 1)
  const clampRank = (rank: number) => clamp(rank, 1, cap)
  if (powerRank <= 3) {
    return {
      safe: { leagueTarget: clampRank(6), cupTarget: 'qf' },
      expected: { leagueTarget: clampRank(3), cupTarget: 'sf' },
      ambitious: { leagueTarget: 1, cupTarget: 'final' },
    }
  }
  if (powerRank <= 6) {
    return {
      safe: { leagueTarget: clampRank(8), cupTarget: 'r16' },
      expected: { leagueTarget: clampRank(5), cupTarget: 'qf' },
      ambitious: { leagueTarget: clampRank(3), cupTarget: 'sf' },
    }
  }
  if (powerRank <= 10) {
    return {
      safe: { leagueTarget: clampRank(11), cupTarget: 'qualified' },
      expected: { leagueTarget: clampRank(8), cupTarget: 'r16' },
      ambitious: { leagueTarget: clampRank(5), cupTarget: 'qf' },
    }
  }
  if (powerRank <= 14) {
    return {
      safe: { leagueTarget: clampRank(14), cupTarget: tier === 'division2' ? 'none' : 'qualified' },
      expected: { leagueTarget: clampRank(11), cupTarget: 'qualified' },
      ambitious: { leagueTarget: clampRank(8), cupTarget: 'r16' },
    }
  }
  if (powerRank <= 17) {
    return {
      safe: { leagueTarget: clampRank(17), cupTarget: 'none' },
      expected: { leagueTarget: clampRank(14), cupTarget: tier === 'division2' ? 'none' : 'qualified' },
      ambitious: { leagueTarget: clampRank(10), cupTarget: tier === 'division2' ? 'qualified' : 'r16' },
    }
  }
  return {
    safe: { leagueTarget: clampRank(17), cupTarget: 'none' },
    expected: { leagueTarget: clampRank(16), cupTarget: tier === 'division2' ? 'none' : 'qualified' },
    ambitious: { leagueTarget: clampRank(12), cupTarget: tier === 'division2' ? 'qualified' : 'r16' },
  }
}

/** 按联赛级别、一阵战力排位、信任度与上季考核评级生成三档董事会目标与预算方案。 */
export function buildBoardGoalOptions(
  tier: TierId,
  powerRank: number,
  totalClubs: number,
  confidence: number,
  lastGrade?: BoardGrade,
): BoardGoalOption[] {
  const base = BOARD_TIER_BASE[tier] ?? BOARD_TIER_BASE.division2
  const budgetMul = confidenceBudgetMultiplier(confidence, lastGrade)
  const wageMul = confidenceWageCapMultiplier(confidence, lastGrade)
  const targets = targetPairForRank(tier, clamp(powerRank, 1, Math.max(1, totalClubs)), Math.max(2, totalClubs))

  return BOARD_AMBITION_ORDER.map((ambition) => {
    const meta = BOARD_AMBITION_META[ambition]
    return {
      ambition,
      label: meta.label,
      leagueTarget: targets[ambition].leagueTarget,
      cupId: base.cupId,
      cupTarget: targets[ambition].cupTarget,
      transferGrant: roundThousand(base.transferGrant * budgetMul * meta.budgetMul),
      facilityGrant: roundThousand(base.facilityGrant * budgetMul * meta.budgetMul),
      wageCap: roundFifty(base.wageCap * wageMul * meta.wageMul),
      meetBonus: roundThousand(base.meetBonus * meta.bonusMul),
      exceedBonus: roundThousand(base.exceedBonus * meta.bonusMul),
    }
  })
}

/** 估算玩家球队在当前所属分区的一阵战力排位（1 = 最强）。 */
export function estimateDivisionPowerRank(
  game: Pick<GameState, 'roster' | 'lineup' | 'cards' | 'aiTeams' | 'season' | 'world'>,
  tierOverride?: TierId,
  teamsById?: Record<string, AITeam>,
): { powerRank: number; totalClubs: number } {
  const myRating = game.roster?.length && game.lineup
    ? lineupRating(game.roster, game.lineup, game.cards)
    : 0
  const world = game.world
  const targetTier = tierOverride ?? game.season?.tier ?? 'division2'

  // 优先与目标级别的同区真实阵容对比（新赛季已建分区时最准确；若 world.divisions 已裁剪则回退 game.season.clubIds）
  if (teamsById) {
    const myClub = world?.clubs.find((club) => club.id === 'player')
    const myRealId = myClub?.squadKey ?? 'player'
    const division = world?.divisions?.find((item) => item.tier === targetTier && item.clubIds?.some((id) => id === 'player' || id === myRealId))
      ?? world?.divisions?.find((item) => item.tier === targetTier)
    const ids = division?.clubIds?.length
      ? division.clubIds
      : (targetTier === (game.season?.tier ?? 'division2') ? (game.season?.clubIds ?? []) : [])
    if (ids.length >= 2) {
      const entries: { id: string; rating: number }[] = []
      for (const id of ids) {
        if (id === 'player' || id === myRealId) {
          entries.push({ id: 'player', rating: myRating })
        } else {
          const team = teamsById[id]
          if (team?.players?.length && team.lineup) {
            entries.push({ id, rating: lineupRating(team.players, team.lineup) })
          }
        }
      }
      if (entries.length >= 2 && entries.some((item) => item.id === 'player')) {
        entries.sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
        const rank = entries.findIndex((item) => item.id === 'player') + 1
        return { powerRank: Math.max(1, rank), totalClubs: ids.length }
      }
    }
  }

  // 回退使用本分区当前 aiTeams（单机或休赛期同级对比）
  const sameTier = !tierOverride || tierOverride === (game.season?.tier ?? 'division2')
  if (sameTier && game.aiTeams?.length) {
    const entries: { id: string; rating: number }[] = [
      { id: 'player', rating: myRating },
      ...game.aiTeams.map((team) => ({ id: team.id, rating: lineupRating(team.players, team.lineup) })),
    ]
    entries.sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id))
    const rank = entries.findIndex((item) => item.id === 'player') + 1
    return { powerRank: Math.max(1, rank), totalClubs: entries.length }
  }

  // 跨级预测（例如刚升级或刚降级尚未重建下赛季分区）：新升班马保守排在下游，新降班马排在上游
  const currentTier = game.season?.tier ?? 'division2'
  const order: Record<TierId, number> = { division2: 1, division1: 2, champions: 3 }
  if (order[targetTier] > order[currentTier]) return { powerRank: 16, totalClubs: 20 }
  if (order[targetTier] < order[currentTier]) return { powerRank: 4, totalClubs: 20 }
  return { powerRank: 10, totalClubs: 20 }
}

/** 推算俱乐部在常规赛结束后下赛季将身处的联赛级别及是否已最终锁定。 */
export function projectNextSeasonTier(
  game: Pick<GameState, 'season' | 'world'>,
  clubId?: string,
): { tier: TierId; confirmed: boolean } {
  const currentTier: TierId = game.season?.tier ?? 'division2'
  const finish = game.season?.playerFinish
    ?? (() => {
      const idx = (game.season?.table ?? []).findIndex((row) => row.teamId === 'player' || (clubId && row.teamId === clubId))
      return idx >= 0 ? idx + 1 : null
    })()
  const total = game.season?.table?.length ?? 20
  if (!game.season?.finished || !finish) {
    return { tier: currentTier, confirmed: false }
  }

  if (currentTier === 'champions') {
    return { tier: finish > total - 3 ? 'division1' : 'champions', confirmed: true }
  }
  if (currentTier === 'division1') {
    if (finish <= 3) return { tier: 'champions', confirmed: true }
    if (finish > total - 3) return { tier: 'division2', confirmed: true }
    return { tier: 'division1', confirmed: true }
  }

  // 二级联赛：前 3 参加升级杯决定 3 个升级名额；第 4 名起已锁定留级二级
  if (finish > 3) return { tier: 'division2', confirmed: true }

  const ids = new Set<string>(['player'])
  if (clubId) ids.add(clubId)
  const squadKey = game.world?.clubs.find((club) => club.id === 'player')?.squadKey
  if (squadKey) ids.add(squadKey)

  const promoCup = game.world?.seasonCups?.seasonIndex === game.season.index
    ? game.world.seasonCups.cups.find((cup) => cup.id === 'promotion')
    : undefined
  if (promoCup) {
    if (promoCup.promotedIds?.some((id) => ids.has(id))) {
      return { tier: 'division1', confirmed: true }
    }
    if (promoCup.championId) {
      return { tier: 'division2', confirmed: true }
    }
    // 升级杯仍在进行时，检查本队是否已经提前淘汰（资格赛落败或小组赛出局）
    const entered = promoCup.entrants.some((id) => ids.has(id))
    if (!entered) return { tier: 'division2', confirmed: true }
    if (promoCup.groups?.length) {
      const inGroup = promoCup.groups.some((group) => group.teamIds.some((id) => ids.has(id)))
      if (!inGroup) return { tier: 'division2', confirmed: true }
      const playoffFinal = promoCup.rounds.find((round) => round.round > 1 && round.stage === 'knockout')
      if (playoffFinal) {
        const inFinal = playoffFinal.fixtures.some((fixture) => ids.has(fixture.homeId) || ids.has(fixture.awayId))
        if (!inFinal) return { tier: 'division2', confirmed: true }
      }
    } else {
      const r1 = promoCup.rounds[0]
      const lostQualifier = r1?.fixtures.some(
        (fixture) => (ids.has(fixture.homeId) || ids.has(fixture.awayId)) && fixture.played && !!fixture.winnerId && !ids.has(fixture.winnerId),
      )
      if (lostQualifier) return { tier: 'division2', confirmed: true }
    }
    return { tier: 'division2', confirmed: false }
  }

  const playoff = game.world?.promotionPlayoff?.seasonIndex === game.season.index
    ? game.world.promotionPlayoff
    : undefined
  if (playoff?.finished) {
    return {
      tier: playoff.promoted.some((id) => ids.has(id)) ? 'division1' : 'division2',
      confirmed: true,
    }
  }
  return { tier: 'division2', confirmed: false }
}

/** 评估某俱乐部在本赛季指定正式杯赛中的最终成绩阶段。 */
export function evaluateClubCupStage(
  seasonCups: SeasonCups | undefined,
  clubIds: Iterable<string>,
  cupId: BoardCupId,
): { stage: BoardCupStage; cupPresent: boolean } {
  if (!seasonCups) return { stage: 'none', cupPresent: false }
  const cup = seasonCups.cups.find((item) => item.id === cupId)
  if (!cup || cup.entrants.length === 0) return { stage: 'none', cupPresent: false }
  const idSet = new Set(clubIds)
  const entered = cup.entrants.some((id) => idSet.has(id))
  if (!entered) return { stage: 'none', cupPresent: true }
  if (cup.championId && idSet.has(cup.championId)) return { stage: 'champion', cupPresent: true }

  let deepestTeamsLeft = Infinity
  for (const round of cup.rounds) {
    const appeared = round.byes.some((id) => idSet.has(id))
      || round.fixtures.some((fixture) => idSet.has(fixture.homeId) || idSet.has(fixture.awayId))
    if (!appeared) continue
    const teamsLeft = round.byes.length + round.fixtures.length * 2
    if (teamsLeft > 0 && teamsLeft < deepestTeamsLeft) deepestTeamsLeft = teamsLeft
  }

  if (!Number.isFinite(deepestTeamsLeft)) return { stage: 'qualified', cupPresent: true }
  if (deepestTeamsLeft <= 2) return { stage: 'final', cupPresent: true }
  if (deepestTeamsLeft <= 4) return { stage: 'sf', cupPresent: true }
  if (deepestTeamsLeft <= 8) return { stage: 'qf', cupPresent: true }
  if (deepestTeamsLeft <= 16) return { stage: 'r16', cupPresent: true }
  return { stage: 'qualified', cupPresent: true }
}

/**
 * 休赛期刷新下赛季董事会目标与预算预览（幂等，仅在预览变化时返回 true）。
 * 当常规赛结束（含升级杯期间）自动调用，让玩家可提前挑选下赛季目标档位。
 */
export function refreshOffseasonBoardPreview(
  game: GameState,
  clubId?: string,
  teamsById?: Record<string, AITeam>,
): boolean {
  if (!game.season?.finished) return false
  const board = ensureBoard(game)
  // 若本赛季有激活的董事会目标，预览下赛季时按当前信任度与当前预计评级估算倍率
  const projection = projectNextSeasonTier(game, clubId)
  const { powerRank, totalClubs } = estimateDivisionPowerRank(game, projection.tier, teamsById)

  // 预测考核后的信任度与评级（如当前赛季已有 mandate 则预演，否则保持现有信任度）
  let previewConfidence = board.confidence
  let previewGrade = board.lastGrade
  if (isBoardBudgetActive(game)) {
    const simulated = previewSeasonEvaluation(game, game.world?.seasonCups, clubId)
    if (simulated) {
      previewConfidence = simulated.confidenceAfter
      previewGrade = simulated.grade
    }
  }

  const nextSeasonIndex = (game.season.index ?? 1) + 1
  const budgetMultiplier = confidenceBudgetMultiplier(previewConfidence, previewGrade)
  const wageMultiplier = confidenceWageCapMultiplier(previewConfidence, previewGrade)
  const retentionRate = transferRetentionRate(previewConfidence)
  const options = buildBoardGoalOptions(projection.tier, powerRank, totalClubs, previewConfidence, previewGrade)
  let promotionOptions: BoardGoalOption[] | undefined
  if (!projection.confirmed && projection.tier === 'division2') {
    const d1Rank = estimateDivisionPowerRank(game, 'division1', teamsById)
    promotionOptions = buildBoardGoalOptions('division1', d1Rank.powerRank, d1Rank.totalClubs, previewConfidence, previewGrade)
  }

  let syncedChoice = false
  if (projection.confirmed) {
    const tierPicked = board.pendingChoicesByTier?.[projection.tier]
    if (tierPicked && board.pendingChoice !== tierPicked) {
      board.pendingChoice = tierPicked
      syncedChoice = true
    } else if (!tierPicked && board.pendingChoice && board.pendingChoicesByTier && Object.keys(board.pendingChoicesByTier).length > 0) {
      // 曾只选了另一级别、未选当前已确认级别时，不跨级误套用
      delete board.pendingChoice
      syncedChoice = true
    }
  } else if (board.pendingChoice) {
    // 升级杯仍在进行：历史旧字段不再作为单一盲选，清空后交由 pendingChoicesByTier 按级别分别保存
    delete board.pendingChoice
    syncedChoice = true
  }

  const nextPreview: BoardOffseasonPreview = {
    nextSeasonIndex,
    projectedTier: projection.tier,
    confirmed: projection.confirmed,
    powerRank,
    totalClubs,
    budgetMultiplier,
    wageMultiplier,
    retentionRate,
    options,
    ...(promotionOptions ? { promotionOptions } : {}),
  }
  const prev = board.offseasonPreview
  const unchanged = !syncedChoice
    && !!prev
    && prev.nextSeasonIndex === nextPreview.nextSeasonIndex
    && prev.projectedTier === nextPreview.projectedTier
    && prev.confirmed === nextPreview.confirmed
    && prev.powerRank === nextPreview.powerRank
    && prev.totalClubs === nextPreview.totalClubs
    && prev.budgetMultiplier === nextPreview.budgetMultiplier
    && prev.wageMultiplier === nextPreview.wageMultiplier
    && prev.retentionRate === nextPreview.retentionRate
    && JSON.stringify(prev.options) === JSON.stringify(nextPreview.options)
    && JSON.stringify(prev.promotionOptions ?? null) === JSON.stringify(nextPreview.promotionOptions ?? null)
  if (unchanged) return false
  board.offseasonPreview = nextPreview
  return true
}

/* ---------- 玩家操作：选择目标档位 & 调整转会/工资帽滑块 ---------- */

export type BoardActionOutcome = { ok: boolean; error?: string }

/**
 * 选择或切换董事会目标档位：
 * - 休赛期（`season.finished` 或 `scope === 'offseason'`）：写入 `board.pendingChoice`，下赛季开赛生效；
 * - 开季第 1–3 轮（`scope === 'current'` 或当前赛季激活且未锁定）：按新旧档位差额精确调整余额与三项预算。
 */
export function isBoardTier(value: unknown): value is TierId {
  return value === 'division2' || value === 'division1' || value === 'champions'
}

export function chooseBoardAmbition(
  game: GameState,
  ambition: BoardAmbition,
  options: { scope?: 'offseason' | 'current'; tier?: TierId; lock?: boolean; committedAuctions?: number; clubId?: string; teamsById?: Record<string, AITeam> } = {},
): BoardActionOutcome {
  if (!isBoardAmbition(ambition)) return { ok: false, error: '无效的目标档位，请选择 safe / expected / ambitious' }
  const board = ensureBoard(game)
  syncBoardLockState(game)

  const useOffseason = options.scope === 'offseason' || (options.scope !== 'current' && !!game.season?.finished)
  if (useOffseason) {
    if (!game.season?.finished) return { ok: false, error: '当前尚未进入休赛期，无法预选下赛季目标' }
    refreshOffseasonBoardPreview(game, options.clubId, options.teamsById)
    const preview = board.offseasonPreview
    if (!preview) return { ok: false, error: '暂未生成休赛期目标方案' }
    if (!preview.confirmed) {
      const targetTier: TierId = options.tier ?? preview.projectedTier
      const allowed = new Set<TierId>([preview.projectedTier, ...(preview.promotionOptions?.length ? ['division1' as TierId] : [])])
      if (!allowed.has(targetTier)) {
        return { ok: false, error: '无效的休赛期预选级别，请分别为一级联赛或二级联赛方案选择' }
      }
      ;(board.pendingChoicesByTier ??= {})[targetTier] = ambition
      return { ok: true }
    }
    if (options.tier && options.tier !== preview.projectedTier) {
      return { ok: false, error: '下赛季联赛级别已确定，请选择对应级别的目标档位' }
    }
    board.pendingChoice = ambition
    ;(board.pendingChoicesByTier ??= {})[preview.projectedTier] = ambition
    return { ok: true }
  }

  if (!isBoardBudgetActive(game)) {
    return { ok: false, error: '当前赛季尚未启用董事会预算考核（第 2 赛季起生效，休赛期可提前预选下赛季目标）' }
  }
  const mandate = board.current!
  if (mandate.locked || (game.season?.round ?? 1) > BOARD_CHOICE_MAX_ROUND) {
    mandate.locked = true
    return { ok: false, error: `本赛季目标已锁定（仅第 1–${BOARD_CHOICE_MAX_ROUND} 轮可调整）` }
  }
  const picked = mandate.options.find((item) => item.ambition === ambition)
  if (!picked) return { ok: false, error: '找不到该档位方案' }

  if (mandate.ambition === ambition) {
    if (options.lock) mandate.locked = true
    return { ok: true }
  }

  const economy = economyOf(game)
  const transferDelta = picked.transferGrant - mandate.initialTransferBudget
  const facilityDelta = picked.facilityGrant - mandate.initialFacilityBudget
  const wageDelta = picked.wageCap - mandate.initialWageCap
  // 设施预算为独立专用资金池，不混入俱乐部余额；仅转会预算差额同步补退至余额。
  const cashDelta = transferDelta
  const committed = Math.max(0, options.committedAuctions ?? 0)

  const nextTransferBudget = mandate.transferBudget + transferDelta
  const nextFacilityBudget = mandate.facilityBudget + facilityDelta
  const nextWageCap = mandate.wageCap + wageDelta
  const nextBalance = economy.balance + cashDelta

  if (nextTransferBudget < committed) {
    return { ok: false, error: `无法下调至「${picked.label}」：已花费或竞拍占用的转会预算超出该档位额度` }
  }
  if (nextFacilityBudget < 0) {
    return { ok: false, error: `无法下调至「${picked.label}」：本季已花掉的设施预算超出该档位额度` }
  }
  if (nextBalance < 0) {
    return { ok: false, error: `无法下调至「${picked.label}」：俱乐部余额不足以退回差额 ${(-cashDelta).toLocaleString()}` }
  }
  const commercialBonus = boardCommercialWageBonus(economy)
  const currentBill = worldWageBill(game)
  const minAllowedWageCap = Math.round(picked.wageCap * 0.5)
  if (wageDelta < 0 && nextWageCap < minAllowedWageCap) {
    return { ok: false, error: `无法下调至「${picked.label}」：当前基础工资帽低于该档位最低下限` }
  }
  if (wageDelta < 0 && nextWageCap + commercialBonus < currentBill && mandate.wageCap + commercialBonus >= currentBill) {
    return { ok: false, error: `无法下调至「${picked.label}」：下调后有效工资帽 ${(nextWageCap + commercialBonus).toLocaleString()}/轮 低于当前全队工资 ${currentBill.toLocaleString()}/轮` }
  }

  economy.balance = nextBalance
  mandate.ambition = picked.ambition
  mandate.leagueTarget = picked.leagueTarget
  mandate.cupId = picked.cupId
  mandate.cupTarget = picked.cupTarget
  mandate.initialTransferBudget = picked.transferGrant
  mandate.transferBudget = nextTransferBudget
  mandate.initialFacilityBudget = picked.facilityGrant
  mandate.facilityBudget = nextFacilityBudget
  mandate.initialWageCap = picked.wageCap
  mandate.wageCap = nextWageCap
  mandate.meetBonus = picked.meetBonus
  mandate.exceedBonus = picked.exceedBonus
  if (options.lock) mandate.locked = true
  return { ok: true }
}

export type BoardSliderBounds = {
  /** 最小合法的 transferDelta（负值：把转会预算转成工资帽）。 */
  minTransferDelta: number
  /** 最大合法的 transferDelta（正值：把多余工资帽转成转会预算）。 */
  maxTransferDelta: number
  /** 最小合法的每轮工资帽变化量（与 maxTransferDelta 对应）。 */
  minWageDelta: number
  /** 最大合法的每轮工资帽变化量（与 minTransferDelta 对应）。 */
  maxWageDelta: number
  /** 当前全队每轮工资。 */
  currentWageBill: number
  /** 商业设施提供的额外每轮工资帽。 */
  commercialBonus: number
  /** 领先竞拍占用的转会预算。 */
  committedAuctions: number
}

/** 计算当前转会预算 ↔ 工资帽双向滑块的合法区间（绝不触碰设施预算）。 */
export function boardSliderBounds(game: GameState, committedAuctions = 0): BoardSliderBounds | null {
  if (!isBoardBudgetActive(game)) return null
  const mandate = game.board!.current!
  const economy = economyOf(game)
  const commercialBonus = boardCommercialWageBonus(economy)
  const currentWageBill = worldWageBill(game)
  const committed = Math.max(0, Math.round(committedAuctions))

  // 允许将多少转会预算转为工资帽（transferDelta < 0, wageDelta > 0）
  const maxTransferToWage = Math.max(0, mandate.transferBudget - committed)
  const maxWageIncrease = Math.floor(maxTransferToWage / BOARD_WAGE_SLIDER_ROUNDS)
  const minTransferDelta = -maxWageIncrease * BOARD_WAGE_SLIDER_ROUNDS

  // 允许将多少工资帽转为转会预算（transferDelta > 0, wageDelta < 0）
  const minBaseWageCap = Math.max(
    Math.round(mandate.initialWageCap * 0.5),
    Math.max(0, currentWageBill - commercialBonus),
  )
  const maxWageDecrease = Math.max(0, Math.floor(mandate.wageCap - minBaseWageCap))
  const maxTransferDelta = maxWageDecrease * BOARD_WAGE_SLIDER_ROUNDS

  return {
    minTransferDelta,
    maxTransferDelta,
    minWageDelta: -maxWageDecrease,
    maxWageDelta: maxWageIncrease,
    currentWageBill,
    commercialBonus,
    committedAuctions: committed,
  }
}

/**
 * 双向调整转会预算 ↔ 工资帽（38:1 严格整数可逆换算，绝不触碰设施预算与余额）：
 * - `transferDelta > 0`：降低基础工资帽，等额增加转会预算；
 * - `transferDelta < 0`：扣减转会预算，等额提高基础工资帽。
 */
export function adjustBoardBudgetSlider(
  game: GameState,
  transferDelta: number,
  committedAuctions = 0,
): BoardActionOutcome & { appliedTransferDelta?: number; appliedWageCapDelta?: number } {
  if (!isBoardBudgetActive(game)) {
    return { ok: false, error: '当前赛季尚未启用董事会预算系统（第 2 赛季起生效）' }
  }
  if (typeof transferDelta !== 'number' || !Number.isFinite(transferDelta) || !Number.isSafeInteger(transferDelta)) {
    return { ok: false, error: '调整额度必须是整数' }
  }
  if (transferDelta === 0) return { ok: true, appliedTransferDelta: 0, appliedWageCapDelta: 0 }

  const bounds = boardSliderBounds(game, committedAuctions)
  if (!bounds) return { ok: false, error: '预算滑块暂不可用' }

  // 以每轮工资帽整数变化量为准，严格按 38:1 换算，杜绝舍入套利
  const wageDelta = transferDelta > 0
    ? -Math.floor(transferDelta / BOARD_WAGE_SLIDER_ROUNDS)
    : Math.floor((-transferDelta) / BOARD_WAGE_SLIDER_ROUNDS)
  if (wageDelta === 0) {
    return { ok: false, error: `单次调整幅度需至少 ${BOARD_WAGE_SLIDER_ROUNDS}（对应每轮工资帽 ±1）` }
  }
  const appliedTransferDelta = -wageDelta * BOARD_WAGE_SLIDER_ROUNDS

  if (appliedTransferDelta < bounds.minTransferDelta) {
    return {
      ok: false,
      error: `可用转会预算不足：最多可将 ${(-bounds.minTransferDelta).toLocaleString()} 转会预算转为工资帽（+${bounds.maxWageDelta.toLocaleString()}/轮）`,
    }
  }
  if (appliedTransferDelta > bounds.maxTransferDelta) {
    return {
      ok: false,
      error: `超出工资帽下限：最多可将 ${(-bounds.minWageDelta).toLocaleString()}/轮 工资帽转为转会预算（+${bounds.maxTransferDelta.toLocaleString()}）`,
    }
  }

  const mandate = game.board!.current!
  mandate.transferBudget += appliedTransferDelta
  mandate.wageCap += wageDelta
  mandate.sliderShift += appliedTransferDelta
  return { ok: true, appliedTransferDelta, appliedWageCapDelta: wageDelta }
}

/* ---------- 赛季末考核 & 换季滚动 ---------- */

function scoreSeasonMandate(
  mandate: BoardSeasonMandate,
  leagueActual: number,
  totalTeams: number,
  cupActual: BoardCupStage,
  cupPresent: boolean,
  confidenceBefore: number,
): BoardEvaluation {
  // 1. 联赛得分（70% 权重）
  const relegated = mandate.tier !== 'division2' && leagueActual > totalTeams - 3
  const expectedRelegationAvoid = mandate.leagueTarget <= totalTeams - 3
  let leagueScore: number
  if (relegated && expectedRelegationAvoid) {
    leagueScore = 0
  } else if ((leagueActual === 1 && mandate.leagueTarget > 1) || leagueActual <= mandate.leagueTarget - 3) {
    leagueScore = 1.2
  } else if (leagueActual <= mandate.leagueTarget) {
    leagueScore = 1.0
  } else if (leagueActual <= mandate.leagueTarget + 2) {
    leagueScore = 0.65
  } else if (leagueActual <= mandate.leagueTarget + 5) {
    leagueScore = 0.30
  } else {
    leagueScore = 0.0
  }

  // 2. 杯赛得分（30% 权重；若本季未启用正式杯赛或杯赛未生成，按联赛权重 100% 评分）
  const targetStageRank = BOARD_CUP_STAGE_RANK[mandate.cupTarget]
  const actualStageRank = BOARD_CUP_STAGE_RANK[cupActual]
  let cupScore = 1.0
  if (targetStageRank === 0) {
    cupScore = actualStageRank >= 2 ? 1.2 : 1.0
  } else if (actualStageRank > targetStageRank) {
    cupScore = 1.2
  } else if (actualStageRank === targetStageRank) {
    cupScore = 1.0
  } else if (actualStageRank === targetStageRank - 1) {
    cupScore = 0.55
  } else {
    cupScore = 0.15
  }

  const totalScore = cupPresent ? leagueScore * 0.70 + cupScore * 0.30 : leagueScore
  let grade: BoardGrade
  let confidenceDelta: number
  let bonusPaid = 0
  const ambitious = mandate.ambition === 'ambitious'

  if (totalScore >= 1.10) {
    grade = 'S'
    confidenceDelta = ambitious ? 18 : 14
    bonusPaid = mandate.exceedBonus
  } else if (totalScore >= 0.90) {
    grade = 'A'
    confidenceDelta = ambitious ? 9 : 7
    bonusPaid = mandate.meetBonus
  } else if (totalScore >= 0.65) {
    grade = 'B'
    confidenceDelta = -4
  } else if (totalScore >= 0.40) {
    grade = 'C'
    confidenceDelta = ambitious ? -15 : -12
  } else {
    grade = 'D'
    confidenceDelta = ambitious ? -24 : -20
  }

  const confidenceAfter = clamp(confidenceBefore + confidenceDelta, BOARD_MIN_CONFIDENCE, BOARD_MAX_CONFIDENCE)
  const nextBudgetMultiplier = confidenceBudgetMultiplier(confidenceAfter, grade)
  const cupText = cupPresent
    ? `，${BOARD_CUP_LABELS[mandate.cupId]}目标「${BOARD_CUP_STAGE_LABELS[mandate.cupTarget]}」实际「${BOARD_CUP_STAGE_LABELS[cupActual]}」`
    : ''
  const bonusText = bonusPaid > 0 ? `，发放奖金 ${bonusPaid.toLocaleString()}` : ''
  const summary = `联赛目标前 ${mandate.leagueTarget} 实得第 ${leagueActual} 名${cupText} → ${BOARD_GRADE_META[grade].label}（信任度 ${confidenceBefore}→${confidenceAfter}${bonusText}，下季预算倍率 ${Math.round(nextBudgetMultiplier * 100)}%）`

  return {
    seasonIndex: mandate.seasonIndex,
    tier: mandate.tier,
    ambition: mandate.ambition,
    leagueTarget: mandate.leagueTarget,
    leagueActual,
    cupId: mandate.cupId,
    cupTarget: mandate.cupTarget,
    cupActual,
    grade,
    confidenceBefore,
    confidenceAfter,
    bonusPaid,
    nextBudgetMultiplier,
    summary,
  }
}

/** 休赛期只读预演本季最终考核（不写入历史、不发奖金）。 */
export function previewSeasonEvaluation(
  game: GameState,
  seasonCups: SeasonCups | undefined,
  clubId?: string,
): BoardEvaluation | null {
  if (!isBoardBudgetActive(game) || !game.season?.finished) return null
  const board = ensureBoard(game)
  const mandate = board.current!
  const finish = game.season.playerFinish
    ?? (() => {
      const idx = game.season.table.findIndex((row) => row.teamId === 'player' || (clubId && row.teamId === clubId))
      return idx >= 0 ? idx + 1 : game.season.table.length
    })()
  const ids = new Set<string>(['player'])
  if (clubId) ids.add(clubId)
  const squadKey = game.world?.clubs.find((club) => club.id === 'player')?.squadKey
  if (squadKey) ids.add(squadKey)
  const cupResult = evaluateClubCupStage(seasonCups, ids, mandate.cupId)
  return scoreSeasonMandate(mandate, finish, Math.max(1, game.season.table.length), cupResult.stage, cupResult.cupPresent, board.confidence)
}

export type OldBoardSeasonContext = {
  seasonIndex: number
  tier: TierId
  finish: number | null
  totalTeams: number
  seasonCups?: SeasonCups
  clubIds: string[]
}

/**
 * 换季结算董事会考核并开启新赛季董事会预算：
 * 1. 若上赛季存在激活的 `board.current`：评定 S/A/B/C/D、更新信任度、发放 S/A 奖金、写入 `board.history`；
 * 2. 新赛季 `seasonIndex >= 2` 时：按 `pendingChoice ?? 'expected'` 生成新赛季目标并直接向余额注入
 *    「独立转会预算 + 独立设施预算」，同步设定本季转会预算、设施预算与每轮工资帽。
 */
export function evaluateAndRollBoardSeason(
  game: GameState,
  oldContext: OldBoardSeasonContext,
  nextTeamsById?: Record<string, AITeam>,
): { evaluation?: BoardEvaluation; mandate?: BoardSeasonMandate } {
  const board = ensureBoard(game)
  const economy = economyOf(game)
  let evaluation: BoardEvaluation | undefined

  if (board.current && board.current.seasonIndex === oldContext.seasonIndex) {
    const mandate = board.current
    const leagueActual = oldContext.finish && oldContext.finish > 0
      ? oldContext.finish
      : Math.max(1, oldContext.totalTeams)
    const cupResult = evaluateClubCupStage(oldContext.seasonCups, oldContext.clubIds, mandate.cupId)
    evaluation = scoreSeasonMandate(
      mandate,
      leagueActual,
      Math.max(1, oldContext.totalTeams),
      cupResult.stage,
      cupResult.cupPresent,
      board.confidence,
    )
    board.confidence = evaluation.confidenceAfter
    board.lastGrade = evaluation.grade
    if (evaluation.bonusPaid > 0 && Number.isSafeInteger(economy.balance + evaluation.bonusPaid)) {
      economy.balance += evaluation.bonusPaid
    }
    board.history = [evaluation, ...board.history.filter((entry) => entry.seasonIndex !== evaluation!.seasonIndex)].slice(0, BOARD_HISTORY_LIMIT)
  }

  const nextSeasonIndex = game.season?.index ?? 1
  delete board.offseasonPreview
  if (nextSeasonIndex < 2) {
    delete board.current
    delete board.pendingChoice
    delete board.pendingChoicesByTier
    return { evaluation }
  }

  const nextTier: TierId = game.season?.tier ?? 'division2'
  const { powerRank, totalClubs } = estimateDivisionPowerRank(game, nextTier, nextTeamsById)
  const options = buildBoardGoalOptions(nextTier, powerRank, totalClubs, board.confidence, board.lastGrade)
  const tierSpecific = board.pendingChoicesByTier?.[nextTier]
  const chosenAmbition: BoardAmbition = isBoardAmbition(tierSpecific)
    ? tierSpecific
    : isBoardAmbition(board.pendingChoice)
      ? board.pendingChoice
      : 'expected'
  const picked = options.find((item) => item.ambition === chosenAmbition) ?? options[1] ?? options[0]
  const retentionRate = transferRetentionRate(board.confidence)

  // 转会预算直接注入俱乐部余额；设施预算作为独立专用池发放，与俱乐部余额互不冲突
  if (Number.isSafeInteger(economy.balance + picked.transferGrant)) {
    economy.balance += picked.transferGrant
  }

  const mandate: BoardSeasonMandate = {
    seasonIndex: nextSeasonIndex,
    tier: nextTier,
    powerRank,
    totalClubs,
    ambition: picked.ambition,
    leagueTarget: picked.leagueTarget,
    cupId: picked.cupId,
    cupTarget: picked.cupTarget,
    initialTransferBudget: picked.transferGrant,
    transferBudget: picked.transferGrant,
    initialFacilityBudget: picked.facilityGrant,
    facilityBudget: picked.facilityGrant,
    initialWageCap: picked.wageCap,
    wageCap: picked.wageCap,
    retentionRate,
    sliderShift: 0,
    meetBonus: picked.meetBonus,
    exceedBonus: picked.exceedBonus,
    locked: false,
    options,
  }
  board.current = mandate
  delete board.pendingChoice
  delete board.pendingChoicesByTier
  return { evaluation, mandate }
}

/** 构造旧赛季上下文（供联机 advanceSharedAccountSeason 使用）。 */
export function oldBoardContextFromWorld(oldWorld: WorldState, clubId: string): OldBoardSeasonContext {
  const division = oldWorld.divisions.find((item) => item.clubIds?.includes(clubId) || item.clubIds?.includes('player'))
  const table = division?.table ?? []
  const finishIndex = table.findIndex((row) => row.teamId === clubId || row.teamId === 'player')
  const clubIds = [...new Set([clubId, 'player'])]
  return {
    seasonIndex: oldWorld.seasonIndex,
    tier: division?.tier ?? 'division2',
    finish: finishIndex >= 0 ? finishIndex + 1 : null,
    totalTeams: table.length || 20,
    seasonCups: oldWorld.seasonCups,
    clubIds,
  }
}

/** 构造旧赛季上下文（供单机 advanceWorldSeason 使用，需在 promoteAndRelegate / delete seasonCups 前调用）。 */
export function oldBoardContextFromSeason(season: SeasonState, world: WorldState): OldBoardSeasonContext {
  const squadKey = world.clubs.find((club) => club.id === 'player')?.squadKey
  const clubIds = [...new Set(['player', ...(squadKey ? [squadKey] : [])])]
  const finish = season.playerFinish
    ?? (() => {
      const idx = season.table.findIndex((row) => row.teamId === 'player')
      return idx >= 0 ? idx + 1 : null
    })()
  return {
    seasonIndex: season.index,
    tier: season.tier ?? 'division2',
    finish,
    totalTeams: season.table.length || 20,
    seasonCups: world.seasonCups,
    clubIds,
  }
}
