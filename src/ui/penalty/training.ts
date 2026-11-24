import './training.css'
import { attrRating } from '../../game/scale.ts'
import type { Player } from '../../game/types.ts'
import {
  ballAt,
  band,
  clamp,
  fromKeeperPad,
  HALF,
  HEIGHT,
  keeperAt,
  KICKS,
  makeShot,
  meter,
  R,
  resolve,
  SPOT,
  STANDARD,
  type Ability,
  type Dive,
  type Kick,
  type Point,
  type Shot,
} from '../../game/penalty/practice.ts'
import { createGround } from './scene.ts'

function options(select: HTMLSelectElement, rows: [string, string][]) {
  select.replaceChildren(...rows.map(([value, label]) => new Option(label, value)))
}
function ability(player?: Player): Ability {
  if (!player) return STANDARD
  const a = { ...STANDARD }
  for (const key of Object.keys(a) as (keyof Ability)[])
    a[key] = clamp(attrRating(key, player.attrs[key], player.positions.GK > 0) / 100)
  return a
}
export function openPenaltyTraining(roster: readonly Player[] = []) {
  if (document.querySelector('.penalty-lab')) return
  const d = document.createElement('dialog')
  d.className = 'penalty-lab'
  d.setAttribute('aria-labelledby', 'penalty-title')
  d.innerHTML = `<header><div><small>S3 · 自由训练</small><h2 id="penalty-title">十二码之夜</h2></div><button class="leave">退出训练</button></header>
    <div class="pitch3"><div class="ground"></div><div class="meter" aria-label="射门力度"><i></i></div><div class="pad" tabindex="0" role="group" aria-label="扑救方向盘"><span>扑</span></div></div>
    <p class="call" role="status"></p><div class="settings"><label>视角<select class="role"><option value="kick">我来主罚</option><option value="keep">我来守门</option></select></label><label>主罚手<select class="striker"></select></label><label>门将<select class="keeper"></select></label><label>踢法<select class="kick"></select></label><label>触球脚面<select class="foot"></select></label></div>
    <small class="ratings"></small><footer><button class="go"></button><button class="repeat" hidden>重扑同一球</button><small>不限次数 · 无奖励 · 不影响联赛</small></footer>`
  document.body.append(d)
  const el = <E extends HTMLElement = HTMLElement>(s: string) => d.querySelector<E>(s)!
  const ctrl = new AbortController(),
    opts = { signal: ctrl.signal }
  let frame = 0,
    ground: ReturnType<typeof createGround> | undefined
  const end = () => {
    ctrl.abort()
    cancelAnimationFrame(frame)
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
    bar = el('.meter'),
    cursor = el('.meter i'),
    go = el<HTMLButtonElement>('.go')
  const failed = () => {
    cancelAnimationFrame(frame)
    pitch.hidden = true
    el('.settings').hidden = true
    el('.ratings').hidden = true
    go.hidden = true
    el('.repeat').hidden = true
    status.textContent = '无法显示 3D 球场：请使用支持 WebGL 2 的浏览器并开启硬件加速。未消耗次数。'
  }
  try {
    ground = createGround(stage)
  } catch {
    failed()
    return
  }
  const view = ground
  view.canvas.addEventListener('webglcontextlost', failed, opts)
  const role = el<HTMLSelectElement>('.role'),
    ss = el<HTMLSelectElement>('.striker'),
    gs = el<HTMLSelectElement>('.keeper'),
    ks = el<HTMLSelectElement>('.kick'),
    fs = el<HTMLSelectElement>('.foot')
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
  const feet = () =>
    options(
      fs,
      KICKS[ks.value as Kick].feet.map((f) => [f, f]),
    )
  feet()
  type Phase = 'ready' | 'power' | 'flight' | 'done'
  let phase: Phase = 'ready',
    defend = false,
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
    bounds = band(kick, shooter)
  function clock() {
    return ((paused ?? performance.now()) - origin) / 1000
  }
  function clearPad() {
    pad.firstElementChild!.removeAttribute('style')
    activePointer = null
  }
  let lastOpponentShot: Shot | null = null
  const repeat = el<HTMLButtonElement>('.repeat')
  repeat.addEventListener(
    'click',
    () => {
      if (lastOpponentShot && defend) {
        const previous = lastOpponentShot
        reset()
        start(previous)
      }
    },
    opts,
  )
  function reset() {
    phase = 'ready'
    shot = null
    dive = null
    clearPad()
    defend = role.value === 'keep'
    shooter = ability(strikers[Number(ss.value)])
    goalie = ability(keepers[Number(gs.value)])
    kick = ks.value as Kick
    bounds = band(kick, shooter)
    const rating = (n: number) => Math.round(n * 100)
    el('.ratings').textContent = defend
      ? `训练评分 · 扑救反应 ${rating(goalie.reflexes)}　爆发 ${rating(goalie.acceleration)}　手控 ${rating(goalie.handling)}`
      : `训练评分 · 射术 ${rating(shooter.shooting)}　力量 ${rating(shooter.strength)}　镇定 ${rating(shooter.composure)}`
    view.mode(defend)
    view.path([])
    repeat.hidden = !defend || !lastOpponentShot
    pad.hidden = !defend
    bar.hidden = defend
    cursor.style.bottom = '0%'
    ks.disabled = fs.disabled = defend
    go.disabled = false
    go.textContent = defend ? '让对手主罚' : '瞄准好了 · 开始蓄力'
    status.textContent = defend
      ? '点开始后观察助跑。推方向盘即扑，不推守中；也可用方向键。'
      : '拖动球门内的金色瞄准框，或用方向键微调。'
    const pct = (n: number) => `${100 * n}%`,
      { center: c, green: g, yellow: y } = bounds
    bar.style.background = `linear-gradient(to top,#a34850 0 ${pct(c - g - y)},#ecbb59 ${pct(c - g - y)} ${pct(c - g)},#38c692 ${pct(c - g)} ${pct(c + g)},#ecbb59 ${pct(c + g)} ${pct(c + g + y)},#a34850 ${pct(c + g + y)} 100%)`
  }
  for (const select of [role, ss, gs, ks, fs])
    select.addEventListener(
      'change',
      () => {
        if (select === ks) feet()
        reset()
      },
      opts,
    )
  function start(previous?: Shot) {
    if (phase === 'done') {
      reset()
      return
    }
    if (phase === 'flight') return
    if (!defend && phase === 'ready') {
      phase = 'power'
      origin = performance.now()
      go.textContent = '锁定力度 · 起脚'
      status.textContent = '越高越有力，绿色是当前踢法的合适力度。'
      return
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0],
      rnd = () => Math.random()
    if (defend) {
      const k = (Object.keys(KICKS) as Kick[])[Math.floor(rnd() * 4)],
        b = band(k, shooter)
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
        )
      lastOpponentShot = shot
      dive = null
    } else {
      power = meter(clock(), bounds.cycle)
      cursor.style.bottom = `${100 * power}%`
      shot = makeShot(kick, fs.value === '外脚背', aim, power, shooter, seed)
      dive =
        rnd() < 0.17 ? null : { at: -0.09 + rnd() * 0.25, dir: fromKeeperPad(rnd() < 0.5 ? -1 : 1, rnd() - 0.5) }
    }
    repeat.hidden = true
    origin = performance.now()
    phase = 'flight'
    go.disabled = true
    go.textContent = defend ? '观察出脚…' : '射门中…'
    status.textContent = defend ? '对手开始助跑！看准球路，向那个方向推。' : '观察实际落点与门将的位置。'
  }
  go.addEventListener('click', () => start(), opts)
  const lead = () => (defend ? 1.25 : 0.3)
  function commitDive(right: number, up: number) {
    if (!defend || phase !== 'flight' || dive) return
    dive = { at: clock() - lead(), dir: fromKeeperPad(right, up) }
    const n = Math.hypot(right, up)
    ;(pad.firstElementChild as HTMLElement).style.transform =
      `translate(${(right / n) * 24}px,${(-up / n) * 24}px)`
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
        pointer(e)
      },
      opts,
    )
    node.addEventListener('pointermove', pointer, opts)
    node.addEventListener(
      'lostpointercapture',
      (e) => {
        if (e.pointerId === activePointer) activePointer = null
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
  // Only redraw static poses when aim, layout or state changes. The power bar is a DOM overlay.
  let lastAim: Point | null = null,
    lastPhase: Phase | null = null,
    lastRevision = -1
  function tick() {
    frame = requestAnimationFrame(tick)
    if (paused !== null) return
    elapsed = clock()
    if (phase === 'power') cursor.style.bottom = `${100 * meter(elapsed, bounds.cycle)}%`
    let t = phase === 'done' ? stopAt : phase === 'flight' ? elapsed - lead() : -2
    if (phase === 'flight' && shot) {
      const out = resolve(shot, dive, goalie)
      if (t >= out.at) {
        phase = 'done'
        stopAt = t = out.at
        const n = 40
        view.path(Array.from({ length: n + 1 }, (_, i) => ballAt(shot!, (t * i) / n)))
        status.textContent = `${out.result} · 力度${shot.zone}。${defend ? (dive ? '黄线是实际球路，可对照手套位置。' : '本球选择留在中路。') : '金框是预期落点，黄线是实际球路。'}`
        go.disabled = false
        go.textContent = '再练一球'
        repeat.hidden = !defend
      }
    }
    if (phase !== 'flight' && lastPhase === phase && lastAim === aim && lastRevision === view.revision) return
    lastPhase = phase
    lastAim = aim
    lastRevision = view.revision
    view.draw(
      shot ? ballAt(shot, t) : { x: 0, y: R, z: SPOT },
      keeperAt(dive, goalie, t),
      defend ? null : aim,
      phase === 'flight' || phase === 'done' ? clamp(1 + t / lead()) : 0,
    )
  }
  reset()
  tick()
}
