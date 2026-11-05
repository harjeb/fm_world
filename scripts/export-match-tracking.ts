import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { MatchEngine } from '../src/game/match/engine.ts'
import { planMatchReplay } from '../src/game/match/replay.ts'
import { teamInputFromLineup } from '../src/game/match/setup.ts'
import { matchTrackingRows, TRACKING_COLUMNS, TRACKING_FPS, trackingCsvRow } from '../src/game/match/tracking.ts'
import { createWorldGame } from '../src/game/world.ts'

const { values } = parseArgs({ options: {
  seed: { type: 'string', default: '2024' },
  from: { type: 'string', default: '0' },
  to: { type: 'string', default: '20' },
  out: { type: 'string', default: 'artifacts/match-tracking.csv' },
} })
const seed = Number(values.seed)
const from = Number(values.from)
const to = Number(values.to)
if (!Number.isFinite(seed) || !(from >= 0 && to > from && to <= 600)) throw new Error('Use --seed <number> --from 0 --to 20 (0 <= from < to <= 600)')
const game = createWorldGame(seed)
const opponent = game.aiTeams[0]
const engine = new MatchEngine({
  seed,
  home: teamInputFromLineup(game.roster, game.lineup, { id: 'player', name: game.clubName, color: '#fff', accent: '#000' }),
  away: teamInputFromLineup(opponent.players, opponent.lineup, opponent),
  knockout: false,
  offside: game.settings?.offside,
})
const plan = planMatchReplay(engine)
const roster = engine.state.teams.flatMap((team) => [...team.players, ...team.bench])
const out = path.resolve(values.out!)
fs.mkdirSync(path.dirname(out), { recursive: true })
const fd = fs.openSync(out, 'w')
let rows = 0
try {
  fs.writeSync(fd, TRACKING_COLUMNS.join(',') + '\n')
  let batch: string[] = []
  for (const row of matchTrackingRows(plan.frames, roster, engine.state.durationSeconds, { fromSeconds: from, toSeconds: to })) {
    batch.push(trackingCsvRow(row))
    rows++
    if (batch.length >= 4096) {
      fs.writeSync(fd, batch.join('\n') + '\n')
      batch = []
    }
  }
  if (batch.length) fs.writeSync(fd, batch.join('\n') + '\n')
} finally { fs.closeSync(fd) }
const metadata = {
  seed, score: plan.score, actions: plan.frames.length, fps: TRACKING_FPS,
  from, to, rows, pitch: { length: 105, width: 68 },
  format: 'soccerAnimate tidy_data (provider=Metrica)',
  coordinates: 'Synthesized from FM world events, not measured tracking data. Same choreography as browser playback.',
}
fs.writeFileSync(out + '.json', JSON.stringify(metadata, null, 2) + '\n')
console.log(JSON.stringify({ out, ...metadata }, null, 2))
