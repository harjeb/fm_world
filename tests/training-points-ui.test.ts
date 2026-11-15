import { afterEach, describe, expect, it } from 'vitest'
import { createTrainingSession, trainingQualityChances } from '../src/game/training.ts'
import { renderAutoStrategyOverlay, renderTraining } from '../src/ui/screens/training.ts'
import { game, ui } from '../src/ui/state.ts'

const state = ui as typeof ui & { trainingPointSpend?: 0 | 10 | 20 | 30 }
const player = game.roster.find((p) => p.positions.GK === 0)!

afterEach(() => {
  delete game.training[player.id]
  delete game.trainingPoints
  state.trainingPointSpend = 0
  ui.autoStrategyOpen = false
  ui.autoStrategyDetail = false
})

describe('培养点界面', () => {
  it('展示可选档位、余额和说明，余额不足时禁用对应选项', () => {
    ui.trainingPlayerId = player.id
    game.trainingPoints = 15
    state.trainingPointSpend = 10
    const html = renderTraining()
    expect(html).toContain('余额 15')
    for (const [points, great, perfect] of [[0, 8, 1], [10, 12, 2], [20, 16, 3], [30, 20, 5]]) {
      const button = html.match(new RegExp(`<button[^>]*data-action="training-points-select" data-points="${points}"[^>]*>[^<]*</button>`))![0]
      expect(button).toContain(`data-player="${player.id}"`)
      expect(button).toContain(`大成功 ${great}% / 完美 ${perfect}%`)
      expect(button.includes('disabled')).toBe(points > 15)
      expect(button).toContain(`aria-pressed="${points === 10}"`)
    }
    expect(html).toContain('体力≤30无大成功/完美；悟性可叠加；不保证最终CA；成功开始时扣除，不退')
    delete game.trainingPoints
    expect(renderTraining()).toContain('余额 0')
  })

  it('开始前按球员原始技能显示叠加后的概率', () => {
    ui.trainingPlayerId = player.id
    game.trainingPoints = 10
    state.trainingPointSpend = 10
    const original = { skills: player.skills, tiers: player.skillTiers, version: player.version, equipped: player.equippedCardId }
    try {
      player.version = 0
      delete player.equippedCardId
      player.skills = ['lg_fast_learner']
      player.skillTiers = { lg_fast_learner: 'gold' }
      expect(renderTraining()).toContain('以本轮初始技能、体力充足计算：大成功 17% / 完美 7%')
      game.trainingPoints = 30
      state.trainingPointSpend = 30
      expect(renderTraining()).toContain('以本轮初始技能、体力充足计算：大成功 25% / 完美 10%')
    } finally {
      player.skills = original.skills
      player.skillTiers = original.tiers
      player.version = original.version
      player.equippedCardId = original.equipped
    }
  })

  it('自动培养两个菜单仅在新开时提供选择', () => {
    ui.trainingPlayerId = player.id
    ui.autoStrategyOpen = true
    for (const detail of [false, true]) {
      ui.autoStrategyDetail = detail
      expect(renderAutoStrategyOverlay()).toContain('data-action="training-points-select"')
    }
    game.training[player.id] = createTrainingSession(player, 123)
    for (const detail of [false, true]) {
      ui.autoStrategyDetail = detail
      expect(renderAutoStrategyOverlay()).not.toContain('data-action="training-points-select"')
    }
    expect(renderTraining()).not.toContain('data-action="training-points-select"')
  })

  it('显示当前培养实际概率，随体力与候选技能变化', () => {
    ui.trainingPlayerId = player.id
    const session = createTrainingSession(player, 123)
    game.training[player.id] = session
    session.qualityBonusPoints = 20
    const check = () => {
      const chances = trainingQualityChances(session)
      const html = renderTraining()
      expect(html).toContain('本轮培养点投入 20')
      for (const [label, value] of Object.entries({ 失败: chances.failure, 一般: chances.plain, 成功: chances.success, 大成功: chances.great, 完美: chances.perfect })) {
        expect(html).toContain(`${label} ${(value * 100).toFixed(2)}%`)
      }
    }
    check()
    session.candidate.skills = ['lg_fast_learner']
    session.candidate.skillTiers = { lg_fast_learner: 'gold' }
    check()
    session.fatigue = 70
    check()
  })
})
