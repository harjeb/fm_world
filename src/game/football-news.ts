import { NEWS_CONTEXT } from './data/news-context.ts'
import { NEWS_DESK, type DeskTopic } from './data/news-desk.ts'
import { hashString } from './rng.ts'
import { latestPlayedRound, latestRoundRankChanges } from './standings-history.ts'
import type { Fixture, MarketReport, SeasonState } from './types.ts'

export type Story = { angle: string; title: string; detail: string; recordId?: string }
type Facts = Record<string, string | number>
type Played = Fixture & { score: NonNullable<Fixture['score']> }

function phrase(choices: string[], seed: string, facts: Facts, rotation = 0): string {
  return choices[(hashString(seed) + rotation) % choices.length].replace(/\{(\w+)\}/g, (_, field: string) => {
    if (facts[field] === undefined) throw new Error(`新闻素材缺少字段 ${field}`)
    return String(facts[field])
  })
}
function deskCopy(topic: DeskTopic, key: string, facts: Facts, rotation = 0) {
  const pool = NEWS_DESK[topic]
  return { angle: topic, title: phrase(pool.headlines, `${topic}|title|${key}`, facts, rotation), detail: phrase(pool.leads, `${topic}|lead|${key}`, facts, rotation) }
}

/** 只看相邻已公布轮次；缺一轮时不能断言连胜、首胜。 */
function runBefore(previous: Played[], round: number, keep: (p: Played) => boolean): number {
  let count = 0
  for (const p of previous) {
    if (p.round !== round - count - 1 || !keep(p)) break
    count++
  }
  return count
}

export function matchEdition(season: SeasonState, names: Map<string, string>, fill = false): Story[] {
  const name = (id: string) => names.get(id) ?? id
  const round = latestPlayedRound(season.fixtures)
  const played = season.fixtures.filter((f): f is Played => f.played && !!f.score)
  const changes = latestRoundRankChanges(season.table, played, names)
  const ranks = new Map(season.table.map((r, i) => [r.teamId, i + 1]))
  const complete = season.fixtures.filter(f => f.round === round).every(f => f.played && f.score)
  const history = (id: string) => played.filter(p => p.round < round && (p.homeId === id || p.awayId === id)).sort((x, y) => y.round - x.round)
  const candidates = played.filter(f => f.round === round).map(f => {
    const { home: hg, away: ag } = f.score
    const h = name(f.homeId), a = name(f.awayId), total = hg + ag, margin = Math.abs(hg - ag)
    const [wid, lid] = hg > ag ? [f.homeId, f.awayId] : [f.awayId, f.homeId]
    const winner = name(wid), loser = name(lid)
    const edition = `${season.index}|${season.divisionId}`
    const key = `${edition}|${round}|${h}|${a}`
    const scorer = [...(f.scorers ?? [])].sort((x, y) => y.goals - x.goals)[0]
    const assist = [...(f.assisters ?? [])].sort((x, y) => y.assists - x.assists)[0]
    const story = (priority: number, topic: DeskTopic, extra: Facts = {}) => {
      const s = deskCopy(topic, edition, { round, h, a, hg, ag, total, winner, loser, margin, goals: Math.max(hg, ag), ...extra }, round)
      if (![h, a, scorer?.name, assist?.name].some(n => n && s.title.includes(n))) s.title = `${h} ${hg}:${ag} ${a}｜${s.title}`
      const notes: string[] = []
      const note = (kind: keyof typeof NEWS_CONTEXT, facts: Facts) => notes.push(phrase(NEWS_CONTEXT[kind], `${key}|${kind}`, facts))
      if (scorer && scorer.goals >= 2 && !['梅开二度', '射手特写', '射手爆发'].includes(topic)) note('scoring', { p: scorer.name, n: scorer.goals, total })
      if (assist && assist.assists >= 2 && topic !== '助攻手记') note('creating', { p: assist.name, n: assist.assists })
      const focus = margin ? wid : f.homeId, team = name(focus), previous = history(focus)
      const reverse = previous.find(p => p.homeId === f.awayId && p.awayId === f.homeId)
      if (reverse && !['同队再胜', '扳回一场', '交锋未分'].includes(topic)) note('prior', { h, a, r: reverse.round, x: reverse.score.home, y: reverse.score.away })
      if (previous[0]?.round === round - 1 && previous[1]?.round === round - 2 && topic !== '状态追踪') {
        let gf = 0, ga = 0, pts = 0
        for (const p of [f, ...previous.slice(0, 2)]) {
          const [x, y] = p.homeId === focus ? [p.score.home, p.score.away] : [p.score.away, p.score.home]
          gf += x; ga += y; pts += x > y ? 3 : x === y ? 1 : 0
        }
        note('form', { team, gf, ga, pts })
      }
      const hr = ranks.get(f.homeId), ar = ranks.get(f.awayId)
      if (complete && round >= 3 && hr && ar) {
        const delta = season.table[hr - 1].points - season.table[ar - 1].points
        if (topic !== '榜首易位') note('ranks', { h, a, hr, ar })
        if (delta === 0) note('level', { pts: season.table[hr - 1].points })
        else note('pointsGap', { upper: delta > 0 ? h : a, lower: delta > 0 ? a : h, gap: Math.abs(delta) })
      }
      const next = season.fixtures.find(p => p.round === round + 1 && !p.played && (p.homeId === focus || p.awayId === focus))
      if (next) note(next.homeId === focus ? 'nextHome' : 'nextAway', { team, r: next.round, opp: name(next.homeId === focus ? next.awayId : next.homeId) })
      // 正文最多两个补充事实，避免把每场都写成同一张数据清单。
      const start = notes.length ? hashString(`${key}|context`) % notes.length : 0
      const context = [...notes.slice(start), ...notes.slice(0, start)].slice(0, 2).join('')
      return { ...s, priority, detail: `第 ${round} 轮 · ${h} ${hg}:${ag} ${a}。${s.detail}${context ? '\n\n' + context : ''}`, recordId: f.isPlayer ? f.matchId : undefined }
    }
    if (scorer && scorer.goals >= 3) return story(10, scorer.goals === 3 ? '射手特写' : '射手爆发', { p: scorer.name, n: scorer.goals })
    if (margin) {
      const wr = (ranks.get(wid) ?? 0) + (changes.get(wid) ?? 0), lr = (ranks.get(lid) ?? 0) + (changes.get(lid) ?? 0)
      if (complete && round >= 3 && ranks.get(wid) === 1 && wr > 1) return story(10, '榜首易位', { wr })
      if (round >= 4 && changes.has(wid) && changes.has(lid) && wr - lr >= 5) return story(9, '本轮冷门', { wr, lr, gap: wr - lr })
      const diff = (p: Played, id: string) => (p.score.home - p.score.away) * (p.homeId === id ? 1 : -1)
      const previous = history(wid), wins = runBefore(previous, round, p => diff(p, wid) > 0), losses = runBefore(previous, round, p => diff(p, wid) < 0)
      const ended = runBefore(history(lid), round, p => diff(p, lid) > 0)
      if (ended >= 3) return story(9, '连胜告终', { n: ended, next: ended + 1 })
      if (losses >= 3) return story(8, '止住连败', { n: losses, next: losses + 1 })
      if (wins >= 2) return story(8, '状态追踪', { n: wins + 1, points: 3 * (wins + 1) })
      if (round >= 4 && previous.length === round - 1 && previous.every((p, i) => p.round === round - i - 1 && (p.homeId === wid ? p.score.home <= p.score.away : p.score.away <= p.score.home))) return story(8, '首胜入账', { before: round - 1 })
      const clean = runBefore(previous, round, p => (p.homeId === wid ? p.score.away : p.score.home) === 0)
      if (!Math.min(hg, ag) && clean >= 2) return story(7, '零封延续', { n: clean + 1, previous: clean })
      const first = previous.find(p => p.homeId === f.awayId && p.awayId === f.homeId)
      if (first && first.score.home !== first.score.away) return story(7, (first.score.home > first.score.away ? first.homeId : first.awayId) === wid ? '同队再胜' : '扳回一场')
    }
    if (assist && assist.assists >= 2) return story(6, '助攻手记', { p: assist.name, n: assist.assists })
    if (scorer?.goals === 2) return story(6, '梅开二度', { p: scorer.name })
    if (margin >= 3) return story(6, '大比分')
    if (!margin) {
      for (const id of [f.homeId, f.awayId]) {
        const previous = runBefore(history(id), round, p => p.score.home === p.score.away)
        if (previous >= 2) return story(6, '连续平局', { team: name(id), previous, n: previous + 1 })
      }
      const first = played.find(p => p.round < round && p.homeId === f.awayId && p.awayId === f.homeId)
      if (first && first.score.home === first.score.away) return story(5, '交锋未分', { firstScore: `${first.score.home}:${first.score.away}` })
      return story(4, !total ? '互交白卷' : hg >= 3 ? '高分平局' : '平局')
    }
    if (total >= 5 && Math.min(hg, ag) > 0) return story(5, '进球大战')
    if (!Math.min(hg, ag)) return story(4, '零封取胜')
    if (margin === 1) return story(3, '一球小胜')
    return story(2, hg > ag ? '主场战报' : '客场战报')
  })
  const ranked = candidates.sort((a, b) => b.priority - a.priority)
  const chosen = selectEdition(ranked)
  if (fill && chosen.length < 4) chosen.push(...ranked.filter(s => !chosen.includes(s)).slice(0, 4 - chosen.length))
  return chosen
}

function transferStory(d: MarketReport): Story {
  const money = (n: number) => `${n.toLocaleString('zh-CN')} 金币`
  const premium = d.value && d.value > 0 ? Math.round((d.amount / d.value - 1) * 100) : 0
  const topic: DeskTopic = d.kind === 'listing' && d.seller ? '挂牌成交'
    : d.kind === 'offer' && d.seller && premium > 0 ? '溢价成交'
    : d.kind === 'auction' ? (d.bidders ?? 0) > 1 ? '竞价争夺' : '竞拍落槌'
    : d.age !== undefined && d.age <= 21 ? '年轻面孔'
    : d.age !== undefined && d.age >= 32 ? '老将签约'
    : d.seller ? '俱乐部转会' : d.kind === 'free' ? '自由市场' : '签约简讯'
  const s = deskCopy(topic, `${d.at}|${d.playerId}|${d.club}`, { player: d.playerName, buyer: d.club!, seller: d.seller ?? '', fee: money(d.amount), value: money(d.value ?? 0), extra: money(d.amount - (d.value ?? 0)), premium, age: d.age ?? 0, n: d.bidders ?? 0 })
  // 有些标题以价格或年龄切入，正文仍须交代谁去了哪里。旧成交的缺省字段不补猜。
  if (![d.playerName, d.club].some(n => n && s.title.includes(n))) s.title = `${d.playerName}｜${s.title}`
  const route = d.kind === 'listing' && d.seller ? `${d.seller}挂牌出售${d.playerName}` : `${d.playerName}${d.seller && (topic === '俱乐部转会' || topic === '溢价成交') ? `从${d.seller}` : ''}加盟${d.club}`
  const notes: string[] = []
  if (d.seller && !['挂牌成交', '俱乐部转会', '溢价成交'].includes(topic)) notes.push(phrase(NEWS_CONTEXT.seller, `${d.at}|seller`, { p: d.playerName, seller: d.seller }))
  if (d.age && topic !== '年轻面孔' && topic !== '老将签约' && topic !== '挂牌成交') notes.push(phrase(NEWS_CONTEXT.age, `${d.at}|age`, { p: d.playerName, age: d.age }))
  const amount = s.detail.includes(money(d.amount)) ? '' : ` · ${money(d.amount)}`
  return { ...s, detail: `${route}${amount}。${s.detail}${notes.length ? '\n\n' + notes.join('') : ''}` }
}

export function transferEdition(deals: MarketReport[]): (Story & { at: number })[] {
  return selectEdition(deals.filter(d => d.club && d.amount > 0).sort((a, b) => b.at - a.at).map(d => ({ ...transferStory(d), at: d.at })))
}

function selectEdition<T extends Story>(stories: T[]): T[] {
  const selected: T[] = []
  for (const story of stories) {
    if (!selected.some(s => s.angle === story.angle)) selected.push(story)
    if (selected.length === 4) break
  }
  return selected
}
