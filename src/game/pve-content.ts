import type { AITeam } from './types.ts'

type Content = { version: number; hash: string; legends: Record<string, AITeam>; peak: Record<string, AITeam>; cups: Record<string, AITeam> }
let content: Content | undefined
let loading: Promise<void> | undefined
export const PVE_CONTENT_VERSION = 2
export let PVE_CONTENT_HASH = ''
export const pveContentReady = () => !!content

/** 按需加载完整快照；友谊赛/普通游戏首屏不必下载全部历史球队数据。 */
export function loadPveContent(): Promise<void> {
  const url = new URL('./data/pve-snapshots.generated.json', import.meta.url)
  // 浏览器直接读取 JSON 资产，避免把 7 MB JSON 编译成数十 MB 的开发期 JS/source map。
  return loading ??= (typeof window === 'undefined'
    ? Promise.resolve().then(() => JSON.parse(process.getBuiltinModule('fs').readFileSync(url, 'utf8')))
    : fetch(url).then((response) => {
      if (!response.ok) throw new Error(`球队快照下载失败：${response.status}`)
      return response.json()
    })).then((loaded: Content) => {
    if (loaded.version !== PVE_CONTENT_VERSION) throw new Error('PvE 内容版本不匹配，请刷新页面')
    content = loaded
    PVE_CONTENT_HASH = loaded.hash
  }).catch((error) => { loading = undefined; throw error })
}

/** 先 await loadPveContent()，然后读同步副本；比赛/测试不能污染共享内容。 */
export function frozenPveTeam(kind: 'legends' | 'peak' | 'cups', id: string): AITeam {
  const team = content?.[kind][id]
  if (!team) throw new Error(content ? `缺少 PvE 内容：${kind}/${id}` : 'PvE 内容尚未加载')
  return structuredClone(team)
}
