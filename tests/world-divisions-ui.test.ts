import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorldGame, expandWorldConference } from '../src/game/world.ts'
import type { GameState } from '../src/game/types.ts'
import { onlineState, refreshPublicWorld } from '../src/online.ts'
import { setGame, ui } from '../src/ui/state.ts'
import { renderWorld } from '../src/ui/screens/world.ts'

function divisionButtons(html: string): string[] {
  return [...html.matchAll(/data-world-div="([^"]+)"/g)].map(match => match[1])
}
async function snapshot(game: GameState, ids: string[]): Promise<void> {
  const world = game.world!
  const payload = {
    seasonIndex: world.seasonIndex, ownClubId: 'player',
    clubs: world.clubs.map(c => ({ ...c, players: [] })),
    divisions: ids.map(id => {
      const division = world.divisions.find(d => d.divisionId === id)!
      return { ...division, id }
    }),
  }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))
  onlineState.status = 'online'
  await refreshPublicWorld()
}
afterEach(() => {
  onlineState.status = 'offline'
  ui.worldDivision = null
  ui.worldClubId = null
  ui.worldFixtureClubId = 'ALL'
  vi.unstubAllGlobals()
})

describe('世界页扩展赛区去重', () => {
  it('服务器快照和账号存档都有东区时只显示一个入口，简介也不重复', async () => {
    const game = createWorldGame(7141)
    expandWorldConference(game.world!, game.seed)
    setGame(game)
    ui.worldDivision = 'd2-zone3'
    await snapshot(game, game.world!.divisions.map(d => d.divisionId!))
    const html = renderWorld()
    const buttons = divisionButtons(html)
    expect(buttons).toEqual(['champions', 'division1', 'd2-north', 'd2-south', 'd2-zone3'])
    expect(html).toContain('二级联赛（北区 / 南区 / 东区）')
    expect(html).not.toContain('东区 / 东区')
    expect(html).toMatch(/class="tier active[^\"]*" data-world-div="d2-zone3"/)
  })
  it('快照和本地独有的赛区均保留，输入内重复也不产生重复入口', async () => {
    const game = createWorldGame(7142)
    expandWorldConference(game.world!, game.seed)
    expandWorldConference(game.world!, game.seed)
    setGame(game)
    // The server has a new western division, while the local copy still has only east.
    await snapshot(game, ['champions', 'division1', 'd2-north', 'd2-south', 'd2-zone4', 'd2-zone4'])
    game.world!.divisions = game.world!.divisions.filter(d => d.divisionId !== 'd2-zone4')
    game.world!.divisions.push(game.world!.divisions.find(d => d.divisionId === 'd2-zone3')!)
    const buttons = divisionButtons(renderWorld())
    expect(buttons).toEqual(['champions', 'division1', 'd2-north', 'd2-south', 'd2-zone4', 'd2-zone3'])
    expect(new Set(buttons).size).toBe(buttons.length)
  })
  it('离线世界保留扩展赛区，不混入之前的联机快照', () => {
    const game = createWorldGame(7143)
    expandWorldConference(game.world!, game.seed)
    setGame(game)
    onlineState.status = 'offline'
    expect(divisionButtons(renderWorld())).toEqual(['champions', 'division1', 'd2-north', 'd2-south', 'd2-zone3'])
  })
})
