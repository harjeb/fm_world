import { describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { caOf } from '../src/game/ca.ts'
import { ENVIRONMENT_PRESETS, seasonEnvironmentFor } from '../src/game/penalty/environment.ts'
import { ballAt, band, makeShot, resolve, STANDARD } from '../src/game/penalty/practice.ts'
import {
  fkBand,
  FREEKICK_SPOTS,
  makeFreeKickShot,
  resolveFreeKick,
  STANDARD_FK_ABILITY,
} from '../src/game/penalty/freekick.ts'
import {
  computeDraftStandings,
  createDraftCupRun,
  DRAFT_PACK_SIZE,
  DRAFT_POD_SIZE,
  DRAFT_SQUAD_TARGET,
  DRAFT_SWISS_ROUNDS,
  pickDraftCard,
  simulateCurrentSwissRound,
} from '../src/game/events/draft-cup.ts'
import {
  applySeasonEventAction,
  EVENT_DAILY_LIMIT,
  isSeasonEventsOpen,
  PENALTY_REWARD_BOOKS,
  STAGE_3_REWARD_COINS,
  STAGE_6_REWARD_COINS,
} from '../src/game/events/season-events.ts'

describe('3D 环境机制与无门将练习模式', () => {
  it('每个赛季固定同一套环境，且强横风、雪地、泥地、暴雨物理效果符合预期', () => {
    expect(seasonEnvironmentFor(3).id).toBe('standard')
    expect(seasonEnvironmentFor(4).id).toBe('sahara')
    expect(seasonEnvironmentFor(5).id).toBe('blizzard')
    expect(seasonEnvironmentFor(6).id).toBe('monsoon')

    const aim = { x: 0, y: 1.3 }
    const calm = makeShot('chip', false, aim, band('chip', STANDARD).center, STANDARD, 101, ENVIRONMENT_PRESETS.standard)
    const sahara = makeShot('chip', false, aim, band('chip', STANDARD, ENVIRONMENT_PRESETS.sahara).center, STANDARD, 101, ENVIRONMENT_PRESETS.sahara)
    // 东北风 18m/s（向左侧 -x 吹偏）：落点明显左移，且轨迹与终局点连续一致
    expect(sahara.target.x).toBeLessThan(calm.target.x - 0.8)
    expect(ballAt(sahara, sahara.time).x).toBeCloseTo(sahara.target.x, 8)

    // 雪地低平球擦地滑窜加速（飞行用时短于泥泞地低平球）
    const lowAim = { x: 1.5, y: 0.28 }
    const snowLow = makeShot('snap', false, lowAim, band('snap', STANDARD, ENVIRONMENT_PRESETS.blizzard).center, STANDARD, 7, ENVIRONMENT_PRESETS.blizzard)
    const mudLow = makeShot('snap', false, lowAim, band('snap', STANDARD, ENVIRONMENT_PRESETS.monsoon).center, STANDARD, 7, ENVIRONMENT_PRESETS.monsoon)
    expect(snowLow.time).toBeLessThan(mudLow.time)

    // 无门将模式：即使门将站在正中也不触发扑救，命中门内必判进球，打门柱仍判门框
    const centerShot = makeShot('push', false, { x: 0, y: 1.1 }, band('push', STANDARD).center, STANDARD, 12)
    expect(['抱住', '挡出']).toContain(resolve(centerShot, null, STANDARD).result)
    expect(resolve(centerShot, null, STANDARD, { keeperless: true }).result).toBe('进球')
  })
})

describe('3D 任意球实验室：人墙起跳/卧草、钻墙底与后点配合破门', () => {
  it('贴地冷射可钻过起跳人墙脚下，但会被站立人墙或卧草球员拦截', () => {
    const spot = FREEKICK_SPOTS.arc_center
    const aim = { x: -0.9, y: 0.22 }
    const b = fkBand('low_drive', STANDARD_FK_ABILITY)
    const low = makeFreeKickShot(spot, 'low_drive', 'straight', aim, b.center, STANDARD_FK_ABILITY, 88)

    const vsJump = resolveFreeKick(low, null, STANDARD_FK_ABILITY, { wallAction: 'jump', keeperless: true })
    expect(vsJump.underWall).toBe(true)
    expect(vsJump.result).toBe('进球')

    const vsStand = resolveFreeKick(low, null, STANDARD_FK_ABILITY, { wallAction: 'stand', keeperless: true })
    expect(vsStand.result).toBe('人墙挡出')

    const vsLie = resolveFreeKick(low, null, STANDARD_FK_ABILITY, { wallAction: 'lie', keeperless: true })
    expect(vsLie.result).toBe('卧草封出')
  })

  it('远端挑传后点可触发队友争顶配合破门', () => {
    const spot = FREEKICK_SPOTS.far_flank
    const strongTeam = { ...STANDARD_FK_ABILITY, passing: 0.85, vision: 0.85, teammateOffBall: 0.88, teammateHeading: 0.9, teammateStrength: 0.85 }
    const b = fkBand('loft_pass', strongTeam)
    const pass = makeFreeKickShot(spot, 'loft_pass', 'left_mid', { x: 0, y: 1.3 }, b.center, strongTeam, 55)
    const out = resolveFreeKick(pass, null, strongTeam, { wallAction: 'jump', keeperless: true, seed: 3 })
    expect(out.headerContact).toBeTruthy()
    expect(out.result).toBe('配合破门')
  })
})

describe('2D 星秀轮抽杯：八人传包选满 20 人（CA 800–1400）与 4 轮瑞士轮', () => {
  it('1 玩家 + 7 AI 每包 12 人先选 1 人传余包，选满 20 人后全员 CA 在 800–1400 且完成瑞士轮', () => {
    const now = Date.UTC(2026, 10, 24, 4)
    const game = createWorldGame(9123, undefined, '轮抽测试队', now)
    const draft = createDraftCupRun(game)
    expect(draft.seats).toHaveLength(DRAFT_POD_SIZE)
    expect(draft.seatPacks[0]).toHaveLength(DRAFT_PACK_SIZE)

    for (let step = 1; step <= DRAFT_SQUAD_TARGET; step++) {
      const currentPack = draft.seatPacks[0]
      const expectedLen = DRAFT_PACK_SIZE - ((step - 1) % 10)
      expect(currentPack).toHaveLength(expectedLen)
      // On pick 1, pick a GK if present to ensure smooth coverage; otherwise pick highest CA
      const chosen =
        step === 1 ? (currentPack.find((c) => c.positions.GK > 0) ?? currentPack[0]) : currentPack[0]
      const res = pickDraftCard(draft, chosen.id)
      expect(res.ok).toBe(true)
    }

    expect(draft.phase).toBe('swiss')
    expect(draft.swissRound).toBe(1)
    for (const seat of draft.seats) {
      expect(seat.players).toHaveLength(DRAFT_SQUAD_TARGET)
      expect(seat.lineup.starters).toHaveLength(11)
      for (const p of seat.players) {
        const ca = caOf(p.attrs, p.positions.GK > 0)
        expect(ca).toBeGreaterThanOrEqual(795)
        expect(ca).toBeLessThanOrEqual(1405)
        expect(p.skills.length).toBeGreaterThanOrEqual(2)
      }
    }

    // Play all 4 Swiss rounds and verify unique pairings & standings
    const seenPairs = new Set<string>()
    for (let r = 1; r <= DRAFT_SWISS_ROUNDS; r++) {
      const roundFixtures = draft.fixtures.filter((f) => f.round === r)
      expect(roundFixtures).toHaveLength(4)
      for (const f of roundFixtures) {
        const key = [f.homeId, f.awayId].sort().join('|')
        expect(seenPairs.has(key)).toBe(false)
        seenPairs.add(key)
      }
      expect(simulateCurrentSwissRound(game, draft).ok).toBe(true)
    }
    expect(draft.phase).toBe('finished')
    const table = computeDraftStandings(draft)
    expect(table).toHaveLength(8)
    expect(table.every((r) => r.played === DRAFT_SWISS_ROUNDS)).toBe(true)
    // Player's Swiss matches generated 2D playback records without touching main club roster
    expect(game.challengeHistory.filter((rec) => rec.cupId === 'season-event-draft')).toHaveLength(DRAFT_SWISS_ROUNDS)
  })
})

describe('赛季活动中心：S3 开放门禁、每日限次、3/6 关首通奖金与 9 关彩书三选一', () => {
  it('S3 前不开放，S3 后仅点球可用且按北京时间每日 4 次限额扣次，通关发金币并可领彩书', () => {
    const now = Date.UTC(2026, 10, 24, 4)
    const game = createWorldGame(9124, undefined, '活动测试队', now)
    expect(isSeasonEventsOpen(game)).toBe(false)
    expect(applySeasonEventAction(game, { action: 'start_stage', mode: 'penalty', stage: 1 }, now).ok).toBe(false)
    game.season.index = 2
    expect(isSeasonEventsOpen(game)).toBe(false)
    expect(applySeasonEventAction(game, { action: 'start_stage', mode: 'penalty', stage: 1 }, now).ok).toBe(false)

    game.season.index = 3
    expect(isSeasonEventsOpen(game)).toBe(true)
    expect(applySeasonEventAction(game, { action: 'start_stage', mode: 'freekick', stage: 1 }, now).ok).toBe(false)
    expect(applySeasonEventAction(game, { action: 'draft_start' }, now).ok).toBe(false)
    const startBalance = game.economy!.balance

    for (let i = 0; i < EVENT_DAILY_LIMIT; i++) {
      expect(applySeasonEventAction(game, { action: 'start_stage', mode: 'penalty', stage: 1 }, now).ok).toBe(true)
    }
    expect(applySeasonEventAction(game, { action: 'start_stage', mode: 'penalty', stage: 1 }, now).ok).toBe(false)

    // Clear stages 1..9 sequentially
    for (let st = 1; st <= 9; st++) {
      expect(applySeasonEventAction(game, { action: 'clear_stage', mode: 'penalty', stage: st }, now).ok).toBe(true)
    }
    expect(game.economy!.balance).toBe(startBalance + STAGE_3_REWARD_COINS + STAGE_6_REWARD_COINS)

    const bookId = PENALTY_REWARD_BOOKS[0]
    expect(applySeasonEventAction(game, { action: 'claim_book', mode: 'penalty', bookId }, now).ok).toBe(true)
    expect(game.legendBooks?.some((b) => b.id === bookId && b.tier === 'rainbow')).toBe(true)
    // Duplicate claim rejected
    expect(applySeasonEventAction(game, { action: 'claim_book', mode: 'penalty', bookId: PENALTY_REWARD_BOOKS[1] }, now).ok).toBe(false)
  })
})
