// Run from repo root; FM_CHROME can point to any Chromium-compatible binary.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { createServer } from 'vite'

const vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await vite.listen()
const dir = await mkdtemp(join(tmpdir(), 'penalty-smoke-'))
const chrome = spawn(
  process.env.FM_CHROME || 'chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--remote-debugging-pipe',
    `--user-data-dir=${dir}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
)
const closed = once(chrome, 'close').catch(() => {})
const pending = new Map(),
  errors = []
let serial = 0,
  buffer = '',
  sessionId
chrome.stdio[4].setEncoding('utf8').on('data', (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\0')) >= 0) {
    const m = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    pending.get(m.id)?.(m)
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  }
})
function send(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++serial
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(Error(`Timed out: ${method}`))
    }, 20000)
    pending.set(id, (m) => {
      clearTimeout(timer)
      pending.delete(id)
      m.error ? reject(Error(m.error.message)) : resolve(m.result)
    })
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId: session }) + '\0')
  })
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
async function wait(expr) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expr)) return
    await sleep(100)
  }
  throw Error(`Not ready: ${expr}`)
}
async function click(selector) {
  const expr = `document.querySelector(${JSON.stringify(selector)})`
  await wait(expr + ' !== null')
  await evaluate(expr + '.click()')
}
try {
  const { targetInfos } = await send('Target.getTargets')
  ;({ sessionId } = await send('Target.attachToTarget', {
    targetId: targetInfos.find((t) => t.type === 'page').targetId,
    flatten: true,
  }))
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await send('Page.navigate', { url: vite.resolvedUrls.local[0] })
  await click('[data-action="boot-offline"]')
  await click('[data-nav="challenge"]')
  await click('[data-action="penalty-training"]')
  await wait('!!document.querySelector(".penalty-lab canvas")')
  for (const mode of ['player', 'keeper', 'ball', 'play']) {
    await evaluate(
      `(()=>{const s=document.querySelector('.penalty-lab .inspect');s.value='${mode}';s.dispatchEvent(new Event('change'))})()`,
    )
    assert.equal(await evaluate('document.querySelector(".go").hidden'), mode !== 'play')
    if (process.env.FM_ART_PREVIEWS) {
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
      const clip = await evaluate(
        '(()=>{const r=document.querySelector(".ground").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()',
      )
      const { data } = await send('Page.captureScreenshot', { clip })
      await mkdir(process.env.FM_ART_PREVIEWS, { recursive: true })
      await writeFile(join(process.env.FM_ART_PREVIEWS, mode + '.png'), Buffer.from(data, 'base64'))
    }
  }
  await click('.penalty-lab .go')
  await sleep(320)
  await click('.penalty-lab .go')
  await wait('document.querySelector(".go").textContent === "再练一球"')
  assert.match(await evaluate('document.querySelector(".penalty-lab .call").textContent'), /力度/)
  await evaluate(
    'const role=document.querySelector(".penalty-lab .role");role.value="keep";role.dispatchEvent(new Event("change"))',
  )
  await click('.penalty-lab .go')
  const { x, y } = await evaluate(
    '(()=>{const r=document.querySelector(".penalty-lab .pad").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
  )
  for (const [type, points] of [
    ['touchStart', [{ x, y }]],
    ['touchMove', [{ x: x + 28, y: y - 20 }]],
    ['touchEnd', []],
  ])
    await send('Input.dispatchTouchEvent', { type, touchPoints: points })
  await wait('document.querySelector(".go").textContent === "再练一球"')
  assert.match(await evaluate('document.querySelector(".penalty-lab .call").textContent'), /手套/)
  await click('.penalty-lab .repeat')
  await wait('document.querySelector(".go").textContent === "再练一球"')
  assert.match(await evaluate('document.querySelector(".penalty-lab .call").textContent'), /留在中路/)
  await click('.penalty-lab .leave')
  await wait('!document.querySelector(".penalty-lab")')
  await click('[data-action="penalty-training"]')
  await wait('!!document.querySelector(".penalty-lab canvas")')
  await click('.penalty-lab .leave')
  await wait('!document.querySelector(".penalty-lab")')
  await evaluate(
    `const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:get.call(this,type,...args)}`,
  )
  await click('[data-action="penalty-training"]')
  await wait('document.querySelector(".penalty-lab .call")?.textContent.includes("WebGL 2")')
  await click('.penalty-lab .leave')
  assert.deepEqual(errors, [])
  console.log('PASS: challenge → shoot → touch dive → close/reopen → WebGL fallback')
} finally {
  chrome.kill('SIGKILL')
  await closed
  await vite.close()
  await rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
}
