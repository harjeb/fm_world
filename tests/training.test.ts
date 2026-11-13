import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { startTraining, trainingAction, trainingEventChoice, confirmTraining, discardTraining } from '../src/game/actions.ts'
import { createTrainingSession, resolveTrainingEvent, performTrainingAction, planTraining } from '../src/game/training.ts'
import { createPlayerFromSeed } from '../src/game/data/players.ts'
import { PLAYER_SEEDS } from '../src/game/data/players.ts'
import { eventById } from '../src/game/data/events.ts'
import { caOf } from '../src/game/ca.ts'
import { validateLineup } from '../src/game/squad.ts'
import { economyOf } from '../src/game/economy.ts'

function finishSession(session: ReturnType<typeof createTrainingSession>) {
  for (let index = 0; index < 100 && !session.completed; index++) {
    if (session.pendingEventId) {
      const event = eventById(session.pendingEventId)!
      resolveTrainingEvent(session, event.options[0].id)
      continue
    }
    if (session.completed) break
    if (session.fatigue + 12 > 100) {
      performTrainingAction(session, { kind: 'rest' })
    } else {
      performTrainingAction(session, { kind: 'drill', attr: index % 2 === 0 ? 'passing' : 'tackling' })
    }
    if (session.pendingEventId) {
      const event = eventById(session.pendingEventId)!
      resolveTrainingEvent(session, event.options[0].id)
    }
  }
}

describe('培养', () => {
  it('30 次行动后生成新卡进入库存，不自动换上', () => {
    const game = createInitialGame(2024)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    expect(startTraining(game, player.id, 777).ok).toBe(true)
    delete game.training[player.id].scheduleVersion
    for (let guard = 0; guard < 100; guard++) {
      const session = game.training[player.id]
      if (!session || session.completed) break
      if (session.pendingEventId) {
        const event = eventById(session.pendingEventId)!
        trainingEventChoice(game, player.id, event.options[0].id)
      } else {
        trainingAction(game, player.id, guard % 4 === 0 ? { kind: 'rest' } : { kind: 'drill', attr: 'passing' })
      }
    }
    const session = game.training[player.id]
    expect(session?.completed).toBe(true)
    expect(session.action).toBe(30)
    expect(game.candidates[player.id]).toBeTruthy()
    expect(game.roster.find((item) => item.id === player.id)?.version).toBe(player.version)
    expect(caOf(game.candidates[player.id].attrs, false)).toBeLessThanOrEqual(1500 + 1e-6)
    const versionBefore = player.version
    const result = confirmTraining(game, player.id)
    expect(result.ok).toBe(true)
    expect(game.roster.find((item) => item.id === player.id)?.version).toBe(versionBefore + 1)
    expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
  })

  it('每轮从原始属性开始，练到个人上限后停止：上限因人而异，PA 不参与', () => {
    const game = createInitialGame(4)
    const player = game.roster.find(item => item.positions.GK === 0)!
    const id = player.id
    player.pa = 1
    player.attrs.passing = 450
    player.baseAttrs.passing = 450
    player.ceilings.passing = 470
    const original = structuredClone(player)
    for (let course = 0; course < 2; course++) {
      const current = structuredClone(player)
      expect(startTraining(game, id, 99 + course).ok).toBe(true)
      delete game.training[id].scheduleVersion
      const session = game.training[id]
      // 第二轮时他已经装备了第一张卡，起点仍然是原始属性。
      expect(session.candidate.attrs).toEqual(original.baseAttrs)
      expect(session.candidate.positions).toEqual(original.basePositions)
      expect(session.candidate.skills).toEqual(original.skills)
      expect(session.candidate.skillTiers).toEqual(original.skillTiers)
      for (let guard = 0; guard < 100 && !session.completed; guard++) {
        const result = session.pendingEventId
          ? trainingEventChoice(game, id, eventById(session.pendingEventId)!.options[0].id)
          : trainingAction(game, id, session.fatigue + 12 > 100 ? { kind: 'rest' } : { kind: 'drill', attr: 'passing' })
        expect(result.ok).toBe(true)
      }
      expect(session.completed).toBe(true)
      expect(game.roster.find(item => item.id === id)!.attrs).toEqual(current.attrs)
      expect(confirmTraining(game, id).ok).toBe(true)
      // 到上限即停：上限来自球员自己的 ceilings，而不是统一的 1500。
      expect(player.attrs.passing).toBe(470)
    }
    expect(player.pa).toBe(1)
    expect(player.ceilings.passing).toBe(470)
  })

  it('确认或放弃候选时保留期间比赛更新的体力和恢复的精力', () => {
    for (const confirm of [true, false]) {
      const game = createInitialGame(2025)
      const player = game.roster[0]
      expect(startTraining(game, player.id, 777).ok).toBe(true)
      delete game.training[player.id].scheduleVersion
      expect(player.energy).toBe(70)
      for (let guard = 0; guard < 100 && !game.training[player.id].completed; guard++) {
        const session = game.training[player.id]
        if (session.pendingEventId) trainingEventChoice(game, player.id, eventById(session.pendingEventId)!.options[0].id)
        else trainingAction(game, player.id, { kind: 'rest' })
      }
      expect(game.training[player.id].completed).toBe(true)
      player.energy = 100
      player.condition = 42
      expect((confirm ? confirmTraining(game, player.id) : discardTraining(game, player.id)).ok).toBe(true)
      const current = game.roster.find(item => item.id === player.id)!
      expect(current.energy).toBe(100)
      expect(current.condition).toBe(42)
    }
  })

  it('同种子、同行动顺序、同事件选项可复现', () => {
    const player = createPlayerFromSeed(PLAYER_SEEDS[45])
    const a = createTrainingSession(player, 123456)
    delete a.scheduleVersion
    const b = createTrainingSession(player, 123456)
    delete b.scheduleVersion
    finishSession(a)
    finishSession(b)
    const signature = (session: typeof a) => JSON.stringify({
      attrs: session.candidate.attrs,
      positions: session.candidate.positions,
      skills: session.candidate.skills,
      route: [session.routeId, session.routePoints],
      flags: session.flags,
      log: session.log.map((entry) => [entry.title, entry.text]),
    })
    expect(signature(a)).toBe(signature(b))
    expect(a.completed).toBe(true)
    expect(a.action).toBe(30)
  })

  it('一次完整培养消耗 30 精力，精力不足不能开始', () => {
    const game = createInitialGame(77)
    const first = game.roster[0]
    const second = game.roster[1]
    expect(first.energy).toBe(100)
    expect(startTraining(game, first.id).ok).toBe(true)
    expect(first.energy).toBe(70)
    second.energy = 29
    const blocked = startTraining(game, second.id)
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('精力不足')
  })

  it('初始位置与 PA/天花板在重养时保持不变', () => {
    const game = createInitialGame(5)
    const player = game.roster.find((item) => item.positions.CM > 0)!
    const basePositions = { ...player.basePositions }
    const pa = player.pa
    const ceilings = { ...player.ceilings }
    startTraining(game, player.id, 99)
    delete game.training[player.id].scheduleVersion
    const session = game.training[player.id]
    expect(session.candidate.positions).toEqual(basePositions)
    expect(session.candidate.pa).toBe(pa)
    expect(session.candidate.ceilings).toEqual(ceilings)
  })

  it('传球路线链能在 30 次行动内完成并解锁稳健分球', () => {
    const player = createPlayerFromSeed(PLAYER_SEEDS[70])
    const session = createTrainingSession(player, 2468)
    delete session.scheduleVersion
    for (let guard = 0; guard < 100; guard++) {
      if (session.completed) break
      if (session.pendingEventId) {
        const event = eventById(session.pendingEventId)!
        resolveTrainingEvent(session, event.options[0].id)
        continue
      }
      if (session.fatigue + 12 > 100) performTrainingAction(session, { kind: 'rest' })
      else performTrainingAction(session, { kind: 'drill', attr: 'passing' })
      if (session.pendingEventId) {
        const event = eventById(session.pendingEventId)!
        resolveTrainingEvent(session, event.options[0].id)
      }
    }
    expect(session.completed).toBe(true)
    expect(session.flags).toContain('chain_pass_1')
    expect(session.flags).toContain('chain_pass_2')
    expect(session.flags).toContain('chain_pass_3')
    expect(session.routeId).toBe('safe_organization')
    expect(session.candidate.skills).toContain('safe_pass')
  })

  it('主技能不超过 4 个，属性成长不超过 1500', () => {
    const game = createInitialGame(7)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    startTraining(game, player.id, 888)
    delete game.training[player.id].scheduleVersion
    for (let index = 0; index < 100; index++) {
      const session = game.training[player.id]
      if (!session || session.completed) break
      if (session.pendingEventId) {
        const event = eventById(session.pendingEventId)!
        for (const option of event.options) {
          const copy = structuredClone(session)
          trainingEventChoice(game, player.id, option.id)
          expect((game.training[player.id].candidate.skills.length)).toBeLessThanOrEqual(4)
          expect(caOf(game.training[player.id].candidate.attrs, false)).toBeLessThanOrEqual(1500 + 1e-6)
          Object.assign(game.training[player.id], copy)
          break
        }
        const selected = event.options[0]
        trainingEventChoice(game, player.id, selected.id)
      } else {
        expect(trainingAction(game, player.id, session.fatigue + 12 > 100 ? { kind: 'rest' } : { kind: 'drill', attr: 'passing' }).ok).toBe(true)
      }
    }
    expect(game.training[player.id].completed).toBe(true)
    expect(game.training[player.id]?.candidate.skills.length ?? 0).toBeLessThanOrEqual(4)
  })
  it('旧式技能传承训练已取消，旧课程也不能继续通过旧接口执行', () => {
    const game = createInitialGame(4)
    const player = game.roster[0], mentor = game.roster[1]
    expect(startTraining(game, player.id, 1).ok).toBe(true)
    delete game.training[player.id].scheduleVersion
    const before = structuredClone(game.training[player.id])
    const result = trainingAction(game, player.id, { kind: 'inherit', skill: 'injury_prevention', mentorId: mentor.id })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('已合并')
    expect(game.training[player.id]).toEqual(before)
  })

  it('新一轮培养固定使用开始时的青训设施等级', () => {
    const game = createInitialGame(70)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    economyOf(game).academy = 5
    expect(startTraining(game, player.id, 42).ok).toBe(true)
    delete game.training[player.id].scheduleVersion
    const session = game.training[player.id]
    expect(session.academyLevel).toBe(5)
    const low = structuredClone(session)
    low.facilityLevels!.academy = 1
    const request = { kind: 'drill', attr: 'passing' } as const
    expect(planTraining(session, request).gains.passing!).toBeGreaterThan(planTraining(low, request).gains.passing!)
    economyOf(game).academy = 1
    expect(session.academyLevel).toBe(5)
  })

  it('防护训练在独立辅助槽中确定学习，不改变原球员或属性', () => {
    const player = createPlayerFromSeed(PLAYER_SEEDS[45])
    const session = createTrainingSession(player, 123)
    delete session.scheduleVersion
    session.candidate.skills = ['through_ball', 'safe_pass', 'one_touch', 'box_hunter']
    const attrs = structuredClone(session.candidate.attrs)
    const original = [...player.skills]
    const request = { kind: 'protection', focus: 'prevention' } as const
    expect(planTraining(session, request).gains).toEqual({})
    expect(performTrainingAction(session, request).ok).toBe(true)
    expect(session.candidate.skills).toContain('injury_prevention')
    expect(session.candidate.attrs).toEqual(attrs)
    expect(player.skills).toEqual(original)
    expect(session.action).toBe(1)
    expect(session.fatigue).toBe(8)
    session.pendingEventId = null
    expect(performTrainingAction(session, request).ok).toBe(false)
    expect(performTrainingAction(session, { kind: 'protection', focus: 'resilience' }).ok).toBe(true)
    expect(session.candidate.skills).toContain('injury_resilience')
  })

})
