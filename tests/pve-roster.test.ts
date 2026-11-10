import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { pveRoster } from '../src/ui/pve-details.ts'

beforeAll(loadPveContent)

function mainValues(html: string, name: string): number[] {
  const row = html.split('<tr>').find(value => value.includes(`<b>${name}</b>`))!
  return [...row.matchAll(/<td class="num"[^>]*>(\d+(?:\.\d+)?)<\/td>/g)].map(match => Number(match[1]))
}

describe('PvE roster display units', () => {
  it('shows field and goalkeeper main attributes in stored units and leaves hidden attributes unchanged', () => {
    const team = buildPeakTeam(50)
    const field = team.players.find(player => player.positions.GK === 0)!
    const keeper = team.players.find(player => player.positions.GK > 0)!
    field.name = 'Field player'
    keeper.name = 'Goalkeeper'
    const fieldValues = [1125, 1500, 900, 750, 1000, 975, 1200]
    const keeperValues = [1350, 1275, 1050, 975, 1200, 1125]
    mainAttrsFor(false).forEach((key, index) => field.attrs[key] = fieldValues[index])
    mainAttrsFor(true).forEach((key, index) => keeper.attrs[key] = keeperValues[index])
    field.attrs.vision = 17.5
    const before = structuredClone(team.players.map(player => player.attrs))
    const html = pveRoster(team)
    expect(mainValues(html, field.name)).toEqual(fieldValues)
    expect(mainValues(html, keeper.name)).toEqual(keeperValues)
    expect(html).toContain('视野 17.5')
    expect(team.players.map(player => player.attrs)).toEqual(before)
  })

  it('preserves an attribute above the base ceiling in the same display units', () => {
    const team = buildPeakTeam(50)
    const player = team.players.find(entry => entry.positions.GK === 0)!
    player.name = 'Breakthrough player'
    player.attrs.passing = 2000
    expect(mainValues(pveRoster(team), player.name)[0]).toBe(2000)
  })
})
