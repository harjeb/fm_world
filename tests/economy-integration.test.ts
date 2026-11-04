import { describe, expect, it } from 'vitest'
import { createInitialGame } from '../src/game/state.ts'
import { economyOf, LEAGUE_WIN_BONUS } from '../src/game/economy.ts'
import { catchUpSeason, playerFixture, ROUND_MS } from '../src/game/season.ts'
import { advanceLeagueRealtime } from '../src/game/realtime.ts'
import { restoreActiveEngine, simulateSeasonRound, startLeague, startSingleChallenge, finishMatch } from '../src/game/actions.ts'
import { recordMatchInjuries } from '../src/game/injury.ts'
import type { MatchState } from '../src/game/match/types.ts'

describe('economy integration', () => {
  it('initializes new and legacy saves without retroactive income', () => {
    const game = createInitialGame(42)
    expect(economyOf(game).lastIncomeRound).toBe(0)
    for (const fixture of game.season.fixtures.filter(f => f.round <= 2)) fixture.played = true
    delete (game as typeof game & { economy?: unknown }).economy
    expect(economyOf(game)).toMatchObject({ balance: 100000, lastIncomeRound: 2 })
  })

  it('pays each completed round once during batched catchup', () => {
    const game = createInitialGame(43)
    const now = game.season.startedAt + 3 * ROUND_MS
    expect(catchUpSeason(game, now).advanced).toBe(3)
    const wins = game.season.fixtures.filter(f => f.round <= 3 && f.played && f.isPlayer &&
      f.score && ((f.homeId === 'player' && f.awayId !== 'player' && f.score.home > f.score.away) ||
        (f.awayId === 'player' && f.homeId !== 'player' && f.score.away > f.score.home))).length
    const balance = 166000 + wins * LEAGUE_WIN_BONUS
    expect(economyOf(game)).toMatchObject({ balance, lastIncomeRound: 3 })
    expect(catchUpSeason(game, now).advanced).toBe(0)
    expect(economyOf(game).balance).toBe(balance)
  })

  it('pays once when a completed player fixture is followed by manual round settlement', () => {
    const game = createInitialGame(46)
    const fixture = playerFixture(game)!
    fixture.played = true
    fixture.score = fixture.homeId === 'player' ? { home: 1, away: 0 } : { home: 0, away: 1 }
    expect(simulateSeasonRound(game).ok).toBe(true)
    expect(economyOf(game)).toMatchObject({ balance: 132000, lastIncomeRound: 1 })
    expect(simulateSeasonRound(game).ok).toBe(false)
    expect(economyOf(game).balance).toBe(132000)
  })

  it('settles a live league result once and does not reward a friendly', () => {
    const game = createInitialGame(47)
    const start = game.season.startedAt
    expect(startLeague(game, start).ok).toBe(true)
    advanceLeagueRealtime(game, start + 600_000)
    const fixture = game.season.fixtures.find(f => f.round === 1 && f.isPlayer)!
    const won = fixture.homeId === 'player' ? fixture.score!.home > fixture.score!.away : fixture.score!.away > fixture.score!.home
    const balance = 122000 + (won ? LEAGUE_WIN_BONUS : 0)
    expect(economyOf(game)).toMatchObject({ balance, lastIncomeRound: 1 })
    advanceLeagueRealtime(game, start + 1_200_000)
    expect(economyOf(game).balance).toBe(balance)
    expect(startSingleChallenge(game, game.aiTeams[0].id, start + 1_200_000).ok).toBe(true)
    const engine = restoreActiveEngine(game)!
    engine.simulate()
    expect(finishMatch(game, engine, start + 1_200_000)).not.toBeNull()
    expect(economyOf(game).balance).toBe(balance)
  })

  it('reduces only player injuries and freezes the result after synchronization', () => {
    const game = createInitialGame(44)
    economyOf(game).medical = 5
    const state = {
      teams: [{ side: 'home', id: 'player' }, { side: 'away', id: 'ai' }],
      log: [
        { type: 'injury', team: 'home', clock: 0, injury: { personId: 'one', recoveryDays: 10 } },
        { type: 'injury', team: 'away', clock: 0, injury: { personId: 'two', recoveryDays: 10 } },
      ],
    } as unknown as MatchState
    recordMatchInjuries(game, state, 100, false)
    expect(state.log[0].injury?.recoveryDays).toBe(7)
    expect(state.log[1].injury?.recoveryDays).toBe(10)
    const until = game.injuries!['one']
    economyOf(game).medical = 1
    recordMatchInjuries(game, state, 200, false)
    expect(game.injuries!['one']).toBe(until)
  })

  it('falls back safely if a legacy medical level is malformed', () => {
    const game = createInitialGame(45)
    economyOf(game).medical = NaN
    const state = { teams: [{ side: 'home', id: 'player' }], log: [
      { type: 'injury', team: 'home', clock: 0, injury: { personId: 'one', recoveryDays: 10 } },
    ] } as unknown as MatchState
    recordMatchInjuries(game, state, 100, false)
    expect(state.log[0].injury?.recoveryDays).toBe(10)
    expect(game.injuries!['one']).toBe(100 + game.season.gameDayMs * 10)
  })
})
