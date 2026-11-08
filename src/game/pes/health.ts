/**
 * 自由运行的健康检查（计划 6.6 的“做对了的”那张表）：不接结算，只看运动层和站位层有没有问题。
 *
 *   - 越界：球员有没有跑出场地；
 *   - 扎堆：队友之间距离 < 2 米的比例；
 *   - 球卡死：无人控球且球几乎不动超过 4 秒；
 *   - 死球时间占比；
 *   - 阵型形状：外场球员的纵深和宽度，分“我方控球 / 对方控球”两种情况；
 *   - 跑动、控球、射门等统计。
 *
 * 每一帧调用 `observe(match)`；`report()` 给出汇总。
 */
import type { PesMatch } from './sim.ts'
import type { PesPlayer, TeamIndex } from './spec.ts'

export interface ShapeStat {
  /** 外场球员沿进攻方向的纵深（最前 − 最后，米）的均值 */
  depth: number
  /** 外场球员横向宽度（米）的均值 */
  width: number
  /** 外场球员沿进攻方向的平均位置（离本方球门线的米数）；越大阵线越高 */
  meanLx: number
  /** 最后一名外场球员（防线）沿进攻方向的位置（离本方球门线的米数） */
  backLineLx: number
  samples: number
}

export interface TeamHealth {
  /** 我方控球时的阵型 */
  attacking: ShapeStat
  /** 对方控球时的阵型 */
  defending: ShapeStat
}

export interface HealthReport {
  frames: number
  /** 模拟秒数（不含死球等待） */
  seconds: number
  /** 球员越出球场的球员·帧数，必须为 0 */
  outOfBounds: number
  /** 外场队友两两距离 < 2 米的比例 */
  stackRatio: number
  /** 球几乎不动、无人控制、非死球状态超过 4 秒的次数 */
  stuckBall: number
  /** 死球（开球 / 界外球 / 角球等）帧数占比 */
  deadBallRatio: number
  teams: [TeamHealth, TeamHealth]
}

const emptyShape = () => ({ depth: 0, width: 0, meanLx: 0, backLineLx: 0, samples: 0 })

export class FreeRunMonitor {
  private frames = 0
  private playFrames = 0
  private deadFrames = 0
  private outOfBounds = 0
  private pairSamples = 0
  private pairClose = 0
  private stuck = 0
  private stuckRun = 0
  private stuckCounted = false
  private shape: [ShapeStat, ShapeStat][] = [[emptyShape(), emptyShape()], [emptyShape(), emptyShape()]]

  /** 每 `every` 帧取一次阵型和扎堆样本（越界和死球每帧都查）。 */
  constructor(private readonly every = 6) {}

  observe(m: PesMatch): void {
    this.frames++
    const P = m.spec
    const b = m.ball
    if (m.phase === 'kickoff' || m.phase === 'restart') this.deadFrames++
    else this.playFrames++

    for (const p of m.players) {
      if (Math.abs(p.pos.x) > P.HL || Math.abs(p.pos.y) > P.HW) this.outOfBounds++
    }

    // 球卡死
    const slow = b.owner < 0 && !b.frozen && Math.hypot(b.vx, b.vy) < 0.05 && b.z < 0.05
    if (slow) {
      this.stuckRun++
      if (this.stuckRun * P.DT > 4 && !this.stuckCounted) {
        this.stuck++
        this.stuckCounted = true
      }
    } else {
      this.stuckRun = 0
      this.stuckCounted = false
    }

    if (this.frames % this.every !== 0) return

    // 扎堆：外场队友两两
    for (const t of m.teams) {
      const out = t.players.filter((p) => p.slot !== 0)
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          this.pairSamples++
          if (Math.hypot(out[i].pos.x - out[j].pos.x, out[i].pos.y - out[j].pos.y) < 2) this.pairClose++
        }
      }
    }

    // 阵型：只在有人持球的开放比赛里取
    if (m.phase !== 'play' || b.owner < 0) return
    const owner: PesPlayer = m.players[b.owner]
    for (const ti of [0, 1] as TeamIndex[]) {
      const t = m.teams[ti]
      const out = t.players.filter((p) => p.slot !== 0)
      if (!out.length) continue
      const lxs = out.map((p) => p.pos.x * t.dir + P.HL)
      const ys = out.map((p) => p.pos.y)
      const stat = this.shape[ti][owner.ti === ti ? 0 : 1]
      stat.samples++
      stat.depth += Math.max(...lxs) - Math.min(...lxs)
      stat.width += Math.max(...ys) - Math.min(...ys)
      stat.meanLx += lxs.reduce((s, v) => s + v, 0) / lxs.length
      stat.backLineLx += Math.min(...lxs)
    }
  }

  report(m: PesMatch): HealthReport {
    const avg = (s: ShapeStat): ShapeStat => s.samples === 0 ? s : {
      depth: s.depth / s.samples, width: s.width / s.samples, meanLx: s.meanLx / s.samples, backLineLx: s.backLineLx / s.samples, samples: s.samples,
    }
    return {
      frames: this.frames,
      seconds: this.playFrames * m.spec.DT,
      outOfBounds: this.outOfBounds,
      stackRatio: this.pairSamples ? this.pairClose / this.pairSamples : 0,
      stuckBall: this.stuck,
      deadBallRatio: this.frames ? this.deadFrames / this.frames : 0,
      teams: [
        { attacking: avg(this.shape[0][0]), defending: avg(this.shape[0][1]) },
        { attacking: avg(this.shape[1][0]), defending: avg(this.shape[1][1]) },
      ],
    }
  }
}

/** 把一场比赛跑完并返回健康报告。 */
export function runWithMonitor(m: PesMatch, every = 6): HealthReport {
  const monitor = new FreeRunMonitor(every)
  while (m.phase !== 'end') {
    m.step()
    monitor.observe(m)
  }
  return monitor.report(m)
}
