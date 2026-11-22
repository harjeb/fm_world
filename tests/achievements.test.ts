import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import {
  ACHIEVEMENTS,
  PEAK_WELFARE_ACHIEVEMENT_ID,
  PEAK_WELFARE_MONEY,
  achievementSummary,
  claimAchievement,
  claimAllAchievements,
  claimableAchievementCount,
  ensureAchievements,
} from '../src/game/achievements.ts'
import { economyOf } from '../src/game/economy.ts'
import { ensureShop, shopPointsOf } from '../src/game/shop.ts'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { roundKickoffAt } from '../src/game/season.ts'
import { lineupRating } from '../src/game/club-rating.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import { APP_VERSION, CHANGELOG_RELEASES } from '../src/game/changelog.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { agentView, applyAgentAction } from '../server/agent.ts'
import { readStoredAccounts, writeStoredAccounts } from './account-storage-helpers.ts'
import { renderAchievements } from '../src/ui/screens/achievements.ts'
import { renderHome } from '../src/ui/screens/home.ts'
import { renderChallenge } from '../src/ui/screens/challenge.ts'
import { renderSidebar } from '../src/ui/screens/shell.ts'
import { game as originalGame, setGame, ui } from '../src/ui/state.ts'
import { onlineState } from '../src/online.ts'
import type { MatchRecord } from '../src/game/types.ts'

beforeAll(loadPveContent)

const servers: AppServer[] = []
const dirs: string[] = []
const originalStatus = onlineState.status

async function startServer(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-ach-test-'))) {
  if (!dirs.includes(dir)) dirs.push(dir)
  const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir }
}

async function register(base: string, username: string) {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(res.status).toBe(201)
  return res.json() as Promise<{ token: string; revision: number; game: Record<string, any> }>
}

afterEach(() => {
  setGame(originalGame)
  onlineState.status = originalStatus
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('v1.0 成就系统与巅峰首胜 100 万福利', () => {
  it('版本号更新至 v1.0.0 且与更新日志首条一致', () => {
    expect(APP_VERSION).toBe('v1.0.0')
    expect(CHANGELOG_RELEASES[0]?.version).toBe('v1.0.0')
  })

  it('老存档已打过巅峰第 1 关自动幂等补发 100 万金币；新存档通关后可手动领取且不可重复领', () => {
    // 1. 模拟 1.0 上线前的老存档：无 achievements 字段，但已打通巅峰第 1 关
    const legacy = createInitialGame(1001)
    delete legacy.achievements
    legacy.pve!.peak.cleared = 3
    const beforeLegacyBal = economyOf(legacy).balance

    const firstSync = ensureAchievements(legacy, 10_000)
    expect(firstSync.changed).toBe(true)
    expect(firstSync.backfilledMoney).toBe(PEAK_WELFARE_MONEY)
    expect(economyOf(legacy).balance).toBe(beforeLegacyBal + PEAK_WELFARE_MONEY)
    const legacyAch = (legacy as { achievements?: { claimed: Record<string, { backfilled?: true }>; welfareBackfillMoney?: number } }).achievements
    expect(legacyAch?.claimed[PEAK_WELFARE_ACHIEVEMENT_ID]?.backfilled).toBe(true)
    expect(legacyAch?.welfareBackfillMoney).toBe(PEAK_WELFARE_MONEY)

    // 重复调用严格幂等，不重复发钱
    const secondSync = ensureAchievements(legacy, 20_000)
    expect(secondSync.changed).toBe(false)
    expect(secondSync.backfilledMoney).toBe(0)
    expect(economyOf(legacy).balance).toBe(beforeLegacyBal + PEAK_WELFARE_MONEY)

    // 已补发的福利不能再手领一次
    expect(claimAchievement(legacy, PEAK_WELFARE_ACHIEVEMENT_ID).ok).toBe(false)

    // 2. 新存档（1.0 新建）：初始未通关时不发钱；通关第 1 关后变为可领取，领取拿到 100 万
    const fresh = createInitialGame(1002)
    expect(fresh.achievements?.welfareBackfillChecked).toBe(true)
    expect(claimAchievement(fresh, PEAK_WELFARE_ACHIEVEMENT_ID).ok).toBe(false)

    fresh.pve!.peak.cleared = 1
    expect(claimableAchievementCount(fresh)).toBeGreaterThanOrEqual(1)
    const balBeforeClaim = economyOf(fresh).balance
    const claimed = claimAchievement(fresh, PEAK_WELFARE_ACHIEVEMENT_ID, 30_000)
    expect(claimed.ok).toBe(true)
    if (claimed.ok) {
      expect(claimed.money).toBe(PEAK_WELFARE_MONEY)
      expect(claimed.balance).toBe(balBeforeClaim + PEAK_WELFARE_MONEY)
    }
    expect(economyOf(fresh).balance).toBe(balBeforeClaim + PEAK_WELFARE_MONEY)
    expect(claimAchievement(fresh, PEAK_WELFARE_ACHIEVEMENT_ID).ok).toBe(false)
  })

  it('各项里程碑成就正确判定进度并在一键领取时发放商店点券与金币', () => {
    const game = createWorldGame(1003)

    // 触发多类别成就：巅峰 5 关、传奇 1 胜、球员卡 10 张（含 cardSeq）、设施 2 级、杯赛奖杯 1 座
    game.pve!.peak.cleared = 5
    game.pve!.legends['barcelona-2010-11'] = { played: 1, won: 1, drawn: 0, lost: 0, goals: 2, conceded: 1 }
    game.cardSeq = 10
    economyOf(game).academy = 6 // LV2
    game.pve!.trophies.push({
      cupId: 'season-community',
      cupName: '社区杯',
      seasonIndex: 1,
      wonAt: 1000,
      finalOpponent: '测试对手',
      finalScore: { home: 2, away: 0 },
    })
    ensureShop(game)
    const bal0 = economyOf(game).balance
    const pts0 = shopPointsOf(game)

    const summary = achievementSummary(game)
    expect(summary.total).toBe(ACHIEVEMENTS.length)
    expect(summary.claimable).toBeGreaterThanOrEqual(7)
    expect(summary.pendingMoney).toBe(PEAK_WELFARE_MONEY)
    expect(summary.pendingShopPoints).toBeGreaterThanOrEqual(30 + 40 + 20 + 50 + 30 + 80)

    const res = claimAllAchievements(game, 50_000)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.money).toBe(PEAK_WELFARE_MONEY)
      expect(res.shopPoints).toBe(summary.pendingShopPoints)
    }
    expect(economyOf(game).balance).toBe(bal0 + PEAK_WELFARE_MONEY)
    expect(shopPointsOf(game)).toBe(pts0 + summary.pendingShopPoints)
    expect(claimableAchievementCount(game)).toBe(0)
    expect(claimAllAchievements(game).ok).toBe(false)

    // Agent API 同步支持
    game.pve!.peak.cleared = 10
    ensureShop(game)
    const ptsBeforeAgent = shopPointsOf(game)
    const view = agentView(game)
    expect(view.achievements.claimable).toBeGreaterThanOrEqual(1)
    const agentClaim = applyAgentAction(game, { action: 'claim_achievement', id: 'peak_clear_10' })
    expect(agentClaim.ok).toBe(true)
    expect(shopPointsOf(game)).toBe(ptsBeforeAgent + 50)
  })

  it('联机服务器自动为已过巅峰 1 关老账号补发 100 万，并权威校验 /api/achievements/claim 防篡改', async () => {
    const first = await startServer()
    await register(first.base, 'ach_alice')

    // 模拟重启前的老存档：无 achievements，但已通关巅峰第 5 关且有 1 张培养卡
    first.app.close()
    servers.pop()
    const stored = readStoredAccounts(first.dir)
    const alice = stored.accounts.find((acc: any) => acc.username === 'ach_alice')!
    const beforeBal = alice.game.economy!.balance
    alice.game.pve!.peak.cleared = 5
    alice.game.pve!.peak.stageRewardVersion = 2
    alice.game.pve!.peak.claimedStageRewards = [1, 2, 3, 4, 5]
    alice.game.cardSeq = 1
    delete alice.game.achievements
    writeStoredAccounts(first.dir, stored)

    const restarted = await startServer(first.dir)
    const loginRes = await fetch(`${restarted.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ach_alice', password: 'secret123' }),
    })
    expect(loginRes.status).toBe(200)
    const { token } = await loginRes.json() as { token: string }

    const loaded = await (await fetch(`${restarted.base}/api/game`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json() as { revision: number; game: Record<string, any> }

    // 已自动补发 100 万金币（且未动巅峰商店点数之外的成就点券）
    expect(loaded.game.economy.balance).toBe(beforeBal + PEAK_WELFARE_MONEY)
    expect(loaded.game.achievements.claimed[PEAK_WELFARE_ACHIEVEMENT_ID]?.backfilled).toBe(true)
    const pointsBefore = loaded.game.shop.points

    // 伪造清空 achievements.claimed 试图重领 → 服务器 PUT /api/game 忽略客户端 achievements
    const forged = structuredClone(loaded.game)
    forged.achievements = { version: 1, claimed: {}, welfareBackfillChecked: true }
    const putRes = await fetch(`${restarted.base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: forged, baseRevision: loaded.revision }),
    })
    expect(putRes.status).toBe(200)

    // 通过权威接口一键领取剩余可领成就（peak_clear_5 +30, cards_1 +20，不含已补发的 100 万）
    const claimRes = await fetch(`${restarted.base}/api/achievements/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    expect(claimRes.status).toBe(200)
    const claimed = await claimRes.json() as { ok: boolean; money: number; shopPoints: number; game: Record<string, any> }
    expect(claimed.ok).toBe(true)
    expect(claimed.money).toBe(0)
    expect(claimed.shopPoints).toBeGreaterThanOrEqual(50)
    expect(claimed.game.shop.points).toBe(pointsBefore + claimed.shopPoints)
    expect(claimed.game.economy.balance).toBe(beforeBal + PEAK_WELFARE_MONEY)
  })
})

describe('v1.0 UI：成就页、总览联赛/杯赛分色、友谊赛五星实力与挑战 RANK', () => {
  it('成就页与侧栏徽章正常渲染，展示 1.0 福利自动补发提示与领取按钮', () => {
    const game = createWorldGame(1004)
    delete game.achievements
    game.pve!.peak.cleared = 5
    ensureAchievements(game)
    setGame(game)

    const sidebar = renderSidebar()
    expect(sidebar).toContain('data-nav="achievements"')
    const html = renderAchievements()
    expect(html).toContain('1.0 正式版巅峰首胜福利已自动补发')
    expect(html).toContain('已自动补发')
    expect(html).toContain('一键领取全部')
    expect(html).toContain('商店点券 +30')
  })

  it('总览页对「联赛」与「杯赛」采用不同颜色标签区分，且展示待领成就提示条', () => {
    const game = createWorldGame(1005, undefined, undefined, Date.UTC(2026, 10, 9, 12))
    game.cardSeq = 1
    game.matchHistory = [
      { id: 'm-league', isLeague: true, round: 1, score: { home: 2, away: 1 }, result: 'win', homeId: 'player', awayId: 'a1', homeName: '我队', awayName: '对手A' } as MatchRecord,
      { id: 'm-cup', isLeague: false, mode: 'cup', cupId: 'season-community', score: { home: 1, away: 0 }, result: 'win', homeId: 'player', awayId: 'a2', homeName: '我队', awayName: '对手B' } as MatchRecord,
    ]
    setGame(game)
    onlineState.status = 'offline'

    // 下一场是联赛：蓝色 info 标签；最近比赛里联赛用 info、杯赛用 gold
    const leagueHome = renderHome()
    expect(leagueHome).toContain('<span class="tag info">联赛</span>')
    expect(leagueHome).toContain('<span class="tag info">联赛 · 第 1 轮</span>')
    expect(leagueHome).toContain('<span class="tag info">联赛第 1 轮</span>')
    expect(leagueHome).toContain('<span class="tag gold">杯赛</span>')
    expect(leagueHome).toContain('有 1 项俱乐部成就已完成待领取')

    // 下一场是正式杯赛：金色 gold 标签
    game.shared = true
    const own = game.world!.clubs.find((c) => c.id === 'player')!.squadKey!
    const cupAt = roundKickoffAt(game, 1) - 2 * 3600_000
    game.world!.seasonCupMode = 1
    game.world!.seasonCups = {
      version: 1,
      seasonIndex: 1,
      qualificationRound: 6,
      createdAt: cupAt - 86_400_000,
      delayedLeagueRounds: [],
      cups: [{
        id: 'community',
        name: '社区杯',
        entrants: [own, 'd2s_01'],
        dates: [cupAt],
        rounds: [{ round: 1, kickoffAt: cupAt, byes: [], fixtures: [{ id: 'c1', cupId: 'community', round: 1, homeId: own, awayId: 'd2s_01', kickoffAt: cupAt, played: false }] }],
      }],
    }
    onlineState.status = 'online'
    const cupHome = renderHome()
    expect(cupHome).toContain('<span class="tag gold">社区杯</span>')
    expect(cupHome).toContain('<span class="tag gold">社区杯 · 决赛</span>')
  })

  it('挑战页：友谊赛实力用星星表示，且友谊赛/传奇/巅峰全部改用联赛同款 RANK 值', () => {
    const game = createWorldGame(1006)
    setGame(game)
    onlineState.status = 'offline'

    // 1. 友谊赛
    ui.challengeMode = 'friendly'
    const friendly = renderChallenge()
    expect(friendly).toContain('class="star-rating"')
    expect(friendly).not.toContain(' / 5</td>')
    expect(friendly).toContain('>RANK</th>')
    expect(friendly).not.toContain('>平均 CA</th>')
    const sampleTeam = game.aiTeams[0]
    expect(friendly).toContain(String(Math.round(lineupRating(sampleTeam.players, sampleTeam.lineup))))

    // 2. 传奇挑战
    ui.challengeMode = 'legend'
    ui.legendTier = 'S+'
    ui.legendSearch = ''
    ui.legendCountry = 'ALL'
    ui.legendEra = 'ALL'
    const legend = renderChallenge()
    expect(legend).toContain('>RANK</th>')
    expect(legend).not.toContain('>首发 CA</th>')
    const barca = legendTeamById('barcelona-2010-11')!
    expect(legend).toContain(String(Math.round(lineupRating(barca.players, barca.lineup))))

    // 3. 巅峰之路
    ui.challengeMode = 'peak'
    ui.peakPreviewStage = 1
    const peak = renderChallenge()
    expect(peak).toContain('对手 RANK')
    expect(peak).not.toContain('首发平均 CA')
    expect(peak).not.toContain('目标 CA')
    const stage1 = buildPeakTeam(1)
    expect(peak).toContain(String(Math.round(lineupRating(stage1.players, stage1.lineup))))
  })
})
