import type { AttrKey, EventDef, LegendBook, LegendBookTier, PeakSkillId, Player, Position, SkillBookId, SkillId, SkillTier, TrainingSession, TrainingSkillChoice } from './types.ts'
import { SKILLS, basicSkillsFor, basicSkillScopeMatches, canLearnSkill, skillCategory } from './data/skills.ts'
import { PLAYER_SEEDS, styleSkillFor, type PlayerSeed } from './data/players.ts'
import { getSkillTier, inheritanceChances } from './inheritance.ts'
import { LEGEND_SKILLS, SEASON3_MAX_BOOKS } from './data/legend-skills.ts'
import { PEAK_SKILLS } from './data/peak-skills.ts'
import { SHOP_SKILLS } from './data/shop-skills.ts'
import {
  LEGEND_STAR_ATTR_GAIN,
  LEGEND_STAR_BOOK_ID,
  LEGEND_STAR_CHOICES,
  LEGEND_STAR_EVENT_ID,
  LEGEND_STAR_INHERIT_EVENT_ID,
  LEGEND_STAR_MAX_TRIGGERS,
  SPECIAL_BOOK_SKILLS,
  isPassiveTrainingBook,
} from './data/legend-cup-skill.ts'
import { basicBookDef } from './data/basic-skill-books.ts'
import { isExclusiveSkill } from './data/tsubasa-specials.ts'
import { effectiveClubCeilings, effectiveTrainingCeilings } from './cup-rewards.ts'
import { attrHardLimit, mainAttrsFor } from './scale.ts'
import { attrLabel } from './data/attributes.ts'
import { eventById } from './data/events.ts'
import { derivedRng } from './rng.ts'

const RANK: Record<string, number> = { silver: 0, gold: 1, rainbow: 2 }

type BookRequirement = { attr: AttrKey; silver?: number; gold: number; rainbow: number }
type BookDef = { name: string; scope: 'any' | 'field' | 'gk'; requires: BookRequirement[]; passiveBook?: boolean }

function bookDef(id: SkillBookId): BookDef | undefined {
  const special = (LEGEND_SKILLS as unknown as Record<string, BookDef>)[id]
    ?? (PEAK_SKILLS as unknown as Record<string, BookDef>)[id]
    ?? (SPECIAL_BOOK_SKILLS as unknown as Record<string, BookDef>)[id]
    ?? (SHOP_SKILLS as unknown as Record<string, BookDef>)[id]
  if (special) return special
  return Object.hasOwn(SKILLS, id) ? basicBookDef(id, SKILLS[id].name) : undefined
}

function peakDef(id: SkillBookId) {
  return (PEAK_SKILLS as unknown as Record<string, import('./data/peak-skills.ts').PeakSkillDef>)[id]
}

export function bookKey(book: Pick<LegendBook, 'id' | 'tier'>): string {
  return `${book.id}:${book.tier}`
}

export function bookTierLabel(tier: LegendBookTier): string {
  return tier === 'rainbow' ? '彩书' : tier === 'gold' ? '金书' : '银书'
}

function bookThreshold(requirement: BookRequirement, tier: LegendBookTier): number {
  if (tier === 'rainbow') return requirement.rainbow
  if (tier === 'gold') return requirement.gold
  return requirement.silver ?? Math.max(1, requirement.gold - Math.max(4, Math.round((requirement.rainbow - requirement.gold) * 0.7)))
}

export function bookScopeMatches(player: Pick<Player, 'positions'>, book: { id: SkillBookId }): boolean {
  const def = bookDef(book.id)
  if (!def) return false
  const gk = player.positions.GK > 0
  return def.scope === 'any' || (def.scope === 'field' && !gk) || (def.scope === 'gk' && gk)
}

/** 当前球员学这本书的成功率；纯计算，不掷骰。 */
export function bookLearnChance(player: Pick<Player, 'attrs' | 'positions'>, book: { id: SkillBookId; tier: LegendBookTier }): number {
  if (!bookScopeMatches(player, book)) return 0
  const def = bookDef(book.id)
  if (!def) return 0
  const values = def.requires.map((requirement) => {
    const threshold = bookThreshold(requirement, book.tier)
    if (!(threshold > 0)) return 1
    const ratio = (player.attrs[requirement.attr] ?? 0) / threshold
    return Math.max(0.02, Math.min(1, Math.max(0, (ratio - 0.65) / 0.35) ** 2))
  })
  if (values.length === 0) return 1
  return Math.max(0.02, Math.min(1, Math.pow(values.reduce((product, value) => product * value, 1), 1 / values.length)))
}

export function bookRequirementText(book: { id: SkillBookId; tier: LegendBookTier }): string {
  if (isPassiveTrainingBook(book.id)) return '培养期携带生效 · 不占实战技能槽'
  const def = bookDef(book.id)
  if (!def) return ''
  return def.requires
    .map((requirement) => `${attrLabel(requirement.attr)} ${bookThreshold(requirement, book.tier)}`)
    .join(' + ')
}

export function canUseBookOnPlayer(player: Pick<Player, 'positions' | 'skills' | 'skillTiers'>, book: LegendBook): { ok: boolean; reason?: string } {
  if (!bookScopeMatches(player, book)) return { ok: false, reason: '位置不匹配' }
  if (isPassiveTrainingBook(book.id)) return { ok: true }
  const current = player.skills.includes(book.id) ? (player.skillTiers?.[book.id] ?? 'silver') : null
  if (current && RANK[current] >= RANK[book.tier]) return { ok: false, reason: '已经掌握同等或更高档位' }
  if (!current && !canLearnSkill(player.skills, book.id)) {
    return { ok: false, reason: skillCategory(book.id) === 'auxiliary' ? '辅助技能槽已满（2/2）' : '主技能槽已满（4/4）' }
  }
  return { ok: true }
}

/** 学会书上的技能；书本身不在这里扣除。 */
export function grantBookSkill(session: TrainingSession, book: LegendBook): { ok: boolean; upgraded: boolean; reason?: string } {
  if (isPassiveTrainingBook(book.id)) return { ok: false, upgraded: false, reason: '被动技能书带入书槽即生效，无需占技能槽' }
  const check = canUseBookOnPlayer(session.candidate, book)
  if (!check.ok) return { ok: false, upgraded: false, reason: check.reason }
  const had = session.candidate.skills.includes(book.id)
  if (!had) session.candidate.skills = [...session.candidate.skills, book.id]
  session.candidate.skillTiers = { ...session.candidate.skillTiers, [book.id]: book.tier }
  const peak = peakDef(book.id)
  if (peak && !had) {
    const gk = session.candidate.positions.GK > 0
    for (const attr of peak.pair) {
      const hard = attrHardLimit(attr, gk)
      // 先增加个人上限，再按“个人 + 俱乐部奖杯 + 技能”计算当前值可到达的上限；
      // 奖杯本身不写进个人 ceilings，换队/入队后仍由俱乐部实时加成。
      const personal = Math.min(hard, (session.candidate.ceilings[attr] ?? hard) + peak.ceiling)
      session.candidate.ceilings = { ...session.candidate.ceilings, [attr]: personal }
      const effective = effectiveClubCeilings(session.candidate, session.cupCeilingBonus ?? 0, 0)
      const current = Math.min(effective[attr] ?? personal, (session.candidate.attrs[attr] ?? 0) + peak.current)
      session.candidate.attrs = { ...session.candidate.attrs, [attr]: current }
    }
  }
  return { ok: true, upgraded: had }
}

/** 兼容旧存档中已待处理的单书事件；不再参与新事件抽取。 */
export function bookEvents(session: TrainingSession): EventDef[] {
  const books = (session.books ?? []).slice(0, SEASON3_MAX_BOOKS)
  const total = session.actionsTotal ?? 18
  return books.flatMap((book, index) => {
    if (isPassiveTrainingBook(book.id)) return []
    const def = bookDef(book.id)
    if (!def || !canUseBookOnPlayer(session.candidate, book).ok) return []
    const current = session.candidate.skills.includes(book.id) ? (session.candidate.skillTiers?.[book.id] ?? 'silver') : null
    if (current && RANK[current] >= RANK[book.tier]) return []
    const latestAction = Math.min(total, 12 + index * 2)
    const action = session.action
    if (action > latestAction + 1) return []
    return [{
      id: `book-${book.id}-${book.tier}`,
      title: `技能书 ·《${def.name}》`,
      category: 'training' as const,
      weight: 30,
      priority: 1000,
      once: false,
      maxTimes: 2,
      trigger: { latestAction },
      text: `书上的分解动作被画成一格一格的。要求：${bookRequirementText(book)}；可以先看成功率再决定。`,
      options: [
        {
          id: 'learn',
          label: '照着练',
          hint: `成功率 ${Math.round(bookLearnChance(session.candidate, book) * 100)}% · 要求 ${bookRequirementText(book)}`,
          book: { id: book.id, tier: book.tier },
        },
        {
          id: 'put_away',
          label: '先收起来',
          hint: '本轮不再触发这本书，把保底点让给别的书',
          effect: { text: '你把书收回包里，决定先把训练重心放在别处。' },
        },
      ],
    }]
  })
}

/** 新课程只提供位置匹配且尚未掌握的书技能；技能槽满时允许选择替换；被动彩书（如传奇之星）始终可带入书槽。 */
export function canChooseTrainingBook(player: Pick<Player, 'positions' | 'skills' | 'skillTiers'>, book: LegendBook): { ok: boolean; reason?: string } {
  if (isExclusiveSkill(book.id)) return { ok: false, reason: '角色唯一专属绝技' }
  if (!bookScopeMatches(player, book)) return { ok: false, reason: '位置不匹配' }
  if (isPassiveTrainingBook(book.id)) return { ok: true }
  if (player.skills.includes(book.id)) return { ok: false, reason: '已掌握该技能' }
  return { ok: true }
}

export const MATCH_BOOK_EVENT_ID = 'match-book-choice'

export const SKILL_SOURCE_WEIGHTS = { book: 50, teammate: 30, basic: 20 } as const
export const MAX_SKILL_TEACHERS = 5

function skillMatchesPlayer(player: Pick<Player, 'positions'>, skill: SkillId): boolean {
  if (skill.startsWith('lg_') || skill.startsWith('sh_')) return bookScopeMatches(player, { id: skill as SkillBookId })
  return basicSkillScopeMatches(skill, player.positions.GK > 0)
}

export function trainingSkillChoiceId(choice: TrainingSkillChoice): string {
  return choice.source === 'book' ? bookKey(choice) : `${choice.source}:${choice.id}`
}

export function trainingSkillChance(session: TrainingSession, choice: TrainingSkillChoice): number {
  if (choice.source === 'book') return bookLearnChance(session.candidate, choice)
  if (choice.source === 'teammate') return inheritanceChances(session, choice.mentor, choice.id).success
  return 1
}

/** 队友只从实际共同培养的人里抽最多 5 名，三类来源按权重逐项抽取、同技能去重。 */
export function drawTrainingSkills(session: TrainingSession, teammates: readonly Player[] = []): TrainingSkillChoice[] {
  const rng = derivedRng(session.seed, 'exchange-skill-choices', session.playerId, session.action)
  const unique = new Map(teammates.filter((player) => player.id !== session.playerId).map((player) => [player.id, player]))
  const people = [...unique.values()]
  const selected: Player[] = []
  while (people.length && selected.length < MAX_SKILL_TEACHERS) selected.push(people.splice(rng.int(people.length), 1)[0])
  const candidate = session.candidate
  const allowed = (id: SkillId) => Object.hasOwn(SKILLS, id) && !isExclusiveSkill(id) && !isPassiveTrainingBook(id) && !candidate.skills.includes(id) && skillMatchesPlayer(candidate, id)
  const bookPool: TrainingSkillChoice[] = (session.books ?? []).filter((book) => !isPassiveTrainingBook(book.id) && canChooseTrainingBook(candidate, book).ok).map((book) => ({ source: 'book', ...book }))
  const teammatePool: TrainingSkillChoice[] = selected.flatMap((player) => player.skills.filter(allowed).map((id) => ({
    source: 'teammate' as const, id,
    mentor: { id: player.id, name: player.name, positions: { ...player.positions }, skillTiers: { ...player.skillTiers } },
  })))
  const basicPool: TrainingSkillChoice[] = basicSkillsFor(candidate).filter(allowed).map((id) => ({ source: 'basic', id }))
  const pools = { book: bookPool, teammate: teammatePool, basic: basicPool }
  const choices: TrainingSkillChoice[] = []
  while (choices.length < 3) {
    const sources = (['book', 'teammate', 'basic'] as const).filter((source) => pools[source].length)
    if (!sources.length) break
    const source = rng.weighted(sources, sources.map((item) => SKILL_SOURCE_WEIGHTS[item]))
    const choice = rng.pick(pools[source])
    choices.push(choice)
    for (const pool of Object.values(pools)) {
      for (let i = pool.length - 1; i >= 0; i--) if (pool[i].id === choice.id) pool.splice(i, 1)
    }
  }
  return choices
}

export function skillChoiceReplacementError(session: TrainingSession, choice: TrainingSkillChoice, replace?: SkillId): string | null {
  if (!Object.hasOwn(SKILLS, choice.id)) return '技能不存在'
  if (session.candidate.skills.includes(choice.id)) return '技能已掌握'
  if (!skillMatchesPlayer(session.candidate, choice.id)) return '位置不匹配'
  const sameCategory = session.candidate.skills.filter((skill) => skillCategory(skill) === skillCategory(choice.id))
  if (!canLearnSkill(session.candidate.skills, choice.id)) {
    if (!replace || !sameCategory.includes(replace)) return '技能槽已满，请选择同类别技能替换'
  } else if (replace !== undefined) return '技能槽未满，无需替换'
  return null
}

/** 成功后替换同类技能；巅峰书的属性/上限奖励与书学习完全一致。 */
export function grantTrainingSkill(session: TrainingSession, choice: TrainingSkillChoice, tier: SkillTier, replace?: SkillId): { ok: boolean; reason?: string } {
  const error = skillChoiceReplacementError(session, choice, replace)
  if (error) return { ok: false, reason: error }
  if (replace) {
    session.candidate.skills = session.candidate.skills.filter((id) => id !== replace)
    const tiers = { ...session.candidate.skillTiers }
    delete tiers[replace]
    session.candidate.skillTiers = tiers
  }
  if (choice.id.startsWith('lg_')) {
    const result = grantBookSkill(session, { id: choice.id as SkillBookId, tier })
    if (!result.ok) return { ok: false, reason: result.reason }
  } else {
    session.candidate.skills = [...session.candidate.skills, choice.id]
    session.candidate.skillTiers = { ...session.candidate.skillTiers, [choice.id]: tier }
  }
  return { ok: true }
}

function matchBookEvent(session: TrainingSession): EventDef | undefined {
  const choices = session.pendingSkillChoices
  if (choices?.length) return {
    id: MATCH_BOOK_EVENT_ID,
    title: '交流赛后技能学习', category: 'training', weight: 0, trigger: {},
    text: `从技能书、共同培养的队友和位置基础技能中按概率抽取（${choices.length} 选 1）。技能书权重较高；已学会的技能不会出现。`,
    options: choices.map((choice) => {
      const label = choice.source === 'book'
        ? SKILLS[choice.id].name
        : `${choice.source === 'teammate' ? `队友 ${choice.mentor.name}` : '基础技能'} · ${SKILLS[choice.id].name}`
      const chance = choice.source === 'teammate' ? inheritanceChances(session, choice.mentor, choice.id) : null
      const detail = choice.source === 'book'
        ? `要求 ${bookRequirementText(choice)} · `
        : choice.source === 'teammate' && chance
          ? `队友档位 ${{ silver: '银', gold: '金', rainbow: '彩' }[getSkillTier(choice.mentor, choice.id)]}；成功后银 ${Math.round((1 - chance.gold - chance.rainbow) * 100)}% / 金 ${Math.round(chance.gold * 100)}%${chance.rainbow > 0 ? ` / 彩 ${Math.round(chance.rainbow * 100)}%` : ''} · `
          : '成功直接学会银色 · '
      return { id: trainingSkillChoiceId(choice), label, hint: `${detail}${SKILLS[choice.id].desc}`, trainingSkill: choice }
    }),
  }
  const books = session.pendingBookChoices ?? []
  if (!books.length) return undefined
  return {
    id: MATCH_BOOK_EVENT_ID,
    title: '交流赛后技能卡学习',
    category: 'training',
    weight: 0,
    trigger: {},
    text: `从赛前配置中选择一项尝试学习（${books.length} 选 1）。成功率由当前培养属性决定；失败后以后还能再试，技能书不会消耗。`,
    options: books.map((book) => ({
      id: bookKey(book),
      label: bookName(book.id),
      hint: `要求 ${bookRequirementText(book)} · ${SKILLS[book.id]?.desc ?? ''}`,
      book: { ...book },
    })),
  }
}

/** 培养书槽里是否携带了《传奇之星》彩书。 */
export function hasLegendStarBook(session: Pick<TrainingSession, 'books'>): boolean {
  return !!session.books?.some((book) => book.id === LEGEND_STAR_BOOK_ID && book.tier === 'rainbow')
}

export function legendStarTriggersUsed(session: Pick<TrainingSession, 'eventCounts'>): number {
  return session.eventCounts?.[LEGEND_STAR_EVENT_ID] ?? 0
}

/** 当前仍低于实际上限、可被《传奇之星》彩色事件抽中的主属性列表。 */
export function legendStarCandidates(session: TrainingSession): AttrKey[] {
  const gk = session.candidate.positions.GK > 0
  const ceilings = effectiveTrainingCeilings(session)
  return mainAttrsFor(gk).filter((key) => (session.candidate.attrs[key] ?? 0) + 0.5 < ceilings[key])
}

export function canTriggerLegendStarEvent(session: TrainingSession): boolean {
  return hasLegendStarBook(session)
    && legendStarTriggersUsed(session) < LEGEND_STAR_MAX_TRIGGERS
    && legendStarCandidates(session).length > 0
}

/** 根据种子与行动序号确定性地生成《传奇之星》彩色事件（随机 2 项未满主属性二选一 +100）。 */
export function legendStarEventFor(session: TrainingSession, action = session.pendingEventAction ?? session.action): EventDef | undefined {
  if (!hasLegendStarBook(session)) return undefined
  const pool = legendStarCandidates(session)
  if (!pool.length) return undefined
  const rng = derivedRng(session.seed, 'legend-star-choices', session.playerId, action)
  const remaining = [...pool]
  const picked: AttrKey[] = []
  while (remaining.length > 0 && picked.length < LEGEND_STAR_CHOICES) {
    picked.push(remaining.splice(rng.int(remaining.length), 1)[0])
  }
  const ceilings = effectiveTrainingCeilings(session)
  const used = legendStarTriggersUsed(session) + 1
  return {
    id: LEGEND_STAR_EVENT_ID,
    title: '彩色事件 · 传奇之星',
    category: 'training',
    rarity: 'rainbow',
    weight: 0,
    once: false,
    maxTimes: LEGEND_STAR_MAX_TRIGGERS,
    trigger: {},
    text: `《传奇之星》的彩光在训练场上闪耀（本轮第 ${used}/${LEGEND_STAR_MAX_TRIGGERS} 次）。从下面 ${picked.length} 项未满上限的主属性中任选一项，直接净增 +${LEGEND_STAR_ATTR_GAIN}（不受低心情减半影响，仍受上限约束）。`,
    options: picked.map((attr) => {
      const current = Math.round(session.candidate.attrs[attr] ?? 0)
      const cap = Math.round(ceilings[attr] ?? 1500)
      const gain = Math.min(LEGEND_STAR_ATTR_GAIN, Math.max(0, cap - current))
      return {
        id: `legend-star-${attr}`,
        label: `${attrLabel(attr)} +${LEGEND_STAR_ATTR_GAIN}`,
        hint: `当前 ${current} / 上限 ${cap}（预计净增 +${gain}）`,
        effect: {
          text: `《传奇之星》的灵感贯通全场，${attrLabel(attr)}迎来突破性飞跃！`,
          flatAttrs: { [attr]: LEGEND_STAR_ATTR_GAIN },
        },
      }
    }),
  }
}

function traineePrimaryPosition(player: Pick<Player, 'positions'>): Position {
  if (player.positions.GK > 0) return 'GK'
  return (['CB', 'W', 'CM', 'ST'] as const).reduce(
    (best, pos) => (player.positions[pos] > player.positions[best] ? pos : best),
    'CM',
  )
}

function legendStarInheritPool(session: TrainingSession): { star: PlayerSeed; skill: SkillId }[] {
  const pos = traineePrimaryPosition(session.candidate)
  const candidate = session.candidate
  const eligible = (seeds: readonly PlayerSeed[]) => seeds
    .filter((seed) => seed.era !== 'random' && seed.pos === pos)
    .map((star) => ({ star, skill: styleSkillFor(star.style) }))
    .filter(({ skill }) => Object.hasOwn(SKILLS, skill) && !isExclusiveSkill(skill) && !(candidate.skills.includes(skill) && getSkillTier(candidate, skill) === 'rainbow'))
  const elite = eligible(PLAYER_SEEDS.filter((seed) => seed.tier >= 5))
  return elite.length ? elite : eligible(PLAYER_SEEDS)
}

export function canTriggerLegendStarInherit(session: TrainingSession): boolean {
  return hasLegendStarBook(session)
    && (session.eventCounts?.[LEGEND_STAR_INHERIT_EVENT_ID] ?? 0) < 1
    && legendStarInheritPool(session).length > 0
}

export function rainbowInheritReplacementError(session: TrainingSession, skill: SkillId, replace?: SkillId): string | null {
  if (!Object.hasOwn(SKILLS, skill)) return '技能不存在'
  const candidate = session.candidate
  if (candidate.skills.includes(skill)) {
    if (getSkillTier(candidate, skill) === 'rainbow') return '已掌握该彩虹技能'
    return replace !== undefined ? '已有该技能，将直接升为彩虹档，无需替换' : null
  }
  const sameCategory = candidate.skills.filter((item) => skillCategory(item) === skillCategory(skill))
  if (!canLearnSkill(candidate.skills, skill)) {
    if (!replace || !sameCategory.includes(replace)) return '技能槽已满，请选择同类别技能替换'
  } else if (replace !== undefined) {
    return '技能槽未满，无需替换'
  }
  return null
}

export function grantRainbowInheritSkill(session: TrainingSession, skill: SkillId, replace?: SkillId): { ok: boolean; upgraded?: boolean; reason?: string } {
  const error = rainbowInheritReplacementError(session, skill, replace)
  if (error) return { ok: false, reason: error }
  const candidate = session.candidate
  if (candidate.skills.includes(skill)) {
    candidate.skillTiers = { ...candidate.skillTiers, [skill]: 'rainbow' }
    return { ok: true, upgraded: true }
  }
  if (replace) {
    candidate.skills = candidate.skills.filter((item) => item !== replace)
    const tiers = { ...candidate.skillTiers }
    delete tiers[replace]
    candidate.skillTiers = tiers
  }
  candidate.skills = [...candidate.skills, skill]
  candidate.skillTiers = { ...candidate.skillTiers, [skill]: 'rainbow' }
  return { ok: true, upgraded: false }
}

export function legendStarInheritEventFor(session: TrainingSession, action = session.pendingEventAction ?? session.action): EventDef | undefined {
  if (!hasLegendStarBook(session)) return undefined
  const pool = legendStarInheritPool(session)
  if (!pool.length) return undefined
  const rng = derivedRng(session.seed, 'legend-star-inherit-pick', session.playerId, action)
  const { star, skill } = pool[rng.int(pool.length)]
  const upgraded = session.candidate.skills.includes(skill)
  return {
    id: LEGEND_STAR_INHERIT_EVENT_ID,
    title: '奇遇 · 传奇降临',
    category: 'training',
    rarity: 'rainbow',
    weight: 0,
    once: true,
    maxTimes: 1,
    trigger: {},
    text: `《传奇之星》骤然绽放出夺目光芒——同位置传奇球星 ${star.name}（${star.enName}）的比赛记忆浮现眼前！你可以直接继承他的彩虹招牌技能《${SKILLS[skill].name}》（无需门槛，直接掌握）。`,
    options: [
      {
        id: `legend-star-inherit-${skill}`,
        label: upgraded ? `升格彩虹 · ${SKILLS[skill].name}` : `继承彩虹 · ${SKILLS[skill].name}`,
        hint: `来自 ${star.name} · ${SKILLS[skill].desc}`,
        rainbowInherit: { skill, starName: star.name },
      },
      {
        id: 'decline',
        label: '暂不继承',
        hint: '保留当前技能配置',
        effect: { text: `你向 ${star.name} 的传奇背影致意，决定坚持自己当前的技战术打法。` },
      },
    ],
  }
}

export function eventForSession(session: TrainingSession, id: string): EventDef | undefined {
  if (id === MATCH_BOOK_EVENT_ID) return matchBookEvent(session)
  if (id === LEGEND_STAR_EVENT_ID) return legendStarEventFor(session)
  if (id === LEGEND_STAR_INHERIT_EVENT_ID) return legendStarInheritEventFor(session)
  return bookEvents(session).find((event) => event.id === id) ?? eventById(id)
}

/** 书槽 UI 用：只返回当前球员可用的书，并去重。 */
export function usableBooksFor(player: Pick<Player, 'positions' | 'skills' | 'skillTiers'>, books: readonly LegendBook[]): LegendBook[] {
  const seen = new Set<string>()
  return books.filter((book) => {
    const key = bookKey(book)
    if (seen.has(key)) return false
    seen.add(key)
    return canUseBookOnPlayer(player, book).ok
  })
}

export function bookName(id: SkillBookId): string {
  return SKILLS[id]?.name ?? id
}
