import type { CommentaryEntry, MatchLogEntry } from '../types.ts'
import { hashString } from '../rng.ts'
import type { MatchPlayerState, MatchState } from './types.ts'
import { GOAL_Y, PITCH_LENGTH } from './team.ts'

const prefixes: Partial<Record<MatchLogEntry['type'], readonly string[]>> = {
  pass: ['', '', '再看这次传递：', '这一次的传球：'],
  dribble: ['', '带球行动：', '球在脚下，'],
  tackle: ['', '防守有了回应！'],
  contest: ['', '双方展开争夺！'],
  goal: ['球进了！', '进球！', '破门得分！'],
  save: ['', '门将作出回应！', '精彩扑救！'],
  block: ['', '防守球员挡住了！'],
  miss: ['', '可惜了！'],
  foul: ['', '裁判吹响了哨子！'],
}

function add(state: MatchState, entry: Omit<CommentaryEntry, 'seq' | 'score' | 'shootoutScore'>): void {
  const commentary = state.commentary ??= []
  commentary.push({
    ...entry,
    seq: commentary.length + 1,
    score: { ...state.score },
    ...(state.shootout ? { shootoutScore: { home: state.shootout.home, away: state.shootout.away } } : {}),
  })
}

/** Only describe possession already present before this engine step. */
export function commentPossession(state: MatchState, carrier: MatchPlayerState): void {
  const progress = carrier.side === 'home' ? carrier.x / PITCH_LENGTH : 1 - carrier.x / PITCH_LENGTH
  const zone = progress < 0.35 ? '后场' : progress < 0.65 ? '中场' : '前场'
  const left = carrier.side === 'home' ? carrier.y < GOAL_Y : carrier.y > GOAL_Y
  const flank = Math.abs(carrier.y - GOAL_Y) < 12 ? '中路' : left ? '左路' : '右路'
  const team = state.teams[carrier.side === 'home' ? 0 : 1]
  const options = [
    `${team.name}在${zone}控球，${carrier.name}拿球。`,
    `${carrier.name}在${zone}${flank}控制住球。`,
    `球在${carrier.name}脚下，目前位于${zone}${flank}。`,
  ]
  add(state, { clock: Math.floor(state.clock * 10) / 10, half: state.half, type: 'info', team: carrier.side, text: options[hashString(`${state.seed}:context:${state.step}`) % options.length] })
}

export function commentLog(state: MatchState, entry: MatchLogEntry): void {
  const options = prefixes[entry.type]
  const prefix = options ? options[hashString(`${state.seed}:commentary:${entry.seq}`) % options.length] : ''
  add(state, { clock: entry.clock, half: entry.half, type: entry.type, team: entry.team, text: `${prefix}${entry.text}` })
}

/** Older active saves have a complete log but no commentary snapshots. */
export function restoreCommentary(state: MatchState): void {
  if (state.commentary) return
  const score = { home: 0, away: 0 }
  let shootoutScore: { home: number; away: number } | undefined
  state.commentary = state.log.map((entry, index) => {
    if (entry.type === 'goal' && entry.team !== 'none') score[entry.team]++
    const shootout = entry.type === 'penalty' ? /点球大战\s*(\d+)\s*:\s*(\d+)/.exec(entry.text) : null
    if (shootout) shootoutScore = { home: Number(shootout[1]), away: Number(shootout[2]) }
    return { seq: index + 1, clock: entry.clock, half: entry.half, type: entry.type, team: entry.team, text: entry.text, score: { ...score }, ...(shootoutScore ? { shootoutScore: { ...shootoutScore } } : {}) }
  })
}
