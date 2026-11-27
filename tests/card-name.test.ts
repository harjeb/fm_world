import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import { loadPveContent } from '../src/game/pve-content.ts'
import type { GameState, Player, PlayerCard } from '../src/game/types.ts'
import { CARD_NAME_LIMIT, cardDisplayName, normalizeCardName, playerCards, renameCard } from '../src/game/cards.ts'
import { createInitialGame } from '../src/game/state.ts'

beforeAll(loadPveContent)
const servers: AppServer[] = []
const dirs: string[] = []
afterEach(() => {
  for (const app of servers.splice(0)) app.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** 造一张属于这名球员的卡，够测命名规则用。 */
function makeCard(game: GameState, player: Player, serial: number): PlayerCard {
  const card: PlayerCard = {
    id: `card-test-${player.id}-${serial}`,
    playerId: player.id,
    playerName: player.name,
    serial,
    version: 1,
    routeId: null,
    createdAt: 1_700_000_000_000 + serial,
    attrs: { ...player.attrs },
    positions: { ...player.positions },
    personality: { ...player.personality },
    skills: [...player.skills],
    skillTiers: { ...player.skillTiers },
  }
  game.cards = [...(game.cards ?? []), card]
  return card
}

function setup() {
  const game = createInitialGame(4242)
  const first = game.roster[0]
  const second = game.roster[1]
  const cards = [makeCard(game, first, 1), makeCard(game, first, 2), makeCard(game, second, 1)]
  return { game, first, second, cards }
}

describe('球员卡自定义命名', () => {
  it('没起名时显示“卡 N”，起名后用自定义名', () => {
    const { game, cards } = setup()
    const [one, two] = cards
    expect(cardDisplayName(one)).toBe('卡 1')
    expect(renameCard(game, two.id, '远射版')).toEqual({ ok: true })
    expect(cardDisplayName(two)).toBe('远射版')
    expect(cardDisplayName(one)).toBe('卡 1')
    // 名字前后的空格会去掉
    expect(renameCard(game, one.id, '  组织核心  ')).toEqual({ ok: true })
    expect(one.customName).toBe('组织核心')
  })

  it('同一名球员的卡名不能重复：忽略大小写与首尾空格，并给出中文提示', () => {
    const { game, cards } = setup()
    const [one, two] = cards
    expect(renameCard(game, one.id, 'Winger').ok).toBe(true)
    const duplicate = renameCard(game, two.id, '  winger  ')
    expect(duplicate.ok).toBe(false)
    expect(duplicate.error).toContain('已经有一张叫“Winger”的卡')
    expect(two.customName).toBeUndefined()
    expect(normalizeCardName('  Winger ')).toBe('winger')
  })

  it('和另一张卡的默认名撞车也算重名', () => {
    const { game, cards } = setup()
    const [, two] = cards
    const result = renameCard(game, two.id, '卡 1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('“卡 1”')
  })

  it('不同球员可以有一样的卡名', () => {
    const { game, cards } = setup()
    const [one, , otherPlayerCard] = cards
    expect(renameCard(game, one.id, '主力').ok).toBe(true)
    expect(renameCard(game, otherPlayerCard.id, '主力').ok).toBe(true)
    expect(cardDisplayName(one)).toBe('主力')
    expect(cardDisplayName(otherPlayerCard)).toBe('主力')
  })

  it('空名字等于清除自定义名，回到“卡 N”', () => {
    const { game, cards } = setup()
    const [one] = cards
    expect(renameCard(game, one.id, '临时名').ok).toBe(true)
    expect(renameCard(game, one.id, '   ')).toEqual({ ok: true })
    expect(one.customName).toBeUndefined()
    expect(cardDisplayName(one)).toBe('卡 1')
  })

  it('名字太长或卡片不存在时会报中文错误', () => {
    const { game /* , cards */ } = setup()
    const cardId = game.cards![0].id
    const long = '名'.repeat(CARD_NAME_LIMIT + 1)
    expect(renameCard(game, cardId, long)).toMatchObject({ ok: false })
    expect(renameCard(game, cardId, long).error).toContain(String(CARD_NAME_LIMIT))
    expect(renameCard(game, 'card-ghost', '随便').error).toBe('球员卡不存在')
    expect(renameCard(game, cardId, '名'.repeat(CARD_NAME_LIMIT)).ok).toBe(true)
  })

  it('自定义名随存档序列化后还在，卡片列表顺序不变', () => {
    const { game, first, cards } = setup()
    expect(renameCard(game, cards[1].id, '存档测试').ok).toBe(true)
    const roundTrip = JSON.parse(JSON.stringify(game)) as GameState
    expect(roundTrip.cards?.find((card) => card.id === cards[1].id)?.customName).toBe('存档测试')
    expect(playerCards(roundTrip, first.id).map(cardDisplayName)).toEqual(['卡 1', '存档测试'])
  })

  it('联机 /api/cards/rename 与 Agent rename_card 持久化卡名并校验重名与默认名恢复', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-card-rename-'))
    dirs.push(dir)
    const app = createAppServer({ dataDir: dir, tickMs: 0, now: () => Date.UTC(2026, 10, 14, 1) })
    servers.push(app)
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`

    const registration = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rename-user', password: 'secret123' }),
    })
    expect(registration.status).toBe(201)
    const { token } = await registration.json() as { token: string }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

    const initial = await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState; revision: number }
    const player = initial.game.roster[0]
    const firstCard = makeCard(initial.game, player, 1)
    const secondCard = makeCard(initial.game, player, 2)
    expect((await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ game: initial.game, baseRevision: initial.revision }),
    })).status).toBe(200)

    const renameRes = await fetch(`${base}/api/cards/rename`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cardId: firstCard.id, name: '  联机王牌  ' }),
    })
    expect(renameRes.status).toBe(200)
    const renameBody = await renameRes.json() as { ok: boolean; revision: number; game: GameState }
    expect(renameBody.ok).toBe(true)
    expect(renameBody.revision).toBeGreaterThan(initial.revision)
    expect(renameBody.game.cards?.find((c) => c.id === firstCard.id)?.customName).toBe('联机王牌')

    const persisted = await (await fetch(`${base}/api/game`, { headers })).json() as { game: GameState }
    expect(persisted.game.cards?.find((c) => c.id === firstCard.id)?.customName).toBe('联机王牌')

    const dupRes = await fetch(`${base}/api/cards/rename`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cardId: secondCard.id, name: '联机王牌' }),
    })
    expect(dupRes.status).toBe(400)
    const dupBody = await dupRes.json() as { error: string }
    expect(dupBody.error).toContain('联机王牌')

    const clearRes = await fetch(`${base}/api/cards/rename`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cardId: firstCard.id, name: '' }),
    })
    expect(clearRes.status).toBe(200)
    const clearBody = await clearRes.json() as { game: GameState }
    expect(clearBody.game.cards?.find((c) => c.id === firstCard.id)?.customName).toBeUndefined()

    const { token: agentToken } = await (await fetch(`${base}/api/agent/token`, { method: 'POST', headers })).json() as { token: string }
    const agentHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }
    const agentRename = await fetch(`${base}/api/agent/action`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({ action: 'rename_card', cardId: firstCard.id, name: 'AI核心' }),
    })
    expect(agentRename.status).toBe(200)
    const agentState = await (await fetch(`${base}/api/agent/state`, { headers: agentHeaders })).json() as {
      game: { cards: Array<{ id: string; name: string; customName: string | null }> }
    }
    expect(agentState.game.cards.find((c) => c.id === firstCard.id)).toMatchObject({ name: 'AI核心', customName: 'AI核心' })
  })
})
