import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import {
  LEGEND_CUP_META,
  LEGEND_CUP_SPECS,
  LEGEND_CUP_TEAM_IDS,
  allLegendCupTeams,
  isLegendCupTeamId,
  legendCupMetaById,
  legendCupTeamById,
} from '../src/game/data/legend-cup-teams.ts'
import { startingCa } from '../src/game/pve-strength.ts'
import { attrHardLimit } from '../src/game/scale.ts'
import { ALL_ATTRIBUTES, type GameState, type MatchRecord, type WorldState } from '../src/game/types.ts'
import { validateLineup } from '../src/game/squad.ts'
import {
  advanceWorldSeason,
  buildOwnerlessTeams,
  computeWorldTable,
  createOwnerlessWorld,
  createWorldGame,
  createWorldGameFromWorld,
  ownerlessWorldFromClub,
  worldForClub,
} from '../src/game/world.ts'
import { seedAIClubs } from '../src/game/ai-club.ts'
import { kickoffAtForRound, postseasonStartAt, seasonEndAt } from '../src/game/calendar.ts'
import {
  LEGEND_GROUP_ROUNDS,
  LEGEND_QF_SLOTS,
  LEGEND_TOTAL_ROUNDS,
  advanceSeasonCup,
  applySeasonCupPlan,
  paysSeasonCupAppearanceGold,
  planSeasonCups,
  previousChampionsTop4,
  rescheduleActiveSeasonCups,
} from '../src/game/season-cups.ts'
import { SEASON_CUP_REWARDS } from '../src/game/data/season-cup-rewards.ts'
import { CUP_CEILING_BONUS, applyCupCeilingReward, cupCeilingBonus } from '../src/game/cup-rewards.ts'
import { awardSeasonCupChampion, awardSeasonCupMatch } from '../src/game/season-cup-rewards.ts'
import {
  LEGEND_CUP_REWARD_BOOK,
  LEGEND_STAR_ATTR_GAIN,
  LEGEND_STAR_BOOK_ID,
  LEGEND_STAR_EVENT_CHANCE,
  LEGEND_STAR_EVENT_ID,
  LEGEND_STAR_INHERIT_CHANCE,
  LEGEND_STAR_INHERIT_EVENT_ID,
  LEGEND_STAR_MAX_TRIGGERS,
  SPECIAL_BOOK_SKILLS,
} from '../src/game/data/legend-cup-skill.ts'
import { skillEffectText } from '../src/game/data/skill-effects.ts'
import { CHANGELOG_RELEASES } from '../src/game/changelog.ts'
import { addLegendBook } from '../src/game/legend-books.ts'
import {
  bookKey,
  canChooseTrainingBook,
  drawTrainingSkills,
  eventForSession,
  legendStarEventFor,
  legendStarInheritEventFor,
  legendStarTriggersUsed,
} from '../src/game/legend-learning.ts'
import { createTrainingSession, resolveTrainingEvent } from '../src/game/training.ts'
import { runAutoTraining, startTraining } from '../src/game/actions.ts'
import { buildSeasonCupBracket } from '../src/ui/season-cup-bracket.ts'
import { renderSeasonCups } from '../src/ui/season-cup-view.ts'
import { renderTraining } from '../src/ui/screens/training.ts'
import { cupRoundLabel } from '../src/ui/format.ts'
import { clubLook } from '../src/ui/components.ts'
import { clubRosterPanel, publicClubFor } from '../src/ui/club-view.ts'
import { game as originalGame, setGame, ui } from '../src/ui/state.ts'
import { onlineState } from '../src/online.ts'
import { MatchQueue } from '../server/match-queue.ts'
import { MatchScheduler } from '../server/match-scheduler.ts'
import { computeMatchJob, emptyMatchBook, type MatchJob, type MatchJobResult } from '../server/match-job.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { fastMatchResult } from './queued-server-helpers.ts'

const dirs: string[] = []
const queues: MatchQueue[] = []
const servers: AppServer[] = []
const originalStatus = onlineState.status
const originalTrainingPlayerId = ui.trainingPlayerId

afterEach(() => {
  setGame(originalGame)
  onlineState.status = originalStatus
  ui.trainingPlayerId = originalTrainingPlayerId
  for (const app of servers.splice(0)) app.close()
  for (const queue of queues.splice(0)) queue.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeSeason2World(seed = 2026, start = Date.UTC(2026, 10, 9, 2), completedRound = 6): {
  world: WorldState
  top4: string[]
  freeStars: ReturnType<typeof createOwnerlessWorld>['freeStars']
  reserveStars: ReturnType<typeof createOwnerlessWorld>['reserveStars']
} {
  const { world, freeStars, reserveStars } = createOwnerlessWorld(seed, start)
  const champions = world.divisions.find((div) => div.divisionId === 'champions')!
  const top4 = champions.clubIds!.slice(0, 4)
  world.seasonIndex = 2
  world.history.push({
    seasonIndex: 1,
    champion: world.clubs.find((c) => c.id === top4[0])!.name,
    promotions: [],
    relegations: [],
    championsTop4: [...top4],
  })
  for (const division of world.divisions) {
    division.index = 2
    for (const fixture of division.fixtures) {
      if (fixture.round <= completedRound) {
        fixture.played = true
        fixture.score = { home: 1, away: 0 }
      }
    }
    division.table = computeWorldTable(
      division.clubIds!,
      division.fixtures,
      new Map(world.clubs.map((c) => [c.id, c.name])),
    )
  }
  return { world, top4, freeStars, reserveStars }
}

describe('传奇杯特邀 12 支历史最强俱乐部（一俱乐部一支，CA 1600–1900）', () => {
  it('12 支历史强队俱乐部完全不重复，全部合法且首发 CA 精确落在 1600–1900', () => {
    expect(LEGEND_CUP_SPECS).toHaveLength(12)
    expect(LEGEND_CUP_META).toHaveLength(12)
    expect(LEGEND_CUP_TEAM_IDS).toHaveLength(12)
    expect(new Set(LEGEND_CUP_META.map((m) => m.club)).size).toBe(12)
    expect(new Set(LEGEND_CUP_META.map((m) => m.clubEn)).size).toBe(12)

    const teams = allLegendCupTeams()
    const seenPlayerIds = new Set<string>()
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i]
      const spec = LEGEND_CUP_SPECS[i]
      expect(isLegendCupTeamId(team.id)).toBe(true)
      expect(team.id).toBe(spec.id)
      expect(team.players).toHaveLength(16)
      expect(validateLineup(team.players, team.lineup).valid).toBe(true)
      expect(new Set(team.players.map((p) => p.enName)).size).toBe(16)

      const ca = startingCa(team)
      expect(ca).toBeGreaterThanOrEqual(1600 - 1e-4)
      expect(ca).toBeLessThanOrEqual(1900 + 1e-4)
      expect(ca).toBeCloseTo(spec.targetCa, 4)

      for (const player of team.players) {
        expect(player.id.startsWith(`${team.id}-`)).toBe(true)
        expect(seenPlayerIds.has(player.id)).toBe(false)
        seenPlayerIds.add(player.id)
        const gk = player.positions.GK > 0
        for (const key of ALL_ATTRIBUTES) {
          const hard = attrHardLimit(key, gk)
          expect(player.attrs[key]).toBeGreaterThanOrEqual(0)
          expect(player.attrs[key]).toBeLessThanOrEqual(hard + 1e-6)
        }
      }
    }

    const first = legendCupTeamById(LEGEND_CUP_TEAM_IDS[0])!
    const before = first.players[0].attrs.passing
    first.players[0].attrs.passing = 1
    expect(legendCupTeamById(LEGEND_CUP_TEAM_IDS[0])!.players[0].attrs.passing).toBe(before)
  })
})

describe('传奇杯欧冠赛制（小组赛 3 轮 + 8 强两回合 + 半决赛两回合 + 决赛单场 = 8 轮）', () => {
  it('换季后在 world.history 记录上赛季冠军联赛前 4，并正确从 player 映射回稳定球队 ID', () => {
    const start = Date.UTC(2026, 10, 9, 2)
    const { world, freeStars, reserveStars } = createOwnerlessWorld(55, start)
    const champDiv = world.divisions.find((div) => div.divisionId === 'champions')!
    const representativeId = champDiv.clubIds![0]
    for (const division of world.divisions) {
      for (const fixture of division.fixtures) {
        fixture.played = true
        const hIdx = division.clubIds!.indexOf(fixture.homeId)
        const aIdx = division.clubIds!.indexOf(fixture.awayId)
        fixture.score = hIdx < aIdx ? { home: 2, away: 0 } : { home: 0, away: 2 }
      }
      division.table = computeWorldTable(
        division.clubIds!,
        division.fixtures,
        new Map(world.clubs.map((c) => [c.id, c.name])),
      )
      division.finished = true
      division.champion = division.table[0].teamId
    }
    const expectedTop4 = champDiv.table.slice(0, 4).map((r) => r.teamId)
    expect(expectedTop4).toContain(representativeId)

    const rep = createWorldGameFromWorld(world, representativeId, 55, start, freeStars, reserveStars)
    rep.world = worldForClub(world, representativeId)
    rep.season = rep.world.divisions.find((d) => d.clubIds?.includes('player'))!
    const res = advanceWorldSeason(rep, start + 10 * 86_400_000)
    expect(res.ok).toBe(true)

    const nextOwnerless = ownerlessWorldFromClub(rep.world!, representativeId)
    expect(nextOwnerless.seasonIndex).toBe(2)
    expect(nextOwnerless.history.at(-1)?.championsTop4).toEqual(expectedTop4)
    expect(nextOwnerless.history.at(-1)?.championsTop4).not.toContain('player')
    expect(previousChampionsTop4(nextOwnerless)).toEqual(expectedTop4)
    // 客户端 worldForClub 把己方 club.id 映射为 'player' 并保留 squadKey，previousChampionsTop4 仍能识别完整前 4
    expect(previousChampionsTop4(worldForClub(nextOwnerless, representativeId))).toEqual(expectedTop4)
  })

  it('全 6 种开季时刻 5 项杯赛共 18 槽全部落在 08/12/16/20 白天档、无连续同杯赛、8 轮 37 场含两回合总比分与点球', () => {
    expect(cupRoundLabel(1, 8, false, 'group')).toBe('小组赛第 1 轮')
    expect(cupRoundLabel(4, 8, false, 'knockout', 1)).toBe('四分之一决赛 · 首回合')
    expect(cupRoundLabel(5, 8, false, 'knockout', 2)).toBe('四分之一决赛 · 次回合')
    expect(cupRoundLabel(6, 8, false, 'knockout', 1)).toBe('半决赛 · 首回合')
    expect(cupRoundLabel(7, 8, false, 'knockout', 2)).toBe('半决赛 · 次回合')
    expect(cupRoundLabel(8, 8, false, 'knockout')).toBe('决赛')

    const pot2 = new Set(LEGEND_CUP_TEAM_IDS.slice(0, 4))
    const pot3 = new Set(LEGEND_CUP_TEAM_IDS.slice(4, 8))
    const pot4 = new Set(LEGEND_CUP_TEAM_IDS.slice(8, 12))

    for (const bjtHour of [2, 6, 10, 14, 18, 22]) {
      const start = Date.UTC(2026, 10, 9, bjtHour - 8)
      // 先验证两阶段排期：第 1 轮开季即可提前规划传奇杯（第 5 轮起一直延展至赛季结束前 2 小时），第 6 轮后再补齐其余 4 项杯赛
      const { world, top4 } = makeSeason2World(900 + bjtHour, start, 1)
      const round1Now = kickoffAtForRound(start, 1) + 600_000
      const earlyPlan = planSeasonCups(world, 777, round1Now)!
      expect(earlyPlan, `early bjtStart=${bjtHour}`).toBeDefined()
      expect(earlyPlan.cups.map((c) => c.id)).toEqual(['legend'])
      applySeasonCupPlan(world, earlyPlan)
      // 第 6 轮前重复调用不会覆盖或重复生成
      expect(planSeasonCups(world, 777, kickoffAtForRound(start, 4) + 600_000)).toBeUndefined()

      // 推进至第 6 轮完成后，补齐其余 4 项杯赛，保留已规划的传奇杯且零档期冲突
      for (const div of world.divisions) {
        for (const f of div.fixtures) if (f.round <= 6) { f.played = true; f.score = { home: 1, away: 0 } }
      }
      const now = kickoffAtForRound(start, 6) + 600_000
      const plan = planSeasonCups(world, 777, now)!
      expect(plan, `bjtStart=${bjtHour}`).toBeDefined()
      expect(plan.cups.map((c) => [c.id, c.entrants.length, c.dates.length])).toEqual([
        ['community', 16, 4],
        ['league', 20, 5],
        ['champions', 20, 5],
        ['cross', 32, 5],
        ['legend', 16, LEGEND_TOTAL_ROUNDS],
      ])
      const champions = plan.cups.find((c) => c.id === 'champions')!
      const cross = plan.cups.find((c) => c.id === 'cross')!
      const legend = plan.cups.find((c) => c.id === 'legend')!
      // 保留提前规划好的传奇杯日期不变
      expect(legend.dates).toEqual(earlyPlan.cups[0].dates)

      // 4 组×4 队均衡分档
      expect(legend.groups).toHaveLength(4)
      for (const group of legend.groups!) {
        expect(group.teamIds).toHaveLength(4)
        expect(group.teamIds.filter((id) => top4.includes(id))).toHaveLength(1)
        expect(group.teamIds.filter((id) => pot2.has(id))).toHaveLength(1)
        expect(group.teamIds.filter((id) => pot3.has(id))).toHaveLength(1)
        expect(group.teamIds.filter((id) => pot4.has(id))).toHaveLength(1)
      }

      // 传奇杯从第 5 轮之后启动，一直延伸到赛季末（seasonEndAt - 2h），全部 8 轮位于 12/16/20 黄金档，各轮间隔 >= 8h；
      // 全部 5 项杯赛共 18 个不同槽位、零冲突，且常规 4 杯严格留在常规赛结束前（< postseasonStartAt）。
      const postStart = postseasonStartAt(start)
      const sEnd = seasonEndAt(start)
      const round5CupMin = kickoffAtForRound(start, 5) + 2 * 3600_000
      expect(legend.dates[0]).toBeGreaterThanOrEqual(round5CupMin)
      expect(legend.dates[0]).toBeLessThanOrEqual(round5CupMin + 16 * 3600_000)
      expect(legend.dates.at(-1)!).toBeLessThanOrEqual(sEnd - 2 * 3600_000)
      expect(legend.dates.at(-1)!).toBeGreaterThanOrEqual(postStart - 8 * 3600_000)
      // 总跨度超过 5 天（>= 120 小时）
      expect(legend.dates.at(-1)! - legend.dates[0]).toBeGreaterThanOrEqual(120 * 3600_000)
      for (let i = 0; i < legend.dates.length; i++) {
        const hour = new Date(legend.dates[i] + 8 * 3600_000).getUTCHours()
        expect([12, 16, 20]).toContain(hour)
        if (i > 0) expect(legend.dates[i] - legend.dates[i - 1]).toBeGreaterThanOrEqual(8 * 3600_000)
      }
      const allDates = [...champions.dates, ...cross.dates, ...legend.dates]
      expect(new Set(allDates).size).toBe(18)
      for (const date of [...champions.dates, ...cross.dates]) {
        const hour = new Date(date + 8 * 3600_000).getUTCHours()
        expect([8, 12, 16, 20]).toContain(hour)
        expect(date).toBeGreaterThanOrEqual(now + 2 * 3600_000)
        expect(date).toBeLessThan(postStart)
      }

      // 小组赛未结束时淘汰树应展示两回合占位节点
      const skeleton = buildSeasonCupBracket(legend, plan.drawSeed)!
      expect(skeleton.tieTitle).toBe('决赛 · 单场')
      expect(skeleton.children![0].tieTitle).toBe('半决赛 · 两回合')
      expect(skeleton.children![0].children![0].tieTitle).toBe('四分之一决赛 · 两回合')
      expect(skeleton.children![0].children![0].homePlaceholder).toBe('A 组第 1')
      expect(skeleton.children![0].children![0].awayPlaceholder).toBe('B 组第 2')

      // 跑完 8 轮（3 小组 + 2 QF + 2 SF + 1 Final = 37 场）
      let totalGames = 0
      while (!legend.championId) {
        const round = legend.rounds.at(-1)!
        if (round.stage === 'group') {
          for (const fx of round.fixtures) {
            fx.played = true
            fx.score = round.round === 1 ? { home: 1, away: 1 } : { home: 2, away: 0 }
            if (round.round !== 1) fx.winnerId = fx.homeId
            totalGames++
          }
        } else if (round.leg === 1) {
          for (const fx of round.fixtures) {
            fx.played = true
            fx.score = { home: 2, away: 1 }
            fx.winnerId = fx.homeId
            totalGames++
          }
        } else if (round.leg === 2) {
          for (let i = 0; i < round.fixtures.length; i++) {
            const fx = round.fixtures[i]
            expect(fx.aggregateOffset).toEqual({ home: 1, away: 2 })
            fx.played = true
            if (i === 0) {
              // 第 1 场次回合 1:0 → 总比分 2:2 平局，点球决胜！
              fx.score = { home: 1, away: 0 }
              fx.shootout = { home: 5, away: 4 }
              fx.winnerId = fx.homeId
            } else {
              // 其余次回合 0:0 → 总比分 1:2，客队凭首回合优势直接晋级（无点球）
              fx.score = { home: 0, away: 0 }
              fx.winnerId = fx.awayId
            }
            totalGames++
          }
        } else {
          // 决赛单场
          for (const fx of round.fixtures) {
            expect(fx.leg).toBeUndefined()
            expect(fx.aggregateOffset).toBeUndefined()
            fx.played = true
            fx.score = { home: 3, away: 2 }
            fx.winnerId = fx.homeId
            totalGames++
          }
        }
        advanceSeasonCup(legend, world.seasonIndex, plan.drawSeed!)
      }
      expect(totalGames).toBe(37)
      expect(legend.rounds).toHaveLength(LEGEND_TOTAL_ROUNDS)
      // 校验 1/4 决赛首回合小组第 2 先主场、次回合小组第 1 享主场
      const qfL1 = legend.rounds[LEGEND_GROUP_ROUNDS]
      const qfL2 = legend.rounds[LEGEND_GROUP_ROUNDS + 1]
      expect(qfL1.leg).toBe(1)
      expect(qfL2.leg).toBe(2)
      LEGEND_QF_SLOTS.forEach(([g1, r1, g2, r2], idx) => {
        const seed1 = legend.groups![g1].table[r1].teamId
        const seed2 = legend.groups![g2].table[r2].teamId
        expect(qfL1.fixtures[idx].homeId).toBe(seed2)
        expect(qfL1.fixtures[idx].awayId).toBe(seed1)
        expect(qfL2.fixtures[idx].homeId).toBe(seed1)
        expect(qfL2.fixtures[idx].awayId).toBe(seed2)
      })
      expect(buildSeasonCupBracket(legend, plan.drawSeed)?.fixture?.winnerId).toBe(legend.championId)
    }
  })

  it('重排进行中的 5 项赛季杯赛时传奇杯 8 轮仍与级别杯和星联杯保持零冲突', () => {
    const start = Date.UTC(2026, 10, 9, 2)
    const { world } = makeSeason2World(321, start, 6)
    const plan = planSeasonCups(world, 321, kickoffAtForRound(start, 6) + 600_000)!
    applySeasonCupPlan(world, plan)
    for (const div of world.divisions) {
      for (const f of div.fixtures) if (f.round <= 10) { f.played = true; f.score = { home: 1, away: 0 } }
    }
    const now = kickoffAtForRound(start, 10) + 600_000
    expect(rescheduleActiveSeasonCups(world, now)).toBe(true)
    const champions = world.seasonCups!.cups.find((c) => c.id === 'champions')!
    const cross = world.seasonCups!.cups.find((c) => c.id === 'cross')!
    const legend = world.seasonCups!.cups.find((c) => c.id === 'legend')!
    expect(new Set([...champions.dates, ...cross.dates, ...legend.dates]).size).toBe(18)
  })
})

describe('传奇杯奖金规则（小组赛 0 金币，淘汰赛每轮发一次）、两回合引擎仿真与 UI', () => {
  it('paysSeasonCupAppearanceGold 仅在淘汰赛首回合/单场返回 true，小组赛与次回合返回 false', () => {
    expect(paysSeasonCupAppearanceGold({ stage: 'group' })).toBe(false)
    expect(paysSeasonCupAppearanceGold({ stage: 'knockout', leg: 1 })).toBe(true)
    expect(paysSeasonCupAppearanceGold({ stage: 'knockout', leg: 2 })).toBe(false)
    expect(paysSeasonCupAppearanceGold({ stage: 'knockout' })).toBe(true)
    expect(paysSeasonCupAppearanceGold({})).toBe(true)

    expect(SEASON_CUP_REWARDS.legend).toEqual({
      appearance: 300_000,
      champion: 3_000_000,
      ceiling: 0,
      book: LEGEND_CUP_REWARD_BOOK,
    })
    expect(CUP_CEILING_BONUS.legend).toBe(0)
    const game = createWorldGame(404)
    const startBal = game.economy!.balance
    expect(awardSeasonCupMatch(game, 'legend', 'm-lcup-qf-l1')).toBe(300_000)
    expect(awardSeasonCupMatch(game, 'legend', 'm-lcup-qf-l1')).toBe(0)
    const trophy = { cupId: 'season-legend', cupName: '传奇杯', seasonIndex: 2, wonAt: 1, finalOpponent: '巴塞罗那 2010-11', finalScore: { home: 2, away: 1 } }
    expect(awardSeasonCupChampion(game, 'legend', 2, trophy)).toEqual({
      gold: 3_000_000,
      ceiling: 0,
      book: { id: LEGEND_STAR_BOOK_ID, tier: 'rainbow' },
    })
    expect(applyCupCeilingReward(game, 'legend')).toBe(0)
    expect(cupCeilingBonus(game)).toBe(0)
    expect(game.legendBooks?.filter((b) => b.id === LEGEND_STAR_BOOK_ID)).toEqual([{ id: LEGEND_STAR_BOOK_ID, tier: 'rainbow' }])
    expect(game.economy!.balance).toBe(startBal + 3_300_000)
  })

  it('彩书《传奇之星》带入书槽即生效（不占 4+2 实战技能槽），10% 触发彩色事件二选一未满主属性净增 +100，每轮最多 3 次', () => {
    expect(LEGEND_STAR_EVENT_CHANCE).toBe(0.1)
    expect(skillEffectText(LEGEND_STAR_BOOK_ID, 'rainbow')).toContain('10%')
    const game = createWorldGame(505)
    addLegendBook(game, LEGEND_STAR_BOOK_ID, 'rainbow')
    const player = game.roster.find((p) => p.positions.GK === 0)!
    // 故意塞满 4 主 + 2 辅助技能槽：仍可正常带入《传奇之星》彩书
    player.skills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter', 'injury_prevention', 'injury_resilience']
    player.baseSkills = [...player.skills]
    expect(canChooseTrainingBook(player, LEGEND_CUP_REWARD_BOOK).ok).toBe(true)

    // 给部分主属性拉到上限，验证彩色事件跳过已满主属性，只从未满项中抽 2 项
    player.baseAttrs.passing = player.ceilings.passing
    player.attrs.passing = player.ceilings.passing
    player.baseAttrs.tackling = player.ceilings.tackling
    player.attrs.tackling = player.ceilings.tackling
    player.baseAttrs.shooting = Math.min(player.baseAttrs.shooting, player.ceilings.shooting - 250)
    player.attrs.shooting = player.baseAttrs.shooting

    // 满级设施 + 低落心情，验证彩色事件净增精确为 +100（不叠建筑、不被低落心情减半）
    const maxFac = { stadium: 25, academy: 25, medical: 25, shop: 25, sponsor: 25, psychology: 25, tactics: 25 }
    const session = createTrainingSession(player, 202601, maxFac, 1, [LEGEND_CUP_REWARD_BOOK], 44)
    session.lowMoodWeeks = [1, 2, 3, 4]
    // 周一交流赛技能池不会出现被动彩书《传奇之星》
    expect(drawTrainingSkills(session).some((c) => c.id === LEGEND_STAR_BOOK_ID)).toBe(false)

    // 验证事件结构、刷新幂等与净增 +100
    session.pendingEventId = LEGEND_STAR_EVENT_ID
    session.pendingEventAction = 3
    const ev1 = eventForSession(session, LEGEND_STAR_EVENT_ID)!
    const ev2 = legendStarEventFor(session, 3)!
    expect(ev1.rarity).toBe('rainbow')
    expect(ev1.options).toHaveLength(2)
    expect(ev1.options.map((o) => o.id)).toEqual(ev2.options.map((o) => o.id))
    expect(ev1.options.every((o) => o.id !== 'legend-star-passing' && o.id !== 'legend-star-tackling')).toBe(true)
    const chosenAttr = ev1.options[0].id.replace('legend-star-', '') as keyof typeof session.candidate.attrs
    const beforeVal = session.candidate.attrs[chosenAttr]
    const expectedGain = Math.min(LEGEND_STAR_ATTR_GAIN, session.candidate.ceilings[chosenAttr] - beforeVal)

    // 渲染培养页时展示彩色事件流光面板与被动书槽进度
    game.training[player.id] = session
    setGame(game)
    ui.trainingPlayerId = player.id
    const trainHtml = renderTraining()
    expect(trainHtml).toContain('event-rainbow')
    expect(trainHtml).toContain('彩色事件 · 传奇之星')
    expect(trainHtml).toContain('0/3 次')

    const resolved = resolveTrainingEvent(session, ev1.options[0].id)
    expect(resolved.ok).toBe(true)
    expect(session.candidate.attrs[chosenAttr] - beforeVal).toBeCloseTo(expectedGain, 5)
    expect(legendStarTriggersUsed(session)).toBe(1)
    expect(session.candidate.skills).toEqual(player.skills)

    // 跑完整轮自动培养（多组种子），确认能稳定触发彩色事件、永不超过 3 次上限，且不占实战技能槽
    let totalTriggered = 0
    for (const seed of [101, 202, 303, 404, 505]) {
      const g = createWorldGame(seed)
      addLegendBook(g, LEGEND_STAR_BOOK_ID, 'rainbow')
      const p = g.roster.find((item) => item.positions.GK === 0)!
      p.skills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter', 'injury_prevention', 'injury_resilience']
      p.baseSkills = [...p.skills]
      expect(startTraining(g, p.id, seed, [bookKey(LEGEND_CUP_REWARD_BOOK)]).ok).toBe(true)
      const autoRes = runAutoTraining(g, p.id, 120)
      expect(autoRes.ok).toBe(true)
      expect(autoRes.completed).toBe(true)
      const used = legendStarTriggersUsed(g.training[p.id])
      expect(used).toBeLessThanOrEqual(LEGEND_STAR_MAX_TRIGGERS)
      expect(g.training[p.id].candidate.skills).not.toContain(LEGEND_STAR_BOOK_ID)
      totalTriggered += used
    }
    expect(totalTriggered).toBeGreaterThan(0)

    // 隐藏彩蛋（0.1%）：不在任何技能/更新说明中出现；触发时直接继承同位置真实球星的彩虹招牌技能（支持升彩、空槽直学、满槽替换与放弃）
    expect(LEGEND_STAR_INHERIT_CHANCE).toBe(0.001)
    const publicTexts = [
      SPECIAL_BOOK_SKILLS.lg_legend_star.desc,
      SPECIAL_BOOK_SKILLS.lg_legend_star.effect,
      skillEffectText(LEGEND_STAR_BOOK_ID, 'rainbow'),
      ...CHANGELOG_RELEASES.map((r) => `${r.headline}${r.summary}${r.items.map((i) => i.title + i.desc).join('')}`),
    ].join('\n')
    expect(publicTexts).not.toMatch(/0\.1%|奇遇|传奇降临/)

    const eggGame = createWorldGame(606)
    addLegendBook(eggGame, LEGEND_STAR_BOOK_ID, 'rainbow')
    const striker = eggGame.roster.find((p) => p.positions.GK === 0)!
    striker.positions = { GK: 0, CB: 0, W: 20, CM: 30, ST: 95 }
    striker.basePositions = { ...striker.positions }
    striker.skills = ['safe_pass', 'one_touch', 'long_shot', 'weak_foot']
    striker.skillTiers = { safe_pass: 'silver', one_touch: 'gold', long_shot: 'silver', weak_foot: 'silver' }
    striker.baseSkills = [...striker.skills]
    const eggSession = createTrainingSession(striker, 999, undefined, 1, [LEGEND_CUP_REWARD_BOOK], 40)
    eggSession.pendingEventId = LEGEND_STAR_INHERIT_EVENT_ID
    eggSession.pendingEventAction = 7
    const eggEv = eventForSession(eggSession, LEGEND_STAR_INHERIT_EVENT_ID)!
    expect(eggEv).toEqual(legendStarInheritEventFor(eggSession, 7))
    expect(eggEv.rarity).toBe('rainbow')
    const inheritOpt = eggEv.options[0]
    expect(inheritOpt.rainbowInherit).toBeDefined()
    const inheritedSkill = inheritOpt.rainbowInherit!.skill
    // 同位置前锋招牌技能之一
    expect(['box_hunter', 'aerial', 'one_touch']).toContain(inheritedSkill)
    if (eggSession.candidate.skills.includes(inheritedSkill)) {
      // 已有该技能：无需替换，直接升格彩虹
      expect(resolveTrainingEvent(eggSession, inheritOpt.id).ok).toBe(true)
    } else {
      // 4/4 主技能槽满：必须指定替换
      expect(resolveTrainingEvent(eggSession, inheritOpt.id).ok).toBe(false)
      expect(resolveTrainingEvent(eggSession, inheritOpt.id, 'safe_pass').ok).toBe(true)
      expect(eggSession.candidate.skills).not.toContain('safe_pass')
    }
    expect(eggSession.candidate.skills).toContain(inheritedSkill)
    expect(eggSession.candidate.skillTiers?.[inheritedSkill]).toBe('rainbow')
  })

  it('首回合无点球；次回合按 aggregateOffset 判定总比分（总比分平必点球、单场平但总分不平不点球）', () => {
    const { world } = makeSeason2World(611)
    const teams = buildOwnerlessTeams(world, 611)
    const champId = world.divisions.find((d) => d.divisionId === 'champions')!.clubIds![0]
    const barca = legendCupTeamById('lcup-barcelona-2010-11')!
    const city = legendCupTeamById('lcup-man-city-2022-23')!
    const makeJob = (
      comp: NonNullable<MatchJob['competition']>,
      home: typeof barca,
      away: typeof city,
      seed: number,
      coachId?: string,
    ): MatchJob => ({
      id: `q-test-${comp.fixtureId}`,
      season: 2,
      divisionId: 'season-cup-legend',
      round: 4,
      competition: comp,
      kickoffAt: Date.UTC(2026, 10, 12, 12),
      lockedAt: Date.UTC(2026, 10, 12, 11, 30),
      seed,
      gameDayMs: 7_200_000,
      home: { team: structuredClone(home), injuries: {}, suspended: [], medical: 25, tacticsStage: 25, stadiumStage: 25, ...(coachId ? { coachId } : { ai: true }) },
      away: { team: structuredClone(away), injuries: {}, suspended: [], medical: 25, tacticsStage: 25, stadiumStage: 25, ai: true },
    })

    // 两回合首回合（leg: 1）：不进入点球
    const leg1Res = computeMatchJob(makeJob({ kind: 'seasonCup', cupId: 'legend', fixtureId: 'qf-l1', stage: 'knockout', leg: 1 }, barca, city, 123))
    expect(leg1Res.record.isLeague).toBe(false)
    expect(leg1Res.record.mode).toBe('cup')
    expect(leg1Res.record.shootout).toBeUndefined()

    // 两回合次回合（leg: 2）：传入精确反相的 aggregateOffset，强制使两回合总比分战平，验证即使单场非平局也能触发点球！
    const probe = computeMatchJob(makeJob({ kind: 'seasonCup', cupId: 'legend', fixtureId: 'qf-probe', stage: 'knockout', leg: 1 }, city, barca, 456))
    const offsetToTie = { home: probe.record.score.away, away: probe.record.score.home }
    const leg2Tied = computeMatchJob(makeJob(
      { kind: 'seasonCup', cupId: 'legend', fixtureId: 'qf-l2-tie', stage: 'knockout', leg: 2, aggregateOffset: offsetToTie },
      city,
      barca,
      456,
    ))
    const totalHome = leg2Tied.record.score.home + offsetToTie.home
    const totalAway = leg2Tied.record.score.away + offsetToTie.away
    if (totalHome === totalAway) {
      expect(leg2Tied.record.shootout).toBeDefined()
      expect(leg2Tied.record.shootout!.home).not.toBe(leg2Tied.record.shootout!.away)
    }

    // 真人执教（PesEngine）踢次回合也能正常带 aggregateOffset 模拟并生成回放初始状态
    const pesLeg2 = computeMatchJob(makeJob(
      { kind: 'seasonCup', cupId: 'legend', fixtureId: 'qf-pes-l2', stage: 'knockout', leg: 2, aggregateOffset: { home: 1, away: 2 } },
      teams[champId],
      barca,
      789,
      'coach-1',
    ))
    expect(pesLeg2.initialState).toBeDefined()
    expect(pesLeg2.initialState!.shootoutOffset).toEqual({ home: 1, away: 2 })
    expect(pesLeg2.record.isLeague).toBe(false)
  }, 60_000)

  it('调度器走完传奇杯 8 轮（小组赛 0 金币 + 1/4·半决赛两回合每轮只发一次 + 决赛发参赛金与冠军奖），真人执教端到端校验通过', async () => {
    const seed = 888, start = Date.UTC(2026, 10, 9, 2)
    const { world, top4, freeStars, reserveStars } = makeSeason2World(seed, start, 6)
    const plan = planSeasonCups(world, seed, kickoffAtForRound(start, 6) + 600_000)!
    applySeasonCupPlan(world, plan)
    world.seasonCupMode = 1
    const teams = buildOwnerlessTeams(world, seed)

    // 1. 调度器跑完 18 个杯赛日期（含传奇杯 8 轮 37 场，含两回合总比分平局点球和单场平但总比分不平）
    const qDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-legend-cup-q-'))
    dirs.push(qDir)
    const aiClubs = seedAIClubs(world, seed)
    const queue = new MatchQueue(qDir, {
      intervalMs: 0,
      compute: async (job) => {
        const comp = job.competition
        let score = { home: 2, away: 0 }
        let shootout: { home: number; away: number } | undefined
        if (comp?.cupId === 'legend') {
          if (comp.stage === 'group' && job.round === 1) {
            score = { home: 1, away: 1 }
          } else if (comp.stage === 'group') {
            // 让世界队赢球以便晋级 8 强验证两回合奖金
            score = !isLegendCupTeamId(job.away.team.id) && isLegendCupTeamId(job.home.team.id)
              ? { home: 0, away: 2 }
              : { home: 2, away: 0 }
          } else if (comp.leg === 1) {
            score = { home: 2, away: 1 }
          } else if (comp.leg === 2) {
            // 首回合 2:1 → offset={home:1, away:2}；次回合踢 1:0 使总比分 2:2 进点球，验证两回合点球晋级！
            score = { home: 1, away: 0 }
            shootout = { home: 5, away: 4 }
          } else {
            score = { home: 2, away: 1 }
          }
        }
        return {
          id: job.id,
          record: { id: job.id, score, ...(shootout ? { shootout } : {}), playerStats: [] } as unknown as MatchRecord,
          fixture: { score, ...(shootout ? { shootout } : {}), matchId: job.id },
          injuries: {},
          conditionLoss: {},
          appearances: {},
          cards: [],
        }
      },
    })
    queues.push(queue)
    const schedulerWorld = structuredClone(world)
    const scheduler = new MatchScheduler(
      queue,
      { seed, world: schedulerWorld, teams: structuredClone(teams), aiClubs, matchBook: emptyMatchBook() },
      (id) => {
        const lt = legendCupTeamById(id)
        if (lt) return { team: lt, injuries: {}, suspended: [], medical: 25, tacticsStage: 25, stadiumStage: 25, ai: true }
        return teams[id] ? { team: structuredClone(teams[id]), injuries: {}, suspended: [], medical: 1, ai: true } : null
      },
      () => {},
      true,
    )
    const allDates = [...new Set(schedulerWorld.seasonCups!.cups.flatMap((c) => c.dates))].sort((a, b) => a - b)
    expect(allDates).toHaveLength(18)
    for (const date of allDates) {
      for (const div of schedulerWorld.divisions) {
        for (const f of div.fixtures) if (f.kickoffAt! < date) { f.played = true; f.score ??= { home: 1, away: 0 } }
      }
      scheduler.refresh(date - 30 * 60_000)
      const queued = [...queue.entries.values()].filter((e) => e.status === 'queued').length
      for (let i = 0; i < queued; i++) await queue.pump(date - 30 * 60_000)
      scheduler.refresh(date + 600_000)
    }
    const doneLegend = schedulerWorld.seasonCups!.cups.find((c) => c.id === 'legend')!
    expect(doneLegend.championId).toBeTruthy()
    expect(doneLegend.rounds).toHaveLength(8)
    expect(doneLegend.rounds.reduce((s, r) => s + r.fixtures.length, 0)).toBe(37)
    expect(schedulerWorld.seasonCups!.cups.every((c) => !!c.championId)).toBe(true)

    // 校验 AI 奖金：小组赛 0、两回合首回合 300,000、次回合 0（每轮发一次）、决赛 300,000
    for (const round of doneLegend.rounds) {
      for (const fx of round.fixtures) {
        for (const clubId of [fx.homeId, fx.awayId]) {
          const ai = aiClubs[clubId]
          if (!ai) continue
          if (paysSeasonCupAppearanceGold(fx)) {
            expect(ai.seasonCupGoldClaims?.[`match:${fx.matchId}`]).toBe(300_000)
          } else {
            expect(ai.seasonCupGoldClaims?.[`match:${fx.matchId}`]).toBeUndefined()
          }
        }
      }
    }

    // 2. 真实 HTTP 服务器：验证真人执教两回合淘汰赛只发一次 300,000（首回合发、次回合不重复发），且次回合总比分平局点球晋级
    const kDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-legend-cup-2leg-'))
    dirs.push(kDir)
    const d2ClubId = world.divisions.find((d) => d.divisionId === 'd2-north')!.clubIds![0]
    const leg1At = Date.UTC(2026, 10, 14, 12)
    const leg2At = Date.UTC(2026, 10, 15, 12)
    const finalAt = Date.UTC(2026, 10, 16, 12)
    const koWorld = structuredClone(world)
    for (const div of koWorld.divisions) {
      for (const f of div.fixtures) if (f.kickoffAt! < finalAt) { f.played = true; f.score = { home: 1, away: 0 } }
    }
    koWorld.seasonCups = {
      version: 1,
      seasonIndex: 2,
      qualificationRound: 6,
      createdAt: leg1At - 24 * 3600_000,
      delayedLeagueRounds: [],
      cups: [
        { id: 'community', name: '社区杯', entrants: [], dates: [], rounds: [], championId: d2ClubId },
        { id: 'league', name: '联盟杯', entrants: [], dates: [], rounds: [], championId: d2ClubId },
        { id: 'champions', name: '冠军杯', entrants: [], dates: [], rounds: [], championId: d2ClubId },
        { id: 'cross', name: '星联杯', entrants: [], dates: [], rounds: [], championId: d2ClubId },
        {
          id: 'legend',
          name: '传奇杯',
          entrants: [d2ClubId, 'lcup-barcelona-2010-11', 'lcup-real-madrid-2016-17', 'lcup-milan-1988-89'],
          dates: [leg1At, leg2At, finalAt],
          groups: [{ index: 0, name: 'A 组', teamIds: [d2ClubId, 'lcup-barcelona-2010-11'], table: [] }],
          rounds: [{
            round: 1,
            kickoffAt: leg1At,
            stage: 'knockout',
            leg: 1,
            byes: [],
            fixtures: [
              { id: 'sf-l1-1', cupId: 'legend', round: 1, stage: 'knockout', leg: 1, homeId: d2ClubId, awayId: 'lcup-barcelona-2010-11', kickoffAt: leg1At, played: false },
              { id: 'sf-l1-2', cupId: 'legend', round: 1, stage: 'knockout', leg: 1, homeId: 'lcup-real-madrid-2016-17', awayId: 'lcup-milan-1988-89', kickoffAt: leg1At, played: false },
            ],
          }],
        },
      ],
    }
    fs.writeFileSync(path.join(kDir, 'world.json'), JSON.stringify({ seed, startedAt: start, owners: {}, world: koWorld, teams, freeStars, reserveStars }))
    let koClock = leg1At - 31 * 60_000
    const koApp = createAppServer({
      dataDir: kDir,
      tickMs: 0,
      now: () => koClock,
      seasonCups: true,
      matchQueue: {
        intervalMs: 0,
        compute: async (job) => {
          const res = await fastMatchResult(job)
          if (job.competition) {
            res.record.isLeague = false
            res.record.mode = 'cup'
            res.record.cupId = `season-${job.competition.cupId}`
            res.record.cupFixtureId = job.competition.fixtureId
          }
          if (job.competition?.leg === 1) {
            // 首回合 d2ClubId 主场 2:1 巴萨
            res.record.score = { home: 2, away: 1 }
          } else if (job.competition?.leg === 2) {
            // 次回合巴萨主场 1:0 → 总比分 2:2，客队 d2ClubId 点球 5:4 晋级！
            res.record.score = { home: 1, away: 0 }
            res.record.shootout = { home: 4, away: 5 }
            if (job.competition.aggregateOffset) {
              res.record.aggregateScore = {
                home: res.record.score.home + job.competition.aggregateOffset.home,
                away: res.record.score.away + job.competition.aggregateOffset.away,
              }
            }
          } else {
            // 单场决赛 d2ClubId 夺冠
            res.record.score = { home: 2, away: 1 }
          }
          res.fixture.score = { ...res.record.score }
          if (res.record.shootout) res.fixture.shootout = { ...res.record.shootout }
          return res
        },
      },
    })
    servers.push(koApp)
    await new Promise<void>((resolve) => koApp.server.listen(0, '127.0.0.1', resolve))
    const koBase = `http://127.0.0.1:${(koApp.server.address() as AddressInfo).port}`
    const koReg = await fetch(`${koBase}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ username: 'lcup_2leg_champ', password: 'secret123', clubId: d2ClubId }),
    })
    expect(koReg.status).toBe(201)
    const koHeaders = { Authorization: `Bearer ${((await koReg.json()) as { token: string }).token}`, 'Content-Type': 'application/json', Connection: 'close' }

    // 校验 /api/world/club?id=lcup-barcelona-2010-11
    const clubRes = await fetch(`${koBase}/api/world/club?id=lcup-barcelona-2010-11`, { headers: koHeaders })
    expect(clubRes.status).toBe(200)
    const clubBody = (await clubRes.json()) as { club: { id: string; name: string; players: { ca: number }[]; rating: number } }
    expect(clubBody.club.name).toBe('巴塞罗那 2010-11')
    expect(clubBody.club.players).toHaveLength(16)
    expect(clubBody.club.rating).toBeGreaterThanOrEqual(1900 * 11 - 50)

    const beforeKo = (await (await fetch(`${koBase}/api/game`, { headers: koHeaders })).json()) as { game: GameState; revision: number }
    const bal0 = beforeKo.game.economy!.balance
    // 客户端伪造 legend 上限领取或专属彩书《传奇之星》均应被服务器剥离
    const forged = structuredClone(beforeKo.game)
    forged.pve!.cupCeilingClaims = { ...(forged.pve!.cupCeilingClaims ?? {}), legend: true }
    forged.legendBooks = [...(forged.legendBooks ?? []), { id: LEGEND_STAR_BOOK_ID, tier: 'rainbow' }]
    const forgeSave = await fetch(`${koBase}/api/game`, { method: 'PUT', headers: koHeaders, body: JSON.stringify({ game: forged, baseRevision: beforeKo.revision }) })
    expect(forgeSave.status).toBe(200)
    const afterForge = (await (await fetch(`${koBase}/api/game`, { headers: koHeaders })).json()) as { game: GameState }
    expect(afterForge.game.pve?.cupCeilingClaims?.legend).toBeUndefined()
    expect(afterForge.game.legendBooks?.some((b) => b.id === LEGEND_STAR_BOOK_ID)).toBe(false)

    // 首回合：发放半决赛本轮参赛金 +300,000
    koClock = leg1At - 30 * 60_000
    for (let i = 0; i < 6; i++) await koApp.runMatchQueue()
    koClock = leg1At + 600_000
    await koApp.runMatchQueue()
    const afterL1 = (await (await fetch(`${koBase}/api/game`, { headers: koHeaders })).json()) as { game: GameState }
    expect(afterL1.game.economy!.balance).toBe(bal0 + 300_000)

    // 次回合：不重复发参赛金（余额仍为 bal0 + 300,000），点球淘汰巴萨进决赛且战报显示点球胜与总比分 2:2
    koClock = leg2At - 30 * 60_000
    for (let i = 0; i < 6; i++) await koApp.runMatchQueue()
    koClock = leg2At + 600_000
    await koApp.runMatchQueue()
    const afterL2 = (await (await fetch(`${koBase}/api/game`, { headers: koHeaders })).json()) as { game: GameState }
    expect(afterL2.game.economy!.balance).toBe(bal0 + 300_000)
    expect(afterL2.game.challengeHistory[0].result).toBe('win')
    expect(afterL2.game.challengeHistory[0].aggregateScore).toEqual({ home: 2, away: 2 })

    // 决赛：单场参赛金 +300,000 + 冠军奖金 +3,000,000 + 首次夺冠唯一彩书《传奇之星》（不加主属性上限）
    koClock = finalAt - 30 * 60_000
    for (let i = 0; i < 6; i++) await koApp.runMatchQueue()
    koClock = finalAt + 600_000
    await koApp.runMatchQueue()
    const afterFinal = (await (await fetch(`${koBase}/api/game`, { headers: koHeaders })).json()) as { game: GameState; revision: number }
    expect(afterFinal.game.economy!.balance).toBe(bal0 + 300_000 + 300_000 + 3_000_000)
    expect(afterFinal.game.pve?.cupCeilingClaims?.legend).toBeUndefined()
    expect(afterFinal.game.legendBooks).toEqual(expect.arrayContaining([{ id: LEGEND_STAR_BOOK_ID, tier: 'rainbow' }]))
    expect(afterFinal.game.pve?.trophies).toEqual(expect.arrayContaining([expect.objectContaining({
      cupId: 'season-legend',
      goldPrize: 3_000_000,
      rewardBook: { id: LEGEND_STAR_BOOK_ID, tier: 'rainbow' },
    })]))

    // 3. 验证前端杯赛页渲染：小组赛 4 组 + 两回合淘汰赛卡片（首回合/次回合/总比分）+ 传奇豪门名单无球探按钮
    const uiGame = createWorldGameFromWorld(schedulerWorld, top4[0], seed, start, freeStars, reserveStars)
    setGame(uiGame)
    onlineState.status = 'online'
    const html = renderSeasonCups(uiGame, 'legend')
    expect(html).toContain('data-season-cup-tab="legend" class="active"')
    expect(html).toContain('小组赛积分榜与赛果')
    expect(html).toContain('四分之一决赛 · 两回合')
    expect(html).toContain('半决赛 · 两回合')
    expect(html).toContain('决赛 · 单场')
    expect(html).toContain('首回合')
    expect(html).toContain('次回合')
    expect(html).toContain('总比分')
    expect(html).toContain('淘汰赛每轮参赛金')
    expect(html).toContain('小组赛不发奖金')
    expect(html).toContain('彩书 · 传奇之星')
    expect(clubLook('lcup-man-city-2022-23')).toMatchObject({ name: '曼城 2022-23', color: '#6cabdd' })
    const pubBarca = publicClubFor(uiGame.world, 'lcup-barcelona-2010-11')!
    expect(pubBarca.players).toHaveLength(16)
    const modalHtml = clubRosterPanel(pubBarca, pubBarca.players[0].id)
    expect(modalHtml).toContain('传奇杯 CA 1900')
    expect(modalHtml).not.toContain('派出球探')
    expect(legendCupMetaById('lcup-barcelona-2010-11')?.coach).toBe('瓜迪奥拉')
  }, 120_000)

  it('第 1 赛季尚无上季冠联前 4 时，杯赛页传奇杯标签展示小组赛+两回合淘汰赛预告与 12 支历史豪门', () => {
    const start = Date.UTC(2026, 10, 9, 12)
    const { world, freeStars, reserveStars } = createOwnerlessWorld(707, start)
    for (const div of world.divisions) for (const f of div.fixtures) if (f.round <= 6) { f.played = true; f.score = { home: 1, away: 0 } }
    const plan = planSeasonCups(world, 707, kickoffAtForRound(start, 6) + 600_000)!
    expect(plan.cups.map((c) => c.id)).toEqual(['community', 'league', 'champions', 'cross'])
    applySeasonCupPlan(world, plan)
    world.seasonCupMode = 1
    const own = world.divisions.find((d) => d.divisionId === 'd2-north')!.clubIds![0]
    const uiGame = createWorldGameFromWorld(world, own, 707, start, freeStars, reserveStars)
    setGame(uiGame)
    onlineState.status = 'online'
    const html = renderSeasonCups(uiGame, 'legend')
    expect(html).toContain('data-season-cup-tab="legend" class="active"')
    expect(html).toContain('下赛季开启')
    expect(html).toContain('8 强主客场淘汰赛（决赛单场）')
    expect(html).toContain('小组赛不发奖金')
    expect(html).toContain('彩书 · 传奇之星')
    expect(html).toContain('特邀 12 支历史最强俱乐部')

    // 第 2 赛季第 6 轮前：传奇杯已提前开赛，其余 4 项杯赛等待第 6 轮公布
    const { world: s2w, top4: s2Top4, freeStars: s2Free, reserveStars: s2Res } = makeSeason2World(708, start, 1)
    const earlyPlan = planSeasonCups(s2w, 708, kickoffAtForRound(start, 1) + 600_000)!
    applySeasonCupPlan(s2w, earlyPlan)
    s2w.seasonCupMode = 1
    const earlyGame = createWorldGameFromWorld(s2w, s2Top4[0], 708, start, s2Free, s2Res)
    setGame(earlyGame)
    expect(renderSeasonCups(earlyGame, 'community')).toContain('传奇杯已提前开赛')
    expect(renderSeasonCups(earlyGame, 'legend')).toContain('小组赛积分榜与赛果')
  })
})
