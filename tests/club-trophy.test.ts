import { describe, expect, it } from 'vitest'
import { renderClub } from '../src/ui/screens/club.ts'
import { game, ui } from '../src/ui/state.ts'

describe('俱乐部荣誉橱窗', () => {
  it('夺冠后显示杯名、次数和决赛记录', () => {
    game.pve!.trophies.push({
      cupId: 'community',
      cupName: '社区杯',
      seasonIndex: 3,
      wonAt: Date.now(),
      finalOpponent: '北岸联',
      finalScore: { home: 2, away: 1 },
    })
    ui.clubTab = 'history'
    const html = renderClub()
    expect(html).toContain('荣誉橱窗')
    expect(html).toContain('社区杯')
    expect(html).toContain('北岸联')
    expect(html).toContain('×1')
  })
})
