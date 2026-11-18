import { createWorldGame } from '../src/game/world.ts'
import { DAY_MS } from '../src/game/calendar.ts'
import { ensureYouth, settleYouth, youthCA, type YouthTier } from '../src/game/youth.ts'
import type { GameState } from '../src/game/types.ts'

const now = Date.UTC(2026, 10, 18, 2)
const base = createWorldGame(7101, undefined, '青训平衡', now)
base.season.fixtures.forEach(f => { f.played = true })
const totals: Record<string, { n: number; start: number; final: number; progress: number; capped: number; max: number }> = {}
for (let seed = 1; seed <= Number(process.argv[2] ?? 200); seed++) {
  for (const scenario of ['basic', 'developed'] as const) {
    const game: GameState = { ...base, seed, roster: [], training: {}, candidates: {}, matchHistory: [], challengeHistory: [], youth: undefined, economy: { ...base.economy!, academy: scenario === 'basic' ? 1 : 25 } }
    ensureYouth(game, now)
    const youth = game.youth!
    // Development scenario: a good official appearance every 24h, capped at 90 min.
    if (scenario === 'developed') for (const member of youth.members) {
      for (let day = 0; now + day * DAY_MS < member.endsAt; day++) youth.matches.push({ id: `sim-${day}`, at: now + day * DAY_MS + 1, playerId: member.player.id, minutes: 90, bonus: 0.4 })
    }
    settleYouth(game, now + 40 * DAY_MS)
    for (const member of youth.members) {
      const key = `${scenario}/${member.tier as YouthTier}/${member.initialAge <= 15 ? '14-15' : member.initialAge <= 17 ? '16-17' : '18'}`
      const result = totals[key] ??= { n: 0, start: 0, final: 0, progress: 0, capped: 0, max: 0 }
      const ca = youthCA(member.player)
      result.n++; result.start += member.initialCa; result.final += ca
      result.progress += (ca - member.initialCa) / (member.ceiling - member.initialCa)
      result.capped += ca >= member.ceiling - 0.01 ? 1 : 0
      result.max = Math.max(result.max, ca)
    }
  }
}
console.table(Object.fromEntries(Object.entries(totals).sort().map(([key, s]) => [key, { count: s.n, initial: (s.start / s.n).toFixed(1), final: (s.final / s.n).toFixed(1), max: s.max.toFixed(1), progress: `${(100 * s.progress / s.n).toFixed(1)}%`, capped: `${(100 * s.capped / s.n).toFixed(1)}%` }])))
