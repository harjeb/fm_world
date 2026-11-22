import { backfillNaturalPlayer, initializeNaturalPositions, naturalStyle, randomNaturalPosition } from '../natural-positions.ts'
import { DETAILED_TO_POSITION } from '../detailed-positions.ts'
import type { DetailedPosition, Player, Position, StyleId } from '../types.ts'
import { ALL_ATTRIBUTES, POSITIONS } from '../types.ts'
import { CA_SCALE, caOf, costAttrs } from '../ca.ts'
import { attrLimit, attrRating, mainAttrsFor } from '../scale.ts'
import { derivedRng } from '../rng.ts'
import { normalizeCeilings } from './attr-profile.ts'
import { pickRandomName } from './name-pools.ts'
import { PLAYER_SEEDS, createPlayerFromSeed, type PlayerSeed } from './players.ts'

const STAR_EN_NAMES = new Set(PLAYER_SEEDS.map((seed) => seed.enName))

const STYLES: Record<Position, StyleId[]> = {
  GK: ['gk_wall', 'gk_shotstopper', 'gk_sweeper'],
  CB: ['cb_stopper', 'cb_cover', 'cb_ballplaying'],
  W: ['w_dribbler', 'w_crosser', 'w_finisher', 'w_playmaker', 'w_engine'],
  CM: ['cm_playmaker', 'cm_creator', 'cm_destroyer', 'cm_box2box', 'cm_mezzala', 'cm_engine'],
  ST: ['st_finisher', 'st_poacher', 'st_target', 'st_runner', 'st_false9'],
}

export type SquadName = ReturnType<typeof pickRandomName>

export type RandomPlayerOptions = {
  seed: number
  position: Position
  /** Explicit intake/team role; generation uses a separate random stream. */
  detailedPosition?: DetailedPosition
  /** false only for rebuilding existing legacy-world identities. */
  modernPositions?: boolean
  /** 1-4；随机球员默认不超过 4，潜力低于世界级。 */
  tier: number
  /** 可选：显式指定生成后的基础 CA（如自由市场每日补充球员 200-240）。 */
  targetBaseCa?: number
  usedNames?: Set<string>
  idPrefix?: string
  /** 名字已经定好时用它，比如从名册里发的。 */
  fixedName?: SquadName
}

/**
 * 给全世界的球队发名字：每支队一段，整本名册里没有重名。
 * 属性由名字决定，重名的两个人长得一模一样，看起来就是同一个球员。
 * reserved 里的名字已经有人用了（比如玩家阵容里的老队员），不会再发。
 */
export function buildNameBook(
  seed: number,
  clubs: number,
  perClub: number,
  reserved: ReadonlySet<string> = new Set(),
  /** 每支队已经用掉的姓（追加名册时传入，尽量不和同队的老队员同姓）。 */
  familiesByClub: readonly (readonly string[])[] = [],
): SquadName[][] {
  const rng = derivedRng(seed, 'name-book')
  const used = new Set(reserved)
  // 追加名册（传了老队员的姓）时更严格：英文名的最后一个词也算进去，东亚名字的“名”撞了看起来也像同姓。
  const strict = familiesByClub.length > 0
  const keysOf = (name: SquadName): string[] => (strict ? [name.family, name.enName.split(' ').at(-1) ?? name.family] : [name.family])
  return Array.from({ length: clubs }, (_, club) => {
    const families = new Set<string>(familiesByClub[club] ?? [])
    return Array.from({ length: perClub }, () => {
      let picked = pickRandomName(rng)
      for (let attempt = 0; attempt < 5000; attempt++) {
        // 球场上只显示姓，所以同队的姓也尽量不重复；实在挑不出来时才放宽。
        const familyFree = attempt >= 50 || !keysOf(picked).some((key) => families.has(key))
        if (familyFree && !used.has(picked.name) && !used.has(picked.enName) && !STAR_EN_NAMES.has(picked.enName)) break
        picked = pickRandomName(rng)
      }
      used.add(picked.name)
      used.add(picked.enName)
      for (const key of keysOf(picked)) families.add(key)
      return picked
    })
  })
}

export function createRandomPlayer(options: RandomPlayerOptions): Player {
  const { seed, position } = options
  const rng = derivedRng(seed, 'random-player', position)
  const tier = Math.max(1, Math.min(4, Math.round(options.tier)))
  const used = options.usedNames ?? new Set<string>()
  let picked = options.fixedName ?? pickRandomName(rng)
  for (let attempt = 0; attempt < 500 && !options.fixedName; attempt++) {
    // 球场上只显示姓，所以前面先尽量让同队的姓也不重复；名单太大时再放宽。
    const familyFree = attempt >= 50 || !used.has(`姓:${picked.family}`)
    if (familyFree && !used.has(picked.name) && !used.has(picked.enName) && !STAR_EN_NAMES.has(picked.enName)) break
    picked = pickRandomName(rng)
  }
  const { name, enName, country } = picked
  used.add(name)
  used.add(enName)
  used.add(`姓:${picked.family}`)
  const oldStyle = rng.pick(STYLES[position]) // Keep legacy draws/identity stable.
  const detailed = options.detailedPosition ?? randomNaturalPosition(position, seed)
  if (DETAILED_TO_POSITION[detailed] !== position) throw new Error('具体位置与球员位置类型不符')
  const style = options.modernPositions === false ? oldStyle : naturalStyle(detailed, seed)
  const foot = position === 'GK' || position === 'CB' ? (rng.chance(0.2) ? 'L' : 'R') : (rng.chance(0.25) ? 'L' : 'R')
  const height = position === 'GK' ? 185 + rng.int(18) : position === 'CB' ? 181 + rng.int(15) : position === 'ST' ? 175 + rng.int(18) : 168 + rng.int(17)
  const playerSeed: PlayerSeed = {
    id: `${options.idPrefix ?? 'r'}-${seed.toString(36)}`,
    name,
    enName,
    country,
    era: 'random',
    tier,
    pos: position,
    style,
    foot,
    height,
  }
  const player = createPlayerFromSeed(playerSeed)
  if (options.targetBaseCa !== undefined && Number.isFinite(options.targetBaseCa) && options.targetBaseCa > 0) {
    const isGk = position === 'GK'
    const rawCa = caOf(player.attrs, isGk)
    if (rawCa > 0) {
      const scale = Math.sqrt(options.targetBaseCa / rawCa)
      for (const key of ALL_ATTRIBUTES) {
        player.attrs[key] = Math.min(attrLimit(key, isGk), Math.round(player.attrs[key] * scale * 10) / 10)
      }
      // 隐藏属性按 0.1 舍入会带来 ±0.7 的 CA 抖动，用主属性微调一次收口到目标 CA 附近（±0.05）。
      const afterCa = caOf(player.attrs, isGk)
      const deltaCa = options.targetBaseCa - afterCa
      if (Math.abs(deltaCa) > 0.05) {
        const mains = mainAttrsFor(isGk)
        const totalKeys = costAttrs(isGk).length
        let mainSum = 0
        for (const key of mains) mainSum += (attrRating(key, player.attrs[key], isGk) / 100) ** 2
        const mainCa = (CA_SCALE * mainSum) / totalKeys
        if (mainCa + deltaCa > 0 && mainCa > 0) {
          const fineScale = Math.sqrt((mainCa + deltaCa) / mainCa)
          for (const key of mains) {
            player.attrs[key] = Math.min(attrLimit(key, isGk), Math.round(player.attrs[key] * fineScale * 10) / 10)
          }
        }
      }
      player.baseAttrs = { ...player.attrs }
      player.ceilings = normalizeCeilings(player.attrs, player.ceilings, (key) => attrLimit(key, isGk))
    }
  }
  // 随机球员的潜力上限低于世界级（真实球星约 170-200）；同时保证不低于当前 CA。
  const cap = (148 + tier * 5 + rng.float() * 7) * 7.5
  const current = caOf(player.attrs, position === 'GK')
  player.pa = Math.round(Math.max(current, Math.min(player.pa, cap)) * 10) / 10
  player.condition = 100
  player.energy = 100
  player.age = 16 + rng.int(9)
  if (options.modernPositions === false) backfillNaturalPlayer(player)
  else initializeNaturalPositions(player, detailed)
  return player
}

/** 7 人制时代的 18 人名单。11 人制的名单在它后面追加，前 18 个槽位的人和名字保持不变。 */
const LEGACY_SQUAD_TEMPLATE: Position[] = ['GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'W', 'W', 'W', 'W', 'CM', 'CM', 'CM', 'CM', 'ST', 'ST', 'ST', 'ST']
/** 11 人制追加的 7 个槽位：第三门将、两个中卫、三个边路（边后卫 / 边前卫）、一个中场。 */
const ELEVEN_EXTENSION: Position[] = ['GK', 'CB', 'CB', 'W', 'W', 'W', 'CM']

/** 迁移前每队的人数。 */
export const LEGACY_SQUAD_SIZE = LEGACY_SQUAD_TEMPLATE.length

/** 每支球队的位置模板（25 人：门将 3、中卫 6、边路 7、中场 5、前锋 4）。 */
export function randomSquadPositionTemplate(): Position[] {
  return [...LEGACY_SQUAD_TEMPLATE, ...ELEVEN_EXTENSION]
}

export function randomPositionFor(index: number): Position {
  return POSITIONS[index % POSITIONS.length]
}
