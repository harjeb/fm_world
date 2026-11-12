import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { previewTraining, startTraining } from '../src/game/actions.ts'
import { ACTIVITIES, GK_ONLY_ACTIVITIES, trainingDate, trainingOptions, type TrainingActivity } from '../src/game/training-calendar.ts'
import type { AttrKey } from '../src/game/types.ts'
import { mainAttrsFor } from '../src/game/scale.ts'
import { isGoalkeeper } from '../src/game/ca.ts'

/** 门将池允许出现的项目（固定日另有交流赛/队内比赛/休整）。 */
const GK_POOL_IDS = new Set([
  ...GK_ONLY_ACTIVITIES.map((item) => item.id),
  'goalkeeping', 'video', 'tactics', 'mentor', 'rest', 'exchange', 'match',
])

/** 门将项目不应该练的外场主属性（传球与镇定同时也是门将主属性，允许出现）。 */
const FIELD_ONLY_ATTRS: AttrKey[] = [
  'shooting', 'dribbling', 'tackling', 'strength', 'speed', 'acceleration',
  'firstTouch', 'heading', 'offBall', 'agility', 'endurance',
]

/** 门将候选实际生效的成长表。 */
function gkGains(activity: TrainingActivity): Partial<Record<AttrKey, number>> {
  return (activity.goalkeeperGains ?? activity.gains) ?? {}
}

function setupGk(seed = 1) {
  const game = createInitialGame(seed)
  const keeper = game.roster.find((player) => player.positions.GK > 0)!
  expect(isGoalkeeper(keeper)).toBe(true)
  expect(startTraining(game, keeper.id, seed).ok).toBe(true)
  return { game, keeper, session: game.training[keeper.id] }
}

describe('门将与外场扩充训练项目', () => {
  it('外场球员候选池覆盖 20 项属性课与 4 项功能课，且每时段保底至少 5 项属性课、不混入门将专属课', () => {
    expect(ACTIVITIES.filter((item) => !!item.gains).length).toBe(20)
    const game = createInitialGame(410)
    const field = game.roster.find((player) => player.positions.GK <= 0)!
    expect(startTraining(game, field.id, 7).ok).toBe(true)
    const session = game.training[field.id]
    expect(isGoalkeeper(session.candidate)).toBe(false)
    for (let action = 0; action < 30; action++) {
      session.action = action
      const date = trainingDate(action + 1)
      const options = trainingOptions(session)
      for (const option of options) {
        expect(option.id.startsWith('gk_')).toBe(false)
      }
      if (date.day !== 1 && date.day !== 5) {
        expect(options).toHaveLength(8)
        expect(options.filter((item) => !!item.gains).length).toBeGreaterThanOrEqual(5)
      }
    }
  })

  it('门将候选池包含 10 项门将专属课且每时段 8 项可选，成长只落在门将相关属性', () => {
    expect(GK_ONLY_ACTIVITIES).toHaveLength(10)
    const { session } = setupGk(1)
    const seen = new Set<string>()
    for (let seed = 1; seed <= 3; seed++) {
      session.scheduleSeed = seed * 17
      for (let action = 0; action < 30; action++) {
        session.action = action
        const date = trainingDate(action + 1)
        const options = trainingOptions(session)
        for (const option of options) {
          seen.add(option.id)
          expect(GK_POOL_IDS.has(option.id), `非门将项目：${option.id}`).toBe(true)
          // 门将池里不放位置/传承/伤病这类通用项目及纯外场训练。
          expect(['position', 'inherit', 'prevention', 'resilience', 'corners', 'passing', 'shooting', 'dribbling', 'defending', 'fitness', 'sprint', 'explosive', 'duel', 'pressing']).not.toContain(option.id)
          if (date.day === 1 && date.slot === '上午') continue
          for (const key of Object.keys(gkGains(option)) as AttrKey[]) {
            expect(FIELD_ONLY_ATTRS, `${option.id} 不该练 ${key}`).not.toContain(key)
          }
        }
      }
    }
    // 10 个门将专属项目都应该有机会出现。
    for (const item of GK_ONLY_ACTIVITIES) {
      expect(seen.has(item.id), `没有出现过 ${item.id}`).toBe(true)
    }
  })

  it('门将项目的预览与执行只给门将成长，外场项目在门将池里不可用', () => {
    const { game, keeper, session } = setupGk(1)
    let checked = 0
    for (let action = 0; action < 30 && checked < 3; action++) {
      session.action = action
      const options = trainingOptions(session)
      if (options.map((item) => item.id).includes('exchange')) continue
      const activity = options.find((item) => item.id.startsWith('gk_'))
      if (!activity) continue
      session.fatigue = 0
      const preview = previewTraining(game, keeper.id, { kind: 'activity', activityId: activity.id })
      expect(preview.error, `${activity.id}: ${preview.error}`).toBeUndefined()
      expect(preview.plan).toBeTruthy()
      for (const key of Object.keys(preview.plan!.gains) as AttrKey[]) {
        expect(FIELD_ONLY_ATTRS, `${activity.id} 预览出现外场属性 ${key}`).not.toContain(key)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
    session.action = 1 // 周一上午固定交流赛，下午才是随机项目
    session.fatigue = 0
    // 外场项目不在门将候选池里，直接请求会被拒绝。
    const rejected = previewTraining(game, keeper.id, { kind: 'activity', activityId: 'dribbling' })
    expect(rejected.error).toBeTruthy()
    expect(rejected.plan).toBeUndefined()
  })

  it('门将的固定日不变：周一上午交流赛，周五上午队内比赛、下午休整', () => {
    const { session } = setupGk(2)
    expect(mainAttrsFor(true)).toContain('reflexes')
    for (let action = 0; action < 30; action++) {
      session.action = action
      const date = trainingDate(action + 1)
      if (date.day === 1 && date.slot === '上午') expect(trainingOptions(session).map((item) => item.id)).toEqual(['exchange'])
      if (date.day === 5) expect(trainingOptions(session).map((item) => item.id)).toEqual([date.slot === '上午' ? 'match' : 'rest'])
    }
  })
})
