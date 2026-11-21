import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ACCOUNT_DB_FILE, ACCOUNT_WRITE_BATCH_SIZE, AccountStore, type Account } from '../server/account-store.ts'
import { hydrateMatchRecord, hydrateSeasonHistoryEntry } from '../server/account-parts.ts'
import type { GameState } from '../src/game/types.ts'

const dirs: string[] = []
const stores: AccountStore[] = []
function directory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-sqlite-'))
  dirs.push(dir)
  return dir
}
function open(dir = directory(), delay = 1000): AccountStore {
  const store = new AccountStore(dir, delay)
  stores.push(store)
  return store
}
function account(id = 'alice'): Account {
  return {
    id, username: id, salt: 'salt', passwordHash: 'hash', agentToken: `fm_${id}`,
    game: { clubName: '测试球队', roster: [] } as unknown as GameState,
    revision: 7, lastUserRevision: 5, appliedMatchIds: ['match-1'], offerKey: '1:2',
    createdAt: 100, updatedAt: 200,
  }
}
function inspect<T>(dir: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(dir, ACCOUNT_DB_FILE))
  try { return run(db) } finally { db.close() }
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('SQLite 账号存储', () => {
  it('完整迁移旧账号 / 会话；保留 JSON 且只导入一次', () => {
    const dir = directory()
    const original = account('教练甲')
    const accounts = JSON.stringify({ accounts: [original] }, null, 2)
    const sessions = JSON.stringify({ valid: original.id, orphan: 'deleted' })
    fs.writeFileSync(path.join(dir, 'accounts.json'), accounts)
    fs.writeFileSync(path.join(dir, 'sessions.json'), sessions)
    const store = open(dir)
    expect(store.accounts).toEqual([original])
    expect(store.sessions).toEqual({ valid: original.id })
    original.game.clubName = 'SQLite 中的新名字'
    original.revision++
    store.save(original)
    store.setSession('valid', null)
    store.setSession('new', original.id)
    store.close()
    expect(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')).toBe(accounts)
    expect(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')).toBe(sessions)
    const restarted = open(dir)
    expect(restarted.accounts).toEqual([original])
    expect(restarted.sessions).toEqual({ new: original.id })
    expect(inspect(dir, (db) => db.prepare('PRAGMA journal_mode').get())).toMatchObject({ journal_mode: 'wal' })
  })

  it('升级旧 SQLite 后保存并重启时保留在线时间和 AI 接管状态', async () => {
    const dir = directory()
    const first = open(dir)
    first.save(account())
    first.close()
    inspect(dir, (db) => db.exec('ALTER TABLE accounts DROP COLUMN last_online_at; ALTER TABLE accounts DROP COLUMN ai_takeover_key;'))
    const upgraded = open(dir)
    const alice = upgraded.accounts[0]
    alice.lastOnlineAt = 12345
    alice.aiTakeoverKey = '2:3'
    upgraded.save(alice)
    await upgraded.flush()
    upgraded.close()
    expect(open(dir).accounts[0]).toMatchObject({ lastOnlineAt: 12345, aiTakeoverKey: '2:3' })
  })

  it('没有旧文件的新安装也有迁移标记，不导入后来出现的过期 JSON', () => {
    const dir = directory()
    open(dir).close()
    fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts: [account()] }))
    expect(open(dir).accounts).toEqual([])
  })

  it('损坏的旧 JSON 让启动失败；事务回滚，修好后可以重新迁移', () => {
    const dir = directory()
    const legacy = path.join(dir, 'accounts.json')
    fs.writeFileSync(legacy, '{broken')
    expect(() => open(dir)).toThrow()
    fs.writeFileSync(legacy, JSON.stringify({ accounts: [account('Alice'), account('alice')] }))
    expect(() => open(dir)).toThrow(/UNIQUE/)
    expect(inspect(dir, (db) => db.prepare('SELECT count(*) AS n FROM accounts').get())).toMatchObject({ n: 0 })
    fs.writeFileSync(legacy, JSON.stringify({ accounts: [account()] }))
    expect(open(dir).accounts).toEqual([account()])
  })

  it('100 个账号中合并同账号多次保存，只写当前账号一次，其他账号完全不写', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    const others = Array.from({ length: 99 }, (_, index) => account(`coach_${index}`))
    store.save(alice)
    for (const other of others) store.save(other)
    store.setSession('token', alice.id)
    store.flushSync()
    inspect(dir, (db) => db.exec(`CREATE TABLE audit (id TEXT);
      CREATE TRIGGER account_updates AFTER UPDATE ON accounts BEGIN INSERT INTO audit VALUES (new.id); END;`))
    for (let n = 0; n < 10; n++) {
      alice.game.clubName = `修改 ${n}`
      alice.revision++
      store.save(alice)
    }
    expect(inspect(dir, (db) => db.prepare('SELECT * FROM audit').all())).toEqual([])
    await store.flush()
    expect(inspect(dir, (db) => db.prepare('SELECT * FROM audit').all())).toEqual([{ id: alice.id }])
    store.close()
    const next = open(dir)
    expect(next.accounts).toEqual([alice, ...others])
    expect(next.sessions).toEqual({ token: alice.id })
    expect(fs.existsSync(path.join(dir, 'accounts.json'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'sessions.json'))).toBe(false)
  })

  it('全员恢复时分小批序列化，最后提交跨批账号会话，并保留并发的新修改', async () => {
    const dir = directory()
    const store = open(dir)
    const players = Array.from({ length: ACCOUNT_WRITE_BATCH_SIZE * 3 + 1 }, (_, i) => account(`batch_${i}`))
    for (const player of players) { store.save(player); store.setSession(`token_${player.id}`, player.id) }
    const flushing = store.flush()
    const firstBatch = (store as unknown as { inFlight: { accounts: Account[] } }).inFlight
    expect(firstBatch.accounts).toHaveLength(ACCOUNT_WRITE_BATCH_SIZE)
    players[0].revision++
    players[0].game.clubName = '写入期间更新'
    store.save(players[0])
    await Promise.all([flushing, store.flush()])
    store.close()
    const restarted = open(dir)
    expect(restarted.accounts).toEqual(players)
    expect(restarted.sessions).toEqual(Object.fromEntries(players.map(p => [`token_${p.id}`, p.id])))
  })

  it('定时器自动后台写入，不需要手动 flush', async () => {
    const dir = directory()
    const store = open(dir, 20)
    store.save(account())
    await expect.poll(() => inspect(dir, (db) => db.prepare('SELECT revision FROM accounts').get()), { timeout: 3000 })
      .toMatchObject({ revision: 7 })
  })

  it('后台写入期间的新保存不会丢失，并支持并发 flush', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    store.save(alice)
    const first = store.flush()
    alice.game.clubName = '后台写入期间又修改'
    alice.revision++
    store.save(alice)
    store.setSession('session', alice.id)
    await Promise.all([first, store.flush()])
    store.close()
    const next = open(dir)
    expect(next.accounts).toEqual([alice])
    expect(next.sessions).toEqual({ session: alice.id })
  })

  it('同步关闭等待在途事务，再写最后一份状态；允许重复关闭和立即重启', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    store.save(alice)
    const inFlight = store.flush()
    alice.game.clubName = '关闭前的最后修改'
    alice.revision++
    store.save(alice)
    store.setSession('session', alice.id)
    store.close()
    store.close()
    await inFlight
    const next = open(dir)
    expect(next.accounts).toEqual([alice])
    expect(next.sessions).toEqual({ session: alice.id })
    expect(() => store.save(alice)).toThrow(/已关闭/)
  })

  it('失败的异步事务保留脏状态，修复原因后能重试；账号和会话原子提交', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    const bob = account('bob')
    store.save(alice)
    store.save(bob)
    await store.flush()
    bob.username = 'ALICE'
    store.save(bob)
    store.setSession('new', alice.id)
    await expect(store.flush()).rejects.toThrow(/UNIQUE/)
    expect(inspect(dir, (db) => db.prepare('SELECT * FROM sessions').all())).toEqual([])
    bob.username = 'Robert'
    await store.flush()
    store.close()
    const next = open(dir)
    expect(next.accounts).toEqual([alice, bob])
    expect(next.sessions).toEqual({ new: alice.id })
  })

  it('会话删除与 Agent 令牌吊销在重启后仍生效，即使 revision 没变', async () => {
    const dir = directory()
    const store = open(dir)
    const alice = account()
    store.save(alice)
    store.setSession('logged-out', alice.id)
    await store.flush()
    delete alice.agentToken
    store.save(alice)
    store.setSession('logged-out', null)
    store.setSession('still-in', alice.id)
    store.close()
    const next = open(dir)
    expect(next.accounts[0].agentToken).toBeUndefined()
    expect(next.accounts[0].revision).toBe(7)
    expect(next.sessions).toEqual({ 'still-in': alice.id })
  })

  it('联机账号自动把战报重明细与历年旧赛程拆至 SQLite 冷表按需读取，并共享只读世界/球队部件', async () => {
    const dir = directory()
    const sharedTeam = { id: 'ai_01', name: '曼城', players: [{ id: 'p1', name: '哈兰德' }], lineup: { starters: [] } }
    const otherDiv = { index: 2, divisionId: 'champions', clubIds: ['ai_01'], table: [], fixtures: [{ round: 1, homeId: 'ai_01', awayId: 'ai_02', played: false }] }
    const sharedCupHistory = [{ version: 1, seasonIndex: 1, cups: [{ id: 'champions', name: '冠军杯', rounds: [] }] }]
    const sharedReserve = [{ id: 'star_1', name: '储备球星' }]
    const makeShared = (id: string, ownDivId: string): Account => ({
      ...account(id),
      game: {
        shared: true,
        clubName: `球队_${id}`,
        roster: [],
        aiTeams: [structuredClone(sharedTeam)],
        reserveStars: structuredClone(sharedReserve),
        season: { index: 2, divisionId: ownDivId, clubIds: ['player', 'ai_01'], table: [], fixtures: [], round: 1, finished: false },
        world: {
          seasonIndex: 2,
          playerDivisionId: ownDivId,
          clubs: [{ id: 'player', squadKey: `club_${id}` }],
          divisions: [
            structuredClone(otherDiv),
            { index: 2, divisionId: ownDivId, clubIds: ['player', 'ai_01'], table: [], fixtures: [], round: 1, finished: false },
          ],
          seasonCupHistory: structuredClone(sharedCupHistory),
        },
        matchHistory: [{
          id: `m-${id}-1`,
          seed: 1,
          createdAt: 1000,
          isLeague: true,
          round: 1,
          homeId: 'player',
          awayId: 'ai_01',
          homeName: `球队_${id}`,
          awayName: '曼城',
          score: { home: 2, away: 1 },
          result: 'win',
          stats: {},
          playerStats: [{ playerId: 'p1', goals: 2 }],
          commentary: [{ minute: 12, text: '精彩远射破门！' }],
          keyEvents: [{ minute: 12, type: 'goal', text: '进球' }],
          skillStats: [{ playerId: 'p1', skillId: 'long_shot', triggers: 3 }],
          failureStats: [],
          goalDetails: [{ minute: 12, scorerId: 'p1' }],
          instructions: [{ minute: 60, note: '加强逼抢' }],
          lineup: { formationId: '4-3-3', starters: ['p1'], bench: [], tactics: {} },
        }],
        challengeHistory: [],
        seasonHistory: [{
          index: 1,
          divisionId: ownDivId,
          tier: 'division2',
          table: [{ teamId: 'player', points: 72 }],
          finished: true,
          champion: 'player',
          playerFinish: 1,
          fixtures: [{ round: 1, homeId: 'player', awayId: 'ai_01', played: true, score: { home: 1, away: 0 } }],
        }],
      } as unknown as GameState,
    })

    const store = open(dir)
    const a = makeShared('coach_a', 'd2-north')
    const b = makeShared('coach_b', 'd2-south')
    store.save(a)
    store.save(b)

    // 保存调用后立刻从内存剥离重明细，同时未落盘缓冲仍可即时读取完整数据。
    expect(a.game.matchHistory[0].detailDeferred).toBe(true)
    expect(a.game.matchHistory[0].commentary).toBeUndefined()
    expect(a.game.matchHistory[0].keyEvents).toEqual([])
    expect(a.game.seasonHistory![0].fixtures).toEqual([])
    expect(a.game.seasonHistory![0].table).toEqual([{ teamId: 'player', points: 72 }])

    const pendingHydrated = hydrateMatchRecord(a.game.matchHistory[0], store.getMatchDetail(a.id, 'm-coach_a-1'))
    expect(pendingHydrated.detailDeferred).toBeUndefined()
    expect(pendingHydrated.commentary).toEqual([{ minute: 12, text: '精彩远射破门！' }])
    expect(pendingHydrated.lineup.starters).toEqual(['p1'])
    const pendingSeason = hydrateSeasonHistoryEntry(a.game.seasonHistory![0], store.getSeasonHistoryFixtures(a.id, 1))
    expect(pendingSeason.fixtures).toHaveLength(1)

    await store.flush()
    store.close()

    // 重启后验证：1) SQLite 冷表完整可读；2) 共享只读部件跨账号复用同一冻结引用（===）。
    const reloaded = open(dir)
    const ra = reloaded.accounts.find((item) => item.id === 'coach_a')!
    const rb = reloaded.accounts.find((item) => item.id === 'coach_b')!
    expect(ra.game.aiTeams[0]).toBe(rb.game.aiTeams[0])
    expect(Object.isFrozen(ra.game.aiTeams[0])).toBe(true)
    expect(ra.game.reserveStars).toBe(rb.game.reserveStars)
    expect(Object.isFrozen(ra.game.reserveStars)).toBe(true)
    expect(ra.game.world!.divisions[0]).toBe(rb.game.world!.divisions[0])
    expect(Object.isFrozen(ra.game.world!.divisions[0])).toBe(true)
    expect(ra.game.world!.seasonCupHistory).toBe(rb.game.world!.seasonCupHistory)
    expect(Object.isFrozen(ra.game.world!.seasonCupHistory)).toBe(true)
    // 玩家本赛区仍保持可变且直接复用 game.season 引用。
    expect(ra.game.world!.divisions[1]).toBe(ra.game.season)

    const diskMatch = hydrateMatchRecord(ra.game.matchHistory[0], reloaded.getMatchDetail(ra.id, 'm-coach_a-1'))
    expect(diskMatch.commentary).toEqual([{ minute: 12, text: '精彩远射破门！' }])
    const diskSeason = hydrateSeasonHistoryEntry(ra.game.seasonHistory![0], reloaded.getSeasonHistoryFixtures(ra.id, 1))
    expect(diskSeason.fixtures).toEqual([{ round: 1, homeId: 'player', awayId: 'ai_01', played: true, score: { home: 1, away: 0 } }])

    // 席位交接（replaceHolder）必须连同冷表一起过户给新持有人，不因外键级联丢失战报/历年赛程。
    const handed: Account = { ...ra, id: 'club:club_coach_a', username: 'club:club_coach_a', agentToken: undefined }
    reloaded.replaceHolder(ra, handed, 'club_coach_a', '原名')
    expect(reloaded.getMatchDetail(handed.id, 'm-coach_a-1')).toContain('精彩远射破门！')
    expect(reloaded.getSeasonHistoryFixtures(handed.id, 1)).toContain('"played":true')
  })
})
