import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createInitialGame, SAVE_KEY } from '../src/game/state.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pve-ui-smoke-'))
const listener = net.createServer()
await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
const port = (listener.address() as net.AddressInfo).port
await new Promise<void>((resolve) => listener.close(() => resolve()))
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${temp}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
let ws: WebSocket | undefined, id = 0
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
const errors: string[] = []
function send(method: string, params: object = {}): Promise<any> {
  return new Promise((resolve, reject) => { const seq = ++id; pending.set(seq, { resolve, reject }); ws!.send(JSON.stringify({ id: seq, method, params })) })
}
async function evaluate(expression: string) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
async function wait(expression: string, ms = 60000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await evaluate(expression).catch(() => false)) return
    await sleep(100)
  }
  throw new Error(`页面等待超时：${expression}`)
}
async function click(selector: string) {
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
async function screenshot(name: string) {
  const result = await send('Page.captureScreenshot', { format: 'png' })
  const output = `/tmp/pve-${name}.png`
  fs.writeFileSync(output, Buffer.from(result.data, 'base64'))
  console.log(`Screenshot: ${output}`)
}
try {
  for (let i = 0; i < 150; i++) {
    try {
      const debugPort = fs.readFileSync(path.join(temp, 'DevToolsActivePort'), 'utf8').split('\n')[0]
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()) as { type: string; webSocketDebuggerUrl: string }[]
      ws = new WebSocket(pages.find((page) => page.type === 'page')!.webSocketDebuggerUrl)
      await new Promise<void>((resolve, reject) => { ws!.onopen = () => resolve(); ws!.onerror = () => reject(new Error('Chrome 连接失败')) })
      break
    } catch { await sleep(100) }
  }
  if (!ws) throw new Error('Chrome 未启动')
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id) {
      const item = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) item?.reject(new Error(message.error.message)); else item?.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(message.params.exceptionDetails))
  }
  await send('Page.enable'); await send('Runtime.enable')
  const game = createInitialGame(71520)
  const delta = 86400000
  game.season.startedAt += delta
  for (const fixture of game.season.fixtures) if (fixture.kickoffAt) fixture.kickoffAt += delta
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (!localStorage.getItem(${JSON.stringify(SAVE_KEY)})) localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify(game))});` })
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${port}`).then((r) => r.ok).catch(() => false)) break
    await sleep(100)
  }
  await send('Page.navigate', { url: `http://127.0.0.1:${port}` })
  await click('[data-action="boot-offline"]')
  await click('[data-nav="challenge"]')
  await click('[data-challenge-mode="legend"]')
  await wait(`document.querySelector('[data-legend-tier="B"].active') && document.querySelectorAll('[data-action="start-legend-challenge"]').length > 0`)
  await click('[data-legend-tier="ALL"]')
  await click('[data-pve-team]')
  await wait(`document.body.innerText.includes('完整阵容') && document.body.innerText.includes('爆发')`)
  await evaluate(`const search = document.querySelector('#legend-search'); search.value = '米兰'; search.dispatchEvent(new Event('input', { bubbles: true }));`)
  await wait(`document.querySelectorAll('[data-action="start-legend-challenge"]').length > 0 && document.querySelectorAll('[data-action="start-legend-challenge"]').length < 50`)
  await screenshot('legend-desktop')
  await click('[data-challenge-mode="peak"]')
  await click('[data-peak-preview="50"]')
  await wait(`document.body.innerText.includes('足球小将') && document.body.innerText.includes('球星上限 1500')`)
  await screenshot('peak-stage-50')
  await click('[data-peak-preview="100"]')
  await wait(`document.body.innerText.includes('1300') && document.querySelector('[data-action="start-peak-stage"]').disabled`)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await screenshot('peak-mobile')
  const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth + 2')
  if (overflow) throw new Error('手机页面横向溢出')
  await click('[data-challenge-mode="cup"]')
  await click('[data-action="enter-cup"][data-cup="community"]')
  await wait(`document.body.innerText.includes('小组赛') && !!document.querySelector('[data-action="start-cup-match"]')`)
  await click('[data-action="start-cup-match"][data-cup="community"]')
  await click('[data-action="match-skip"]')
  await wait(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).challengeHistory.some(r => r.mode === 'cup')`)
  await send('Page.reload')
  await click('[data-action="boot-offline"]')
  await click('[data-nav="challenge"]')
  await click('[data-challenge-mode="cup"]')
  await click('[data-action="cup-preview"][data-cup="community"]')
  await wait(`document.body.innerText.includes('小组赛') && document.body.innerText.includes('战报')`)
  await screenshot('cup-mobile-resume')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('PvE 浏览器冒烟通过：默认 B 档、自由切换档位、第 50 关足球小将、桌面/390px、筛选、7 项主属性、100 关预览、报名比赛、刷新续赛；不访问线上账号/数据。')
} catch (error) {
  await screenshot('failure').catch(() => {})
  console.error(await evaluate('document.body.innerText.slice(-4000)').catch(() => 'page unavailable'))
  console.error('JS errors:', errors)
  console.error(await evaluate(`import('/src/game/pve-content.ts').then(m => ({ ready: m.pveContentReady(), hash: m.PVE_CONTENT_HASH }))`).catch(String))
  throw error
} finally {
  ws?.close(); chrome.kill('SIGTERM'); vite.kill('SIGTERM')
  await sleep(700)
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
