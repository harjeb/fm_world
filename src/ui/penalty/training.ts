import './training.css'
import { createHud, shotHud } from './hud.ts'
import { lockSetPieceFrame } from './frame-lock.ts'
import { attachCameraControls } from './camera-controls.ts'
import { attrRating } from '../../game/scale.ts'
import type { Player } from '../../game/types.ts'
import {
  ballAt,
  band,
  clamp,
  fromKeeperPad,
  GLOVE_Z,
  HALF,
  HEIGHT,
  keeperAt,
  KICKS,
  makeShot,
  meter,
  planPenaltyKeeperDive,
  postKeeperPose,
  R,
  resolve,
  SPOT,
  STANDARD,
  type Ability,
  type Dive,
  type Kick,
  type Point,
  type Result,
  type Shot,
} from '../../game/penalty/practice.ts'
import {
  ENVIRONMENT_LIST,
  ENVIRONMENT_PRESETS,
  type PitchEnvironment,
} from '../../game/penalty/environment.ts'
import { createGround, type Inspection } from './scene.ts'
import { loadMatchday, type Team } from './matchday.ts'
import { finishBall, netImpact, POST_DURATION, SETTLE, settleNonGoalBall, type Impact } from '../../game/penalty/net.ts'

export interface PenaltyStageContext {
  title: string
  eyebrow: string
  env: PitchEnvironment
  prompt: string
  role: 'kick' | 'keep'
  keeperless?: boolean
  forcedKick?: Kick
  forcedOutside?: boolean
  keeperBias?: 'left' | 'right' | 'early' | 'mixed'
  onAttempt(outcome: {
    result: Result
    defend: boolean
    kick: Kick
    outside: boolean
    aim: Point
    landing: Point
  }): { finished: boolean; passed?: boolean; nextRole?: 'kick' | 'keep'; nextKeeperless?: boolean; message: string; buttonLabel?: string }
}

function options(select: HTMLSelectElement, rows: [string, string][]) {
  select.replaceChildren(...rows.map(([value, label]) => new Option(label, value)))
}
export function playerPenaltyAbility(player?: Player): Ability {
  if (!player) return STANDARD
  const a = { ...STANDARD }
  for (const key of Object.keys(a) as (keyof Ability)[])
    a[key] = clamp(attrRating(key, player.attrs[key], player.positions.GK > 0) / 100)
  return a
}
function ratingTier(score: number) {
  return score >= 80 ? 'hi' : score >= 60 ? 'mid' : 'base'
}
function renderRatings(host: HTMLElement, rows: [string, number][]) {
  host.innerHTML =
    `<span class="ratings-title">训练评分</span>` +
    rows
      .map(
        ([label, score]) =>
          `<span class="rating-chip" data-tier="${ratingTier(score)}" style="--score:${score}%"><span>${label}</span><b>${score}</b></span>`,
      )
      .join('')
}

export async function openPenaltyTraining(
  roster: readonly Player[],
  club: Team,
  stageCtx?: PenaltyStageContext,
) {
  if (document.querySelector('.penalty-lab')) return
  const d = document.createElement('dialog')
  d.className = 'penalty-lab'
  d.setAttribute('aria-labelledby', 'penalty-title')
  d.innerHTML = `<header class="lab-head">
      <div class="lab-title">
        <span class="lab-eyebrow">${stageCtx ? stageCtx.eyebrow : 'S3 · 自由训练'}</span>
        <h2 id="penalty-title">${stageCtx ? stageCtx.title : '十二码之夜'}</h2>
        <span class="lab-club"><i class="lab-club-dot"></i><span class="lab-club-name"></span></span>
      </div>
      <button class="leave" type="button">${stageCtx ? '返回活动页' : '退出训练'}</button>
    </header>
    <div class="pitch3">
      <div class="ground"></div>${shotHud}
      <div class="pad" tabindex="0" role="group" aria-label="扑救方向盘">
        <svg class="pad-dial" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle class="pad-outer" r="46"/>
          <circle class="pad-deadzone" r="24" stroke-dasharray="3 3"/>
          <g class="pad-ticks">
            <path d="M0 -42v6 M0 42v-6 M-42 0h6 M42 0h-6"/>
            <path d="M-29 -29l5 5 M29 -29l-5 5 M-29 29l5 -5 M29 29l-5 -5" class="pad-diag"/>
          </g>
        </svg>
        <span class="pad-knob">扑</span>
      </div>
    </div>
    <p class="call" role="status" data-tone="info"></p>
    <div class="ratings" aria-live="polite"></div>
    <div class="settings">
      <label><span>视角</span><select class="role"><option value="kick">我来主罚</option><option value="open">无门将练习</option><option value="keep">我来守门</option></select></label>
      <label><span>主罚手</span><select class="striker"></select></label>
      <label><span>门将</span><select class="keeper"></select></label>
      <label><span>踢法</span><select class="kick"></select></label>
      <label><span>触球脚面</span><select class="foot"></select></label>
      <label><span>球场环境</span><select class="env"></select></label>
      <label><span>装备特写</span><select class="inspect"><option value="play">返回训练镜头</option><option value="player">主罚手球衣</option><option value="keeper">门将球衣</option><option value="ball">比赛用球</option></select></label>
    </div>
    <footer class="lab-foot">
      <div class="lab-actions">
        <button class="go" type="button" data-phase="ready"></button>
        <button class="replay" type="button" hidden>重放动画</button>
        <button class="repeat" type="button" hidden>重扑同一球</button>
      </div>
      <small class="lab-note">${stageCtx ? '活动关卡 · 体能伤病不带回联赛' : '支持进球回放与拖拽移动视角 · 不影响联赛'}</small>
    </footer>`
  document.body.append(d)
  const el = <E extends HTMLElement = HTMLElement>(s: string) => d.querySelector<E>(s)!
  el('.lab-club-name').textContent = club.name
  el('.lab-club-dot').style.backgroundColor = club.color
  const ctrl = new AbortController(),
    opts = { signal: ctrl.signal }
  let frame = 0,
    ground: ReturnType<typeof createGround> | undefined,
    unlockFrame: (() => void) | undefined
  const end = () => {
    ctrl.abort()
    cancelAnimationFrame(frame)
    unlockFrame?.()
    ground?.dispose()
    d.remove()
  }
  el('.leave').addEventListener('click', () => d.close(), opts)
  d.addEventListener('close', end, { once: true })
  d.addEventListener('keydown', (e) => e.stopPropagation(), opts)
  d.showModal()
  const stage = el('.ground'),
    status = el('.call'),
    pitch = el('.pitch3'),
    pad = el('.pad'),
    padKnob = el('.pad-knob'),
    hud = createHud(pitch),
    go = el<HTMLButtonElement>('.go')
  unlockFrame = lockSetPieceFrame(d, pitch, ctrl.signal)
  const setStatus = (text: string, tone: 'info' | 'charge' | 'good' | 'warn' | 'bad' = 'info') => {
    status.textContent = text
    status.dataset.tone = tone
  }
  const failed = () => {
    cancelAnimationFrame(frame)
    pitch.hidden = true
    el('.settings').hidden = true
    el('.ratings').hidden = true
    go.hidden = true
    el('.repeat').hidden = true
    setStatus('无法显示 3D 球场：请使用支持 WebGL 2 的浏览器并开启硬件加速。未消耗次数。', 'bad')
  }
  pitch.hidden = true
  el('.settings').hidden = true
  el('.ratings').hidden = true
  go.hidden = true
  setStatus('正在加载球员、队服和比赛用球…', 'info')
  let art: Awaited<ReturnType<typeof loadMatchday>>
  try {
    art = await loadMatchday(club)
  } catch (error) {
    console.error('无法加载点球训练场资源', error)
    setStatus('美术资源加载失败，请退出后重试。未消耗次数。', 'bad')
    return
  }
  if (!d.open) {
    art.dispose()
    return
  }
  pitch.hidden = false
  el('.settings').hidden = false
  el('.ratings').hidden = false
  go.hidden = false
  try {
    ground = createGround(stage, art, '十二码之夜')
  } catch (error) {
    console.error('无法创建点球训练场', error)
    art.dispose()
    failed()
    return
  }
  const view = ground
  view.canvas.addEventListener('webglcontextlost', failed, opts)
  const inspection = el<HTMLSelectElement>('.inspect')
  const role = el<HTMLSelectElement>('.role'),
    ss = el<HTMLSelectElement>('.striker'),
    gs = el<HTMLSelectElement>('.keeper'),
    ks = el<HTMLSelectElement>('.kick'),
    fs = el<HTMLSelectElement>('.foot'),
    envSelect = el<HTMLSelectElement>('.env')
  const strikers = roster.filter((p) => !p.positions.GK),
    keepers = roster.filter((p) => p.positions.GK > 0)
  for (const [sel, list, fallback] of [
    [ss, strikers, '训练前锋'],
    [gs, keepers, '训练门将'],
  ] as const)
    options(sel, list.length ? list.map((p, i) => [String(i), p.name]) : [['0', fallback]])
  options(
    ks,
    (Object.keys(KICKS) as Kick[]).map((k) => [k, KICKS[k].label]),
  )
  options(
    envSelect,
    ENVIRONMENT_LIST.map((env) => [env.id, `${env.label}（${env.subtitle}）`]),
  )
  const feet = () =>
    options(
      fs,
      KICKS[ks.value as Kick].feet.map((f) => [f, f]),
    )
  feet()

  if (stageCtx) {
    envSelect.value = stageCtx.env.id in ENVIRONMENT_PRESETS ? stageCtx.env.id : 'standard'
    envSelect.disabled = true
    role.value = stageCtx.keeperless ? 'open' : stageCtx.role
    role.disabled = true
    inspection.disabled = true
    if (stageCtx.forcedKick) {
      ks.value = stageCtx.forcedKick
      feet()
      ks.disabled = true
      if (stageCtx.forcedOutside !== undefined) {
        fs.value = stageCtx.forcedOutside ? '外脚背' : KICKS[stageCtx.forcedKick].feet[0]
        fs.disabled = true
      }
    }
  }

  type Phase = 'ready' | 'power' | 'flight' | 'done'
  let phase: Phase = 'ready',
    defend = false,
    keeperless = false,
    stageFinished = false,
    aim: Point = { x: 1.9, y: 1.15 },
    power = 0,
    shot: Shot | null = null,
    dive: Dive | null = null
  let elapsed = 0,
    origin = performance.now(),
    paused: number | null = null,
    stopAt = 0,
    activePointer: number | null = null
  let shooter = STANDARD,
    goalie = STANDARD,
    kick: Kick = 'push',
    currentEnv: PitchEnvironment = stageCtx?.env ?? ENVIRONMENT_PRESETS.standard,
    bounds = band(kick, shooter, currentEnv)
  function clock() {
    return ((paused ?? performance.now()) - origin) / 1000
  }
  function clearPad() {
    padKnob.removeAttribute('style')
    delete pad.dataset.active
    delete pad.dataset.dived
    activePointer = null
  }
  let impact: Impact | null = null
  let outResult: Result | null = null
  let replaying = false
  let replayOrigin = 0
  let lastOpponentShot: Shot | null = null
  const camCtrl = attachCameraControls(d, pitch, stage, view, () => phase, ctrl.signal)
  const sightEl = pitch.querySelector<HTMLElement>('.pk-sight')
  const replayBtn = el<HTMLButtonElement>('.replay')
  const repeat = el<HTMLButtonElement>('.repeat')
  replayBtn.addEventListener(
    'click',
    () => {
      if (!shot || phase !== 'done') return
      replaying = true
      replayOrigin = paused ?? performance.now()
      lastPhase = null
    },
    opts,
  )
  repeat.addEventListener(
    'click',
    () => {
      if (lastOpponentShot && defend && !stageCtx) {
        const previous = lastOpponentShot
        reset()
        start(previous)
      }
    },
    opts,
  )
  function reset() {
    phase = 'ready'
    impact = null
    outResult = null
    replaying = false
    origin = performance.now()
    shot = null
    dive = null
    clearPad()
    camCtrl.reset()
    replayBtn.hidden = true
    currentEnv = stageCtx?.env ?? (ENVIRONMENT_PRESETS[envSelect.value] ?? ENVIRONMENT_PRESETS.standard)
    defend = role.value === 'keep'
    keeperless = role.value === 'open'
    const currentStriker = strikers[Number(ss.value)]
    const currentKeeper = keepers[Number(gs.value)]
    shooter = playerPenaltyAbility(currentStriker)
    goalie = playerPenaltyAbility(currentKeeper)
    kick = ks.value as Kick
    bounds = band(kick, shooter, currentEnv)
    const rating = (n: number) => Math.round(n * 100)
    renderRatings(
      el('.ratings'),
      defend
        ? [
            ['扑救反应', rating(goalie.reflexes)],
            ['爆发', rating(goalie.acceleration)],
            ['手控', rating(goalie.handling)],
          ]
        : [
            ['射术', rating(shooter.shooting)],
            ['力量', rating(shooter.strength)],
            ['镇定', rating(shooter.composure)],
          ],
    )
    view.dress(currentStriker, currentKeeper)
    view.setEnvironment(currentEnv)
    view.setKeeperless(keeperless)
    const inspecting = inspection.value !== 'play'
    const camBar = pitch.querySelector<HTMLElement>('.cam-bar')
    if (camBar) camBar.hidden = inspecting
    view.inspect(inspection.value as Inspection)
    view.mode(defend)
    view.path([])
    repeat.hidden = Boolean(stageCtx) || !defend || !lastOpponentShot
    pad.hidden = !defend || inspecting
    gs.disabled = keeperless
    hud.reset(!inspecting, defend, bounds)
    hud.environment(currentEnv)
    hud.meta(
      defend ? '守门训练' : keeperless ? '空门练习' : stageCtx ? '关卡挑战' : '主罚训练',
      defend
        ? currentKeeper?.name ?? '训练门将'
        : `${KICKS[kick].label} · ${fs.value}`,
    )
    if (!stageCtx?.forcedKick) ks.disabled = defend
    if (stageCtx?.forcedOutside === undefined) fs.disabled = defend
    go.disabled = false
    go.dataset.phase = 'ready'
    go.textContent = defend ? '让对手主罚' : '瞄准好了 · 开始蓄力'
    setStatus(
      stageCtx
        ? stageCtx.prompt
        : defend
          ? '点开始后观察助跑。推方向盘即扑，不推守中；也可用方向键。'
          : keeperless
            ? '无门将空门模式：专注感受脚法弧线、风向偏移与场地擦地效果。'
            : '拖动球门内的瞄准准星，或用方向键微调落点。',
      'info',
    )
    if (inspecting) {
      pad.hidden = repeat.hidden = go.hidden = true
      setStatus(`${club.name} · 装备特写。切回训练镜头即可继续。`, 'info')
    } else go.hidden = false
  }
  for (const select of [role, ss, gs, ks, fs, envSelect, inspection])
    select.addEventListener(
      'change',
      () => {
        if (select === ks) feet()
        if (select === role && role.value === 'open' && inspection.value === 'keeper') {
          inspection.value = 'play'
        }
        reset()
      },
      opts,
    )
  function start(previous?: Shot) {
    if (stageFinished) {
      d.close()
      return
    }
    if (phase === 'done') {
      reset()
      return
    }
    if (phase === 'flight') return
    if (!defend && phase === 'ready') {
      phase = 'power'
      hud.charge()
      origin = performance.now()
      go.dataset.phase = 'power'
      go.textContent = '锁定力度 · 起脚'
      setStatus('越高越有力，停在右侧上下限范围标记内为最佳力度。', 'charge')
      return
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0],
      rnd = () => Math.random()
    if (defend) {
      const k = (Object.keys(KICKS) as Kick[])[Math.floor(rnd() * 4)],
        b = band(k, shooter, currentEnv)
      const x = k === 'chip' ? (rnd() - 0.5) * 1.4 : (rnd() < 0.5 ? -1 : 1) * (0.8 + rnd() * 2.5)
      shot =
        previous ??
        makeShot(
          k,
          k === 'snap' && rnd() < 0.5,
          { x, y: 0.3 + rnd() * 1.8 },
          b.center + (rnd() - 0.5) * 0.24,
          shooter,
          seed,
          currentEnv,
        )
      lastOpponentShot = shot
      dive = null
      pad.dataset.active = 'true'
    } else {
      power = meter(clock(), bounds.cycle)
      shot = makeShot(kick, fs.value === '外脚背', aim, power, shooter, seed, currentEnv)
      hud.lock(power, shot.zone)
      dive = keeperless ? null : planPenaltyKeeperDive(shot, kick, goalie, rnd, currentEnv, stageCtx?.keeperBias)
    }
    replayBtn.hidden = true
    replaying = false
    outResult = null
    camCtrl.setReplayReady(false)
    repeat.hidden = true
    origin = performance.now()
    phase = 'flight'
    go.disabled = true
    go.dataset.phase = 'flight'
    go.textContent = defend ? '观察出脚…' : '射门中…'
    setStatus(defend ? '对手开始助跑！看准球路，向那个方向推。' : '观察实际落点与球路变化。', 'info')
  }
  go.addEventListener('click', () => start(), opts)
  const lead = () => (defend ? 1.25 : 0.3)
  function commitDive(right: number, up: number) {
    if (!defend || phase !== 'flight' || dive) return
    const dir = fromKeeperPad(right, up)
    let maxReach: number | undefined
    if (shot && shot.time >= 0.7 && Math.sign(dir.x) === Math.sign(shot.target.x)) {
      maxReach = clamp(Math.hypot(shot.target.x, shot.target.y - 1.06), 0.35, 2.95)
    }
    dive = { at: clock() - lead(), dir, maxReach }
    const n = Math.hypot(right, up)
    padKnob.style.transform = `translate(${(right / n) * 26}px,${(-up / n) * 26}px)`
    pad.dataset.dived = 'true'
  }
  function pointer(e: PointerEvent) {
    if (activePointer !== e.pointerId) return
    if (defend) {
      const r = pad.getBoundingClientRect(),
        x = e.clientX - r.left - r.width / 2,
        y = r.top + r.height / 2 - e.clientY
      if (Math.hypot(x, y) > r.width * 0.18) commitDive(x, y)
    } else if (phase === 'ready') aim = view.aimAt(e.clientX, e.clientY) ?? aim
  }
  for (const node of [stage, pad]) {
    node.addEventListener(
      'pointerdown',
      (e) => {
        if (node === stage && camCtrl.shouldInterceptAim(e, phase)) return
        if (
          activePointer !== null ||
          (defend ? node !== pad || phase !== 'flight' : node !== stage || phase !== 'ready')
        )
          return
        node.setPointerCapture(e.pointerId)
        activePointer = e.pointerId
        if (!defend) hud.drag(true)
        pointer(e)
      },
      opts,
    )
    node.addEventListener('pointermove', pointer, opts)
    node.addEventListener(
      'lostpointercapture',
      (e) => {
        if (e.pointerId === activePointer) {
          activePointer = null
          hud.drag(false)
        }
      },
      opts,
    )
  }
  d.addEventListener(
    'keydown',
    (e) => {
      if (e.target instanceof HTMLSelectElement) return
      const ds: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
        q: [-1, 1],
        e: [1, 1],
        z: [-1, -1],
        c: [1, -1],
      }
      const dir = ds[e.key]
      if (!dir) return
      e.preventDefault()
      if (defend) commitDive(...dir)
      else if (phase === 'ready')
        aim = { x: clamp(aim.x + 0.13 * dir[0], -HALF, HALF), y: clamp(aim.y + 0.13 * dir[1], R, HEIGHT) }
    },
    opts,
  )
  function pause() {
    if (paused === null) paused = performance.now()
    activePointer = null
  }
  function resume() {
    if (paused !== null && !document.hidden) {
      origin += performance.now() - paused
      paused = null
    }
  }
  window.addEventListener('blur', pause, opts)
  window.addEventListener('focus', resume, opts)
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()), opts)
  let lastAim: Point | null = null,
    lastPhase: Phase | null = null,
    lastRevision = -1
  function tick() {
    frame = requestAnimationFrame(tick)
    if (paused !== null) return
    elapsed = clock()
    if (phase === 'power') hud.value(meter(elapsed, bounds.cycle))
    let animT = -2
    if (phase === 'flight') {
      animT = elapsed - lead()
    } else if (phase === 'done') {
      if (replaying) {
        const repElapsed = (((paused ?? performance.now()) - replayOrigin) / 1000) * (camCtrl.slowMo ? 0.5 : 1)
        animT = -lead() + repElapsed
        if (animT >= stopAt + POST_DURATION) {
          animT = stopAt + POST_DURATION
          replaying = false
        }
      } else {
        animT = Math.min(stopAt + POST_DURATION, elapsed - lead())
      }
    }

    if (phase === 'flight' && shot) {
      const out = resolve(shot, dive, goalie, { keeperless, env: currentEnv })
      if (animT >= out.at) {
        phase = 'done'
        outResult = out.result
        delete pad.dataset.active
        impact = netImpact(shot, out.result)
        stopAt = out.at
        const n = 40
        view.path(Array.from({ length: n + 1 }, (_, i) => ballAt(shot!, (stopAt * i) / n)))
        hud.outcome(out.result, defend, `力度${shot.zone}`)
        const isGoal = out.result === '进球' || out.result === '碰到仍进'
        replayBtn.hidden = false
        replayBtn.textContent = isGoal ? '重放进球' : '重放动画'
        camCtrl.setReplayReady(true)
        const tone = isGoal
          ? defend
            ? 'bad'
            : 'good'
          : out.result === '抱住' || out.result === '挡出'
            ? defend
              ? 'good'
              : 'warn'
            : out.result === '击中门框'
              ? 'warn'
              : defend
                ? 'good'
                : 'bad'
        if (stageCtx) {
          const step = stageCtx.onAttempt({
            result: out.result,
            defend,
            kick,
            outside: fs.value === '外脚背',
            aim,
            landing: shot.target,
          })
          stageCtx.prompt = step.message
          setStatus(`${out.result} · 力度${shot.zone}。${step.message}`, step.finished ? (step.passed ? 'good' : 'bad') : tone)
          if (step.nextRole) role.value = step.nextKeeperless ? 'open' : step.nextRole
          if (step.finished) {
            stageFinished = true
            go.disabled = false
            go.dataset.phase = 'done'
            go.textContent = step.buttonLabel ?? '返回活动页'
          } else {
            go.disabled = false
            go.dataset.phase = 'done'
            go.textContent = step.buttonLabel ?? '下一脚'
          }
        } else {
          setStatus(
            `${out.result} · 力度${shot.zone}。${defend ? (dive ? '黄线是实际球路，可对照手套位置。可拖拽画面移动视角或点重放。' : '本球选择留在中路。可拖拽画面移动视角或点重放。') : '圆形准星是预期落点，黄线是实际球路；可直接拖拽画面旋转视角并重放动画。'}`,
            tone,
          )
          go.disabled = false
          go.dataset.phase = 'done'
          go.textContent = '再练一球'
          repeat.hidden = !defend
        }
      }
    }

    const afterLine = phase === 'done' ? Math.max(0, animT - stopAt) : 0
    const sinceImpact = impact && animT > stopAt ? afterLine - impact.delay : -1
    const netMoving = !!impact && sinceImpact >= -0.2 && sinceImpact < SETTLE
    const postMoving =
      phase === 'done' && (replaying || (elapsed - lead() - stopAt < POST_DURATION + 0.12))
    const weatherAnimating = currentEnv.weather !== 'clear'
    if (
      !netMoving &&
      !postMoving &&
      !weatherAnimating &&
      inspection.value === 'play' &&
      phase !== 'flight' &&
      lastPhase === phase &&
      lastAim === aim &&
      lastRevision === view.revision
    )
      return
    lastPhase = netMoving || postMoving ? null : phase
    lastAim = aim
    lastRevision = view.revision

    const kPose =
      shot && animT > stopAt
        ? postKeeperPose(dive, goalie, stopAt, afterLine, outResult === '抱住', currentEnv)
        : { ...keeperAt(dive, goalie, animT, currentEnv), landed: 0 }

    let ballPos = { x: 0, y: R, z: SPOT }
    if (shot) {
      if (animT <= 0) {
        ballPos = { x: 0, y: R, z: SPOT }
      } else if (animT <= stopAt) {
        ballPos = ballAt(shot, animT)
      } else if (impact) {
        ballPos = finishBall(shot, impact, afterLine)
      } else {
        const p0 = ballAt(shot, stopAt)
        const u0 = clamp(stopAt / shot.time)
        const du = 1 / Math.max(0.15, shot.time)
        const vel = {
          x: (shot.target.x + shot.curve * 4 * (1 - 2 * u0)) * du,
          y: (shot.target.y - R + shot.arc * 4 * (1 - 2 * u0)) * du,
          z: -SPOT * du,
        }
        const kind =
          outResult === '抱住'
            ? 'catch'
            : outResult === '挡出'
              ? 'parry'
              : outResult === '击中门框'
                ? 'frame'
                : 'miss'
        const glovesMid = {
          x: (kPose.left.x + kPose.right.x) * 0.5,
          y: (kPose.left.y + kPose.right.y) * 0.5,
          z: GLOVE_Z + 0.04,
        }
        ballPos = settleNonGoalBall(p0, vel, kind, afterLine, glovesMid)
      }
    }

    view.draw(
      ballPos,
      kPose,
      phase === 'flight' || phase === 'done' ? clamp(1 + animT / lead()) : 0,
      sinceImpact >= 0 && sinceImpact < SETTLE ? impact : null,
      sinceImpact,
      elapsed * 0.55,
      performance.now() / 1000,
      shot && (phase === 'flight' || phase === 'done') ? Math.max(0, animT) : 0,
    )
    if (sightEl) {
      const hideSight = defend || inspection.value !== 'play' || replaying || view.isCustomCamera || camCtrl.freeLook
      sightEl.style.visibility = hideSight ? 'hidden' : 'visible'
      if (!hideSight) hud.locate(view.aimScreen(aim))
    }
  }
  reset()
  tick()
}
