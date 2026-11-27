import { describe, expect, it } from 'vitest'
import { buildAssistantDiagnosis, buildHighlightWindows, buildReview, extractMatchHighlights } from '../src/game/review.ts'
import type { MatchRecord } from '../src/game/types.ts'

function makeBaseRecord(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'm-test-1',
    seed: 12345,
    createdAt: Date.now(),
    seasonIndex: 1,
    durationSeconds: 900,
    isLeague: true,
    round: 3,
    homeId: 'ai_1',
    awayId: 'player',
    homeName: '蓝狮联',
    awayName: '青石',
    score: { home: 2, away: 1 },
    result: 'loss',
    stats: {
      home: { possession: 56, passes: 310, passesCompleted: 260, shots: 12, shotsOnTarget: 6, goals: 2, interceptions: 11, tackles: 14, fouls: 8, corners: 5, xg: 1.85, distance: 98, yellowCards: 1, redCards: 0 },
      away: { possession: 44, passes: 240, passesCompleted: 158, shots: 10, shotsOnTarget: 4, goals: 1, interceptions: 9, tackles: 12, fouls: 10, corners: 3, xg: 2.35, distance: 95, yellowCards: 2, redCards: 1 },
    },
    playerStats: [
      { playerId: 'p1', name: '苏思远', side: 'away', minutes: 90, passes: 34, passesCompleted: 22, shots: 5, goals: 1, tackles: 1, interceptions: 1, distance: 10.2, staminaLeft: 35, touches: 48, rating: 7.5 },
      { playerId: 'p2', name: '江知行', side: 'away', minutes: 90, passes: 40, passesCompleted: 28, shots: 1, goals: 0, tackles: 4, interceptions: 3, distance: 9.8, staminaLeft: 38, touches: 50, rating: 6.8 },
      { playerId: 'p3', name: '欧文', side: 'away', minutes: 90, passes: 38, passesCompleted: 24, shots: 2, goals: 0, tackles: 2, interceptions: 2, distance: 10.5, staminaLeft: 40, touches: 45, rating: 6.4 },
    ],
    skillStats: [
      { skillId: 'through_ball', playerId: 'p1', side: 'away', name: '苏思远', conditions: 5, applied: 3 },
    ],
    failureStats: [
      { reason: 'unrecognized', count: 6, examples: ['苏思远未识别右路空当'] },
    ],
    keyEvents: [
      { seq: 10, clock: 180, half: 1, type: 'goal', team: 'away', text: '苏思远禁区内推射破门！', goal: { playerId: 'p1', playerName: '苏思远', side: 'away', clock: 180, half: 1, origin: { x: 88, y: 34 }, distance: 12, bodyPart: 'right', technique: 'placed', situation: 'open', target: 'bottom_left' } },
      { seq: 22, clock: 390, half: 1, type: 'save', team: 'away', text: '苏思远单刀推射被门将神勇扑出！', shotChance: { type: 'clear_chance', label: '单刀', base: 0.5, floor: 0.78, ceiling: 0.92, goalBase: 0.45, distance: 11, angle: 0.5, pressure: 0.1, blockers: 0, reason: 'clear' } },
      { seq: 23, clock: 400, half: 1, type: 'miss', team: 'away', text: '欧文面对空门推偏！', shotChance: { type: 'open_goal', label: '空门', base: 0.7, floor: 0.9, ceiling: 0.96, goalBase: 0.68, distance: 8, angle: 0.8, pressure: 0, blockers: 0, reason: 'open' } },
      { seq: 35, clock: 580, half: 2, type: 'foul', team: 'away', card: 'red', text: '江知行战术犯规吃到红牌罚下！' },
      { seq: 40, clock: 620, half: 2, type: 'tactic', team: 'away', text: '比赛计划触发：切换至 4-4-1 收缩防守' },
      { seq: 51, clock: 700, half: 2, type: 'penalty', team: 'home', text: '蓝狮联获得点球机会' },
      { seq: 52, clock: 701, half: 2, type: 'goal', team: 'home', text: '蓝狮联主罚点球命中！' },
      { seq: 65, clock: 810, half: 2, type: 'goal', team: 'home', text: '蓝狮联反击再下一城！' },
    ],
    commentary: [],
    instructions: [],
    lineup: { formationId: '4-3-3', starters: [] } as unknown as MatchRecord['lineup'],
    opponentId: 'ai_1',
    ...overrides,
  }
}

describe('复盘高光时间轴提取与集锦窗口合并', () => {
  it('提取进球、单刀空门、红牌与变阵，并合并紧邻点球破门避免重复锚点', () => {
    const record = makeBaseRecord()
    const highlights = extractMatchHighlights(record)
    const kinds = highlights.map((h) => h.kind)
    // 180 goal, 390 chance, 400 chance, 580 red, 620 tactic, 701 goal (700 penalty deduplicated), 810 goal
    expect(kinds).toEqual(['goal', 'chance', 'chance', 'red', 'tactic', 'goal', 'goal'])
    expect(highlights[0].isOwn).toBe(true)
    expect(highlights[0].shortLabel).toContain('苏思远')
    expect(highlights[4].actionClip).toBe(false)

    const windows = buildHighlightWindows(highlights, 900)
    // 390 与 400 间隔仅 10 逻辑秒，前导 12 秒 + 后延 5.4 秒会自动合并为同一段连续高光！
    // 620 变阵不单独生成动作集锦窗；因此共有 180、390~400、580、701、810 共 5 段窗口
    expect(windows).toHaveLength(5)
    expect(windows[1].count).toBe(2)
    expect(windows[1].start).toBeLessThan(390)
    expect(windows[1].end).toBeGreaterThan(400)
  })

  it('0:0 无红牌无单刀时自动回退提取高威胁攻门，保证精彩集锦永远有镜头', () => {
    const zeroRecord = makeBaseRecord({
      score: { home: 0, away: 0 },
      result: 'draw',
      keyEvents: [
        { seq: 1, clock: 210, half: 1, type: 'shot', team: 'away', text: '远射试探', probabilities: { goal: 0.06 } },
        { seq: 2, clock: 540, half: 2, type: 'save', team: 'home', text: '禁区劲射被托出横梁', probabilities: { goal: 0.28 } },
      ],
    })
    const highlights = extractMatchHighlights(zeroRecord)
    expect(highlights).toHaveLength(2)
    expect(highlights.every((h) => h.actionClip)).toBe(true)
    expect(buildHighlightWindows(highlights, 900).length).toBeGreaterThan(0)
  })
})

describe('首席助教三句话战术诊断与客场视角修复', () => {
  it('按严重度精确提炼最多 3 条带可执行跳转建议的诊断，且正确识别客场我方视角', () => {
    const record = makeBaseRecord()
    const diag = buildAssistantDiagnosis(record)
    expect(diag).toHaveLength(3)
    // 优先级最高的三项应为：红牌少人 (100)、末段体能透支且 65' 后丢球 (92)、预期进球倒挂终结断层 (90)
    expect(diag[0].tag).toBe('纪律警报')
    expect(diag[0].cta?.nav).toBe('lineup')
    expect(diag[1].tag).toBe('体能隐患')
    expect(diag[2].tag).toBe('终结断层')
    expect(diag[2].cta?.nav).toBe('training')

    // buildReview 也应按客场我方（away）统计传球率，而非误读主队
    const legacyReview = buildReview(record)
    expect(legacyReview.some((r) => r.title === '传球成功率偏低')).toBe(true)
  })

  it('顺风赢球局仍输出技能兑现与本场核心正面复盘总结', () => {
    const winRecord = makeBaseRecord({
      homeId: 'player',
      awayId: 'ai_1',
      score: { home: 3, away: 0 },
      result: 'win',
      stats: {
        home: { possession: 58, passes: 320, passesCompleted: 280, shots: 14, shotsOnTarget: 8, goals: 3, interceptions: 12, tackles: 15, fouls: 5, corners: 6, xg: 2.6, distance: 100, yellowCards: 0, redCards: 0 },
        away: { possession: 42, passes: 210, passesCompleted: 165, shots: 5, shotsOnTarget: 2, goals: 0, interceptions: 8, tackles: 10, fouls: 9, corners: 2, xg: 0.45, distance: 94, yellowCards: 1, redCards: 0 },
      },
      playerStats: [
        { playerId: 'p1', name: '苏思远', side: 'home', minutes: 90, passes: 45, passesCompleted: 40, shots: 5, goals: 2, assists: 1, tackles: 2, interceptions: 1, distance: 10.4, staminaLeft: 68, touches: 62, rating: 9.1 },
      ],
      skillStats: [
        { skillId: 'through_ball', playerId: 'p1', side: 'home', name: '苏思远', conditions: 6, applied: 4 },
      ],
      failureStats: [],
      keyEvents: [],
    })
    const diag = buildAssistantDiagnosis(winRecord)
    expect(diag).toHaveLength(3)
    expect(diag.some((d) => d.tag === '技能兑现' && d.title.includes('穿线者'))).toBe(true)
    expect(diag.some((d) => d.tag === '本场核心' && d.title.includes('苏思远'))).toBe(true)
  })
})
