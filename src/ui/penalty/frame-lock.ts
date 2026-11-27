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

  // 2. Dialog frame & backdrop: block touch dragging unless interacting with range scrubber or scrollable strips/decks
  dialog.addEventListener(
    'touchmove',
    (e) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input[type="range"]')) {
        return
      }
      const hScroll = target?.closest<HTMLElement>('.hl3d-strip, .hl3d-cambar')
      if (hScroll && hScroll.scrollWidth > hScroll.clientWidth + 2) {
        return
      }
      const vScroll = target?.closest<HTMLElement>('.settings, .hl3d-controls')
      if (vScroll && vScroll.scrollHeight > vScroll.clientHeight + 2) {
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
