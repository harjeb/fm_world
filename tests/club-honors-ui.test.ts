import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AccountStore } from '../server/account-store.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { clubCupHonorsFor, seasonCupChampions } from '../src/game/season-cups.ts'
import { createWorldGame } from '../src/game/world.ts'
import { clubName, leagueTable, styledClubName } from '../src/ui/components.ts'
import { renderWorld } from '../src/ui/screens/world.ts'
import { renderSeasonCups } from '../src/ui/season-cup-view.ts'
import { game, setGame, ui } from '../src/ui/state.ts'

const servers: AppServer[] = []
const dirs: string[] = []

afterEach(async () => {
  for (const app of servers.splice(0)) await app.shutdown()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('俱乐部杯赛荣誉展示与世界页历届荣誉/席位调整', () => {
  it('传奇杯仅正常联赛球队显示彩虹队名，临时生成豪门不显示；星联杯在队名后展示 S2+ 小奖杯与悬停赛季', () => {
    const prevGame = game
    const prevDiv = ui.worldDivision
    try {
      const testGame = createWorldGame(4242, 'north', '星辰FC')
      const world = testGame.world!
      const playerClub = world.clubs.find((c) => c.id === 'player')!
      const playerRealId = playerClub.squadKey!
      const aiChamp = world.clubs.find((c) => c.tier === 'champions' && c.id !== 'player')!
      const d1Club = world.clubs.find((c) => c.tier === 'division1')!

      world.seasonCupHistory = [
        {
          version: 1,
          seasonIndex: 2,
          qualificationRound: 6,
          createdAt: 1,
          delayedLeagueRounds: [],
          cups: [
            { id: 'cross', name: '星联杯', entrants: [d1Club.id], dates: [], rounds: [], championId: d1Club.id },
            { id: 'legend', name: '传奇杯', entrants: ['lcup-barcelona-2010-11'], dates: [], rounds: [], championId: 'lcup-barcelona-2010-11' },
          ],
        },
      ]
      world.seasonCups = {
        version: 1,
        seasonIndex: 3,
        qualificationRound: 6,
        createdAt: 2,
        delayedLeagueRounds: [],
        cups: [
          { id: 'cross', name: '星联杯', entrants: [playerRealId, d1Club.id], dates: [], rounds: [], championId: playerRealId },
          { id: 'legend', name: '传奇杯', entrants: [aiChamp.id], dates: [], rounds: [], championId: aiChamp.id },
        ],
      }
      world.history = [
        {
          seasonIndex: 1,
          champion: aiChamp.name,
          promotions: ['d1_01', 'd1_02', 'd1_03'],
          relegations: ['ai_18', 'ai_19', 'ai_20'],
          divisions: {
            champions: { championId: aiChamp.id, champion: aiChamp.name, promotions: [], relegations: ['ai_18', 'ai_19', 'ai_20'] },
            division1: { championId: d1Club.id, champion: d1Club.name, promotions: ['d1_01', 'd1_02', 'd1_03'], relegations: ['d1_18', 'd1_19', 'd1_20'] },
          },
        },
      ]

      setGame(testGame)

      // 1. 临时生成的传奇杯豪门（lcup-*）不得显示彩虹字体或星联杯奖杯
      expect(clubCupHonorsFor(testGame, 'lcup-barcelona-2010-11')).toEqual({ legendSeasons: [], crossSeasons: [] })
      const guestHtml = clubName('lcup-barcelona-2010-11')
      expect(guestHtml).toContain('巴塞罗那')
      expect(guestHtml).not.toContain('club-name-rainbow')
      expect(guestHtml).not.toContain('club-cross-trophy')

      // 2. 正常联赛俱乐部拿过传奇杯 -> 彩虹字体 + 悬停赛季
      expect(clubCupHonorsFor(testGame, aiChamp.id)).toEqual({ legendSeasons: [3], crossSeasons: [] })
      const legendClubHtml = clubName(aiChamp.id)
      expect(legendClubHtml).toContain('club-name-rainbow')
      expect(legendClubHtml).toContain('传奇杯冠军：S3')
      expect(legendClubHtml).not.toContain('club-cross-trophy')

      // 3. S2 星联杯冠军 -> 名字后面显示小奖杯并带 S2 提示
      expect(clubCupHonorsFor(testGame, d1Club.id)).toEqual({ legendSeasons: [], crossSeasons: [2] })
      const crossClubHtml = clubName(d1Club.id)
      expect(crossClubHtml).toContain('club-cross-trophy')
      expect(crossClubHtml).toContain('星联杯冠军：S2')
      expect(crossClubHtml).not.toContain('club-name-rainbow')

      // 4. 玩家俱乐部（以 squadKey 写入 seasonCups）以 'player' ID 查询同样能显示奖杯
      const ownStyled = styledClubName('player', testGame.clubName, true)
      expect(ownStyled).toContain('club-cross-trophy')
      expect(ownStyled).toContain('星联杯冠军：S3')

      // 5. 积分榜渲染中也携带彩虹字样与星联杯小奖杯
      const championsDiv = world.divisions.find((d) => d.divisionId === 'champions')!
      const tableHtml = leagueTable(championsDiv.table, { tier: 'champions' })
      expect(tableHtml).toContain('club-name-rainbow')

      // 6. 世界页：历届荣誉删除「升级 X 队 / 降级 X 队」字样，且删除「球队席位」模块
      ui.worldDivision = 'division1'
      const worldHtml = renderWorld()
      expect(worldHtml).toContain('历届荣誉')
      expect(worldHtml).not.toMatch(/升级\s+\d+\s*队/)
      expect(worldHtml).not.toMatch(/降级\s+\d+\s*队/)
      expect(worldHtml).not.toContain('球队席位')
    } finally {
      ui.worldDivision = prevDiv
      setGame(prevGame)
    }
  })

  it('服务端启动时会从教练奖杯记录补齐遗漏的 S2 星联杯历史冠军', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-s2-cup-backfill-'))
    dirs.push(dir)
    const app1 = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    await new Promise<void>((resolve) => app1.server.listen(0, '127.0.0.1', resolve))
    const base1 = `http://127.0.0.1:${(app1.server.address() as any).port}`

    const reg = await fetch(`${base1}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 's2champ', password: 'secret123' }),
    })
    expect(reg.status).toBe(201)
    const auth = await reg.json() as { token: string; user: { id: string }; game: any }
    const champRealClubId: string = auth.game.world.clubs.find((c: any) => c.id === 'player').squadKey
    await app1.shutdown()

    // 写入服务端权威的 S2 星联杯奖杯记录，并模拟 world.json 进入 S3 时漏记 seasonCupHistory
    const store = new AccountStore(dir)
    const savedChamp = store.accounts.find((a) => a.id === auth.user.id)!
    savedChamp.game.pve!.trophies.push({
      cupId: 'season-cross',
      cupName: '星联杯',
      seasonIndex: 2,
      wonAt: Date.now(),
      finalOpponent: '亚军队',
      finalScore: { home: 2, away: 0 },
    })
    store.save(savedChamp)
    store.flushSync()
    store.close()

    const worldPath = path.join(dir, 'world.json')
    const rawWorld = JSON.parse(fs.readFileSync(worldPath, 'utf8'))
    rawWorld.world.seasonIndex = 3
    delete rawWorld.world.seasonCupHistory
    fs.writeFileSync(worldPath, JSON.stringify(rawWorld))

    const app2 = createAppServer({ dataDir: dir, staticDir: path.resolve('dist'), tickMs: 0 })
    servers.push(app2)
    await new Promise<void>((resolve) => app2.server.listen(0, '127.0.0.1', resolve))
    const base2 = `http://127.0.0.1:${(app2.server.address() as any).port}`

    // 用另一名教练拉取 /api/game，验证服务端已从世界历届杯赛补齐 S2 星联杯冠军并下发给全服玩家
    const obsReg = await fetch(`${base2}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 's2observer', password: 'secret123' }),
    })
    expect(obsReg.status).toBe(201)
    const observer = await obsReg.json() as { game: any }
    expect(clubCupHonorsFor(observer.game, champRealClubId).crossSeasons).toContain(2)

    const sessionRes = await fetch(`${base2}/api/game`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    expect(sessionRes.status).toBe(200)
    const session = await sessionRes.json() as { game: any }
    expect(clubCupHonorsFor(session.game, 'player').crossSeasons).toContain(2)
  })

  it('除升级杯外的所有赛季杯赛页均展示历届冠军球队，升级杯页不展示', () => {
    const prevGame = game
    try {
      const testGame = createWorldGame(5150, 'south', '南粤联')
      const world = testGame.world!
      world.seasonCupMode = 1
      world.seasonIndex = 3
      testGame.season.index = 3
      const playerClub = world.clubs.find((c) => c.id === 'player')!
      const playerRealId = playerClub.squadKey!
      const champClub = world.clubs.find((c) => c.tier === 'champions' && c.id !== 'player')!
      const d1Club = world.clubs.find((c) => c.tier === 'division1')!
      const d2Club = world.clubs.find((c) => c.tier === 'division2' && c.id !== 'player')!

      world.seasonCupHistory = [
        {
          version: 1,
          seasonIndex: 1,
          qualificationRound: 6,
          createdAt: 1,
          delayedLeagueRounds: [],
          cups: [
            { id: 'community', name: '社区杯', entrants: [d2Club.id], dates: [], rounds: [], championId: d2Club.id },
            { id: 'league', name: '联盟杯', entrants: [d1Club.id], dates: [], rounds: [], championId: d1Club.id },
            { id: 'champions', name: '冠军杯', entrants: [champClub.id], dates: [], rounds: [], championId: champClub.id },
            { id: 'promotion', name: '升级杯', entrants: [d2Club.id], dates: [], rounds: [], championId: d2Club.id, promotedIds: [d2Club.id] },
          ],
        },
        {
          version: 1,
          seasonIndex: 2,
          qualificationRound: 6,
          createdAt: 2,
          delayedLeagueRounds: [],
          cups: [
            { id: 'community', name: '社区杯', entrants: [playerRealId], dates: [], rounds: [], championId: playerRealId },
            { id: 'cross', name: '星联杯', entrants: [d1Club.id], dates: [], rounds: [], championId: d1Club.id },
            { id: 'legend', name: '传奇杯', entrants: ['lcup-barcelona-2010-11'], dates: [], rounds: [], championId: 'lcup-barcelona-2010-11' },
          ],
        },
      ]
      setGame(testGame)

      // 赛季第 6 轮前尚未产生当季签表时，除升级杯外也应展示历届冠军
      expect(seasonCupChampions(testGame, 'community', playerRealId).map((x) => x.seasonIndex)).toEqual([2, 1])
      expect(seasonCupChampions(testGame, 'promotion', playerRealId)).toEqual([])

      for (const cupId of ['community', 'league', 'champions', 'cross', 'legend'] as const) {
        const html = renderSeasonCups(testGame, cupId)
        expect(html).toContain('历届冠军')
      }
      const communityPreHtml = renderSeasonCups(testGame, 'community')
      expect(communityPreHtml).toContain(testGame.clubName)
      expect(communityPreHtml).toContain(d2Club.name)
      expect(communityPreHtml.indexOf('第 2 赛季')).toBeLessThan(communityPreHtml.indexOf('第 1 赛季'))

      // 升级杯在预览态与进行中均不显示历届冠军
      expect(renderSeasonCups(testGame, 'promotion')).not.toContain('历届冠军')

      // 当季签表产生后：5 项非升级杯照常展示历届冠军，升级杯依然不展示
      world.seasonCups = {
        version: 1,
        seasonIndex: 3,
        qualificationRound: 6,
        createdAt: 3,
        delayedLeagueRounds: [],
        cups: [
          { id: 'community', name: '社区杯', entrants: [playerRealId, d2Club.id], dates: [Date.now()], rounds: [{ round: 1, kickoffAt: Date.now(), byes: [], fixtures: [] }] },
          { id: 'league', name: '联盟杯', entrants: [d1Club.id], dates: [Date.now()], rounds: [{ round: 1, kickoffAt: Date.now(), byes: [], fixtures: [] }] },
          { id: 'champions', name: '冠军杯', entrants: [champClub.id], dates: [Date.now()], rounds: [{ round: 1, kickoffAt: Date.now(), byes: [], fixtures: [] }] },
          { id: 'cross', name: '星联杯', entrants: [d1Club.id], dates: [Date.now()], rounds: [{ round: 1, kickoffAt: Date.now(), byes: [], fixtures: [] }] },
          { id: 'legend', name: '传奇杯', entrants: [champClub.id, 'lcup-barcelona-2010-11'], dates: [Date.now()], rounds: [{ round: 1, kickoffAt: Date.now(), byes: [], fixtures: [] }], championId: champClub.id },
          { id: 'promotion', name: '升级杯', entrants: [d2Club.id], dates: [Date.now()], rounds: [{ round: 1, kickoffAt: Date.now(), byes: [], fixtures: [] }], championId: d2Club.id, promotedIds: [d2Club.id] },
        ],
      }

      for (const cupId of ['community', 'league', 'champions', 'cross', 'legend'] as const) {
        const html = renderSeasonCups(testGame, cupId)
        expect(html).toContain('历届冠军')
      }
      const legendActiveHtml = renderSeasonCups(testGame, 'legend')
      expect(legendActiveHtml).toContain('第 3 赛季')
      expect(legendActiveHtml).toContain(champClub.name)
      expect(legendActiveHtml).toContain('第 2 赛季')
      expect(legendActiveHtml).toContain('巴塞罗那')
      expect(renderSeasonCups(testGame, 'promotion')).not.toContain('历届冠军')
    } finally {
      setGame(prevGame)
    }
  })
})
