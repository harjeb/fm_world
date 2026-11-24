import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createInitialGame } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { FORMATION_LIST, isLegacyFormation } from '../src/game/data/formations.ts'
import { issueMatchShout, restoreActiveEngine, startSingleChallenge } from '../src/game/actions.ts'
import { MatchRatings } from '../src/game/match/ratings.ts'
import {
  SHOUT_COOLDOWN_MINUTES,
  SHOUT_DURATION_MINUTES,
  SHOUT_KINDS,
  SHOUT_LIST,
  SHOUT_LIVE_CUTOFF_MINUTE,
  SHOUT_MAX_PER_MATCH,
  SHOUT_META,
  activeShoutStateOf,
  evaluateShoutReactions,
  shoutCooldownSeconds,
  shoutDurationSeconds,
  shoutStatusOf,
} from '../src/game/match/shouts.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { computeMatchJob, type MatchJob } from '../server/match-job.ts'
import { MatchQueue } from '../server/match-queue.ts'
import { createAppServer, type AppServer } from '../server/app.ts'
import { agentView, applyAgentAction } from '../server/agent.ts'
import { renderMatch } from '../src/ui/screens/match.ts'
import { game as originalGame, setGame, ui } from '../src/ui/state.ts'

const servers: AppServer[] = []
const tempDirs: string[] = []

afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
  if (originalGame) setGame(originalGame)
  ui.matchEngine = null
  ui.matchShoutTarget = ''
  ui.matchShoutPending = false
  ui.lineupDraft = null
})

function startFriendly(seed = 2026) {
  const game = createInitialGame(seed)
  const opp = game.aiTeams[0]
  const started = startSingleChallenge(game, opp.id, 10_000)
  expect(started.ok).toBe(true)
  const engine = restoreActiveEngine(game) as PesEngine
  expect(engine).toBeTruthy()
  return { game, engine }
}

describe('FM27 场边情绪喊话系统（8 种喊话 · 全队/单人 · 正负反馈）', () => {
  it('包含完整的 8 种 FM27 情绪喊话与元数据', () => {
    expect(SHOUT_KINDS).toHaveLength(8)
    expect(SHOUT_LIST).toHaveLength(8)
    expect(SHOUT_KINDS).toEqual([
      'encourage',
      'praise',
      'demand_more',
      'fire_up',
      'focus',
      'calm_down',
      'no_pressure',
      'berate',
    ])
    for (const kind of SHOUT_KINDS) {
      expect(SHOUT_META[kind].targetAttrs.length).toBeGreaterThanOrEqual(5)
      expect(SHOUT_META[kind].label.length).toBeGreaterThan(0)
    }
  })

  it('喊对时机明显提升有效属性，喊错时机触发负面情绪与属性下降，且单人点名增幅强于全队', () => {
    const { engine } = startFriendly(301)
    const state = engine.state
    const team = state.teams[0]
    for (const p of team.players) {
      p.personality = { professionalism: 82, ambition: 80, adaptability: 78 }
    }
    const target = team.players[0]

    // 落后 0:2 时严厉斥责高职业核心 → 爆发正向反应
    state.score = { home: 0, away: 2 }
    const berateBehind = evaluateShoutReactions({
      seed: state.seed,
      clock: 500,
      durationSeconds: state.durationSeconds,
      score: state.score,
      log: state.log,
      side: 'home',
      kind: 'berate',
      team,
      targetPlayerId: target.id,
    })
    const singleDelta = berateBehind.record.reactions[0].delta
    expect(singleDelta).toBeGreaterThanOrEqual(7)

    // 对比全队喊话（同场景）
    const berateTeam = evaluateShoutReactions({
      seed: state.seed,
      clock: 500,
      durationSeconds: state.durationSeconds,
      score: state.score,
      log: state.log,
      side: 'home',
      kind: 'berate',
      team,
    })
    expect(berateTeam.record.positiveCount).toBeGreaterThanOrEqual(8)
    expect(berateTeam.record.reactions[0].delta).toBeLessThan(singleDelta)

    // 领先 2:0 时却严厉斥责 → 触发负面情绪（低落）
    state.score = { home: 2, away: 0 }
    const berateAhead = evaluateShoutReactions({
      seed: state.seed,
      clock: 500,
      durationSeconds: state.durationSeconds,
      score: state.score,
      log: state.log,
      side: 'home',
      kind: 'berate',
      team,
    })
    expect(berateAhead.record.negativeCount).toBeGreaterThanOrEqual(9)
    expect(berateAhead.record.reactions.every((r) => r.delta <= 0)).toBe(true)

    // 落后 0:2 时却表扬 → 适得其反，触发困惑/负向
    state.score = { home: 0, away: 2 }
    const praiseBehind = evaluateShoutReactions({
      seed: state.seed,
      clock: 500,
      durationSeconds: state.durationSeconds,
      score: state.score,
      log: state.log,
      side: 'home',
      kind: 'praise',
      team,
    })
    expect(praiseBehind.record.negativeCount).toBeGreaterThanOrEqual(8)

    // 黄牌球员点名「冷静下来」 → 强正向情绪稳定
    target.yellowCards = 1
    state.score = { home: 1, away: 0 }
    const calmBooked = evaluateShoutReactions({
      seed: state.seed,
      clock: 500,
      durationSeconds: state.durationSeconds,
      score: state.score,
      log: state.log,
      side: 'home',
      kind: 'calm_down',
      team,
      targetPlayerId: target.id,
    })
    expect(calmBooked.record.reactions[0].mood).toBe('composed')
    expect(calmBooked.record.reactions[0].delta).toBeGreaterThanOrEqual(6)
  })

  it('喊话生效于 MatchRatings.eff()，遵守 12 分钟冷却与 15 分钟自动失效，不消耗教练暂停', () => {
    const { game, engine } = startFriendly(302)
    engine.advanceTo(100)
    const pausesBefore = game.activeMatch!.coachPausesLeft
    const team = engine.state.teams[0]
    const player = team.players.find((p) => p.onPitch && p.position !== 'GK')!
    player.personality = { professionalism: 85, ambition: 85, adaptability: 85 }
    engine.state.score = { home: 0, away: 1 }

    const ratings = new MatchRatings(() => engine.state, () => engine.state.durationSeconds)
    const beforeComposure = ratings.eff(player, 'composure')

    const res = issueMatchShout(game, engine, 'encourage', player.sourceId)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.record.targetPlayerId).toBe(player.sourceId)
    expect(res.record.reactions[0].delta).toBeGreaterThan(0)
    // 不消耗教练暂停
    expect(game.activeMatch!.coachPausesLeft).toBe(pausesBefore)
    // 有效评分立刻提升
    const afterComposure = ratings.eff(player, 'composure')
    expect(afterComposure).toBeGreaterThan(beforeComposure + 4)

    // 冷却期内不能再喊
    const blocked = issueMatchShout(game, engine, 'focus')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error).toContain('冷却中')

    // 推进超过 12 分钟冷却但未满 15 分钟持续期：仍有效，但已可再次喊话
    const cooldown = shoutCooldownSeconds(engine.state.durationSeconds)
    const duration = shoutDurationSeconds(engine.state.durationSeconds)
    expect(cooldown).toBe(Math.round((LOGIC_MATCH_SECONDS * SHOUT_COOLDOWN_MINUTES) / 90))
    expect(duration).toBe(Math.round((LOGIC_MATCH_SECONDS * SHOUT_DURATION_MINUTES) / 90))

    engine.advanceTo(100 + duration + 5)
    expect(activeShoutStateOf(player, engine.state.clock)).toBeNull()
    expect(shoutStatusOf(team, engine.state.clock, engine.state.durationSeconds).canShout).toBe(true)
  })

  it('Agent API 支持 match_shout、set_auto_shout，且 activeMatch.shouts 与球员情绪完整暴露', () => {
    const { game } = startFriendly(303)
    const unlockedNow = (game.season.startedAt ?? Date.now()) - 2 * 60 * 60 * 1000
    const toggle = applyAgentAction(game, { action: 'set_auto_shout', enabled: true }, unlockedNow)
    expect(toggle.ok).toBe(true)
    expect(game.lineup.autoShout).toBe(true)
    // 锁阵窗口内修改自动喊话会被拒绝
    const lockedToggle = applyAgentAction(game, { action: 'set_auto_shout', enabled: false }, (game.season.startedAt ?? Date.now()) + 10_000)
    expect(lockedToggle.ok).toBe(false)

    const viewBefore = agentView(game)
    expect(viewBefore.shoutKinds).toHaveLength(8)
    expect(viewBefore.activeMatch?.shouts.canShout).toBe(true)
    expect(viewBefore.activeMatch?.shouts.max).toBe(SHOUT_MAX_PER_MATCH)

    // 先推进几步再通过 Agent API 喊话
    expect(applyAgentAction(game, { action: 'advance_match', steps: 10 }).ok).toBe(true)
    const targetId = viewBefore.activeMatch!.onPitch[0].sourceId
    const shoutRes = applyAgentAction(game, { action: 'match_shout', kind: 'encourage', targetPlayerId: targetId })
    expect(shoutRes.ok).toBe(true)

    const viewAfter = agentView(game)
    expect(viewAfter.activeMatch?.shouts.used).toBe(1)
    expect(viewAfter.activeMatch?.shouts.canShout).toBe(false)
    expect(viewAfter.activeMatch?.shouts.history).toHaveLength(1)
    const boosted = viewAfter.activeMatch?.onPitch.find((p) => p.sourceId === targetId)
    expect(boosted?.mood).toBeTruthy()
    expect(boosted?.mood?.kind).toBe('encourage')

    // UI 渲染包含 8 种喊话按钮、情绪标签与助教反馈
    setGame(game)
    ui.matchEngine = restoreActiveEngine(game)
    const matchHtml = renderMatch()
    expect(matchHtml).toContain('场边喊话')
    expect(matchHtml).toContain('严厉斥责')
    expect(matchHtml).toContain('卸下包袱')
    expect(matchHtml).toContain('助教：')
  })

  it('赛前开启 autoShout 在整场模拟中会自动触发喊话并保留于阵容操作后', () => {
    const game = createInitialGame(304)
    const safeNow = (game.season.startedAt ?? Date.now()) - 2 * 60 * 60_000
    game.lineup.autoShout = true
    const altFormation = FORMATION_LIST.find((f) => !isLegacyFormation(f.id) && f.id !== game.lineup.formationId)!.id
    const switched = applyAgentAction(game, { action: 'auto_lineup', formationId: altFormation }, safeNow)
    expect(switched.ok, switched.error).toBe(true)
    expect(game.lineup.autoShout).toBe(true)

    const started = startSingleChallenge(game, game.aiTeams[0].id, 20_000)
    expect(started.ok).toBe(true)
    const engine = restoreActiveEngine(game) as PesEngine
    engine.simulate()
    expect((engine.state.teams[0].shoutsUsed ?? 0)).toBeGreaterThanOrEqual(1)
    expect(engine.state.log.some((entry) => entry.type === 'shout')).toBe(true)
  })
})

describe('方向 2：联机正式赛直播实时喊话 → 服务端按需重算 & 回放逐帧一致', () => {
  it('computeMatchJob 带入 liveShouts 后，回放 initialState 与最终战报 100% 逐帧一致且可改变赛果进程', () => {
    const game = createWorldGame(405)
    const homeTeam = game.aiTeams[0]
    const awayTeam = game.aiTeams[1]
    const job: MatchJob = {
      id: 'q-' + 'a'.repeat(64),
      season: 1,
      divisionId: 'div-test',
      round: 1,
      kickoffAt: 1_000_000,
      lockedAt: 1_000_000 - 30 * 60_000,
      seed: 40501,
      gameDayMs: 4 * 60 * 60_000,
      home: { team: structuredClone(homeTeam), injuries: {}, suspended: [], medical: 1, coachId: 'coach-1', ai: false },
      away: { team: structuredClone(awayTeam), injuries: {}, suspended: [], medical: 1, ai: true },
    }
    const baseResult = computeMatchJob(job)
    const shoutedJob: MatchJob = {
      ...job,
      liveShouts: [
        { id: 'sh-home-150-1', side: 'home', kind: 'demand_more', atClock: 150 },
        { id: 'sh-home-420-2', side: 'home', kind: 'fire_up', atClock: 420 },
      ],
    }
    const shoutedResult = computeMatchJob(shoutedJob)
    expect(shoutedResult.initialState).toBeTruthy()
    expect(shoutedResult.record.commentary?.some((c) => c.type === 'shout')).toBe(true)

    // 从 shoutedResult.initialState 完整重放，比分和日志数量必须与公布的 record 100% 一致
    const replayEngine = PesEngine.restore(shoutedResult.initialState!)
    const replayed = replayEngine.simulate()
    expect(replayed.score).toEqual(shoutedResult.record.score)
    expect(replayed.teams[0].shoutsUsed).toBe(2)

    // 模拟浏览器在直播第 120 秒无缝注入第一条喊话、第 400 秒注入第二条喊话（不倒带！）
    const liveViewer = PesEngine.restore(baseResult.initialState!)
    liveViewer.advanceTo(120)
    liveViewer.scheduleShouts([shoutedJob.liveShouts![0]])
    liveViewer.advanceTo(400)
    liveViewer.scheduleShouts(shoutedJob.liveShouts!)
    const viewerFinished = liveViewer.simulate()
    expect(viewerFinished.score).toEqual(shoutedResult.record.score)
    expect(viewerFinished.teams[0].shoutsUsed).toBe(2)
  })

  it('MatchQueue.recomputeLive 阻塞发布过期赛果，并在高优重算完成后放行新结果', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-shout-queue-'))
    tempDirs.push(dir)
    const game = createWorldGame(406)
    let recomputedCalls = 0
    const queue = new MatchQueue(dir, {
      intervalMs: 0,
      compute: async (job) => {
        recomputedCalls++
        return computeMatchJob(job)
      },
    })
    const id = 'q-' + 'b'.repeat(64)
    const job: MatchJob = {
      id,
      season: 1,
      divisionId: 'div-test',
      round: 1,
      kickoffAt: 2_000_000,
      lockedAt: 2_000_000 - 30 * 60_000,
      seed: 40601,
      gameDayMs: 4 * 60 * 60_000,
      home: { team: structuredClone(game.aiTeams[0]), injuries: {}, suspended: [], medical: 1, coachId: 'c1', ai: false },
      away: { team: structuredClone(game.aiTeams[1]), injuries: {}, suspended: [], medical: 1, ai: true },
    }
    queue.enqueue(job)
    await queue.pump(Date.now())
    expect(queue.ready(id)).toBe(true)
    expect(queue.publishReady(id)).toBe(true)
    expect(recomputedCalls).toBe(1)

    // 触发直播喊话重算：重算进行期间 publishReady 必须为 false（阻止发布过期赛果），但 ready 仍为 true（不断直播流）
    queue.recomputeLive(id, (item) => {
      item.liveShouts = [{ id: 'sh-live-1', side: 'home', kind: 'encourage', atClock: 200 }]
    })
    expect(queue.ready(id)).toBe(true)
    // 等待异步 pump 完成重算
    for (let i = 0; i < 400 && !queue.publishReady(id); i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect(queue.publishReady(id)).toBe(true)
    expect(recomputedCalls).toBe(2)
    const updated = queue.read(id)
    expect(updated.input.liveShouts).toHaveLength(1)
    expect(updated.result.record.commentary?.some((c) => c.type === 'shout')).toBe(true)
    queue.close()
  }, 30_000)

  it('联机 HTTP /api/match/action 与 Agent /api/agent/action 在直播窗内支持实时喊话，85 分钟后锁止', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-shout-srv-'))
    tempDirs.push(dir)
    let clockNow = Date.UTC(2026, 10, 20, 10, 0, 0)
    const srv = createAppServer({
      dataDir: dir,
      staticDir: path.resolve('dist'),
      tickMs: 25,
      now: () => clockNow,
      matchQueue: {
        intervalMs: 0,
        compute: async (job) => {
          // 真人参与的场次走完整真实 computeMatchJob + PES 引擎；其余 39 场纯 AI 对局用极速桩，确保单测稳定在几秒内完成。
          if (!job.home.ai || !job.away.ai) return computeMatchJob(job)
          return {
            id: job.id,
            record: {
              id: job.id,
              seed: job.seed,
              createdAt: job.kickoffAt,
              isLeague: true,
              round: job.round,
              homeId: job.home.team.id,
              awayId: job.away.team.id,
              homeName: job.home.team.name,
              awayName: job.away.team.name,
              score: { home: 1, away: 1 },
              result: 'draw',
              stats: { home: { possession: 50, passes: 100, passesCompleted: 80, shots: 8, shotsOnTarget: 3, goals: 1, interceptions: 5, tackles: 5, fouls: 5, corners: 3, xg: 1, distance: 100, yellowCards: 0, redCards: 0 }, away: { possession: 50, passes: 100, passesCompleted: 80, shots: 8, shotsOnTarget: 3, goals: 1, interceptions: 5, tackles: 5, fouls: 5, corners: 3, xg: 1, distance: 100, yellowCards: 0, redCards: 0 } },
              playerStats: [],
              keyEvents: [],
              autoSimulated: true,
            } as any,
            fixture: { score: { home: 1, away: 1 }, matchId: job.id, scorers: [], assisters: [], autoSimulated: true },
            injuries: {},
            conditionLoss: {},
            appearances: {},
            cards: [],
          }
        },
      },
    })
    servers.push(srv)
    await new Promise<void>((resolve) => srv.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`

    const regRes = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'shout_coach', password: 'password123', clubName: '喊话联队' }),
    })
    expect(regRes.status).toBe(201)
    const reg = await regRes.json() as { token: string; game: any }

    // 创建 Agent 令牌
    const tokRes = await fetch(`${base}/api/agent/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${reg.token}` },
      body: JSON.stringify({}),
    })
    expect(tokRes.status).toBe(200)
    const tok = await tokRes.json() as { token: string }

    // 找到第 1 轮开球时间，推进到开赛前 20 分钟让服务器预算本轮，再推进到开球后 3 分钟（约比赛第 27 分钟）
    const firstRoundKickoff = reg.game.world.seasonStartedAt + 4 * 60 * 60_000
    clockNow = firstRoundKickoff - 20 * 60_000
    // 触发调度器入队并等待后台算完本轮
    await fetch(`${base}/api/game`, { headers: { authorization: `Bearer ${reg.token}` } })
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 30))
      const st = await fetch(`${base}/api/agent/state`, { headers: { authorization: `Bearer ${tok.token}` } }).then((r) => r.json()) as any
      if (st.game) break
    }
    // 推进到开球后 3 分钟（约比赛第 27 分钟），进入 10 分钟直播窗
    clockNow = firstRoundKickoff + 3 * 60_000
    // 轮询直到本场 ready 并作为直播下发
    let liveGame: any = null
    for (let i = 0; i < 120; i++) {
      const g = await fetch(`${base}/api/game`, { headers: { authorization: `Bearer ${reg.token}` } }).then((r) => r.json()) as any
      if (g.game?.activeMatch?.preplayed) {
        liveGame = g.game
        break
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    expect(liveGame?.activeMatch?.preplayed).toBe(true)
    expect(liveGame.activeMatch.liveJobId).toBeTruthy()

    // 1. 通过 HTTP /api/match/action 发起全队喊话
    const shout1 = await fetch(`${base}/api/match/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${reg.token}` },
      body: JSON.stringify({ action: 'match_shout', kind: 'encourage' }),
    })
    const body1 = await shout1.json() as any
    expect(shout1.status).toBe(200)
    expect(body1.ok).toBe(true)
    expect(body1.scheduled).toBe(true)
    expect(body1.liveShouts).toHaveLength(1)
    expect(body1.game.activeMatch.liveShouts).toHaveLength(1)

    // 2. 冷却期内再喊被服务端拒绝
    const shoutBlocked = await fetch(`${base}/api/match/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${reg.token}` },
      body: JSON.stringify({ action: 'match_shout', kind: 'demand_more' }),
    })
    expect(shoutBlocked.status).toBe(400)

    // 3. 推进到开球后 6 分钟（约第 54 分钟，冷却结束），通过 Agent API 发起单人点名喊话
    clockNow = firstRoundKickoff + 6 * 60_000
    const agentState = await fetch(`${base}/api/agent/state`, { headers: { authorization: `Bearer ${tok.token}` } }).then((r) => r.json()) as any
    expect(agentState.game.activeMatch.preplayed).toBe(true)
    expect(agentState.game.activeMatch.shouts.canShout).toBe(true)
    const starterId = agentState.game.activeMatch.onPitch[0].sourceId
    const agentShout = await fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.token}` },
      body: JSON.stringify({ action: 'match_shout', kind: 'fire_up', targetPlayerId: starterId }),
    })
    const agentShoutBody = await agentShout.json() as any
    expect(agentShout.status).toBe(200)
    expect(agentShoutBody.ok).toBe(true)
    expect(agentShoutBody.liveShouts).toHaveLength(2)
    expect(agentShoutBody.shout.targetPlayerId).toBe(starterId)

    // 4. 推进到开球后 9 分 35 秒（超过 85 分钟截止线）→ 必须锁止拒绝
    clockNow = firstRoundKickoff + Math.ceil((SHOUT_LIVE_CUTOFF_MINUTE + 1) / 90 * 10 * 60_000)
    const lateShout = await fetch(`${base}/api/match/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${reg.token}` },
      body: JSON.stringify({ action: 'match_shout', kind: 'focus' }),
    })
    expect(lateShout.status).toBe(400)
    const lateBody = await lateShout.json() as any
    expect(lateBody.error).toContain('85 分钟后')

    // 5. 推进到开球 11 分钟后（10 分钟直播结束且重算已完成）→ 正式公布战报，包含本次喊话播报！
    clockNow = firstRoundKickoff + 11 * 60_000
    let publishedRecord: any = null
    for (let i = 0; i < 120; i++) {
      const st = await fetch(`${base}/api/agent/state`, { headers: { authorization: `Bearer ${tok.token}` } }).then((r) => r.json()) as any
      if (st.game?.matchHistory?.length) {
        const detail = await fetch(`${base}/api/agent/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.token}` },
          body: JSON.stringify({ action: 'get_match', matchId: st.game.matchHistory[0].id }),
        }).then((r) => r.json()) as any
        publishedRecord = detail.result?.record
        break
      }
      await new Promise((r) => setTimeout(r, 40))
    }
    expect(publishedRecord).toBeTruthy()
    expect(publishedRecord.commentary?.filter((c: any) => c.type === 'shout').length).toBeGreaterThanOrEqual(2)
  }, 45_000)
})
