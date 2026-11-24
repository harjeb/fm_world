import './training.css'
import { createHud, shotHud } from './hud.ts'
import { lockSetPieceFrame } from './frame-lock.ts'
import { attrRating } from '../../game/scale.ts'
import type { Player } from '../../game/types.ts'
import {
  clamp,
  fromKeeperPad,
  HALF,
  HEIGHT,
  keeperAt,
  meter,
  R,
  type Dive,
  type Point,
  type Shot,
} from '../../game/penalty/practice.ts'
import {
  CURVE_OPTIONS,
  fkBand,
  FREEKICK_SPOT_LIST,
  FREEKICK_SPOTS,
  FREEKICK_STYLES,
  makeFreeKickShot,
  makeOpponentFreeKick,
  resolveFreeKick,
  STANDARD_FK_ABILITY,
  WALL_ACTIONS,
  wallGeometry,
  type CurveOption,
  type FreeKickAbility,
  type FreeKickOutcome,
  type FreeKickResult,
  type FreeKickShot,
  type FreeKickSpot,
  type FreeKickStyle,
  type WallAction,
  type WallShift,
} from '../../game/penalty/freekick.ts'
import {
  ENVIRONMENT_LIST,
  ENVIRONMENT_PRESETS,
  type PitchEnvironment,
} from '../../game/penalty/environment.ts'
import { createGround } from './scene.ts'
import { loadMatchday, type Team } from './matchday.ts'
import { finishBall, netImpact, SETTLE, type Impact } from '../../game/penalty/net.ts'

export interface FreeKickStageContext {
  title: string
  eyebrow: string
  env: PitchEnvironment
  prompt: string
  spotId: FreeKickSpot['id']
  role: 'kick' | 'keep'
  keeperless?: boolean
  wallless?: boolean
  aiWallAction?: WallAction
  forcedStyle?: FreeKickStyle
  onAttempt(info: {
    result: FreeKickResult
    defend: boolean
    style: FreeKickStyle
    underWall: boolean
    landing: Point
  }): {
    finished: boolean
    passed?: boolean
    nextRole?: 'kick' | 'keep'
    nextSpotId?: FreeKickSpot['id']
    message: string
    buttonLabel?: string
  }
}

function options(select: HTMLSelectElement, rows: [string, string][]) {
  select.replaceChildren(...rows.map(([value, label]) => new Option(label, value)))
}

function fkAbility(striker?: Player, keeper?: Player, headerMate?: Player): FreeKickAbility {
  const s = { ...STANDARD_FK_ABILITY }
  if (striker) {
    const gk = striker.positions.GK > 0
    s.shooting = clamp(attrRating('shooting', striker.attrs.shooting, gk) / 100)
    s.passing = clamp(attrRating('passing', striker.attrs.passing, gk) / 100)
    s.strength = clamp(attrRating('strength', striker.attrs.strength, gk) / 100)
    s.vision = clamp(attrRating('vision', striker.attrs.vision, gk) / 100)
    s.composure = clamp(attrRating('composure', striker.attrs.composure, gk) / 100)
  }
  if (keeper) {
    s.reflexes = clamp(attrRating('reflexes', keeper.attrs.reflexes, true) / 100)
    s.acceleration = clamp(attrRating('acceleration', keeper.attrs.acceleration, true) / 100)
    s.handling = clamp(attrRating('handling', keeper.attrs.handling, true) / 100)
  }
  if (headerMate) {
    const gk = headerMate.positions.GK > 0
    s.teammateOffBall = clamp(attrRating('offBall', headerMate.attrs.offBall, gk) / 100)
    s.teammateHeading = clamp(attrRating('heading', headerMate.attrs.heading, gk) / 100)
    s.teammateStrength = clamp(attrRating('strength', headerMate.attrs.strength, gk) / 100)
  }
  return s
}

function ratingTier(score: number) {
  return score >= 80 ? 'hi' : score >= 60 ? 'mid' : 'base'
}
function renderRatings(host: HTMLElement, rows: [string, number][]) {
  host.innerHTML =
    `<span class="ratings-title">定位球评分</span>` +
    rows
      .map(
        ([label, score]) =>
          `<span class="rating-chip" data-tier="${ratingTier(score)}" style="--score:${score}%"><span>${label}</span><b>${score}</b></span>`,
      )
      .join('')
}

export async function openFreeKickLab(
  roster: readonly Player[],
  club: Team,
  stageCtx?: FreeKickStageContext,
) {
  if (document.querySelector('.penalty-lab')) return
  const d = document.createElement('dialog')
  d.className = 'penalty-lab freekick-lab'
  d.setAttribute('aria-labelledby', 'freekick-title')
  d.innerHTML = `<header class="lab-head">
      <div class="lab-title">
        <span class="lab-eyebrow">${stageCtx ? stageCtx.eyebrow : '3D 定位球 · 自由训练'}</span>
        <h2 id="freekick-title">${stageCtx ? stageCtx.title : '任意球实验室'}</h2>
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
      <label><span>训练模式</span><select class="role"><option value="kick">我来主罚（有人墙+门将）</option><option value="open">无门将练习（保留人墙）</option><option value="empty">无门将无人墙（纯空门）</option><option value="keep">我来防守（布人墙+扑救）</option></select></label>
      <label><span>球位选择</span><select class="fk-spot"></select></label>
      <label><span>主罚球员</span><select class="striker"></select></label>
      <label><span>踢法 / 战术</span><select class="fk-style"></select></label>
      <label><span>弧度旋向</span><select class="fk-curve"></select></label>
      <label><span>人墙动作</span><select class="fk-wall-action"></select></label>
      <label><span>人墙站位</span><select class="fk-wall-shift"><option value="0">标准封近角</option><option value="-1">向左微移半步</option><option value="1">向右微移半步</option></select></label>
      <label><span>球场环境</span><select class="env"></select></label>
    </div>
    <footer class="lab-foot">
      <div class="lab-actions">
        <button class="go" type="button" data-phase="ready"></button>
      </div>
      <small class="lab-note">${stageCtx ? '活动关卡 · 配合破门同样计过关' : '不限次数 · 可切换无门将/人墙与全部赛季环境'}</small>
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
  pitch.hidden = true
  el('.settings').hidden = true
  el('.ratings').hidden = true
  go.hidden = true
  setStatus('正在布置 3D 任意球场地、人墙与接应球员…', 'info')

  let art: Awaited<ReturnType<typeof loadMatchday>>
  try {
    art = await loadMatchday(club)
  } catch (error) {
    console.error('无法加载任意球实验室资源', error)
    setStatus('美术资源加载失败，请退出后重试。', 'bad')
    return
  }
  if (!d.open) {
    art.dispose()
    return
  }

  try {
    ground = createGround(stage, art, '任意球实验室')
  } catch (error) {
    console.error('无法创建任意球实验室', error)
    art.dispose()
    setStatus('无法显示 3D 球场：请使用支持 WebGL 2 的浏览器并开启硬件加速。', 'bad')
    return
  }
  const view = ground

  // Spawn 4 wall defenders + 1 draft-stopper lying defender + 1 box teammate + 1 box marker
  const oppKit: Team = { name: '防守人墙', color: club.color.toLowerCase() === '#24588a' ? '#2c6b56' : '#24588a' }
  const wallFigures = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      art.spawnKitFigure(oppKit, { id: `wall-${i}`, name: `人墙${i + 1}`, number: 4 + i, height: 183 + (i % 2) * 3 }),
    ),
  )
  const lieFigure = await art.spawnKitFigure(oppKit, { id: 'wall-lie', name: '卧草后卫', number: 2, height: 178 })
  const mateOutfield = roster.filter((p) => !p.positions.GK)
  const headerMatePlayer = [...mateOutfield].sort((a, b) => b.attrs.heading - a.attrs.heading)[1] ?? mateOutfield[0]
  const mateFigure = await art.spawnKitFigure(club, {
    id: headerMatePlayer?.id ?? 'mate-header',
    name: headerMatePlayer?.name ?? '后点队友',
    number: headerMatePlayer?.number ?? 11,
    height: headerMatePlayer?.height ?? 186,
  })
  const markerFigure = await art.spawnKitFigure(oppKit, { id: 'box-marker', name: '盯防中卫', number: 5, height: 185 })

  for (const wf of wallFigures) view.extras.add(wf.root)
  view.extras.add(lieFigure.root, mateFigure.root, markerFigure.root)

  pitch.hidden = false
  el('.settings').hidden = false
  el('.ratings').hidden = false
  go.hidden = false

  const role = el<HTMLSelectElement>('.role'),
    spotSel = el<HTMLSelectElement>('.fk-spot'),
    strikerSel = el<HTMLSelectElement>('.striker'),
    styleSel = el<HTMLSelectElement>('.fk-style'),
    curveSel = el<HTMLSelectElement>('.fk-curve'),
    wallActSel = el<HTMLSelectElement>('.fk-wall-action'),
    wallShiftSel = el<HTMLSelectElement>('.fk-wall-shift'),
    envSelect = el<HTMLSelectElement>('.env')

  const strikers = roster.filter((p) => !p.positions.GK),
    keepers = roster.filter((p) => p.positions.GK > 0)
  options(strikerSel, strikers.length ? strikers.map((p, i) => [String(i), p.name]) : [['0', '训练主罚手']])
  options(spotSel, FREEKICK_SPOT_LIST.map((s) => [s.id, s.label]))
  options(styleSel, (Object.keys(FREEKICK_STYLES) as FreeKickStyle[]).map((k) => [k, FREEKICK_STYLES[k].label]))
  options(curveSel, (Object.keys(CURVE_OPTIONS) as CurveOption[]).map((k) => [k, CURVE_OPTIONS[k].label]))
  options(wallActSel, (Object.keys(WALL_ACTIONS) as WallAction[]).map((k) => [k, WALL_ACTIONS[k]]))
  options(envSelect, ENVIRONMENT_LIST.map((e) => [e.id, `${e.label}（${e.subtitle}）`]))

  if (stageCtx) {
    envSelect.value = stageCtx.env.id in ENVIRONMENT_PRESETS ? stageCtx.env.id : 'standard'
    envSelect.disabled = true
    spotSel.value = stageCtx.spotId
    spotSel.disabled = true
    role.value = stageCtx.wallless ? 'empty' : stageCtx.keeperless ? 'open' : stageCtx.role
    role.disabled = true
    if (stageCtx.aiWallAction && stageCtx.role !== 'keep') {
      wallActSel.value = stageCtx.aiWallAction
      wallActSel.disabled = true
      wallShiftSel.disabled = true
    }
    if (stageCtx.forcedStyle) {
      styleSel.value = stageCtx.forcedStyle
      curveSel.value = FREEKICK_STYLES[stageCtx.forcedStyle].defaultCurve
      styleSel.disabled = true
    }
  }

  type Phase = 'ready' | 'power' | 'flight' | 'done'
  let phase: Phase = 'ready',
    defend = false,
    keeperless = false,
    wallless = false,
    stageFinished = false,
    aim: Point = { x: 1.65, y: 1.55 },
    power = 0,
    shot: FreeKickShot | null = null,
    outcomePlan: FreeKickOutcome | null = null,
    dive: Dive | null = null
  let elapsed = 0,
    origin = performance.now(),
    paused: number | null = null,
    stopAt = 0,
    activePointer: number | null = null
  let ability = STANDARD_FK_ABILITY,
    spot: FreeKickSpot = FREEKICK_SPOTS.arc_center,
    style: FreeKickStyle = 'curl',
    curveOpt: CurveOption = 'left_big',
    wallAction: WallAction = 'jump',
    wallShift: WallShift = 0,
    currentEnv: PitchEnvironment = stageCtx?.env ?? ENVIRONMENT_PRESETS.standard,
    bounds = fkBand(style, ability, currentEnv),
    impact: Impact | null = null

  function clock() {
    return ((paused ?? performance.now()) - origin) / 1000
  }
  function clearPad() {
    padKnob.removeAttribute('style')
    delete pad.dataset.active
    delete pad.dataset.dived
    activePointer = null
  }

  function poseWallAndBox(flightTime: number) {
    const wg = wallGeometry(spot, wallShift)
    const jumpLift =
      !wallless && (wallAction === 'jump' || wallAction === 'lie') && flightTime > 0.02
        ? Math.max(0, Math.sin(clamp(flightTime / 0.58) * Math.PI)) * 0.46
        : 0
    for (let i = 0; i < wallFigures.length; i++) {
      const wf = wallFigures[i]
      if (wallless || i >= wg.count) {
        wf.root.visible = false
        continue
      }
      wf.root.visible = true
      const wx = wg.centerX + (i - (wg.count - 1) / 2) * 0.52
      wf.root.position.set(wx, 0.96, wg.z)
      wf.root.rotation.set(0, 0, 0, 'YXZ')
      wf.arms[0].rotation.set(0.18, 0, 0.22)
      wf.arms[1].rotation.set(0.18, 0, -0.22)
      wf.elbows[0].rotation.set(0.65, 0, 0)
      wf.elbows[1].rotation.set(0.65, 0, 0)
      wf.legs[0].rotation.set(jumpLift > 0.05 ? -0.18 : 0.04, 0, -0.04)
      wf.legs[1].rotation.set(jumpLift > 0.05 ? -0.18 : 0.04, 0, 0.04)
      wf.knees[0].rotation.set(jumpLift > 0.05 ? -0.28 : -0.1, 0, 0)
      wf.knees[1].rotation.set(jumpLift > 0.05 ? -0.28 : -0.1, 0, 0)
      wf.plant(jumpLift)
    }

    // Lying draft-stopper behind wall
    if (!wallless && wallAction === 'lie') {
      lieFigure.root.visible = true
      lieFigure.root.position.set(wg.centerX, 0.24, wg.z - 0.55)
      lieFigure.root.rotation.set(0, 0.15, Math.PI / 2 - 0.08, 'YXZ')
      lieFigure.legs[0].rotation.set(0.15, 0, 0)
      lieFigure.legs[1].rotation.set(-0.08, 0, 0)
      lieFigure.knees[0].rotation.set(-0.35, 0, 0)
      lieFigure.knees[1].rotation.set(-0.2, 0, 0)
      lieFigure.root.updateMatrixWorld(true)
    } else {
      lieFigure.root.visible = false
    }

    // Back-post teammate & defender for loft_pass or far_flank
    const showBoxPair = style === 'loft_pass' || spot.id === 'far_flank'
    mateFigure.root.visible = showBoxPair
    markerFigure.root.visible = showBoxPair
    if (showBoxPair) {
      const ht = spot.headerTarget
      const runIn = flightTime > 0 && shot ? clamp(flightTime / shot.time) : 0
      const headerJump =
        shot?.style === 'loft_pass' && flightTime > shot.time * 0.58
          ? Math.max(0, Math.sin(clamp((flightTime - shot.time * 0.58) / 0.52) * Math.PI)) * 0.52
          : 0
      mateFigure.root.position.set(ht.x - (1 - runIn) * 0.65, 0.96, ht.z + (1 - runIn) * 1.45)
      mateFigure.root.rotation.set(headerJump > 0.1 ? 0.18 : -0.06, Math.PI * 0.92, 0, 'YXZ')
      mateFigure.arms[0].rotation.set(-0.4 * (headerJump > 0 ? 1 : 0.2), 0, -0.25)
      mateFigure.arms[1].rotation.set(-0.4 * (headerJump > 0 ? 1 : 0.2), 0, 0.25)
      mateFigure.plant(headerJump)

      markerFigure.root.position.set(ht.x * 0.82, 0.96, ht.z - 0.55 + (1 - runIn) * 0.5)
      markerFigure.root.rotation.set(0, Math.PI * 0.15, 0, 'YXZ')
      markerFigure.plant(headerJump * 0.68)
    }
  }

  function reset() {
    phase = 'ready'
    impact = null
    shot = null
    outcomePlan = null
    dive = null
    origin = performance.now()
    clearPad()
    currentEnv = stageCtx?.env ?? (ENVIRONMENT_PRESETS[envSelect.value] ?? ENVIRONMENT_PRESETS.standard)
    defend = role.value === 'keep'
    keeperless = role.value === 'open' || role.value === 'empty'
    wallless = role.value === 'empty' || Boolean(stageCtx?.wallless)
    spot = FREEKICK_SPOTS[spotSel.value as FreeKickSpot['id']] ?? FREEKICK_SPOTS.arc_center
    style = styleSel.value as FreeKickStyle
    curveOpt = curveSel.value as CurveOption
    wallAction = wallActSel.value as WallAction
    wallShift = Number(wallShiftSel.value) as WallShift

    const currentStriker = strikers[Number(strikerSel.value)]
    const currentKeeper = keepers[0]
    ability = fkAbility(currentStriker, currentKeeper, headerMatePlayer)
    bounds = fkBand(style, ability, currentEnv)

    const rating = (n: number) => Math.round(n * 100)
    renderRatings(
      el('.ratings'),
      defend
        ? [
            ['扑救反应', rating(ability.reflexes)],
            ['爆发', rating(ability.acceleration)],
            ['手控', rating(ability.handling)],
          ]
        : style === 'loft_pass'
          ? [
              ['传球视野', rating(0.6 * ability.passing + 0.4 * ability.vision)],
              ['队友跑位', rating(ability.teammateOffBall)],
              ['队友头球', rating(ability.teammateHeading)],
            ]
          : [
              ['射术', rating(ability.shooting)],
              ['弧线视野', rating(0.5 * ability.passing + 0.5 * ability.vision)],
              ['力量', rating(ability.strength)],
            ],
    )
    view.dress(currentStriker, currentKeeper)
    view.setSpot(spot.x, spot.z)
    view.setEnvironment(currentEnv)
    view.setKeeperless(keeperless)
    view.mode(defend)
    view.path([])
    poseWallAndBox(-1)
    pad.hidden = !defend
    hud.reset(true, defend, bounds)
    hud.environment(currentEnv)
    hud.meta(
      defend ? '任意球联防' : keeperless ? '空门定位球' : '任意球主罚',
      defend ? `${spot.label} · ${WALL_ACTIONS[wallAction].slice(0, 4)}` : `${FREEKICK_STYLES[style].label} · ${CURVE_OPTIONS[curveOpt].label}`,
    )
    styleSel.disabled = Boolean(stageCtx?.forcedStyle) || defend
    curveSel.disabled = defend
    if (!stageCtx?.aiWallAction) {
      wallActSel.disabled = wallless
      wallShiftSel.disabled = wallless
    }
    go.disabled = false
    go.dataset.phase = 'ready'
    go.textContent = defend ? '布置完毕 · 让对手主罚' : '瞄准好了 · 开始蓄力'
    setStatus(
      stageCtx
        ? stageCtx.prompt
        : defend
          ? '先调整人墙站位与起跳/卧草策略，点开始后用右侧方向盘封堵另一角！'
          : style === 'loft_pass'
            ? '挑传后点配合：瞄准后点队友区域并锁定绿区，由队友冲顶完成破门！'
            : keeperless
              ? '无门将模式：尽情测试 18m/s 狂风绕人墙、电梯球下坠与钻墙底贴地斩。'
              : '拖动门内准星，结合风向与弧度绕过人墙或钻起跳人墙脚下。',
      'info',
    )
  }

  styleSel.addEventListener(
    'change',
    () => {
      curveSel.value = FREEKICK_STYLES[styleSel.value as FreeKickStyle].defaultCurve
      reset()
    },
    opts,
  )
  for (const sel of [role, spotSel, strikerSel, curveSel, wallActSel, wallShiftSel, envSelect]) {
    sel.addEventListener('change', () => reset(), opts)
  }

  function resolveCurrent() {
    if (!shot) return null
    return resolveFreeKick(shot, dive, ability, {
      wallless,
      keeperless,
      wallAction,
      wallShift,
      env: currentEnv,
      seed: 13579,
    })
  }

  function start() {
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
      setStatus('停在右侧上下限范围标记内可打出最佳球速与弧度控制。', 'charge')
      return
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0],
      rnd = () => Math.random()
    if (defend) {
      shot = makeOpponentFreeKick(spot, ability, seed, currentEnv)
      dive = null
      pad.dataset.active = 'true'
    } else {
      power = meter(clock(), bounds.cycle)
      shot = makeFreeKickShot(spot, style, curveOpt, aim, power, ability, seed, currentEnv)
      hud.lock(power, shot.zone)
      dive = keeperless
        ? null
        : rnd() < 0.16
          ? null
          : { at: 0.05 + rnd() * 0.28, dir: fromKeeperPad(shot.target.x >= 0 ? -1 : 1, rnd() * 0.6 - 0.15) }
    }
    outcomePlan = resolveCurrent()
    origin = performance.now()
    phase = 'flight'
    go.disabled = true
    go.dataset.phase = 'flight'
    go.textContent = defend ? '观察来球…' : '飞行中…'
    setStatus(defend ? '对手起脚！人墙执行指令，迅速推方向盘封另一侧！' : '观察皮球绕墙轨迹与风向偏移。', 'info')
  }
  go.addEventListener('click', () => start(), opts)

  const lead = () => (defend ? 1.15 : 0.32)
  function commitDive(right: number, up: number) {
    if (!defend || phase !== 'flight' || dive) return
    dive = { at: clock() - lead(), dir: fromKeeperPad(right, up) }
    outcomePlan = resolveCurrent()
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
      }
      const dir = ds[e.key]
      if (!dir) return
      e.preventDefault()
      if (defend) commitDive(...dir)
      else if (phase === 'ready')
        aim = { x: clamp(aim.x + 0.16 * dir[0], -HALF, HALF), y: clamp(aim.y + 0.16 * dir[1], R, HEIGHT) }
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
    let t = phase === 'done' ? stopAt : phase === 'flight' ? elapsed - lead() : -2
    if (phase === 'flight' && shot && outcomePlan) {
      if (t >= outcomePlan.at) {
        phase = 'done'
        delete pad.dataset.active
        stopAt = t = outcomePlan.at
        const n = 48
        view.path(Array.from({ length: n + 1 }, (_, i) => outcomePlan!.ballAtTime((t * i) / n)))
        const isGoal =
          outcomePlan.result === '进球' ||
          outcomePlan.result === '配合破门' ||
          outcomePlan.result === '碰到仍进'
        if (isGoal) {
          const fakeShot: Shot = {
            target: outcomePlan.goalCrossPoint,
            time: Math.max(0.35, outcomePlan.at),
            arc: shot.arc * 0.35,
            curve: shot.curve * 0.25,
            zone: shot.zone,
          }
          impact = netImpact(fakeShot, '进球')
        }
        const mappedHudResult = isGoal
          ? '进球'
          : outcomePlan.result === '击中门框'
            ? '击中门框'
            : outcomePlan.result === '抱住' ||
                outcomePlan.result === '挡出' ||
                outcomePlan.result === '人墙挡出' ||
                outcomePlan.result === '卧草封出' ||
                outcomePlan.result === '头球被扑'
              ? '挡出'
              : '偏出'
        hud.outcome(
          mappedHudResult,
          defend,
          `${outcomePlan.result}${outcomePlan.underWall ? ' · 贴地钻墙' : ''} · 力度${shot.zone}`,
        )
        const tone = isGoal ? (defend ? 'bad' : 'good') : defend ? 'good' : 'warn'
        if (stageCtx) {
          const step = stageCtx.onAttempt({
            result: outcomePlan.result,
            defend,
            style,
            underWall: outcomePlan.underWall,
            landing: outcomePlan.goalCrossPoint,
          })
          stageCtx.prompt = step.message
          setStatus(`${outcomePlan.result} · ${step.message}`, step.finished ? (step.passed ? 'good' : 'bad') : tone)
          if (step.nextRole) role.value = step.nextRole
          if (step.nextSpotId) spotSel.value = step.nextSpotId
          stageFinished = step.finished
          go.disabled = false
          go.dataset.phase = 'done'
          go.textContent = step.buttonLabel ?? (step.finished ? '返回活动页' : '下一球')
        } else {
          setStatus(
            `${outcomePlan.result}${outcomePlan.underWall ? '（成功从起跳人墙脚下钻过！）' : ''} · 力度${shot.zone}。黄线为真实 3D 球路。`,
            tone,
          )
          go.disabled = false
          go.dataset.phase = 'done'
          go.textContent = '再罚一球'
        }
      }
    }

    const afterLine = phase === 'done' ? Math.max(0, elapsed - lead() - stopAt) : 0
    const sinceImpact = impact ? afterLine - impact.delay : 0
    const netMoving = !!impact && sinceImpact < SETTLE
    const weatherAnimating = currentEnv.weather !== 'clear'
    if (
      !netMoving &&
      !weatherAnimating &&
      phase !== 'flight' &&
      lastPhase === phase &&
      lastAim === aim &&
      lastRevision === view.revision
    )
      return
    lastPhase = netMoving ? null : phase
    lastAim = aim
    lastRevision = view.revision

    poseWallAndBox(phase === 'flight' || phase === 'done' ? Math.max(0, t) : -1)
    const ballPos =
      shot && impact
        ? finishBall(
            {
              target: outcomePlan!.goalCrossPoint,
              time: Math.max(0.35, outcomePlan!.at),
              arc: shot.arc * 0.35,
              curve: shot.curve * 0.25,
              zone: shot.zone,
            },
            impact,
            afterLine,
          )
        : outcomePlan && (phase === 'flight' || phase === 'done')
          ? outcomePlan.ballAtTime(Math.max(0, t))
          : { x: spot.x, y: R, z: spot.z }

    view.draw(
      ballPos,
      keeperAt(dive, ability, Math.max(0, t), currentEnv),
      phase === 'flight' || phase === 'done' ? clamp(1 + t / lead()) : 0,
      sinceImpact >= 0 && sinceImpact < SETTLE ? impact : null,
      sinceImpact,
      elapsed * 0.55,
      performance.now() / 1000,
    )
    if (!defend) hud.locate(view.aimScreen(aim))
  }

  reset()
  tick()
}
