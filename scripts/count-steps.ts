import { MatchEngine } from '../src/game/match/engine.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { createWorldGame } from '../src/game/world.ts'
import { matchRealSeconds } from '../src/game/match/time.ts'

const games = Number(process.argv[2] ?? 20)
const counts: number[] = []
let gaps = 0
let maxGap = 0
let shots = 0
let goals = 0
for (let index = 0; index < games; index++) {
  const game = createWorldGame(2024 + index)
  const opponent = game.aiTeams[0]
  const engine = new MatchEngine({
    seed: 2024 + index,
    home: teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#fff', accent: '#000' }),
    away: teamInputFromLineup(opponent.players, opponent.lineup, opponent),
    knockout: false,
  })
  while (!engine.state.finished) {
    const before = engine.state.clock
    engine.step()
    const seconds = matchRealSeconds(engine.state.clock - before, engine.state.durationSeconds)
    gaps += seconds
    maxGap = Math.max(maxGap, seconds)
  }
  counts.push(engine.state.step)
  shots += engine.state.stats.home.shots + engine.state.stats.away.shots
  goals += engine.state.score.home + engine.state.score.away
  console.log(`seed=${2024 + index} steps=${engine.state.step} score=${engine.state.score.home}-${engine.state.score.away}`)
}
const steps = counts.reduce((sum, value) => sum + value, 0)
console.log(JSON.stringify({ games, meanSteps: steps / games, minSteps: Math.min(...counts), maxSteps: Math.max(...counts), realSecondsPerStep: gaps / steps, maxRealSecondsPerStep: maxGap, shots: shots / games, goals: goals / games }, null, 2))
