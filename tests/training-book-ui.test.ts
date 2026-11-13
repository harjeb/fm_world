import { describe, expect, it } from 'vitest'
import { renderTraining } from '../src/ui/screens/training.ts'
import { createTrainingSession } from '../src/game/training.ts'
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
    expect(html).toContain('保存当前配置')
    expect(html).toContain('只有交流赛后触发学习')
    expect(html).toContain('随机最多 5 人')
    expect(html).toContain('50:30:20')
    expect(html).toContain('本位置基础技能池（6 项）')
    expect(html).toContain('未保存的修改')
  })

  it('没书时也显示入口和挑战指引；查看培养中书名与交流赛规则', () => {
    game.legendBooks = []
    const player = game.roster.find((item) => item.positions.GK === 0)!
    ui.trainingPlayerId = player.id
    ui.trainingBookIds = []
    let html = renderTraining()
    expect(html).toContain('装备技能卡')
    expect(html).toContain('还没有技能卡')
    expect(html).toContain('前往挑战')
    delete game.training[player.id]
    game.legendBooks = [{ id: 'lg_drill_master', tier: 'rainbow' }]
    const session = createTrainingSession(player, 123, undefined, 1, game.legendBooks)
    game.training[player.id] = session
    session.books = []
    expect(renderTraining()).toContain('本轮没有配置技能书，交流赛后仍可学习')
    session.books = [...game.legendBooks]
    html = renderTraining()
    expect(html).toContain('本轮技能书槽')
    expect(html).toContain('训练狂人')
    expect(html).toContain('共同培养队友和基础技能按概率抽取')
    delete game.training[player.id]
  })
})
