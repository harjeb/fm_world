import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { claimPeakReward } from '../src/game/peak-reward.ts'
import { STAR_TRAITS } from '../src/game/data/star-traits.generated.ts'
import { starTraitOf, traitNameOf } from '../src/game/data/star-traits.ts'
import { SKILLS, TRAITS } from '../src/game/data/skills.ts'
import { skillEffectText, traitEffectText } from '../src/game/data/skill-effects.ts'
import { TSUBASA_LOADOUT, TSUBASA_SKILLS, TSUBASA_TRAITS, isExclusiveSkill } from '../src/game/data/tsubasa-specials.ts'
import { awardLeagueBookDrops } from '../src/game/league-book-drops.ts'
import { ensureLegendBooks } from '../src/game/legend-books.ts'
import { canChooseTrainingBook, drawTrainingSkills } from '../src/game/legend-learning.ts'
import { startTraining } from '../src/game/actions.ts'
import { createInitialGame } from '../src/game/state.ts'
import { upgradeStarTraits } from '../src/game/names.ts'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { skillTierMultiplier } from '../src/game/match/team.ts'
import type { MatchPlayerState, MatchTeamInput } from '../src/game/match/types.ts'
import type { PlayerCard, SkillId, TraitId } from '../src/game/types.ts'

beforeAll(loadPveContent)

type KernelInternals = {
  shotModel(
    shooter: MatchPlayerState,
    team: unknown,
    opp: unknown,
    opts: { point: { x: number; y: number }; header: boolean; penalty: boolean; freeKick: boolean },
  ): { onTarget: number; goalGivenOnTarget: number; gkScore: number; block: number }
  kernel: {
    keeperCatchChance(gk: MatchPlayerState, shooter: MatchPlayerState): number
    findBlockers(opp: unknown, shooter: { x: number; y: number }, target: { x: number; y: number }): number[]
  }
}

describe('足球小将全明星：原著唯一专属特性与唯一彩虹绝技', () => {
  it('16 名足球小将每人拥有全局唯一的特性与彩虹绝技，不与 500 球星或常规技能重名', () => {
    const team = buildPeakTeam(50)
    expect(team.players).toHaveLength(16)

    const traitIds = new Set<string>()
    const traitNames = new Set<string>()
    const skillIds = new Set<string>()
    const skillNames = new Set<string>()

    const existingTraitNames = new Set([
      ...Object.values(TRAITS).map((t) => t.name),
      ...Object.values(STAR_TRAITS).map((t) => t.name),
    ])
    const existingSkillNames = new Set(
      Object.values(SKILLS)
        .filter((s) => !isExclusiveSkill(s.id))
        .map((s) => s.name),
    )

    for (const player of team.players) {
      const loadout = TSUBASA_LOADOUT[player.enName]
      expect(loadout, player.name).toBeTruthy()
      expect(player.traitId, player.name).toBe(loadout.traitId)
      expect(player.signatureSkill, player.name).toBe(loadout.skillId)
      expect(player.skills, player.name).toEqual([loadout.skillId])
      expect(player.skillTiers?.[loadout.skillId], player.name).toBe('rainbow')

      const trait = starTraitOf(player.traitId)
      expect(trait, player.name).toBeTruthy()
      expect(existingTraitNames.has(trait!.name), `${player.name} 特性重名：${trait!.name}`).toBe(false)
      expect(trait!.name).toMatch(/^[一-龥]+$/)
      expect(traitNameOf(player.traitId)).toBe(trait!.name)
      expect(traitEffectText(player.traitId)).toMatch(/\d/)

      const skill = SKILLS[loadout.skillId]
      expect(skill, player.name).toBeTruthy()
      expect(existingSkillNames.has(skill.name), `${player.name} 技能重名：${skill.name}`).toBe(false)
      const effectText = skillEffectText(loadout.skillId, 'rainbow')
      expect(effectText).toMatch(/\d/)
      expect(effectText).not.toMatch(/\d\.\d{2,}/)
      expect(effectText).not.toMatch(/NaN|undefined/)

      traitIds.add(player.traitId)
      traitNames.add(trait!.name)
      skillIds.add(loadout.skillId)
      skillNames.add(skill.name)
    }

    expect(traitIds.size).toBe(16)
    expect(traitNames.size).toBe(16)
    expect(skillIds.size).toBe(16)
    expect(skillNames.size).toBe(16)
    expect(Object.keys(TSUBASA_TRAITS)).toHaveLength(16)
    expect(Object.keys(TSUBASA_SKILLS)).toHaveLength(16)
  })

  it('唯一绝技绝不会通过联赛掉书、队友培养传授或书槽流向其他球员', () => {
    const game = createInitialGame(505)
    game.pve!.peak.cleared = 50
    game.roster.pop()
    const tsubasaTeam = buildPeakTeam(50)
    const tsubasaTemplate = tsubasaTeam.players.find((p) => p.enName === 'Tsubasa Ozora')!
    const claimed = claimPeakReward(game, tsubasaTemplate.id)
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    const tsubasa = claimed.player
    expect(tsubasa.traitId).toBe('ct_trait_tsubasa')
    expect(tsubasa.skills).toContain('ct_drive_shot')

    // 1. 联赛赛后掉书：即使连抽 500 个种子，也不可能掉落 ct_drive_shot
    for (let seed = 1; seed <= 500; seed++) {
      const drops = awardLeagueBookDrops(game, {
        players: [tsubasa],
        stats: [{
          playerId: `home:${tsubasa.id}`,
          sourceId: tsubasa.id,
          name: tsubasa.name,
          side: 'home',
          minutes: 90,
          passes: 20,
          passesCompleted: 18,
          shots: 4,
          goals: 2,
          assists: 1,
          tackles: 1,
          interceptions: 1,
          distance: 10,
          staminaLeft: 70,
          touches: 40,
        }],
        seed,
        label: `test-${seed}`,
      })
      expect(drops.some((d) => isExclusiveSkill(d.id))).toBe(false)
    }

    // 2. 伪造入库也会被 ensureLegendBooks 清理，且书槽禁止选择
    game.legendBooks = [{ id: 'ct_drive_shot', tier: 'rainbow' }]
    expect(canChooseTrainingBook(game.roster[0], { id: 'ct_drive_shot', tier: 'rainbow' }).ok).toBe(false)
    ensureLegendBooks(game)
    expect(game.legendBooks).toHaveLength(0)

    // 3. 队友共同培养交流赛抽技能：绝不会把大空翼的 ct_drive_shot 教给普通队友
    const teammate = game.roster.find((p) => p.id !== tsubasa.id && p.positions.GK === 0)!
    expect(startTraining(game, teammate.id, 99).ok).toBe(true)
    const session = game.training[teammate.id]
    for (let action = 1; action <= 30; action++) {
      session.action = action
      const choices = drawTrainingSkills(session, [tsubasa])
      expect(choices.some((c) => isExclusiveSkill(c.id))).toBe(false)
    }
  })

  it('原著唯一特性与绝技在比赛引擎中真实生效（大空翼、日向小次郎、若林源三、石崎了）', () => {
    const game = createInitialGame(77)
    const input: MatchTeamInput = teamInputFromLineup(game.roster, game.lineup, { id: 'p', name: 'P', color: '#fff', accent: '#000' })
    const engine = new MatchEngine({ seed: 12, home: input, away: structuredClone(input), knockout: false })
    const internal = engine as unknown as KernelInternals
    const home = engine.getTeam('home')
    const away = engine.getTeam('away')
    const shooter = home.players.find((p) => p.position !== 'GK')!
    const gk = away.players.find((p) => p.position === 'GK')!
    const defender = away.players.find((p) => p.position !== 'GK')!

    for (const p of [...home.players, ...away.players]) {
      p.traitId = 'none' as TraitId
      p.skills = []
      p.skillTiers = {}
      p.positions[p.position] = 100
      if (p.detailedPosition) p.detailedPositions = { ...p.detailedPositions, [p.detailedPosition]: 100 }
      for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = 50
    }

    const longPoint = { x: 74, y: 32 }
    gk.x = 97
    gk.y = 32
    const baseLong = internal.shotModel(shooter, home, away, { point: longPoint, header: false, penalty: false, freeKick: false })

    // 大空翼：足球是朋友 (+60% 技能放大) + 彩虹曲线射门
    shooter.traitId = 'ct_trait_tsubasa'
    shooter.skills = ['ct_drive_shot']
    shooter.skillTiers = { ct_drive_shot: 'rainbow' }
    expect(skillTierMultiplier(shooter, 'ct_drive_shot')).toBeCloseTo(1.4 * 1.6, 5)
    const tsubasaLong = internal.shotModel(shooter, home, away, { point: longPoint, header: false, penalty: false, freeKick: false })
    expect(tsubasaLong.onTarget).toBeGreaterThan(baseLong.onTarget + 0.08)
    expect(tsubasaLong.goalGivenOnTarget).toBeGreaterThan(baseLong.goalGivenOnTarget + 0.05)

    // 若林源三：禁区外必杀封锁 (-12% 远射进球率) + 超级天才门将 (+扑救评分 +抱球率)
    const baseCatch = internal.kernel.keeperCatchChance(gk, shooter)
    gk.traitId = 'ct_trait_wakabayashi'
    gk.skills = ['ct_sggk']
    gk.skillTiers = { ct_sggk: 'rainbow' }
    const vsSggk = internal.shotModel(shooter, home, away, { point: longPoint, header: false, penalty: false, freeKick: false })
    expect(vsSggk.gkScore).toBeGreaterThan(tsubasaLong.gkScore + 8)
    expect(vsSggk.goalGivenOnTarget).toBeLessThan(tsubasaLong.goalGivenOnTarget - 0.1)
    expect(internal.kernel.keeperCatchChance(gk, shooter)).toBeGreaterThan(baseCatch + 0.1)

    // 日向小次郎：猛虎射门压低门将评分 + 猛虎斗志进球叠加射术
    gk.traitId = 'none' as TraitId
    gk.skills = []
    shooter.traitId = 'ct_trait_hyuga'
    shooter.skills = ['ct_tiger_shot']
    shooter.skillTiers = { ct_tiger_shot: 'rainbow' }
    shooter.stats.goals = 0
    const hyuga0 = internal.shotModel(shooter, home, away, { point: { x: 86, y: 32 }, header: false, penalty: false, freeKick: false })
    const plainBox = (() => {
      shooter.traitId = 'none' as TraitId
      shooter.skills = []
      const res = internal.shotModel(shooter, home, away, { point: { x: 86, y: 32 }, header: false, penalty: false, freeKick: false })
      shooter.traitId = 'ct_trait_hyuga'
      shooter.skills = ['ct_tiger_shot']
      return res
    })()
    expect(hyuga0.gkScore).toBeLessThan(plainBox.gkScore - 5)
    expect(hyuga0.onTarget).toBeGreaterThan(plainBox.onTarget)
    shooter.stats.goals = 2
    expect(engine.eff(shooter, 'shooting')).toBeGreaterThan(50 + 30)

    // 石崎了：颜面封堵大幅提升封堵评分
    defender.x = 88
    defender.y = 32
    const baseBlock = internal.kernel.findBlockers(away, { x: 82, y: 32 }, { x: 100, y: 32 })[0]
    defender.skills = ['ct_face_block']
    defender.skillTiers = { ct_face_block: 'rainbow' }
    const faceBlock = internal.kernel.findBlockers(away, { x: 82, y: 32 }, { x: 100, y: 32 })[0]
    expect(faceBlock).toBeGreaterThan(baseBlock + 10)
  })

  it('旧存档中已领取的足球小将及球员卡在升级后自动切换为原著唯一特性与彩虹绝技', () => {
    const game = createInitialGame(888)
    game.pve!.peak.cleared = 50
    game.roster.pop()
    const hyugaTemplate = buildPeakTeam(50).players.find((p) => p.enName === 'Kojiro Hyuga')!
    const claimed = claimPeakReward(game, hyugaTemplate.id)
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    const hyuga = claimed.player
    // 模拟旧版本存档：traitId / signatureSkill / skills / cards 还是通用版
    hyuga.traitId = 'cold_blood'
    hyuga.signatureSkill = 'box_hunter'
    hyuga.skills = ['box_hunter', 'iron_lung']
    hyuga.baseSkills = ['box_hunter']
    hyuga.skillTiers = { box_hunter: 'rainbow', iron_lung: 'gold' }
    const card: PlayerCard = {
      id: 'card-hyuga-1',
      playerId: hyuga.id,
      playerName: hyuga.name,
      serial: 1,
      version: 1,
      routeId: null,
      createdAt: 1000,
      attrs: { ...hyuga.attrs },
      positions: { ...hyuga.positions },
      personality: { ...hyuga.personality },
      skills: ['box_hunter', 'iron_lung'] as SkillId[],
      skillTiers: { box_hunter: 'rainbow', iron_lung: 'gold' },
    }
    game.cards = [card]
    game.traitsVersion = 1

    expect(upgradeStarTraits(game)).toBe(true)
    expect(hyuga.traitId).toBe('ct_trait_hyuga')
    expect(hyuga.signatureSkill).toBe('ct_tiger_shot')
    expect(hyuga.skills).toEqual(['ct_tiger_shot', 'iron_lung'])
    expect(hyuga.skillTiers?.ct_tiger_shot).toBe('rainbow')
    expect(card.skills).toEqual(['ct_tiger_shot', 'iron_lung'])
    expect(card.skillTiers?.ct_tiger_shot).toBe('rainbow')
  })
})
