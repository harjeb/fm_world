import { beforeEach, describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { previewTraining, startTrainingWithSupport, trainingAction } from '../src/game/actions.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { EVENTS } from '../src/game/data/events.ts'

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() },
  })
}

describe('培养预览不泄露品质', () => {
  beforeEach(stubLocalStorage)

  it('hideQuality 的预览对任何种子都按“成功”档算，真实结算仍然掷品质', () => {
    const labels = new Set<string>()
    const previews = new Set<string>()
    for (let seed = 1; seed <= 40; seed++) {
      const game = createInitialGame(500 + seed)
      const main = game.roster.find((player) => player.positions.GK === 0)!
      expect(startTrainingWithSupport(game, main.id, seed).ok).toBe(true)
      const session = game.training[main.id]
      session.flags = EVENTS.map((event) => event.id)
      session.lastEventAction = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
      session.eventCounts = Object.fromEntries(EVENTS.map((event) => [event.id, 1000]))
      session.action = 2 // 周二上午：有普通课程可选
      session.fatigue = 75 // 低体力：品质有机会是失败/一般
      const option = trainingOptions(session).find((item) => item.cost && item.gains)
      if (!option) continue
      const request = { kind: 'activity', activityId: option.id } as any
      const hidden = previewTraining(game, main.id, request, true).plan
      expect(hidden?.quality?.label).toBe('成功')
      previews.add(`${option.id}:${JSON.stringify(hidden?.gains)}`)
      const real = previewTraining(game, main.id, request).plan
      labels.add(real!.quality!.label)
      // 真实结算的日志品质与不隐藏的预览一致。
      expect(trainingAction(game, main.id, request).ok).toBe(true)
      expect(game.training[main.id].log.find((entry) => entry.kind === 'action' && entry.action === 3)!.title).toContain(`（${real!.quality!.label}）`)
    }
    // 真实品质确实会变（不是恒定“成功”），而隐藏预览不随品质变化。
    expect(labels.size).toBeGreaterThan(1)
  })
})
