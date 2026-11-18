import { esc } from './format.ts'
import './stars.css'
import { youthStars } from '../game/youth-rating.ts'
export { youthStars } from '../game/youth-rating.ts'

/** Shared five-star display. Namespaced states must never inherit the global .empty panel. */
export function starRating(value: number, label = '', showNumber = false): string {
  const stars = Number.isFinite(value) ? Math.max(0, Math.min(5, Math.round(value * 2) / 2)) : 0
  const icons = Array.from({ length: 5 }, (_, index) => {
    const state = stars >= index + 1 ? 'full' : stars >= index + 0.5 ? 'half' : 'empty'
    return `<span class="rating-star rating-star--${state}" aria-hidden="true">★</span>`
  }).join('')
  return `<span class="star-rating" role="img" aria-label="${esc(label ? `${label}：` : '')}${stars.toFixed(1)} 星（满分 5 星）"><span class="rating-stars" aria-hidden="true">${icons}</span>${showNumber ? `<b class="rating-number" aria-hidden="true">${stars.toFixed(1)}</b>` : ''}</span>`
}

export function youthRatingSummary(currentCA: number, ceiling: number): string {
  return `<div class="youth-ratings"><div><span class="youth-rating-label">当前能力</span>${starRating(youthStars(currentCA), '当前能力')}</div><div><span class="youth-rating-label">潜力</span>${starRating(youthStars(Math.max(currentCA, ceiling)), '潜力')}</div></div>`
}
