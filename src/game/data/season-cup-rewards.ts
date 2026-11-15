import type { SeasonCupId } from '../season-cups.ts'

/** 比赛双方均有参赛金；冠军额外奖金每赛季一次，上限加成每种杯赛只生效一次。 */
export const SEASON_CUP_REWARDS: Record<SeasonCupId, { appearance: number; champion: number; ceiling: number }> = {
  community: { appearance: 50_000, champion: 300_000, ceiling: 100 },
  league: { appearance: 100_000, champion: 600_000, ceiling: 150 },
  champions: { appearance: 200_000, champion: 1_000_000, ceiling: 200 },
  cross: { appearance: 100_000, champion: 1_500_000, ceiling: 250 },
}
