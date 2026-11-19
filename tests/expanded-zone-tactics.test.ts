import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppServer, type AppServer } from '../server/app.ts'
import { buildOwnerlessTeams, createOwnerlessWorld, createWorldGame, expandWorldConference, migrateLegacyExpandedTactics, syncAllClubLiveTactics, syncClubLiveTactics } from '../src/game/world.ts'
import { STYLES_REV3 } from '../src/game/pes/tactics.ts'
import { renderChallenge } from '../src/ui/screens/challenge.ts'
import { setGame, ui } from '../src/ui/state.ts'
import { fastMatchResult } from './queued-server-helpers.ts'

const DEFAULT_TACTICS = { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' } as const

const servers: AppServer[] = []
const dirs: string[] = []

afterEach(() => {
  while (servers.length) servers.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('扩展赛区战术迁移与跨赛区友谊赛展示', () => {
  it('把历史扩区全默认战术的 d2z* 球队按 5 档均衡洗牌并刷新无主 AI 阵容，且保留真人执教阵容、保持幂等', () => {
    const seed = 20261119
    const { world } = createOwnerlessWorld(seed, 1_700_000_000_000)
    expandWorldConference(world, seed)
    const zoneClubs = world.clubs.filter((club) => club.conference === 'zone3')
    expect(zoneClubs).toHaveLength(20)

    // 模拟 v0.4.18 之前生成的全默认均衡战术
    for (const club of zoneClubs) club.tactics = { ...DEFAULT_TACTICS }
    const teams = buildOwnerlessTeams(world, seed)
    const ownedId = zoneClubs[0].id
    const customLineup = structuredClone(teams[ownedId].lineup)
    customLineup.formationId = '4-3-3'
    customLineup.tacticalStyle = 'tikiTaka'
    customLineup.tacticalInstructions = structuredClone(STYLES_REV3.tikiTaka.instructions)
    customLineup.tactics = { attack: 'balanced', passing: 'short', tempo: 'slow', line: 'high', press: 'high' }
    teams[ownedId].lineup = structuredClone(customLineup)

    const migrated = migrateLegacyExpandedTactics(world, seed, { teams, owners: { [ownedId]: 'human-1' } })
    expect(migrated).toBe(true)

    // 20 队均衡分布到 5 种基底战术，每种恰好 4 队
    const tacticCounts = new Map<string, number>()
    for (const club of zoneClubs) {
      const key = JSON.stringify(club.tactics)
      tacticCounts.set(key, (tacticCounts.get(key) ?? 0) + 1)
    }
    expect(tacticCounts.size).toBe(5)
    expect([...tacticCounts.values()].every((count) => count === 4)).toBe(true)

    // 真人执教球队的阵容不被覆盖
    expect(teams[ownedId].lineup).toEqual(customLineup)

    // 未接管 AI 球队的基底战术已同步，且推导出的战术风格比迁移前更丰富
    const aiStyles = new Set(
      zoneClubs
        .filter((club) => club.id !== ownedId)
        .map((club) => teams[club.id].lineup.tacticalStyle),
    )
    expect(aiStyles.size).toBeGreaterThanOrEqual(4)

    // 幂等：重复调用不再改动
    const snapshot = structuredClone(zoneClubs.map((club) => club.tactics))
    expect(migrateLegacyExpandedTactics(world, seed, { teams, owners: { [ownedId]: 'human-1' } })).toBe(false)
    expect(zoneClubs.map((club) => club.tactics)).toEqual(snapshot)
  })

  it('syncAllClubLiveTactics 同步实时阵型与风格摘要且不覆盖建队基底战术，跨赛区友谊赛列表正确展示', () => {
    const game = createWorldGame(42, undefined, '测试队', 1_700_000_000_000)
    expandWorldConference(game.world!, game.seed)
    const zoneClubs = game.world!.clubs.filter((club) => club.conference === 'zone3')
    for (const club of zoneClubs) club.tactics = { ...DEFAULT_TACTICS }
    const teams = buildOwnerlessTeams(game.world!, game.seed)
    migrateLegacyExpandedTactics(game.world!, game.seed, { teams })

    const baseBefore = zoneClubs.map((club) => ({ ...club.tactics }))
    expect(syncAllClubLiveTactics(game.world!, teams)).toBe(true)
    expect(syncAllClubLiveTactics(game.world!, teams)).toBe(false)
    // 建队基底 club.tactics 未被实时衍生战术覆盖
    expect(zoneClubs.map((club) => club.tactics)).toEqual(baseBefore)
    expect(zoneClubs.every((club) => !!club.liveTactics && !!club.liveTacticalStyle && !!club.liveFormationId)).toBe(true)

    // 单个俱乐部更新实时阵容时能精确刷新摘要
    const target = zoneClubs[0]
    teams[target.id].lineup.formationId = '3-4-3'
    teams[target.id].lineup.tacticalStyle = 'highPress'
    teams[target.id].lineup.tacticalInstructions = structuredClone(STYLES_REV3.highPress.instructions)
    expect(syncClubLiveTactics(target, teams[target.id])).toBe(true)
    expect(target.liveFormationId).toBe('3-4-3')
    expect(target.liveTacticalStyle).toBe('highPress')

    // 友谊赛切到跨赛区（d2-zone3）时展示多样化实时战术风格与阵型
    setGame(game)
    ui.challengeMode = 'friendly'
    ui.challengeDivision = 'd2-zone3'
    const html = renderChallenge()
    expect(html).toContain('高位压迫')
    expect(html).toContain('3-4-3')
    const stylesShown = Object.values(STYLES_REV3).filter((style) => style.id !== 'blank' && html.includes(style.name))
    expect(stylesShown.length).toBeGreaterThanOrEqual(4)
  })

  it('服务端启动时自动迁移存量全默认战术的扩区 world.json 并把实时战术同步给玩家存档', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-expand-tactics-'))
    dirs.push(dataDir)
    const now = 1_700_000_000_000
    const seed = 98765
    const ownerless = createOwnerlessWorld(seed, now)
    expandWorldConference(ownerless.world, seed)
    for (const club of ownerless.world.clubs) {
      if (club.conference === 'zone3') club.tactics = { ...DEFAULT_TACTICS }
    }
    const teams = buildOwnerlessTeams(ownerless.world, seed)
    fs.writeFileSync(path.join(dataDir, 'world.json'), JSON.stringify({
      seed,
      startedAt: now,
      world: ownerless.world,
      teams,
      freeStars: ownerless.freeStars,
      reserveStars: ownerless.reserveStars,
      owners: {},
    }))

    const app = createAppServer({
      dataDir,
      staticDir: path.resolve('dist'),
      tickMs: 0,
      matchQueue: { intervalMs: 0, compute: fastMatchResult },
      now: () => now,
    })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const port = (app.server.address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`

    // 落盘的 world.json 已完成迁移且同步了实时战术摘要
    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'world.json'), 'utf8'))
    const zone3 = persisted.world.clubs.filter((club: { conference?: string }) => club.conference === 'zone3')
    expect(zone3).toHaveLength(20)
    expect(new Set(zone3.map((club: { tactics: unknown }) => JSON.stringify(club.tactics))).size).toBe(5)
    expect(new Set(zone3.map((club: { liveTacticalStyle?: string }) => club.liveTacticalStyle)).size).toBeGreaterThanOrEqual(5)

    // 新注册玩家拿到的 world.clubs 也带有东区多样化战术与实时摘要
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'secret123' }),
    })
    expect(reg.status).toBe(201)
    const body = await reg.json() as { game: { world: { clubs: Array<{ conference?: string; liveTacticalStyle?: string; tactics: unknown }> } } }
    const clientZone3 = body.game.world.clubs.filter((club) => club.conference === 'zone3')
    expect(new Set(clientZone3.map((club) => JSON.stringify(club.tactics))).size).toBe(5)
    expect(new Set(clientZone3.map((club) => club.liveTacticalStyle)).size).toBeGreaterThanOrEqual(5)
  })
})
