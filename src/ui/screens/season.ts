import { PLAYER_TEAM_ID, currentRoundFixtures, inPostseason, matchdayCountdown, nextSeasonCountdown, playerFixture, teamName } from '../../game/season.ts'
import { worldDivisionLabel } from '../../game/world.ts'
import { clubRatings } from '../../game/club-rating.ts'
import { leaderPanels } from '../leaderboard.ts'
import { gameDateOf } from '../../game/calendar.ts'
import { isOnlineMode } from '../../online.ts'
import { clubName, emptyState, fixtureRow, icon, leagueTable, pageHead, panel, teamForm, resultPill, type FormResult } from '../components.ts'
import { esc } from '../format.ts'
import { game, ui } from '../state.ts'

function tierNote(): string {
  if (game.season.tier === 'division2') return '二级每个赛区前 3 名进升级杯：各区第 1 轮空，2/3 名先加赛，然后随机分两组打循环（瑞士轮），小组第一直接升级，两个小组第二再战决出第 3 个名额。'
  if (game.season.tier === 'division1') return '一级联赛前三升入冠军联赛，后三降入二级联赛。'
  if (game.season.tier === 'champions') return '冠军联赛后三降入一级联赛。'
  return ''
}

function myFixtures(): string {
  const season = game.season
  const mine = season.fixtures.filter((fixture) => fixture.isPlayer).sort((a, b) => a.round - b.round)
  const anchor = mine.findIndex((fixture) => fixture.round >= season.round)
  const start = Math.max(0, (anchor < 0 ? mine.length : anchor) - 3)
  const shown = mine.slice(start, start + 9)
  if (shown.length === 0) return '<p class="muted pad">没有你的赛程。</p>'
  return `<div class="table-scroll"><table class="dt"><tbody>${shown.map((fixture) => {
    const home = fixture.homeId === PLAYER_TEAM_ID
    const opponent = home ? fixture.awayId : fixture.homeId
    let result = ''
    if (fixture.played && fixture.score) {
      const mineScore = home ? fixture.score.home : fixture.score.away
      const theirs = home ? fixture.score.away : fixture.score.home
      const outcome: FormResult = mineScore > theirs ? 'W' : mineScore < theirs ? 'L' : 'D'
      result = `${resultPill(outcome)} <b class="num-text">${fixture.score.home}:${fixture.score.away}</b>`
    }
    return `<tr class="${fixture.round === season.round ? 'me' : ''}">
      <td class="num dim">${fixture.round}</td>
      <td class="dim">${home ? '主' : '客'}</td>
      <td>${clubName(opponent)}</td>
      <td class="num">${result || '<span class="muted small">未赛</span>'}</td>
    </tr>`
  }).join('')}</tbody></table></div>`
}

export function renderSeason(): string {
  const season = game.season
  const fixture = playerFixture(game)
  const division = game.world ? worldDivisionLabel(game.world, season.divisionId ?? game.world.playerDivisionId) : '联赛'
  const lastRound = season.fixtures.reduce((max, item) => Math.max(max, item.round), 1)
  const viewRound = Math.max(1, Math.min(lastRound, ui.seasonRound ?? season.round))
  const roundFixtures = viewRound === season.round
    ? currentRoundFixtures(game)
    : season.fixtures.filter((item) => item.round === viewRound)
  const actions = [
    game.activeMatch ? `<button class="btn primary" data-nav="match">${icon('play', 14)}继续比赛</button>` : '',
    season.finished ? `<button class="btn primary" data-action="next-season">${icon('play', 14)}开始下一赛季</button>` : '',
    !season.finished && fixture && !fixture.played && !game.activeMatch ? `<button class="btn primary" data-action="start-league">${icon('play', 14)}${isOnlineMode() ? '对阵' : '跳至比赛日 · 对阵'} ${esc(teamName(game, fixture.homeId === PLAYER_TEAM_ID ? fixture.awayId : fixture.homeId))}</button>` : '',
    !fixture && !season.finished && !game.activeMatch ? '<button class="btn" data-action="sim-round">模拟本轮</button>' : '',
  ].join('')
  return `
    ${pageHead({
      kicker: `第 ${season.index} 赛季 · ${esc(division)}`,
      title: season.finished ? '赛季结束' : `第 ${season.round} / 38 轮`,
      sub: `20 队双循环：每 4 个游戏日一轮（现实 24 小时），约 1 场/天；联赛允许平局，比赛显示 90 分钟（现实约 10 分钟）。${season.finished ? '' : `距下一轮自动结算：${esc(matchdayCountdown(game))}。`}${tierNote()}`,
      actions,
    })}
    ${season.finished ? `<div class="banner ${inPostseason(game) ? 'info' : 'good'}">${icon(inPostseason(game) ? 'clock' : 'star', 18)}<b>${inPostseason(game) ? `赛后休整 · 还剩 ${esc(nextSeasonCountdown(game))}` : '赛季结束'}</b><span>冠军：${esc(teamName(game, season.champion ?? ''))} · 你的最终排名：第 ${season.playerFinish ?? '—'} 名${inPostseason(game) ? ' · 休整期间可以约友谊赛，升级杯正在进行' : ''}</span></div>` : ''}
    <div class="grid season-grid">
      ${panel('积分榜', leagueTable(season.table, { tier: season.tier, fixtures: season.fixtures, ratings: clubRatings(game) }), { flush: true })}
      <div class="dash-col">
        ${panel(`第 ${viewRound} 轮赛程`, `<div class="fx-list">${roundFixtures.map((item) => fixtureRow(item)).join('') || emptyState('本轮没有比赛。')}</div>
          ${viewRound === season.round && !fixture && !season.finished ? '<p class="hint pad">本轮没有你的比赛，等待服务器结算。</p>' : ''}`, {
          flush: true,
          aside: `<div class="pager-inline">
            <button class="btn small ghost" data-action="season-round" data-delta="-1" ${viewRound <= 1 ? 'disabled' : ''} aria-label="上一轮">${icon('left', 13)}</button>
            ${viewRound !== season.round ? '<button class="btn small ghost" data-action="season-round" data-delta="0">本轮</button>' : ''}
            <button class="btn small ghost" data-action="season-round" data-delta="1" ${viewRound >= lastRound ? 'disabled' : ''} aria-label="下一轮">${icon('right', 13)}</button>
          </div>`,
        })}
        ${panel('我的赛程', myFixtures(), { flush: true, aside: `<span class="muted small">近况 ${teamForm(PLAYER_TEAM_ID, season.fixtures).length} 场</span>` })}
      </div>
    </div>
    <div class="grid season-bottom">
      ${leaderPanels(season, { limit: 8 })}
    </div>
  `
}
