import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { game, setGame, ui } from '../src/ui/state.ts'
import { createWorldGame, worldTransferTeams } from '../src/game/world.ts'
import { aiTransferOffers } from '../src/game/market.ts'
import { isLocalFreeAgentAvailable } from '../src/game/free-market.ts'
import { untrainedPlayer } from '../src/game/cards.ts'
import { economyOf } from '../src/game/economy.ts'
import { SCOUT_LEVELS, startScouting } from '../src/game/scouting.ts'
import { onlineState } from '../src/online.ts'

const mocks = vi.hoisted(() => ({
  save: vi.fn(() => true), online: false,
  start: vi.fn(async (_player: string, _source: string, _level: number, _club?: string) => {}),
  refresh: vi.fn(async () => true),
}))
vi.mock('../src/game/state.ts', async (original) => ({ ...await original<typeof import('../src/game/state.ts')>(), saveGame: mocks.save }))
vi.mock('../src/ui/morph.ts', () => ({ morph: vi.fn() }))
vi.mock('../src/ui/tooltip.ts', () => ({ installTooltips: vi.fn(), syncTooltip: vi.fn() }))
vi.mock('../src/online.ts', async (original) => ({
  ...await original<typeof import('../src/online.ts')>(), isOnlineMode: () => mocks.online,
  startScoutingOnline: mocks.start, refreshGameOnline: mocks.refresh,
  loadPublicConfig: () => new Promise(() => {}),
}))

let click: (event: unknown) => Promise<void>
let originalGame: typeof game
let originalUi: typeof ui
const now = 1731000000000
beforeAll(async () => {
  originalGame = game
  originalUi = { ...ui }
  const listeners: Record<string, Array<(event: unknown) => Promise<void>>> = {}
  const app = { toggleAttribute: vi.fn(), setAttribute: vi.fn() }
  vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'app' ? app : null,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: (type: string, listener: (event: unknown) => Promise<void>) => { (listeners[type] ??= []).push(listener) },
  })
  vi.stubGlobal('window', { addEventListener: vi.fn(), setInterval: vi.fn(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), scrollTo: vi.fn() })
  await import('../src/ui/app.ts')
  expect(listeners.click?.length).toBeGreaterThan(0)
  click = listeners.click.at(-1)!
})
afterAll(() => {
  setGame(originalGame); Object.assign(ui, originalUi)
  Object.assign(onlineState, { status: 'offline', user: null })
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})
beforeEach(() => {
  setGame(createWorldGame(20241107))
  Object.assign(ui, originalUi, { screen: 'transfer', notice: '' })
  Object.assign(onlineState, { status: 'offline', user: null, error: '' })
  mocks.online = false
  mocks.save.mockReset().mockReturnValue(true)
  mocks.start.mockReset().mockResolvedValue(undefined)
  mocks.refresh.mockReset().mockResolvedValue(true)
  economyOf(game).balance = 1_000_000
  vi.spyOn(Date, 'now').mockReturnValue(now)
})

async function act(action: string, dataset: Record<string, string> = {}, level = '1') {
  const query = vi.fn((selector: string) => selector === '[data-scout-level]' ? { value: level } : null)
  const controls = { querySelector: query }
  const el = { dataset: { action, ...dataset }, matches: () => false, contains: () => false,
    closest: (selector: string) => selector === '[data-action]' ? el : selector === '.scout-controls' ? controls : null }
  await click({ target: el })
  return query
}
function foreignTeam() {
  const local = new Set(game.aiTeams.map(team => team.id))
  const team = worldTransferTeams(game).find(item => !local.has(item.id) && item.players.length > 0)!
  expect(team).toBeDefined()
  return team
}

describe('球探实际点击：单机', () => {
  it('从世界中非本赛区球队解析球员，并从最近控件读取选择等级、扣费', async () => {
    const team = foreignTeam(), player = team.players[0]
    const config = SCOUT_LEVELS.find(item => item.level === 3)!
    const query = await act('scout-start', { player: player.id, source: 'club', club: team.id }, '3')
    expect(query).toHaveBeenCalledWith('[data-scout-level]')
    expect(game.scoutReports).toHaveLength(1)
    expect(game.scoutReports![0]).toMatchObject({ playerId: player.id, source: 'club', clubId: team.id, level: 3, fee: config.fee })
    expect(economyOf(game).balance).toBe(1_000_000 - config.fee)
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it('AI 转会按原始版本生成报告，球队不匹配时拒绝', async () => {
    const offer = aiTransferOffers({ ...game, aiTeams: worldTransferTeams(game) })[0]
    expect(offer).toBeDefined()
    const { team, player } = offer
    player.version = 7
    const expected = startScouting(structuredClone(game), untrainedPlayer(player), { source: 'transfer', clubId: team.id }, 2, now).report!
    await act('scout-start', { player: player.id, source: 'transfer', club: 'wrong' }, '2')
    expect(ui.notice).toContain('不在指定球队')
    expect(mocks.save).not.toHaveBeenCalled()
    await act('scout-start', { player: player.id, source: 'transfer', club: team.id }, '2')
    expect(game.scoutReports![0]).toEqual(expected)
    expect(game.scoutReports![0].snapshotLabel).toBe('原始版本')
    expect(economyOf(game).balance).toBe(1_000_000 - SCOUT_LEVELS.find(x => x.level === 2)!.fee)
  })
  it('只解析当前可用的自由市场球员并按原始版本扣费', async () => {
    const player = game.freeStars.find(p => isLocalFreeAgentAvailable(game, p, now))!
    expect(player).toBeDefined()
    player.version = 6
    const expected = startScouting(structuredClone(game), untrainedPlayer(player), { source: 'market' }, 5, now).report!
    await act('scout-start', { player: player.id, source: 'market' }, '5')
    expect(game.scoutReports![0]).toEqual(expected)
    expect(economyOf(game).balance).toBe(1_000_000 - SCOUT_LEVELS.find(x => x.level === 5)!.fee)
    expect(mocks.save).toHaveBeenCalledOnce()
    const unavailable = game.freeStars.find(p => p.id !== player.id)!
    unavailable.marketDay = -999999
    expect(isLocalFreeAgentAvailable(game, unavailable, now)).toBe(false)
    await act('scout-start', { player: unavailable.id, source: 'market' }, '5')
    expect(ui.notice).toContain('不在指定球队')
    expect(game.scoutReports).toHaveLength(1)
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it('未到期重复委托失败，不再扣费或存档', async () => {
    const team = game.aiTeams[0], player = team.players[0]
    const data = { player: player.id, source: 'club', club: team.id }
    await act('scout-start', data, '1')
    const before = structuredClone(game)
    await act('scout-start', data, '5')
    expect(ui.notice).toContain('已有未完成')
    expect(game).toEqual(before)
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it.each(['false', 'throw'])('存档%s时回滚报告和余额', async (failure) => {
    const team = game.aiTeams[0], player = team.players[0]
    const before = structuredClone(game)
    if (failure === 'false') mocks.save.mockReturnValueOnce(false)
    else mocks.save.mockImplementationOnce(() => { throw new Error('磁盘异常') })
    await act('scout-start', { player: player.id, source: 'club', club: team.id }, '4')
    expect(game).toEqual(before)
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(ui.notice).toContain(failure === 'false' ? '操作已撤销' : '磁盘异常')
  })
  it('无效等级或缺少球队不发起委托', async () => {
    const team = game.aiTeams[0], player = team.players[0]
    const before = structuredClone(game)
    await act('scout-start', { player: player.id, source: 'club', club: team.id }, '99')
    await act('scout-start', { player: player.id, source: 'club' }, '1')
    expect(game).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})

describe('球探实际点击：联机', () => {
  it.each(['club', 'transfer', 'market'])('提交%s来源、等级和球队，然后刷新服务器', async (source) => {
    mocks.online = true
    Object.assign(onlineState, { status: 'online', user: { id: 'coach', username: 'coach' } })
    const before = structuredClone(game)
    const club = source === 'market' ? undefined : 'team-1'
    const query = await act('scout-start', { player: 'player-1', source, ...(club ? { club } : {}) }, '4')
    expect(query).toHaveBeenCalledWith('[data-scout-level]')
    expect(mocks.start).toHaveBeenCalledWith('player-1', source, 4, club)
    expect(ui.notice).toContain('球探已出发')
    await act('scout-refresh')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(ui.notice).toContain('报告已刷新')
    expect(game).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('断线时禁止回退离线扣钱和刷新', async () => {
    game.shared = true
    Object.assign(onlineState, { status: 'offline', user: { id: 'coach', username: 'coach' } })
    const team = game.aiTeams[0], player = team.players[0], before = structuredClone(game)
    await act('scout-start', { player: player.id, source: 'club', club: team.id }, '1')
    expect(ui.notice).toContain('联机连接已断开')
    await act('scout-refresh')
    expect(ui.notice).toContain('联机连接已断开')
    expect(game).toEqual(before)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('服务器错误显示通知且不改本地数据', async () => {
    mocks.online = true
    const before = structuredClone(game)
    mocks.start.mockRejectedValueOnce(new Error('委托失败'))
    await act('scout-start', { player: 'p', source: 'market' })
    expect(ui.notice).toBe('委托失败')
    mocks.refresh.mockRejectedValueOnce(new Error('刷新失败'))
    await act('scout-refresh')
    expect(ui.notice).toBe('刷新失败')
    expect(game).toEqual(before)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
