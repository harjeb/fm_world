/**
 * 生成 500 名球星的专属特性（npm run traits:gen），写到 src/game/data/star-traits.generated.ts。
 *
 * 效果类型按位置和打法风格挑，数值按星级、条件稀有度和名字散列决定。
 * 效果组合不会重复，名字也不会重复；同一个种子表永远生成同样的结果。
 *
 * 选场景时看的是真实比赛里的频率（每队每场）：射门约 10.6 次，其中禁区内 37%、禁区外 63%，
 * 面前只剩门将约 1.4 次（几乎都是前锋），头球约 0.6 次，直接任意球约 1 次，点球 0.005 次；
 * 传球约 50 次，直塞占三分之一，25 米以上的长传约 15 次，真正的传中不到 1 次。
 * 点球一个赛季也碰不到一次，等于没有特性，所以不生成。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PLAYER_SEEDS, type PlayerSeed } from '../src/game/data/players.ts'
import type { PassScope, ShotScope, StarEffect, TraitCondition } from '../src/game/data/star-traits.ts'
import type { AttrKey, Position, StyleId } from '../src/game/types.ts'

type Weighted<T extends string> = Partial<Record<T, number>>
type Kind = StarEffect['kind']

function hash(text: string): number {
  let value = 2166136261
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0
    value = Math.imul(value, 16777619)
  }
  // 再搅一次，让相近的输入不要落在相近的结果上。
  value ^= value >>> 13
  value = Math.imul(value, 0x5bd1e995)
  value ^= value >>> 15
  return value >>> 0
}

function pick<T extends string>(weights: Weighted<T>, roll: number): T {
  const entries = Object.entries(weights) as [T, number][]
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = roll % total
  for (const [key, weight] of entries) {
    if (cursor < weight) return key
    cursor -= weight
  }
  return entries[0][0]
}

/* ---------- 效果类型：每个位置常见哪些 ---------- */

const POSITION_KINDS: Record<Position, Weighted<Kind>> = {
  GK: { attr: 30, save: 55, skillBoost: 4, aura: 6, injury: 5, card: 3 },
  CB: { attr: 30, defend: 28, aura: 9, intimidate: 9, card: 6, shot: 3, injury: 5, pass: 7, stamina: 3 },
  W: { attr: 30, dribble: 20, shot: 16, pass: 10, stamina: 8, secondWind: 5, hotStreak: 4, goalRecover: 3, skillBoost: 2, onside: 3, drawFoul: 3 },
  CM: { attr: 28, pass: 24, defend: 10, aura: 11, stamina: 8, shot: 10, skillBoost: 3, secondWind: 4, injury: 2 },
  ST: { attr: 28, shot: 36, hotStreak: 10, goalRecover: 5, onside: 7, skillBoost: 3, intimidate: 4, dribble: 4, secondWind: 3, drawFoul: 2 },
}

/** 这些打法的效果类型更有辨识度，比如传中型边锋多给传球，防守中场多给防守。 */
const STYLE_KINDS: Partial<Record<StyleId, Weighted<Kind>>> = {
  w_crosser: { pass: 40, attr: 28, stamina: 10, dribble: 8, skillBoost: 2, secondWind: 5, shot: 7 },
  w_dribbler: { dribble: 36, attr: 28, shot: 10, stamina: 6, secondWind: 5, skillBoost: 2, hotStreak: 4, onside: 3, goalRecover: 3, drawFoul: 6 },
  w_finisher: { shot: 34, attr: 28, dribble: 10, hotStreak: 8, goalRecover: 5, onside: 5, skillBoost: 2, secondWind: 3, stamina: 3, drawFoul: 2 },
  w_playmaker: { pass: 30, attr: 28, dribble: 18, shot: 14, skillBoost: 3, aura: 6, stamina: 5, drawFoul: 3 },
  fb_attacking: { attr: 28, pass: 24, stamina: 14, dribble: 12, defend: 10, secondWind: 6, aura: 5, skillBoost: 1 },
  fb_playmaker: { pass: 34, attr: 28, stamina: 12, defend: 10, aura: 9, skillBoost: 2, secondWind: 4 },
  cm_playmaker: { pass: 36, attr: 28, aura: 14, skillBoost: 3, stamina: 6, shot: 10, secondWind: 3, injury: 2 },
  cm_creator: { pass: 36, attr: 28, dribble: 10, shot: 14, skillBoost: 4, aura: 7, stamina: 3 },
  cm_destroyer: { defend: 36, attr: 28, stamina: 10, intimidate: 9, card: 6, aura: 7, injury: 3, secondWind: 2 },
  cm_box2box: { attr: 28, stamina: 14, defend: 14, pass: 12, shot: 14, secondWind: 7, aura: 7, injury: 2, hotStreak: 2 },
  cb_ballplaying: { attr: 28, pass: 28, defend: 18, aura: 9, shot: 2, card: 4, skillBoost: 3, intimidate: 5, injury: 3 },
  st_target: { shot: 34, attr: 28, intimidate: 10, hotStreak: 8, skillBoost: 3, injury: 4, goalRecover: 4, aura: 5 },
  st_runner: { attr: 28, shot: 30, onside: 16, secondWind: 6, hotStreak: 6, goalRecover: 5, dribble: 6, stamina: 3 },
  st_false9: { attr: 28, pass: 12, shot: 30, dribble: 12, skillBoost: 3, hotStreak: 6, aura: 7, goalRecover: 3, drawFoul: 3 },
  gk_sweeper: { attr: 34, save: 38, pass: 10, skillBoost: 4, aura: 6, injury: 5, card: 3 },
}

const STYLE_ATTRS: Record<StyleId, Weighted<AttrKey>> = {
  gk_wall: { reflexes: 8, handling: 2, oneOnOne: 1 },
  gk_shotstopper: { reflexes: 8, oneOnOne: 1, handling: 1 },
  gk_sweeper: { reflexes: 4, rushing: 3, passing: 3 },
  cb_stopper: { tackling: 5, strength: 4, speed: 1 },
  cb_cover: { tackling: 4, speed: 3, strength: 2, passing: 1 },
  cb_ballplaying: { passing: 5, tackling: 3, strength: 1, dribbling: 1 },
  fb_attacking: { speed: 3, acceleration: 2, passing: 3, dribbling: 2, tackling: 2 },
  fb_playmaker: { passing: 5, speed: 2, tackling: 2 },
  w_dribbler: { dribbling: 6, acceleration: 3, speed: 1, shooting: 1 },
  w_crosser: { passing: 5, speed: 3, dribbling: 2 },
  w_finisher: { shooting: 5, dribbling: 3, acceleration: 2, speed: 1 },
  w_playmaker: { passing: 4, dribbling: 4, shooting: 2 },
  w_engine: { speed: 3, acceleration: 2, passing: 2, dribbling: 2, strength: 1 },
  cm_playmaker: { passing: 7, dribbling: 2, shooting: 1 },
  cm_creator: { passing: 5, dribbling: 3, shooting: 2 },
  cm_destroyer: { tackling: 6, strength: 3, passing: 1 },
  cm_box2box: { tackling: 3, passing: 3, shooting: 2, strength: 2, speed: 1 },
  cm_mezzala: { dribbling: 3, passing: 3, shooting: 3, speed: 1 },
  cm_engine: { speed: 3, tackling: 3, passing: 3, strength: 1 },
  st_finisher: { shooting: 7, speed: 2, strength: 1 },
  st_poacher: { shooting: 7, acceleration: 2, speed: 1 },
  st_target: { strength: 5, shooting: 4, passing: 1 },
  st_runner: { speed: 3, acceleration: 3, shooting: 4, dribbling: 1 },
  st_false9: { passing: 4, dribbling: 3, shooting: 3 },
}

const GK_CONDITIONS: Weighted<TraitCondition> = { any: 3, late: 2, ahead: 2, home: 1, away: 1, behind: 1, level: 1, early: 1, secondHalf: 1 }

/** 加属性时可以配哪些条件：情境类条件只配引擎里确实会传这个情境的属性。 */
const ATTR_CONDITIONS: Partial<Record<AttrKey, Weighted<TraitCondition>>> = {
  shooting: { inBox: 5, late: 3, any: 2, behind: 2, level: 2, subbedOn: 1, away: 1, home: 1, early: 1, secondHalf: 1, fresh: 1 },
  passing: { any: 3, attackingThird: 2, wide: 2, ahead: 2, ownHalf: 2, late: 1, behind: 1, level: 1, fresh: 1, home: 1, away: 1 },
  dribbling: { any: 3, wide: 3, attackingThird: 3, behind: 2, fresh: 2, subbedOn: 1, late: 1, ahead: 1, level: 1, home: 1, away: 1 },
  tackling: { ownHalf: 4, any: 3, ahead: 2, late: 2, level: 1, tired: 1, home: 1, away: 1 },
  strength: { aerial: 4, any: 3, ownHalf: 1, late: 1, tired: 1, behind: 1, home: 1, away: 1 },
  speed: { wide: 3, fresh: 3, any: 2, late: 2, attackingThird: 2, subbedOn: 1, tired: 1, early: 1, secondHalf: 1, away: 1 },
  acceleration: { fresh: 3, any: 3, attackingThird: 3, wide: 2, late: 2, behind: 1, early: 1, secondHalf: 1, home: 1, away: 1 },
  reflexes: GK_CONDITIONS,
  handling: GK_CONDITIONS,
  rushing: { aerial: 3, ...GK_CONDITIONS },
  oneOnOne: GK_CONDITIONS,
  composure: GK_CONDITIONS,
}

/** 其他效果类型可以配的时机。 */
const EFFECT_CONDITIONS: Weighted<TraitCondition> = { any: 7, late: 1, behind: 1, ahead: 1, level: 1, home: 1, away: 1, secondHalf: 1, early: 1 }
const FORWARD_CONDITIONS: Weighted<TraitCondition> = { ...EFFECT_CONDITIONS, subbedOn: 1 }
const STAMINA_CONDITIONS: Weighted<TraitCondition> = { any: 5, late: 1, secondHalf: 1, away: 1 }
/** 任意球、头球这些每场只碰到一两次的场景，再配“最后 15 分钟”就几乎触发不了，只给常见的条件。 */
const RARE_SCOPE_CONDITIONS: Weighted<TraitCondition> = { any: 7, home: 1, away: 1, secondHalf: 1 }
const RARE_SHOT_SCOPES = new Set<ShotScope>(['freeKick', 'header', 'oneOnOne'])
const RARE_PASS_SCOPES = new Set<PassScope>(['freeKick', 'long'])

/** 这个条件在真实比赛里占多少时间（实测）：越少见，加成越高。 */
const UPTIME: Record<TraitCondition, number> = {
  any: 1, home: 0.5, away: 0.5, secondHalf: 0.5, wide: 0.5, fresh: 0.45, level: 0.45, inBox: 0.4, tired: 0.4, ownHalf: 0.8, attackingThird: 0.3, behind: 0.27, ahead: 0.27, aerial: 0.25, late: 0.17, early: 0.16, subbedOn: 0.15, crossing: 0.05,
}

/** 星级系数：3 星 1 倍，4 星 1.3 倍，5 星 1.6 倍。 */
const tierScale = (tier: number) => 1 + (Math.max(3, Math.min(5, tier)) - 3) * 0.3
/** 条件越少见加得越多，但最多 2.5 倍；补不满，所以无条件的特性总是略占优。 */
const whenScale = (when: TraitCondition) => Math.min(2.5, UPTIME[when] ** -0.6)

/** 在 [low, high] 里按散列取一个值，再按星级和条件放大，保留 step 的倍数。 */
function scaled(seed: PlayerSeed, label: string, low: number, high: number, when: TraitCondition, step = 1): number {
  const span = Math.round((high - low) / step)
  const base = low + (hash(`${seed.enName}|${label}`) % (span + 1)) * step
  return Math.round((base * tierScale(seed.tier) * whenScale(when)) / step) * step
}

/* ---------- 加属性 ---------- */

/**
 * 概率的权重。5% +600 这种彩票型的期望很低，只留少量；大多数落在 20%–60%。
 * 彩票型只配“任何时候”，有条件的概率不能太低，否则一场比赛也触发不了几次。
 */
const CHANCES: Weighted<string> = { 5: 2, 8: 1, 10: 2, 12: 1, 15: 3, 20: 5, 25: 5, 30: 6, 35: 6, 40: 6, 45: 5, 50: 6, 55: 4, 60: 5, 70: 4, 80: 3, 90: 2, 100: 6 }
const MIN_UPTIME = 0.15

/** 100% 触发、任何时候都生效时加多少。 */
const ATTR_BASE: Record<number, number> = { 3: 170, 4: 210, 5: 260 }
/** 一次最多加多少：概率再低也不超过，星级越高上限越高。 */
const ATTR_CAP: Record<number, number> = { 3: 500, 4: 600, 5: 700 }
/** 门将的属性直接决定每一次扑救，同样的数值影响比外场球员大得多。 */
const GK_ATTR_SCALE = 0.5

/** 概率越低、条件越少见，一次加得越多，但期望仍然略低于稳定触发的。 */
function attrBonus(seed: PlayerSeed, chance: number, when: TraitCondition): number {
  const base = (ATTR_BASE[seed.tier] ?? 170) * (seed.pos === 'GK' ? GK_ATTR_SCALE : 1)
  const raw = base * (100 / chance) ** 0.8 * UPTIME[when] ** -0.8
  return Math.max(30, Math.min(ATTR_CAP[seed.tier] ?? 500, Math.round(raw / 5) * 5))
}

function attrChance(rolled: number, when: TraitCondition): number {
  if (when === 'any') return rolled
  const lowest = Math.min(100, Math.ceil(MIN_UPTIME / UPTIME[when] * 100 / 5) * 5)
  return Math.max(rolled, lowest)
}

/* ---------- 射门和传球的适用范围 ---------- */

const STYLE_SHOT_SCOPES: Partial<Record<StyleId, Weighted<ShotScope>>> = {
  st_finisher: { inBox: 3, oneOnOne: 3, any: 2, longRange: 1 },
  st_poacher: { inBox: 4, oneOnOne: 4, header: 1, any: 1 },
  st_target: { header: 3, inBox: 3, any: 2 },
  st_runner: { oneOnOne: 6, inBox: 2, any: 1 },
  st_false9: { freeKick: 3, longRange: 3, oneOnOne: 2, any: 2, inBox: 1 },
  w_finisher: { inBox: 3, longRange: 3, oneOnOne: 3, freeKick: 2 },
  w_playmaker: { freeKick: 5, longRange: 4, any: 2 },
  cm_playmaker: { freeKick: 5, longRange: 3, any: 1 },
  cm_creator: { freeKick: 4, longRange: 3, inBox: 1, any: 1 },
  cb_stopper: { header: 1 },
  cb_cover: { header: 1 },
  cb_ballplaying: { header: 3, freeKick: 1, longRange: 1 },
}
const DEFAULT_SHOT_SCOPES: Weighted<ShotScope> = { longRange: 3, any: 2, inBox: 2, freeKick: 1 }
const FORWARD_SHOT_SCOPES: Weighted<ShotScope> = { ...DEFAULT_SHOT_SCOPES, oneOnOne: 2 }
const GK_SAVE_SCOPES: Weighted<ShotScope> = { any: 3, oneOnOne: 3, longRange: 3, inBox: 3, freeKick: 3, header: 1 }
const STYLE_PASS_SCOPES: Partial<Record<StyleId, Weighted<PassScope>>> = {
  cm_playmaker: { through: 4, long: 4, freeKick: 3, pressured: 3, short: 2, any: 1 },
  cm_creator: { through: 5, freeKick: 3, long: 2, pressured: 2, any: 1 },
  cm_destroyer: { short: 3, pressured: 3, long: 1, any: 1 },
  cb_ballplaying: { long: 5, through: 3, short: 2, pressured: 2, any: 1 },
  w_crosser: { cross: 5, freeKick: 4, any: 1 },
  fb_attacking: { cross: 5, freeKick: 1, short: 1 },
  fb_playmaker: { cross: 4, long: 2, through: 2, freeKick: 1 },
  w_playmaker: { through: 4, cross: 3, freeKick: 2, short: 1 },
  st_false9: { through: 2, any: 2, pressured: 2 },
}
const DEFAULT_PASS_SCOPES: Weighted<PassScope> = { long: 3, short: 2, through: 2, pressured: 2, any: 1 }

/** 任意球名家：不抽签，直接给直接任意球特性。 */
const FREE_KICK_LEGENDS = new Set([
  'David Beckham', 'Roberto Carlos', 'Ronaldinho', 'Andrea Pirlo', 'Lionel Messi', 'Cristiano Ronaldo',
  'Alessandro Del Piero', 'Francesco Totti', 'Roberto Baggio', 'Gianfranco Zola', 'Gareth Bale', 'Paulo Dybala',
  'Gheorghe Hagi', 'D. Alaba', 'Kieran Trippier', 'J. Ward-Prowse',
])
/** 最会造犯规的几位。 */
const FOUL_MAGNETS = new Set(['Neymar Jr', 'Eden Hazard', 'J. Grealish'])

/*
 * 下面都是 3 星的数值，再乘星级和条件。按“每场实际碰到几次”定：
 * 只碰到一两次的给得多，每次传球、每次射门都生效的给得少。
 * 目标是 3 星特性不弱于随机球员的通用特性，5 星明显更强。
 */
const SHOT_RANGE: Partial<Record<ShotScope, { onTarget: [number, number]; goal: [number, number] }>> = {
  any: { onTarget: [3, 4], goal: [2, 3] },
  inBox: { onTarget: [4, 6], goal: [3, 4] },
  oneOnOne: { onTarget: [6, 8], goal: [4, 5] },
  longRange: { onTarget: [4, 6], goal: [2, 4] },
  header: { onTarget: [12, 16], goal: [8, 12] },
  freeKick: { onTarget: [8, 12], goal: [6, 9] },
}
const SAVE_RANGE: Partial<Record<ShotScope, [number, number]>> = {
  any: [1, 2], inBox: [2, 3], longRange: [2, 3], oneOnOne: [5, 7], header: [10, 14], freeKick: [8, 12],
}
const PASS_RANGE: Partial<Record<PassScope, [number, number]>> = {
  any: [3, 5], short: [4, 6], through: [6, 8], cross: [5, 8], pressured: [3, 5], long: [5, 8], freeKick: [8, 12],
}
/** 单项封顶，避免星级和条件叠起来后变成必进、必中。 */
const SHOT_CAP = 20
const SAVE_CAP = 14
const PASS_CAP = 15
const DRIBBLE_CAP = 18
const DEFEND_CAP = 12
const TEAM_ATTR_CAP = 100

function buildEffect(seed: PlayerSeed, kind: Kind, salt: string): { when: TraitCondition; effect: StarEffect } {
  const key = `${seed.enName}|${salt}`
  const main = pick(STYLE_ATTRS[seed.style], hash(`${key}|attr`))
  const forward = seed.pos === 'ST' || seed.pos === 'W'
  const when = (conditions: Weighted<TraitCondition>) => {
    const allowed = { ...conditions }
    // “替补上场后”只给 3 星球员：大牌球星总是首发，这个条件等于没有特性。
    if (seed.tier > 3) delete allowed.subbedOn
    // 按位置去掉碰不到的条件：只有边路球员在边路，中后卫几乎不进前场，门将的体力不会掉。
    if (seed.pos !== 'W') delete allowed.wide
    if (seed.pos !== 'W' && seed.pos !== 'ST') delete allowed.attackingThird
    if (seed.pos === 'GK') {
      delete allowed.tired
      delete allowed.fresh
      delete allowed.ownHalf
    }
    return pick(allowed, hash(`${key}|when`))
  }
  switch (kind) {
    case 'attr': {
      const rolled = Number(pick(CHANCES, hash(`${key}|chance`)))
      // 彩票型不再配条件，否则两头都少见，一场也触发不了。
      const condition = rolled < 15 ? 'any' : when(seed.pos === 'GK' && main === 'passing' ? GK_CONDITIONS : ATTR_CONDITIONS[main]!)
      const chance = attrChance(rolled, condition)
      return { when: condition, effect: { kind, attr: main, chance, bonus: attrBonus(seed, chance, condition) } }
    }
    case 'shot': {
      const legend = FREE_KICK_LEGENDS.has(seed.enName)
      const scope = legend ? 'freeKick' : pick(STYLE_SHOT_SCOPES[seed.style] ?? (forward ? FORWARD_SHOT_SCOPES : DEFAULT_SHOT_SCOPES), hash(`${key}|scope`))
      const condition = legend ? 'any' : when(RARE_SHOT_SCOPES.has(scope) ? RARE_SCOPE_CONDITIONS : forward ? FORWARD_CONDITIONS : EFFECT_CONDITIONS)
      const range = SHOT_RANGE[scope]!
      return { when: condition, effect: { kind, scope, onTarget: Math.min(SHOT_CAP, scaled(seed, `${salt}on`, range.onTarget[0], range.onTarget[1], condition)), goal: Math.min(SHOT_CAP, scaled(seed, `${salt}goal`, range.goal[0], range.goal[1], condition)) } }
    }
    case 'save': {
      const scope = pick(GK_SAVE_SCOPES, hash(`${key}|scope`))
      const condition = when(RARE_SHOT_SCOPES.has(scope) ? RARE_SCOPE_CONDITIONS : EFFECT_CONDITIONS)
      const range = SAVE_RANGE[scope]!
      return { when: condition, effect: { kind, scope, goal: Math.min(SAVE_CAP, scaled(seed, `${salt}goal`, range[0], range[1], condition)) } }
    }
    case 'pass': {
      const rolled = pick(STYLE_PASS_SCOPES[seed.style] ?? DEFAULT_PASS_SCOPES, hash(`${key}|scope`))
      // 只有边路球员才站在边路。
      const scope = rolled === 'cross' && seed.pos !== 'W' ? 'through' : rolled
      const condition = when(RARE_PASS_SCOPES.has(scope) ? RARE_SCOPE_CONDITIONS : EFFECT_CONDITIONS)
      const range = PASS_RANGE[scope]!
      return { when: condition, effect: { kind, scope, success: Math.min(PASS_CAP, scaled(seed, `${salt}pass`, range[0], range[1], condition)) } }
    }
    case 'dribble': {
      const condition = when(FORWARD_CONDITIONS)
      return { when: condition, effect: { kind, success: Math.min(DRIBBLE_CAP, scaled(seed, `${salt}dribble`, 6, 10, condition)) } }
    }
    case 'defend': {
      const condition = when(EFFECT_CONDITIONS)
      return { when: condition, effect: { kind, success: Math.min(DEFEND_CAP, scaled(seed, `${salt}defend`, 4, 6, condition)) } }
    }
    case 'stamina': {
      const condition = when(STAMINA_CONDITIONS)
      return { when: condition, effect: { kind, drain: Math.min(45, scaled(seed, `${salt}drain`, 15, 25, condition)) } }
    }
    case 'goalRecover':
      return { when: 'any', effect: { kind, stamina: scaled(seed, `${salt}recover`, 15, 30, 'any') } }
    case 'secondWind':
      return { when: 'any', effect: { kind, stamina: scaled(seed, `${salt}wind`, 25, 40, 'any') } }
    case 'hotStreak':
      return { when: 'any', effect: { kind, bonus: scaled(seed, `${salt}streak`, 120, 200, 'any', 5) } }
    case 'aura': {
      const condition = when(EFFECT_CONDITIONS)
      // 门将的光环是指挥防线和出球；其他人带动全队发挥自己最强的那一项。
      const attr = seed.pos === 'GK' ? pick<AttrKey>({ tackling: 2, passing: 1 }, hash(`${key}|aura`)) : main
      return { when: condition, effect: { kind, attr, bonus: Math.min(TEAM_ATTR_CAP, scaled(seed, `${salt}aura`, 20, 35, condition, 5)) } }
    }
    case 'intimidate': {
      const condition = when(EFFECT_CONDITIONS)
      const attr = pick<AttrKey>(seed.pos === 'ST' ? { tackling: 2, strength: 1 } : { passing: 2, dribbling: 1, shooting: 1 }, hash(`${key}|fear`))
      return { when: condition, effect: { kind, attr, bonus: Math.min(TEAM_ATTR_CAP, scaled(seed, `${salt}fear`, 25, 40, condition, 5)) } }
    }
    case 'injury':
      return { when: 'any', effect: { kind, risk: Math.min(80, scaled(seed, `${salt}injury`, 30, 55, 'any', 5)) } }
    case 'card':
      return { when: 'any', effect: { kind, risk: Math.min(90, scaled(seed, `${salt}card`, 30, 60, 'any', 5)) } }
    case 'skillBoost':
      return { when: 'any', effect: { kind, pct: scaled(seed, `${salt}skill`, 25, 45, 'any') } }
    case 'onside':
      return { when: 'any', effect: { kind, chance: Math.min(90, scaled(seed, `${salt}onside`, 30, 50, 'any')) } }
    case 'drawFoul':
      return { when: 'any', effect: { kind, pct: scaled(seed, `${salt}drawFoul`, 40, 70, 'any') } }
  }
}

/* ---------- 名字 ---------- */

const WHEN_PREFIX: Record<TraitCondition, string[]> = {
  any: ['天生', '招牌', '本能', '传奇', '绝对', '王牌', '巅峰', '无双'],
  late: ['绝杀', '终场', '读秒', '压哨'],
  early: ['开局', '闪击', '抢先', '破局'],
  secondHalf: ['后程', '易边', '二番', '回马'],
  behind: ['逆境', '绝地', '背水', '反扑'],
  ahead: ['乘胜', '领跑', '锁定', '收割'],
  level: ['僵局', '破僵', '胶着', '均势'],
  tired: ['铁血', '透支', '咬牙', '死战'],
  fresh: ['满血', '锐气', '新锐', '元气'],
  wide: ['边路', '走廊', '贴边', '飞边'],
  attackingThird: ['前场', '锋线', '腹地', '纵深'],
  ownHalf: ['后场', '防区', '腹背', '固守'],
  home: ['主场', '坐镇', '魔鬼主场', '主场之'],
  away: ['客场', '远征', '敌营', '客场之'],
  subbedOn: ['超级替补', '奇兵', '板凳', '替补'],
  inBox: ['禁区', '门前', '近身', '小禁区'],
  crossing: ['传中', '下底', '弧线', '边线'],
  aerial: ['高空', '制空', '头顶', '云端'],
}

const SHOT_PREFIX: Partial<Record<ShotScope, string[]>> = {
  oneOnOne: ['单刀', '独闯', '直面', '面门'],
  inBox: ['禁区', '门前', '近身', '小禁区'],
  longRange: ['世界波', '远程', '三十米', '隔空'],
  header: ['头槌', '高空', '顶级', '云端'],
  freeKick: ['任意球', '定位球', '魔术弧', '电梯球', '落叶球', '香蕉球', '圆月弯刀', '越墙'],
}

const PASS_PREFIX: Partial<Record<PassScope, string[]>> = {
  short: ['连线', '短传', '三角', '小快灵'],
  through: ['穿透', '直塞', '身后', '撕裂'],
  cross: ['传中', '下底', '弧线', '走廊'],
  long: ['转移', '长传', '大范围', '跨越'],
  freeKick: ['任意球', '定位球', '落点', '旋转'],
  pressured: ['抗压', '冷静', '逼抢下', '闹中'],
}

const ATTR_NOUNS: Partial<Record<AttrKey, string[]>> = {
  shooting: ['冷箭', '重炮', '杀手', '枪手', '终结者', '穿云箭', '一击', '利刃', '猎手', '炮手', '神射', '狙击手'],
  passing: ['手术刀', '指挥棒', '妙传', '调度师', '节拍器', '穿针', '引线', '长传手', '画师', '导演', '大脑', '中枢'],
  dribbling: ['魔术师', '舞步', '穿花', '幻影', '盘丝', '游龙', '滑步', '舞者', '精灵', '鬼步', '灵蛇', '变奏'],
  tackling: ['铁闸', '钢钉', '绞杀', '清道夫', '猎犬', '铁钳', '战斧', '壁垒', '铁骑', '獠牙', '断路', '拦路虎'],
  strength: ['铁塔', '蛮牛', '磐石', '巨人', '战车', '重锤', '铁肩', '坦克', '铜墙', '猛犸', '泰坦', '霸王'],
  speed: ['闪电', '疾风', '飞翼', '猎豹', '子弹', '流星', '飓风', '快马', '火箭', '骤雨', '追风', '奔雷'],
  acceleration: ['启动', '弹射', '第一步', '爆点', '瞬移', '电光', '弹簧', '起爆'],
  reflexes: ['神扑', '鬼手', '门神', '猫爪', '飞鱼', '长城', '闪扑', '魔掌'],
  handling: ['铁手', '稳手', '胶手', '钳手', '金手套', '捕手', '巨掌', '收割机'],
  rushing: ['出击', '闪现', '猛虎', '突袭', '前哨', '扫荡', '飞身', '横扫'],
  oneOnOne: ['克星', '单挑王', '对决者', '守关人', '决斗者', '封门', '锁喉', '镇关'],
  composure: ['冰心', '沉稳', '泰山', '静水', '寒冰', '定心', '止水', '老僧'],
}
const GK_PASSING_NOUNS = ['发动机', '第一传', '出球手', '长传手', '手抛球', '后场导演', '指挥官', '起手式']

const KIND_NOUNS: Partial<Record<Kind, string[]>> = {
  shot: ATTR_NOUNS.shooting,
  pass: ATTR_NOUNS.passing,
  dribble: ATTR_NOUNS.dribbling,
  defend: ATTR_NOUNS.tackling,
  save: [...ATTR_NOUNS.reflexes!, ...ATTR_NOUNS.oneOnOne!],
  stamina: ['永动机', '长跑者', '马拉松', '发条', '续航者', '不知疲倦', '引擎', '跑不死'],
  goalRecover: ['嗜血', '狂欢', '回血', '续命', '进球瘾', '血性', '亢奋', '庆祝'],
  secondWind: ['第二春', '二次呼吸', '回光', '再燃', '复苏', '涅槃', '重启', '回魂'],
  hotStreak: ['手感', '连珠炮', '火力', '手热', '杀红眼', '帽子戏法', '连击', '爆发'],
  aura: ['领袖', '队魂', '主心骨', '旗手', '顶梁柱', '精神支柱', '统帅', '带头大哥'],
  intimidate: ['威压', '梦魇', '煞星', '噩梦', '大魔王', '阴影', '震慑', '压迫感'],
  injury: ['铁人', '金刚', '不死鸟', '硬骨头', '不倒翁', '铜皮', '钢筋', '铁打'],
  card: ['绅士', '净手', '零牌', '优雅', '文明人', '铁律', '君子', '手下留情'],
  skillBoost: ['大师', '宗师', '集大成', '绝技', '精通', '匠心', '登峰', '造极'],
  onside: ['幽灵', '影子', '身后鬼', '隐身', '贴线', '压线', '偷袭者', '暗影'],
  drawFoul: ['戏精', '犯规磁铁', '泥鳅', '老狐狸', '造犯规机器', '滑头', '滚地龙', '任意球制造机'],
}

function namePrefixes(when: TraitCondition, effect: StarEffect): string[] {
  if (when !== 'any') return WHEN_PREFIX[when]
  if (effect.kind === 'shot' || effect.kind === 'save') return SHOT_PREFIX[effect.scope] ?? WHEN_PREFIX.any
  if (effect.kind === 'pass') return PASS_PREFIX[effect.scope] ?? WHEN_PREFIX.any
  return WHEN_PREFIX.any
}

function nameNouns(seed: PlayerSeed, effect: StarEffect): string[] {
  if (effect.kind === 'attr') return seed.pos === 'GK' && effect.attr === 'passing' ? GK_PASSING_NOUNS : ATTR_NOUNS[effect.attr] ?? []
  return KIND_NOUNS[effect.kind] ?? []
}

const usedNames = new Set<string>()
const usedEffects = new Set<string>()

function pickName(seed: PlayerSeed, when: TraitCondition, effect: StarEffect): string | null {
  const prefixes = namePrefixes(when, effect)
  const nouns = nameNouns(seed, effect)
  const total = prefixes.length * nouns.length
  const start = hash(`${seed.enName}|name`) % total
  for (let offset = 0; offset < total; offset++) {
    const index = (start + offset) % total
    const prefix = prefixes[index % prefixes.length]
    const noun = nouns[Math.floor(index / prefixes.length)]
    // 前后说的是同一件事就跳过，比如“长传长传手”“定位球任意球制造机”。
    if (noun.includes(prefix) || prefix.includes(noun) || (prefix.includes('球') && noun.includes('球'))) continue
    const name = `${prefix}${noun}`
    if (!usedNames.has(name)) return name
  }
  return null
}

/* ---------- 生成 ---------- */

const quote = (value: unknown) => (typeof value === 'string' ? `'${value}'` : String(value))
const rows: string[] = []
const kindCount = new Map<Kind, number>()

for (const seed of PLAYER_SEEDS) {
  let done = false
  // 组合或名字撞了就换一个盐重来，同一个种子表结果不变；最多试很多次，不会死循环。
  for (let attempt = 0; attempt < 400 && !done; attempt++) {
    const salt = attempt === 0 ? '' : `#${attempt}`
    // 前 200 次保持风格对应的效果类型，之后才放宽到这个位置的任意类型。
    const kind: Kind = FREE_KICK_LEGENDS.has(seed.enName)
      ? 'shot'
      : FOUL_MAGNETS.has(seed.enName)
        ? 'drawFoul'
        : pick(STYLE_KINDS[seed.style] ?? POSITION_KINDS[seed.pos], hash(`${seed.enName}|kind${attempt < 200 ? '' : salt}`))
    const { when, effect } = buildEffect(seed, kind, salt)
    const signature = JSON.stringify({ when, ...effect })
    if (usedEffects.has(signature)) continue
    const name = pickName(seed, when, effect)
    if (!name) continue
    usedEffects.add(signature)
    usedNames.add(name)
    kindCount.set(kind, (kindCount.get(kind) ?? 0) + 1)
    const fields = Object.entries({ name, when, ...effect }).map(([key, value]) => `${key}: ${quote(value)}`).join(', ')
    rows.push(`  star_${seed.id}: { ${fields} }, // ${seed.name}`)
    done = true
  }
  if (!done) throw new Error(`没能给 ${seed.name} 生成不重复的特性`)
}

const output = `import type { StarTrait } from './star-traits.ts'

/**
 * 500 名球星的专属特性。由 scripts/generate-star-traits.ts 生成（npm run traits:gen）。
 * 想单独调整某个球星可以直接改这里，但再次生成会覆盖。
 */
export const STAR_TRAITS: Record<string, StarTrait> = {
${rows.join('\n')}
}
`
fs.writeFileSync(path.resolve('src/game/data/star-traits.generated.ts'), output)
console.log(`写入 ${rows.length} 个特性，名字 ${usedNames.size} 个，效果组合 ${usedEffects.size} 个`)
console.log([...kindCount].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(' / '))
