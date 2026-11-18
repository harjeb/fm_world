/** Stable five-star academy scale, independent of first-team cards or roster changes. */
export function youthStars(ca: number): number {
  if (!Number.isFinite(ca) || ca <= 0) return 0
  return Math.max(0.5, Math.min(5, Math.round(ca / 280 * 10) / 2))
}
