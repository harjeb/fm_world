import { starTraitOf } from '../data/star-traits.ts'
import type { MatchTeamInput, MatchTeamState, MatchPlayerState, MatchSide } from './types.ts'
import type { Attributes, Player, PlayerMatchStats } from '../types.ts'
import { ALL_ATTRIBUTES } from '../types.ts'
import { attrRating } from '../scale.ts'
import { personKey } from '../injury.ts'
import { customSpotFor } from '../squad.ts'
import { FORMATIONS } from '../data/formations.ts'
import { detailedPositionForSlot } from '../detailed-positions.ts'
import { cloneInstructions, instructionsFromLegacyTactics } from '../pes/tactics.ts'
import { playerAppearanceId } from '../appearance.ts'

export const PITCH_LENGTH = 100
export const PITCH_WIDTH = 64
export const GOAL_WIDTH = 12
export const GOAL_Y = PITCH_WIDTH / 2

export function emptyPlayerStats(player: Player, side: MatchSide): PlayerMatchStats {
  return {
    playerId: `${side}:${player.id}`,
    sourceId: player.id,
    name: player.name,
    side,
    number: player.number,
    height: player.height,
    appearanceId: playerAppearanceId(player),
    minutes: 0,
    passes: 0,
    passesCompleted: 0,
    shots: 0,
    shotsOnTarget: 0,
    xg: 0,
    chancesCreated: 0,
    chancesConverted: 0,
    xa: 0,
    tackleAttempts: 0,
    saves: 0,
    goalsConceded: 0,
    xgConceded: 0,
    claims: 0,
    goals: 0,
    assists: 0,
    tackles: 0,
    interceptions: 0,
    distance: 0,
    staminaLeft: 100,
    touches: 0,
  }
}

export function toMatchPlayer(player: Player, side: MatchSide, role: MatchPlayerState['role'], slotId: string, position: MatchPlayerState['position']): MatchPlayerState {
  const gk = player.positions.GK > 0
  const attrs = {} as Attributes
  for (const key of ALL_ATTRIBUTES) attrs[key] = attrRating(key, player.attrs[key], gk)
  return {
    id: `${side}:${player.id}`,
    sourceId: player.id,
    personId: personKey(player),
    name: player.name,
    ...(typeof player.age === 'number' && Number.isFinite(player.age) ? { age: player.age } : {}),
    number: player.number,
    side,
    attrs,
    positions: { ...player.positions },
    detailedPositions: player.detailedPositions && { ...player.detailedPositions },
    skills: [...player.skills],
    skillTiers: { ...player.skillTiers },
    traitId: player.traitId,
    ...(player.routeId ? { routeId: player.routeId } : {}),
    ...(player.personality ? { personality: { ...player.personality } } : {}),
    foot: player.foot,
    height: player.height,
    role,
    slotId,
    position,
    x: 0,
    y: 0,
    stamina: (55 + attrs.endurance * 0.45) * Math.max(0.05, Math.min(1, (player.condition ?? 100) / 100)),
    maxStamina: 55 + attrs.endurance * 0.45,
    onPitch: true,
    cameOff: false,
    yellowCards: 0,
    sentOff: false,
    stats: emptyPlayerStats(player, side),
  }
}

export function buildMatchTeam(input: MatchTeamInput, side: MatchSide): MatchTeamState {
  const formation = FORMATIONS[input.formationId]
  const players: MatchPlayerState[] = []
  for (const starter of input.starters) {
    const slot = formation.slots.find((item) => item.id === starter.slotId)
    const position = slot?.position ?? 'CM'
    const mp = toMatchPlayer(starter.player, side, starter.role, starter.slotId, position)
    if (slot) mp.detailedPosition = detailedPositionForSlot(slot)
    mp.stats.onMinute = 0
    mp.stats.staminaLeft = Math.round((mp.stamina / Math.max(1, mp.maxStamina)) * 100)
    // 玩家自己摆的位置优先（见 squad.rememberLineupPositions）；没摆过就用阵型默认坐标。
    const spot = customSpotFor(starter.player) ?? slot
    if (spot) {
      const depth = Math.min(1, Math.max(0, spot.x))
      const width = Math.min(1, Math.max(0, spot.y))
      const baseX = 8 + depth * 42
      const baseY = width * PITCH_WIDTH
      mp.x = side === 'home' ? baseX : PITCH_LENGTH - baseX
      mp.y = side === 'home' ? baseY : PITCH_WIDTH - baseY
    } else {
      mp.x = side === 'home' ? 25 : 75
      mp.y = PITCH_WIDTH / 2
    }
    players.push(mp)
  }
  const bench = input.bench.map((player) => {
    const mp = toMatchPlayer(player, side, input.starters[0]?.role ?? 'cm_organizer', 'bench', player.positions.GK > 0 ? 'GK' : 'CM')
    mp.onPitch = false
    mp.stats.staminaLeft = Math.round((mp.stamina / Math.max(1, mp.maxStamina)) * 100)
    return mp
  })
  const activePlan = input.matchPlan && input.matchPlan !== 'standard' ? input.matchPlan : undefined
  const hasCustomRules = !!(input.matchPlanRules?.some((r) => r.enabled))
  const effectiveInstructions = input.instructions ?? (activePlan || hasCustomRules ? instructionsFromLegacyTactics(input.tactics) : undefined)
  const baseSlotRoles = hasCustomRules
    ? Object.fromEntries(input.starters.map((s) => [s.slotId, s.role]))
    : undefined
  const basePreferredPlayers = hasCustomRules
    ? Object.fromEntries(input.starters.map((s) => [s.slotId, s.player.id]))
    : undefined
  return {
    side,
    id: input.id,
    name: input.name,
    color: input.color,
    accent: input.accent,
    formationId: input.formationId,
    tactics: { ...input.tactics },
    ...(activePlan || hasCustomRules || input.aiCoach ? { baseTactics: { ...input.tactics } } : {}),
    ...(activePlan ? { matchPlan: activePlan } : {}),
    ...(hasCustomRules
      ? {
          baseFormationId: input.formationId,
          ...(input.baseCustomPositions && Object.keys(input.baseCustomPositions).length
            ? { baseCustomPositions: structuredClone(input.baseCustomPositions) }
            : {}),
          ...(baseSlotRoles ? { baseSlotRoles } : {}),
          ...(basePreferredPlayers ? { basePreferredPlayers } : {}),
          baseMentality: 'balanced' as const,
          ...(input.tacticsStage !== undefined ? { tacticsStage: input.tacticsStage } : {}),
          ...(input.backupTactics?.length ? { backupTactics: structuredClone(input.backupTactics) } : {}),
          matchPlanRules: structuredClone(input.matchPlanRules!),
        }
      : {}),
    ...(input.aiCoach ? { aiCoach: true } : {}),
    ...(input.autoShout ? { autoShout: true } : {}),
    players,
    bench,
    autoSubs: input.autoSubs ? structuredClone(input.autoSubs) : undefined,
    subsUsed: 0,
    ...(input.chemistry && Object.keys(input.chemistry).length ? { chemistry: { ...input.chemistry } } : {}),
    ...(side === 'home' && typeof input.stadiumStage === 'number' && input.stadiumStage > 0 ? { stadiumStage: input.stadiumStage } : {}),
    ...(effectiveInstructions
      ? {
          ...(input.tacticalStyle ? { tacticalStyle: input.tacticalStyle } : {}),
          baseInstructions: cloneInstructions(effectiveInstructions),
          instructions: cloneInstructions(effectiveInstructions),
          familiarity: input.familiarity ?? 1,
          ...(input.baseFamiliarity !== undefined ? { baseFamiliarity: input.baseFamiliarity } : {}),
        }
      : {}),
  }
}

export function isGoalkeeperSlot(player: MatchPlayerState): boolean {
  return player.position === 'GK' || player.positions.GK > 0 && player.role === 'gk_line' || player.role === 'gk_sweeper'
}

export function opponentSide(side: MatchSide): MatchSide {
  return side === 'home' ? 'away' : 'home'
}

/** Missing tiers on legacy players and match states retain the silver effect. */
export function skillTierMultiplier(player: MatchPlayerState, skill: import('../types.ts').SkillId): number {
  const tier = player.skillTiers?.[skill] === 'rainbow' ? 1.4 : player.skillTiers?.[skill] === 'gold' ? 1.2 : 1
  const star = starTraitOf(player.traitId)
  return star?.kind === 'skillBoost' ? tier * (1 + star.pct / 100) : tier
}
