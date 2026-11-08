/**
 * 新引擎（pes2d 物理 + 现有结算内核）的球场冒烟测试：真浏览器里跑友谊赛和联赛，验证
 *   - 比赛由画面循环按帧推进（连续运动，不是按步跳），暂停 / 换速 / 教练调整 / 跳过到终场都正常；
 *   - 联赛的画面引擎追着现实时钟走，教练调整后与权威存档重新对齐；
 *   - 截图存到 FM_SHOT_DIR（默认系统临时目录），方便肉眼看一眼。
 *
 * 自带 vite 开发服务器（随机端口）和无头 Chrome，不碰 8787 / 8800 上的任何服务。
 * 用法：node scripts/pes-animation-smoke.mjs      （FM_CHROME 可指定浏览器，FM_SHOT_DIR 指定截图目录）
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-pes-smoke-'))
const shotDir = process.env.FM_SHOT_DIR ?? dir
fs.mkdirSync(shotDir, { recursive: true })
const chromePath = process.env.FM_CHROME ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => fs.existsSync(candidate))
if (!chromePath) throw new Error('Set FM_CHROME to a Chrome/Chromium/Edge executable')
const port = await new Promise((resolve) => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) })
})
const vite = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
let ws
let sequence = 0
const pending = new Map()
const errors = []
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 20000)
    pending.set(id, { resolve: (data) => { clearTimeout(timeout); resolve(data) }, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}
async function waitFor(expression, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return
    await sleep(25)
  }
  throw new Error(`timeout: ${expression}`)
}
async function click(selector) {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`)
}
async function shot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(shotDir, name)
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'))
  console.log('screenshot', file)
}
/** 比赛页当前的几个关键数：权威引擎、画面引擎、画了多少帧。 */
const probe = `(async () => {
  const { ui, game } = await import('/src/ui/state.ts')
  const { pesViewEngine } = await import('/src/ui/pes-pitch.ts')
  const { pitchMotionTicks, pitchMotionSnapshot } = await import('/src/ui/pitch-canvas.ts')
  const auth = ui.matchEngine
  if (!auth) return null
  const view = pesViewEngine(auth)
  const m = view.game.match
  return {
    kind: auth.ruleSet,
    screen: ui.screen,
    playing: ui.matchPlaying,
    authTime: auth.game.match.time,
    viewTime: m.time,
    phase: m.phase,
    half: m.half,
    ball: { x: m.ball.x, y: m.ball.y, z: m.ball.z },
    frames: pitchMotionTicks(),
    maxSpeed: Math.max(0, ...pitchMotionSnapshot().map((p) => p.speed)),
    players: pitchMotionSnapshot().length,
    instructions: view.state.instructions.length,
    authInstructions: auth.state.instructions.length,
    log: view.state.log.length,
    score: view.state.score,
    stored: game.activeMatch ? game.activeMatch.engineState.pes?.snapshot?.time ?? null : null,
    clockText: document.querySelector('[data-pes-clock], [data-league-clock]')?.textContent ?? null,
  }
})()`

async function bootOffline() {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` })
  await waitFor(`document.readyState === 'complete'`)
  await evaluate(`localStorage.clear(); true`)
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` })
  // 每次打开都会先问「登录 / 离线」：这里走离线模式。
  await click('[data-action="boot-offline"]')
  await waitFor(`!!document.querySelector('[data-nav="challenge"]')`)
}

try {
  for (let i = 0; i < 100; i++) {
    try {
      const debugPort = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json())
      const page = pages.find((item) => item.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
        break
      }
    } catch {}
    await sleep(100)
  }
  if (!ws) throw new Error('could not connect to Chromium')
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  }
  await send('Page.enable')
  await send('Runtime.enable')
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break } catch {}
    await sleep(100)
  }

  /* ---------- 友谊赛 ---------- */
  await bootOffline()
  await click('[data-nav="challenge"]')
  await click('[data-action="start-world-challenge"]')
  await waitFor(`!!document.querySelector('#pitch')`)
  await evaluate(`window.__pitch = document.querySelector('#pitch'); true`)
  await waitFor(`(async () => { const {ui} = await import('/src/ui/state.ts'); return ui.matchPlaying && ui.matchEngine?.ruleSet === 'pes' })()`)

  const samples = []
  for (let i = 0; i < 60; i++) {
    samples.push(await evaluate(probe))
    await sleep(100)
  }
  const first = samples[0]
  const last = samples.at(-1)
  assert.equal(first.kind, 'pes')
  assert(last.viewTime - first.viewTime > 3, `match did not advance: ${JSON.stringify([first, last])}`)
  assert(last.frames - first.frames > 60, `canvas was not redrawn per frame: ${JSON.stringify([first, last])}`)
  const uniqueBall = new Set(samples.map((s) => `${s.ball.x.toFixed(2)}:${s.ball.y.toFixed(2)}`)).size
  assert(uniqueBall > 15, `ball is not moving continuously (${uniqueBall} distinct positions)`)
  assert(Math.max(...samples.map((s) => s.maxSpeed)) > 2, 'players are not running')
  assert(last.players >= 14, `expected 14 players on the pitch, got ${last.players}`)
  assert(await evaluate(`window.__pitch === document.querySelector('#pitch')`), 'DOM render replaced the canvas')
  assert(last.clockText && last.clockText !== '0:00', `clock text did not move: ${last.clockText}`)
  console.log('friendly: sim seconds', (last.viewTime - first.viewTime).toFixed(1), 'in 6s, frames', last.frames - first.frames, 'ball positions', uniqueBall, 'clock', last.clockText)
  await shot('pes-friendly-play.png')

  // 暂停：比赛时间必须冻住；继续后再走
  await click('[data-action="match-toggle"]')
  const paused = await evaluate(probe)
  await sleep(700)
  const stillPaused = await evaluate(probe)
  assert.equal(stillPaused.viewTime, paused.viewTime, 'pause did not freeze the match')
  await click('[data-action="match-toggle"]')
  await sleep(600)
  const resumed = await evaluate(probe)
  assert(resumed.viewTime > paused.viewTime, 'resume did not continue the match')

  // 换速：快档每现实秒推进的模拟秒应明显多于慢档
  async function ratePerSecond(speed) {
    await click(`[data-speed="${speed}"]`)
    const a = await evaluate(probe)
    await sleep(2000)
    const b = await evaluate(probe)
    return (b.viewTime - a.viewTime) / 2
  }
  const slow = await ratePerSecond(4000)
  const fast = await ratePerSecond(1350)
  console.log('rate sim-s per real-s: slow', slow.toFixed(2), 'fast', fast.toFixed(2))
  assert(fast > slow * 1.8, `speed buttons do not change the pace: slow ${slow} fast ${fast}`)
  await click('[data-speed="2700"]')

  // 战术视图 + 教练暂停调整
  await click('[data-pitch-view="tracking"]')
  await sleep(400)
  await shot('pes-friendly-tracking.png')
  await click('[data-pitch-view="match"]')
  await click('[data-action="match-coach"]')
  const beforeCoach = await evaluate(probe)
  await evaluate(`document.querySelector('#match-mentality').value = 'attack'; true`)
  await click('[data-action="match-tactics-apply"]')
  const afterCoach = await evaluate(probe)
  assert.equal(afterCoach.instructions, beforeCoach.instructions + 1, 'coach instruction was not applied')
  assert.equal(afterCoach.playing, false, 'coach panel should pause the friendly')
  await click('[data-action="match-coach"]')
  await sleep(500)

  // 跳过到终场：进入赛后页，战绩被记录
  await click('[data-action="match-skip"]')
  await waitFor(`(async () => { const {ui, game} = await import('/src/ui/state.ts'); return ui.screen === 'review' && game.challengeHistory.length === 1 })()`, 20000)
  const record = await evaluate(`(async () => { const {game} = await import('/src/ui/state.ts'); const r = game.challengeHistory[0]; return { score: r.score, players: r.playerStats.length, commentary: r.commentary?.length ?? 0, goals: r.goalDetails?.length ?? 0 } })()`)
  assert(record.players >= 14 && record.commentary > 10, `friendly record looks empty: ${JSON.stringify(record)}`)
  assert.equal(record.goals, record.score.home + record.score.away, 'goal details do not match the score')
  console.log('friendly record', JSON.stringify(record))

  /* ---------- 联赛 ---------- */
  await bootOffline()
  await click('[data-action="start-league"]')
  await waitFor(`(async () => { const {ui} = await import('/src/ui/state.ts'); return ui.screen === 'match' && ui.matchEngine?.ruleSet === 'pes' })()`)
  await sleep(500)
  const leagueSamples = []
  for (let i = 0; i < 80; i++) {
    leagueSamples.push(await evaluate(probe))
    await sleep(100)
  }
  const l0 = leagueSamples[0]
  const l1 = leagueSamples.at(-1)
  assert(l1.viewTime - l0.viewTime > 4, `league display did not advance: ${JSON.stringify([l0, l1])}`)
  assert(l1.frames - l0.frames > 80, `league canvas was not redrawn per frame: ${JSON.stringify([l0, l1])}`)
  // 画面引擎不超前现实时钟，也不落后太多：和权威引擎的差在几秒之内
  const lag = Math.max(...leagueSamples.map((s) => s.authTime - s.viewTime))
  const ahead = Math.max(...leagueSamples.map((s) => s.viewTime - s.authTime))
  console.log('league: display advanced', (l1.viewTime - l0.viewTime).toFixed(1), 'sim-s in 8s; max lag behind auth', lag.toFixed(1), 'max ahead of auth', ahead.toFixed(1), 'stored', l1.stored)
  assert(lag < 12, `league display lags the authoritative state by ${lag}s`)
  assert(ahead < 4, `league display runs ahead of the authoritative state by ${ahead}s`)
  assert(l1.stored !== null && l1.stored > 0, 'league engine state was not persisted')
  await shot('pes-league-play.png')

  // 联赛里改战术：权威存档带上指令，画面引擎重新对齐
  await click('[data-action="match-coach"]')
  await evaluate(`document.querySelector('#match-mentality').value = 'defend'; true`)
  await click('[data-action="match-tactics-apply"]')
  await sleep(600)
  const afterLeagueCoach = await evaluate(probe)
  assert(afterLeagueCoach.authInstructions >= 1, 'league coach instruction was not applied')
  assert.equal(afterLeagueCoach.instructions, afterLeagueCoach.authInstructions, 'display engine did not re-sync after the coach change')
  assert(afterLeagueCoach.viewTime >= l1.viewTime, 'display engine went backwards after the coach change')

  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`)
  console.log('pes animation smoke OK')
} finally {
  ws?.close()
  chrome.kill()
  vite.kill()
  await sleep(300)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}
