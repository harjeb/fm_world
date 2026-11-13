import { describe, expect, it } from 'vitest'
import { renderTraining } from '../src/ui/screens/training.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { game, ui } from '../src/ui/state.ts'

describe('培养技能书槽 UI', () => {
  it('开始培养前在培养面板下方醒目展示技能书槽，支持多种稀有度并去掉冗余说明', () => {
    game.legendBooks = [
      { id: 'lg_drill_master', tier: 'rainbow' },
      { id: 'lg_low_drive', tier: 'gold' },
      { id: 'lg_slide_tackle', tier: 'silver' },
    ]
    const player = game.roster.find((item) => item.positions.GK === 0)!
    ui.screen = 'training'
    ui.trainingPlayerId = player.id
    ui.trainingBookIds = ['lg_drill_master:rainbow']
    const html = renderTraining()
    expect(html).toContain('装备技能卡')
    expect(html).toContain('panel book-slot-panel')
    expect(html).toContain('data-training-book="lg_drill_master:rainbow"')
    expect(html).toContain('data-training-book="lg_slide_tackle:silver"')
    expect(html).toContain('skill-silver')
    expect(html).toContain('skill-gold')
    expect(html).toContain('skill-rainbow')
    expect(html).toContain('银书')
    expect(html).toContain('金书')
    expect(html).toContain('彩书')
    expect(html).toContain('训练狂人')
    expect(html).toContain('checked')
    expect(html).toContain('保存当前配置')
    expect(html).not.toContain('只有交流赛后触发学习')
    expect(html).not.toContain('50:30:20')
    expect(html).toContain('本位置基础技能池（6 项）')
    expect(html).toContain('未保存的修改')
    const gridTwoStart = html.indexOf('<div class="grid two">')
    const bookPanelStart = html.indexOf('<section class="panel book-slot-panel">')
    expect(gridTwoStart).toBeGreaterThan(-1)
    expect(bookPanelStart).toBeGreaterThan(html.indexOf('培养起点：原始属性'))
    const between = html.slice(gridTwoStart, bookPanelStart)
    expect(between).toContain('</div>')
  })

  it('没书时显示多稀有度提示与入口；查看培养中书名与稀有度标签', () => {
    game.legendBooks = []
    const player = game.roster.find((item) => item.positions.GK === 0)!
    ui.trainingPlayerId = player.id
    ui.trainingBookIds = []
    let html = renderTraining()
    expect(html).toContain('装备技能卡')
    expect(html).toContain('还没有技能书')
    expect(html).toContain('银、金、彩')
    expect(html).toContain('前往挑战')
    delete game.training[player.id]
    game.legendBooks = [{ id: 'lg_drill_master', tier: 'rainbow' }]
    const session = createTrainingSession(player, 123, undefined, 1, game.legendBooks)
    game.training[player.id] = session
    session.books = []
    expect(renderTraining()).toContain('本轮未装备技能卡；交流赛后仍可学习')
    session.books = [...game.legendBooks]
    html = renderTraining()
    expect(html).toContain('本轮技能书槽')
    expect(html).toContain('skill-rainbow')
    expect(html).toContain('训练狂人')
    delete game.training[player.id]
  })
})
