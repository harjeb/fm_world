// Unified Season Events Hub (S3+):
// - 3D Penalty Shootout ("十二码之夜" · 9 stages + unified season environment)
// - 3D Free Kick Lab ("任意球实验室" · 9 stages + unified season environment)
// - 2D TCG Draft Swiss Cup ("星秀轮抽杯" · 8-player pod draft + 4-round Swiss)

import type { GameState, SkillBookId } from '../types.ts'
import { beijingDayIndex, nextBeijingMidnight } from '../calendar.ts'
import { economyOf } from '../economy.ts'
import { addLegendBook, ensureLegendBooks, hasLegendBook } from '../legend-books.ts'
import { ensureShop } from '../shop.ts'
import { seasonEnvironmentFor, type PitchEnvironment } from '../penalty/environment.ts'
import type { Kick, Point, Result } from '../penalty/practice.ts'
import type { FreeKickResult, FreeKickSpot, FreeKickStyle, WallAction } from '../penalty/freekick.ts'
import {
  computeDraftStandings,
  createDraftCupRun,
  DRAFT_POOL_THEMES,
  draftThemeForSeason,
  pickDraftCard,
  simulateCurrentSwissRound,
  startLiveSwissMatch,
  updateDraftPlayerLineup,
  type DraftCupState,
  type DraftPoolThemeId,
} from './draft-cup.ts'

export const EVENT_DAILY_LIMIT = 4
export const EVENT_STAGE_COUNT = 9
export const STAGE_3_REWARD_COINS = 350_000
export const STAGE_6_REWARD_COINS = 650_000
export const DUPLICATE_ALL_BOOKS_SHOP_POINTS = 300

export type SeasonEventMode = 'penalty' | 'freekick' | 'draft'

export const PENALTY_REWARD_BOOKS: readonly SkillBookId[] = ['lg_low_drive', 'lg_chip', 'lg_peak_keeper']
export const FREEKICK_REWARD_BOOKS: readonly SkillBookId[] = ['lg_knuckleball', 'lg_set_piece_iq', 'lg_diving_header']
export const DRAFT_REWARD_BOOKS: readonly SkillBookId[] = ['lg_calm_mind', 'lg_vision_master', 'lg_peak_striker']

export interface StageTrackProgress {
  cleared: number
  stage3Claimed?: boolean
  stage6Claimed?: boolean
  chosenBook?: SkillBookId
  shopFallbackClaimed?: boolean
}

export interface SeasonEventsState {
  version: 1
  seasonIndex: number
  dailyAttempts: { day: number; used: number }
  penalty: StageTrackProgress
  freekick: StageTrackProgress
  draft?: DraftCupState
  draftBestRankRewarded?: number
  draftBookChosen?: SkillBookId
}

export function featuredEventForSeason(seasonIndex: number): SeasonEventMode {
  const s = Math.max(3, Math.floor(seasonIndex))
  const modes: readonly SeasonEventMode[] = ['penalty', 'freekick', 'draft']
  return modes[(s - 3) % modes.length]
}

export function ensureSeasonEvents(game: GameState, now = Date.now()): SeasonEventsState {
  const day = beijingDayIndex(now)
  if (!game.seasonEvents || game.seasonEvents.version !== 1) {
    game.seasonEvents = {
      version: 1,
      seasonIndex: game.season.index,
      dailyAttempts: { day, used: 0 },
      penalty: { cleared: 0 },
      freekick: { cleared: 0 },
    }
  }
  const ev = game.seasonEvents
  if (ev.dailyAttempts.day !== day) {
    ev.dailyAttempts = { day, used: 0 }
  }
  return ev
}

export function eventDailyQuota(game: GameState, now = Date.now()): {
  remaining: number
  limit: number
  resetAt: number
} {
  const ev = ensureSeasonEvents(game, now)
  return {
    remaining: Math.max(0, EVENT_DAILY_LIMIT - ev.dailyAttempts.used),
    limit: EVENT_DAILY_LIMIT,
    resetAt: nextBeijingMidnight(now),
  }
}

export function consumeEventAttempt(game: GameState, now = Date.now()): { ok: boolean; error?: string } {
  const ev = ensureSeasonEvents(game, now)
  if (ev.dailyAttempts.used >= EVENT_DAILY_LIMIT) {
    return { ok: false, error: '今日活动挑战次数已用完（北京时间 00:00 刷新），仍可无限进入自由训练场练习！' }
  }
  ev.dailyAttempts.used++
  return { ok: true }
}

export interface PenaltyStageDef {
  stage: number
  title: string
  sceneDesc: string
  goalDesc: string
  keeperless?: boolean
  forcedKick?: Kick
  forcedOutside?: boolean
  keeperBias?: 'left' | 'right' | 'early' | 'mixed'
}

export const PENALTY_STAGES: readonly PenaltyStageDef[] = [
  { stage: 1, title: '找准脚感', sceneDesc: '无门将空门大目标', goalDesc: '三罚内命中球门内目标 1 次', keeperless: true },
  { stage: 2, title: '贴地推射', sceneDesc: '瞄准左右死角下沿', goalDesc: '三罚内攻入 1 粒贴地下角球（高度 ≤ 1.0m 且偏离中路）', forcedKick: 'push' },
  { stage: 3, title: '攻守换位', sceneDesc: '自由选踢法 + 首次手动守门教学', goalDesc: '三罚进 2 球，并完成 1 次手动守门回合' },
  { stage: 4, title: '半步之差', sceneDesc: '高反应门将站位靠前', goalDesc: '三罚内攻入 2 球，推荐尝试正脚背大力射门' },
  { stage: 5, title: '外脚背挑战', sceneDesc: '门将偏守右侧', goalDesc: '三罚内用外脚背抽射破门 1 次', forcedKick: 'snap', forcedOutside: true, keeperBias: 'right' },
  { stage: 6, title: '门将先动', sceneDesc: '对手门将会提前大幅侧扑', goalDesc: '三罚进 2 球，可选勺子轻挑中路或打反方向', keeperBias: 'early' },
  { stage: 7, title: '轮换主罚', sceneDesc: '适应不同节奏连罚三脚', goalDesc: '三罚内攻入 2 球' },
  { stage: 8, title: '第五罚残局', sceneDesc: '前四轮战平，最后决胜轮（一射一扑）', goalDesc: '第五轮赢下对手（平局进入突然死亡）' },
  { stage: 9, title: '十二码决赛', sceneDesc: '五轮制点球大战总决战（攻守交替）', goalDesc: '赢下五轮制点球大战（平局进入突然死亡）' },
]

export interface FreeKickStageDef {
  stage: number
  title: string
  spotId: FreeKickSpot['id']
  sceneDesc: string
  goalDesc: string
  keeperless?: boolean
  wallless?: boolean
  aiWallAction?: WallAction
  forcedStyle?: FreeKickStyle
  defendOnly?: boolean
}

export const FREEKICK_STAGES: readonly FreeKickStageDef[] = [
  { stage: 1, title: '弧线初体验', spotId: 'arc_center', sceneDesc: '无门将无人墙空门找弧度手感', goalDesc: '三罚内命中球门范围 1 次', keeperless: true, wallless: true },
  { stage: 2, title: '绕墙入角', spotId: 'right_channel', sceneDesc: '右肋 21.5m 标准四人墙封近角（无门将）', goalDesc: '三罚内绕过人墙射入球门 1 次', keeperless: true, aiWallAction: 'jump' },
  { stage: 3, title: '贴地冷射', spotId: 'arc_center', sceneDesc: '对手人墙全员起跳，脚底露出空当', goalDesc: '三罚内用「贴地冷射」钻过人墙脚下破门 1 次', forcedStyle: 'low_drive', aiWallAction: 'jump' },
  { stage: 4, title: '电梯急坠', spotId: 'arc_center', sceneDesc: '人墙起跳 + 卧草封死贴地路', goalDesc: '三罚内用正脚背电梯球或弧线球越墙攻入 1 球', aiWallAction: 'lie' },
  { stage: 5, title: '外旋奇袭', spotId: 'left_channel', sceneDesc: '左肋偏侧 · 外脚背外旋绕墙', goalDesc: '三罚内攻破球门 2 次', aiWallAction: 'jump' },
  { stage: 6, title: '后点空中接力', spotId: 'far_flank', sceneDesc: '远端 24.5m · 挑传后点找队友冲顶配合', goalDesc: '三罚内完成 1 次「配合破门」或直接得分', forcedStyle: 'loft_pass', aiWallAction: 'jump' },
  { stage: 7, title: '人墙门将联防', spotId: 'right_channel', sceneDesc: '首次指挥人墙（起跳/卧草）并手控门将扑救', goalDesc: '三球防守内至少化解对手 2 次任意球（不丢满 2 球）', defendOnly: true },
  { stage: 8, title: '双球位连击', spotId: 'left_channel', sceneDesc: '偏侧与远端连续考验环境风偏预判', goalDesc: '四罚内攻入 2 球（直接破门或配合破门均可）', aiWallAction: 'lie' },
  { stage: 9, title: '任意球大师决战', spotId: 'arc_center', sceneDesc: '三攻三守定位球总决赛', goalDesc: '三轮攻守总进球多于对手（平局加赛决胜）', aiWallAction: 'lie' },
]

export function currentSeasonEnvironment(game: GameState): PitchEnvironment {
  return seasonEnvironmentFor(game.season.index)
}

export function markEventStageCleared(
  game: GameState,
  mode: 'penalty' | 'freekick',
  stage: number,
): { newlyCleared: boolean; autoCoins: number } {
  const ev = ensureSeasonEvents(game)
  const track = ev[mode]
  let newlyCleared = false
  let autoCoins = 0
  if (stage === track.cleared + 1 && stage <= EVENT_STAGE_COUNT) {
    track.cleared = stage
    newlyCleared = true
  }
  if (track.cleared >= 3 && !track.stage3Claimed) {
    track.stage3Claimed = true
    economyOf(game).balance += STAGE_3_REWARD_COINS
    autoCoins += STAGE_3_REWARD_COINS
  }
  if (track.cleared >= 6 && !track.stage6Claimed) {
    track.stage6Claimed = true
    economyOf(game).balance += STAGE_6_REWARD_COINS
    autoCoins += STAGE_6_REWARD_COINS
  }
  return { newlyCleared, autoCoins }
}

export function claimStage9ThemeBook(
  game: GameState,
  mode: 'penalty' | 'freekick',
  bookId: SkillBookId,
): { ok: boolean; error?: string; fallbackPoints?: number } {
  const ev = ensureSeasonEvents(game)
  const track = ev[mode]
  if (track.cleared < EVENT_STAGE_COUNT) return { ok: false, error: '通关第 9 关后才能领取主题彩书' }
  if (track.chosenBook || track.shopFallbackClaimed) return { ok: false, error: '本活动终极奖励已领取' }
  const allowed = mode === 'penalty' ? PENALTY_REWARD_BOOKS : FREEKICK_REWARD_BOOKS
  if (!allowed.includes(bookId)) return { ok: false, error: '不在可选主题彩书列表中' }

  ensureLegendBooks(game)
  const allOwned = allowed.every((id) => hasLegendBook(game, id, 'rainbow'))
  if (allOwned) {
    ensureShop(game)
    game.shop!.points += DUPLICATE_ALL_BOOKS_SHOP_POINTS
    track.shopFallbackClaimed = true
    return { ok: true, fallbackPoints: DUPLICATE_ALL_BOOKS_SHOP_POINTS }
  }
  if (hasLegendBook(game, bookId, 'rainbow')) {
    return { ok: false, error: '你已拥有这本彩色技能书，请选择尚未拥有的另一本' }
  }
  addLegendBook(game, bookId, 'rainbow')
  track.chosenBook = bookId
  return { ok: true }
}

export const DRAFT_RANK_REWARDS: Record<number, { money: number; shopPoints: number; canPickBook: boolean }> = {
  1: { money: 1_200_000, shopPoints: 320, canPickBook: true },
  2: { money: 900_000, shopPoints: 240, canPickBook: true },
  3: { money: 650_000, shopPoints: 180, canPickBook: false },
  4: { money: 500_000, shopPoints: 140, canPickBook: false },
  5: { money: 380_000, shopPoints: 100, canPickBook: false },
  6: { money: 280_000, shopPoints: 80, canPickBook: false },
  7: { money: 200_000, shopPoints: 60, canPickBook: false },
  8: { money: 150_000, shopPoints: 50, canPickBook: false },
}

export function startOrResetDraftEvent(
  game: GameState,
  themeOverride?: DraftPoolThemeId,
  now = Date.now(),
): { ok: boolean; error?: string } {
  const ev = ensureSeasonEvents(game, now)
  if (ev.draft && ev.draft.phase !== 'finished') {
    // Allow restarting only if user explicitly resets; consumes 1 daily attempt on new run after the first free run
  }
  const isFirstRun = !ev.draft
  if (!isFirstRun) {
    const quota = consumeEventAttempt(game, now)
    if (!quota.ok) return quota
  }
  const run = createDraftCupRun(game)
  if (themeOverride && DRAFT_POOL_THEMES[themeOverride]) {
    // Rebuild with chosen seasonal pool theme for testing/variety
    game.seasonEvents!.draft = {
      ...createDraftCupRun({
        ...game,
        season: {
          ...game.season,
          index:
            3 +
            (['all_star', 'u20_storm', 'veteran_masters', 'specialists'] as const).indexOf(themeOverride),
        },
      }),
      seasonIndex: game.season.index,
      bestRank: ev.draft?.bestRank,
    }
  } else {
    run.bestRank = ev.draft?.bestRank
    ev.draft = run
  }
  return { ok: true }
}

export function claimDraftRankReward(
  game: GameState,
  chosenBook?: SkillBookId,
): { ok: boolean; error?: string; moneyDelta?: number; pointsDelta?: number } {
  const ev = ensureSeasonEvents(game)
  const draft = ev.draft
  if (!draft || draft.phase !== 'finished') return { ok: false, error: '请先完成 4 轮瑞士轮比赛' }
  const rank = computeDraftStandings(draft).find((r) => r.isPlayer)?.rank ?? 8
  const targetReward = DRAFT_RANK_REWARDS[rank] ?? DRAFT_RANK_REWARDS[8]
  const prevBest = ev.draftBestRankRewarded
  const prevReward = prevBest ? DRAFT_RANK_REWARDS[prevBest] : { money: 0, shopPoints: 0, canPickBook: false }

  if (targetReward.canPickBook && !ev.draftBookChosen) {
    ensureLegendBooks(game)
    const allOwned = DRAFT_REWARD_BOOKS.every((id) => hasLegendBook(game, id, 'rainbow'))
    if (!allOwned) {
      if (!chosenBook || !DRAFT_REWARD_BOOKS.includes(chosenBook)) {
        return { ok: false, error: '前两名可自选 1 本主题彩书，请先点选心仪彩书再领奖' }
      }
      if (hasLegendBook(game, chosenBook, 'rainbow')) {
        return { ok: false, error: '该彩书已拥有，请选择另一本' }
      }
      addLegendBook(game, chosenBook, 'rainbow')
      ev.draftBookChosen = chosenBook
    } else {
      ensureShop(game)
      game.shop!.points += DUPLICATE_ALL_BOOKS_SHOP_POINTS
      ev.draftBookChosen = DRAFT_REWARD_BOOKS[0]
    }
  }

  const moneyDelta = Math.max(0, targetReward.money - prevReward.money)
  const pointsDelta = Math.max(0, targetReward.shopPoints - prevReward.shopPoints)
  if (moneyDelta === 0 && pointsDelta === 0 && draft.rewardClaimed) {
    return { ok: false, error: '本轮名次奖励已结算（刷出更高名次可补领差额）' }
  }
  economyOf(game).balance += moneyDelta
  ensureShop(game)
  game.shop!.points += pointsDelta
  ev.draftBestRankRewarded = prevBest ? Math.min(prevBest, rank) : rank
  draft.rewardClaimed = true
  return { ok: true, moneyDelta, pointsDelta }
}

/** Build stateful 9-stage challenge controller for 3D Penalty Shootout. */
export function buildPenaltyStageController(
  stage: number,
  env: PitchEnvironment,
  onCleared: () => void,
) {
  const def = PENALTY_STAGES[stage - 1] ?? PENALTY_STAGES[0]
  let kicksTaken = 0
  let playerGoals = 0
  let oppKicks = 0
  let oppGoals = 0

  const isGoal = (r: Result) => r === '进球' || r === '碰到仍进'

  return {
    title: `第 ${def.stage} 关 · ${def.title}`,
    eyebrow: `S3 十二码之夜 · 第 ${def.stage}/9 关`,
    env,
    prompt: `过关条件：${def.goalDesc}（本季环境：${env.subtitle}）`,
    role: 'kick' as const,
    keeperless: def.keeperless,
    forcedKick: def.forcedKick,
    forcedOutside: def.forcedOutside,
    keeperBias: def.keeperBias,
    onAttempt(outcome: {
      result: Result
      defend: boolean
      kick: Kick
      outside: boolean
      aim: Point
      landing: Point
    }) {
      // Stages 8 & 9: alternating shootout rounds!
      if (stage === 8 || stage === 9) {
        const baseRounds = stage === 8 ? 1 : 5
        if (!outcome.defend) {
          kicksTaken++
          if (isGoal(outcome.result)) playerGoals++
          const prefix = stage === 8 ? `决胜轮比分 ${(4 + playerGoals)}:${(4 + oppGoals)}` : `点球比分 ${playerGoals}:${oppGoals}`
          return {
            finished: false,
            nextRole: 'keep' as const,
            message: `${prefix}。轮到你镇守球门！`,
            buttonLabel: '切换守门回合',
          }
        } else {
          oppKicks++
          if (isGoal(outcome.result)) oppGoals++
          const remPlayer = Math.max(0, baseRounds - kicksTaken)
          const remOpp = Math.max(0, baseRounds - oppKicks)
          // Early clinch check during first 5 rounds, or sudden death after baseRounds
          const decided =
            kicksTaken >= baseRounds && oppKicks >= baseRounds
              ? playerGoals !== oppGoals
              : playerGoals > oppGoals + remOpp || oppGoals > playerGoals + remPlayer
          if (decided) {
            const passed = playerGoals > oppGoals
            if (passed) onCleared()
            return {
              finished: true,
              passed,
              message: passed
                ? `最终比分 ${stage === 8 ? `${4 + playerGoals}:${4 + oppGoals}` : `${playerGoals}:${oppGoals}`}，恭喜通关第 ${stage} 关！`
                : `最终比分 ${stage === 8 ? `${4 + playerGoals}:${4 + oppGoals}` : `${playerGoals}:${oppGoals}`}，惜败对手，可再次挑战。`,
              buttonLabel: '返回活动页',
            }
          }
          const sudden = kicksTaken >= baseRounds ? '（突然死亡加赛！）' : ''
          return {
            finished: false,
            nextRole: 'kick' as const,
            message: `当前比分 ${stage === 8 ? `${4 + playerGoals}:${4 + oppGoals}` : `${playerGoals}:${oppGoals}`}${sudden}，轮到你主罚下一轮！`,
            buttonLabel: '继续主罚',
          }
        }
      }

      // Stage 3: 3 kicks (score >= 2) + 1 mandatory keeper round
      if (stage === 3) {
        if (!outcome.defend) {
          kicksTaken++
          if (isGoal(outcome.result)) playerGoals++
          if (kicksTaken < 3 && playerGoals < 2 && 3 - kicksTaken + playerGoals >= 2) {
            return {
              finished: false,
              nextRole: 'kick' as const,
              message: `已罚 ${kicksTaken}/3 球（进 ${playerGoals} 球），还需进 ${2 - playerGoals} 球后进入守门教学。`,
            }
          }
          if (playerGoals >= 2) {
            return {
              finished: false,
              nextRole: 'keep' as const,
              message: `主罚达标（进 ${playerGoals} 球）！现在体验 1 次手动守门即可过关。`,
              buttonLabel: '进入守门回合',
            }
          }
          return {
            finished: true,
            passed: false,
            message: `三罚仅进 ${playerGoals} 球，未达两球目标。`,
          }
        } else {
          onCleared()
          return {
            finished: true,
            passed: true,
            message: '完成攻守换位教学，恭喜通关第 3 关！',
          }
        }
      }

      // Stages 1, 2, 4, 5, 6, 7: 3 kicks to meet target
      kicksTaken++
      let validHit = isGoal(outcome.result)
      if (stage === 2) {
        validHit = validHit && outcome.landing.y <= 1.05 && Math.abs(outcome.landing.x) >= 1.45
      } else if (stage === 5) {
        validHit = validHit && outcome.kick === 'snap' && outcome.outside
      }
      if (validHit) playerGoals++

      const needed = stage === 1 || stage === 2 || stage === 5 ? 1 : 2
      if (playerGoals >= needed) {
        onCleared()
        return {
          finished: true,
          passed: true,
          message: `达成目标（${playerGoals}/${needed}），恭喜通关第 ${stage} 关！`,
        }
      }
      if (kicksTaken >= 3 || playerGoals + (3 - kicksTaken) < needed) {
        return {
          finished: true,
          passed: false,
          message:
            stage === 2 && isGoal(outcome.result) && !validHit
              ? '虽进球但落点不够贴地下角（需高度 ≤1.0m 且靠近两侧门柱），本关未达成。'
              : `三罚结束（有效命中 ${playerGoals}/${needed}），差一点就过关了！`,
        }
      }
      return {
        finished: false,
        nextRole: 'kick' as const,
        nextKeeperless: def.keeperless,
        message:
          stage === 2 && isGoal(outcome.result) && !validHit
            ? `球进了但位置偏中或偏高！剩余 ${3 - kicksTaken} 罚，请瞄准左右下角。`
            : `进度 ${playerGoals}/${needed}，剩余 ${3 - kicksTaken} 次主罚机会。`,
      }
    },
  }
}

/** Build stateful 9-stage challenge controller for 3D Free Kick Lab. */
export function buildFreeKickStageController(
  stage: number,
  env: PitchEnvironment,
  onCleared: () => void,
) {
  const def = FREEKICK_STAGES[stage - 1] ?? FREEKICK_STAGES[0]
  let attempts = 0
  let successes = 0
  let oppAttempts = 0
  let oppGoals = 0

  const isFkGoal = (r: FreeKickResult) => r === '进球' || r === '配合破门' || r === '碰到仍进'

  return {
    title: `第 ${def.stage} 关 · ${def.title}`,
    eyebrow: `任意球实验室 · 第 ${def.stage}/9 关`,
    env,
    spotId: def.spotId,
    prompt: `过关条件：${def.goalDesc}（本季环境：${env.subtitle}）`,
    role: (def.defendOnly ? 'keep' : 'kick') as 'kick' | 'keep',
    keeperless: def.keeperless,
    wallless: def.wallless,
    aiWallAction: def.aiWallAction,
    forcedStyle: def.forcedStyle,
    onAttempt(info: {
      result: FreeKickResult
      defend: boolean
      style: FreeKickStyle
      underWall: boolean
      landing: Point
    }) {
      if (stage === 9) {
        if (!info.defend) {
          attempts++
          if (isFkGoal(info.result)) successes++
          return {
            finished: false,
            nextRole: 'keep' as const,
            nextSpotId: attempts % 2 === 1 ? ('right_channel' as const) : ('left_channel' as const),
            message: `比分 ${successes}:${oppGoals}。轮到你布置人墙并扑救对手任意球！`,
            buttonLabel: '切换联防回合',
          }
        } else {
          oppAttempts++
          if (isFkGoal(info.result)) oppGoals++
          if (attempts >= 3 && oppAttempts >= 3 && successes !== oppGoals) {
            const passed = successes > oppGoals
            if (passed) onCleared()
            return {
              finished: true,
              passed,
              message: passed
                ? `总比分 ${successes}:${oppGoals} 击败对手，通关第 9 关任意球大师决战！`
                : `总比分 ${successes}:${oppGoals} 惜败，可再次发起挑战。`,
            }
          }
          return {
            finished: false,
            nextRole: 'kick' as const,
            nextSpotId: attempts === 1 ? ('right_channel' as const) : ('far_flank' as const),
            message: `当前比分 ${successes}:${oppGoals}${attempts >= 3 ? '（突然死亡加赛）' : ''}，轮到你主罚！`,
            buttonLabel: '继续主罚',
          }
        }
      }

      if (stage === 7) {
        oppAttempts++
        if (!isFkGoal(info.result)) successes++
        if (successes >= 2) {
          onCleared()
          return {
            finished: true,
            passed: true,
            message: `成功化解 ${successes} 次任意球，通关第 7 关人墙联防！`,
          }
        }
        if (oppAttempts >= 3 || successes + (3 - oppAttempts) < 2) {
          return {
            finished: true,
            passed: false,
            message: `三球仅防下 ${successes} 球，试试结合人墙起跳/卧草与反侧扑救！`,
          }
        }
        return {
          finished: false,
          nextRole: 'keep' as const,
          nextSpotId: oppAttempts === 1 ? ('arc_center' as const) : ('left_channel' as const),
          message: `已成功防下 ${successes}/2 球，剩余 ${3 - oppAttempts} 球防守。`,
        }
      }

      attempts++
      const maxTries = stage === 8 ? 4 : 3
      const needed = stage === 5 || stage === 8 ? 2 : 1
      let hit = isFkGoal(info.result)
      if (stage === 3) hit = hit && info.style === 'low_drive' && info.underWall
      if (hit) successes++

      if (successes >= needed) {
        onCleared()
        return {
          finished: true,
          passed: true,
          message: `达成目标（${successes}/${needed}），恭喜通关第 ${stage} 关！`,
        }
      }
      if (attempts >= maxTries || successes + (maxTries - attempts) < needed) {
        return {
          finished: true,
          passed: false,
          message: `${maxTries} 罚结束（达成 ${successes}/${needed}），可在自由训练场多试几次风向与弧度！`,
        }
      }
      return {
        finished: false,
        nextRole: 'kick' as const,
        nextSpotId: stage === 8 && attempts >= 2 ? ('far_flank' as const) : def.spotId,
        message: `进度 ${successes}/${needed}，剩余 ${maxTries - attempts} 次主罚机会。`,
      }
    },
  }
}

export type SeasonEventActionBody =
  | { action: 'start_stage'; mode: 'penalty' | 'freekick'; stage: number }
  | { action: 'clear_stage'; mode: 'penalty' | 'freekick'; stage: number }
  | { action: 'claim_book'; mode: 'penalty' | 'freekick'; bookId: SkillBookId }
  | { action: 'draft_start'; themeId?: DraftPoolThemeId }
  | { action: 'draft_pick'; cardId: string }
  | {
      action: 'draft_lineup'
      formationId?: import('../types.ts').ElevenFormationId
      mentality?: import('../types.ts').MatchMentality
      autoBest?: boolean
      swapPlayerIds?: [string, string]
    }
  | { action: 'draft_sim_round' }
  | { action: 'draft_live_start' }
  | { action: 'draft_claim_reward'; bookId?: SkillBookId }

export function applySeasonEventAction(
  game: GameState,
  raw: unknown,
  now = Date.now(),
): { ok: boolean; error?: string; autoCoins?: number; moneyDelta?: number; pointsDelta?: number } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '无效的活动请求' }
  const body = raw as SeasonEventActionBody
  const ev = ensureSeasonEvents(game, now)

  switch (body.action) {
    case 'start_stage': {
      if (body.mode !== 'penalty' && body.mode !== 'freekick') return { ok: false, error: '未知活动类型' }
      const stage = Math.floor(Number(body.stage))
      if (stage < 1 || stage > EVENT_STAGE_COUNT) return { ok: false, error: '关卡编号无效' }
      if (stage > ev[body.mode].cleared + 1) return { ok: false, error: '请先通关前置关卡' }
      return consumeEventAttempt(game, now)
    }
    case 'clear_stage': {
      if (body.mode !== 'penalty' && body.mode !== 'freekick') return { ok: false, error: '未知活动类型' }
      const stage = Math.floor(Number(body.stage))
      if (stage < 1 || stage > EVENT_STAGE_COUNT || stage > ev[body.mode].cleared + 1) {
        return { ok: false, error: '关卡进度不合法' }
      }
      const res = markEventStageCleared(game, body.mode, stage)
      return { ok: true, autoCoins: res.autoCoins }
    }
    case 'claim_book': {
      if (body.mode !== 'penalty' && body.mode !== 'freekick') return { ok: false, error: '未知活动类型' }
      return claimStage9ThemeBook(game, body.mode, body.bookId)
    }
    case 'draft_start': {
      return startOrResetDraftEvent(game, body.themeId, now)
    }
    case 'draft_pick': {
      if (!ev.draft) return { ok: false, error: '请先开启一轮星秀轮抽' }
      return pickDraftCard(ev.draft, String(body.cardId ?? ''))
    }
    case 'draft_lineup': {
      if (!ev.draft) return { ok: false, error: '请先开启一轮星秀轮抽' }
      return updateDraftPlayerLineup(ev.draft, {
        formationId: body.formationId,
        mentality: body.mentality,
        autoBest: body.autoBest,
        swapPlayerIds: body.swapPlayerIds,
      })
    }
    case 'draft_sim_round': {
      if (!ev.draft) return { ok: false, error: '请先开启一轮星秀轮抽' }
      return simulateCurrentSwissRound(game, ev.draft)
    }
    case 'draft_live_start': {
      if (!ev.draft) return { ok: false, error: '请先开启一轮星秀轮抽' }
      return startLiveSwissMatch(game, ev.draft, now)
    }
    case 'draft_claim_reward': {
      return claimDraftRankReward(game, body.bookId)
    }
    default:
      return { ok: false, error: '不支持的活动操作' }
  }
}

export { draftThemeForSeason }
