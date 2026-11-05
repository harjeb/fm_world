import type { AttrKey, Position, RoleId } from '../types.ts'
import { attrRating } from '../scale.ts'

export type RoleDef = {
  id: RoleId
  position: Position
  label: string
  desc: string
  weights: Partial<Record<AttrKey, number>>
  holdBack: boolean
  forwardRun: number
  pressBias: number
  supportBias: number
  widthBias: number
}

export const ROLES: Record<RoleId, RoleDef> = {
  gk_line: {
    id: 'gk_line',
    position: 'GK',
    label: '门线门将',
    desc: '更重扑救与手控，优先守住球门',
    weights: { reflexes: 0.4, handling: 0.3, oneOnOne: 0.2, composure: 0.1 },
    holdBack: true,
    forwardRun: 0,
    pressBias: 0,
    supportBias: 0,
    widthBias: 0,
  },
  gk_sweeper: {
    id: 'gk_sweeper',
    position: 'GK',
    label: '清道夫门将',
    desc: '更积极出击处理身后球，并参与出球',
    weights: { rushing: 0.35, reflexes: 0.25, passing: 0.2, anticipation: 0.1, oneOnOne: 0.1 },
    holdBack: true,
    forwardRun: 0,
    pressBias: 0,
    supportBias: 0.2,
    widthBias: 0,
  },
  cb_stopper: {
    id: 'cb_stopper',
    position: 'CB',
    label: '上抢中卫',
    desc: '主动压迫与对抗，离开位置后需要队友补位',
    weights: { tackling: 0.3, strength: 0.25, defPos: 0.2, heading: 0.15, composure: 0.1 },
    holdBack: false,
    forwardRun: 0.05,
    pressBias: 0.8,
    supportBias: 0.1,
    widthBias: 0.1,
  },
  cb_cover: {
    id: 'cb_cover',
    position: 'CB',
    label: '拖后中卫',
    desc: '守身后与补位；进攻时明确留后',
    weights: { defPos: 0.3, anticipation: 0.25, tackling: 0.2, speed: 0.15, teamwork: 0.1 },
    holdBack: true,
    forwardRun: 0,
    pressBias: 0.3,
    supportBias: 0.2,
    widthBias: 0.1,
  },
  cb_ball: {
    id: 'cb_ball',
    position: 'CB',
    label: '出球中卫',
    desc: '参与后场组织，但回追与保护仍优先',
    weights: { passing: 0.25, composure: 0.2, defPos: 0.2, anticipation: 0.15, vision: 0.1, tackling: 0.1 },
    holdBack: false,
    forwardRun: 0.15,
    pressBias: 0.3,
    supportBias: 0.6,
    widthBias: 0.2,
  },
  w_winger: {
    id: 'w_winger',
    position: 'W',
    label: '突击边路',
    desc: '拉开宽度、持球突破、下底',
    weights: { dribbling: 0.3, acceleration: 0.2, speed: 0.15, offBall: 0.15, agility: 0.1, passing: 0.1 },
    holdBack: false,
    forwardRun: 0.85,
    pressBias: 0.4,
    supportBias: 0.3,
    widthBias: 1,
  },
  w_support: {
    id: 'w_support',
    position: 'W',
    label: '边路接应',
    desc: '少冒险突破，多接应与回防',
    weights: { teamwork: 0.2, passing: 0.2, offBall: 0.2, defPos: 0.15, acceleration: 0.15, firstTouch: 0.1 },
    holdBack: false,
    forwardRun: 0.4,
    pressBias: 0.6,
    supportBias: 0.8,
    widthBias: 0.9,
  },
  w_inside: {
    id: 'w_inside',
    position: 'W',
    label: '内切边锋',
    desc: '从边路向禁区肋部切入，增加终结',
    weights: { dribbling: 0.25, shooting: 0.2, offBall: 0.2, acceleration: 0.15, composure: 0.1, passing: 0.1 },
    holdBack: false,
    forwardRun: 0.8,
    pressBias: 0.4,
    supportBias: 0.4,
    widthBias: 0.5,
  },
  cm_organizer: {
    id: 'cm_organizer',
    position: 'CM',
    label: '组织中场',
    desc: '接应、转换方向、创造线路',
    weights: { passing: 0.3, vision: 0.25, decisions: 0.15, firstTouch: 0.15, composure: 0.1, teamwork: 0.05 },
    holdBack: false,
    forwardRun: 0.25,
    pressBias: 0.4,
    supportBias: 1,
    widthBias: 0.3,
  },
  cm_destroyer: {
    id: 'cm_destroyer',
    position: 'CM',
    label: '防守中场',
    desc: '保护后场、截断反击，不必追求最高传球',
    weights: { defPos: 0.25, tackling: 0.25, anticipation: 0.2, teamwork: 0.15, endurance: 0.1, strength: 0.05 },
    holdBack: true,
    forwardRun: 0.05,
    pressBias: 0.9,
    supportBias: 0.4,
    widthBias: 0.3,
  },
  cm_box2box: {
    id: 'cm_box2box',
    position: 'CM',
    label: '前插中场',
    desc: '在两个禁区之间往返，后上进入禁区',
    weights: { endurance: 0.2, offBall: 0.15, tackling: 0.15, passing: 0.15, teamwork: 0.15, acceleration: 0.1, decisions: 0.1 },
    holdBack: false,
    forwardRun: 0.7,
    pressBias: 0.7,
    supportBias: 0.7,
    widthBias: 0.4,
  },
  st_finisher: {
    id: 'st_finisher',
    position: 'ST',
    label: '终结前锋',
    desc: '抢点、制造单刀、完成终结',
    weights: { shooting: 0.35, offBall: 0.2, composure: 0.2, firstTouch: 0.1, acceleration: 0.1, heading: 0.05 },
    holdBack: false,
    forwardRun: 1,
    pressBias: 0.3,
    supportBias: 0.3,
    widthBias: 0.3,
  },
  st_target: {
    id: 'st_target',
    position: 'ST',
    label: '支点前锋',
    desc: '背身护球、争顶、为队友做球',
    weights: { strength: 0.25, heading: 0.2, shooting: 0.2, firstTouch: 0.15, teamwork: 0.1, passing: 0.1 },
    holdBack: false,
    forwardRun: 0.45,
    pressBias: 0.5,
    supportBias: 0.8,
    widthBias: 0.4,
  },
  st_runner: {
    id: 'st_runner',
    position: 'ST',
    label: '跑位前锋',
    desc: '冲击身后、拉开防线、接直塞',
    weights: { acceleration: 0.25, speed: 0.2, offBall: 0.25, shooting: 0.2, composure: 0.1, dribbling: 0.1 },
    holdBack: false,
    forwardRun: 1,
    pressBias: 0.45,
    supportBias: 0.4,
    widthBias: 0.5,
  },
}

export const ROLES_BY_POSITION: Record<Position, RoleId[]> = {
  GK: ['gk_line', 'gk_sweeper'],
  CB: ['cb_stopper', 'cb_cover', 'cb_ball'],
  W: ['w_winger', 'w_support', 'w_inside'],
  CM: ['cm_organizer', 'cm_destroyer', 'cm_box2box'],
  ST: ['st_finisher', 'st_target', 'st_runner'],
}

/** playerIsGk 决定属性按哪种尺度换算；门将和外场互相客串时不能用职责的位置来判断。 */
export function roleFit(playerAttrs: Record<string, number>, roleId: RoleId, playerIsGk = ROLES[roleId].position === 'GK'): number {
  const role = ROLES[roleId]
  let sum = 0
  let total = 0
  for (const [key, weight] of Object.entries(role.weights) as [AttrKey, number][]) {
    sum += attrRating(key, playerAttrs[key] ?? 0, playerIsGk) * weight
    total += weight
  }
  return total > 0 ? sum / total : 0
}
