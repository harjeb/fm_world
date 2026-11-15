import { afterEach, describe, expect, it } from 'vitest'
import { createOwnerlessWorld, createWorldGameFromWorld } from '../src/game/world.ts'
import { applySeasonCupPlan, planSeasonCups } from '../src/game/season-cups.ts'
import { kickoffAtForRound } from '../src/game/calendar.ts'
import { game as originalGame, setGame } from '../src/ui/state.ts'
import { onlineState } from '../src/online.ts'
import { renderSeasonCups } from '../src/ui/season-cup-view.ts'

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
  return { game, own }
}

describe('独立杯赛页', () => {
  it('四项杯赛可切换，树图含真实对阵、球队队徽与执教人像', () => {
    const { game } = setup()
    const html = renderSeasonCups(game, 'community')
    expect(html).toContain('aria-label="选择杯赛"')
    for (const id of ['community', 'league', 'champions', 'cross']) expect(html).toContain(`data-season-cup-tab="${id}"`)
    expect(html).toContain('淘汰赛对阵图')
    expect(html).toContain('aria-label="社区杯淘汰赛对阵树"')
    expect(html).toContain('data-cup-node=')
    expect(html).toContain('class="crest"')
    expect(html).toContain('class="human-mark')
    expect(html).toContain('每场参赛金')
    expect(html).toContain('50,000')
    expect(html).toContain('300,000')
    expect(html).toContain('轮空不发')
    expect(html).toContain('射手榜')
    expect(html).toContain('助攻榜')
    expect(html).toContain('射门榜')
    expect(html).toContain('抢断榜')
    expect(html).toContain('扑救榜')
    const cross = renderSeasonCups(game, 'cross')
    expect(cross).toContain('星联杯')
    expect(cross).toContain('1,500,000')
    expect(cross).toContain('+250')
    expect(cross).toContain('data-season-cup-tab="cross" class="active"')
  })

  it('缺少抽签种子时退回真实对阵而不伪造晋级树', () => {
    const { game } = setup()
    delete game.world!.seasonCups!.drawSeed
    const html = renderSeasonCups(game, 'community')
    expect(html).toContain('签表来源未完整记录')
    expect(html).not.toContain('data-cup-node=')
    expect(html).toContain('data-club-open=')
  })
})
