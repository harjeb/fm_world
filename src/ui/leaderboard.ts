import type { Fixture, SeasonState } from '../game/types.ts'
import { divisionLeaders, worldDivisionLabel } from '../game/world.ts'
import { PLAYER_TEAM_ID } from '../game/season.ts'
import { clubLook, crest, emptyState, panel } from './components.ts'
import { esc } from './format.ts'
import { game, ui } from './state.ts'

/** 射手榜 / 助攻榜的一行。 */
function leaderRows(division: { fixtures: Fixture[] }, kind: 'goals' | 'assists', limit: number): string {
  const rows = divisionLeaders(division, kind, limit)
  if (!rows.length) return emptyState(kind === 'goals' ? '还没有人进球。' : '还没有助攻记录。')
  return `<div class="rows leader-rows">${rows.map((row, index) => {
    const look = clubLook(row.teamId)
    const value = kind === 'goals' ? row.goals : row.assists
    return `<div class="row-line${row.teamId === PLAYER_TEAM_ID ? ' me' : ''}">
      <span class="rank-no">${index + 1}</span>
      <span class="leader-name"><button class="name-btn" data-club-player="${esc(row.playerId)}" data-club="${esc(row.teamId)}">${esc(row.name)}</button></span>
      <span class="leader-club">${crest(look, 14)}<span>${esc(look.name)}</span></span>
      <b class="num strong">${value}</b>
    </div>`
  }).join('')}</div>`
}

/** 一个联赛的射手榜 + 助攻榜，世界页和赛季页共用。 */
export function leaderPanels(division: { fixtures: Fixture[]; divisionId?: string } | undefined, options: { limit?: number; compact?: boolean } = {}): string {
  if (!division) return ''
  const limit = options.limit ?? 5
  const label = worldDivisionLabel(game.world!, division.divisionId ?? game.world!.playerDivisionId)
  if (options.compact) {
    return `<div class="leader-compact">
      <div class="leader-col"><h3>射手榜</h3>${leaderRows(division, 'goals', limit)}</div>
      <div class="leader-col"><h3>助攻榜</h3>${leaderRows(division, 'assists', limit)}</div>
    </div>`
  }
  return panel(`${esc(label)} · 射手榜`, leaderRows(division, 'goals', limit), { flush: true, aside: '<span class="muted small">按进球数</span>' }) +
    panel(`${esc(label)} · 助攻榜`, leaderRows(division, 'assists', limit), { flush: true, aside: '<span class="muted small">按助攻数</span>' })
}

export function activeLeaderDivision(): SeasonState | undefined {
  if (!game.world) return undefined
  const id = ui.worldDivision && game.world.divisions.some((division) => division.divisionId === ui.worldDivision)
    ? ui.worldDivision
    : game.world.playerDivisionId
  return game.world.divisions.find((division) => division.divisionId === id)
}
