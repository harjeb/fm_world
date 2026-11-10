import type { Player } from '../game/types.ts'
import { chemistryKey, chemistryOf } from '../game/chemistry.ts'
import { serverNow } from '../online.ts'
import { game } from './state.ts'
import { esc } from './format.ts'

export function chemistryPartners(player: Player, candidates: Player[] = game.roster): string {
  const now = serverNow()
  const partners = candidates.filter(p => p.id !== player.id)
    .map(partner => ({ partner, value: chemistryOf(game.chemistry, player.id, partner.id, now, game.season.gameDayMs) }))
    .filter(pair => pair.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)
  if (!partners.length) return '<p class="hint">共同上场或参加配合训练后建立默契。</p>'
  return partners.map(({ partner, value }) => {
    const pair = game.chemistry![chemistryKey(player.id, partner.id)]
    return `<div class="row-line"><button class="name-btn" data-action="chemistry-detail" data-player="${esc(partner.id)}">${esc(partner.name)}</button><span title="共同上场 ${Math.round(pair.minutes)} 分钟；传球配合评分最多 +${(4 * value / 100).toFixed(1)}，长传减半、传中按八成计算">${value.toFixed(1)} <small class="muted">/ 100 · ${Math.round(pair.minutes)} 分钟</small></span></div>`
  }).join('')
}
