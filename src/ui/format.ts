import type { AITeam, AttrKey, FormationId, MatchMentality, MatchRecord, MatchMode, Player, Position, SkillId, Tactics, TraitId, TrainingLogEntry } from '../game/types.ts'
import { deriveAITacticalProfile } from '../game/ai-tactics.ts'
import { ATTR_META } from '../game/data/attributes.ts'
import { ALL_ATTRIBUTES } from '../game/types.ts'
import { SKILLS } from '../game/data/skills.ts'
import { traitNameOf } from '../game/data/star-traits.ts'
import { caOf } from '../game/ca.ts'
import { authoredGain, displayAttr, displayCA, displayGain, displayPA, isMainAttr } from '../game/rating.ts'
import { formatGains } from '../game/training.ts'
import { STYLES_REV3, inferStyleForInstructions, type StyleId, type TacticalInstructionsV2 } from '../game/pes/tactics.ts'
import { matchPlanLabel, matchPlanPhaseName, type MatchPlanId } from '../game/pes/match-plan.ts'

export function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** PvE 比赛的模式标签；旧战报没有 mode 时按友谊赛显示。 */
export function pveModeLabel(mode?: MatchMode, stage?: number): string {
  if (mode === 'legend') return '传奇挑战'
  if (mode === 'cup') return '杯赛'
  if (mode === 'peak') return `巅峰之路 · 第 ${stage ?? '?'} 关`
  return '友谊赛'
}

export function matchModeLabel(record: Pick<MatchRecord, 'isLeague' | 'round' | 'mode' | 'stage'>): string {
  return record.isLeague ? `联赛第 ${record.round} 轮` : pveModeLabel(record.mode, record.stage)
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function attrLabel(key: AttrKey): string {
  return ATTR_META[key].label
}

const attrLabels = ALL_ATTRIBUTES.map((key) => [ATTR_META[key].label, key] as const).sort((a, b) => b[0].length - a[0].length)
const attrHintPattern = new RegExp(`(${attrLabels.map(([label]) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\+(\\d+(?:\\.\\d+)?)`, 'g')

export function displayEventHint(hint: string, gk: boolean, scale = 1): string {
  return hint.replace(attrHintPattern, (_match, label: string, value: string) => {
    const key = attrLabels.find(([text]) => text === label)![1]
    return `${label} +${displayGain(key, authoredGain(key, Number(value) * scale, gk), gk)}`
  }).replace(/疲劳\s*([+-])(\d+(?:\.\d+)?)/g, (_match, sign: string, value: string) => `训练体力 ${sign === '+' ? '-' : '+'}${value}`)
}

export function trainingLogText(entry: TrainingLogEntry, gk: boolean): string {
  let text = entry.text.replace('所有属性最高为 100', '主属性最高为 1500')
  if (entry.gains) {
    text = text.replace('部分属性已达 100 上限', '部分属性已达各自上限')
    const summary = formatGains(entry.gains, gk)
    text = text.replace(/（[^（）]*\+\d+(?:\.\d+)?[^（）]*）$/, summary ? `（${summary}）` : '')
  }
  return text
}

/** 球场上和其他窄位置只放姓：拉斐尔·塞拉 → 塞拉。中日韩名字没有间隔号，原样显示。 */
/** 竞拍倒计时：分:秒。到点后等服务器结算。 */
export function countdownText(ms: number): string {
  if (ms <= 0) return '结算中'
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function shortName(name: string): string {
  return name.split('·').pop() || name
}

export function skillName(id: SkillId): string {
  return SKILLS[id]?.name ?? id
}

export function traitName(id: TraitId): string {
  return traitNameOf(id)
}

export function positionLabel(pos: Position): string {
  return { GK: '门将', CB: '中卫', W: '边路', CM: '中场', ST: '前锋' }[pos]
}

export function positionClass(pos: Position): string {
  return `pos-${pos.toLowerCase()}`
}

export function playerCA(player: Pick<Player, 'attrs' | 'positions'>): number {
  return displayCA(caOf(player.attrs, player.positions.GK > 0))
}

export function playerPA(player: Player): number {
  return displayPA(player.pa)
}

export function attrValue(player: Player, key: AttrKey): number {
  return displayAttr(key, player.attrs[key], player.positions.GK > 0)
}

export function attrCeiling(player: Player, key: AttrKey): number {
  return displayAttr(key, player.ceilings[key], player.positions.GK > 0)
}

export function isVisibleAttr(player: Player, key: AttrKey): boolean {
  return isMainAttr(key, player.positions.GK > 0)
}

export function caDelta(a: Player, b: Player): string {
  const diff = playerCA(b) - playerCA(a)
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}`
}

export function tacticText(tactics: Tactics): string {
  const attack = { middle: '中路', wing: '边路', balanced: '均衡' }[tactics.attack]
  const passing = { short: '短传', mixed: '混合', direct: '直传' }[tactics.passing]
  const tempo = { slow: '稳健', normal: '正常', fast: '快速' }[tactics.tempo]
  const line = { low: '低', mid: '中', high: '高' }[tactics.line]
  const press = { low: '低', mid: '中', high: '高' }[tactics.press]
  return `${attack} / ${passing} / ${tempo} / 防线${line} / 压迫${press}`
}

/** 阵容战术风格简标（预设面板等处展示）。 */
export function lineupStyleLabel(source: {
  tacticalStyle?: StyleId
  tacticalInstructions?: TacticalInstructionsV2
  matchPlan?: MatchPlanId
}): string {
  const baseLabel = !source.tacticalInstructions
    ? '基础战术'
    : (() => {
        const info = inferStyleForInstructions(source.tacticalInstructions, source.tacticalStyle)
        return `${STYLES_REV3[info.styleId].name}${info.adjusted ? '·已调整' : ''}`
      })()
  if (source.matchPlan && source.matchPlan !== 'standard') {
    return `${baseLabel} · 计划:${matchPlanLabel(source.matchPlan)}`
  }
  return baseLabel
}

/** 赛中教练面板显示的当前战术摘要（兼容新十二项指令、比赛计划与旧五项）。 */
export function teamTacticSummary(team: {
  tactics: Tactics
  tacticalStyle?: StyleId
  matchPlan?: MatchPlanId
  activePlanPhase?: string
  baseInstructions?: TacticalInstructionsV2
  instructions?: TacticalInstructionsV2
}): string {
  const planPart = team.matchPlan && team.matchPlan !== 'standard'
    ? (() => {
        const phase = matchPlanPhaseName(team.activePlanPhase)
        return ` · 计划:${matchPlanLabel(team.matchPlan)}${phase ? `(${phase})` : ''}`
      })()
    : ''
  if (!team.instructions) return `${tacticText(team.tactics)}${planPart}`
  const base = team.baseInstructions ?? team.instructions
  const info = inferStyleForInstructions(base, team.tacticalStyle)
  const styleLabel = `${STYLES_REV3[info.styleId].name}${info.adjusted ? '·已调整' : ''}`
  return `${styleLabel}${planPart}（${tacticText(team.tactics)}）`
}

/** 赛中场上球员栏顶部显示的紧凑阵型+战术风格+临场心态摘要。 */
export function teamStatusTacticBadge(team: {
  formationId: FormationId
  tactics: Tactics
  mentality?: MatchMentality
  tacticalStyle?: StyleId
  baseInstructions?: TacticalInstructionsV2
  instructions?: TacticalInstructionsV2
}): string {
  const stylePart = team.instructions
    ? STYLES_REV3[inferStyleForInstructions(team.baseInstructions ?? team.instructions, team.tacticalStyle).styleId].name
    : tacticText(team.tactics)
  const mentalityPart =
    team.mentality === 'attack'
      ? ' · 全体进攻'
      : team.mentality === 'defend'
        ? ' · 全体防守'
        : ''
  return `${team.formationId} · ${stylePart}${mentalityPart}`
}

/** 挑战/世界列表里展示 AI 球队的战术风格与五项倾向（兼容冻结 PvE 球队实时推导）。 */
export function aiTeamTacticLabel(team: Pick<AITeam, 'formationId' | 'tactics' | 'players' | 'style' | 'strength' | 'tier'> & { lineup?: AITeam['lineup'] }): string {
  if (team.lineup?.tacticalInstructions) {
    const info = inferStyleForInstructions(team.lineup.tacticalInstructions, team.lineup.tacticalStyle)
    return `${STYLES_REV3[info.styleId].name}（${tacticText(team.lineup.tactics)}）`
  }
  if (team.lineup && team.players.length > 0) {
    const profile = deriveAITacticalProfile({
      players: team.players,
      lineup: team.lineup,
      clubStyle: team.style,
      seedTactics: team.tactics,
      strength: team.strength,
      tier: team.tier,
    })
    return `${STYLES_REV3[profile.tacticalStyle].name}（${tacticText(profile.tactics)}）`
  }
  return tacticText(team.tactics)
}

export function clockText(seconds: number): string {
  const clamped = Math.max(0, Math.min(5400, seconds))
  const minute = Math.floor(clamped / 60)
  const second = Math.floor(clamped % 60)
  return `${minute}:${String(second).padStart(2, '0')}`
}

export function gainText(gains: Partial<Record<AttrKey, number>> | undefined, gk = false): string {
  if (!gains) return ''
  return (Object.entries(gains) as [AttrKey, number][])
    .filter(([, value]) => value > 0.01)
    .map(([key, value]) => `${attrLabel(key)} +${displayGain(key, value, gk).toFixed(1)}`)
    .join(' · ')
}

export function attrsOf(player: Player, gk: boolean): AttrKey[] {
  const field: AttrKey[] = ['passing', 'firstTouch', 'dribbling', 'shooting', 'tackling', 'heading', 'vision', 'decisions', 'offBall', 'defPos', 'anticipation', 'composure', 'teamwork', 'acceleration', 'speed', 'agility', 'strength', 'endurance']
  return gk ? [...field, 'reflexes', 'handling', 'rushing', 'oneOnOne'] : field
}
