import type { Player, Position, StyleId } from '../types.ts'
import { POSITIONS } from '../types.ts'
import { caOf } from '../ca.ts'
import { derivedRng } from '../rng.ts'
import { createPlayerFromSeed, type PlayerSeed } from './players.ts'

/** 随机球员的名字池。名字不指向真实人物。 */
const SURNAMES = ['林', '陈', '周', '赵', '许', '沈', '韩', '杨', '叶', '苏', '顾', '陆', '程', '方', '江', '邵', '唐', '魏', '冯', '蒋', '罗', '何', '高', '彭', '钟', '田', '石', '白', '秦', '尹', '章', '汪', '毛', '范', '金', '夏', '严', '陶', '洪', '龚']
const GIVEN = ['子昂', '宇航', '嘉树', '明远', '一鸣', '浩然', '思远', '泽宇', '奕辰', '文博', '启航', '天佑', '俊驰', '博文', '承宇', '亦凡', '星河', '景行', '知行', '修远', '雨辰', '牧野', '予安', '清和', '言川', '以恒', '若谷', '照野', '临风', '望舒', '南乔', '知夏', '听澜', '砚秋', '北辰', '云舟', '远山', '既明', '长川', '序言']
const LATIN_FIRST = ['Noah', 'Liam', 'Ethan', 'Luca', 'Milo', 'Leo', 'Owen', 'Finn', 'Ezra', 'Kai', 'Ravi', 'Diego', 'Andre', 'Mateo', 'Ivan', 'Jonas', 'Emil', 'Oscar', 'Hugo', 'Theo', 'Nico', 'Samir', 'Yuki', 'Rafael', 'Dario', 'Bruno', 'Elias', 'Felix', 'Marco', 'Tomas']
const LATIN_LAST = ['Hart', 'Vale', 'Mori', 'Silva', 'Costa', 'Reyes', 'Lind', 'Berg', 'Falk', 'Rossi', 'Moreau', 'Keller', 'Navarro', 'Petrov', 'Okafor', 'Haddad', 'Sato', 'Kim', 'Dahl', 'Novak', 'Serra', 'Brandt', 'Okafor', 'Ferreira', 'Marchetti', 'Voss', 'Lund', 'Arslan', 'Bianchi', 'Kovac']

const STYLES: Record<Position, StyleId[]> = {
  GK: ['gk_wall', 'gk_shotstopper', 'gk_sweeper'],
  CB: ['cb_stopper', 'cb_cover', 'cb_ballplaying'],
  W: ['w_dribbler', 'w_crosser', 'w_finisher', 'w_playmaker', 'w_engine'],
  CM: ['cm_playmaker', 'cm_creator', 'cm_destroyer', 'cm_box2box', 'cm_mezzala', 'cm_engine'],
  ST: ['st_finisher', 'st_poacher', 'st_target', 'st_runner', 'st_false9'],
}

export type RandomPlayerOptions = {
  seed: number
  position: Position
  /** 1-4；随机球员默认不超过 4，潜力低于世界级。 */
  tier: number
  usedNames?: Set<string>
  idPrefix?: string
}

export function createRandomPlayer(options: RandomPlayerOptions): Player {
  const { seed, position } = options
  const rng = derivedRng(seed, 'random-player', position)
  const tier = Math.max(1, Math.min(4, Math.round(options.tier)))
  const used = options.usedNames ?? new Set<string>()
  let name = ''
  let enName = ''
  for (let attempt = 0; attempt < 500; attempt++) {
    name = rng.pick(SURNAMES) + rng.pick(GIVEN)
    enName = `${rng.pick(LATIN_FIRST)} ${rng.pick(LATIN_LAST)}`
    if (!used.has(name) && !used.has(enName)) break
  }
  used.add(name)
  used.add(enName)
  const style = rng.pick(STYLES[position])
  const foot = position === 'GK' || position === 'CB' ? (rng.chance(0.2) ? 'L' : 'R') : (rng.chance(0.25) ? 'L' : 'R')
  const height = position === 'GK' ? 185 + rng.int(18) : position === 'CB' ? 181 + rng.int(15) : position === 'ST' ? 175 + rng.int(18) : 168 + rng.int(17)
  const playerSeed: PlayerSeed = {
    id: `${options.idPrefix ?? 'r'}-${seed.toString(36)}`,
    name,
    enName,
    country: '随机青训',
    era: 'random',
    tier,
    pos: position,
    style,
    foot,
    height,
  }
  const player = createPlayerFromSeed(playerSeed)
  // 随机球员的潜力上限低于世界级（真实球星约 170-200）；同时保证不低于当前 CA。
  const cap = (148 + tier * 5 + rng.float() * 7) * 7.5
  const current = caOf(player.attrs, position === 'GK')
  player.pa = Math.round(Math.max(current, Math.min(player.pa, cap)) * 10) / 10
  player.condition = 100
  player.energy = 100
  player.age = 16 + rng.int(9)
  return player
}

export function randomSquadPositionTemplate(): Position[] {
  return ['GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'W', 'W', 'W', 'W', 'CM', 'CM', 'CM', 'CM', 'ST', 'ST', 'ST', 'ST']
}

export function randomPositionFor(index: number): Position {
  return POSITIONS[index % POSITIONS.length]
}
