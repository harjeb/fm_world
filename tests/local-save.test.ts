import { afterEach, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { cacheGameLocally, createInitialGame, loadGame, ONLINE_CACHE_KEY, saveGame, SAVE_KEY, setRemoteSaver } from '../src/game/state.ts'
import { createWorldGame } from '../src/game/world.ts'
import { ensureYouth } from '../src/game/youth.ts'

function stubStorage(limit: number) {
  const items = new Map<string, string>()
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      let size = key.length + value.length
      for (const [k, v] of items) if (key !== k) size += k.length + v.length
      if (size > limit) throw new DOMException('storage quota exceeded', 'QuotaExceededError')
      items.set(key, value)
    }),
  }
  vi.stubGlobal('localStorage', storage)
  return { items, storage }
}

afterEach(() => { setRemoteSaver(null); vi.unstubAllGlobals() })

it('保留原始 JSON 旧档兼容性；容量不足时原地无损压缩完整世界并能重新读取', () => {
  const quota = 5 * 1024 * 1024
  const { storage, items } = stubStorage(quota)
  const game = createWorldGame(98765)
  ensureYouth(game)
  storage.setItem(SAVE_KEY, JSON.stringify(game)) // 模拟用户更新前写入的老档。
  expect(loadGame()?.seed).toBe(game.seed)
  const otherSize = quota - (items.get(SAVE_KEY)!.length + SAVE_KEY.length + 'other'.length) - 256
  storage.setItem('other', 'x'.repeat(otherSize)) // 站点的其他数据占据剩余容量。
  game.clubName = '容量测试俱乐部⚽'
  game.economy!.balance += 12345
  game.roster[0].history = [{ action: 1, week: 1, kind: 'event', title: '培养记录', text: '训练回顾。'.repeat(100), gains: { passing: 10 } }]
  expect(saveGame(game)).toBe(true)
  const packed = items.get(SAVE_KEY)!
  expect(packed).toMatch(/^gzip-v1:/)
  expect(packed.length).toBeLessThan(1_500_000)
  const json = gunzipSync(Buffer.from(packed.slice('gzip-v1:'.length), 'base64')).toString('utf8')
  expect(json).toBe(JSON.stringify(game))
  const restored = loadGame()!
  expect(restored.seed).toBe(game.seed)
  expect(restored.clubName).toBe(game.clubName)
  expect(restored.economy!.balance).toBe(game.economy!.balance)
  expect(restored.youth!.members.map(m => m.player.id)).toEqual(game.youth!.members.map(m => m.player.id))
  expect(items.get('other')).toHaveLength(otherSize)
})

it('压缩也写不进去时保留旧档，且不阻断联机存档', () => {
  const { items } = stubStorage(500)
  const game = createInitialGame(123)
  const old = '{"previousSave":true}'
  items.set(SAVE_KEY, old)
  expect(saveGame(game)).toBe(false)
  expect(items.get(SAVE_KEY)).toBe(old)
  const remoteSaver = vi.fn()
  setRemoteSaver(remoteSaver)
  expect(cacheGameLocally(game)).toBe(false)
  expect(remoteSaver).not.toHaveBeenCalled()
  expect(saveGame(game)).toBe(true)
  expect(remoteSaver).toHaveBeenCalledExactlyOnceWith(game)
  expect(items.get(SAVE_KEY)).toBe(old)
})

it('联机会话写在独立缓存中，不覆盖离线进度或缓存按需对手池', () => {
  const { items } = stubStorage(5 * 1024 * 1024)
  const offline = createInitialGame(91)
  expect(saveGame(offline)).toBe(true)
  const previous = items.get(SAVE_KEY)
  const online = createInitialGame(92)
  online.pve!.cupSeasonDeferred = true
  setRemoteSaver(vi.fn())
  expect(saveGame(online)).toBe(true)
  expect(items.get(SAVE_KEY)).toBe(previous)
  const cached = JSON.parse(items.get(ONLINE_CACHE_KEY)!)
  expect(cached.seed).toBe(92)
  expect(cached.pve.cupSeason).toBeUndefined()
  expect(cached.aiTeams).toEqual([])
  expect(cached.world).toBeUndefined()
  expect(loadGame()?.seed).toBe(91)
})
