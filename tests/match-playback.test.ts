import { describe, expect, it } from 'vitest'
import type { MatchPlaybackFrame, MatchPlaybackPose } from '../src/game/match/types.ts'
import { convexHull, MatchPlayback, samplePlaybackFrame } from '../src/game/match/visualization.ts'
import { matchTrackingRows, TRACKING_COLUMNS, trackingCsvRow } from '../src/game/match/tracking.ts'

const pose = (clock: number, x: number): MatchPlaybackPose => ({
  clock,
  players: [{ id: 'home:a', x, y: 20 }, { id: 'away:b', x: 60, y: 40 }],
  ball: { x, y: 20, ownerId: 'home:a', justReceived: false },
})
const clip = (step: number, from: number, to: number, x: number, endX: number): MatchPlaybackFrame => ({
  step, from: pose(from, x), to: pose(to, endX),
  motion: { step, kind: 'dribble', from: { x, y: 20 }, to: { x: endX, y: 20 } },
})

describe('数据驱动的比赛编舞与独立播放时钟', () => {
  it('跑位与带球可采样任意多帧，起终点不变，不靠增加判定回合', () => {
    const frame = clip(1, 0, 4, 10, 30)
    const positions = new Set<number>()
    for (let i = 0; i <= 240; i++) {
      const sample = samplePlaybackFrame(frame, i / 240)
      const player = sample.players[0]
      expect(sample.ball.x).toBe(player.x)
      expect(sample.ball.y).toBe(player.y)
      expect(sample.ball.ownerId).toBe('home:a')
      expect(player.x).toBeGreaterThanOrEqual(10)
      expect(player.x).toBeLessThanOrEqual(30)
      positions.add(player.x)
    }
    expect(positions.size).toBe(241)
    expect(samplePlaybackFrame(frame, -1).players[0].x).toBe(10)
    expect(samplePlaybackFrame(frame, 2).players[0].x).toBe(30)
  })

  it('相邻跑位共享速度切线，转向不越界，静止球员不会抖动', () => {
    const a = clip(1, 0, 2, 0, 10)
    const b = clip(2, 2, 6, 10, 30)
    const epsilon = 0.00001
    const speedBefore = (samplePlaybackFrame(a, 1, undefined, b).players[0].x - samplePlaybackFrame(a, 1 - epsilon, undefined, b).players[0].x) / (epsilon * 2)
    const speedAfter = (samplePlaybackFrame(b, epsilon, a).players[0].x - samplePlaybackFrame(b, 0, a).players[0].x) / (epsilon * 4)
    expect(speedBefore).toBeCloseTo(speedAfter, 3)
    expect(speedBefore).toBeCloseTo(5, 3)
    const turn = clip(3, 6, 9, 30, 20)
    for (let i = 0; i <= 100; i++) {
      const sample = samplePlaybackFrame(b, i / 100, a, turn)
      expect(sample.players[0].x).toBeGreaterThanOrEqual(10)
      expect(sample.players[0].x).toBeLessThanOrEqual(30)
      expect(sample.players[1]).toMatchObject({ x: 60, y: 40 })
    }
  })

  it('传球有处理球、独立飞行和接球三个阶段；高球不改变平面落点', () => {
    const frame = clip(1, 0, 4, 10, 20)
    frame.to.ball = { x: 60, y: 40, ownerId: 'away:b', justReceived: true }
    frame.motion = { step: 1, kind: 'pass', from: { x: 10, y: 20 }, to: { x: 60, y: 40 } }
    const waiting = samplePlaybackFrame(frame, 0.1)
    expect(waiting.ball.ownerId).toBe('home:a')
    expect(waiting.ball.x).toBe(waiting.players[0].x)
    const flying = samplePlaybackFrame(frame, 0.6)
    expect(flying.ball.ownerId).toBeNull()
    expect(flying.airborne).toBe(true)
    expect(flying.ball.height).toBeGreaterThan(0)
    const landed = samplePlaybackFrame(frame, 1)
    expect(landed.ball).toEqual({ x: 60, y: 40, height: 0, ownerId: 'away:b' })
    expect(landed.ball.x).toBe(landed.players[1].x)
  })

  it('传中接射门经由触球点，进球先飞到球门；之后才切中圈重开', () => {
    const goal = clip(1, 0, 4, 55, 68)
    goal.goal = true
    goal.to.ball = { x: 100, y: 32, ownerId: null, justReceived: false }
    goal.motion = { step: 1, kind: 'shot', from: { x: 55, y: 20 }, via: { x: 88, y: 32 }, to: { x: 100, y: 32 } }
    const arrival = 0.94
    const distance = Math.hypot(45, 12)
    const flight = Math.max(0.2, Math.min(0.78, distance / 32 / 4))
    const contact = samplePlaybackFrame(goal, arrival - flight + flight * 0.65)
    expect(contact.ball.x).toBeCloseTo(88)
    expect(contact.ball.y).toBeCloseTo(32)
    expect(samplePlaybackFrame(goal, 1).ball).toMatchObject({ x: 100, y: 32, ownerId: null })
    const playback = new MatchPlayback(goal.from, 0, 0)
    playback.enqueue([goal], () => 1000, 0)
    expect(playback.sample(1000).ball.x).toBe(100)
    expect(playback.sample(5000).ball.x).toBe(100)
    const kickoff = clip(2, 4, 10, 50, 50)
    kickoff.restart = 'kickoff'
    playback.enqueue([kickoff], () => 1000, 5000)
    expect(playback.sample(5000).ball.x).toBe(50)
  })

  it('网络一次补来多步时完整入队，同一条SSE重复到达不重启动画', () => {
    const a = clip(1, 0, 4, 10, 20)
    const b = clip(2, 4, 8, 20, 30)
    const c = clip(3, 8, 12, 30, 40)
    const playback = new MatchPlayback(a.from, 0, 0)
    playback.enqueue([a], () => 1000, 0)
    expect(playback.sample(500).players[0].x).toBeCloseTo(15)
    playback.enqueue([a, b, c], () => 1000, 500)
    playback.enqueue([a, b, c], () => 1000, 500)
    expect(playback.sample(1000).step).toBe(2)
    expect(playback.sample(1500).players[0].x).toBeCloseTo(25)
    expect(playback.sample(2500).players[0].x).toBeCloseTo(35)
    expect(playback.sample(3000).players[0].x).toBe(40)
    expect(playback.pending).toBe(false)
  })

  it('网络后来补入反向动作，或教练重算未来，不会改变当前同一时刻的位置', () => {
    const a = clip(1, 0, 4, 0, 10)
    const b = clip(2, 4, 8, 10, 0)
    const playback = new MatchPlayback(a.from, 0, 0)
    playback.enqueue([a], () => 1000, 0)
    const halfway = playback.sample(500)
    expect(halfway.players[0].x).toBe(5)
    playback.enqueue([b], () => 1000, 500)
    expect(playback.sample(500)).toEqual(halfway)
    playback.setPlan([a, clip(2, 4, 8, 10, 100)])
    expect(playback.sample(500)).toEqual(halfway)
    expect(playback.sample(1000).players[0].x).toBe(10)
  })

  it('播放倍速 = 这一段动作的比赛秒 / 现实秒，暂停时为 0', () => {
    const playback = new MatchPlayback(pose(0, 10), 0, 0)
    // 4 个比赛秒安排 2 秒放完 → 2 倍速。
    playback.enqueue([clip(1, 0, 4, 10, 30)], () => 2000, 0)
    expect(playback.rate()).toBeCloseTo(2, 5)
    playback.setPlaying(false, 0)
    expect(playback.rate()).toBe(0)
    playback.setPlaying(true, 0)
    expect(playback.rate()).toBeCloseTo(2, 5)
    // 一步 4 秒放 2.7 秒（正常档）→ 约 1.48 倍。
    const normal = new MatchPlayback(pose(0, 10), 0, 0)
    normal.enqueue([clip(1, 0, 4, 10, 30)], () => 2700, 0)
    expect(normal.rate()).toBeCloseTo(4 / 2.7, 4)
  })

  it('暂停冻结在当前帧，继续时不跳到终点，刷新页面元素不消费时间', () => {
    const a = clip(1, 0, 4, 10, 20)
    const playback = new MatchPlayback(a.from, 0, 0)
    playback.enqueue([a], () => 1000, 0)
    playback.setPlaying(false, 400)
    const stopped = playback.sample(400)
    expect(stopped.players[0].x).toBeCloseTo(14)
    expect(playback.sample(9000)).toEqual(stopped)
    playback.setPlaying(true, 9000)
    expect(playback.sample(9100).players[0].x).toBeCloseTo(15)
    expect(playback.sample(9100).players[0].x).toBeCloseTo(15)
  })

  it('长期断线缺失回合时就地切入，不让球横穿几十米去补缺失轨迹', () => {
    const a = clip(1, 0, 4, 10, 20)
    const missing = clip(15, 56, 60, 70, 80)
    const playback = new MatchPlayback(a.from, 0, 0)
    playback.enqueue([a], () => 1000, 0)
    playback.sample(500)
    playback.enqueue([missing], () => 1000, 500)
    expect(playback.sample(500).players[0].x).toBe(70)
    expect(playback.sample(1000).players[0].x).toBeCloseTo(75)
  })

  it('不同渲染帧率在相同时刻得到完全相同位置', () => {
    const a = clip(1, 0, 4, 10, 20)
    const dense = new MatchPlayback(a.from, 0, 0)
    const sparse = new MatchPlayback(a.from, 0, 0)
    dense.enqueue([a], () => 1000, 0)
    sparse.enqueue([a], () => 1000, 0)
    for (let now = 0; now < 700; now += 1000 / 60) dense.sample(now)
    expect(dense.sample(700)).toEqual(sparse.sample(700))
  })

  it('战术包络包含外缘点但不修改输入，不显示内部点', () => {
    const points = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }]
    const before = structuredClone(points)
    expect(convexHull(points)).toHaveLength(4)
    expect(convexHull(points)).not.toContainEqual({ x: 5, y: 5 })
    expect(points).toEqual(before)
  })
})

describe('soccerAnimate 25fps tracking-data 适配', () => {
  it('输出固定25fps、每帧全员加球、Metrica tidy字段和米制坐标', () => {
    const frame = clip(1, 0, 4, 10, 30)
    const roster = [
      { id: 'home:a', side: 'home' as const, number: 9, position: 'ST' as const },
      { id: 'away:b', side: 'away' as const, number: 1, position: 'GK' as const },
    ]
    const rows = [...matchTrackingRows([frame], roster, 900, { toSeconds: 2 })]
    expect(rows).toHaveLength(51 * 3)
    expect(new Set(rows.map((row) => row.frame)).size).toBe(51)
    for (const row of rows) {
      expect(row.time * 25).toBeCloseTo(row.frame)
      expect(row.second).toBe(Math.floor(row.time))
      expect(row.x).toBeGreaterThanOrEqual(0)
      expect(row.x).toBeLessThanOrEqual(105)
      expect(row.y).toBeGreaterThanOrEqual(0)
      expect(row.y).toBeLessThanOrEqual(68)
    }
    expect(rows[0]).toMatchObject({ player: '9', team: 'home', x: 10.5, y: 46.75, is_gk: false })
    expect(rows[1]).toMatchObject({ player: '1', team: 'away', is_gk: true })
    expect(rows[2]).toMatchObject({ player: '', team: 'ball', is_gk: false })
    expect(trackingCsvRow(rows[0]).split(',')).toHaveLength(TRACKING_COLUMNS.length)
    expect(rows.find((row) => row.time === 1 && row.team === 'home')!.dx).toBeGreaterThan(0)
  })

  it('片段截取不会重新从0计时，空比赛和无效时长不产生伪造数据', () => {
    const frame = clip(1, 0, 4, 10, 30)
    const roster = [{ id: 'home:a', side: 'home' as const, number: 9, position: 'ST' as const }, { id: 'away:b', side: 'away' as const, number: 2, position: 'CB' as const }]
    const rows = [...matchTrackingRows([frame], roster, 900, { fromSeconds: 1, toSeconds: 2 })]
    expect(rows[0].time).toBe(1)
    expect(rows[0].frame).toBe(25)
    expect(rows[0].dx).toBeGreaterThan(0)
    expect([...matchTrackingRows([], roster, 900)]).toEqual([])
    expect([...matchTrackingRows([frame], roster, 0)]).toEqual([])
  })
})
