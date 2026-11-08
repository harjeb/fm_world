import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PesEngine } from '../src/game/pes/engine.ts'

/**
 * 新球场的“推进与同步”逻辑（不画图：假画布拿不到 2d 上下文，paint 直接返回）：
 * 友谊赛按速度档推进本地引擎；联赛的画面引擎追着现实时钟走、不超前，教练调整 / 分叉时重新对齐权威存档。
 * requestAnimationFrame 被换成一个队列，测试里手动给时间戳执行每一帧。
 */
type Frame = (now: number) => void
const frames: Frame[] = []
const fakeCanvas = { id: 'pitch', width: 1200, height: 768, clientWidth: 900, getContext: () => null } as unknown as HTMLCanvasElement
const kits = { home: '#d33', away: '#39f' }

function stubBrowser(): void {
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), clear: () => store.clear() }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      location: { search: '', hash: '', origin: 'http://localhost' },
      addEventListener() {},
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (callback: Frame) => { frames.push(callback); return frames.length },
      cancelAnimationFrame: () => { frames.length = 0 },
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: { dataset: {} },
      getElementById: () => fakeCanvas,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({ style: {}, classList: { add() {} }, getContext: () => null }),
    },
  })
}

/** 取出排队的那一帧并以给定的时间戳执行（模拟 requestAnimationFrame 回调）。 */
function runFrame(now: number): void {
  const next = frames.shift()
  expect(next, '应该有一帧在排队').toBeDefined()
  next!(now)
}

async function modules() {
  const { game, ui } = await import('../src/ui/state.ts')
  const { createInitialGame } = await import('../src/game/state.ts')
  const actions = await import('../src/game/actions.ts')
  const pitch = await import('../src/ui/pes-pitch.ts')
  const realtime = await import('../src/game/realtime.ts')
  pitch.setPesViewHooks({ refresh() {}, finished() {}, save() {} })
  pitch.resetPesView()
  frames.length = 0
  /** 换一份全新的游戏状态（Object.assign 不会删掉上一个测试留下的 activeMatch） */
  const fresh = (seed: number) => {
    for (const key of Object.keys(game)) delete (game as unknown as Record<string, unknown>)[key]
    Object.assign(game, createInitialGame(seed))
  }
  return { game, ui, actions, pitch, realtime, fresh }
}

describe('新球场：友谊赛推进', () => {
  beforeEach(stubBrowser)

  it('按速度档推进本地引擎：快档每帧的物理步数是正常档的两倍；暂停时不推进、不排帧', async () => {
    const { game, ui, actions, pitch, fresh } = await modules()
    fresh(41)
    expect(actions.startSingleChallenge(game, game.aiTeams[0].id).ok).toBe(true)
    ui.screen = 'match'
    ui.matchEngine = actions.restoreActiveEngine(game)
    const engine = ui.matchEngine as PesEngine

    ui.matchPlaying = false
    pitch.drawPesPitch(fakeCanvas, engine, kits)
    expect(frames.length).toBe(0)
    expect(engine.game.match.time).toBe(0)

    const stepSpy = vi.spyOn(engine.game, 'step')
    let now = 1000
    function stepsAt(speed: number): number {
      ui.matchSpeed = speed
      ui.matchPlaying = true
      pitch.drawPesPitch(fakeCanvas, engine, kits) // 已有排队的帧就不会再排
      runFrame(now) // 定时间基准
      stepSpy.mockClear()
      for (let index = 0; index < 40; index++) {
        now += 100
        runFrame(now)
      }
      return stepSpy.mock.calls.length
    }
    const normal = stepsAt(2700) // 1.7 模拟秒 / 现实秒：每 100 ms 帧 ≈ 10.2 步
    const fast = stepsAt(1350) // 3.4 模拟秒 / 现实秒：≈ 20.4 步
    expect(normal).toBeGreaterThan(395)
    expect(normal).toBeLessThan(420)
    expect(fast / normal).toBeGreaterThan(1.95)
    expect(fast / normal).toBeLessThan(2.05)
    expect(engine.game.match.time).toBeGreaterThan(5)
    ui.matchPlaying = false
  })

  it('每隔几秒存一次档；踢完后停一会儿再通知结束，只通知一次', async () => {
    const { game, ui, actions, pitch, fresh } = await modules()
    let saves = 0
    let finished = 0
    pitch.setPesViewHooks({ refresh() {}, finished() { finished++ }, save() { saves++ } })
    fresh(42)
    expect(actions.startSingleChallenge(game, game.aiTeams[0].id).ok).toBe(true)
    ui.screen = 'match'
    ui.matchEngine = actions.restoreActiveEngine(game)
    ui.matchPlaying = true
    ui.matchSpeed = 1350
    ui.completing = false
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    let now = 5000
    runFrame(now)
    for (let index = 0; index < 90; index++) {
      now += 100
      runFrame(now)
    }
    expect(saves).toBe(2)
    expect(finished).toBe(0)

    // 直接跑到终场，再给画面循环几帧：1.8 秒内不通知，之后通知一次
    ui.matchEngine!.simulate()
    runFrame(now + 100)
    runFrame(now + 1000)
    expect(finished).toBe(0)
    runFrame(now + 2200)
    expect(finished).toBe(1)
    expect(ui.matchPlaying).toBe(false)
    expect(frames.length).toBe(0)
  })
})

describe('新球场：联赛画面引擎', () => {
  beforeEach(() => {
    stubBrowser()
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  async function leagueAt(seed: number, elapsedMs: number) {
    const all = await modules()
    const { game, ui, actions, realtime, fresh } = all
    fresh(seed)
    expect(actions.startLeague(game).ok).toBe(true)
    game.activeMatch!.startedAt = 1_000_000
    /** 现实时间走到 ms 毫秒：权威存档推进到那一刻（服务器 / tickRealtimeLeague 做的事），界面重新读档 */
    const at = (ms: number) => {
      vi.setSystemTime(1_000_000 + ms)
      realtime.advanceLeagueRealtime(game, 1_000_000 + ms)
      ui.matchEngine = actions.restoreActiveEngine(game)
    }
    at(elapsedMs)
    ui.screen = 'match'
    ui.matchPlaying = false
    return { ...all, at, target: () => realtime.leagueMatchClock(game.activeMatch!) }
  }

  const timeOf = (engine: unknown) => (engine as PesEngine).game.match.time
  const eventsOf = (engine: unknown) => (engine as PesEngine).game.match.events

  it('画面引擎是权威存档的私有副本，按现实时钟推进且不超过它；比分和文字读画面引擎', async () => {
    const { ui, pitch, at, target } = await leagueAt(51, 30_000)
    const auth = ui.matchEngine as PesEngine
    pitch.drawPesPitch(fakeCanvas, auth, kits)
    const view = pitch.pesViewEngine(auth)
    expect(view).not.toBe(auth)
    expect(view.state.clock).toBe(auth.state.clock)
    expect(view.serialize()).toEqual(auth.serialize())

    // 现实又过了 20 秒：权威存档要等下一次 tick 才更新，画面引擎自己追时钟（落后超过 20 模拟秒但权威存档也没更新：不复制，加速追）
    vi.setSystemTime(1_000_000 + 50_000)
    let now = 100_000
    runFrame(now)
    for (let index = 0; index < 400 && frames.length; index++) {
      now += 50
      runFrame(now)
    }
    const shown = pitch.pesDisplayEngine()!
    expect(shown).toBe(view)
    expect(timeOf(shown)).toBeGreaterThan(auth.state.clock + 20)
    expect(timeOf(shown)).toBeLessThanOrEqual(target() + 1 / 60 + 1e-6)
    // 权威存档还停在旧时刻（没更新）：比赛页读的是它，不会出现未经确认的事件
    expect(pitch.pesViewEngine(auth)).toBe(auth)
    // 追上之后每帧只走到现实时钟，不会越过去
    for (let index = 0; index < 20; index++) {
      now += 50
      runFrame(now)
      expect(timeOf(pitch.pesDisplayEngine())).toBeLessThanOrEqual(target() + 1 / 60 + 1e-6)
    }
    // 权威存档追上之后（下一次 tick），比赛页又读回画面引擎或事件较少的那份
    at(50_000)
    const next = ui.matchEngine as PesEngine
    pitch.drawPesPitch(fakeCanvas, next, kits)
    expect(eventsOf(pitch.pesViewEngine(next)).length).toBeLessThanOrEqual(next.game.match.events.length)
  })

  it('比赛页读的引擎：画面引擎走在权威存档前面（事件更多）时以权威存档为准', async () => {
    const { ui, pitch } = await leagueAt(54, 40_000)
    const auth = ui.matchEngine as PesEngine
    pitch.drawPesPitch(fakeCanvas, auth, kits)
    const view = pitch.pesViewEngine(auth) as PesEngine
    expect(view).not.toBe(auth)
    // 人为让画面引擎多走很多步（比如刚收到一份较旧的存档）
    while (view.game.match.events.length <= auth.game.match.events.length) view.game.step()
    expect(pitch.pesViewEngine(auth)).toBe(auth)
  })

  it('教练调整后（手动指令数对不上）重新从权威存档复制；自动换人不触发复制', async () => {
    const { game, ui, actions, pitch } = await leagueAt(52, 60_000)
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    const first = pitch.pesViewEngine(ui.matchEngine!)
    expect(first.state.instructions.length).toBe(0)

    expect(actions.changeMatchTactics(game, ui.matchEngine!, 'attack').ok).toBe(true)
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    const second = pitch.pesViewEngine(ui.matchEngine!)
    expect(second).not.toBe(first)
    expect(second.state.instructions.length).toBe(1)
    expect(second.serialize()).toEqual(ui.matchEngine!.serialize())

    // 权威存档没有变化：不再复制
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    expect(pitch.pesViewEngine(ui.matchEngine!)).toBe(second)
  })

  it('事件流分叉（浏览器与服务器的浮点实现不同）时，下一份权威存档到来就重新复制', async () => {
    const { game, ui, actions, pitch, at } = await leagueAt(55, 60_000)
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    const view = pitch.pesViewEngine(ui.matchEngine!)
    const events = eventsOf(view)
    expect(events.length).toBeGreaterThan(4)
    events[events.length - 1].t += 0.5 // 模拟分叉

    at(61_000)
    ui.matchEngine = actions.restoreActiveEngine(game)
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    const repaired = pitch.pesViewEngine(ui.matchEngine!)
    expect(repaired).not.toBe(view)
    const authEvents = eventsOf(ui.matchEngine)
    const repairedEvents = eventsOf(repaired)
    for (let index = Math.max(0, Math.min(authEvents.length, repairedEvents.length) - 4); index < Math.min(authEvents.length, repairedEvents.length); index++) {
      expect(repairedEvents[index].t).toBe(authEvents[index].t)
    }
  })

  it('落后现实时钟太多（标签页挂在后台）且权威存档已经走在前面时，直接复制，不逐帧追', async () => {
    const { ui, pitch, at } = await leagueAt(53, 20_000)
    pitch.drawPesPitch(fakeCanvas, ui.matchEngine as PesEngine, kits)
    const before = pitch.pesViewEngine(ui.matchEngine!)
    at(320_000) // 挂机 5 分钟，服务器 / 后台已把权威存档推进到现在
    runFrame(5000)
    runFrame(5100)
    const after = pitch.pesViewEngine(ui.matchEngine!)
    expect(after).not.toBe(before)
    expect(timeOf(after)).toBeGreaterThan(400)
  })
})
