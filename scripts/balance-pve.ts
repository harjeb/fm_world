import { generateTeam, generatedTeamSpec } from '../src/game/generated-team.ts'
import { buildHistoricTeam, legendTeamById } from '../src/game/legend.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { CUP_TEAM_POOLS } from '../src/game/data/cup-teams.generated.ts'
import { simulateAIvsAIState } from '../src/game/match/setup.ts'
import { LOGIC_MATCH_SECONDS } from '../src/game/match/time.ts'
import { caOf } from '../src/game/ca.ts'
import type { AITeam } from '../src/game/types.ts'

declare const process: { env: Record<string, string | undefined> }

const MATCHES = Math.max(4, Math.min(60, Number(process.env.PVE_MATCHES ?? 12)))
const PLAYER_CAS = (process.env.PVE_CAS ?? '400,600,800,1000,1200').split(',').map(Number).filter(Number.isFinite)
const GROUPS = new Set((process.env.PVE_GROUPS ?? 'peak,legend,cup').split(','))
const PEAK_STAGES = (process.env.PVE_STAGES ?? '1,10,20,30,40,50,60,70,80,90,100').split(',').map(Number).filter(Number.isFinite)
const LEGEND_IDS = ['barcelona-2010-11', 'milan-1988-89', 'real-madrid-2016-17', 'ajax-1971-72', 'juventus-1995-96', 'sampdoria-1990-91', 'nottingham-forest-1979-80']

function teamCa(team: AITeam): number {
  const sorted = [...team.players].sort((a, b) => caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0))
  return sorted.slice(0, 11).reduce((sum, player) => sum + caOf(player.attrs, player.positions.GK > 0), 0) / Math.min(11, sorted.length || 1)
}

function playerTeam(targetCa: number, seed: number): AITeam {
  const spec = generatedTeamSpec(seed, targetCa, `balance-player-${targetCa}`, Math.round(targetCa))
  // 平衡基线用中性阵型/战术，避免随机战术把 CA 对比搅乱。
  spec.formationId = '4-3-3'
  spec.tactics = { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' }
  const { def } = generateTeam(spec)
  const team = buildHistoricTeam({ ...def, id: `balance-player-${targetCa}` })
  return { ...team, id: 'player', name: '测试玩家' }
}

function simulate(home: AITeam, away: AITeam, count: number, seed: number): { win: number; draw: number; loss: number; playerCa: number; opponentCa: number } {
  let win = 0
  let draw = 0
  let loss = 0
  for (let index = 0; index < count; index++) {
    const swap = index % 2 === 1
    const h = swap ? away : home
    const a = swap ? home : away
    const state = simulateAIvsAIState(h, a, seed + index, LOGIC_MATCH_SECONDS)
    const playerGoals = swap ? state.score.away : state.score.home
    const opponentGoals = swap ? state.score.home : state.score.away
    if (playerGoals > opponentGoals) win += 1
    else if (playerGoals === opponentGoals) draw += 1
    else loss += 1
  }
  return { win, draw, loss, playerCa: teamCa(home), opponentCa: teamCa(away) }
}

const players = new Map<number, AITeam>()
for (const ca of PLAYER_CAS) players.set(ca, playerTeam(ca, 0xba1a5e))

const rows: { group: string; name: string; playerCa: number; opponentCa: number; win: number; draw: number; loss: number; advance: number }[] = []
if (GROUPS.has('peak')) for (const stage of PEAK_STAGES) {
  const opponent = buildPeakTeam(stage)
  for (const ca of PLAYER_CAS) {
    const result = simulate(players.get(ca)!, opponent, MATCHES, 10_000 + stage * 100 + ca)
    rows.push({ group: 'peak', name: `第 ${stage} 关`, playerCa: result.playerCa, opponentCa: result.opponentCa, win: result.win, draw: result.draw, loss: result.loss, advance: result.win + result.draw * 0.5 })
  }
}
if (GROUPS.has('legend')) for (const id of LEGEND_IDS) {
  const opponent = legendTeamById(id)!
  for (const ca of PLAYER_CAS) {
    const result = simulate(players.get(ca)!, opponent, MATCHES, 20_000 + ca + id.length)
    rows.push({ group: 'legend', name: opponent.name, playerCa: result.playerCa, opponentCa: result.opponentCa, win: result.win, draw: result.draw, loss: result.loss, advance: result.win + result.draw * 0.5 })
  }
}
if (GROUPS.has('cup')) for (const [poolId, def] of [['casual', CUP_TEAM_POOLS.casual[0]], ['league', CUP_TEAM_POOLS.league[0]], ['champions', CUP_TEAM_POOLS.champions[0]]] as const) {
  const opponent = buildHistoricTeam(def)
  for (const ca of PLAYER_CAS) {
    const result = simulate(players.get(ca)!, opponent, MATCHES, 30_000 + ca + poolId.length)
    rows.push({ group: 'cup', name: `杯赛随机 · ${poolId}`, playerCa: result.playerCa, opponentCa: result.opponentCa, win: result.win, draw: result.draw, loss: result.loss, advance: result.win + result.draw * 0.5 })
  }
}

console.log(`PvE 平衡：每组 ${MATCHES} 场，玩家 CA -> 胜/平/负（晋级率 = 胜 + 平×0.5）`)
for (const row of rows) {
  const pct = (value: number) => `${Math.round((value / MATCHES) * 100)}%`
  console.log(`${row.group.padEnd(6, ' ')} ${row.name.padEnd(24, ' ')} 玩家 ${Math.round(row.playerCa)} vs ${Math.round(row.opponentCa)}  ${pct(row.win)} / ${pct(row.draw)} / ${pct(row.loss)}  晋级 ${pct(row.advance)}`)
}
