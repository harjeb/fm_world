import type { LegendBook } from '../types.ts'
import type { SeasonCupId } from '../season-cups.ts'
import { LEGEND_CUP_REWARD_BOOK } from './legend-cup-skill.ts'

export type SeasonCupRewardDef = {
  appearance: number
  champion: number
  /** 奖杯提供的俱乐部主属性上限加成；多项冠军只取最高值，不叠加。传奇杯不给上限，改发专属彩书。 */
  ceiling: number
  /** 首次夺冠发放的唯一专属技能书。 */
  book?: LegendBook
}

/** 比赛双方均有参赛金；冠军额外奖金每赛季一次；奖杯上限加成全局取最高值不叠加；传奇杯首冠发彩书《传奇之星》。 */
export const SEASON_CUP_REWARDS: Record<SeasonCupId, SeasonCupRewardDef> = {
  community: { appearance: 50_000, champion: 300_000, ceiling: 100 },
  league: { appearance: 100_000, champion: 600_000, ceiling: 150 },
  champions: { appearance: 200_000, champion: 1_000_000, ceiling: 200 },
  cross: { appearance: 100_000, champion: 1_500_000, ceiling: 250 },
  legend: { appearance: 300_000, champion: 3_000_000, ceiling: 0, book: LEGEND_CUP_REWARD_BOOK },
  promotion: { appearance: 0, champion: 0, ceiling: 0 },
}
