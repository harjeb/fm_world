import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addTrainedCard } from '../src/game/cards.ts'
import { createInitialGame } from '../src/game/state.ts'
import { createTrainingSession } from '../src/game/training.ts'
import { game, setGame, ui } from '../src/ui/state.ts'

let renderInventory: typeof import('../src/ui/screens/inventory.ts').renderInventory
let originalGame: typeof game
let originalUi: typeof ui

beforeAll(async () => {
  originalGame = game
  originalUi = { ...ui }
  vi.stubGlobal('document', { addEventListener: vi.fn() })
  ;({ renderInventory } = await import('../src/ui/screens/inventory.ts'))
})

afterAll(() => {
  setGame(originalGame)
  Object.assign(ui, originalUi)
  vi.unstubAllGlobals()
})

beforeEach(() => {
  setGame(createInitialGame(3344))
  Object.assign(ui, originalUi, {
    screen: 'inventory',
    inventoryTab: 'cards',
    inventorySearch: '',
    inventoryPos: 'ALL',
    inventorySort: 'new',
    inventoryBookSearch: '',
    inventoryBookTier: 'ALL',
    inventoryBookCat: 'ALL',
    recycleSelectedIds: [],
    recycleConfirm: false,
    cardDeleteId: null,
  })
})

afterEach(() => {
  Object.assign(ui, originalUi)
})

describe('库存页（技能书分页与紧凑球员卡布局）', () => {
  it('顶部展示球员卡与技能书双分页及数量；技能书分页按彩/金/银展示并支持筛选与搜索', () => {
    game.legendBooks = [
      { id: 'box_hunter', tier: 'silver' },
      { id: 'lg_stamina_regen', tier: 'gold' },
      { id: 'lg_legend_star', tier: 'rainbow' },
      { id: 'lg_drill_master', tier: 'rainbow' },
    ]

    const cardsTabHtml = renderInventory()
    expect(cardsTabHtml).toContain('data-inventory-tab="cards"')
    expect(cardsTabHtml).toContain('data-inventory-tab="books"')
    expect(cardsTabHtml).toContain('技能书 <small>4</small>')

    ui.inventoryTab = 'books'
    const allBooksHtml = renderInventory()
    expect(allBooksHtml).toContain('inv-book-grid')
    expect(allBooksHtml).toContain('<b class="book-name skill-rainbow">传奇之星</b>')
    expect(allBooksHtml).toContain('<b class="book-name skill-rainbow">训练狂人</b>')
    expect(allBooksHtml).toContain('<b class="book-name skill-gold">呼吸法</b>')
    expect(allBooksHtml).toContain('<b class="book-name skill-silver">禁区猎手</b>')
    expect(allBooksHtml).toContain('培养专属')
    expect(allBooksHtml).toContain('辅助')
    expect(allBooksHtml).toContain('主技能')
    expect(allBooksHtml).toContain('比赛体能耐力 +10%')
    expect(allBooksHtml).not.toContain('+14%')
    expect(allBooksHtml).toContain('专项训练成长 +17%')
    expect(allBooksHtml).not.toContain('+12%')

    // 按稀有度筛选
    ui.inventoryBookTier = 'gold'
    const goldHtml = renderInventory()
    expect(goldHtml).toContain('呼吸法')
    expect(goldHtml).not.toContain('禁区猎手')
    expect(goldHtml).not.toContain('传奇之星')

    // 按类别筛选
    ui.inventoryBookTier = 'ALL'
    ui.inventoryBookCat = 'passive'
    const passiveHtml = renderInventory()
    expect(passiveHtml).toContain('传奇之星')
    expect(passiveHtml).not.toContain('呼吸法')

    // 按关键字搜索
    ui.inventoryBookCat = 'ALL'
    ui.inventoryBookSearch = '禁区'
    const searchHtml = renderInventory()
    expect(searchHtml).toContain('禁区猎手')
    expect(searchHtml).not.toContain('呼吸法')
  })

  it('球员装备培养卡时不再占用整张原始属性卡片格位，而在分组标题栏提供换回原始按钮', () => {
    const player = game.roster[0]
    const session = createTrainingSession(player, 123)
    const card = addTrainedCard(game, session)
    player.equippedCardId = card.id

    ui.inventoryTab = 'cards'
    const equippedHtml = renderInventory()
    expect(equippedHtml).not.toContain(`data-key="base-${player.id}"`)
    expect(equippedHtml).toContain('· 换回</button>')
    expect(equippedHtml).toContain('card-stat-pill')
    expect(equippedHtml).not.toContain('card-owner-meter')

    // 换回原始属性后，原始属性卡片显示已装备状态
    delete player.equippedCardId
    const baseHtml = renderInventory()
    expect(baseHtml).toContain(`data-key="base-${player.id}"`)
  })
})
