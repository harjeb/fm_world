import { esc } from './format.ts'

/**
 * 全局提示框。放在 #app 之外，重绘不会碰它，也不会被表格的滚动容器裁掉。
 * 元素带上 tipAttrs() 的属性就有提示：鼠标悬停、键盘聚焦都会显示，触屏上点一下显示。
 */
export function tipAttrs(title: string, body: string): string {
  return `data-tip-title="${esc(title)}" data-tip="${esc(body)}" tabindex="0" aria-label="${esc(`${title}：${body}`)}"`
}

const SHOW_DELAY = 120
const VIEW_MARGIN = 8

let box: HTMLDivElement | null = null
let anchor: HTMLElement | null = null
let timer: number | null = null
let lastPointer = ''

function tipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null
}

function place(el: HTMLElement, tip: HTMLDivElement): void {
  const rect = el.getBoundingClientRect()
  const width = tip.offsetWidth
  const height = tip.offsetHeight
  const left = Math.min(window.innerWidth - width - VIEW_MARGIN, Math.max(VIEW_MARGIN, rect.left + rect.width / 2 - width / 2))
  const above = rect.top - height - 6
  const top = above >= VIEW_MARGIN ? above : Math.min(window.innerHeight - height - VIEW_MARGIN, rect.bottom + 6)
  tip.style.left = `${Math.round(left)}px`
  tip.style.top = `${Math.round(top)}px`
}

function show(el: HTMLElement): void {
  if (!box) return
  anchor = el
  const title = document.createElement('b')
  title.textContent = el.dataset.tipTitle ?? ''
  const body = document.createElement('p')
  body.textContent = el.dataset.tip ?? ''
  box.replaceChildren(title, body)
  box.hidden = false
  place(el, box)
}

function hide(): void {
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  anchor = null
  if (box) box.hidden = true
}

function showLater(el: HTMLElement): void {
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    show(el)
  }, SHOW_DELAY)
}

/** 重绘后调用：提示指向的元素可能已经不在页面上。 */
export function syncTooltip(): void {
  if (anchor && !anchor.isConnected) hide()
}

export function installTooltips(): void {
  box = document.createElement('div')
  box.className = 'tooltip'
  box.setAttribute('role', 'tooltip')
  box.hidden = true
  document.body.appendChild(box)

  document.addEventListener('pointerdown', (event) => { lastPointer = event.pointerType }, true)
  document.addEventListener('mouseover', (event) => {
    if (lastPointer === 'touch') return
    const el = tipTarget(event.target)
    if (el && el !== anchor) showLater(el)
    else if (!el) hide()
  })
  document.addEventListener('mouseout', (event) => {
    const el = tipTarget(event.target)
    if (el && !el.contains(event.relatedTarget as Node | null)) hide()
  })
  document.addEventListener('focusin', (event) => {
    const el = tipTarget(event.target)
    if (el?.matches(':focus-visible')) showLater(el)
  })
  document.addEventListener('focusout', (event) => {
    if (tipTarget(event.target)) hide()
  })
  // 触屏没有悬停：点一下显示，再点一下或点别处收起；这次点击不触发行上的动作。
  document.addEventListener('click', (event) => {
    if (lastPointer !== 'touch') return
    const el = tipTarget(event.target)
    if (!el) {
      hide()
      return
    }
    event.stopPropagation()
    event.preventDefault()
    if (anchor === el) hide()
    else show(el)
  }, true)
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide() }, true)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('resize', hide)
}
