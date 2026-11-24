import { clamp, type band, type Zone, type Point } from '../../game/penalty/practice.ts'
import './hud.css'

// Screen-space graphics. The SVG never intercepts the pointer; the actual target stays on the goal plane.
export const shotHud = `<div class="pk-hud" data-state="aim">
  <svg class="pk-sight" viewBox="-24 -24 48 48" aria-hidden="true"><g class="pk-sight-fx">
    <circle class="pk-sight-halo" r="17"/><g class="pk-sight-bezel" fill="none" stroke-linecap="round"><circle r="17.5" pathLength="100" stroke-dasharray="16 9" transform="rotate(17)"/></g>
    <circle class="pk-sight-core" r="10.6"/><path class="pk-sight-index" d="M0 -14v4 M14 0h-4 M0 14v-4 M-14 0h4"/><circle class="pk-sight-dot" r="1.65"/></g></svg>
  <div class="pk-gauge" role="meter" aria-label="射门力度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
    <span class="pk-gauge-id" aria-hidden="true">PWR</span>
    <div class="pk-scale"><div class="pk-gauge-track"><div class="pk-bands"></div><div class="pk-charge"></div><div class="pk-divisions"></div></div>
      <i class="pk-window" aria-hidden="true"></i><i class="pk-needle" aria-hidden="true"></i></div>
    <b class="pk-value" aria-hidden="true">00</b><span class="pk-label" aria-hidden="true">力度</span>
  </div></div>`

export function createHud(parent: HTMLElement) {
  const root = parent.querySelector<HTMLElement>('.pk-hud')!,
    gauge = root.querySelector<HTMLElement>('.pk-gauge')!,
    sight = root.querySelector<SVGSVGElement>('.pk-sight')!,
    num = root.querySelector('.pk-value')!,
    label = root.querySelector('.pk-label')!
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
    reset(show: boolean, b: ReturnType<typeof band>) {
      root.hidden = !show
      root.dataset.state = 'aim'
      delete root.dataset.drag
      delete root.dataset.zone
      label.textContent = '力度'
      const bounds = [
        b.center - b.green - b.yellow,
        b.center - b.green,
        b.center + b.green,
        b.center + b.green + b.yellow,
      ]
      for (const [i, v] of bounds.entries()) gauge.style.setProperty(`--pk-b${i}`, `${v * 100}%`)
      value(0)
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
