/**
 * 把新的 HTML 增量合并进现有 DOM，而不是整块替换 innerHTML。
 *
 * render() 在比赛中每几百毫秒跑一次；原地更新才能保住打开的下拉框、输入焦点、
 * 面板内的滚动位置、canvas 内容和 CSS 过渡。所有事件都委托在 document 上，
 * 所以复用节点不会丢监听器。
 *
 * 节点按位置配对；带 data-key 的节点只与相同 key 配对，否则直接替换，
 * 这样排序或增删行时，输入框里没提交的内容不会串到别的球员身上。
 */
export function morph(root: Element, html: string): void {
  const template = document.createElement('template')
  template.innerHTML = html
  morphChildren(root, template.content)
}

function keyOf(node: Node): string | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element).getAttribute('data-key') : null
}

function sameNode(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b)
}

function morphChildren(from: Node, to: Node): void {
  let current = from.firstChild
  let incoming = to.firstChild
  while (incoming) {
    // appendChild / replaceChild 会把节点移出模板，所以先记下一个。
    const nextIncoming: ChildNode | null = incoming.nextSibling
    if (!current) {
      from.appendChild(incoming)
    } else if (sameNode(current, incoming)) {
      morphNode(current, incoming)
      current = current.nextSibling
    } else {
      const nextCurrent: ChildNode | null = current.nextSibling
      from.replaceChild(incoming, current)
      current = nextCurrent
    }
    incoming = nextIncoming
  }
  while (current) {
    const next: ChildNode | null = current.nextSibling
    from.removeChild(current)
    current = next
  }
}

function morphNode(from: Node, to: Node): void {
  if (from.nodeType !== Node.ELEMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue
    return
  }
  const a = from as Element
  const b = to as Element
  const previousValue = a.getAttribute('value')
  // 必须在合并子节点之前读取：合并会把 option 从模板里移走。
  const wantedOption = a instanceof HTMLSelectElement ? (b.querySelector('option[selected]') as HTMLOptionElement | null)?.value : undefined
  syncAttributes(a, b)
  if (a instanceof HTMLInputElement) syncInput(a, b, previousValue)
  // 第三方控件（人机验证）自己管理内容，重绘不能清掉它。
  if (a.hasAttribute('data-morph-skip')) return
  morphChildren(a, b)
  if (a instanceof HTMLSelectElement) syncSelect(a, wantedOption)
}

/**
 * selected 属性一旦被用户改动过就不再驱动选中项，要显式同步，结果才和全新渲染一样：
 * 有 selected 选中它，没有就回到第一项。data-keep-value 的下拉框不由状态驱动，保留当前选择。
 */
function syncSelect(select: HTMLSelectElement, wanted: string | undefined): void {
  if (wanted !== undefined) {
    if (select.value !== wanted) select.value = wanted
  } else if (!select.hasAttribute('data-keep-value') && select.selectedIndex !== 0) {
    select.selectedIndex = 0
  }
}

function syncAttributes(a: Element, b: Element): void {
  for (const { name, value } of [...b.attributes]) {
    if (a.getAttribute(name) !== value) a.setAttribute(name, value)
  }
  for (const { name } of [...a.attributes]) {
    if (b.hasAttribute(name)) continue
    // 用户手动展开的 <details> 不该因为重绘而收起。
    if (name === 'open' && a.tagName === 'DETAILS') continue
    a.removeAttribute(name)
  }
}

function syncInput(a: HTMLInputElement, b: Element, previousValue: string | null): void {
  if (a.type === 'checkbox' || a.type === 'radio') {
    a.checked = b.hasAttribute('checked')
    return
  }
  const next = b.getAttribute('value')
  // 只有渲染结果真的变了才覆盖；否则用户正在输入的内容要保留。
  if (next !== previousValue && a.value !== (next ?? '')) a.value = next ?? ''
}
