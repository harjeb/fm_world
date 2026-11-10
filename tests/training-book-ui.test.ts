import { describe, expect, it } from 'vitest'
import { renderTraining } from '../src/ui/screens/training.ts'
import { game, ui } from '../src/ui/state.ts'

describe('培养技能书槽 UI', () => {
  it('开始培养前显示库存里的技能书，并可以勾选', () => {
    game.legendBooks = [
      { id: 'lg_drill_master', tier: 'rainbow' },
      { id: 'lg_low_drive', tier: 'gold' },
    ]
    const player = game.roster.find((item) => item.positions.GK === 0)!
    ui.screen = 'training'
    ui.trainingPlayerId = player.id
    ui.trainingBookIds = ['lg_drill_master:rainbow']
    const html = renderTraining()
    expect(html).toContain('传奇技能书槽')
    expect(html).toContain('data-training-book="lg_drill_master:rainbow"')
    expect(html).toContain('训练狂人')
    expect(html).toContain('checked')
  })
})
