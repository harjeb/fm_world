import { describe, expect, it } from 'vitest'
import { renderTraining } from '../src/ui/screens/training.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { game, ui } from '../src/ui/state.ts'
import { basicSkillsFor } from '../src/game/data/skills.ts'
import { trainingBookLoadout } from '../src/ui/training-books.ts'
import { bookKey } from '../src/game/legend-learning.ts'

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

  it('按技能 ID 隐藏本位置基础池各档位，旧配置过滤并提示未保存，不修改库存', () => {
    const player = game.roster.find((item) => item.positions.GK === 0)!
    const basic = basicSkillsFor(player)[0]
    const other = basicSkillsFor({ positions: { GK: 1, CB: 0, W: 0, CM: 0, ST: 0 } })[0]
    const books = [
      { id: basic, tier: 'silver' as const }, { id: basic, tier: 'gold' as const }, { id: basic, tier: 'rainbow' as const },
      { id: other, tier: 'silver' as const }, { id: 'lg_drill_master' as const, tier: 'rainbow' as const },
    ]
    game.legendBooks = books
    game.trainingBooksByPlayer = { ...game.trainingBooksByPlayer, [player.id]: [bookKey(books[0]), bookKey(books[3])] }
    ui.trainingPlayerId = player.id
    ui.trainingBookIds = trainingBookLoadout(game, player.id)
    expect(ui.trainingBookIds).toEqual([bookKey(books[3])])
    const html = renderTraining()
    for (const book of books.slice(0, 3)) expect(html).not.toContain(`data-training-book="${bookKey(book)}"`)
    expect(html).toContain(`data-training-book="${bookKey(books[3])}"`)
    expect(html).toContain(`data-training-book="${bookKey(books[4])}"`)
    expect(html).toContain('旧配置中的本位置基础技能卡已从选择中移除')
    expect(html).toContain('未保存的修改')
    expect(game.legendBooks).toEqual(books)
    expect(game.trainingBooksByPlayer[player.id]).toEqual([bookKey(books[0]), bookKey(books[3])])
    delete game.trainingBooksByPlayer[player.id]
  })

  it('旧配置仅含已不在库存的基础技能卡时仍提示并可保存空配置', () => {
    const player = game.roster.find((item) => item.positions.GK > 0)!
    const key = `${basicSkillsFor(player)[0]}:gold`
    game.legendBooks = []
    game.trainingBooksByPlayer = { ...game.trainingBooksByPlayer, [player.id]: [key] }
    ui.trainingPlayerId = player.id
    ui.trainingBookIds = trainingBookLoadout(game, player.id)
    const html = renderTraining()
    expect(ui.trainingBookIds).toEqual([])
    expect(html).toContain('旧配置中的本位置基础技能卡已从选择中移除')
    expect(html).toContain('未保存的修改')
    expect(html).toContain('保存当前配置')
    expect(html).not.toContain(`data-training-book="${key}"`)
    delete game.trainingBooksByPlayer[player.id]
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
