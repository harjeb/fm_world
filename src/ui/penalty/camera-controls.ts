// Interactive 3D Camera Rig & Replay Angle Bar for Penalty & Free Kick Labs.
// Supports 360° orbit drag, right-click / Shift / two-finger pan, scroll-wheel & pinch zoom, WASD camera movement, and slow-mo replay!

import type { createGround } from './scene.ts'

export interface CameraController {
  readonly freeLook: boolean
  readonly slowMo: boolean
  /** Returns true if a pointerdown on .ground should control the 3D camera instead of dragging the aiming sight. */
  shouldInterceptAim(e: PointerEvent, phase: string): boolean
  setReplayReady(ready: boolean): void
  reset(): void
}

export function attachCameraControls(
  dialog: HTMLDialogElement,
  pitch: HTMLElement,
  stage: HTMLElement,
  view: ReturnType<typeof createGround>,
  getPhase: () => string,
  signal: AbortSignal,
): CameraController {
  const bar = document.createElement('div')
  bar.className = 'cam-bar'
  bar.innerHTML = `
    <button type="button" class="cam-chip cam-toggle" data-cam="toggle" title="开启后可直接拖拽画面旋转视角">自由视角</button>
    <div class="cam-presets" hidden>
      <span class="cam-tip">拖拽旋转 · 右键/双指平移 · 滚轮缩放</span>
      <button type="button" class="cam-chip is-active" data-preset="default">默认</button>
      <button type="button" class="cam-chip" data-preset="behind_goal">门后</button>
      <button type="button" class="cam-chip" data-preset="side">侧面</button>
      <button type="button" class="cam-chip" data-preset="bird">俯瞰</button>
      <button type="button" class="cam-chip cam-slow" data-cam="slow">0.5x 慢镜</button>
    </div>`
  pitch.append(bar)

  const toggleBtn = bar.querySelector<HTMLButtonElement>('.cam-toggle')!
  const presetsWrap = bar.querySelector<HTMLElement>('.cam-presets')!
  const slowBtn = bar.querySelector<HTMLButtonElement>('.cam-slow')!
  const presetBtns = [...bar.querySelectorAll<HTMLButtonElement>('[data-preset]')]

  let manualFreeLook = false
  let replayReady = false
  let slowMo = false

  function syncUi() {
    const active = manualFreeLook || replayReady || view.isCustomCamera
    toggleBtn.classList.toggle('is-active', manualFreeLook)
    toggleBtn.textContent = manualFreeLook ? '退出自由视角' : '自由视角'
    presetsWrap.hidden = !active
    slowBtn.hidden = !replayReady
    slowBtn.classList.toggle('is-active', slowMo)
    if (!view.isCustomCamera) {
      for (const b of presetBtns) b.classList.toggle('is-active', b.dataset.preset === 'default')
    }
  }

  const opts: AddEventListenerOptions = { signal }

  bar.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLButtonElement>('button')
      if (!btn) return
      e.stopPropagation()
      if (btn.dataset.cam === 'toggle') {
        manualFreeLook = !manualFreeLook
        if (!manualFreeLook && getPhase() === 'ready') {
          view.resetCamera()
        }
        syncUi()
        return
      }
      if (btn.dataset.cam === 'slow') {
        slowMo = !slowMo
        syncUi()
        return
      }
      const preset = btn.dataset.preset as 'default' | 'behind_goal' | 'side' | 'bird' | undefined
      if (preset) {
        view.setCameraPreset(preset)
        if (preset === 'default' && getPhase() === 'ready') manualFreeLook = false
        for (const b of presetBtns) b.classList.toggle('is-active', b === btn)
        syncUi()
      }
    },
    opts,
  )

  stage.addEventListener('contextmenu', (e) => e.preventDefault(), opts)

  // Multi-pointer tracking for 1-finger orbit, right/middle/Shift pan, and 2-finger pinch + pan
  const pointers = new Map<number, { x: number; y: number; button: number; shift: boolean }>()
  let lastPinchDist = 0

  function shouldInterceptAim(e: PointerEvent, phase: string): boolean {
    if (e.button === 1 || e.button === 2 || e.shiftKey || e.altKey) return true
    if (manualFreeLook || phase === 'done') return true
    return false
  }

  stage.addEventListener(
    'pointerdown',
    (e) => {
      const phase = getPhase()
      if (pointers.size === 0 && !shouldInterceptAim(e, phase)) return
      stage.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y)
      }
    },
    opts,
  )

  stage.addEventListener(
    'pointermove',
    (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      prev.x = e.clientX
      prev.y = e.clientY

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (lastPinchDist > 8 && dist > 8) {
          view.zoomCamera(lastPinchDist / dist)
        }
        lastPinchDist = dist
        view.panCamera(dx * 0.5, dy * 0.5)
      } else if (prev.button === 2 || prev.button === 1 || prev.shift || e.shiftKey) {
        view.panCamera(dx, dy)
      } else {
        view.orbitCamera(dx * 0.0068, dy * 0.0052)
      }
      for (const b of presetBtns) b.classList.remove('is-active')
      syncUi()
    },
    opts,
  )

  const releasePointer = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) lastPinchDist = 0
  }
  stage.addEventListener('pointerup', releasePointer, opts)
  stage.addEventListener('pointercancel', releasePointer, opts)
  stage.addEventListener('lostpointercapture', releasePointer, opts)

  stage.addEventListener(
    'wheel',
    (e) => {
      if (e.cancelable) e.preventDefault()
      const factor = e.deltaY > 0 ? 1.09 : 0.92
      view.zoomCamera(factor)
      for (const b of presetBtns) b.classList.remove('is-active')
      syncUi()
    },
    { passive: false, signal },
  )

  // WASD camera panning on desktop
  dialog.addEventListener(
    'keydown',
    (e) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return
      const key = e.key.toLowerCase()
      const panMap: Record<string, [number, number]> = {
        w: [0, 26],
        s: [0, -26],
        a: [28, 0],
        d: [-28, 0],
      }
      const move = panMap[key]
      if (!move) return
      if (getPhase() !== 'done' && !manualFreeLook && !view.isCustomCamera) return
      e.preventDefault()
      view.panCamera(move[0], move[1])
      for (const b of presetBtns) b.classList.remove('is-active')
      syncUi()
    },
    opts,
  )

  syncUi()

  return {
    get freeLook() {
      return manualFreeLook
    },
    get slowMo() {
      return slowMo
    },
    shouldInterceptAim,
    setReplayReady(ready: boolean) {
      replayReady = ready
      syncUi()
    },
    reset() {
      replayReady = false
      manualFreeLook = false
      pointers.clear()
      view.resetCamera()
      syncUi()
    },
  }
}
