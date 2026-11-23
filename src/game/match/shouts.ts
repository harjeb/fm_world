import type {
  AttrKey,
  MatchLogEntry,
  MatchShoutRecord,
  PlayerShoutState,
  ScheduledMatchShout,
  ShoutKind,
  ShoutMood,
} from '../types.ts'
import { derivedRng } from '../rng.ts'
import { performanceRating } from './performance.ts'
import { opponentSide } from './team.ts'
import type { MatchPlayerState, MatchSide, MatchState, MatchTeamState } from './types.ts'

/** FM27 重做版 8 种情绪喊话常量与元数据。 */
export const SHOUT_COOLDOWN_MINUTES = 12
export const SHOUT_DURATION_MINUTES = 15
export const SHOUT_MAX_PER_MATCH = 6
/** 联机 10 分钟直播喊话截止分钟（85 分钟后锁止，留出最后窗口给服务器完成重算，确保到点公布完全一致）。 */
export const SHOUT_LIVE_CUTOFF_MINUTE = 85

export type ShoutDef = {
  id: ShoutKind
  label: string
  enLabel: string
  shortDesc: string
  hint: string
  targetAttrs: AttrKey[]
  tone: 'positive' | 'aggressive' | 'calm'
}

export const SHOUT_KINDS: readonly ShoutKind[] = [
  'encourage',
  'praise',
  'demand_more',
  'fire_up',
  'focus',
  'calm_down',
  'no_pressure',
  'berate',
] as const

export const SHOUT_META: Record<ShoutKind, ShoutDef> = {
  encourage: {
    id: 'encourage',
    label: '鼓励',
    enLabel: 'Encourage',
    shortDesc: '平局或落后时稳军心、提士气',
    hint: '适合平局、落后 1–2 球或开局低迷；大比分领先时容易无感或松懈。',
    targetAttrs: ['composure', 'decisions', 'teamwork', 'passing', 'offBall'],
    tone: 'positive',
  },
  praise: {
    id: 'praise',
    label: '表扬',
    enLabel: 'Praise',
    shortDesc: '领先或高分表现时巩固火热手感',
    hint: '适合领先或单名球员评分 ≥ 7.0；落后或发挥不佳时表扬会引起困惑不满。',
    targetAttrs: ['composure', 'shooting', 'passing', 'firstTouch', 'dribbling', 'vision'],
    tone: 'positive',
  },
  demand_more: {
    id: 'demand_more',
    label: '要求更多',
    enLabel: 'Demand More',
    shortDesc: '平局或占优打不开局面时施压提强度',
    hint: '适合平局/落后、高职业高斗志球员；大比分领先或对已高分球员施压易引发压力。',
    targetAttrs: ['offBall', 'tackling', 'decisions', 'acceleration', 'shooting', 'passing'],
    tone: 'aggressive',
  },
  fire_up: {
    id: 'fire_up',
    label: '点燃斗志',
    enLabel: 'Fire Up',
    shortDesc: '发闷或急需反扑时短时高爆发（微增体耗）',
    hint: '高风险高回报，适合落后/下半场反扑；吃黄牌或已紧绷球员容易急躁失误。',
    targetAttrs: ['acceleration', 'speed', 'shooting', 'tackling', 'strength', 'offBall'],
    tone: 'aggressive',
  },
  focus: {
    id: 'focus',
    label: '保持专注',
    enLabel: 'Focus',
    shortDesc: '领先守胜果、刚进/丢球后防走神',
    hint: '适合领先守局、70 分钟后或刚发生进球/丢球；大比分落后急需进攻时效果差。',
    targetAttrs: ['defPos', 'anticipation', 'tackling', 'decisions', 'reflexes', 'handling', 'composure'],
    tone: 'calm',
  },
  calm_down: {
    id: 'calm_down',
    label: '冷静下来',
    enLabel: 'Calm Down',
    shortDesc: '吃黄牌、刚进球或防线慌乱时稳住情绪',
    hint: '对身背黄牌、倍感压力或 1 球领先防线极佳；大比分落后且死气沉沉时会泄气。',
    targetAttrs: ['composure', 'passing', 'firstTouch', 'decisions', 'defPos', 'handling'],
    tone: 'calm',
  },
  no_pressure: {
    id: 'no_pressure',
    label: '卸下包袱',
    enLabel: 'No Pressure',
    shortDesc: '消除压力/紧张情绪，解放年轻或受压球员',
    hint: '适合消除负面压力、关键战/落后紧绷或年轻球员；大比分领先时容易变散漫。',
    targetAttrs: ['composure', 'dribbling', 'shooting', 'firstTouch', 'vision', 'reflexes'],
    tone: 'calm',
  },
  berate: {
    id: 'berate',
    label: '严厉斥责',
    enLabel: 'Berate',
    shortDesc: '大比分落后或表现惨淡时开「吹风机」',
    hint: '落后 ≥2 球或个人评分 < 6.0 时可骂醒高职业球员爆发；发挥正常时乱骂会心态崩盘。',
    targetAttrs: ['shooting', 'tackling', 'acceleration', 'decisions', 'offBall', 'composure', 'reflexes'],
    tone: 'aggressive',
  },
}

export const SHOUT_LIST: readonly ShoutDef[] = SHOUT_KINDS.map((id) => SHOUT_META[id])

export type ShoutMoodMeta = {
  id: ShoutMood
  label: string
  shortLabel: string
  icon: string
  tone: 'positive' | 'neutral' | 'negative'
  bubbleColor: string
}

export const SHOUT_MOOD_META: Record<ShoutMood, ShoutMoodMeta> = {
  inspired: { id: 'inspired', label: '受到鼓舞', shortLabel: '受鼓舞', icon: '✨', tone: 'positive', bubbleColor: '#36c97f' },
  fired_up: { id: 'fired_up', label: '斗志高昂', shortLabel: '斗志燃', icon: '🔥', tone: 'positive', bubbleColor: '#f2b84b' },
  focused: { id: 'focused', label: '全神贯注', shortLabel: '专注', icon: '🎯', tone: 'positive', bubbleColor: '#4da3ff' },
  composed: { id: 'composed', label: '情绪稳定', shortLabel: '冷静', icon: '🧊', tone: 'positive', bubbleColor: '#5ad1c4' },
  unmoved: { id: 'unmoved', label: '无动于衷', shortLabel: '无感', icon: '😶', tone: 'neutral', bubbleColor: '#8d99a6' },
  confused: { id: 'confused', label: '略感困惑', shortLabel: '困惑', icon: '❓', tone: 'negative', bubbleColor: '#e89d45' },
  pressured: { id: 'pressured', label: '倍感压力', shortLabel: '压力', icon: '😰', tone: 'negative', bubbleColor: '#e56b5b' },
  frustrated: { id: 'frustrated', label: '情绪低落', shortLabel: '低落', icon: '💢', tone: 'negative', bubbleColor: '#dc4545' },
}

export function isShoutKind(value: unknown): value is ShoutKind {
  return typeof value === 'string' && Object.hasOwn(SHOUT_META, value)
}

export function shoutDurationSeconds(durationSeconds: number): number {
  return Math.max(10, Math.round((durationSeconds * SHOUT_DURATION_MINUTES) / 90))
}

export function shoutCooldownSeconds(durationSeconds: number): number {
  return Math.max(10, Math.round((durationSeconds * SHOUT_COOLDOWN_MINUTES) / 90))
}

export function shoutLiveCutoffSeconds(durationSeconds: number): number {
  return Math.round((durationSeconds * SHOUT_LIVE_CUTOFF_MINUTE) / 90)
}

export function matchMinuteOf(clock: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 0
  return Math.max(0, Math.min(90, Math.floor((clock / durationSeconds) * 90)))
}

export type ShoutStatus = {
  used: number
  max: number
  cooldownRemainingMinutes: number
  canShout: boolean
  reason?: string
}

/** 统一计算某一方当前是否可以喊话（实时赛与联机直播通用）。 */
export function shoutStatusOf(
  team: Pick<MatchTeamState, 'shoutsUsed' | 'shoutCooldownUntil'>,
  clock: number,
  durationSeconds: number,
  options?: { finished?: boolean; preplayed?: boolean },
): ShoutStatus {
  const used = team.shoutsUsed ?? 0
  const max = SHOUT_MAX_PER_MATCH
  const minute = matchMinuteOf(clock, durationSeconds)
  if (options?.finished) {
    return { used, max, cooldownRemainingMinutes: 0, canShout: false, reason: '比赛已结束' }
  }
  if (options?.preplayed && minute >= SHOUT_LIVE_CUTOFF_MINUTE) {
    return { used, max, cooldownRemainingMinutes: 0, canShout: false, reason: `${SHOUT_LIVE_CUTOFF_MINUTE} 分钟后已锁止（等待终场结算）` }
  }
  if (used >= max) {
    return { used, max, cooldownRemainingMinutes: 0, canShout: false, reason: `本场 ${max} 次喊话已用完` }
  }
  const cooldownUntil = team.shoutCooldownUntil ?? 0
  if (clock < cooldownUntil) {
    const remainingSec = cooldownUntil - clock
    const remainingMin = Math.max(1, Math.ceil((remainingSec / Math.max(1, durationSeconds)) * 90))
    return { used, max, cooldownRemainingMinutes: remainingMin, canShout: false, reason: `冷却中（约 ${remainingMin} 分钟后可用）` }
  }
  return { used, max, cooldownRemainingMinutes: 0, canShout: true }
}

/** 仅依据实时统计给出粗略个人评分（兼容比赛进行中 minutes 尚未最终结算的情况）。 */
export function livePlayerRating(player: MatchPlayerState, minute: number): number {
  const played = Math.max(1, minute - (player.stats.onMinute ?? 0))
  const direct = performanceRating({
    ...player.stats,
    minutes: Math.max(player.stats.minutes || 0, played),
    yellowCards: player.yellowCards,
    redCards: player.sentOff ? 1 : 0,
  })
  if (direct !== undefined) return direct
  const base = 6.3 + player.stats.goals * 0.8 + (player.stats.assists ?? 0) * 0.5 + (player.stats.saves ?? 0) * 0.1 - player.yellowCards * 0.2
  return Math.round(Math.max(4.5, Math.min(9.8, base)) * 10) / 10
}

function recentGoalContext(log: MatchLogEntry[], clock: number, durationSeconds: number, side: MatchSide): { recentScored: boolean; recentConceded: boolean } {
  const windowSec = (durationSeconds * 10) / 90
  let recentScored = false
  let recentConceded = false
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]
    if (clock - entry.clock > windowSec) break
    if (entry.type !== 'goal') continue
    if (entry.team === side) recentScored = true
    else if (entry.team === opponentSide(side)) recentConceded = true
  }
  return { recentScored, recentConceded }
}

export function resolveShoutTarget(team: MatchTeamState, targetPlayerId?: string): MatchPlayerState | undefined {
  if (!targetPlayerId) return undefined
  return team.players.find((p) => p.onPitch && !p.sentOff && (p.id === targetPlayerId || p.sourceId === targetPlayerId))
}

export function evaluateShoutReactions(params: {
  seed: number
  clock: number
  durationSeconds: number
  score: { home: number; away: number }
  log: MatchLogEntry[]
  side: MatchSide
  kind: ShoutKind
  team: MatchTeamState
  targetPlayerId?: string
  knockout?: boolean
  auto?: boolean
}): {
  record: MatchShoutRecord
  states: Map<string, PlayerShoutState>
} {
  const { seed, clock, durationSeconds, score, log, side, kind, team, targetPlayerId, knockout, auto } = params
  const def = SHOUT_META[kind]
  const minute = matchMinuteOf(clock, durationSeconds)
  const myScore = score[side]
  const oppScore = score[opponentSide(side)]
  const scoreDiff = myScore - oppScore
  const { recentScored, recentConceded } = recentGoalContext(log, clock, durationSeconds, side)
  const duration = shoutDurationSeconds(durationSeconds)
  const expiresAt = Math.min(durationSeconds, clock + duration)

  const targeted = !!targetPlayerId
  const targets = targeted
    ? team.players.filter((p) => p.onPitch && !p.sentOff && (p.id === targetPlayerId || p.sourceId === targetPlayerId))
    : team.players.filter((p) => p.onPitch && !p.sentOff)

  const states = new Map<string, PlayerShoutState>()
  const reactions: MatchShoutRecord['reactions'] = []
  let positiveCount = 0
  let neutralCount = 0
  let negativeCount = 0
  const clockBucket = Math.floor(clock)

  for (const player of targets) {
    const prof = (player.personality?.professionalism ?? 70) / 100
    const amb = (player.personality?.ambition ?? 70) / 100
    const adap = (player.personality?.adaptability ?? 70) / 100
    const rating = livePlayerRating(player, Math.max(1, minute))
    const staminaRatio = player.maxStamina > 0 ? player.stamina / player.maxStamina : 1
    const prevMood = player.shoutState && clock < player.shoutState.expiresAt ? player.shoutState.mood : undefined
    const prevNegative = prevMood === 'pressured' || prevMood === 'frustrated' || prevMood === 'confused'
    const rng = derivedRng(seed, 'shout', clockBucket, side, kind, player.id)
    const jitter = (rng.float() - 0.5) * 1.1 // [-0.55, +0.55]

    // 1. 按 FM27 逻辑评估「适配分」suitability（正值越大反应越积极，负值触发反效果）
    let suit = 0
    let posMood: ShoutMood = 'inspired'
    let negMood: ShoutMood = 'confused'

    switch (kind) {
      case 'encourage': {
        posMood = 'inspired'
        negMood = 'confused'
        if (scoreDiff === 0) suit += 1.5
        else if (scoreDiff === -1) suit += 2.1
        else if (scoreDiff === -2) suit += 1.2
        else if (scoreDiff <= -3) suit += 0.2
        else if (scoreDiff === 1) suit += minute >= 70 ? 0.3 : -0.4
        else suit -= 1.8 // 大比分领先时鼓励容易显得多余/松懈
        if (recentConceded) suit += 1.0
        if (rating < 6.4) suit += 0.7
        if (prevNegative) suit += 0.8
        suit += (adap - 0.65) * 1.4
        break
      }
      case 'praise': {
        posMood = 'inspired'
        negMood = 'confused'
        if (scoreDiff >= 2) suit += 2.4
        else if (scoreDiff === 1) suit += 1.4
        else if (scoreDiff === 0) suit += rating >= 7.1 ? 1.1 : -0.9
        else suit -= 2.3 // 落后还表扬容易被觉得讽刺
        if (rating >= 7.2 || player.stats.goals > 0 || (player.stats.assists ?? 0) > 0) suit += 1.4
        else if (rating < 6.2) suit -= 1.2
        if (prevMood === 'frustrated') suit -= 0.6
        suit += (amb - 0.65) * 0.9
        break
      }
      case 'demand_more': {
        posMood = 'fired_up'
        negMood = 'pressured'
        if (scoreDiff === 0 && minute >= 15) suit += 1.5
        else if (scoreDiff === -1) suit += 1.8
        else if (scoreDiff <= -2) suit += 0.9
        else if (scoreDiff === 1) suit -= 0.7
        else suit -= 2.0 // 大胜时还施压
        if (rating < 6.6) suit += 0.9
        else if (rating >= 7.4 || player.stats.goals > 0) suit -= 1.5 // 踢得很好还被要求更多
        if (prevMood === 'pressured' || prevMood === 'frustrated') suit -= 1.3
        suit += (prof - 0.65) * 2.2 + (amb - 0.65) * 1.8
        break
      }
      case 'fire_up': {
        posMood = 'fired_up'
        negMood = 'pressured'
        if (scoreDiff <= 0) suit += 1.4
        else if (scoreDiff === 1 && minute >= 70) suit += 0.4
        else suit -= 1.5
        if (minute >= 45) suit += 0.6
        if (staminaRatio < 0.75) suit += 0.5
        if (player.yellowCards > 0) {
          suit -= 1.9 // 吃黄牌再点火容易急躁失控
          negMood = 'frustrated'
        }
        if (prevMood === 'pressured' || prevMood === 'frustrated') suit -= 1.4
        suit += (amb - 0.65) * 2.4
        break
      }
      case 'focus': {
        posMood = 'focused'
        negMood = 'pressured'
        if (scoreDiff === 1) suit += 2.0
        else if (scoreDiff === 2) suit += 1.5
        else if (scoreDiff === 0 && minute >= 65) suit += 1.1
        else if (scoreDiff <= -2) suit -= 1.6
        if (recentScored || recentConceded) suit += 1.2
        if (minute >= 65) suit += 0.8
        if (player.position === 'CB' || player.position === 'GK') suit += 0.5
        if (prevMood === 'focused') suit -= 0.9
        suit += (prof - 0.65) * 1.8
        break
      }
      case 'calm_down': {
        posMood = 'composed'
        negMood = 'confused'
        if (player.yellowCards > 0) suit += 2.5 // 黄牌球员最吃「冷静下来」
        if (prevMood === 'pressured' || prevMood === 'frustrated') suit += 2.0
        if (scoreDiff === 1) suit += 1.5
        else if (scoreDiff === 0 && recentScored) suit += 1.2
        else if (scoreDiff <= -2 && player.yellowCards === 0 && !prevNegative) suit -= 1.8
        if (recentScored) suit += 1.0
        suit += (adap - 0.65) * 1.4
        break
      }
      case 'no_pressure': {
        posMood = 'composed'
        negMood = 'confused'
        if (prevMood === 'pressured' || prevMood === 'frustrated') suit += 2.6
        if ((player.age ?? 26) <= 22) suit += 1.2
        if (knockout) suit += 0.8
        if (scoreDiff <= 0 && rating <= 6.5) suit += 1.1
        else if (scoreDiff >= 2) suit -= 1.7
        if (amb > 0.82 && scoreDiff >= 1) suit -= 0.9
        suit += (adap - 0.65) * 1.2
        break
      }
      case 'berate': {
        posMood = 'fired_up'
        negMood = 'frustrated'
        if (scoreDiff <= -2) suit += 1.9
        else if (scoreDiff === -1 && minute >= 55 && rating <= 6.3) suit += 1.2
        else if (scoreDiff === 0 && rating < 6.0) suit += 0.9
        else if (scoreDiff >= 1) suit -= 3.2 // 领先还骂直接炸裂
        else suit -= 1.4
        if (rating < 6.0) suit += 1.5
        else if (rating >= 7.0 || player.stats.goals > 0) suit -= 2.4
        // 吹风机高度看职业与雄心：高职业会被骂醒，低职业/低适应容易彻底崩
        suit += (prof - 0.68) * 3.0 + (amb - 0.68) * 2.0 + (adap - 0.65) * 1.2
        break
      }
    }

    const total = suit + jitter
    let mood: ShoutMood
    let delta: number

    if (total >= 0.45) {
      mood = posMood
      const strength = Math.min(1, (total - 0.45) / 2.2)
      const isBurst = kind === 'berate' || kind === 'fire_up'
      if (targeted) {
        delta = isBurst ? 7.2 + strength * 2.8 : 6.0 + strength * 2.5
      } else {
        delta = isBurst ? 4.4 + strength * 1.8 : 3.6 + strength * 1.6
      }
      positiveCount++
    } else if (total > -0.55) {
      mood = 'unmoved'
      delta = 0
      neutralCount++
    } else {
      mood = negMood
      const severity = Math.min(1, (-0.55 - total) / 2.2)
      const isHarsh = kind === 'berate' || negMood === 'frustrated'
      if (targeted) {
        delta = -(isHarsh ? 4.0 + severity * 1.5 : 3.2 + severity * 1.3)
      } else {
        delta = -(isHarsh ? 2.8 + severity * 1.4 : 2.1 + severity * 1.1)
      }
      negativeCount++
    }

    delta = Math.round(delta * 10) / 10
    const staminaDrainMul = kind === 'fire_up' && delta > 0 ? 1.08 : 1
    states.set(player.id, {
      kind,
      mood,
      delta,
      attrs: [...def.targetAttrs],
      appliedAt: clock,
      expiresAt,
      ...(targeted ? { targeted: true } : {}),
      ...(staminaDrainMul > 1 ? { staminaDrainMul } : {}),
    })
    reactions.push({
      playerId: player.id,
      sourceId: player.sourceId,
      name: player.name,
      mood,
      delta,
    })
  }

  const targetPlayer = targeted ? targets[0] : undefined
  const dugoutFeedback = buildDugoutFeedback(kind, targetPlayer?.name, reactions, positiveCount, neutralCount, negativeCount)
  const record: MatchShoutRecord = {
    clock: Math.floor(clock * 10) / 10,
    minute,
    side,
    kind,
    ...(targetPlayer ? { targetPlayerId: targetPlayer.sourceId, targetName: targetPlayer.name } : {}),
    ...(auto ? { auto: true } : {}),
    positiveCount,
    neutralCount,
    negativeCount,
    dugoutFeedback,
    reactions,
  }
  return { record, states }
}

function buildDugoutFeedback(
  kind: ShoutKind,
  targetName: string | undefined,
  reactions: MatchShoutRecord['reactions'],
  positiveCount: number,
  neutralCount: number,
  negativeCount: number,
): string {
  const label = SHOUT_META[kind].label
  if (targetName && reactions.length === 1) {
    const r = reactions[0]
    const moodMeta = SHOUT_MOOD_META[r.mood]
    if (r.delta > 0) return `助教：向 ${targetName} 喊出「${label}」，他明显${moodMeta.label}（关键状态 +${r.delta.toFixed(1)}）。`
    if (r.delta < 0) return `助教：向 ${targetName} 喊出「${label}」适得其反，他显得${moodMeta.label}（${r.delta.toFixed(1)}）。`
    return `助教：向 ${targetName} 喊出「${label}」，他看起来${moodMeta.label}。`
  }
  const negNames = reactions.filter((r) => r.delta < 0).slice(0, 2).map((r) => r.name)
  const posNames = reactions.filter((r) => r.delta > 0).slice(0, 2).map((r) => r.name)
  const parts: string[] = []
  if (positiveCount > 0) {
    const leadMood = SHOUT_MOOD_META[reactions.find((r) => r.delta > 0)!.mood].label
    parts.push(`${positiveCount} 人${leadMood}${posNames.length && positiveCount <= 3 ? `（${posNames.join('、')}）` : ''}`)
  }
  if (neutralCount > 0) parts.push(`${neutralCount} 人无动于衷`)
  if (negativeCount > 0) {
    const negMood = SHOUT_MOOD_META[reactions.find((r) => r.delta < 0)!.mood].label
    parts.push(`${negativeCount} 人${negMood}${negNames.length ? `（${negNames.join('、')}）` : ''}`)
  }
  return `助教：全队喊话「${label}」——${parts.join('，') || '暂无反应'}。`
}

/** 赛前勾选「自动喊话」后，在离线/后台模拟中按比赛局势确定性挑选最稳妥的喊话。 */
export function pickAutoShout(params: {
  team: MatchTeamState
  clock: number
  durationSeconds: number
  score: { home: number; away: number }
  log: MatchLogEntry[]
}): { kind: ShoutKind; targetPlayerId?: string } | null {
  const { team, clock, durationSeconds, score, log } = params
  const status = shoutStatusOf(team, clock, durationSeconds)
  if (!status.canShout) return null
  const minute = matchMinuteOf(clock, durationSeconds)
  if (minute < 18 || minute > 83) return null

  const myScore = score[team.side]
  const oppScore = score[opponentSide(team.side)]
  const scoreDiff = myScore - oppScore
  const { recentScored, recentConceded } = recentGoalContext(log, clock, durationSeconds, team.side)

  // 1. 有人刚吃黄牌且不在冷静状态 → 点名让其冷静下来
  const booked = team.players.find((p) => p.onPitch && !p.sentOff && p.yellowCards > 0 && p.shoutState?.mood !== 'composed')
  if (booked && minute >= 25 && scoreDiff >= -1) {
    return { kind: 'calm_down', targetPlayerId: booked.sourceId }
  }
  // 2. 落后 2 球以上 → 35 分钟后先斥责/鼓励唤醒
  if (scoreDiff <= -2 && minute >= 35) {
    const avgProf = team.players.filter((p) => p.onPitch).reduce((sum, p) => sum + (p.personality?.professionalism ?? 70), 0) / Math.max(1, team.players.filter((p) => p.onPitch).length)
    return { kind: avgProf >= 74 ? 'berate' : 'encourage' }
  }
  // 3. 刚丢球导致平局或落后 1 球 → 鼓励稳住军心
  if (recentConceded && scoreDiff <= 0 && scoreDiff >= -1) {
    return { kind: 'encourage' }
  }
  // 4. 70 分钟后领先 1 球 → 保持专注守胜果
  if (scoreDiff === 1 && minute >= 70) {
    return { kind: 'focus' }
  }
  // 5. 刚进球取得 1 球领先 → 冷静下来防马上回礼
  if (recentScored && scoreDiff === 1 && minute >= 30) {
    return { kind: 'calm_down' }
  }
  // 6. 落后 1 球且下半场 52 分钟后 → 鼓励/要求更多追分
  if (scoreDiff === -1 && minute >= 52) {
    return { kind: minute >= 72 ? 'fire_up' : 'encourage' }
  }
  // 7. 僵局超过 58 分钟 → 要求更多打破僵局
  if (scoreDiff === 0 && minute >= 58) {
    return { kind: 'demand_more' }
  }
  // 8. 65 分钟后领先 2 球以上 → 表扬保持好手感
  if (scoreDiff >= 2 && minute >= 65) {
    return { kind: 'praise' }
  }
  return null
}

/** 根据当前比赛状态列出可用的已安排喊话列表，按时间排序去重。 */
export function normalizeScheduledShouts(shouts?: ScheduledMatchShout[]): ScheduledMatchShout[] {
  if (!Array.isArray(shouts) || shouts.length === 0) return []
  const seen = new Set<string>()
  const out: ScheduledMatchShout[] = []
  for (const s of shouts) {
    if (!s || typeof s.id !== 'string' || seen.has(s.id) || !isShoutKind(s.kind)) continue
    if (s.side !== 'home' && s.side !== 'away') continue
    if (!Number.isFinite(s.atClock) || s.atClock < 0) continue
    seen.add(s.id)
    out.push({
      id: s.id,
      side: s.side,
      kind: s.kind,
      atClock: Math.floor(s.atClock),
      ...(s.targetPlayerId ? { targetPlayerId: s.targetPlayerId } : {}),
      ...(s.auto ? { auto: true } : {}),
    })
  }
  return out.sort((a, b) => a.atClock - b.atClock || a.id.localeCompare(b.id))
}

/** 从 MatchState 计算双方活跃情绪的简化映射（供 2D 画面与 UI 使用）。 */
export function activeShoutStateOf(player: MatchPlayerState, clock: number): PlayerShoutState | null {
  const s = player.shoutState
  if (!s) return null
  return clock >= s.appliedAt && clock < s.expiresAt ? s : null
}

export function isMatchLiveState(state: Pick<MatchState, 'finished'>): boolean {
  return !state.finished
}
