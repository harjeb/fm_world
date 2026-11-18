import { describe, expect, it } from 'vitest'
import { createWorldGame } from '../src/game/world.ts'
import { createRandomPlayer } from '../src/game/data/random-players.ts'
import { createPlayerFromSeed, PLAYER_SEEDS } from '../src/game/data/players.ts'
import { ensureYouth } from '../src/game/youth.ts'
import { equipCard, untrainedPlayer, addTrainedCard } from '../src/game/cards.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { DETAILED_POSITIONS, readDetailedPositions } from '../src/game/detailed-positions.ts'
import { naturalPositionProfile } from '../src/game/natural-positions.ts'
import { livePositionPlayers, migrateLivePlayerPositions, migratePositionProfiles, preservePositionProfiles } from '../src/game/position-profile-migration.ts'
import type { GameState, Player, PlayerCard } from '../src/game/types.ts'

function legacy(): Player {
  const p = createRandomPlayer({ seed: 886, position: 'W', tier: 2, idPrefix: 'd2n_01-7', modernPositions: false })
  delete p.positionProfile
  p.baseDetailedPositions = { DL: 60, DR: 65, WBL: 62, WBR: 63, ML: 84, MR: 85, AML: 98, AMR: 99 }
  p.detailedPositions = { ...p.baseDetailedPositions }
  return p
}
function nonPosition(p: Player) {
  const { positionProfile, detailedPositions, baseDetailedPositions, detailedPositionsVersion, baseDetailedPositionsVersion, ...rest } = p
  return rest
}
function card(p: Player, id: string): PlayerCard {
  return { id, playerId: p.id, playerName: p.name, serial: 1, version: 1, routeId: null, createdAt: 1, attrs: { ...p.attrs }, positions: { ...p.positions }, detailedPositions: { ...p.detailedPositions }, detailedPositionsVersion: 1, personality: { ...p.personality }, skills: [...p.skills] }
}

describe('天然位置兼容迁移', () => {
  it('所有实时副本一致补齐，只增熟练度，不改属性/CA相关值/合同，反复迁移幂等', () => {
    const game = createWorldGame(1187)
    const player = legacy()
    player.contract = { clubId: 'player', wage: 123, expiresSeason: 9 }
    game.roster.push(player)
    game.aiTeams[0].players.push(structuredClone(player))
    game.freeStars.push(structuredClone(player))
    game.reserveStars = [structuredClone(player)]
    game.market = { listings: [{ player: structuredClone(player), price: 12345, listedRound: 1 }], lastSettledRound: 0 }
    game.training[player.id] = createTrainingSession(structuredClone(player), 123)
    game.candidates[player.id] = structuredClone(player)
    const copies = livePositionPlayers(game).filter(p => p.id === player.id)
    const before = copies.map(p => ({ player: nonPosition(structuredClone(p)), current: readDetailedPositions(p), base: readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions }) }))
    expect(migratePositionProfiles(game)).toBe(true)
    for (let i = 0; i < copies.length; i++) {
      const p = copies[i]
      expect(nonPosition(p)).toEqual(before[i].player)
      expect(p.positionProfile?.primary).toBe('DL')
      expect(p.detailedPositions!.DL).toBeGreaterThanOrEqual(90)
      expect(p.baseDetailedPositions!.WBL).toBeGreaterThanOrEqual(80)
      for (const pos of DETAILED_POSITIONS) {
        expect(readDetailedPositions(p)[pos]).toBeGreaterThanOrEqual(before[i].current[pos])
        expect(readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions })[pos]).toBeGreaterThanOrEqual(before[i].base[pos])
      }
    }
    const after = JSON.stringify(game)
    expect(migratePositionProfiles(game)).toBe(false)
    expect(JSON.stringify(game)).toBe(after)
  })
  it('缺少细分键原本回落到粗位置，不能迁移后反而降低', () => {
    const p = legacy()
    p.positions.W = p.basePositions.W = 99
    delete p.detailedPositions; delete p.baseDetailedPositions
    delete p.detailedPositionsVersion; delete p.baseDetailedPositionsVersion
    const before = readDetailedPositions(p)
    migrateLivePlayerPositions(p)
    for (const pos of DETAILED_POSITIONS) expect(readDetailedPositions(p)[pos]).toBeGreaterThanOrEqual(before[pos])
    expect(migrateLivePlayerPositions(p)).toBe(false)
  })
  it('每张卡独立补基础位置，已训练99保留，不把其他卡的成果串到基础或另一张卡', () => {
    const game = createWorldGame(1188)
    const p = legacy()
    game.roster.push(p)
    const equipped = card(p, 'equipped'), other = card(p, 'other')
    equipped.detailedPositions!.DM = 99
    other.detailedPositions!.AMC = 97
    game.cards = [equipped, other]
    p.equippedCardId = equipped.id
    p.detailedPositions = { ...equipped.detailedPositions }
    const baselineDM = readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions }).DM
    migratePositionProfiles(game)
    expect(p.detailedPositions).toEqual(equipped.detailedPositions)
    expect(equipped.detailedPositions!.DM).toBe(99)
    expect(readDetailedPositions(other).DM).not.toBe(99)
    expect(readDetailedPositions({ positions: p.basePositions, detailedPositions: p.baseDetailedPositions }).DM).toBe(baselineDM)
    expect(equipCard(game, p.id, other.id).ok).toBe(true)
    expect(p.detailedPositions!.DL).toBeGreaterThanOrEqual(90)
    expect(p.detailedPositions!.AMC).toBe(97)
    expect(equipCard(game, p.id, null).ok).toBe(true)
    expect(p.detailedPositions!.DL).toBeGreaterThanOrEqual(90)
    expect(readDetailedPositions(p).DM).toBe(baselineDM)
  })
  it('进行中的候选卡能完成，比赛/回放/PvE快照及共享表别名不被修改', () => {
    const game = createWorldGame(1189), p = legacy()
    game.roster.push(p)
    const session = createTrainingSession(p, 443)
    game.training[p.id] = session
    game.activeMatch = { engineState: { detail: p.detailedPositions, attrs: p.attrs }, lineup: game.lineup } as any
    const before = structuredClone(game.activeMatch)
    const pve = structuredClone(game.pve)
    const history = structuredClone(game.matchHistory)
    migratePositionProfiles(game)
    expect(game.activeMatch).toEqual(before)
    expect(game.pve).toEqual(pve)
    expect(game.matchHistory).toEqual(history)
    const result = addTrainedCard(game, session)
    expect(result.detailedPositions!.DL).toBeGreaterThanOrEqual(90)
    expect(untrainedPlayer(p).detailedPositions!.DL).toBeGreaterThanOrEqual(90)
  })
  it('青训成员与候选人以入营位置补齐，而不是把后来改的训练方向当成出生位置', () => {
    const game = createWorldGame(1190)
    ensureYouth(game, game.createdAt)
    const member = game.youth!.members[2]
    delete member.player.positionProfile
    member.plan = { position: 'AMR', focus: 'finishing' }
    member.player.baseDetailedPositions = { DL: 90, AML: 98 }
    const candidate = structuredClone(member)
    candidate.player.id += '-intake'
    game.youth!.intake.candidates.push(candidate)
    migratePositionProfiles(game)
    expect((member.player as Player).positionProfile?.primary).toBe('DL')
    expect(candidate.player.positionProfile?.primary).toBe('DL')
    expect(member.player.baseDetailedPositions!.AML).toBe(98)
    expect(readDetailedPositions({ positions: member.player.basePositions, detailedPositions: member.player.baseDetailedPositions }).WBL).toBeGreaterThanOrEqual(80)
  })
  it('真实球星、重生及奖励改ID副本使用同一位置资料', () => {
    const p = createPlayerFromSeed(PLAYER_SEEDS.find(p => p.enName === 'David Beckham')!)
    const regen = structuredClone(p)
    regen.id = `regen-${p.id}-1`; delete regen.positionProfile
    expect(naturalPositionProfile(regen)).toEqual(p.positionProfile)
    const reward = structuredClone(regen); reward.id = 'reward-test'
    expect(naturalPositionProfile(reward)).toEqual(p.positionProfile)
    expect(p.positionProfile?.primary).toBe('MR')
  })
  it('客户端不能伪造天然位置；修正时保留合法训练成果，但不能把伪造当前表写进权威旧卡', () => {
    const original = createWorldGame(1191), p = legacy()
    original.roster.push(p)
    migratePositionProfiles(original)
    const next = structuredClone(original)
    const incoming = next.roster.find(x => x.id === p.id)!
    incoming.positionProfile = { version: 1, primary: 'ST', floors: { ST: 100, DM: 100 } }
    incoming.baseDetailedPositions!.AMC = 99
    preservePositionProfiles(original, next)
    expect(incoming.positionProfile).toEqual(p.positionProfile)
    expect(incoming.baseDetailedPositions!.AMC).toBe(99)
    const canonical = card(p, 'known-card')
    next.cards = [canonical]
    incoming.equippedCardId = canonical.id
    incoming.detailedPositions = { ...canonical.detailedPositions, DM: 100 }
    migratePositionProfiles(next, false)
    expect(readDetailedPositions(canonical).DM).not.toBe(100)
    expect(incoming.detailedPositions).toEqual(canonical.detailedPositions)
  })
})
