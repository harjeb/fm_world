import { clamp, type band, type Result, type Zone, type Point } from '../../game/penalty/practice.ts'
import { environmentHudSummary, type PitchEnvironment } from '../../game/penalty/environment.ts'
import './hud.css'

// Screen-space broadcast HUD. Never intercepts pointer input; target math stays on the 3D goal plane.
export const shotHud = `<div class="pk-hud" data-state="aim" data-mode="kick">
  <div class="pk-banner" aria-hidden="true">
    <span class="pk-banner-tag"></span>
    <span class="pk-banner-sep"></span>
    <span class="pk-banner-detail"></span>
  </div>
  <div class="pk-env" aria-hidden="true" data-weather="clear">
    <svg class="pk-wind-icon" viewBox="-10 -10 20 20"><path d="M0 -7L4.5 5 0 2.2 -4.5 5Z" fill="currentColor"/></svg>
    <span class="pk-env-wind"></span>
    <span class="pk-banner-sep"></span>
    <span class="pk-env-detail"></span>
  </div>
  <div class="pk-toast" aria-hidden="true" hidden>
    <strong class="pk-toast-main"></strong>
    <span class="pk-toast-sub"></span>
  </div>
  <svg class="pk-sight" viewBox="-26 -26 52 52" aria-hidden="true">
    <g class="pk-sight-fx">
      <circle class="pk-sight-shadow" r="17.5"/>
      <g class="pk-sight-bezel" fill="none" stroke-linecap="round">
        <circle class="pk-sight-arcs" r="17.5" pathLength="100" stroke-dasharray="14 11" transform="rotate(20)"/>
      </g>
      <circle class="pk-sight-inner" r="10.2" stroke-dasharray="2.6 2.6"/>
      <path class="pk-sight-ticks" d="M0 -21.5v5.5 M21.5 0h-5.5 M0 21.5v-5.5 M-21.5 0h5.5"/>
      <circle class="pk-sight-dot-ring" r="3.4"/>
      <circle class="pk-sight-dot" r="1.75"/>
    </g>
  </svg>
  <div class="pk-gauge" role="meter" aria-label="射门力度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <span class="pk-gauge-id" aria-hidden="true">PWR</span>
    <div class="pk-scale">
      <div class="pk-bar-shell">
        <div class="pk-bar-core">
          <div class="pk-grad-full"></div>
          <div class="pk-grad-veil"></div>
          <div class="pk-grad-sheen"></div>
          <i class="pk-cap" aria-hidden="true"></i>
        </div>
      </div>
      <div class="pk-bounds" aria-hidden="true">
        <i class="pk-bound pk-bound-hi"></i>
        <i class="pk-bound-span"></i>
        <i class="pk-bound pk-bound-lo"></i>
      </div>
      <i class="pk-needle" aria-hidden="true"></i>
    </div>
    <div class="pk-readout" aria-hidden="true">
      <b class="pk-value">00</b>
      <span class="pk-label">力度</span>
    </div>
  </div>
</div>`

export type OutcomeTone = 'goal' | 'save' | 'frame' | 'miss'

function outcomeTone(result: Result, defend: boolean): OutcomeTone {
  if (result === '抱住' || result === '挡出') return defend ? 'goal' : 'save'
  if (result === '击中门框') return 'frame'
  if (result === '偏出') return defend ? 'goal' : 'miss'
  return defend ? 'miss' : 'goal'
}

export function createHud(parent: HTMLElement) {
  const root = parent.querySelector<HTMLElement>('.pk-hud')!,
    gauge = root.querySelector<HTMLElement>('.pk-gauge')!,
    sight = root.querySelector<SVGSVGElement>('.pk-sight')!,
    num = root.querySelector('.pk-value')!,
    label = root.querySelector('.pk-label')!,
    bannerTag = root.querySelector('.pk-banner-tag')!,
    bannerDetail = root.querySelector('.pk-banner-detail')!,
    envPill = root.querySelector<HTMLElement>('.pk-env')!,
    windIcon = root.querySelector<SVGElement>('.pk-wind-icon')!,
    envWind = root.querySelector('.pk-env-wind')!,
    envDetail = root.querySelector('.pk-env-detail')!,
    toast = root.querySelector<HTMLElement>('.pk-toast')!,
    toastMain = root.querySelector('.pk-toast-main')!,
    toastSub = root.querySelector('.pk-toast-sub')!

  let last = -1

  function value(power: number) {
    const pct = 100 * clamp(power),
      rounded = Math.round(pct)
    gauge.style.setProperty('--pk-power', `${pct}%`)
    if (rounded !== last) {
      num.textContent = String(rounded).padStart(2, '0')
      gauge.setAttribute('aria-valuenow', String(rounded))
      last = rounded
    }
  }

  return {
    reset(visible: boolean, defend: boolean, b: ReturnType<typeof band>) {
      root.hidden = !visible
      root.dataset.mode = defend ? 'keep' : 'kick'
      root.dataset.state = 'aim'
      delete root.dataset.drag
      delete root.dataset.zone
      toast.hidden = true
      delete toast.dataset.tone
      label.textContent = '力度'
      const lo = clamp(b.center - b.green),
        hi = clamp(b.center + b.green)
      gauge.style.setProperty('--pk-lo', `${lo * 100}%`)
      gauge.style.setProperty('--pk-hi', `${hi * 100}%`)
      value(0)
    },
    meta(tag: string, detail: string) {
      bannerTag.textContent = tag
      bannerDetail.textContent = detail
    },
    environment(env: PitchEnvironment) {
      const info = environmentHudSummary(env)
      envPill.dataset.weather = env.weather
      envPill.dataset.wind = info.hasWind ? 'active' : 'calm'
      windIcon.style.transform = `rotate(${info.screenDeg}deg)`
      envWind.textContent = info.windText
      envDetail.textContent = info.detailText
    },
    outcome(result: Result | null, defend: boolean, sub = '') {
      if (!result) {
        toast.hidden = true
        return
      }
      toast.dataset.tone = outcomeTone(result, defend)
      toastMain.textContent = result
      toastSub.textContent = sub
      toast.hidden = false
    },
    charge() {
      root.dataset.state = 'charge'
      label.textContent = '蓄力'
    },
    value,
    lock(power: number, zone: Zone) {
      value(power)
      root.dataset.state = 'lock'
      root.dataset.zone = zone === '合适' ? 'good' : zone === '欠力' || zone === '过力' ? 'bad' : 'near'
      label.textContent = zone
    },
    drag(held: boolean) {
      if (held) root.dataset.drag = 'true'
      else delete root.dataset.drag
    },
    locate(p: Point) {
      sight.style.left = `${p.x}px`
      sight.style.top = `${p.y}px`
    },
  }
}
