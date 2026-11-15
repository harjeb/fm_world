import { describe, expect, it } from 'vitest'
import { createWorldGame, worldTransferTeams, cachedOwnerlessTeams } from '../src/game/world.ts'
import { signWorldClubPlayer } from '../src/game/market.ts'
import { negotiationDemands } from '../src/game/negotiation.ts'
import { economyOf } from '../src/game/economy.ts'
import { createAIClub } from '../src/game/ai-club.ts'
import type { GameState } from '../src/game/types.ts'

describe('单机世界转会', () => {
  it('覆盖世界、复用名单，旧档和共享游戏回退本地名单', () => {
    const game = createWorldGame(20241107)
    const original = game.aiTeams
    const teams = worldTransferTeams(game)
    expect(teams.length).toBe(game.world!.clubs.filter(c => !c.isPlayer && c.id !== 'player').length)
    expect(new Set(teams.map(t => t.id)).size).toBe(teams.length)
    expect(new Set(teams.flatMap(t => t.players.map(p => p.id))).size).toBe(teams.reduce((n, t) => n + t.players.length, 0))
    const remote = teams.find(t => !original.some(a => a.id === t.id))!
    expect(worldTransferTeams(game).find(t => t.id === remote.id)).toEqual(remote)
    expect(game.aiTeams).toBe(original)
    expect(worldTransferTeams({ ...game, world: undefined })).toBe(original)
    expect(worldTransferTeams({ ...game, shared: true })).toBe(original)
  })

  it('电脑球队后来签入的球员会进入跨赛区名单，不需要重新进入游戏', () => {
    const game = createWorldGame(20241107)
    const local = new Set(game.aiTeams.map(team => team.id))
    const remote = worldTransferTeams(game).find(team => !local.has(team.id))!
    const signing = structuredClone(game.roster.find(player => player.positions.GK === 0)!)
    signing.id = 'later-signed-player'; delete signing.starKey
    for (const key of Object.keys(signing.attrs) as (keyof typeof signing.attrs)[]) signing.attrs[key] = 1400
    const state = game.aiClubs![remote.id]
    state.signings = [...state.signings, signing]
    expect(worldTransferTeams(game).find(team => team.id === remote.id)!.players.some(player => player.id === signing.id)).toBe(true)
    expect(game.aiTeams.some(team => team.id === remote.id)).toBe(false)
  })

  it('失败不保存，成功只保存卖队，重读和重复购买安全', () => {
    const game = createWorldGame(20241107)
    const original = game.aiTeams
    const before = JSON.stringify(original)
    economyOf(game).balance = 1_000_000_000
    const remote = worldTransferTeams(game).find(t => !original.some(a => a.id === t.id))!
    const player = remote.players.find(p => !p.starKey)!
    const demands = negotiationDemands(game, player)
    const answers = { goal: demands.goal, role: demands.role }
    const sellerState = createAIClub(game.world!.clubs.find(club => club.id === remote.id)!, 4)
    sellerState.signings = [structuredClone(player)]
    game.aiClubs = { ...game.aiClubs, [remote.id]: sellerState }
    const sellerBalance = sellerState.economy.balance
    expect(signWorldClubPlayer(game, remote.id, player.id, 1, answers).ok).toBe(false)
    expect(game.world!.transferTeams).toBeUndefined()
    let success = false
    for (let offer = 20_000_000; offer < 100_000_000 && !success; offer += 1_000_000) {
      success = signWorldClubPlayer(game, remote.id, player.id, offer, answers).ok
    }
    expect(success).toBe(true)
    expect(sellerState.signings.some(item => item.id === player.id)).toBe(false)
    expect(sellerState.economy.balance).toBeGreaterThan(sellerBalance)
    expect(game.aiTeams).toBe(original)
    expect(JSON.stringify(original)).toBe(before)
    expect(game.world!.transferTeams![remote.id].players).toHaveLength(remote.players.length - 1)
    expect(signWorldClubPlayer(game, remote.id, player.id, 50_000_000, answers).ok).toBe(false)
    const loaded: GameState = JSON.parse(JSON.stringify(game))
    const teams = worldTransferTeams(loaded)
    const seller = teams.find(t => t.id === remote.id)!
    expect(seller.players).toHaveLength(remote.players.length - 1)
    expect(seller.players.some(p => p.id === player.id)).toBe(false)
    expect(cachedOwnerlessTeams(loaded.world!, loaded.seed, loaded.aiClubs)[remote.id].players.some(p => p.id === player.id)).toBe(false)
    expect(teams).toHaveLength(worldTransferTeams(game).length)
  })
})
