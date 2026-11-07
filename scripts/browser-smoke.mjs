import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = process.env.FM_BASE ?? 'http://127.0.0.1:8787'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const username = `browser${Date.now().toString(36)}`
const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-chrome-smoke-'))

const chrome = spawn('chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=0', `--user-data-dir=${chromeDir}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' })
const chromeClosed = new Promise((resolve) => { chrome.once('error', resolve); chrome.once('close', resolve) })

let ws
let nextId = 1
const pending = new Map()
const errors = []

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, awaitPromise = true) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'page exception')
  return result.result?.value
}

async function waitFor(expression, timeout = 15000) {
  const started = Date.now()
  for (;;) {
    try {
      if (await evaluate(expression)) return
    } catch {}
    if (Date.now() - started > timeout) throw new Error(`timeout: ${expression}`)
    await sleep(200)
  }
}

async function click(selector) {
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`)
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options)
  const data = await response.json()
  if (!response.ok) throw new Error(`${path}: ${data.error ?? response.status}`)
  return data
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      const port = fs.readFileSync(path.join(chromeDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]
      const info = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
      const page = info.find((item) => item.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
        break
      }
    } catch {}
    await sleep(200)
  }
  if (!ws) throw new Error('could not connect to Chromium')

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id)
      if (message.error) item.reject(new Error(message.error.message))
      else item.resolve(message.result)
      return
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.text ?? 'exception')
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text)
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.navigate', { url: BASE })
  await waitFor(`document.readyState === 'complete'`)
  await waitFor(`!!document.querySelector('[data-action="account-open"]')`)

  // 启动页：联机流程直接选「登录」。
  await click('[data-action="boot-online"]')
  await waitFor(`!!document.querySelector('#account-username')`)
  await click('[data-action="account-mode"]')
  await waitFor(`!!document.querySelector('#account-username')`)
  await evaluate(`document.querySelector('#account-username').value = ${JSON.stringify(username)}; document.querySelector('#account-password').value = 'secret123'; true`)
  await click('[data-action="account-submit"]')
  await waitFor(`!!localStorage.getItem('fm-online-token')`, 20000)
  await waitFor(`document.body.innerText.includes(${JSON.stringify(username)})`, 20000)
  await click('[data-nav="world"]')
  await waitFor(`document.body.innerText.includes('三级共享世界') && document.body.innerText.includes('二级联赛')`, 10000)
  await click('[data-nav="home"]')
  let token = await evaluate(`localStorage.getItem('fm-online-token')`)
  if (!token) throw new Error('missing online token')

  let auth = { Authorization: `Bearer ${token}` }
  let game = (await api('/api/game', { headers: auth })).game
  if (game.version !== 3 || game.roster.length < 10) throw new Error('server game invalid')

  // 刷新后应能用持久化 token 恢复账号和联机存档。
  await send('Page.reload')
  await waitFor(`document.readyState === 'complete'`)
  await waitFor(`document.body.innerText.includes(${JSON.stringify(username)})`, 20000)
  await waitFor(`!!document.querySelector('[data-action="account-open"]')`)
  const restoredToken = await evaluate(`localStorage.getItem('fm-online-token')`)
  if (restoredToken !== token) throw new Error('online session did not restore after reload')

  await click('[data-nav="club"]')
  await waitFor(`document.body.innerText.includes('培养免费')`)
  if (!(await evaluate(`document.body.innerText.includes('医疗 3 级') && document.body.innerText.includes('每项主属性各有自己的上限') && document.body.innerText.includes('LV1')`))) throw new Error('facility growth, stage label or free training rules missing')
  if (!(await evaluate(`!!document.querySelector('[data-action="club-upgrade"][data-facility="stadium"]')`))) throw new Error('stadium upgrade button missing')
  await click('[data-nav="transfer"]')
  await waitFor(`document.body.innerText.includes('仅与本地 NPC 交易')`)
  await click('[data-nav="club"]')
  await click('[data-action="club-upgrade"][data-facility="academy"]')
  await waitFor(`document.body.innerText.includes('设施已升级')`)
  await waitFor(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).economy.academy === 2`)
  await click('[data-action="club-upgrade"][data-facility="medical"]')
  await waitFor(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).economy.medical === 2`)

  await click('[data-nav="training"]')
  await waitFor(`!!document.querySelector('#training-player-select')`)
  await evaluate(`(() => { const el = document.querySelector('#training-player-select'); const game = JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')); el.value = game.roster.find(p => !p.positions.GK).id; el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await waitFor(`!!document.querySelector('[data-action="start-training"]')`)
  await click('[data-action="start-training"]')
  await waitFor(`!!document.querySelector('[data-action="training-execute"]')`, 20000)
  await waitFor(`Object.values(JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training).some(s => s.facilityLevels?.stadium === 1 && s.facilityLevels?.academy === 2)`)
  if (!(await evaluate(`document.body.innerText.includes('设施加成按本轮开始时的快照计算')`))) throw new Error('facility level snapshot missing')
  const playerId = await evaluate(`document.querySelector('#training-player-select').value`)
  const initialTraining = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(playerId)}]`)
  if (initialTraining.actionsTotal !== 30 || initialTraining.fatigue !== 0) throw new Error('new training session should have 30 actions and full training stamina')
  const teammateId = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).roster.find(p => !p.positions.GK && p.id !== ${JSON.stringify(playerId)}).id`)
  await evaluate(`(() => { const el = document.querySelector('#training-player-select'); el.value = ${JSON.stringify(teammateId)}; el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await click('[data-action="start-training"]')
  await waitFor(`!!JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(teammateId)}]`)
  await evaluate(`(() => { const el = document.querySelector('#training-player-select'); el.value = ${JSON.stringify(playerId)}; el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  if (initialTraining.scheduleVersion !== 1) throw new Error('new training session is not calendar-based')
  await waitFor(`!!document.querySelector('[data-training-activity="exchange"]')`)
  await click('[data-training-activity="exchange"]')
  await waitFor(`!!document.querySelector('[data-training-teammate="${teammateId}"]')`)
  await evaluate(`(() => { const el = document.querySelector('[data-training-teammate="${teammateId}"]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  const trainingBalance = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).economy.balance`)
  await click('[data-action="training-execute"]')
  await waitFor(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(playerId)}].action === 1`)
  const training = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(playerId)}]`)
  const teammateTraining = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(teammateId)}]`)
  if (training.facilityLevels.medical !== 2 || training.fatigue !== 0 || !training.exchangeMatches?.length) throw new Error('Monday exchange did not record its result, or it used stamina')
  if (teammateTraining.action !== 1 || teammateTraining.fatigue !== 0 || teammateTraining.pendingEventId !== 'main_intake') throw new Error('teammate did not execute training and receive their own event')
  if (!(await evaluate(`document.querySelector('[data-action="open-training"][data-player="${teammateId}"]').innerText.includes('待处理事件')`))) throw new Error('teammate pending event is not visible')
  if (await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).economy.balance`) !== trainingBalance) throw new Error('training unexpectedly charged coins')
  if (await evaluate(`!!document.querySelector('[data-action="event-option"]')`)) await click('[data-action="event-option"]')
  await waitFor(`!!document.querySelector('[data-training-activity="rest"]')`)
  await click('[data-training-activity="rest"]')
  const staminaBeforeRest = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(playerId)}].fatigue`)
  await click('[data-action="training-execute"]')
  await waitFor(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(playerId)}].action === 2`)
  if (await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).training[${JSON.stringify(playerId)}].fatigue`) !== Math.max(0, staminaBeforeRest - 30)) throw new Error('training rest recovery incorrect')

  // 赛前配置定时、体力和伤病规则，保存后友谊赛应自动执行。
  const pair = game.lineup.starters.flatMap((starter) => {
    const position = { gk: 'GK', cb: 'CB', w: 'W', cm: 'CM', st: 'ST' }[starter.role.split('_')[0]]
    return game.lineup.bench.filter((id) => game.roster.find((player) => player.id === id)?.positions[position] > 0)
      .map((id) => ({ outId: starter.playerId, inId: id }))
  })[0]
  if (!pair) throw new Error('no compatible substitution pair in lineup')
  await click('[data-nav="lineup"]')
  await click('[data-action="auto-sub-add"]')
  await evaluate(`(() => { const el = document.querySelector('[data-auto-sub-out="0"]'); el.value = ${JSON.stringify(pair.outId)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await evaluate(`(() => { const el = document.querySelector('[data-auto-sub-in="0"]'); el.value = ${JSON.stringify(pair.inId)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await evaluate(`(() => { const el = document.querySelector('[data-auto-sub-time="0"]'); el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await evaluate(`(() => { const el = document.querySelector('#auto-sub-stamina'); el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await evaluate(`(() => { const el = document.querySelector('#auto-sub-injury'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await click('[data-action="lineup-save"]')
  await waitFor(`document.body.innerText.includes('阵容与自动换人规则已保存')`)
  const plan = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).autoSubs`)
  if (!plan.onInjury || plan.staminaBelow !== 1 || plan.timed[0]?.atMinute !== 1 || plan.timed[0]?.outId !== pair.outId || plan.timed[0]?.inId !== pair.inId) throw new Error('automatic substitution plan not saved')

  await click('[data-nav="challenge"]')
  await waitFor(`!!document.querySelector('[data-action="start-challenge"]')`, 20000)
  await sleep(600)
  await evaluate(`window.__realFetch = window.fetch; window.fetch = async (...args) => { const response = await window.__realFetch(...args); if (args[0] === '/api/game' && args[1]?.method === 'PUT') await new Promise(resolve => setTimeout(resolve, 700)); return response }; true`)
  await click('[data-action="start-challenge"]')
  await waitFor(`!!document.querySelector('[data-action="match-skip"]')`, 20000)
  await waitFor(`document.querySelectorAll('.commentary-log .event-line').length >= 2`)
  let previousStep = 0
  for (let i = 0; i < 18; i++) {
    const step = await evaluate(`Number(document.querySelector('.match-controls .muted').innerText.match(/(\\d+) 步/)[1])`)
    if (step < previousStep) throw new Error('friendly rolled back after its own SSE save')
    previousStep = step
    await sleep(120)
  }
  await click('[data-action="match-toggle"]')
  const pausedLines = await evaluate(`document.querySelectorAll('.commentary-log .event-line').length`)
  await sleep(800)
  if (await evaluate(`document.querySelectorAll('.commentary-log .event-line').length`) !== pausedLines) throw new Error('commentary advanced while match paused')
  const side = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).activeMatch.context.homeAway`)
  if (!(await evaluate(`document.querySelector('.score-team.${side} small').innerText.includes('你')`))) throw new Error('player side mislabelled')
  await click('[data-action="match-coach"]')
  await waitFor(`!!document.querySelector('#match-out')`)
  if (!(await evaluate(`[...document.querySelector('#match-out').options].every(option => option.value.startsWith(${JSON.stringify(side + ':')}))`))) throw new Error('coach controls the wrong team')
  await click('[data-action="match-toggle"]')
  await waitFor(`document.querySelectorAll('.commentary-log .event-line').length > ${pausedLines}`)
  await click('[data-action="match-skip"]')
  await waitFor(`!!document.querySelector('[data-action="replay-toggle"]')`, 20000)
  await click('[data-action="replay-reset"]')
  if (!(await evaluate(`document.querySelector('.replay-score').innerText.includes('0 : 0')`))) throw new Error('replay revealed final score')
  await click('[data-action="replay-toggle"]')
  await waitFor(`document.querySelectorAll('.replay-panel .event-line').length >= 2`)
  await click('[data-action="replay-toggle"]')
  const replayLines = await evaluate(`document.querySelectorAll('.replay-panel .event-line').length`)
  await sleep(800)
  if (await evaluate(`document.querySelectorAll('.replay-panel .event-line').length`) !== replayLines) throw new Error('replay advanced while paused')
  await evaluate(`window.fetch = window.__realFetch; true`)
  await sleep(1500)

  game = (await api('/api/game', { headers: auth })).game
  if (!game.challengeHistory?.length) throw new Error('browser friendly was not persisted online')
  if (!game.challengeHistory[0].commentary?.length || game.challengeHistory[0].goalDetails?.length !== game.challengeHistory[0].score.home + game.challengeHistory[0].score.away) throw new Error('commentary or goals not persisted')
  if (!game.challengeHistory[0].instructions.some((instruction) => instruction.autoReason)) throw new Error('automatic substitution did not execute in friendly')
  if (!Object.keys(game.training ?? {}).length) throw new Error('browser training was not persisted online')

  // SSE：外部修改后页面应自动更新。
  const current = await api('/api/game', { headers: auth })
  const injuredPlayer = current.game.roster.find((player) => player.id === current.game.lineup.starters[0].playerId)
  current.game.injuries = { ...current.game.injuries, [injuredPlayer.seedId]: Date.now() + 2 * 60 * 60 * 1000 }
  current.game.clubName = 'SSE浏览器队'
  await api('/api/game', {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ game: current.game, baseRevision: current.revision }),
  })
  await waitFor(`document.body.innerText.includes('SSE浏览器队')`, 15000)
  await click('[data-nav="academy"]')
  const injuredCard = `[data-action="detail"][data-player="${injuredPlayer.id}"]`
  await waitFor(`!!document.querySelector(${JSON.stringify(injuredCard)})`)
  if (!(await evaluate(`document.querySelector(${JSON.stringify(injuredCard)}).innerText.includes('受伤')`))) throw new Error('injury missing from player card')
  await click(injuredCard)
  if (!(await evaluate(`document.querySelector('.modal').innerText.includes('不影响精力或培养')`))) throw new Error('injury details missing')
  await click('.modal [data-action="close-detail"]')
  await click('[data-nav="lineup"]')
  if (!(await evaluate(`document.body.innerText.includes('后恢复')`))) throw new Error('injury missing from lineup')

  // 自动时间推进：把开赛时间改到过去，服务器 tick 应自动结算并在页面显示。
  await click('[data-nav="season"]')
  await waitFor(`!!document.querySelector('[data-action="start-league"]') || document.body.innerText.includes('第 2 / 38 轮')`, 10000)
  await sleep(500)
  const latest = await api('/api/game', { headers: auth })
  latest.game.season.startedAt = Date.now() - 4 * 6 * 60 * 60 * 1000
  await api('/api/game', {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ game: latest.game, baseRevision: latest.revision }),
  })
  await waitFor(`/第 (2|3|4|5) \\/ 38 轮/.test(document.body.innerText) || document.body.innerText.includes('赛季结束')`, 45000) // 须长于默认 FM_TICK_MS（30 秒）

  const final = await api('/api/game', { headers: auth })
  if (final.game.season.round < 2) throw new Error('auto season advance did not persist')

  // 离线自动推进：退出登录后把本地存档时间拨到过去，刷新页面应自动结算。
  await click('[data-action="account-open"]')
  await waitFor(`!!document.querySelector('[data-action="account-logout"]')`)
  await click('[data-action="account-logout"]')
  await waitFor(`!localStorage.getItem('fm-online-token')`, 10000)
  const offlineClock = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { try { const key = 'fm-seven-a-side-save-v3'; const save = JSON.parse(localStorage.getItem(key)); if (save) { save.season.startedAt = Date.now() - 12 * 3 * 6 * 60 * 60 * 1000; localStorage.setItem(key, JSON.stringify(save)); } } catch {} })()`,
  })
  await send('Page.reload')
  await waitFor(`document.readyState === 'complete'`)
  await waitFor(`(() => { const save = JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')); return save && save.season.round >= 10 })()`, 20000)
  const localRound = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).season.round`)
  await click('[data-nav="season"]')
  await waitFor(`document.body.innerText.includes('/ 38 轮') || document.body.innerText.includes('赛季结束')`, 10000)
  if (localRound < 10) throw new Error('offline auto season advance did not persist')
  try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: offlineClock.identifier }) } catch {}

  // 从赛季末通过浏览器开始下一季，保留球员、余额与上一季赛程。
  const prior = await evaluate(`(() => { const save = JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')); return { roster: save.roster.map(p => p.id), balance: save.economy.balance }; })()`)
  const finishSeason = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const key = 'fm-seven-a-side-save-v3'; const save = JSON.parse(localStorage.getItem(key)); if (save) { save.season.round = 38; save.season.finished = true; save.season.fixtures.forEach(f => { f.played = true; f.score ??= { home: 0, away: 0 } }); save.economy.lastIncomeRound = 38; if (save.market) save.market.lastSettledRound = 38; localStorage.setItem(key, JSON.stringify(save)); } })()`,
  })
  await send('Page.reload')
  await waitFor(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3'))?.season.finished === true && !!document.querySelector('[data-action="next-season"]')`)
  try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: finishSeason.identifier }) } catch {}
  await click('[data-action="next-season"]')
  await waitFor(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).season.index === 2`)
  const nextSeason = await evaluate(`JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3'))`)
  if (JSON.stringify(nextSeason.roster.map(p => p.id)) !== JSON.stringify(prior.roster) || nextSeason.economy.balance !== prior.balance || nextSeason.seasonHistory?.[0]?.index !== 1) throw new Error('next season lost club data or history')

  // 重新登录验证联赛由服务器按现实时间推进，离开页面也不能暂停。
  await click('[data-action="account-open"]')
  await waitFor(`!!document.querySelector('#account-username')`)
  await evaluate(`document.querySelector('#account-username').value = ${JSON.stringify(username)}; document.querySelector('#account-password').value = 'secret123'; true`)
  await click('[data-action="account-submit"]')
  await waitFor(`!!localStorage.getItem('fm-online-token')`, 20000)
  token = await evaluate(`localStorage.getItem('fm-online-token')`)
  auth = { Authorization: `Bearer ${token}` }
  await click('[data-nav="season"]')
  await click('[data-action="start-league"]')
  await waitFor(`!!document.querySelector('[data-league-clock]')`, 20000)
  if (await evaluate(`!!document.querySelector('[data-action="match-toggle"], [data-action="match-skip"], [data-speed]')`)) throw new Error('league exposes pause/speed/skip controls')
  const live = await api('/api/game', { headers: auth })
  const liveSide = live.game.activeMatch.context.homeAway
  if (!(await evaluate(`document.querySelector('.score-team.${liveSide} small').innerText.includes('你')`))) throw new Error('league player side mislabelled')
  await click('[data-action="match-coach"]')
  await waitFor(`!!document.querySelector('#match-out')`)
  if (!(await evaluate(`[...document.querySelector('#match-out').options].every(option => option.value.startsWith(${JSON.stringify(liveSide + ':')}))`))) throw new Error('league coach controls the wrong team')
  if (!(await evaluate(`[...document.querySelector('#match-mentality').options].map(o => o.value).join(',') === 'attack,balanced,defend'`))) throw new Error('match tactics expose unexpected options')
  await evaluate(`document.querySelector('#match-mentality').value = 'balanced'; true`)
  await click('[data-action="match-tactics-apply"]')
  await waitFor(`document.body.innerText.includes('战术已更新')`, 10000)
  const beforeClock = await evaluate(`document.querySelector('[data-league-clock]').innerText`)
  await click('[data-nav="home"]')
  await sleep(2200)
  await click('[data-nav="match"]')
  await waitFor(`document.querySelector('[data-league-clock]')?.innerText !== ${JSON.stringify(beforeClock)}`, 10000)
  const running = await api('/api/game', { headers: auth })
  if (!running.game.activeMatch || running.game.activeMatch.elapsedSeconds < 2) throw new Error('league did not continue on server')
  const own = running.game.activeMatch.engineState.teams.find((team) => team.side === liveSide)
  if (own?.mentality !== 'balanced') throw new Error('league balanced mentality was not applied')
  if (running.game.activeMatch.engineState.commentary.some((line) => line.clock > running.game.activeMatch.elapsedSeconds)) throw new Error('future league commentary leaked')

  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`)

  console.log(JSON.stringify({
    ok: true,
    username,
    tokenLength: token.length,
    roster: final.game.roster.length,
    training: Object.keys(final.game.training ?? {}).length,
    matchHistory: final.game.matchHistory.length,
    onlineRound: final.game.season.round,
    localRound,
    clubName: final.game.clubName,
    errors,
  }, null, 2))
} catch (error) {
  try {
    const debug = await evaluate(`({ body: document.body.innerText.slice(0, 1200), key: localStorage.getItem('fm-seven-a-side-save-v3')?.slice(0, 80), token: localStorage.getItem('fm-online-token'), round: (() => { try { return JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')).season.round } catch { return null } })() })`)
    console.error('DEBUG', JSON.stringify(debug, null, 2))
  } catch (debugError) { console.error('debug failed', debugError) }
  throw error
} finally {
  try { ws?.close() } catch {}
  chrome.kill('SIGTERM')
  const killTimer = setTimeout(() => chrome.kill('SIGKILL'), 5000)
  await chromeClosed
  clearTimeout(killTimer)
  fs.rmSync(chromeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
