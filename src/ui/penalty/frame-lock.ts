// Mobile & touch viewport/frame lock for 3D Penalty & Free Kick dialogs.
// Prevents swipe-to-aim and swipe-to-dive gestures from dragging, bouncing, or scrolling the page or dialog frame.

export function lockSetPieceFrame(
  dialog: HTMLDialogElement,
  pitch: HTMLElement,
  signal: AbortSignal,
): () => void {
  const docEl = document.documentElement
  const body = document.body
  docEl.classList.add('pk-modal-lock')
  body?.classList.add('pk-modal-lock')

  const opts: AddEventListenerOptions = { passive: false, signal }

  // 1. 3D pitch, HUD & goalkeeper radial pad: block 100% of native scroll/pan/rubber-band/pull-to-refresh
  pitch.addEventListener(
    'touchmove',
    (e) => {
      if (e.cancelable) e.preventDefault()
    },
    opts,
  )

  // 2. Dialog frame & backdrop: block all touch dragging unless scrolling an overflowing .settings deck
  dialog.addEventListener(
    'touchmove',
    (e) => {
      const target = e.target instanceof Element ? e.target : null
      const settings = target?.closest<HTMLElement>('.settings')
      if (settings && settings.scrollHeight > settings.clientHeight + 2) {
        return
      }
      if (e.cancelable) e.preventDefault()
    },
    opts,
  )

  // 3. Block iOS Safari pinch/gesture zoom inside the 3D arena
  dialog.addEventListener(
    'gesturestart',
    (e) => {
      if (e.cancelable) e.preventDefault()
    },
    opts,
  )

  return () => {
    docEl.classList.remove('pk-modal-lock')
    body?.classList.remove('pk-modal-lock')
  }
}
