import { afterEach, describe, expect, it } from 'vitest'
import { createOwnerlessWorld, createWorldGameFromWorld } from '../src/game/world.ts'
import { applySeasonCupPlan, planSeasonCups } from '../src/game/season-cups.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { game as originalGame, setGame } from '../src/ui/state.ts'
import { onlineState } from '../src/online.ts'
import { renderSeason } from '../src/ui/screens/season.ts'

const status = onlineState.status
afterEach(() => { setGame(originalGame); onlineState.status = status })

function setup() {
  const seed = 412, start = Date.UTC(2026, 10, 9, 12)
  const { world, freeStars, reserveStars } = createOwnerlessWorld(seed, start)
  for (const division of world.divisions) for (const fixture of division.fixtures) if (fixture.round <= 6) { fixture.played = true; fixture.score = { home: 1, away: 0 } }
  const plan = planSeasonCups(world, seed, kickoffAtForRound(start, 6) + 600_000)!
  applySeasonCupPlan(world, plan)
  world.seasonCupMode = 1
  const own = world.seasonCups!.cups.find(cup => cup.id === 'community')!.rounds[0].fixtures[0].homeId
  const game = createWorldGameFromWorld(world, own, seed, start, freeStars, reserveStars)
  setGame(game)
  onlineState.status = 'online'
  return game
}

describe('赛季页我的赛程', () => {
  it('联赛和杯赛按开赛时间混排，并标出赛事、轮次和开赛时间', () => {
    const game = setup()
    const cupAt = game.world!.seasonCups!.cups.find(cup => cup.id === 'community')!.rounds[0].fixtures[0].kickoffAt
    const prevRound = game.season.fixtures.find(f => f.isPlayer && f.kickoffAt === cupAt - 2 * 3600_000)!.round
    const nextRound = game.season.fixtures.find(f => f.isPlayer && f.kickoffAt === cupAt + 2 * 3600_000)!.round
    const html = renderSeason()
    const start = html.indexOf('my-fixtures')
    const table = html.slice(start, html.indexOf('</table>', start))
    expect(table).toContain('开赛')
    expect(table).toContain('>联赛<')
    expect(table).toContain(`第 ${prevRound} 轮`)
    expect(table).toContain('社区杯')
    expect(table).toContain('16 强')
    expect(table).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/)
    expect(table.indexOf('社区杯')).toBeGreaterThan(table.indexOf(`第 ${prevRound} 轮`))
    expect(table.indexOf('社区杯')).toBeLessThan(table.indexOf(`第 ${nextRound} 轮`))
  })
})
