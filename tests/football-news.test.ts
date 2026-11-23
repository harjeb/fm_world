import { describe, expect, it } from 'vitest'
import { matchEdition, transferEdition } from '../src/game/football-news.ts'
import { recordTransfer } from '../src/game/transfer-news.ts'
import type { Fixture, GameState, MarketReport, SeasonState } from '../src/game/types.ts'

const fixture = (round: number, homeId: string, awayId: string, home: number, away: number): Fixture => ({ round, homeId, awayId, isPlayer: false, played: true, score: { home, away } })
const season = (fixtures: Fixture[]) => ({ fixtures, table: [] } as unknown as SeasonState)
const names = new Map([['a', '北港'], ['b', '南山']])

describe('足坛新闻选题', () => {
  it('只报道最新已完赛轮次，同场不重复，同版不同角度；刷新不改标题或赛程', () => {
    const hat = { ...fixture(2, 'a', 'b', 3, 0), scorers: [{ playerId: 'p', name: '小林', goals: 3 }] }
    const s = season([fixture(1, 'b', 'a', 1, 2), hat, fixture(2, 'c', 'd', 0, 0), fixture(2, 'e', 'f', 0, 0), { ...fixture(3, 'a', 'b', 9, 9), played: false }])
    const original = structuredClone(s)
    const stories = matchEdition(s, names)
    expect(stories.map(s => s.angle)).toEqual(['射手特写', '互交白卷'])
    expect(stories[0].title + stories[0].detail).toContain('小林')
    expect(stories[0].detail).toMatch(/三|3/)
    expect(stories[0].detail).toContain('北港 3:0 南山')
    expect(matchEdition(s, names)).toEqual(stories)
    expect(s).toEqual(original)
  })
  it('连胜跨主客场累计，被平局中断', () => {
    const s = season([fixture(1, 'a', 'b', 1, 0), fixture(2, 'c', 'a', 0, 1), fixture(3, 'a', 'd', 2, 1)])
    const [win] = matchEdition(s, names)
    expect(win.angle).toBe('状态追踪')
    expect(win.title + win.detail).toMatch(/3场|3轮|9分/)
    s.fixtures[1].score = { home: 1, away: 1 }
    expect(matchEdition(s, names)[0].angle).not.toBe('状态追踪')
  })
  it('连续轮次轮换稿型，稳定重绘，不根据单一比分编造逆转或绝杀', () => {
    const variants = Array.from({ length: 6 }, (_, r) => matchEdition(season([fixture(r + 1, 'a', 'b', 0, 0)]), names)[0])
    expect(new Set(variants.map(s => s.title)).size).toBe(6)
    for (const s of variants) expect(s.title + s.detail).not.toMatch(/扳平|绝杀|逆转|undefined|\{\w+\}/)
  })
  it('核实首回合结果、主客方向和连续轮次；一场比赛不能写成双杀', () => {
    expect(matchEdition(season([fixture(2, 'b', 'a', 0, 1), fixture(7, 'a', 'b', 2, 0)]), names)[0].angle).toBe('同队再胜')
    expect(matchEdition(season([fixture(2, 'b', 'a', 1, 0), fixture(7, 'a', 'b', 2, 0)]), names)[0].angle).toBe('扳回一场')
    expect(matchEdition(season([fixture(7, 'a', 'b', 2, 0)]), names)[0].angle).toBe('零封取胜')
    const games = [fixture(1, 'a', 'x', 0, 0), fixture(2, 'y', 'a', 1, 1), fixture(3, 'a', 'b', 0, 0)]
    expect(matchEdition(season(games), names)[0].angle).toBe('连续平局')
    games[1].played = false
    expect(matchEdition(season(games), names)[0].angle).toBe('互交白卷')
  })
  it('自由市场签约不写免签，未知年龄不补猜；球员名含模板符也不二次替换', () => {
    const d: MarketReport = { at: 10, club: '北港', playerId: 'p', playerName: '小{fee}林', kind: 'free', amount: 600 }
    const [s] = transferEdition([d])
    expect(s.angle).toBe('自由市场')
    expect(s.detail).toContain('小{fee}林')
    expect(s.detail).toContain('600 金币')
    expect(s.title + s.detail).not.toMatch(/免签|岁|undefined/)
  })
  it('首胜需要完整的此前赛程，零封连场不能把主客失球方向弄反', () => {
    const games = [fixture(1, 'a', 'x', 2, 2), fixture(2, 'y', 'a', 3, 2), fixture(3, 'a', 'z', 1, 1), fixture(4, 'b', 'a', 0, 2)]
    expect(matchEdition(season(games), names)[0].angle).toBe('首胜入账')
    games[0].played = false
    expect(matchEdition(season(games), names)[0].angle).not.toBe('首胜入账')
    games[1].score = { home: 0, away: 0 }; games[2].score = { home: 0, away: 0 }
    expect(matchEdition(season(games), names)[0].angle).toBe('零封延续')
    games[2].score.away = 1
    expect(matchEdition(season(games), names)[0].angle).not.toBe('零封延续')
  })
  it('有赛程才预告下一轮；四球不会误写成恰好三球', () => {
    const s = season([{ ...fixture(1, 'a', 'b', 4, 0), scorers: [{ playerId: 'p', name: '小林', goals: 4 }] }, { ...fixture(2, 'b', 'a', 0, 0), played: false }])
    const [article] = matchEdition(s, names)
    expect(article.angle).toBe('射手爆发')
    expect(article.detail.split('\n\n')[1]).toMatch(/客场|作客|主场迎战/)
  })
  it('区分溢价、竞价和旧的无来源成交；流拍不是签约', () => {
    const deal: MarketReport = { playerId: 'p', playerName: '小林', amount: 1250, club: '北港', at: 100 }
    const stories = transferEdition([deal, { ...deal, at: 200, kind: 'auction', bidders: 3 }, { ...deal, at: 300, seller: '南山', kind: 'offer', value: 1000 }, { ...deal, at: 400, club: null }])
    expect(stories.map(s => s.angle)).toEqual(['溢价成交', '竞价争夺', '签约简讯'])
    expect(stories[0].title).toContain('25%')
    expect(stories[1].title).toContain('3家')
    expect(transferEdition([])).toEqual([])
  })
  it('旧档按需建立成交快照，有上限，球员改名不改旧新闻', () => {
    const game: Pick<GameState, 'transferNews'> = {}
    const p = { id: 'p', name: '小林', age: 19 }
    for (let i = 0; i < 32; i++) recordTransfer(game, p, '北港', 500, 'free', undefined, i)
    p.name = '新名'
    expect(game.transferNews).toHaveLength(30)
    expect(game.transferNews?.at(-1)?.at).toBe(2)
    const [story] = transferEdition(game.transferNews!)
    expect(story.angle).toBe('年轻面孔')
    expect(story.title + story.detail).toContain('19岁')
    expect(story.detail).toContain('小林')
    expect(story.detail).not.toContain('新名')
  })
})
