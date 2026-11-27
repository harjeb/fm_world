import { describe, expect, it } from 'vitest'
import { buildChatSharedMatch, type ChatSharedMatch } from '../src/game/chat.ts'
import {
  buildHighlight3DClipsFromRecord,
  buildHighlight3DClipsFromSharedMatch,
  goalOriginTo3D,
  goalTargetTo3D,
  sampleHighlight3DFrame,
} from '../src/game/highlight-3d.ts'
import { HALF, HEIGHT, R, SPOT } from '../src/game/penalty/practice.ts'
import type { MatchRecord } from '../src/game/types.ts'

function baseTeamStats(overrides: Partial<MatchRecord['stats']['home']> = {}): MatchRecord['stats']['home'] {
  return {
    possession: 50,
    shots: 8,
    shotsOnTarget: 4,
    goals: 2,
    xg: 1.6,
    passes: 280,
    passesCompleted: 230,
    interceptions: 8,
    tackles: 11,
    fouls: 6,
    corners: 4,
    distance: 96,
    yellowCards: 1,
    redCards: 0,
    ...overrides,
  }
}

function makeMockRecord(): MatchRecord {
  return {
    id: 'rec-hl3d-test',
    createdAt: Date.now(),
    seed: 20261126,
    isLeague: true,
    round: 7,
    durationSeconds: 900,
    homeId: 'player',
    homeName: '星海竞技',
    awayId: 'opp-1',
    awayName: '皇家北境',
    opponentId: 'opp-1',
    score: { home: 3, away: 1 },
    result: 'win',
    stats: {
      home: baseTeamStats({ goals: 3, shots: 12, shotsOnTarget: 7, xg: 2.35 }),
      away: baseTeamStats({ goals: 1, shots: 6, shotsOnTarget: 3, xg: 0.88 }),
    },
    goalDetails: [
      {
        clock: 160,
        half: 1,
        side: 'home',
        playerId: 'p-st',
        playerName: '林风',
        assistId: 'p-am',
        assistName: '周澈',
        origin: { x: 86, y: 26 },
        distance: 15.2,
        bodyPart: 'right',
        technique: 'placed',
        situation: 'open',
        target: 'bottom_right',
      },
      {
        clock: 390,
        half: 1,
        side: 'away',
        playerId: 'a-fk',
        playerName: '索萨',
        origin: { x: 21, y: 38 },
        distance: 22.4,
        bodyPart: 'left',
        technique: 'placed',
        situation: 'free_kick',
        target: 'top_left',
      },
      {
        clock: 620,
        half: 2,
        side: 'home',
        playerId: 'p-cb',
        playerName: '赵岳',
        assistId: 'p-rw',
        assistName: '唐翼',
        origin: { x: 92, y: 31 },
        distance: 8.5,
        bodyPart: 'head',
        technique: 'header',
        situation: 'open',
        target: 'top_right',
      },
      {
        clock: 810,
        half: 2,
        side: 'home',
        playerId: 'p-st',
        playerName: '林风',
        origin: { x: 89, y: 32 },
        distance: 11,
        bodyPart: 'right',
        technique: 'power',
        situation: 'penalty',
        target: 'bottom_left',
      },
    ],
    keyEvents: [
      {
        seq: 12,
        clock: 280,
        half: 1,
        team: 'away',
        type: 'save',
        text: '卡洛斯禁区前沿重炮轰门，被陈门神单掌托出横梁！',
        shotChance: {
          type: 'clear_chance',
          label: '良机',
          base: 0.42,
          floor: 0.25,
          ceiling: 0.85,
          goalBase: 0.36,
          distance: 16,
          angle: 0.45,
          pressure: 0.2,
          blockers: 0,
          reason: 'clear',
        },
      },
      {
        seq: 29,
        clock: 710,
        half: 2,
        team: 'home',
        type: 'miss',
        text: '林风禁区右侧小角度劲射击中门柱弹出！',
        shotChance: {
          type: 'normal',
          label: '常规射门',
          base: 0.18,
          floor: 0.1,
          ceiling: 0.55,
          goalBase: 0.14,
          distance: 13,
          angle: 0.35,
          pressure: 0.4,
          blockers: 1,
          reason: 'regular',
        },
      },
    ],
    commentary: [],
    instructions: [],
    skillStats: [],
    failureStats: [],
    lineup: { formationId: '4-3-3', starters: [] } as unknown as MatchRecord['lineup'],
    playerStats: [
      {
        playerId: 'p-gk',
        sourceId: 'p-gk',
        name: '陈门神',
        side: 'home',
        minutes: 90,
        touches: 24,
        passes: 18,
        passesCompleted: 16,
        shots: 0,
        goals: 0,
        assists: 0,
        xg: 0,
        xgConceded: 0.88,
        saves: 4,
        claims: 2,
        tackles: 0,
        interceptions: 0,
        distance: 4.8,
        staminaLeft: 82,
        rating: 7.4,
      },
    ],
  }
}

describe('3D Highlight Theater Synthesizer & Frame Sampler', () => {
  it('maps 2D pitch coordinates and target zones into valid 3D half-pitch metres for both sides', () => {
    const penHome = goalOriginTo3D('home', { x: 89, y: 32 }, 'penalty')
    const penAway = goalOriginTo3D('away', { x: 11, y: 32 }, 'penalty')
    expect(penHome).toEqual({ x: 0, z: SPOT })
    expect(penAway).toEqual({ x: 0, z: SPOT })

    // Home attacks x=100; y<32 is left flank (-x), y>32 is right flank (+x)
    const homeLeft = goalOriginTo3D('home', { x: 85, y: 20 }, 'open')
    expect(homeLeft.x).toBeLessThan(-10)
    expect(homeLeft.z).toBeGreaterThan(14)

    // Away attacks x=0; y>32 is away's left flank (-x)
    const awayLeft = goalOriginTo3D('away', { x: 15, y: 44 }, 'open')
    expect(awayLeft.x).toBeLessThan(-10)
    expect(awayLeft.z).toBeCloseTo(homeLeft.z, 1)

    // Goal target stays cleanly inside posts & crossbar for goals, and touches woodwork for frame hits
    const goalPt = goalTargetTo3D('top_right', 12345, 'goal')
    expect(Math.abs(goalPt.x)).toBeLessThan(HALF - R)
    expect(goalPt.y).toBeGreaterThan(1.5)
    expect(goalPt.y).toBeLessThan(HEIGHT - R)

    const framePt = goalTargetTo3D('top_left', 12345, 'frame')
    expect(framePt.y).toBeGreaterThan(HEIGHT - R)
  })

  it('synthesizes chronological goals, headers, free-kicks, penalties, saves, and woodwork without requiring 2D engineState', () => {
    const rec = makeMockRecord()
    expect(rec.hasReplay).toBeUndefined()

    const clips = buildHighlight3DClipsFromRecord(rec, { home: '#2474ff', away: '#e63946' })
    expect(clips.length).toBe(6) // 4 goals + 1 save + 1 woodwork

    const kinds = clips.map((c) => c.kind)
    expect(kinds).toContain('goal')
    expect(kinds).toContain('freekick_goal')
    expect(kinds).toContain('header_goal')
    expect(kinds).toContain('penalty_goal')
    expect(kinds).toContain('save')
    expect(kinds).toContain('woodwork')

    // Chronological order & live score progression
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].clock).toBeGreaterThanOrEqual(clips[i - 1].clock)
    }
    expect(clips[0].scoreBefore).toEqual({ home: 0, away: 0 })
    expect(clips[0].scoreAfter).toEqual({ home: 1, away: 0 })
    expect(clips.at(-1)!.scoreAfter).toEqual({ home: 3, away: 1 })

    // Home keeper name extracted from playerStats
    const awaySaveClip = clips.find((c) => c.kind === 'save')!
    expect(awaySaveClip.keeper.name).toBe('陈门神')
    expect(awaySaveClip.attackTeam.name).toBe('皇家北境')
    expect(awaySaveClip.defendTeam.name).toBe('星海竞技')
  })

  it('provides a fallback dramatic highlight clip even for an empty 0:0 legacy match', () => {
    const emptyRec: MatchRecord = {
      ...makeMockRecord(),
      score: { home: 0, away: 0 },
      result: 'draw',
      goalDetails: [],
      keyEvents: [],
    }
    const clips = buildHighlight3DClipsFromRecord(emptyRec, { home: '#11aa66', away: '#ffbb22' })
    expect(clips.length).toBe(1)
    expect(clips[0].isGoal).toBe(false)
    expect(clips[0].scoreAfter).toEqual({ home: 0, away: 0 })
  })

  it('synthesizes 3D clips from both geometry-rich and legacy ChatSharedMatch payloads', () => {
    const rec = makeMockRecord()
    const shared = buildChatSharedMatch(rec, { homeColor: '#2474ff', awayColor: '#e63946' })
    expect(shared.goals[0].origin).toEqual({ x: 86, y: 26 })
    expect(shared.goals[2].bodyPart).toBe('head')

    const richClips = buildHighlight3DClipsFromSharedMatch(shared, { home: '#2474ff', away: '#e63946' })
    expect(richClips.length).toBe(4)
    expect(richClips[1].kind).toBe('freekick_goal')
    expect(richClips[2].kind).toBe('header_goal')
    expect(richClips[3].kind).toBe('penalty_goal')

    // Legacy minimal ChatSharedMatch without origin / bodyPart / target
    const legacyShared: ChatSharedMatch = {
      ...shared,
      goals: [
        { minute: "23'", playerName: '老存档射手', side: 'home', assistName: '中场大脑' },
        { minute: "88'", playerName: '绝平奇兵', side: 'away' },
      ],
    }
    const legacyClips = buildHighlight3DClipsFromSharedMatch(legacyShared, { home: '#2474ff', away: '#e63946' })
    expect(legacyClips.length).toBe(2)
    expect(legacyClips[0].assister?.name).toBe('中场大脑')
    expect(legacyClips[1].scoreAfter).toEqual({ home: 1, away: 1 })
  })

  it('samples continuous 3-phase world frames (lead_in -> flight -> impact) with wall jump, net hit, and celebration', () => {
    const rec = makeMockRecord()
    const clips = buildHighlight3DClipsFromRecord(rec, { home: '#2474ff', away: '#e63946' })

    const openGoal = clips.find((c) => c.kind === 'goal')!
    const fLead = sampleHighlight3DFrame(openGoal, 0.25)
    expect(fLead.phase).toBe('lead_in')
    expect(fLead.assister.visible).toBe(true)
    expect(fLead.bannerActive).toBe(false)
    expect(fLead.liveScore).toEqual(openGoal.scoreBefore)
    expect(fLead.ball.y).toBeGreaterThanOrEqual(R - 1e-4)

    const fMid = sampleHighlight3DFrame(openGoal, openGoal.leadInSec + openGoal.flightSec * 0.5)
    expect(fMid.phase).toBe('flight')
    expect(fMid.trail.length).toBeGreaterThanOrEqual(2)
    expect(fMid.ball.y).toBeGreaterThanOrEqual(R)

    const fImpact = sampleHighlight3DFrame(openGoal, openGoal.leadInSec + openGoal.flightSec + 0.5)
    expect(fImpact.phase).toBe('impact')
    expect(fImpact.bannerActive).toBe(true)
    expect(fImpact.liveScore).toEqual(openGoal.scoreAfter)
    expect(fImpact.netHit).not.toBeNull()
    expect(fImpact.striker.mode).toBe('celebrate')

    // Free kick spawns 4 jumping wall defenders
    const fkGoal = clips.find((c) => c.kind === 'freekick_goal')!
    const fkJump = sampleHighlight3DFrame(fkGoal, fkGoal.leadInSec + 0.25)
    expect(fkJump.defenders.length).toBe(4)
    expect(fkJump.defenders[0].mode).toBe('wall')
    expect(fkJump.defenders[0].lift).toBeGreaterThan(0.1)

    // Header goal lifts striker into aerial jump
    const headerGoal = clips.find((c) => c.kind === 'header_goal')!
    const headerPeak = sampleHighlight3DFrame(headerGoal, headerGoal.leadInSec - 0.02)
    expect(headerPeak.striker.mode).toBe('header_jump')
    expect(headerPeak.striker.lift).toBeGreaterThan(0.4)
  })
})
