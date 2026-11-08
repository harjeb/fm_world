/**
 * 接触点结算的接口（docs/pes2d-migration-plan.md 阶段 3，路线 C）。
 *
 * pes2d 内核（sim.ts）负责物理、站位和决策；球场上每个“接触点”——传球能不能到位、射门进不进、抢断成不成、
 * 高球谁顶到、有没有犯规出牌受伤——的成败交给一个 `ContactModel`，由它按球员属性裁决，
 * 内核再用 ≤ 3 秒的物理轨迹把结果演出来（球飞向接球人 / 拦截者 / 门外，门将扑向球路……）。
 *
 * 没有接模型时（`PesMatch.contact === null`）内核保持 pes2d 原版行为，和原版逐位一致。
 *
 * 约定：
 *   - 模型只回答“结果是什么”，不改物理状态；物理状态（球、球员位置速度）只由内核改；
 *   - 模型自己的状态（比分之外的统计、黄牌、伤病、技能触发计数……）随比赛存档（`toJSON`），读档后继续一致；
 *   - 随机数用比赛的 `m.rng`（同一个发生器，状态在存档里），抽取顺序固定，所以同种子可复现。
 */
import type { PesMatch } from './sim.ts'
import type { PesEvent, PesPlayer, TeamIndex, Vec2 } from './spec.ts'

export type PassKind = 'short' | 'long' | 'through' | 'cross'

export interface PassVerdict {
  /** ok 到位 / icpt 被拦截 / miss 传丢（无主球） / out 出界 */
  result: 'ok' | 'icpt' | 'miss' | 'out'
  /** 拦截者 pid；result 不是 icpt 时为 -1 */
  interceptor: number
  /** 内核给出的成功率（写进事件，供统计和解说） */
  p: number
}

export interface ShotRequest {
  header: boolean
  penalty: boolean
  freeKick: boolean
}

export interface ShotVerdict {
  /** goal 进球 / save 被扑 / block 被封堵 / miss 偏出或打高 */
  result: 'goal' | 'save' | 'block' | 'miss'
  /** 封堵者 pid，没有为 -1 */
  blocker: number
  /** 这脚射门的进球概率（内核算出的 xG） */
  xg: number
  /** 被扑时：门将抱住（true）还是脱手（false） */
  hold: boolean
  /** 写进事件的细节：机会类型、距离、角度、脚、技术、目标角…… */
  meta: Record<string, number | string | boolean>
}

export interface DuelVerdict {
  /** keep 持球人摆脱 / tackle 干净断球 / foul 犯规 / loose 球滚向一旁 */
  outcome: 'keep' | 'tackle' | 'foul' | 'loose'
  /** 犯规时出的牌（第二张黄牌 = 'red' 且 second 为真） */
  card: 'yellow' | 'red' | null
  second: boolean
  /** 这次接触里受伤的球员 pid，没有为 -1；recoveryDays 为恢复天数 */
  injured: number
  recoveryDays: number
  /** 持球人摆脱的概率（写进事件） */
  p: number
}

export interface FoulVerdict {
  defender: number
  card: 'yellow' | 'red' | null
  second: boolean
  injured: number
  recoveryDays: number
  /** 犯规概率（写进事件） */
  p: number
}

export interface ContactModel {
  /** 比赛对象建好 / 读档后调用一次，让模型拿到物理比赛的引用 */
  attach(m: PesMatch): void
  /** 内核每产生一个事件就通知一次；统计只能从事件流推出来 */
  onEvent(m: PesMatch, event: PesEvent): void
  /**
   * 传球出脚：`aim` 是内核算好的传球落点（物理米）。
   * `setPiece` 为真表示任意球传中：成功率走 freeKickDeliveryChance，没传好时由离落点最近的防守者解围（算被拦截）。
   */
  pass(m: PesMatch, passer: PesPlayer, receiver: PesPlayer, aim: Vec2, kind: PassKind, setPiece?: boolean): PassVerdict
  /** 射门出脚（含头球、点球、任意球） */
  shot(m: PesMatch, shooter: PesPlayer, request: ShotRequest): ShotVerdict
  /** 近身对抗：防守者上抢持球人 */
  duel(m: PesMatch, defender: PesPlayer, carrier: PesPlayer): DuelVerdict
  /** 战术犯规：持球人出球前被贴身防守，可能直接被放倒；null = 不犯规 */
  tacticalFoul(m: PesMatch, carrier: PesPlayer): FoulVerdict | null
  /** 高球落点争顶：返回赢家 pid，没人碰到为 -1 */
  aerial(m: PesMatch, attackers: PesPlayer[], defenders: PesPlayer[], point: Vec2, attackingTi: TeamIndex): number
  /** 无主球：几个人同时够得着时谁拿到，返回 pid */
  loose(m: PesMatch, claimants: PesPlayer[]): number
  /** 专属特性“躲越位” */
  beatsOffside(m: PesMatch, receiver: PesPlayer): boolean
  /** 存档（纯数据） */
  toJSON(): unknown
}
