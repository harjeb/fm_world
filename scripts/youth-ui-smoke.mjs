// Use only against an isolated, open-registration test server, never production.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const base = process.env.FM_TEST_BASE ?? 'http://127.0.0.1:18788'
if (!/^http:\/\/127\.0\.0\.1:(?!8787\b)\d+$/.test(base)) throw new Error('Smoke test requires an isolated loopback test server')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-youth-chrome-'))
const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
let ws, seq = 0
const pending = new Map(), errors = []
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
async function wait(expression) {
  for (let i = 0; i < 100; i++) { try { if (await evaluate(expression)) return } catch {} await sleep(200) }
  throw new Error(`Timeout: ${expression}; page: ${await evaluate('document.body.innerText.slice(-1500)')}`)
}
async function click(selector) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`) }
try {
  for (let i = 0; i < 80; i++) {
    try {
      const port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl)
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
      break
    } catch { await sleep(200) }
  }
  if (!ws) throw new Error('Chromium unavailable')
  ws.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result) }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails)
    if (msg.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true })
  }
  await send('Page.enable'); await send('Runtime.enable')
  const response = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `youthsmoke${Date.now()}`, password: 'secret123' }) })
  if (response.status !== 201) throw new Error(`Registration failed: ${await response.text()}`)
  const { token } = await response.json()
  await send('Page.navigate', { url: base })
  await wait("document.readyState === 'complete'")
  await evaluate(`localStorage.setItem('fm-online-token', ${JSON.stringify(token)}); localStorage.setItem('fm-world-changelog-seen','v0.4.18')`)
  await send('Page.reload')
  await click('[data-action="boot-online"]')
  await wait("document.body.innerText.includes('已同步')")
  await click('[data-nav="youth"]')
  await wait("document.querySelectorAll('[data-youth-member]').length === 6")
  if (await evaluate("[...document.querySelectorAll('[data-youth-member]')].some(c => /基础 CA|青训上限|CA 成长/.test(c.innerText) || c.querySelector('[role=progressbar]'))")) throw new Error('Academy still displays exact CA/cap')
  if (!await evaluate("document.querySelectorAll('.youth-ratings .rating-stars').length === 12")) throw new Error('Ability/potential stars missing')
  const geometry = await evaluate("[...document.querySelectorAll('.youth-ratings .rating-star')].map(s => { const c=getComputedStyle(s); const r=s.getBoundingClientRect(); return {w:r.width,h:r.height,p:c.padding,m:c.margin,b:c.borderWidth} })")
  if (geometry.some(s => s.w !== geometry[0].w || s.h !== geometry[0].h || s.p !== '0px' || s.m !== '0px' || s.b !== '0px')) throw new Error('Grey/full/half star geometry mismatch')
  const memberId = await evaluate("document.querySelectorAll('[data-youth-member]')[1].dataset.youthMember")
  await evaluate(`document.querySelector('#youth-position-${memberId}').value = 'DM'; document.querySelector('#youth-focus-${memberId}').value = 'passing'`)
  const savePlan = `[data-action="youth-plan"][data-player="${memberId}"]`
  await evaluate(`
    window.originalFetch = window.fetch; window.stalledYouthRequests = [];
    window.fetch = (url, init) => {
      if (url !== '/api/youth/action' && !(url === '/api/game' && init?.method !== 'PUT')) return window.originalFetch(url, init);
      const request = { url, aborted: false };
      window.stalledYouthRequests.push(request);
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => {
        request.aborted = true; reject(init.signal.reason);
      }, { once: true }));
    };
  `)
  await click(savePlan)
  await wait('window.stalledYouthRequests.length === 1')
  const showedProgress = await evaluate("document.body.innerText.includes('正在提交青训操作')")
  await click(savePlan) // No duplicate submission while the first request is pending.
  await wait("document.body.innerText.includes('操作结果尚未确认') && !document.querySelector('#app').hasAttribute('inert')")
  if (!showedProgress) throw new Error('No pending feedback for the academy action')
  if (!await evaluate("window.stalledYouthRequests.map(r => r.url).join(',') === '/api/youth/action,/api/game' && window.stalledYouthRequests.every(r => r.aborted)")) throw new Error('Youth timeout did not abort both requests, or the action was submitted twice')
  await evaluate('window.fetch = window.originalFetch')
  await click(savePlan)
  await wait("document.body.innerText.includes('培养方向已保存') && !document.querySelector('#app').hasAttribute('inert')")
  await click(`[data-action="youth-call_up"][data-player="${memberId}"]`)
  await wait("document.body.innerText.includes('已临时征召') && !document.querySelector('#app').hasAttribute('inert')")
  await click('[data-nav="academy"]')
  await wait(`!!document.querySelector('[data-action="detail"][data-player="${memberId}"]')`)
  if (!await evaluate(`document.querySelector('[data-action="detail"][data-player="${memberId}"]').parentElement.innerText.includes('青训')`)) throw new Error('Missing academy badge in roster')
  await click(`[data-action="detail"][data-player="${memberId}"]`)
  await wait("!!document.querySelector('.scout-ratings .rating-star--empty')")
  const positionGeometry = await evaluate("[...document.querySelectorAll('.scout-ratings .rating-star')].map(s => { const c=getComputedStyle(s); const r=s.getBoundingClientRect(); return {w:r.width,h:r.height,p:c.padding,m:c.margin,b:c.borderWidth} })")
  if (positionGeometry.some(s => s.w !== positionGeometry[0].w || s.h !== positionGeometry[0].h || s.p !== '0px' || s.m !== '0px' || s.b !== '0px')) throw new Error('Position grey stars inherit empty-panel styling')
  await click('button.modal-close[data-action="close-detail"]')
  await click('[data-nav="youth"]')
  await click(`[data-action="youth-promote"][data-player="${memberId}"]`)
  await wait("document.querySelectorAll('[data-youth-member]').length === 5 && !document.querySelector('#app').hasAttribute('inert')")
  await send('Page.reload')
  await wait(`!!document.querySelector('[data-action="boot-online"]')`)
  await evaluate(`window.savedFetch = window.fetch; window.fetch = (url, init) => url === '/api/game' ? new Promise(resolve => { window.failRestore = () => resolve(Response.json({ error: '测试断网' }, {status: 503})) }) : window.savedFetch(url, init); true`)
  await click('[data-action="boot-online"]')
  await wait("typeof window.failRestore === 'function' && document.body.innerText.includes('正在读取联机存档')")
  if (await evaluate("!!document.querySelector('.app-shell')")) throw new Error('Stale game displayed before restore')
  await evaluate('window.failRestore(); window.fetch = window.savedFetch; true')
  await wait(`document.body.innerText.includes('测试断网') && !!document.querySelector('[data-action="boot-offline"]') && !document.querySelector('.app-shell')`)
  await click('[data-action="boot-online"]')
  await wait("document.body.innerText.includes('已同步')")
  await click('[data-nav="youth"]')
  await wait("document.querySelectorAll('[data-youth-member]').length === 5")
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await sleep(400)
  const layout = await evaluate('({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })')
  if (layout.scrollWidth > layout.width + 2) throw new Error(`Mobile overflow: ${JSON.stringify(layout)}`)
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync('/tmp/fm-youth-mobile.png', Buffer.from(shot.data, 'base64'))
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const desktop = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync('/tmp/fm-youth-desktop.png', Buffer.from(desktop.data, 'base64'))
  if (errors.length) throw new Error(JSON.stringify(errors))
  console.log('PASS: stalled academy action unlocks without duplicate submission; plan, call-up, promotion, reload and mobile layout work')
} finally {
  ws?.close()
  chrome.kill('SIGTERM')
  await sleep(500)
  fs.rmSync(dir, { recursive: true, force: true })
}
