import { describe, expect, it } from 'vitest'
import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { createInitialGame } from '../src/game/state.ts'
import { ballPosition } from '../src/ui/match-timing.ts'

function match(seed: number) {
  const game = createInitialGame(71)
  const input = teamInputFromLineup(game.roster, game.lineup, { id: 'a', name: 'A', color: '#fff', accent: '#000' })
  return new MatchEngine({ seed, home: input, away: structuredClone(input), knockout: false, rulesVersion: 2 })
}

describe('回合密度与球的真实运动', () => {
  it('中位逼抢能主动靠近对手后场持球人，低位逼抢仍可保持阵型', () => {
    const engine = match(1)
    const carrier = engine.getTeam('home').players.find((player) => player.position === 'CB')!
    const away = engine.getTeam('away')
    const pick = () => (engine as unknown as { pickPresser: (team: typeof away, player: typeof carrier) => string | null }).pickPresser(away, carrier)
    expect(pick()).not.toBeNull()
    away.tactics.press = 'low'
    expect(pick()).toBeNull()
  })

  it('完整比赛动作增加但时钟仍是 90 分钟，后场不会一直原地倒脚', () => {
    for (const seed of [1, 2, 3]) {
      const engine = match(seed)
      let advanced = false
      while (!engine.state.finished) {
        engine.step()
        const owner = engine.state.teams.flatMap((team) => team.players).find((player) => player.id === engine.state.ball.ownerId)
        if (engine.state.clock < 180 && owner && (owner.side === 'home' ? owner.x : 100 - owner.x) > 45) advanced = true
      }
      expect(engine.state.clock).toBe(engine.state.durationSeconds)
      expect(engine.state.step).toBeGreaterThan(190)
      expect(advanced).toBe(true)
    }
  })

  it('逐步保存传球/盘带/射门路径，持球球坐标跟随球员；读档后轨迹仍一致', () => {
    const engine = match(1)
    let sawPass = false
    let sawDribble = false
    while (!engine.state.finished) {
      const before = engine.snapshot()
      engine.step()
      const motion = engine.state.ballMotion
      if (motion) {
        expect(motion.step).toBe(engine.state.step)
        if (motion.kind === 'pass' && before.ball.ownerId && !sawPass) {
          const passer = before.players.find((player) => player.id === before.ball.ownerId)!
          expect(motion.from.x).toBeCloseTo(passer.x)
          sawPass = true
        }
        if (motion.kind === 'dribble' && engine.state.ball.ownerId === before.ball.ownerId) sawDribble = true
        if (motion.kind !== 'dribble') expect(ballPosition(1, motion.from, motion.to, motion).x).toBeCloseTo(motion.to.x)
      }
      const owner = engine.state.teams.flatMap((team) => team.players).find((player) => player.id === engine.state.ball.ownerId)
      if (owner) expect(Math.hypot(owner.x - engine.state.ball.x, owner.y - engine.state.ball.y)).toBeLessThan(1)
      if (engine.state.step === 50) {
        const restored = MatchEngine.restore(structuredClone(engine.serialize()), false)
        expect(restored.state.ballMotion).toEqual(engine.state.ballMotion)
        expect(restored.simulate().score).toEqual(engine.simulate().score)
        break
      }
    }
    expect(sawPass).toBe(true)
    expect(sawDribble).toBe(true)
    // 进球会重置引擎球到中圈，但画面轨迹应先抵达球门，而非横穿球场。
    const full = match(1)
    let goalFound = false
    while (!full.state.finished) {
      const oldLog = full.state.log.length
      full.step()
      const goal = full.state.log.slice(oldLog).find((entry) => entry.type === 'goal')
      if (!goal) continue
      expect(full.state.ballMotion?.kind).toBe('shot')
      expect(full.state.ballMotion?.via ?? full.state.ballMotion?.from).toEqual(goal.goal?.origin)
      expect(full.state.ballMotion?.to.x).toBe(goal.team === 'home' ? 100 : 0)
      goalFound = true
      break
    }
    expect(goalFound).toBe(true)
  })
})
