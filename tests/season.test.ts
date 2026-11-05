import { describe, expect, it, beforeEach } from 'vitest'
import { createInitialGame, GAME_VERSION, LEGACY_SAVE_KEY, loadGame, saveGame, upgradeLegacySignatures } from '../src/game/state.ts'
import { startLeague, restoreActiveEngine, finishMatch, simulateSeasonRound, startSingleChallenge } from '../src/game/actions.ts'
import { catchUpSeason, playerFixture, ROUND_MS } from '../src/game/season.ts'
import { createTrainingSession, planTraining } from '../src/game/training.ts'
import { isMainAttr } from '../src/game/scale.ts'
import type { Attributes, Player } from '../src/game/types.ts'
import { validateLineup } from '../src/game/squad.ts'
import { listPlayer, cancelListing, playerMarketValue } from '../src/game/market.ts'

describe('赛季与存档', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    })
  })

  it('20 队双循环：38 轮 380 场，玩家 38 场', () => {
    const game = createInitialGame(11)
    expect(game.season.fixtures).toHaveLength(380)
    expect(game.season.fixtures.filter((fixture) => fixture.isPlayer)).toHaveLength(38)
    expect(game.season.fixtures.every((fixture) => fixture.homeId !== fixture.awayId)).toBe(true)
    expect(game.season.fixtures.filter((fixture) => fixture.round === 1)).toHaveLength(10)
  })

  it('玩家比赛写入积分榜，赛季能结束', () => {
    const game = createInitialGame(12)
    let guard = 0
    while (!game.season.finished && guard++ < 40) {
      const fixture = playerFixture(game)
      if (!fixture || fixture.played) {
        const result = simulateSeasonRound(game)
        expect(result.ok).toBe(true)
        continue
      }
      const start = startLeague(game)
      expect(start.ok).toBe(true)
      const engine = restoreActiveEngine(game)
      expect(engine).toBeTruthy()
      engine!.simulate()
      const record = finishMatch(game, engine!)
      expect(record).toBeTruthy()
      expect(game.matchHistory.length).toBeGreaterThan(0)
      expect(game.season.table.find((row) => row.teamId === 'player')!.played).toBeGreaterThan(0)
    }
    expect(game.season.finished).toBe(true)
    expect(game.season.champion).toBeTruthy()
    expect(game.season.playerFinish).toBeGreaterThanOrEqual(1)
    expect(game.matchHistory).toHaveLength(38)
    expect(validateLineup(game.roster, game.lineup).valid).toBe(true)
  }, 30000)

  it('单场挑战记录进入 challengeHistory，淘汰赛平局有点球', () => {
    const game = createInitialGame(13)
    const start = startSingleChallenge(game, game.aiTeams[0].id)
    expect(start.ok).toBe(true)
    const engine = restoreActiveEngine(game)!
    engine.simulate()
    const record = finishMatch(game, engine)
    expect(record).toBeTruthy()
    expect(game.challengeHistory).toHaveLength(1)
    expect(game.activeMatch).toBeUndefined()
    if (record!.score.home === record!.score.away) expect(record!.shootout).toBeTruthy()
  })

  it('存档可恢复完整游戏与进行中的比赛', () => {
    const game = createInitialGame(14)
    const start = startLeague(game)
    expect(start.ok).toBe(true)
    const engine = restoreActiveEngine(game)!
    for (let index = 0; index < 10; index++) engine.step()
    game.activeMatch!.engineState = engine.serialize()
    expect(saveGame(game)).toBe(true)
    const loaded = loadGame()
    expect(loaded).not.toBeNull()
    expect(loaded!.seed).toBe(game.seed)
    expect(loaded!.roster).toHaveLength(game.roster.length)
    expect(loaded!.activeMatch).toBeTruthy()
    expect(validateLineup(loaded!.roster, loaded!.lineup).valid).toBe(true)
    const resumed = restoreActiveEngine(loaded!)!
    expect(resumed.state.step).toBe(engine.state.step)
    resumed.simulate()
    expect(resumed.state.finished).toBe(true)
    const record = finishMatch(loaded!, resumed)
    expect(record).toBeTruthy()
    expect(loaded!.matchHistory).toHaveLength(1)
  })

  it('读取旧档时不改动已保存的初始属性和培养成果', () => {
    const game = createInitialGame(18)
    const player = game.roster[0]
    for (const key of Object.keys(player.attrs) as (keyof Attributes)[]) {
      player.attrs[key] = Math.round(player.attrs[key] * 1.25 * 10) / 10
      player.baseAttrs[key] = player.attrs[key]
    }
    player.pa = 1400
    player.history = [{ action: 1, week: 1, kind: 'event', title: '已有记录', text: '', gains: { passing: 30, firstTouch: 1 } }]
    const session = createTrainingSession(player, 1, { stadium: 1, academy: 1, medical: 3, shop: 1, sponsor: 1 })
    session.log.push({ action: 1, week: 1, kind: 'action', title: '已有培养', text: '', gains: { passing: 45, firstTouch: 1.2 } })
    game.training[player.id] = session
    const before = structuredClone(player)
    const beforeSession = structuredClone(session)
    expect(saveGame(game)).toBe(true)
    const gameLoaded = loadGame()!
    const loaded = gameLoaded.roster.find((item) => item.id === player.id)!
    expect(loaded.baseAttrs).toEqual(before.baseAttrs)
    expect(loaded.attrs).toEqual(before.attrs)
    expect(loaded.ceilings).toEqual(before.ceilings)
    expect(loaded.pa).toBe(before.pa)
    expect(loaded.history).toEqual(before.history)
    expect(gameLoaded.training[player.id].candidate.attrs).toEqual(beforeSession.candidate.attrs)
    expect(gameLoaded.training[player.id].facilityLevels).toEqual(beforeSession.facilityLevels)
    expect(gameLoaded.training[player.id].log).toEqual(beforeSession.log)
  })

  it('读取失效阵容时只修复阵容，不丢失挂牌后留下的球员', () => {
    const game = createInitialGame(15)
    const ids = game.roster.map((player) => player.id)
    game.lineup.starters[0].playerId = 'missing'
    game.autoSubs = { timed: [{ atSeconds: 60, outId: 'missing', inId: game.lineup.bench[0] }], staminaBelow: null, onInjury: false }
    expect(saveGame(game)).toBe(true)
    const loaded = loadGame()!
    expect(loaded.roster.map((player) => player.id)).toEqual(ids)
    expect(validateLineup(loaded.roster, loaded.lineup).valid).toBe(true)
    expect(loaded.autoSubs).toBeUndefined()
    expect(loadGame()!.roster.map((player) => player.id)).toEqual(ids)
    loaded.lineup.formationId = 'invalid' as typeof loaded.lineup.formationId
    expect(saveGame(loaded)).toBe(true)
    const fixed = loadGame()!
    expect(fixed.roster.map((player) => player.id)).toEqual(ids)
    expect(validateLineup(fixed.roster, fixed.lineup).valid).toBe(true)
  })

  it('自动时间推进能完整结算 38 轮，且只记录玩家比赛', () => {
    const game = createInitialGame(16)
    const result = catchUpSeason(game, game.season.startedAt + ROUND_MS * 40)
    expect(result.advanced).toBe(38)
    expect(game.season.finished).toBe(true)
    expect(game.season.round).toBe(38)
    expect(game.season.fixtures.every((fixture) => fixture.played)).toBe(true)
    expect(game.matchHistory).toHaveLength(38)
    expect(game.season.table.every((row) => row.played === 38)).toBe(true)
    expect(game.season.champion).toBeTruthy()
  }, 30000)

  it('旧球星按空槽补招牌技能，不覆盖满槽技能，并保持进行中比赛', () => {
    const game = createInitialGame(66)
    const player = game.roster.find((item) => item.signatureSkill)!
    const other = game.freeStars[0]
    const originalSignature = player.signatureSkill!
    const otherSignature = other.signatureSkill!
    player.skills = []
    delete player.signatureSkill
    delete player.skillTiers
    delete other.signatureSkill
    other.skills = (['safe_pass', 'one_touch', 'box_hunter', 'through_ball', 'aerial'] as const).filter((skill) => skill !== otherSignature).slice(0, 4)
    const fullSkills = [...other.skills]
    game.training[player.id] = createTrainingSession(player, 3)
    expect(startLeague(game).ok).toBe(true)
    const match = structuredClone(game.activeMatch!.engineState)
    expect(upgradeLegacySignatures(game)).toBe(true)
    expect(player.skills).toContain(originalSignature)
    expect(player.skillTiers?.[originalSignature]).toBe('rainbow')
    expect(game.training[player.id].candidate.skills).toContain(originalSignature)
    expect(other.skills).toEqual(fullSkills)
    expect(other.signatureSkill).toBeUndefined()
    expect(game.activeMatch!.engineState).toEqual(match)
    expect(upgradeLegacySignatures(game)).toBe(false)
    expect(saveGame(game)).toBe(true)
    expect(loadGame()!.roster.find((item) => item.id === player.id)!.signatureSkill).toBe(originalSignature)
  })

  it('旧进行中培养保留个人上限，新培养快照在存取后保持', () => {
    const game = createInitialGame(68)
    const [first, second] = game.roster.filter(player => player.positions.GK === 0)
    const legacy = createTrainingSession(first, 1)
    delete legacy.scheduleVersion
    delete legacy.stadiumLevel
    delete legacy.facilityLevels
    legacy.candidate.ceilings.passing = 900
    legacy.candidate.attrs.passing = 899
    legacy.candidate.pa = 1
    game.training[first.id] = legacy
    game.training[second.id] = createTrainingSession(second, 2, 1, 3)
    saveGame(game)
    const loaded = loadGame()!
    expect(loaded.training[first.id].stadiumLevel).toBeUndefined()
    expect(loaded.training[first.id].facilityLevels).toBeUndefined()
    expect(planTraining(loaded.training[first.id], { kind: 'drill', attr: 'passing' }).gains.passing!).toBeCloseTo(1)
    expect(loaded.training[second.id].stadiumLevel).toBe(15)
  })

  it('本地旧存档立即持久化默认经济，避免已完成比赛的收入被跳过', () => {
    const game = createInitialGame(67)
    delete game.economy
    expect(saveGame(game)).toBe(true)
    const loaded = loadGame()!
    expect(loaded.economy?.lastIncomeRound).toBe(0)
    expect(JSON.parse(localStorage.getItem('fm-seven-a-side-save-v3')!).economy.balance).toBe(100000)
  })

  it('v2 迁移会把属性和历史训练日志一起换到新尺度', () => {
    const game = createInitialGame(17)
    const player = game.roster.find((item) => item.positions.GK === 0)!
    player.history = [{ action: 1, week: 1, kind: 'action', title: '旧记录', text: '', gains: { passing: 2, firstTouch: 5 } }]
    const session = createTrainingSession(player, 1)
    session.log.push({ action: 1, week: 1, kind: 'action', title: '旧训练', text: '', gains: { tackling: 1, composure: 5 } })
    game.training[player.id] = session
    const listed = game.roster.find(item => item.id !== player.id && item.positions.GK === 0)!
    const oldPassing = listed.attrs.passing
    expect(listPlayer(game, listed.id, playerMarketValue(listed)).ok).toBe(true)

    const downgradePlayer = (p: Player) => {
      const gk = p.positions.GK > 0
      const down = (attrs: Attributes) => Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, isMainAttr(key as keyof Attributes, gk) ? value / 15 : value * 5])) as Attributes
      p.attrs = down(p.attrs)
      p.ceilings = down(p.ceilings)
      p.baseAttrs = down(p.baseAttrs)
      p.pa /= 7.5
    }
    game.roster.forEach(downgradePlayer)
    game.aiTeams.forEach((team) => team.players.forEach(downgradePlayer))
    game.freeStars.forEach(downgradePlayer)
    game.market!.listings.forEach((item) => downgradePlayer(item.player))
    Object.values(game.training).forEach((item) => downgradePlayer(item.candidate))
    game.version = 2
    localStorage.setItem(LEGACY_SAVE_KEY, JSON.stringify(game))

    const loaded = loadGame()
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(GAME_VERSION)
    expect(loaded!.roster.find((item) => item.id === player.id)!.attrs.passing).toBeCloseTo(player.attrs.passing * 15, 1)
    expect(loaded!.roster.find((item) => item.id === player.id)!.history?.[0].gains?.passing).toBe(30)
    expect(loaded!.roster.find((item) => item.id === player.id)!.history?.[0].gains?.firstTouch).toBe(1)
    expect(loaded!.training[player.id].log.at(-1)?.gains?.tackling).toBe(15)
    expect(loaded!.training[player.id].log.at(-1)?.gains?.composure).toBe(1)
    expect(loaded!.market!.listings[0].player.attrs.passing).toBeCloseTo(oldPassing, 1)
    expect(cancelListing(loaded!, listed.id).ok).toBe(true)
  })
})
