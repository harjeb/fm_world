import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-animation-smoke-'))
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
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
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
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` })
  await waitFor(`!!document.querySelector('[data-nav="challenge"]')`)
  await evaluate(`(() => {
    window.__motion = [];
    const arc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function(x, y, radius, ...args) {
      const unit = Math.max(1, Math.min(2.2, this.canvas.width / Math.max(1, this.canvas.clientWidth)));
      if (this.canvas.id === 'pitch' && radius > 3 * unit && radius < 7 * unit) window.__motion.push({ t: performance.now(), x, y });
      return arc.call(this, x, y, radius, ...args);
    };
    return true;
  })()`)
  await click('[data-nav="challenge"]')
  await click('[data-action="start-world-challenge"]')
  await waitFor(`!!document.querySelector('#pitch')`)
  await evaluate(`window.__pitch = document.querySelector('#pitch'); true`)
  await waitFor(`(async () => { const {ui} = await import('/src/ui/state.ts'); return ui.matchPlaying })()`)
  // 正常档一场约 10 分钟，12 秒大约走 4–5 个动作。
  await sleep(12000)
  const motion = await evaluate(`(async () => {
    const {ui} = await import('/src/ui/state.ts');
    const {pitchMotionTicks} = await import('/src/ui/pitch-canvas.ts');
    return { steps: ui.matchEngine.state.step, draws: window.__motion.length, uniqueBall: new Set(window.__motion.map(p => p.x.toFixed(2) + ':' + p.y.toFixed(2))).size, sameCanvas: window.__pitch === document.querySelector('#pitch'), ticks: pitchMotionTicks() };
  })()`)
  assert(motion.steps >= 3, `not enough engine steps: ${JSON.stringify(motion)}`)
  assert(motion.draws > motion.steps * 20, `animation still tied to engine steps: ${JSON.stringify(motion)}`)
  assert(motion.uniqueBall > 20, `ball is not moving continuously: ${JSON.stringify(motion)}`)
  assert(motion.sameCanvas, 'DOM render replaced the canvas')
  const speeds = await evaluate(`(async () => {
    const {pitchMotionSnapshot} = await import('/src/ui/pitch-canvas.ts');
    let top = 0;
    let still = 0;
    let points = 0;
    // 单帧可能正好停在一个定位球上：连采 1 秒再看最大值。
    for (let i = 0; i < 10; i++) {
      const snapshot = pitchMotionSnapshot();
      points = Math.max(points, snapshot.length);
      top = Math.max(top, ...snapshot.map((p) => p.speed));
      still = Math.max(still, snapshot.filter((p) => p.speed < 0.4).length);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { points, top, still };
  })()`)
  assert(speeds.points >= 14, `motion layer is not tracking all players: ${JSON.stringify(speeds)}`)
  assert(speeds.top > 0.8, `players are not moving: ${JSON.stringify(speeds)}`)
  assert(speeds.still >= 1, `everyone moves at the same time, no shape: ${JSON.stringify(speeds)}`)
  // 运动层按“比赛时间”10 Hz 推进：正常档 12 秒 ≈ 180 tick（倍速 1.5 左右）。
  assert(motion.ticks >= 60 && motion.ticks <= 400, `motion layer did not tick with playback speed: ${JSON.stringify(motion)}`)

  await click('[data-action="match-toggle"]')
  const paused = await evaluate(`(async () => { const {ui} = await import('/src/ui/state.ts'); const {pitchMotionTicks} = await import('/src/ui/pitch-canvas.ts'); return {step:ui.matchEngine.state.step, point:window.__motion.at(-1), ticks: pitchMotionTicks()} })()`)
  await sleep(600)
  const later = await evaluate(`(async () => { const {ui} = await import('/src/ui/state.ts'); const {pitchMotionTicks} = await import('/src/ui/pitch-canvas.ts'); return {step:ui.matchEngine.state.step, point:window.__motion.at(-1), ticks: pitchMotionTicks()} })()`)
  assert.equal(later.step, paused.step, 'pause did not freeze the engine')
  assert.equal(later.ticks, paused.ticks, 'pause did not freeze the motion layer')
  assert.deepEqual({ x: later.point.x, y: later.point.y }, { x: paused.point.x, y: paused.point.y }, 'pause did not freeze playback')
  await click('[data-pitch-view="match"]')
  assert(await evaluate(`window.__pitch === document.querySelector('#pitch')`), 'view switch replaced the canvas')
  await click('[data-pitch-view="tracking"]')
  await click('[data-action="match-coach"]')
  await evaluate(`document.querySelector('#match-mentality').value = 'attack'; true`)
  const beforeCoach = await evaluate(`({ x: window.__motion.at(-1).x, y: window.__motion.at(-1).y })`)
  await click('[data-action="match-tactics-apply"]')
  const afterCoach = await evaluate(`({ x: window.__motion.at(-1).x, y: window.__motion.at(-1).y })`)
  assert.deepEqual(afterCoach, beforeCoach, 'coach adjustment dropped an already confirmed action')
  assert(await evaluate(`(async () => { const {ui} = await import('/src/ui/state.ts'); return ui.matchEngine.state.instructions.some(i => i.kind === 'tactic') })()`), 'coach instruction was not applied')

  // 从最后一次判定之前继续，验证终场动作没有被 render()/completeMatch() 抢先切掉。
  await evaluate(`(async () => {
    const {game,ui} = await import('/src/ui/state.ts');
    const {MatchEngine} = await import('/src/game/match/engine.ts');
    const preview = ui.matchEngine.clone();
    let before;
    while (!preview.state.finished) { before = structuredClone(preview.state); preview.step(); }
    window.__expectedScore = {...preview.state.score};
    ui.matchEngine = MatchEngine.restore(before, true);
    game.activeMatch.engineState = before;
    ui.matchStepMs = 80;
    ui.matchSpeed = 300; // 终场动作用一个快档播完，别让冒烟测试等 10 分钟的比赛节奏
    ui.coachPanel = false;
    ui.matchPlaying = false;
    return true;
  })()`)
  await click('[data-pitch-view="tracking"]')
  await click('[data-action="match-toggle"]')
  await waitFor(`(async () => { const {ui} = await import('/src/ui/state.ts'); return ui.matchEngine?.state.finished && !!document.querySelector('#pitch') })()`, 4000)
  const screenshot = path.join(dir, 'tracking.png')
  const image = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(screenshot, Buffer.from(image.data, 'base64'))
  await waitFor(`(async () => { const {game,ui} = await import('/src/ui/state.ts'); return ui.screen === 'review' && !game.activeMatch })()`, 6000)
  assert(await evaluate(`(async () => { const {game} = await import('/src/ui/state.ts'); return JSON.stringify(game.challengeHistory[0].score) === JSON.stringify(window.__expectedScore) })()`), 'playback changed the result')
  assert.deepEqual(errors, [], 'browser exceptions')
  console.log(JSON.stringify({ ok: true, ...motion, speeds, pause: true, coach: true, terminalPlayback: true, resultUnchanged: true, screenshot }, null, 2))
} finally {
  ws?.close()
  chrome.kill()
  vite.kill()
  // 保留截图便于人工查验；临时浏览器配置不写入项目目录。
}
