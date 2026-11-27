import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createAppServer, type AppServer } from '../server/app.ts'
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  appendChatMessage,
  normalizeChatText,
  validateChatText,
  type ChatMessage,
} from '../src/game/chat.ts'

const servers: AppServer[] = []
const dirs: string[] = []

async function start(now?: () => number, dir?: string) {
  const dataDir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'fm-chat-test-'))
  if (!dirs.includes(dataDir)) dirs.push(dataDir)
  const app = createAppServer({ dataDir, staticDir: path.resolve('dist'), tickMs: 0, now })
  servers.push(app)
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
  const port = (app.server.address() as AddressInfo).port
  return { app, base: `http://127.0.0.1:${port}`, dir: dataDir }
}

async function register(base: string, username: string) {
  const response = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  })
  expect(response.status).toBe(201)
  return response.json() as Promise<{ token: string; user: { id: string; username: string }; game: Record<string, any> }>
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (data: any) => boolean,
  previous = '',
): Promise<{ data: any; rest: string }> {
  let buffer = previous
  for (;;) {
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const block = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const line = block.split('\n').find((item) => item.startsWith('data: '))
      if (line) {
        const parsed = JSON.parse(line.slice(6))
        if (predicate(parsed)) return { data: parsed, rest: buffer }
      }
      index = buffer.indexOf('\n\n')
    }
    const chunk = await reader.read()
    if (chunk.done) throw new Error('SSE stream ended before expected event')
    buffer += new TextDecoder().decode(chunk.value)
  }
}

afterEach(async () => {
  for (const app of servers.splice(0)) await app.shutdown()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('全服聊天（纯函数与服务端）', () => {
  it('清洗文本并校验长度与空消息，appendChatMessage 严格保留最新 N 条', () => {
    expect(normalizeChatText('  你好\n\n全服\t教练  ')).toBe('你好 全服 教练')
    expect(validateChatText('   ')).toEqual({ ok: false, error: '消息内容不能为空' })
    expect(validateChatText('哈'.repeat(CHAT_MAX_LENGTH + 1)).ok).toBe(false)
    expect(validateChatText('哈'.repeat(CHAT_MAX_LENGTH))).toEqual({ ok: true, text: '哈'.repeat(CHAT_MAX_LENGTH) })

    let list: ChatMessage[] = []
    for (let i = 1; i <= 55; i++) {
      list = appendChatMessage(list, {
        id: `m-${i}`,
        accountId: 'a1',
        username: 'coach',
        clubId: 'c1',
        clubName: '测试队',
        clubColor: '#cdf33f',
        text: `第 ${i} 条`,
        at: i * 1000,
      })
    }
    expect(list).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(list[0].id).toBe('m-6')
    expect(list[list.length - 1].id).toBe('m-55')
  })

  it('支持实时 SSE 广播、冷却限流与未登录拦截', async () => {
    let clock = 1_700_000_000_000
    const { base } = await start(() => clock)
    const alice = await register(base, 'alice_chat')
    const bob = await register(base, 'bob_chat')

    // 未登录不能发言，但可以拉取历史
    const unauth = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '偷发一条' }),
    })
    expect(unauth.status).toBe(401)

    // Bob 打开 SSE 连接，先收到初始空 snapshot
    const sseController = new AbortController()
    const sseRes = await fetch(`${base}/api/events?token=${bob.token}`, { signal: sseController.signal })
    expect(sseRes.status).toBe(200)
    const reader = sseRes.body!.getReader()
    const initial = await readSseUntil(reader, (data) => data.type === 'chat' && data.mode === 'snapshot')
    expect(initial.data.messages).toEqual([])

    // Alice 发消息，Bob 实时收到 append
    const post1 = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '大家好，今晚有友谊赛吗？' }),
    })
    expect(post1.status).toBe(200)
    const body1 = await post1.json() as { ok: boolean; message: ChatMessage; messages: ChatMessage[] }
    expect(body1.ok).toBe(true)
    expect(body1.message.username).toBe('alice_chat')
    expect(body1.message.clubName).toBe(alice.game.clubName)

    const liveAppend = await readSseUntil(reader, (data) => data.type === 'chat' && data.mode === 'append', initial.rest)
    expect(liveAppend.data.message.id).toBe(body1.message.id)
    expect(liveAppend.data.message.text).toBe('大家好，今晚有友谊赛吗？')

    // 冷却期内连发返回 429
    clock += 500
    const tooFast = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '刷屏测试' }),
    })
    expect(tooFast.status).toBe(429)

    // 俱乐部改名后，聊天记录里的球队名同步更新并推送 snapshot
    clock += CHAT_COOLDOWN_MS + 100
    const rename = await fetch(`${base}/api/club/rename`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '皇家北极星' }),
    })
    expect(rename.status).toBe(200)

    const renamedSnap = await readSseUntil(reader, (data) => data.type === 'chat' && data.mode === 'snapshot', liveAppend.rest)
    expect(renamedSnap.data.messages).toHaveLength(1)
    expect(renamedSnap.data.messages[0].clubName).toBe('皇家北极星')

    sseController.abort()
  })

  it('最多保留最新 50 条消息，重启服务器后从 chat.json 恢复且支持 Agent API', async () => {
    let clock = 1_700_000_000_000
    const first = await start(() => clock)
    const alice = await register(first.base, 'cap_coach')

    for (let i = 1; i <= 55; i++) {
      clock += CHAT_COOLDOWN_MS + 50
      const res = await fetch(`${first.base}/api/chat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `消息 #${i}` }),
      })
      expect(res.status).toBe(200)
    }

    const listRes = await fetch(`${first.base}/api/chat`)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json() as { messages: ChatMessage[] }
    expect(listBody.messages).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(listBody.messages[0].text).toBe('消息 #6')
    expect(listBody.messages[49].text).toBe('消息 #55')

    // 落盘文件也严格只有 50 条，不会无限增长
    const stored = JSON.parse(fs.readFileSync(path.join(first.dir, 'chat.json'), 'utf8')) as ChatMessage[]
    expect(stored).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(stored[0].text).toBe('消息 #6')

    // 生成 Agent 令牌，再关闭并原目录重启服务器，验证持久化与 Agent API
    const tokenRes = await fetch(`${first.base}/api/agent/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}` },
    })
    expect(tokenRes.status).toBe(200)
    const { token: agentToken } = await tokenRes.json() as { token: string }

    await first.app.shutdown()
    servers.splice(servers.indexOf(first.app), 1)

    const second = await start(() => clock, first.dir)
    const getChat = await fetch(`${second.base}/api/agent/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_chat' }),
    })
    expect(getChat.status).toBe(200)
    const getChatBody = await getChat.json() as { ok: boolean; result: { messages: ChatMessage[] } }
    expect(getChatBody.ok).toBe(true)
    expect(getChatBody.result.messages).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(getChatBody.result.messages[0].text).toBe('消息 #6')

    clock += CHAT_COOLDOWN_MS + 50
    const sendChat = await fetch(`${second.base}/api/agent/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send_chat', text: 'Agent 第 56 条问候' }),
    })
    expect(sendChat.status).toBe(200)
    const sendChatBody = await sendChat.json() as { ok: boolean; result: { message: ChatMessage; messages: ChatMessage[] } }
    expect(sendChatBody.ok).toBe(true)
    expect(sendChatBody.result.messages).toHaveLength(CHAT_HISTORY_LIMIT)
    expect(sendChatBody.result.messages[0].text).toBe('消息 #7')
    expect(sendChatBody.result.messages[49].text).toBe('Agent 第 56 条问候')
  })

  it('支持权威校验的角色卡名片与比赛战报分享（不泄露隐藏属性、防伪造并支持持久化恢复）', async () => {
    let clock = 1_700_000_000_000
    const { app, base, dir } = await start(() => clock)
    const alice = await register(base, 'share_coach')

    // 伪造不存在的卡片 ID 或战报 ID 会被服务端拒绝
    const fakeCard = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '看我神卡', share: { kind: 'card', cardId: 'fake-card-999' } }),
    })
    expect(fakeCard.status).toBe(400)

    const fakeMatch = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', share: { kind: 'match', recordId: 'm-nonexistent' } }),
    })
    expect(fakeMatch.status).toBe(400)

    // 先给外场球员产出一张真实角色卡并打一场友谊赛写入存档
    const player = alice.game.roster.find((p: any) => (p.positions?.GK ?? 0) === 0) ?? alice.game.roster[0]
    const seededCard = {
      id: `card-${player.id}-1`,
      playerId: player.id,
      playerName: player.name,
      serial: 1,
      customName: '双彩猎狐',
      routeId: 'through_passing',
      createdAt: clock,
      attrs: { ...player.attrs, shooting: 920, passing: 880, consistency: 19, dirtiness: 18 },
      positions: { ...player.positions },
      personality: { ...player.personality },
      skills: ['through_ball', 'box_hunter'],
      skillTiers: { through_ball: 'rainbow', box_hunter: 'gold' },
      version: 1,
    }
    alice.game.cards = [seededCard]
    alice.game.challengeHistory = [
      {
        id: 'm-friendly-test-1',
        seed: 778899,
        createdAt: clock,
        seasonIndex: 1,
        durationSeconds: 900,
        isLeague: false,
        mode: 'friendly',
        homeId: 'player',
        awayId: 'd2n_1',
        homeName: alice.game.clubName,
        awayName: '测试对手队',
        score: { home: 3, away: 1 },
        result: 'win',
        stats: {
          home: { possession: 58, passes: 280, passesCompleted: 235, shots: 14, shotsOnTarget: 8, goals: 3, interceptions: 10, tackles: 12, fouls: 6, corners: 5, xg: 2.64, distance: 98, yellowCards: 1, redCards: 0 },
          away: { possession: 42, passes: 200, passesCompleted: 150, shots: 6, shotsOnTarget: 3, goals: 1, interceptions: 8, tackles: 11, fouls: 9, corners: 2, xg: 0.82, distance: 94, yellowCards: 2, redCards: 0 },
        },
        playerStats: [
          { playerId: player.id, name: player.name, side: 'home', minutes: 90, passes: 40, passesCompleted: 35, shots: 5, goals: 2, assists: 1, tackles: 2, interceptions: 1, distance: 10.2, staminaLeft: 70, touches: 55, rating: 9.2 },
        ],
        skillStats: [],
        failureStats: [],
        keyEvents: [
          { seq: 1, clock: 220, half: 1, type: 'goal', team: 'home', text: `${player.name}破门！` },
        ],
        goalDetails: [
          { playerId: player.id, playerName: player.name, side: 'home', clock: 220, half: 1, origin: { x: 88, y: 34 }, distance: 11, bodyPart: 'right', technique: 'placed', situation: 'open', target: 'bottom_right' },
        ],
        instructions: [],
        lineup: alice.game.lineup,
        opponentId: 'd2n_1',
      },
    ]

    const putRes = await fetch(`${base}/api/game`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: alice.game, baseRevision: 1 }),
    })
    expect(putRes.status).toBe(200)

    // 1. 晒角色卡（允许空文本，且服务端只提取主属性，绝不下发 consistency / dirtiness 等隐藏属性）
    clock += CHAT_COOLDOWN_MS + 100
    const shareCardRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', share: { kind: 'card', cardId: seededCard.id } }),
    })
    expect(shareCardRes.status).toBe(200)
    const shareCardBody = await shareCardRes.json() as { ok: boolean; message: ChatMessage }
    expect(shareCardBody.message.share?.kind).toBe('card')
    if (shareCardBody.message.share?.kind === 'card') {
      expect(shareCardBody.message.share.cardTitle).toBe('双彩猎狐')
      expect(shareCardBody.message.share.skills).toEqual(['through_ball', 'box_hunter'])
      expect(shareCardBody.message.share.attrs.shooting).toBe(920)
      expect((shareCardBody.message.share.attrs as Record<string, unknown>).consistency).toBeUndefined()
      expect((shareCardBody.message.share.attrs as Record<string, unknown>).dirtiness).toBeUndefined()
    }

    // 2. 晒比赛战报（附带自定义留言）
    clock += CHAT_COOLDOWN_MS + 100
    const shareMatchRes = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '这场大胜太爽了！', share: { kind: 'match', recordId: 'm-friendly-test-1' } }),
    })
    expect(shareMatchRes.status).toBe(200)
    const shareMatchBody = await shareMatchRes.json() as { ok: boolean; message: ChatMessage }
    expect(shareMatchBody.message.text).toBe('这场大胜太爽了！')
    expect(shareMatchBody.message.share?.kind).toBe('match')
    if (shareMatchBody.message.share?.kind === 'match') {
      expect(shareMatchBody.message.share.score).toEqual({ home: 3, away: 1 })
      expect(shareMatchBody.message.share.goals).toHaveLength(1)
      expect(shareMatchBody.message.share.mvp?.name).toBe(player.name)
    }

    // 重启服务器后，带 share 附件的历史消息完整保留
    await app.shutdown()
    servers.splice(servers.indexOf(app), 1)
    const restarted = await start(() => clock, dir)
    const afterRes = await fetch(`${restarted.base}/api/chat`)
    const afterBody = await afterRes.json() as { messages: ChatMessage[] }
    expect(afterBody.messages).toHaveLength(2)
    expect(afterBody.messages[0].share?.kind).toBe('card')
    expect(afterBody.messages[1].share?.kind).toBe('match')
  })
})
