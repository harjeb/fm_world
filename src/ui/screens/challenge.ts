import type { AITeam } from '../../game/types.ts'
import type { WorldClub } from '../../game/types.ts'
import { caHeat, clubName, icon, pageHead, panel, recordResult, resultPill } from '../components.ts'
import { esc, playerCA, tacticText } from '../format.ts'
import { game, ui } from '../state.ts'
import { conferenceLabel } from '../../game/data/world-clubs.ts'
import { divisionIdForTier } from '../../game/data/world-clubs.ts'
import { inPostseason, nextSeasonCountdown } from '../../game/season.ts'
import { onlineState } from '../../online.ts'
import { DEFAULT_FORMATION } from '../../game/data/formations.ts'
import { STARTERS } from '../../game/squad.ts'

function strengthStars(value: number): string {
  const level = Math.max(0, Math.min(5, Math.round(value)))
  return `<span class="stars" aria-label="实力 ${level} / 5">${Array.from({ length: 5 }, (_, index) => `<i class="${index < level ? 'on' : ''}"></i>`).join('')}</span>`
}

function teamRow(team: Pick<AITeam, 'id' | 'name' | 'formationId' | 'tactics' | 'strength' | 'style'> & { players?: AITeam['players'] }): string {
  const players = team.players ?? []
  const best = [...players].sort((a, b) => playerCA(b) - playerCA(a))
  const average = best.length ? best.slice(0, STARTERS).reduce((sum, player) => sum + playerCA(player), 0) / Math.min(STARTERS, best.length) : 0
  return `<tr data-key="${esc(team.id)}">
    <td title="${esc(team.style)}">${clubName(team.id)}</td>
    <td class="dim">${esc(team.formationId)}</td>
    <td class="dim">${esc(tacticText(team.tactics))}</td>
    <td>${strengthStars(team.strength)}</td>
    <td class="num strong">${average ? caHeat(average) : '<span class="muted small">约战后再看</span>'}</td>
    <td class="dim names">${best.slice(0, 3).map((player) => esc(player.name)).join('、')}</td>
    <td class="num"><button class="btn small" data-action="start-world-challenge" data-team="${esc(team.id)}" ${game.activeMatch ? 'disabled' : ''}>约战</button></td>
  </tr>`
}

/** 可以约战的联赛：自己的分区 + 世界里的其他联赛（休整期也一样能踢）。 */
function divisionOptions(): { id: string; label: string }[] {
  if (!game.world) return [{ id: 'own', label: '本联赛' }]
  const zones = game.world.divisions.map((division) => ({
    id: division.divisionId ?? '',
    label: `${division.tier === 'champions' ? '冠军联赛' : division.tier === 'division1' ? '一级联赛' : `二级联赛 · ${conferenceLabel(division.conference)}`}`,
  }))
  return zones.filter((zone) => zone.id)
}

/** 当前选中联赛里的球队；本联赛直接用 game.aiTeams，别的分区用世界名单。 */
function divisionTeams(divisionId: string | null): (Pick<AITeam, 'id' | 'name' | 'formationId' | 'tactics' | 'strength' | 'style'> & { players?: AITeam['players'] })[] {
  if (!game.world || !divisionId || divisionId === game.world.playerDivisionId) {
    return game.aiTeams.map((team) => ({ ...team, id: team.id }))
  }
  const division = game.world.divisions.find((item) => item.divisionId === divisionId)
  const ids = division?.clubIds ?? []
  return ids
    .filter((id) => id !== 'player')
    .map((id) => {
      const club = game.world!.clubs.find((item) => item.id === id) as WorldClub | undefined
      return {
        id,
        name: club?.name ?? id,
        formationId: club?.formationId ?? DEFAULT_FORMATION,
        tactics: club?.tactics ?? { attack: 'balanced', passing: 'mixed', tempo: 'normal', line: 'mid', press: 'mid' },
        strength: club?.strength ?? 2,
        style: club?.style ?? 'balanced',
      }
    })
}

export function renderChallenge(): string {
  const options = divisionOptions()
  const fallbackId = game.world?.playerDivisionId ?? options[0]?.id ?? 'own'
  const activeId = ui.challengeDivision && options.some((option) => option.id === ui.challengeDivision) ? ui.challengeDivision : fallbackId
  const teams = divisionTeams(activeId)
  const online = onlineState.status === 'online'
  return `
    ${pageHead({
      kicker: '单场挑战',
      title: '友谊赛',
      sub: `不计联赛积分，平局直接进入点球大战。比赛固定种子，读档不能刷新射门。${inPostseason(game) ? `赛后休整还剩 ${esc(nextSeasonCountdown(game))}，这段时间最适合约战。` : ''}`,
    })}
    ${inPostseason(game) ? `<div class="banner info">${icon('clock', 18)}<b>赛后休整</b><span>升级杯正在进行；没有比赛任务的球队可以在这里和世界上任意一支球队踢友谊赛。</span></div>` : ''}
    <div class="toolbar">
      <span class="muted">选择联赛</span>
      <div class="seg" role="group" aria-label="联赛分区">
        ${options.map((option) => `<button class="${activeId === option.id ? 'active' : ''}" data-challenge-div="${esc(option.id)}">${esc(option.label)}</button>`).join('')}
      </div>
      ${online ? '<span class="muted small">联机时对手名单由服务器给出，包含其他教练的球队。</span>' : ''}
    </div>
    <div class="grid challenge-grid">
      ${panel(`可挑战球队 <small>${teams.length}</small>`, teams.length === 0
        ? '<p class="muted pad">这个联赛暂时没有可约的球队。</p>'
        : `<div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>阵型</th><th>战术</th><th>实力</th><th class="num">平均 CA</th><th>核心球员</th><th></th></tr></thead><tbody>${teams.map((team) => teamRow(team)).join('')}</tbody></table></div>`, { flush: true })}
      ${panel(`挑战记录 <small>${game.challengeHistory.length}</small>`, game.challengeHistory.length === 0
        ? '<p class="muted pad">还没有挑战记录。</p>'
        : `<div class="rows">${game.challengeHistory.map((record) => `<button class="row-btn result-row" data-action="open-review" data-record="${esc(record.id)}">
            ${resultPill(recordResult(record.result))}
            <span class="result-teams">${esc(record.awayName)} <b>${record.score.home}:${record.score.away}</b>${record.shootout ? ` <small class="muted">点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}</span>
            ${icon('right', 12)}
          </button>`).join('')}</div>`, { flush: true })}
    </div>
  `
}
