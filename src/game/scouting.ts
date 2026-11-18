import { ALL_ATTRIBUTES, GK_ATTRIBUTES, POSITIONS, type Attributes, type DetailedPositionTable, type GameState, type Player, type PositionTable } from './types.ts'
import { GAME_DAY_MS } from './calendar.ts'
import { economyOf } from './economy.ts'
import { derivedRng } from './rng.ts'
import { isMainAttr } from './scale.ts'

export type ScoutLevel = 1 | 2 | 3 | 4 | 5
export type ScoutSource = 'club' | 'transfer' | 'market'
export type ScoutTarget = { source: ScoutSource; clubId?: string }
export type ScoutReport = {
  id: string; playerId: string; playerName: string; source: ScoutSource; clubId?: string
  level: ScoutLevel; fee: number; startedAt: number; readyAt: number
  positions: PositionTable; detailedPositions?: DetailedPositionTable; isGk: boolean
  estimatedAttrs: Attributes; snapshotLabel: string
}

/** 球探耗时：days 为内部 2h 基准倍率，hours 为展示用现实小时数（8h / 6h / 4h / 2h / 1h）。 */
export const SCOUT_LEVELS: readonly { level: ScoutLevel; fee: number; days: number; hours: number; maxError: number }[] = [
  { level: 1, fee: 1000, days: 4, hours: 8, maxError: 5 },
  { level: 2, fee: 3000, days: 3, hours: 6, maxError: 4 },
  { level: 3, fee: 6000, days: 2, hours: 4, maxError: 3 },
  { level: 4, fee: 12000, days: 1, hours: 2, maxError: 2 },
  { level: 5, fee: 20000, days: 0.5, hours: 1, maxError: 1 },
]
/** 自由市场考察完成后保留时长倍率：6 × 2h = 现实 12 小时。 */
export const SCOUT_MARKET_GRACE_UNITS = 6
export function scoutMarketGraceMs(gameDayMs = GAME_DAY_MS): number {
  return Math.round(SCOUT_MARKET_GRACE_UNITS * gameDayMs)
}
/** Total stored reports, including completed reports. No reports are silently deleted. */
export const MAX_SCOUT_REPORTS = 500

/** 删除只针对当前存档且到期的报告，不返还费用。 */
export function deleteScoutReport(game: GameState, reportId: unknown, now: number): { ok: boolean; error?: string } {
  if (typeof reportId !== 'string' || !reportId || !Number.isSafeInteger(now) || now < 0 || !Array.isArray(game.scoutReports)) return { ok: false, error: '报告或时间无效' }
  const report = game.scoutReports.find(r => r.id === reportId)
  if (!report) return { ok: false, error: '报告不存在' }
  if (!Number.isFinite(report.readyAt) || report.readyAt > now) return { ok: false, error: '进行中的报告不能删除' }
  game.scoutReports = game.scoutReports.filter(r => r.id !== reportId)
  return { ok: true }
}

export function startScouting(game: GameState, player: Player, target: ScoutTarget, level: unknown, now: number): { ok: boolean; error?: string; report?: ScoutReport } {
  const fail = (error: string) => ({ ok: false, error })
  const config = SCOUT_LEVELS.find(item => item.level === level)
  if (!config) return fail('球探等级无效')
  if (!game || !Number.isSafeInteger(game.seed) || !Array.isArray(game.roster)) return fail('存档无效')
  const gameDayMs = game.season?.gameDayMs ?? GAME_DAY_MS
  const durationMs = Math.round(config.days * gameDayMs)
  if (!Number.isSafeInteger(gameDayMs) || gameDayMs <= 0 || durationMs <= 0 || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + durationMs)) return fail('时间无效')
  if (!player || typeof player.id !== 'string' || !player.id.trim() || typeof player.name !== 'string' || !player.attrs || !player.positions) return fail('球员无效')
  if (game.roster.some(own => own.id === player.id)) return fail('不能考察本队球员')
  if (!target || !['club', 'transfer', 'market'].includes(target.source) || (target.clubId !== undefined && (typeof target.clubId !== 'string' || !target.clubId.trim()))) return fail('目标无效')
  const clubId = target.clubId?.trim()
  if (target.source === 'club' && !clubId) return fail('俱乐部目标缺少俱乐部 ID')
  const reports = game.scoutReports ?? []
  if (!Array.isArray(reports) || reports.length >= MAX_SCOUT_REPORTS) return fail('球探报告已满或无效')
  if (reports.some(r => r && r.source === target.source && (r.clubId?.trim() || undefined) === clubId && r.playerId === player.id && r.readyAt > now)) return fail('已有未完成的球探报告')
  if (!POSITIONS.every(key => Number.isFinite(player.positions[key]) && player.positions[key] >= 0 && player.positions[key] <= 100)) return fail('位置无效')
  const isGk = player.positions.GK > 0
  if (!ALL_ATTRIBUTES.every(key => Number.isFinite(player.attrs[key]) && player.attrs[key] >= 0 && (isMainAttr(key, isGk) || (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) || player.attrs[key] <= 20))) return fail('属性无效')
  const detached = { ...game, economy: game.economy && { ...game.economy } }
  const economy = economyOf(detached)
  if (!Number.isSafeInteger(economy.balance) || economy.balance < config.fee) return fail('余额不足或无效')
  const snapshot = ALL_ATTRIBUTES.map(key => player.attrs[key])
  const rng = derivedRng(game.seed, JSON.stringify([player.id, target.source, clubId ?? null, config.level, player.version ?? 0, isGk, snapshot]))
  const estimatedAttrs = {} as Attributes
  for (const key of ALL_ATTRIBUTES) {
    const value = player.attrs[key]
    if (!isGk && (GK_ATTRIBUTES as readonly string[]).includes(key)) estimatedAttrs[key] = 0
    else if (isMainAttr(key, isGk)) estimatedAttrs[key] = value
    else {
      const min = Math.max(0, Math.ceil(value - config.maxError))
      const max = Math.min(20, Math.floor(value + config.maxError))
      estimatedAttrs[key] = min + rng.int(max - min + 1)
    }
  }
  const ledger = game as GameState & { scoutReportSeq?: number }
  const sequence = Number.isSafeInteger(ledger.scoutReportSeq) && (ledger.scoutReportSeq ?? 0) >= 0 ? ledger.scoutReportSeq! + 1 : 1
  if (!Number.isSafeInteger(sequence)) return fail('球探报告编号已耗尽')
  const report: ScoutReport = {
    id: `scout-seq-${game.seed}-${now}-${sequence}`, playerId: player.id, playerName: player.name,
    source: target.source, ...(clubId ? { clubId } : {}), level: config.level, fee: config.fee,
    startedAt: now, readyAt: now + durationMs,
    positions: { ...player.positions }, ...(player.detailedPositions ? { detailedPositions: { ...player.detailedPositions } } : {}),
    isGk, estimatedAttrs, snapshotLabel: player.version > 0 ? `装备版本 v${player.version}` : '原始版本',
  }
  economy.balance -= config.fee
  game.economy = economy
  ledger.scoutReportSeq = sequence
  game.scoutReports = [...reports, report]
  return { ok: true, report }
}

/** 市场考察从开始到报告完成后 12 小时内有效；只影响仍在市场池中的球员。 */
export function scoutKeepsOnMarket(game: Pick<GameState, 'scoutReports' | 'season'>, playerId: string, now: number): boolean {
  const day = game.season?.gameDayMs ?? GAME_DAY_MS
  if (!Number.isFinite(now) || !Number.isSafeInteger(day) || day <= 0 || !Array.isArray(game.scoutReports)) return false
  const grace = scoutMarketGraceMs(day)
  return game.scoutReports.some(r => r?.source === 'market' && r.playerId === playerId &&
    Number.isFinite(r.startedAt) && Number.isFinite(r.readyAt) && r.startedAt <= now && now < r.readyAt + grace)
}

/** Pending reports intentionally have no position data or estimates. All returned objects are detached. */
export type VisibleScoutReport = ScoutReport | Omit<ScoutReport, 'positions' | 'detailedPositions' | 'estimatedAttrs' | 'isGk'>
export function visibleScoutReports(game: GameState, now: number): VisibleScoutReport[] {
  if (!Array.isArray(game.scoutReports)) return []
  return game.scoutReports.map(report => {
    const { positions, detailedPositions, estimatedAttrs, isGk, ...metadata } = report
    if (!Number.isFinite(now) || now < report.readyAt) return metadata
    return { ...metadata, positions: { ...positions }, ...(detailedPositions ? { detailedPositions: { ...detailedPositions } } : {}), estimatedAttrs: { ...estimatedAttrs }, isGk }
  })
}
