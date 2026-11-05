import type { Attributes, GameState, MatchRecord, Player, WorldState } from './types.ts'
import { pickRandomName, translateRandomName } from './data/name-pools.ts'
import { PLAYER_SEEDS, seedById } from './data/players.ts'
import { createRandomPlayer } from './data/random-players.ts'
import { derivedRng } from './rng.ts'
import { HIDDEN_ATTR_MAX, HIDDEN_ATTR_SCALE, MAIN_ATTR_SCALE } from './scale.ts'
import { starTraitId } from './data/star-traits.ts'
import { LEGACY_CLUB_RENAMES } from './data/world-clubs.ts'

/**
 * 把旧存档里的名字升级到现在的命名：
 * 随机球员的中文名改成英文名的译名，虚构队名改成真实低级别联赛球队名，
 * 比赛记录和解说里的旧名字也一起换掉。只改名字，属性和比赛结果都不动。
 * 第 3 版：同一个人不能同时出现在两个地方，见 removeDuplicatePeople。
 */
export const NAMES_VERSION = 3
/** 第 1 版：真实球星从 20 个通用特性换成每人一个专属特性。 */
export const TRAITS_VERSION = 1
/** 第 1 版：爆发（acceleration）从隐藏属性升成外场球员的主属性，存档单位从 0-20 换成 0-1500，比赛评分不变。 */
export const ATTRS_VERSION = 1

function burstToMainScale(attrs: Attributes | undefined): void {
  // 还在 0-20 的才换；升过的值不会这么小。门将的爆发仍是隐藏属性，不走这里。
  if (attrs && attrs.acceleration <= HIDDEN_ATTR_MAX) attrs.acceleration = Math.round(attrs.acceleration * HIDDEN_ATTR_SCALE * MAIN_ATTR_SCALE * 10) / 10
}

function upgradePlayerBurst(player: Player): void {
  if (player.positions?.GK > 0) return
  burstToMainScale(player.attrs)
  burstToMainScale(player.baseAttrs)
  burstToMainScale(player.ceilings)
}

export function upgradeBurstAttr(game: GameState): boolean {
  if (game.attrsVersion === ATTRS_VERSION) return false
  game.attrsVersion = ATTRS_VERSION
  for (const player of allPlayers(game)) upgradePlayerBurst(player)
  for (const card of game.cards ?? []) if (!(card.positions?.GK > 0)) burstToMainScale(card.attrs)
  return true
}

type ClubLike = { name: string; short?: string; color: string; enName?: string }

function renameClub(club: ClubLike): boolean {
  const next = LEGACY_CLUB_RENAMES.get(club.name)
  if (!next) return false
  club.name = next.name
  club.short = next.name.slice(0, 2)
  club.color = next.color
  club.enName = next.enName
  return true
}

function renamePlayer(player: Player): boolean {
  const seed = seedById(player.seedId)
  if (seed && seed.enName === player.enName) {
    if (seed.name === player.name) return false
    player.name = seed.name
    return true
  }
  if (player.era !== 'random' || player.country !== '随机青训') return false
  const translated = translateRandomName(player.enName)
  if (!translated) return false
  player.name = translated.name
  player.country = translated.country
  return true
}

/** 真实球星（包括他的下一代）换成专属特性；随机球员不变。 */
function upgradeStarTrait(player: Player): boolean {
  const seed = seedById(player.seedId)
  if (!seed || seed.enName !== player.enName) return false
  const trait = starTraitId(seed.id)
  if (player.traitId === trait) return false
  player.traitId = trait
  return true
}

function statPlayerId(id: string): string {
  return id.includes(':') ? id.split(':').slice(1).join(':') : id
}

function replaceAllNames(text: string, names: [string, string][]): string {
  let result = text
  for (const [from, to] of names) result = result.split(from).join(to)
  return result
}

/** 只看这场比赛出现过的名字，同名不同队的球员不会被换错。 */
function renameRecord(record: MatchRecord, names: Map<string, string>, clubName: string): void {
  const replaced = new Map<string, string>()
  const clubOf = (name: string, teamId: string) => {
    const next = teamId === 'player' ? clubName : LEGACY_CLUB_RENAMES.get(name)?.name
    if (next && next !== name) replaced.set(name, next)
    return next ?? name
  }
  record.homeName = clubOf(record.homeName, record.homeId)
  record.awayName = clubOf(record.awayName, record.awayId)
  for (const stat of record.playerStats ?? []) {
    const next = names.get(stat.sourceId ?? statPlayerId(stat.playerId))
    if (next && next !== stat.name) {
      replaced.set(stat.name, next)
      stat.name = next
    }
  }
  for (const goal of record.goalDetails ?? []) {
    const next = names.get(statPlayerId(goal.playerId))
    if (next) goal.playerName = next
  }
  for (const skill of record.skillStats ?? []) {
    const next = names.get(statPlayerId(skill.playerId))
    if (next) skill.name = next
  }
  if (replaced.size === 0) return
  const pairs = [...replaced].sort((a, b) => b[0].length - a[0].length)
  for (const entry of record.keyEvents ?? []) entry.text = replaceAllNames(entry.text, pairs)
  for (const entry of record.commentary ?? []) entry.text = replaceAllNames(entry.text, pairs)
}

type LiveTeam = { id?: string; name?: string; players?: { sourceId?: string; name: string }[]; bench?: { sourceId?: string; name: string }[] }
type LiveState = { teams?: LiveTeam[]; log?: { text: string }[]; commentary?: { text: string }[] }

/** 进行中的比赛：引擎快照里也存着名字。 */
function renameLiveMatch(game: GameState, names: Map<string, string>): void {
  const active = game.activeMatch
  if (!active) return
  active.context.opponentName = LEGACY_CLUB_RENAMES.get(active.context.opponentName)?.name ?? active.context.opponentName
  const state = active.engineState as LiveState | undefined
  const replaced = new Map<string, string>()
  for (const team of state?.teams ?? []) {
    const nextClub = team.id === 'player' ? game.clubName : team.name ? LEGACY_CLUB_RENAMES.get(team.name)?.name : undefined
    if (team.name && nextClub && nextClub !== team.name) {
      replaced.set(team.name, nextClub)
      team.name = nextClub
    }
    for (const player of [...(team.players ?? []), ...(team.bench ?? [])]) {
      const next = player.sourceId ? names.get(player.sourceId) : undefined
      if (next && next !== player.name) {
        replaced.set(player.name, next)
        player.name = next
      }
    }
  }
  const pairs = [...replaced].sort((a, b) => b[0].length - a[0].length)
  for (const entry of [...(state?.log ?? []), ...(state?.commentary ?? [])]) entry.text = replaceAllNames(entry.text, pairs)
}

function allPlayers(game: GameState): Player[] {
  return [
    ...(game.roster ?? []),
    ...(game.aiTeams ?? []).flatMap((team) => team?.players ?? []),
    ...(game.freeStars ?? []),
    ...(game.reserveStars ?? []),
    ...(Array.isArray(game.market?.listings) ? game.market.listings.map((listing) => listing.player) : []),
    ...Object.values(game.training ?? {}).map((session) => session?.candidate),
    ...Object.values(game.candidates ?? {}),
  ].filter((player): player is Player => !!player)
}

const STAR_EN_NAMES = new Set(PLAYER_SEEDS.map((seed) => seed.enName))

/**
 * 旧存档里可能有重复的人：AI 球队之间撞名的随机球员，或者玩家已经买走、又被 AI 球队重建出来的球星。
 * 玩家阵容和市场优先。撞名的改个名字，属性不动；重复的球星换成同位置的随机球员，沿用 id，阵容不用动。
 */
function removeDuplicatePeople(game: GameState): void {
  const names = new Set<string>()
  const stars = new Set<string>()
  const remember = (player: Player) => {
    names.add(player.name)
    names.add(player.enName)
    if (player.era !== 'random') stars.add(player.id)
  }
  for (const player of game.roster ?? []) remember(player)
  game.freeStars = (game.freeStars ?? []).filter((player) => !stars.has(player.id))
  for (const player of game.freeStars) remember(player)
  game.reserveStars = (game.reserveStars ?? []).filter((player) => !stars.has(player.id))
  for (const player of game.reserveStars) remember(player)
  for (const listing of Array.isArray(game.market?.listings) ? game.market.listings : []) remember(listing.player)
  for (const club of game.world?.clubs ?? []) club.starPlayerIds = club.starPlayerIds.filter((id) => !stars.has(id))
  for (const team of game.aiTeams ?? []) {
    team.players = (team.players ?? []).map((player) => {
      if (player.era !== 'random') {
        if (!stars.has(player.id)) {
          remember(player)
          return player
        }
        team.starPlayerIds = (team.starPlayerIds ?? []).filter((id) => id !== player.id)
        team.playerNames = (team.playerNames ?? []).filter((name) => name !== player.name)
        const position = (['GK', 'CB', 'W', 'CM', 'ST'] as const).find((item) => player.positions[item] >= 70) ?? 'CM'
        const replacement = createRandomPlayer({ seed: derivedRng(game.seed, 'dedupe-star', team.id, player.id).nextUint32(), position, tier: 3, usedNames: names })
        replacement.id = player.id
        remember(replacement)
        return replacement
      }
      if (!names.has(player.enName) && !names.has(player.name)) {
        remember(player)
        return player
      }
      const rng = derivedRng(game.seed, 'dedupe-name', team.id, player.id)
      let picked = pickRandomName(rng)
      for (let attempt = 0; attempt < 5000 && (names.has(picked.name) || names.has(picked.enName) || STAR_EN_NAMES.has(picked.enName)); attempt++) picked = pickRandomName(rng)
      player.name = picked.name
      player.enName = picked.enName
      player.country = picked.country
      remember(player)
      return player
    })
  }
}

export function upgradeStarTraits(game: GameState): boolean {
  if (game.traitsVersion === TRAITS_VERSION) return false
  game.traitsVersion = TRAITS_VERSION
  for (const player of allPlayers(game)) upgradeStarTrait(player)
  return true
}

export function upgradeNames(game: GameState): boolean {
  if (game.namesVersion === NAMES_VERSION) return false
  game.namesVersion = NAMES_VERSION
  const players = allPlayers(game)
  for (const player of players) renamePlayer(player)
  const names = new Map(players.map((player) => [player.id, player.name]))
  for (const card of game.cards ?? []) card.playerName = names.get(card.playerId) ?? card.playerName
  for (const team of game.aiTeams ?? []) {
    renameClub(team)
    if (Array.isArray(team.playerNames)) team.playerNames = (team.starPlayerIds ?? []).map((id, index) => names.get(id) ?? team.playerNames[index]).filter(Boolean)
  }
  for (const club of game.world?.clubs ?? []) renameClub(club)
  game.clubName = LEGACY_CLUB_RENAMES.get(game.clubName)?.name ?? game.clubName
  for (const record of [...(game.matchHistory ?? []), ...(game.challengeHistory ?? [])]) renameRecord(record, names, game.clubName)
  renameLiveMatch(game, names)
  removeDuplicatePeople(game)
  return true
}

/** 服务器上的共享世界：队名和球星译名。 */
export function upgradeSharedWorldNames(shared: { world?: WorldState; freeStars?: Player[]; reserveStars?: Player[] }): boolean {
  let changed = false
  for (const club of shared.world?.clubs ?? []) if (renameClub(club)) changed = true
  for (const player of [...(shared.freeStars ?? []), ...(shared.reserveStars ?? [])]) {
    if (renamePlayer(player)) changed = true
    if (upgradeStarTrait(player)) changed = true
    const before = player.attrs?.acceleration
    upgradePlayerBurst(player)
    if (player.attrs?.acceleration !== before) changed = true
  }
  return changed
}
