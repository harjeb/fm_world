import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import type { GameState, MatchRecord, Player, PlayerMatchStats, SkillId, SkillTier } from '../src/game/types.ts'
import { awardLeagueBookDrops, leagueBookDropChance, LEAGUE_BOOK_DROP_CHANCE } from '../src/game/league-book-drops.ts'
import { bookLearnChance, bookRequirementText, canChooseTrainingBook } from '../src/game/legend-learning.ts'
import { ensureLegendBooks } from '../src/game/legend-books.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { renderReview } from '../src/ui/screens/review.ts'
import { game as uiGame, ui } from '../src/ui/state.ts'
import { drainServerQueue, fastMatchResult } from './queued-server-helpers.ts'

type DropPlayer = Pick<Player, 'id' | 'name' | 'skills' | 'skillTiers'>

const SKILL_POOL: SkillId[] = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter', 'long_shot', 'weak_foot', 'sweeper', 'iron_lung', 'aerial', 'wing_runner', 'cb_intercept', 'cb_block', 'cb_cover', 'wing_cross', 'cm_long_pass', 'cm_shield', 'st_breakaway', 'wing_support', 'wing_track_back', 'penalty_specialist']

function squad(count = 22): { players: DropPlayer[]; stats: PlayerMatchStats[] } {
  const players = Array.from({ length: count }, (_, index): DropPlayer => {
    const skills = [SKILL_POOL[index % SKILL_POOL.length], SKILL_POOL[(index * 7 + 3) % SKILL_POOL.length]].filter((id, i, list) => list.indexOf(id) === i)
    return { id: `p${index}`, name: `球员${index}`, skills, skillTiers: { [skills[0]]: (['silver', 'gold', 'rainbow'] as SkillTier[])[index % 3] } }
  })
  const stats = players.map((player, index) => ({ playerId: `${index < count / 2 ? 'home' : 'away'}:${player.id}`, sourceId: player.id, name: player.name, side: index < count / 2 ? 'home' : 'away', minutes: 90 }) as PlayerMatchStats)
  return { players, stats }
}

const blankGame = (): GameState => ({ legendBooks: [] } as unknown as GameState)

describe('联赛技能书掉落', () => {
  it('概率按上场分钟折算，满场 5%', () => {
    expect(LEAGUE_BOOK_DROP_CHANCE).toBe(0.05)
    expect(leagueBookDropChance(90)).toBeCloseTo(0.05)
    expect(leagueBookDropChance(45)).toBeCloseTo(0.025)
    expect(leagueBookDropChance(0)).toBe(0)
    expect(leagueBookDropChance(120)).toBeCloseTo(0.05)
  })

  it('同一种子结果可重放，0 分钟球员不掉书，11 人制满场期望约 1 本', () => {
    const { players, stats } = squad()
    const a = awardLeagueBookDrops(blankGame(), { players, stats, seed: 42, label: 'm|club' })
    const b = awardLeagueBookDrops(blankGame(), { players, stats, seed: 42, label: 'm|club' })
    expect(a).toEqual(b)
    const benched = stats.map((stat) => ({ ...stat, minutes: 0 }))
    expect(awardLeagueBookDrops(blankGame(), { players, stats: benched, seed: 42, label: 'm|club' })).toEqual([])
    let total = 0
    const runs = 400
    for (let seed = 0; seed < runs; seed++) total += awardLeagueBookDrops(blankGame(), { players, stats, seed, label: 'avg' }).length
    const mean = total / runs
    expect(mean).toBeGreaterThan(0.8)
    expect(mean).toBeLessThan(1.4)
  })

  it('掉落书使用球员的技能档位并入库；已有同档或更高档不再掉落', () => {
    const player: DropPlayer = { id: 'star', name: '球星', skills: ['long_shot'], skillTiers: { long_shot: 'gold' } }
    const stats = [{ playerId: 'home:star', sourceId: 'star', name: '球星', side: 'home', minutes: 90 } as PlayerMatchStats]
    const game = blankGame()
    let drop
    for (let seed = 0; seed < 500 && !drop; seed++) drop = awardLeagueBookDrops(game, { players: [player], stats, seed, label: 'x' })[0]
    expect(drop).toMatchObject({ id: 'long_shot', tier: 'gold', playerName: '球星', side: 'home', minutes: 90 })
    expect(game.legendBooks).toEqual([{ id: 'long_shot', tier: 'gold' }])
    for (let seed = 0; seed < 500; seed++) expect(awardLeagueBookDrops(game, { players: [player], stats, seed, label: 'y' })).toEqual([])
    const rainbowOwner = { ...blankGame(), legendBooks: [{ id: 'long_shot', tier: 'rainbow' }] } as GameState
    for (let seed = 0; seed < 500; seed++) expect(awardLeagueBookDrops(rainbowOwner, { players: [player], stats, seed, label: 'z' })).toEqual([])
    const silverOwner = { ...blankGame(), legendBooks: [{ id: 'long_shot', tier: 'silver' }] } as GameState
    let upgrade
    for (let seed = 0; seed < 500 && !upgrade; seed++) upgrade = awardLeagueBookDrops(silverOwner, { players: [player], stats, seed, label: 'u' })[0]
    expect(upgrade?.tier).toBe('gold')
  })

  it('基础技能书可以入库、配置并按单项属性计算门槛', () => {
    const game = { legendBooks: [{ id: 'long_shot', tier: 'silver' }, { id: 'gk_reflexes', tier: 'rainbow' }, { id: 'cb_intercept', tier: 'gold' }] } as unknown as GameState
    ensureLegendBooks(game)
    expect(game.legendBooks).toHaveLength(3)
    expect(bookRequirementText({ id: 'long_shot', tier: 'silver' })).toBe('射术 600')
    expect(bookRequirementText({ id: 'long_shot', tier: 'rainbow' })).toBe('射术 900')
    expect(bookRequirementText({ id: 'cb_intercept', tier: 'gold' })).toBe('预判 11')
    const field = { positions: { GK: 0, CB: 0, W: 0, CM: 0, ST: 80 }, attrs: { shooting: 900 } as Player['attrs'], skills: [] as SkillId[], skillTiers: {} } as Pick<Player, 'positions' | 'attrs' | 'skills' | 'skillTiers'>
    expect(bookLearnChance(field, { id: 'long_shot', tier: 'silver' })).toBe(1)
    expect(canChooseTrainingBook(field, { id: 'long_shot', tier: 'silver' }).ok).toBe(true)
    expect(canChooseTrainingBook(field, { id: 'gk_reflexes', tier: 'rainbow' })).toMatchObject({ ok: false, reason: '位置不匹配' })
  })

  it('复盘页显示赛后掉落与列表角标', () => {
    const record = { id: 'drop-record', seed: 1, createdAt: 0, isLeague: true, round: 3, homeId: 'player', awayId: 'ai-1', homeName: '我队', awayName: '对手', score: { home: 1, away: 0 }, result: 'win',
      stats: { home: { possession: 50, passes: 0, passesCompleted: 0, shots: 0, shotsOnTarget: 0, goals: 1, interceptions: 0, tackles: 0, fouls: 0, xg: 0 }, away: { possession: 50, passes: 0, passesCompleted: 0, shots: 0, shotsOnTarget: 0, goals: 0, interceptions: 0, tackles: 0, fouls: 0, xg: 0 } },
      playerStats: [], skillStats: [], failureStats: [], keyEvents: [], instructions: [], lineup: uiGame.lineup, opponentId: 'ai-1',
      bookDrops: [{ playerId: 'x', playerName: '对方前锋', side: 'away', id: 'long_shot', tier: 'gold', minutes: 72 }] } as unknown as MatchRecord
    const history = uiGame.matchHistory
    uiGame.matchHistory = [record]
    ui.reviewId = null
    expect(renderReview()).toContain('书 ×1')
    ui.reviewId = record.id
    const html = renderReview()
    expect(html).toContain('赛后技能书掉落')
    expect(html).toContain('skill-gold')
    expect(html).toContain('对方前锋')
    expect(html).toContain('上场 72 分钟')
    ui.reviewId = null
    uiGame.matchHistory = history
  })
})

const apps: AppServer[] = [], dirs: string[] = []
afterEach(() => { while (apps.length) apps.pop()!.close(); while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }) })

describe('联机联赛掉书（服务器）', () => {
  it('比赛公布时给真人球队写入 bookDrops，旧页面保存不会覆盖已入库的书', async () => {
    let clock = Date.UTC(2026, 10, 10, 8)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-book-drop-')); dirs.push(dir)
    const app = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0, now: () => clock, matchQueue: { intervalMs: 0, compute: async (job) => {
      const result = await fastMatchResult(job)
      result.record.playerStats = ([['home', job.home], ['away', job.away]] as const).flatMap(([side, locked]) => locked.team.lineup.starters.map((p) => ({ sourceId: p.playerId, playerId: `${side}:${p.playerId}`, name: p.playerId, side, minutes: 90, onMinute: 0, offMinute: 90 } as PlayerMatchStats)))
      return result
    } } })
    apps.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const registration = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'book_drop_test', password: randomUUID() }) })
    expect(registration.status).toBe(201)
    const { token } = await registration.json() as { token: string }
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const load = async () => await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
    const save = async (state: { game: GameState; revision: number }) => fetch(`${base}/api/game`, { method: 'PUT', headers, body: JSON.stringify({ game: state.game, baseRevision: state.revision }) })
    const first = await load()
    const kickoff = kickoffAtForRound(first.game.season.startedAt, 1)
    clock = kickoff - 30 * 60_000
    await drainServerQueue(app, dir, clock)
    clock = kickoff + 10 * 60_000
    await drainServerQueue(app, dir, clock)
    const after = await load()
    const record = after.game.matchHistory.find((item) => item.isLeague && item.round === 1)!
    expect(record).toBeTruthy()
    expect(Array.isArray(record.bookDrops)).toBe(true)
    for (const drop of record.bookDrops!) expect(after.game.legendBooks).toContainEqual({ id: drop.id, tier: drop.tier })
    // 服务器侧已有的书：旧页面丢掉 legendBooks 后保存，仍然保留。
    const withBook = await load()
    withBook.game.legendBooks = [...(withBook.game.legendBooks ?? []), { id: 'long_shot', tier: 'silver' }]
    expect((await save(withBook)).status).toBe(200)
    const stale = await load()
    stale.game.legendBooks = []
    expect((await save(stale)).status).toBe(200)
    const final = await load()
    expect(final.game.legendBooks).toContainEqual({ id: 'long_shot', tier: 'silver' })
    for (const drop of record.bookDrops!) expect(final.game.legendBooks).toContainEqual({ id: drop.id, tier: drop.tier })
  })
})
