import fs from 'node:fs'
import { createInitialGame } from '../src/game/state.ts'
import { startTraining, runAutoTraining, confirmTraining, startCupMatch, restoreActiveEngine, finishMatch } from '../src/game/actions.ts'
import { playerTeamForCup, cupRandomTeams } from '../src/game/cup.ts'
import { enterCup, cupPlayerFixture } from '../src/game/cup-run.ts'
import { buildPeakTeam } from '../src/game/peak.ts'
import { legendTeamById } from '../src/game/legend.ts'
import { PesEngine } from '../src/game/pes/engine.ts'
import { teamInputFromAI } from '../src/game/match/setup.ts'
import { alignPveStrength, startingCa } from '../src/game/pve-strength.ts'
import { PVE_CONTENT_HASH, loadPveContent } from '../src/game/pve-content.ts'
import { splitSeed } from '../src/game/rng.ts'
import type { AITeam } from '../src/game/types.ts'
import type { CupId } from '../src/game/data/cup-config.ts'

const integer = (value: string | undefined, fallback: number, max: number) => Math.max(1, Math.min(max, Math.round(Number(value) || fallback)))
const matches = integer(process.env.PVE_MATCHES, 6, 1000)
const cups = integer(process.env.PVE_CUPS, 2, 200)
const stages = (process.env.PVE_STAGES ?? '1,20,40,60,80,90,100').split(',').map(Number)
const cas = (process.env.PVE_CAS ?? '800,1000,1200,1400,1500').split(',').map(Number)
const groups = new Set((process.env.PVE_GROUPS ?? 'peak,legend,cup').split(','))
await loadPveContent()
const baseGame = createInitialGame(20261110)
// 先真实执行玩家自动培养一轮，保留项目/事件/卡片属性形状；未来 CA 档位只用于 P7 假设，不修改玩家成长系统。
for (const player of baseGame.roster) {
  if (!startTraining(baseGame, player.id, splitSeed(20261110, `training-${player.id}`)).ok) throw new Error('无法开始基线培养')
  const result = runAutoTraining(baseGame, player.id, 200)
  if (!result.completed || !confirmTraining(baseGame, player.id).ok) throw new Error(`基线培养未完成：${player.name}`)
}
const trained = playerTeamForCup(baseGame)
const players = new Map(cas.map((ca) => [ca, alignPveStrength(trained, ca)]))

function interval(wins: number, n: number) {
  const z = 1.96, p = wins / n, divisor = 1 + z * z / n
  const mid = (p + z * z / (2 * n)) / divisor
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / divisor
  return [Math.max(0, mid - half), Math.min(1, mid + half)].map((v) => +(v * 100).toFixed(1))
}

async function matchup(label: string, player: AITeam, opponent: AITeam) {
  let won = 0, draw = 0, penalties = 0
  for (let i = 0; i < matches; i++) {
    const swap = i % 2 === 1
    const h = swap ? opponent : player, a = swap ? player : opponent
    const state = new PesEngine({ seed: splitSeed(8122026, `${label}-${startingCa(player).toFixed(0)}-${i}`), home: teamInputFromAI(h), away: teamInputFromAI(a), knockout: true, offside: true }).simulate()
    const us = swap ? 'away' : 'home', them = swap ? 'home' : 'away'
    if (state.score[us] === state.score[them]) draw++
    if (state.shootout) penalties++
    if (state.shootout ? state.shootout[us] > state.shootout[them] : state.score[us] > state.score[them]) won++
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return { opponent: label, playerCa: +startingCa(player).toFixed(1), opponentCa: +startingCa(opponent).toFixed(1), matches, regulationDraws: draw, penalties, advanced: won, advancePct: +(100 * won / matches).toFixed(1), ci95: interval(won, matches) }
}

const rows = []
if (groups.has('peak')) for (const stage of stages) for (const ca of cas) rows.push(await matchup(`巅峰 ${stage}`, players.get(ca)!, buildPeakTeam(stage)))
if (groups.has('legend')) for (const id of ['barcelona-2010-11', 'milan-1988-89', 'nottingham-forest-1979-80']) for (const ca of cas) rows.push(await matchup(`传奇 ${id}`, players.get(ca)!, legendTeamById(id)!))
if (groups.has('cup')) for (const cup of ['community', 'league', 'champions'] as const) for (const ca of cas) rows.push(await matchup(`杯赛池 ${cup}`, players.get(ca)!, cupRandomTeams(cup, 1)[0].team))

const tournaments = []
if (groups.has('tournament')) for (const cup of ['community', 'league', 'champions'] as CupId[]) for (const ca of cas) {
  let qualified = 0, champions = 0
  for (let trial = 0; trial < cups; trial++) {
    const game = structuredClone(baseGame), player = players.get(ca)!
    game.roster = structuredClone(player.players); game.lineup = structuredClone(player.lineup)
    game.seed = splitSeed(8122026, `cup-trial-${trial}`)
    game.pve = { legends: {}, peak: { cleared: 0, history: [] }, cups: {}, trophies: [] }
    if (!enterCup(game, cup).ok) throw new Error('杯赛基线报名失败')
    const run = game.pve.cups[cup]
    for (let i = 0; run.status === 'active' && i < 10; i++) {
      if (!cupPlayerFixture(run) || !startCupMatch(game, cup).ok) throw new Error(`杯赛卡住：${cup}/${run.stage}`)
      const engine = restoreActiveEngine(game)!
      engine.simulate(); finishMatch(game, engine)
    }
    if (run.status === 'active') throw new Error('杯赛超过预期场次仍未结束')
    if (run.qualifiers?.includes('player')) qualified++
    if (run.status === 'champion') champions++
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  tournaments.push({ cup, playerCa: ca, samples: cups, qualified, champions, qualificationPct: +(100 * qualified / cups).toFixed(1), championshipPct: +(100 * champions / cups).toFixed(1) })
}
const report = {
  contentHash: PVE_CONTENT_HASH, engine: 'PesEngine / rulesVersion 4',
  baseline: '玩家完整自动培养一轮；未来 CA 档位为同形状归一化假设，不是声称玩家当前可培养到该数值。',
  actualTrainingCa: +startingCa(trained).toFixed(1),
  knockout: '真实点球，不用平局×0.5；整届杯赛 AI 后台用 v2、玩家用 v4，与实际玩法一致。',
  caution: '小样本仅用于发现异常，95% 置信区间较宽；不据此擅改 350→1300 曲线。',
  rows, tournaments,
}
console.log(JSON.stringify(report, null, 2))
if (process.env.PVE_REPORT) fs.writeFileSync(process.env.PVE_REPORT, JSON.stringify(report, null, 2) + '\n')
