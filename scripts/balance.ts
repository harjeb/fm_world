import { createInitialGame } from '../src/game/state.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { simulateAIvsAIState } from '../src/game/match/setup.ts'
import { caOf } from '../src/game/ca.ts'
import { catchUpSeason } from '../src/game/season.ts'
import { postseasonStartAt } from '../src/game/calendar.ts'
import { autoTrainingStep, startTraining, trainingAction } from '../src/game/actions.ts'
import { trainingOptions } from '../src/game/training-calendar.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS } from '../src/game/scale.ts'
import type { AITeam } from '../src/game/types.ts'

declare const process: { env: Record<string, string | undefined> }

const game = createInitialGame(20260418)
const teams = game.aiTeams
let goals = 0
let homeWins = 0
let draws = 0
let shots = 0
let matches = 0
for (let i = 0; i < teams.length; i++) {
  for (let j = i + 1; j < teams.length; j++) {
    for (let leg = 0; leg < 2; leg++) {
      const home = leg === 0 ? teams[i] : teams[j]
      const away = leg === 0 ? teams[j] : teams[i]
      const state = simulateAIvsAIState(home, away, 1000 + i * 100 + j * 2 + leg, LOGIC_MATCH_SECONDS)
      goals += state.score.home + state.score.away
      shots += state.stats.home.shots + state.stats.away.shots
      if (state.score.home > state.score.away) homeWins++
      else if (state.score.home === state.score.away) draws++
      matches++
    }
  }
}
function scaledTeam(team: AITeam, target: number): AITeam {
  const clone = structuredClone(team)
  for (const player of clone.players) {
    const keys = player.positions.GK > 0 ? MAIN_GK_ATTRS : MAIN_FIELD_ATTRS
    const current = keys.map((key) => player.attrs[key] / 15)
    const average = current.reduce((sum, value) => sum + value, 0) / current.length
    for (const key of keys) {
      const rating = Math.max(10, Math.min(99, target + (player.attrs[key] / 15 - average) * 0.35))
      player.attrs[key] = rating * 15
    }
  }
  return clone
}

const matrixMatches = Math.max(20, Math.min(1000, Number(process.env.MATRIX_MATCHES ?? 240)))
const weakA = scaledTeam(teams[0], 45)
const weakB = scaledTeam(teams[1], 45)
const strongA = scaledTeam(teams[0], 70)
const strongB = scaledTeam(teams[1], 70)
function matrixGroup(home: AITeam, away: AITeam, count: number, swap = false) {
  let goals = 0, shots = 0, draws = 0, wins = 0
  for (let index = 0; index < count; index++) {
    const h = swap && index % 2 === 1 ? away : home
    const a = swap && index % 2 === 1 ? home : away
    const state = simulateAIvsAIState(h, a, 50_000 + index, LOGIC_MATCH_SECONDS)
    goals += state.score.home + state.score.away
    shots += state.stats.home.shots + state.stats.away.shots
    if (state.score.home === state.score.away) draws++
    if (state.score.home > state.score.away) wins++
  }
  return { matches: count, goals: Number((goals / count).toFixed(2)), shots: Number((shots / count).toFixed(2)), draws: Number((draws / count * 100).toFixed(1)), homeWins: Number((wins / count * 100).toFixed(1)) }
}
const matrix = {
  weakWeak: matrixGroup(weakA, weakB, matrixMatches, true),
  strongStrong: matrixGroup(strongA, strongB, matrixMatches, true),
  mixed: matrixGroup(strongA, weakB, matrixMatches, true),
}
const cas = teams.flatMap((team) => team.players).map((player) => caOf(player.attrs, player.positions.GK > 0))
const p = game.roster.find((player) => player.positions.GK === 0)!
if (!startTraining(game, p.id, 99).ok) throw new Error('无法开始培养')
const session = game.training[p.id]
const startCa = caOf(session.candidate.attrs, false)
while (!session.completed) {
  if (session.pendingEventId) {
    const result = autoTrainingStep(game, p.id)
    if (!result.ok) throw new Error(result.error)
    continue
  }
  const options = trainingOptions(session)
  const activity = options.find(item => item.id === (session.fatigue > 70 ? 'rest' : 'passing')) ?? options.find(item => item.gains) ?? options[0]
  const result = trainingAction(game, p.id, { kind: 'activity', activityId: activity.id })
  if (!result.ok) throw new Error(result.error)
}
const trainGain = caOf(session.candidate.attrs, false) - startCa

const longGame = createInitialGame(20260418)
const advance = catchUpSeason(longGame, postseasonStartAt(longGame.season.startedAt))
console.log(JSON.stringify({
  matches,
  avgGoals: Number((goals / matches).toFixed(2)),
  avgShots: Number((shots / matches).toFixed(2)),
  homeWinPct: Number(((homeWins / matches) * 100).toFixed(1)),
  drawPct: Number(((draws / matches) * 100).toFixed(1)),
  ca: {
    min: Number(Math.min(...cas).toFixed(1)),
    max: Number(Math.max(...cas).toFixed(1)),
    avg: Number((cas.reduce((a, b) => a + b, 0) / cas.length).toFixed(1)),
  },
  training: {
    startCa: Number(startCa.toFixed(1)),
    endCa: Number(caOf(session.candidate.attrs, false).toFixed(1)),
    gain: Number(trainGain.toFixed(1)),
    action: session.action,
    completed: session.completed,
    energy: p.energy,
  },
  matrix,
  longSeasonAuto: {
    advanced: advance.advanced,
    round: longGame.season.round,
    finished: longGame.season.finished,
    matches: longGame.season.fixtures.filter((fixture) => fixture.played).length,
    playerMatches: longGame.matchHistory.length,
    condition: [Math.min(...longGame.roster.map((player) => player.condition)), Math.max(...longGame.roster.map((player) => player.condition))],
    energy: [Math.min(...longGame.roster.map((player) => player.energy)), Math.max(...longGame.roster.map((player) => player.energy))],
  },
}, null, 2))
