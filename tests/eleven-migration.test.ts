import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { FORMATIONS, FORMATION_LIST, isLegacyFormation } from '../src/game/data/formations.ts'
import { ELEVEN_SQUAD_SIZE, needsElevenUpgrade, upgradeElevenASide } from '../src/game/eleven.ts'
import { autoFillLineup, BENCH_SIZE, STARTERS, validateLineup } from '../src/game/squad.ts'
import { createWorldGame } from '../src/game/world.ts'
import { PesGame } from '../src/game/pes/game.ts'
import { makePitch7 } from '../src/game/pes/spec.ts'
import type { MatchTeamInput } from '../src/game/match/types.ts'
import type { AITeam, FormationId, GameState, LegacyFormationId, Player } from '../src/game/types.ts'

const LEGACY_OF: Record<string, LegacyFormationId> = { '4-3-3': '1-2-3-1', '4-2-3-1': '1-2-3-1', '3-5-2': '1-3-2-1', '4-4-2': '1-2-2-2' }
const legacyOf = (id: FormationId): LegacyFormationId => (isLegacyFormation(id) ? id : LEGACY_OF[id])

/** 7 人制的阵容：7 个首发 + 5 个替补（旧规则）。 */
function legacyLineup(players: Player[], formationId: LegacyFormationId, tactics = FORMATIONS[formationId].defaultTactics) {
  const lineup = autoFillLineup(players, formationId, tactics)
  return { ...lineup, bench: lineup.bench.slice(0, 5) }
}

/** 把一份新存档改成迁移前的样子：每队 18 人、7 人制阵型。 */
function legacySave(seed: number): GameState {
  const game = createWorldGame(seed)
  game.roster = game.roster.slice(0, 18)
  game.lineup = legacyLineup(game.roster, legacyOf(game.lineup.formationId), game.lineup.tactics)
  game.aiTeams = game.aiTeams.map((team): AITeam => {
    const players = team.players.slice(0, 18)
    const formationId = legacyOf(team.formationId)
    return { ...team, players, formationId, lineup: legacyLineup(players, formationId, team.tactics) }
  })
  for (const club of game.world!.clubs) club.formationId = legacyOf(club.formationId)
  return game
}

describe('7 人制存档迁移到 11 人制', () => {
  it('每队补随机球员到 25 人，原来的人和顺序不变，不加球星', () => {
    const game = legacySave(31)
    const before = game.roster.map((player) => player.id)
    const starsBefore = game.roster.filter((player) => player.era !== 'random').length
    const aiBefore = new Map(game.aiTeams.map((team) => [team.id, team.players.map((player) => player.id)]))
    const aiStarsBefore = game.aiTeams.reduce((sum, team) => sum + team.players.filter((player) => player.era !== 'random').length, 0)
    expect(needsElevenUpgrade(game)).toBe(true)

    expect(upgradeElevenASide(game)).toBe(true)

    expect(game.roster).toHaveLength(ELEVEN_SQUAD_SIZE)
    expect(game.roster.slice(0, 18).map((player) => player.id)).toEqual(before)
    expect(game.roster.filter((player) => player.era !== 'random')).toHaveLength(starsBefore)
    for (const player of game.roster.slice(18)) {
      expect(player.era).toBe('random')
      expect(player.contract?.clubId).toBe('player')
    }
    for (const team of game.aiTeams) {
      expect(team.players).toHaveLength(ELEVEN_SQUAD_SIZE)
      expect(team.players.slice(0, 18).map((player) => player.id)).toEqual(aiBefore.get(team.id))
      expect(isLegacyFormation(team.formationId)).toBe(false)
      expect(validateLineup(team.players, team.lineup).valid, team.name).toBe(true)
    }
    expect(game.aiTeams.reduce((sum, team) => sum + team.players.filter((player) => player.era !== 'random').length, 0)).toBe(aiStarsBefore)
    expect(game.world!.clubs.some((club) => isLegacyFormation(club.formationId))).toBe(false)
    // 名字在队内不重复
    for (const squad of [game.roster, ...game.aiTeams.map((team) => team.players)]) {
      expect(new Set(squad.map((player) => player.name)).size).toBe(squad.length)
    }
  })

  it('阵型按对应关系换成 11 人制，首发 11 人、替补 7 人，阵容合法', () => {
    const game = legacySave(32)
    game.lineup = legacyLineup(game.roster, '1-3-2-1', game.lineup.tactics)
    upgradeElevenASide(game)
    expect(game.lineup.formationId).toBe('3-5-2')
    expect(game.lineup.starters).toHaveLength(STARTERS)
    expect(game.lineup.bench).toHaveLength(BENCH_SIZE)
    expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
    expect(FORMATION_LIST.map((formation) => formation.id)).toContain(game.lineup.formationId)
  })

  it('命名战术预设一起迁移，旧的 7 人制自由摆位不沿用', () => {
    const game = legacySave(33)
    const preset = legacyLineup(game.roster, '1-2-2-2', game.lineup.tactics)
    game.lineup.customPositions = { st: { x: 0.6, y: 0.5 } }
    game.lineup.presets = [{ id: 'p1', name: '双前锋', createdAt: 1, lineup: preset }]
    upgradeElevenASide(game)
    expect(game.lineup.customPositions).toBeUndefined()
    expect(game.lineup.presets).toHaveLength(1)
    expect(game.lineup.presets![0].name).toBe('双前锋')
    expect(game.lineup.presets![0].lineup.formationId).toBe('4-4-2')
    expect(validateLineup(game.roster, { ...game.lineup.presets![0].lineup }).valid).toBe(true)
  })

  it('可以反复调用：迁移过的存档不再变化；同一份旧存档迁移结果一样', () => {
    const a = legacySave(34)
    const b = structuredClone(a)
    upgradeElevenASide(a)
    upgradeElevenASide(b)
    expect(a.roster.map((player) => [player.id, player.name])).toEqual(b.roster.map((player) => [player.id, player.name]))
    expect(a.lineup).toEqual(b.lineup)
    const snapshot = JSON.stringify(a)
    expect(upgradeElevenASide(a)).toBe(false)
    expect(JSON.stringify(a)).toBe(snapshot)
    // 新开的存档本来就是 11 人制
    expect(needsElevenUpgrade(createWorldGame(35))).toBe(false)
  })

  it('进行中的 7 人制旧比赛读档后还能踢完', () => {
    const game = legacySave(36)
    const input = (id: string): MatchTeamInput => ({
      id, name: id, color: '#fff', accent: '#000',
      formationId: game.lineup.formationId,
      tactics: game.lineup.tactics,
      starters: game.lineup.starters.map((starter) => ({ player: game.roster.find((player) => player.id === starter.playerId)!, role: starter.role, slotId: starter.slotId })),
      bench: game.lineup.bench.map((id2) => game.roster.find((player) => player.id === id2)!),
    })
    const started = new PesGame({ seed: 5, home: input('home'), away: input('away'), spec: makePitch7() })
    started.advance(60)
    const restored = PesGame.restore(JSON.parse(JSON.stringify(started.serialize())))
    expect(restored.match.teams[0].players).toHaveLength(7)
    expect(restored.run().finished).toBe(true)
  })
})

const servers: AppServer[] = []
afterEach(() => { while (servers.length) servers.pop()!.close() })

async function start(dataDir: string) {
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0 })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  return { app, base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}` }
}

describe('服务器启动时迁移共享世界和账号', () => {
  it('旧的 7 人制账号和共享 AI 名单都补到 25 人、换成 11 人制阵型', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-eleven-'))
    const first = await start(dataDir)
    const registered = await (await fetch(`${first.base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'legacy', password: 'secret123' }) })).json() as { token: string }
    servers.pop()!.close()

    // 把落盘的数据改回 7 人制
    const dbFile = path.join(dataDir, 'accounts.json')
    const worldFile = path.join(dataDir, 'world.json')
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8')) as { accounts: { game: GameState }[] }
    const world = JSON.parse(fs.readFileSync(worldFile, 'utf8')) as { world: GameState['world']; teams: Record<string, AITeam>; owners: Record<string, string> }
    const account = db.accounts[0]
    account.game.roster = account.game.roster.slice(0, 18)
    account.game.lineup = legacyLineup(account.game.roster, legacyOf(account.game.lineup.formationId), account.game.lineup.tactics)
    account.game.aiTeams = account.game.aiTeams.map((team) => ({ ...team, players: team.players.slice(0, 18), formationId: legacyOf(team.formationId), lineup: legacyLineup(team.players.slice(0, 18), legacyOf(team.formationId), team.tactics) }))
    for (const club of account.game.world!.clubs) club.formationId = legacyOf(club.formationId)
    for (const club of world.world!.clubs) club.formationId = legacyOf(club.formationId)
    const ownClub = Object.keys(world.owners)[0]
    for (const [id, team] of Object.entries(world.teams)) {
      const players = id === ownClub ? account.game.roster : team.players.slice(0, 18)
      world.teams[id] = { ...team, players, formationId: legacyOf(team.formationId), lineup: id === ownClub ? account.game.lineup : legacyLineup(players, legacyOf(team.formationId), team.tactics) }
    }
    fs.writeFileSync(dbFile, JSON.stringify(db))
    fs.writeFileSync(worldFile, JSON.stringify(world))

    const second = await start(dataDir)
    const auth = { Authorization: `Bearer ${registered.token}` }
    const game = (await (await fetch(`${second.base}/api/game`, { headers: auth })).json() as { game: GameState }).game
    expect(game.roster).toHaveLength(ELEVEN_SQUAD_SIZE)
    expect(isLegacyFormation(game.lineup.formationId)).toBe(false)
    expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
    expect(game.aiTeams.every((team) => team.players.length === ELEVEN_SQUAD_SIZE && validateLineup(team.players, team.lineup).valid)).toBe(true)
    const snapshot = await (await fetch(`${second.base}/api/world/teams`, { headers: auth })).json() as { clubs: { id: string; players: unknown[]; formationId: FormationId }[] }
    expect(snapshot.clubs.every((club) => !isLegacyFormation(club.formationId))).toBe(true)
    expect(snapshot.clubs.find((club) => club.id === ownClub)!.players).toHaveLength(ELEVEN_SQUAD_SIZE)
    expect(snapshot.clubs.every((club) => club.players.length === ELEVEN_SQUAD_SIZE)).toBe(true)
  })
})
