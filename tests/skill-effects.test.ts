import { describe, expect, it } from 'vitest'
import { skillEffectText, skillTierNote, traitEffectText } from '../src/game/data/skill-effects.ts'
import { SKILLS, TRAITS } from '../src/game/data/skills.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { createInitialGame } from '../src/game/state.ts'
import type { SkillId, TraitId } from '../src/game/types.ts'

describe('技能和特性的效果说明', () => {
  it('每个技能在每个等级都有说明，没有浮点尾巴', () => {
    for (const id of Object.keys(SKILLS) as SkillId[]) {
      for (const tier of ['silver', 'gold', 'rainbow'] as const) {
        const text = skillEffectText(id, tier)
        expect(text, id).toMatch(/[\d]/)
        expect(text, id).not.toMatch(/\d\.\d{2,}/)
        expect(text, id).not.toMatch(/NaN|undefined/)
      }
      expect(skillTierNote(id), id).toContain('银')
    }
  })

  it('数值按等级放大，和比赛结算一致', () => {
    expect(skillEffectText('box_hunter', 'silver')).toBe('在禁区内起脚：射正率 +4%，进球率 +3%。')
    expect(skillEffectText('box_hunter', 'gold')).toBe('在禁区内起脚：射正率 +4.8%，进球率 +3.6%。')
    expect(skillEffectText('box_hunter', 'rainbow')).toBe('在禁区内起脚：射正率 +5.6%，进球率 +4.2%。')
    expect(skillEffectText('iron_lung', 'silver')).toContain('-5%')
    expect(skillEffectText('iron_lung', 'gold')).toContain('-10%')
    expect(skillEffectText('iron_lung', 'rainbow')).toContain('-15%')
    expect(skillEffectText('injury_prevention', 'silver')).toContain('-30%')
    expect(skillEffectText('injury_prevention', 'rainbow')).toContain('-42%')
    expect(skillEffectText('one_touch', 'gold')).toContain('1.2 秒')
    expect(skillEffectText('gk_sweeper', 'rainbow')).toContain('33.6 米')
    expect(skillTierNote('iron_lung')).toContain('15%')
    expect(skillTierNote('box_hunter')).toContain('×1.4')
  })

  it('每个特性都有说明；主属性按面板数字说，隐藏属性按满分 100 说', () => {
    for (const id of Object.keys(TRAITS) as TraitId[]) {
      const text = traitEffectText(id)
      expect(text, id).toMatch(/\d/)
      expect(text, id).not.toMatch(/NaN|undefined/)
    }
    expect(traitEffectText('cold_blood')).toBe('在禁区内射门时：射术 +105。')
    expect(traitEffectText('wall')).toBe('扑救反应 +90。')
    expect(traitEffectText('anchor')).toBe('抢断 +75。')
    expect(traitEffectText('engine')).toBe('跑动时的体力消耗 -8%。')
    expect(traitEffectText('metronome')).toBe('传球或进入前场时：视野 +6（隐藏属性，满分 100）。')
    expect(traitEffectText('pace')).toBe('加速 +3（隐藏属性，满分 100）。')
    expect(traitEffectText('target')).toBe('争顶时：力量 +105，头球 +7（隐藏属性，满分 100）。')
  })

  it('特性说明里的数字和比赛里的实际加成一致', () => {
    const game = createInitialGame(61)
    const input = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 1, home: input, away: input, knockout: false })
    const player = engine.getTeam('home').players.find((item) => item.position !== 'GK')!
    player.stamina = player.maxStamina
    player.positions[player.position] = 100
    player.attrs.tackling = 40
    player.attrs.shooting = 40
    player.traitId = 'none' as TraitId
    const plainTackling = engine.eff(player, 'tackling')
    const plainShooting = engine.eff(player, 'shooting', { inBox: true })
    player.traitId = 'anchor'
    expect(engine.eff(player, 'tackling') - plainTackling).toBeCloseTo(TRAITS.anchor.value, 5)
    player.traitId = 'cold_blood'
    expect(engine.eff(player, 'shooting', { inBox: true }) - plainShooting).toBeCloseTo(TRAITS.cold_blood.value, 5)
    expect(engine.eff(player, 'shooting', { inBox: false })).toBeCloseTo(plainShooting, 5)
  })
})
