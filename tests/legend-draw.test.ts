import { beforeAll, describe, expect, it } from 'vitest'
import { loadPveContent } from '../src/game/pve-content.ts'
beforeAll(loadPveContent)
import { createInitialGame } from '../src/game/state.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { buildMatchEngineForGame } from '../src/game/match/setup.ts'
import type { MatchContext } from '../src/game/types.ts'
import type { PesEngine } from '../src/game/pes/engine.ts'

describe('传奇挑战平局规则', () => {
  it('allowDraw 关闭点球，普通挑战仍由淘汰赛规则决定', () => {
    const game = createInitialGame(31)
    const ai = legendTeamById('milan-1988-89')!
    const base = {
      isLeague: false,
      mode: 'legend',
      opponentId: ai.id,
      opponentName: ai.name,
      seed: 1,
      homeAway: 'home',
      durationSeconds: 900,
    } as MatchContext
    const draw = buildMatchEngineForGame(game, { ...base, allowDraw: true }, ai) as PesEngine
    expect(draw.game.settlement.knockout).toBe(false)
    const normal = buildMatchEngineForGame(game, base, ai) as PesEngine
    expect(normal.game.settlement.knockout).toBe(true)
  })
})
