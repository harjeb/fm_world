/** 巅峰之路里程碑：金币和球迷交替，不同时发；属性突破卡共 5 张。 */
export type PeakMilestone = {
  stage: number
  kind: 'money' | 'fans'
  amount: number
  breakthroughCards?: number
}

export const PEAK_MILESTONES: PeakMilestone[] = [
  { stage: 10, kind: 'money', amount: 300_000 },
  { stage: 20, kind: 'fans', amount: 500 },
  { stage: 30, kind: 'money', amount: 500_000, breakthroughCards: 1 },
  { stage: 40, kind: 'fans', amount: 800, breakthroughCards: 1 },
  { stage: 50, kind: 'money', amount: 800_000 },
  { stage: 60, kind: 'fans', amount: 1200, breakthroughCards: 1 },
  { stage: 70, kind: 'money', amount: 1_500_000, breakthroughCards: 1 },
  { stage: 80, kind: 'fans', amount: 1800, breakthroughCards: 1 },
  { stage: 90, kind: 'money', amount: 2_200_000 },
  { stage: 100, kind: 'fans', amount: 3000 },
]

export const PEAK_MILESTONE_BY_STAGE = new Map(PEAK_MILESTONES.map((reward) => [reward.stage, reward]))
