import type { AttrKey, Player, StyleId } from '../types.ts'
import { mainAttrsFor } from '../scale.ts'

/**
 * 每种球员风格默认的 2 个主要属性（只用主属性：外场 7 项、门将 6 项）。
 * 自动培养默认先练这两项，免得把前锋练成传球手；同一位置不同风格的主要属性不同，
 * 比如前锋有的是射术 + 速度，有的是射术 + 爆发，有的是射术 + 力量。
 */
export const STYLE_KEY_ATTRS: Record<StyleId, [AttrKey, AttrKey]> = {
  gk_wall: ['handling', 'composure'],
  gk_shotstopper: ['reflexes', 'oneOnOne'],
  gk_sweeper: ['rushing', 'passing'],
  cb_stopper: ['tackling', 'strength'],
  cb_cover: ['tackling', 'speed'],
  cb_ballplaying: ['passing', 'tackling'],
  fb_attacking: ['speed', 'passing'],
  fb_playmaker: ['passing', 'dribbling'],
  w_dribbler: ['dribbling', 'acceleration'],
  w_crosser: ['passing', 'speed'],
  w_finisher: ['shooting', 'speed'],
  w_playmaker: ['passing', 'dribbling'],
  w_engine: ['speed', 'acceleration'],
  cm_playmaker: ['passing', 'dribbling'],
  cm_creator: ['passing', 'shooting'],
  cm_destroyer: ['tackling', 'strength'],
  cm_box2box: ['speed', 'tackling'],
  cm_mezzala: ['passing', 'acceleration'],
  cm_engine: ['speed', 'tackling'],
  st_finisher: ['shooting', 'speed'],
  st_poacher: ['shooting', 'acceleration'],
  st_target: ['shooting', 'strength'],
  st_runner: ['speed', 'shooting'],
  st_false9: ['passing', 'shooting'],
}

/** 风格缺失或不认识时，按位置给一对通用的主要属性。 */
const POSITION_KEY_ATTRS: Record<'GK' | 'CB' | 'W' | 'CM' | 'ST', [AttrKey, AttrKey]> = {
  GK: ['reflexes', 'handling'],
  CB: ['tackling', 'strength'],
  W: ['dribbling', 'acceleration'],
  CM: ['passing', 'tackling'],
  ST: ['shooting', 'speed'],
}

/** 这名球员默认的 2 个主要属性（一定是他那种尺度下的主属性，外场球员不会拿到门将属性）。 */
export function keyAttrsOf(player: Pick<Player, 'style' | 'positions'>): [AttrKey, AttrKey] {
  const gk = player.positions.GK > 0
  const mains = mainAttrsFor(gk)
  const styled = STYLE_KEY_ATTRS[player.style]
  if (styled && styled.every((key) => mains.includes(key))) return styled
  const position = gk ? 'GK' : (['ST', 'W', 'CM', 'CB'] as const).reduce((best, pos) => (player.positions[pos] > player.positions[best] ? pos : best), 'CM' as 'ST' | 'W' | 'CM' | 'CB')
  return POSITION_KEY_ATTRS[position]
}
