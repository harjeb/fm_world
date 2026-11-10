import type { AttrKey, EventDef, LegendBook, LegendBookTier, PeakSkillId, Player, SkillBookId, TrainingSession } from './types.ts'
import { SKILLS, canLearnSkill } from './data/skills.ts'
import { LEGEND_SKILLS, MAX_BOOKS } from './data/legend-skills.ts'
import { PEAK_SKILLS } from './data/peak-skills.ts'
import { effectiveClubCeilings } from './cup-rewards.ts'
import { attrHardLimit } from './scale.ts'
import { attrLabel } from './data/attributes.ts'
import { eventById } from './data/events.ts'

const RANK: Record<string, number> = { silver: 0, gold: 1, rainbow: 2 }

type BookDef = { name: string; scope: 'any' | 'field' | 'gk'; requires: { attr: AttrKey; gold: number; rainbow: number }[] }

function bookDef(id: SkillBookId): BookDef | undefined {
  return (LEGEND_SKILLS as unknown as Record<string, BookDef>)[id] ?? (PEAK_SKILLS as unknown as Record<string, BookDef>)[id]
}

function peakDef(id: SkillBookId) {
  return (PEAK_SKILLS as unknown as Record<string, import('./data/peak-skills.ts').PeakSkillDef>)[id]
}

export function bookKey(book: Pick<LegendBook, 'id' | 'tier'>): string {
  return `${book.id}:${book.tier}`
}

export function bookTierLabel(tier: LegendBookTier): string {
  return tier === 'rainbow' ? '彩书' : '金书'
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
    const threshold = book.tier === 'rainbow' ? requirement.rainbow : requirement.gold
    if (!(threshold > 0)) return 1
    const ratio = (player.attrs[requirement.attr] ?? 0) / threshold
    return Math.max(0.02, Math.min(1, ((ratio - 0.65) / 0.35) ** 2))
  })
  if (values.length === 0) return 1
  return Math.max(0.02, Math.min(1, Math.pow(values.reduce((product, value) => product * value, 1), 1 / values.length)))
}

export function bookRequirementText(book: { id: SkillBookId; tier: LegendBookTier }): string {
  const def = bookDef(book.id)
  if (!def) return ''
  return def.requires
    .map((requirement) => `${attrLabel(requirement.attr)} ${book.tier === 'rainbow' ? requirement.rainbow : requirement.gold}`)
    .join(' + ')
}

export function canUseBookOnPlayer(player: Pick<Player, 'positions' | 'skills' | 'skillTiers'>, book: LegendBook): { ok: boolean; reason?: string } {
  if (!bookScopeMatches(player, book)) return { ok: false, reason: '位置不匹配' }
  const current = player.skills.includes(book.id) ? (player.skillTiers?.[book.id] ?? 'silver') : null
  if (current && RANK[current] >= RANK[book.tier]) return { ok: false, reason: '已经掌握同等或更高档位' }
  if (!current && !canLearnSkill(player.skills, book.id)) return { ok: false, reason: '主技能槽已满（4/4）' }
  return { ok: true }
}

/** 学会书上的技能；书本身不在这里扣除。 */
export function grantBookSkill(session: TrainingSession, book: LegendBook): { ok: boolean; upgraded: boolean; reason?: string } {
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

/** 每本带进培养的书一个动态事件；保底点 12/14/16/18。 */
export function bookEvents(session: TrainingSession): EventDef[] {
  const books = (session.books ?? []).slice(0, MAX_BOOKS)
  const total = session.actionsTotal ?? 18
  return books.flatMap((book, index) => {
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
      text: `书上的分解动作被画成一格一格的。${bookTierLabel(book.tier)}要求：${bookRequirementText(book)}；可以先看成功率再决定。`,
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

export function eventForSession(session: TrainingSession, id: string): EventDef | undefined {
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
