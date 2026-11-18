import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('联机读档首屏就能区分真人、临时接管和电脑球队，不依赖世界名单', async () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'fm-online-token' ? 'session' : null, setItem() {} })
  const { game } = await import('../src/ui/state.ts')
  const { clubName } = await import('../src/ui/components.ts')
  const { initOnline, publicWorld } = await import('../src/online.ts')
  const [human, takeover, npc] = game.aiTeams
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url !== '/api/game') throw new Error('不应额外请求世界名单')
    return Response.json({ game, user: { id: 'coach', username: 'coach' }, revision: 1, clubCoaches: { [human.id]: 'human', [takeover.id]: 'takeover' } })
  }))
  expect(await initOnline()).not.toBeNull()
  expect(publicWorld).toBeNull()
  expect(clubName('player')).toContain('class="human-mark"')
  expect(clubName(human.id)).toContain('class="human-mark"')
  expect(clubName(takeover.id)).toContain('class="human-mark ai-takeover"')
  expect(clubName(npc.id)).not.toContain('human-mark')
  expect(fetch).toHaveBeenCalledTimes(1)
})
