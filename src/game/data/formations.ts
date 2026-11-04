import type { FormationId, Position, RoleId, Tactics } from '../types.ts'

export type FormationSlot = {
  id: string
  position: Position
  label: string
  x: number
  y: number
  defaultRole: RoleId
}

export type FormationDef = {
  id: FormationId
  label: string
  desc: string
  slots: FormationSlot[]
  defaultTactics: Tactics
}

export const FORMATIONS: Record<FormationId, FormationDef> = {
  '1-2-3-1': {
    id: '1-2-3-1',
    label: '1-2-3-1',
    desc: '2 中卫 + 1 中场 + 2 边路 + 1 前锋：宽度好、接应点多，但边路同时前插会暴露中卫。',
    slots: [
      { id: 'gk', position: 'GK', label: '门将', x: 0.05, y: 0.5, defaultRole: 'gk_line' },
      { id: 'cbl', position: 'CB', label: '左中卫', x: 0.22, y: 0.34, defaultRole: 'cb_cover' },
      { id: 'cbr', position: 'CB', label: '右中卫', x: 0.22, y: 0.66, defaultRole: 'cb_stopper' },
      { id: 'cm', position: 'CM', label: '中场', x: 0.4, y: 0.5, defaultRole: 'cm_organizer' },
      { id: 'wl', position: 'W', label: '左边路', x: 0.58, y: 0.16, defaultRole: 'w_winger' },
      { id: 'wr', position: 'W', label: '右边路', x: 0.58, y: 0.84, defaultRole: 'w_support' },
      { id: 'st', position: 'ST', label: '前锋', x: 0.73, y: 0.5, defaultRole: 'st_finisher' },
    ],
    defaultTactics: { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '1-3-2-1': {
    id: '1-3-2-1',
    label: '1-3-2-1',
    desc: '3 中卫 + 2 中场 + 1 前锋：后场覆盖稳，适合防守转换，但前锋可能孤立、宽度不足。',
    slots: [
      { id: 'gk', position: 'GK', label: '门将', x: 0.05, y: 0.5, defaultRole: 'gk_sweeper' },
      { id: 'cbl', position: 'CB', label: '左中卫', x: 0.2, y: 0.26, defaultRole: 'cb_stopper' },
      { id: 'cbc', position: 'CB', label: '中卫', x: 0.19, y: 0.5, defaultRole: 'cb_cover' },
      { id: 'cbr', position: 'CB', label: '右中卫', x: 0.2, y: 0.74, defaultRole: 'cb_stopper' },
      { id: 'cml', position: 'CM', label: '左中场', x: 0.42, y: 0.35, defaultRole: 'cm_box2box' },
      { id: 'cmr', position: 'CM', label: '右中场', x: 0.42, y: 0.65, defaultRole: 'cm_organizer' },
      { id: 'st', position: 'ST', label: '前锋', x: 0.68, y: 0.5, defaultRole: 'st_target' },
    ],
    defaultTactics: { attack: 'middle', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
  },
  '1-2-2-2': {
    id: '1-2-2-2',
    label: '1-2-2-2',
    desc: '2 中卫 + 2 中场 + 2 前锋：禁区内终结点多，可支点搭档，但中场容易被压制、边路保护薄。',
    slots: [
      { id: 'gk', position: 'GK', label: '门将', x: 0.05, y: 0.5, defaultRole: 'gk_line' },
      { id: 'cbl', position: 'CB', label: '左中卫', x: 0.22, y: 0.35, defaultRole: 'cb_stopper' },
      { id: 'cbr', position: 'CB', label: '右中卫', x: 0.22, y: 0.65, defaultRole: 'cb_cover' },
      { id: 'cml', position: 'CM', label: '左中场', x: 0.42, y: 0.35, defaultRole: 'cm_organizer' },
      { id: 'cmr', position: 'CM', label: '右中场', x: 0.42, y: 0.65, defaultRole: 'cm_destroyer' },
      { id: 'stl', position: 'ST', label: '左前锋', x: 0.66, y: 0.36, defaultRole: 'st_runner' },
      { id: 'str', position: 'ST', label: '右前锋', x: 0.66, y: 0.64, defaultRole: 'st_target' },
    ],
    defaultTactics: { attack: 'balanced', passing: 'direct', tempo: 'normal', line: 'mid', press: 'mid' },
  },
}

export const FORMATION_LIST = Object.values(FORMATIONS)

export const TACTIC_LABELS = {
  attack: { label: '进攻方向', options: { middle: '中路', wing: '边路', balanced: '均衡' } },
  passing: { label: '传递', options: { short: '短传', mixed: '混合', direct: '直传' } },
  tempo: { label: '节奏', options: { slow: '稳健', normal: '正常', fast: '快速' } },
  line: { label: '防线', options: { low: '低', mid: '中', high: '高' } },
  press: { label: '压迫', options: { low: '低', mid: '中', high: '高' } },
} as const
