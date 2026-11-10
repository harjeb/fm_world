export type Score = { home: number; away: number }

/** 上一回合的进球按本场主客方向计入；客场进球不加权。 */
export function aggregateScore(score: Score, offset?: Score): Score {
  return { home: score.home + (offset?.home ?? 0), away: score.away + (offset?.away ?? 0) }
}

export function needsShootout(knockout: boolean, score: Score, offset?: Score): boolean {
  const total = aggregateScore(score, offset)
  return knockout && total.home === total.away
}
