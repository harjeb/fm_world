import type { AITeam, AITeamDef, FormationId, Player, Position, Tactics } from '../types.ts'
import { PLAYER_SEEDS, createPlayerFromSeed } from './players.ts'
import { createRandomPlayer, randomSquadPositionTemplate } from './random-players.ts'
import { autoFillLineup, validateLineup } from '../squad.ts'
import { caOf } from '../ca.ts'
import { derivedRng } from '../rng.ts'

/**
 * 20 支同级联赛球队。每队 1-3 名真实球星，其余位置由随机球员补足。
 * 球队强弱由真实球星数量/质量与随机球员档次共同决定。
 */
export const AI_TEAM_DEFS: AITeamDef[] = [
  { id: 'ai_01', name: '皇家马德里', short: '皇马', color: '#34d399', accent: '#052e1b', style: '高位压迫与边路速度，阵容深度最好。', formationId: '4-3-3', tactics: { attack: 'wing', passing: 'mixed', tempo: 'fast', line: 'high', press: 'high' }, strength: 5, playerNames: [] },
  { id: 'ai_02', name: '曼城', short: '曼城', color: '#ef4444', accent: '#fff7ed', style: '强硬对抗、低位防守和快速反击。', formationId: '3-5-2', tactics: { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'low', press: 'high' }, strength: 5, playerNames: [] },
  { id: 'ai_03', name: '拜仁慕尼黑', short: '拜仁', color: '#3b82f6', accent: '#eff6ff', style: '短传控球，靠中场轮转制造空位。', formationId: '4-3-3', tactics: { attack: 'middle', passing: 'short', tempo: 'slow', line: 'high', press: 'mid' }, strength: 5, playerNames: [] },
  { id: 'ai_04', name: '利物浦', short: '利物', color: '#f8fafc', accent: '#111827', style: '纵向直传与前场个人能力。', formationId: '4-4-2', tactics: { attack: 'balanced', passing: 'direct', tempo: 'fast', line: 'mid', press: 'mid' }, strength: 4, playerNames: [] },
  { id: 'ai_05', name: '巴黎圣日耳曼', short: '巴黎', color: '#eab308', accent: '#1c1917', style: '边路传中与禁区抢点。', formationId: '4-3-3', tactics: { attack: 'wing', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'low' }, strength: 4, playerNames: [] },
  { id: 'ai_06', name: '巴塞罗那', short: '巴萨', color: '#8b5cf6', accent: '#f5f3ff', style: '中场绞杀与二次进攻。', formationId: '3-5-2', tactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'high' }, strength: 4, playerNames: [] },
  { id: 'ai_07', name: '国际米兰', short: '国米', color: '#f97316', accent: '#fff7ed', style: '稳守反击，定位球是主要武器。', formationId: '3-5-2', tactics: { attack: 'balanced', passing: 'direct', tempo: 'slow', line: 'low', press: 'mid' }, strength: 3, playerNames: [] },
  { id: 'ai_08', name: '阿森纳', short: '阿森', color: '#22c55e', accent: '#052e16', style: '年轻、跑动多，但终结不稳定。', formationId: '4-4-2', tactics: { attack: 'wing', passing: 'mixed', tempo: 'fast', line: 'mid', press: 'high' }, strength: 3, playerNames: [] },
  { id: 'ai_09', name: '弗拉门戈', short: '弗拉', color: '#06b6d4', accent: '#083344', style: '控球但不冒进，擅长消耗对手。', formationId: '4-3-3', tactics: { attack: 'middle', passing: 'short', tempo: 'slow', line: 'mid', press: 'mid' }, strength: 3, playerNames: [] },
  { id: 'ai_10', name: '利雅得新月', short: '新月', color: '#a3e635', accent: '#1a2e05', style: '中场人数优势与局部配合。', formationId: '4-4-2', tactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'mid' }, strength: 3, playerNames: [] },
  { id: 'ai_11', name: '切尔西', short: '切尔', color: '#64748b', accent: '#f8fafc', style: '直接、强硬、少犯错。', formationId: '3-5-2', tactics: { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'low', press: 'mid' }, strength: 3, playerNames: [] },
  { id: 'ai_12', name: '尤文图斯', short: '尤文', color: '#dc2626', accent: '#fef2f2', style: '前场逼抢与快速转换。', formationId: '4-4-2', tactics: { attack: 'wing', passing: 'direct', tempo: 'fast', line: 'high', press: 'high' }, strength: 3, playerNames: [] },
  { id: 'ai_13', name: '多特蒙德', short: '多特', color: '#94a3b8', accent: '#0f172a', style: '阵型紧凑，靠经验控制比赛。', formationId: '3-5-2', tactics: { attack: 'middle', passing: 'mixed', tempo: 'slow', line: 'mid', press: 'low' }, strength: 2, playerNames: [] },
  { id: 'ai_14', name: '那不勒斯', short: '那不', color: '#fbbf24', accent: '#451a03', style: '边路冲击，但防线容易被打身后。', formationId: '4-3-3', tactics: { attack: 'wing', passing: 'direct', tempo: 'fast', line: 'high', press: 'mid' }, strength: 2, playerNames: [] },
  { id: 'ai_15', name: '博卡青年', short: '博卡', color: '#60a5fa', accent: '#172554', style: '短传推进，缺少稳定得分点。', formationId: '4-3-3', tactics: { attack: 'middle', passing: 'short', tempo: 'normal', line: 'mid', press: 'mid' }, strength: 2, playerNames: [] },
  { id: 'ai_16', name: '河床', short: '河床', color: '#78716c', accent: '#fafaf9', style: '低位防守与长传反击。', formationId: '3-5-2', tactics: { attack: 'balanced', passing: 'direct', tempo: 'slow', line: 'low', press: 'low' }, strength: 2, playerNames: [] },
  { id: 'ai_17', name: '帕尔梅拉斯', short: '帕尔', color: '#fb7185', accent: '#fff1f2', style: '年轻阵容，攻守转换快但失误多。', formationId: '4-4-2', tactics: { attack: 'wing', passing: 'mixed', tempo: 'fast', line: 'mid', press: 'high' }, strength: 2, playerNames: [] },
  { id: 'ai_18', name: '利雅得胜利', short: '胜利', color: '#c084fc', accent: '#2e1065', style: '防守站位优先，进攻靠零星机会。', formationId: '3-5-2', tactics: { attack: 'middle', passing: 'mixed', tempo: 'slow', line: 'low', press: 'low' }, strength: 1, playerNames: [] },
  { id: 'ai_19', name: '蔚山现代', short: '蔚山', color: '#2dd4bf', accent: '#042f2e', style: '阵容最薄，靠拼抢和主场气氛。', formationId: '4-3-3', tactics: { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'low', press: 'mid' }, strength: 1, playerNames: [] },
  { id: 'ai_20', name: '上海海港', short: '海港', color: '#fde047', accent: '#422006', style: '升班马，经验不足但敢压上。', formationId: '4-4-2', tactics: { attack: 'wing', passing: 'mixed', tempo: 'fast', line: 'mid', press: 'mid' }, strength: 1, playerNames: [] },
]

/** 玩家默认执教的球队索引。选一支中游队，留出成长空间。 */
export const PLAYER_TEAM_INDEX = 9

const POSITION_ORDER: Position[] = ['GK', 'CB', 'W', 'CM', 'ST']

export type LeagueSetup = {
  playerTeam: AITeam
  aiTeams: AITeam[]
  allStars: Player[]
  freeStars: Player[]
  playerDef: AITeamDef
}

function tacticsOf(team: AITeamDef): Tactics {
  return { ...team.tactics }
}

function formationOf(team: AITeamDef): FormationId {
  return team.formationId
}

function randomTierFor(strength: number): number {
  return strength >= 5 ? 4 : strength >= 3 ? 3 : 2
}

function starCountFor(index: number): number {
  if (index < 5) return 3
  if (index < 15) return 2
  return 1
}

function makeDefWithId(def: AITeamDef, id: string, name?: string): AITeamDef {
  return { ...def, id, name: name ?? def.name }
}

export function buildLeague(seed: number, clubName = '青训联队'): LeagueSetup {
  const rng = derivedRng(seed, 'league-setup')
  const allStars = PLAYER_SEEDS.map(createPlayerFromSeed)
  const available = [...allStars].sort((a, b) => {
    const tierA = PLAYER_SEEDS.find((s) => s.id === a.seedId)?.tier ?? 0
    const tierB = PLAYER_SEEDS.find((s) => s.id === b.seedId)?.tier ?? 0
    return tierB - tierA || caOf(b.attrs, b.positions.GK > 0) - caOf(a.attrs, a.positions.GK > 0)
  })
  const usedStars = new Set<string>()
  const starIdsByTeam = new Map<string, string[]>()
  const teams = AI_TEAM_DEFS.map((def, index) => ({ def, index, stars: [] as Player[] }))
  const teamOrder = [...teams].sort((a, b) => b.def.strength - a.def.strength || a.index - b.index)
  for (let slot = 0; slot < 3; slot++) {
    const candidates = (slot % 2 === 0 ? teamOrder : [...teamOrder].reverse()).filter((team) => team.stars.length < starCountFor(team.index))
    for (const team of candidates) {
      const hasGk = team.stars.some((star) => star.positions.GK > 0)
      const pick = available.find((star) => !usedStars.has(star.id) && (!hasGk || star.positions.GK === 0))
      if (!pick) break
      usedStars.add(pick.id)
      team.stars.push(pick)
      starIdsByTeam.set(team.def.id, [...(starIdsByTeam.get(team.def.id) ?? []), pick.id])
    }
  }

  const usedNames = new Set<string>([...usedStars].map((id) => allStars.find((p) => p.id === id)?.name ?? '').filter(Boolean))
  const squads = new Map<string, Player[]>()
  const builtStars = new Map<string, Player[]>()
  for (const team of teams) {
    const stars = team.stars
    const starsByPosition = new Map<Position, Player[]>()
    for (const star of stars) {
      const pos = POSITION_ORDER.find((p) => star.positions[p] >= 70) ?? (star.positions.GK > 0 ? 'GK' : 'CM')
      starsByPosition.set(pos, [...(starsByPosition.get(pos) ?? []), star])
    }
    const players: Player[] = []
    const template = randomSquadPositionTemplate()
    for (let slot = 0; slot < template.length; slot++) {
      const position = template[slot]
      const star = starsByPosition.get(position)?.shift()
      if (star) {
        players.push(star)
      } else {
        players.push(createRandomPlayer({
          seed: Math.floor(rng.float() * 0x7fffffff) + team.index * 1000 + slot,
          position,
          tier: randomTierFor(team.def.strength),
          usedNames,
          idPrefix: `r${team.index + 1}-${slot + 1}`,
        }))
      }
    }
    squads.set(team.def.id, players)
    builtStars.set(team.def.id, stars)
  }

  const playerDefBase = AI_TEAM_DEFS[PLAYER_TEAM_INDEX]
  const playerDef = makeDefWithId(playerDefBase, 'player', clubName)
  const playerPlayers = squads.get(playerDefBase.id) ?? []
  const playerStars = builtStars.get(playerDefBase.id) ?? []
  const playerTeam: AITeam = {
    ...playerDef,
    tactics: tacticsOf(playerDef),
    playerNames: playerStars.map((star) => star.name),
    lineup: autoFillLineup(playerPlayers, playerDef.formationId, tacticsOf(playerDef)),
    players: playerPlayers,
    starPlayerIds: playerStars.map((star) => star.id),
  }
  const playerCheck = validateLineup(playerPlayers, playerTeam.lineup)
  if (!playerCheck.valid) throw new Error(`玩家阵容不合法：${playerCheck.errors.join('；')}`)

  const aiTeams: AITeam[] = teams
    .filter((team) => team.index !== PLAYER_TEAM_INDEX)
    .map((team) => {
      const def = makeDefWithId(team.def, team.def.id)
      const players = squads.get(def.id) ?? []
      const stars = builtStars.get(def.id) ?? []
      const lineup = autoFillLineup(players, formationOf(def), tacticsOf(def))
      const check = validateLineup(players, lineup)
      if (!check.valid) throw new Error(`AI 队伍 ${def.name} 阵容不合法：${check.errors.join('；')}`)
      return {
        ...def,
        tactics: tacticsOf(def),
        playerNames: stars.map((star) => star.name),
        lineup,
        players,
        starPlayerIds: stars.map((star) => star.id),
      }
    })

  const freeStars = allStars.filter((star) => !usedStars.has(star.id))
  return { playerTeam, aiTeams, allStars, freeStars, playerDef }
}

export function buildAITeams(): AITeam[] {
  return buildLeague(1).aiTeams
}

export function aiTeamById(teams: AITeam[], id: string): AITeam | undefined {
  return teams.find((team) => team.id === id)
}

export const AI_SEED_NAMES: string[] = []
