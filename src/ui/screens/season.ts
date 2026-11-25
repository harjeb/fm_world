import { PLAYER_TEAM_ID, currentRoundFixtures, inPostseason, matchdayCountdown, nextMatchCountdown, nextSeasonCountdown, playerFixture, roundKickoffAt, teamName } from '../../game/season.ts'
import { computeTeamRankTrend } from '../../game/standings-history.ts'
import { hasDualD1, promotionSpotCount, worldDivisionLabel } from '../../game/world.ts'
import { clubRatings } from '../../game/club-rating.ts'
import { leaderPanels } from '../leaderboard.ts'
import { renderRankTrendChart } from '../rank-chart.ts'
import { isOnlineMode, onlineKickoffPending, serverNow } from '../../online.ts'
import { clubLook, clubName, crest, emptyState, fixtureRow, icon, leagueTable, ownName, pageHead, panel, teamForm, resultPill, tag, type FormResult } from '../components.ts'
import { cupRoundLabel, esc, kickoffTimeLabel } from '../format.ts'
import { game, ui } from '../state.ts'

function tierNote(): string {
  const dualD1 = game.world ? hasDualD1(game.world) : false
  const promoSpots = game.world ? promotionSpotCount(game.world) : 3
  if (game.season.tier === 'division2') {
    return promoSpots === 6
      ? '先锋升级杯（6 席方案）：首轮资格赛决出 12 强，分 A/B/C 三组踢 3 轮单循环，各组第 1 直接升级，3 场跨组附加赛（A2vB3、B2vC3、C2vA3）胜者升级，共 6 队升入精英联赛。'
      : '先锋每个赛区前 3 名进升级杯：各区第 1 轮空，2/3 名先加赛，然后随机分两组打循环，小组第一直接升级，两个小组第二再战决出第 3 个名额。'
  }
  if (game.season.tier === 'division1') {
    return dualD1
      ? '精英联赛南北两区第 1 名及成绩更好的第 2 名（共 3 队）升入冠军联赛；两区各自后三名（共 6 队）降入先锋联赛。'
      : '精英联赛前三升入冠军联赛，后三降入先锋联赛。'
  }
  if (game.season.tier === 'champions') return '冠军联赛前四获得下赛季传奇杯资格，后三降入精英联赛。'
  return ''
}

type MyFixtureRow = {
  key: string
  kickoffAt: number
  competition: string
  competitionTone: string
  roundLabel: string
  home: boolean
  opponent: string
  played: boolean
  score?: { home: number; away: number }
}

/** 我的联赛赛程：开赛时间跟赛季日历走，杯赛日的联赛顺延也会反映在 kickoffAt 上。 */
function myLeagueFixtures(): MyFixtureRow[] {
  return game.season.fixtures.filter((fixture) => fixture.isPlayer).map((fixture) => {
    const home = fixture.homeId === PLAYER_TEAM_ID
    return {
      key: `league-${fixture.round}`,
      kickoffAt: roundKickoffAt(game, fixture.round),
      competition: '联赛',
      competitionTone: '',
      roundLabel: `第 ${fixture.round} 轮`,
      home,
      opponent: home ? fixture.awayId : fixture.homeId,
      played: fixture.played,
      score: fixture.score,
    }
  })
}

/** 我的赛季杯赛：只在杯赛已公布且属于当前赛季时合并进赛程。 */
function myCupFixtures(): MyFixtureRow[] {
  const world = game.world
  const cups = world?.seasonCups
  if (!world || !cups || world.seasonCupMode !== 1 || cups.seasonIndex !== game.season.index) return []
  const ownId = world.clubs.find((club) => club.id === PLAYER_TEAM_ID)?.squadKey ?? PLAYER_TEAM_ID
  return cups.cups.flatMap((cup) => {
    const prelim = !cup.groups?.length && (cup.rounds[0]?.byes.length ?? 0) > 0
    return cup.rounds.flatMap((round) => round.fixtures
      .filter((fixture) => fixture.homeId === ownId || fixture.awayId === ownId)
      .map((fixture) => {
        const home = fixture.homeId === ownId
        return {
          key: fixture.id,
          kickoffAt: Number.isFinite(fixture.kickoffAt) ? fixture.kickoffAt : cup.dates[round.round - 1] ?? 0,
          competition: cup.name,
          competitionTone: 'info',
          roundLabel: cupRoundLabel(round.round, cup.dates.length, prelim, round.stage, round.leg, cup.id),
          home,
          opponent: home ? fixture.awayId : fixture.homeId,
          played: fixture.played,
          score: fixture.score,
        }
      }))
  })
}

function myFixtures(): string {
  const rows = [...myLeagueFixtures(), ...myCupFixtures()]
    .sort((a, b) => a.kickoffAt - b.kickoffAt || a.key.localeCompare(b.key, 'en'))
  if (rows.length === 0) return '<p class="muted pad">没有你的赛程。</p>'
  const next = rows.findIndex((row) => !row.played)
  const anchor = next >= 0 ? next : rows.length - 1
  const start = Math.max(0, Math.min(anchor - 3, rows.length - 9))
  const shown = rows.slice(start, start + 9)
  return `<div class="table-scroll"><table class="dt my-fixtures"><thead><tr><th>开赛</th><th>赛事</th><th>主客</th><th>对手</th><th class="num">结果</th></tr></thead><tbody>${shown.map((fixture) => {
    let result = ''
    if (fixture.played && fixture.score) {
      const mineScore = fixture.home ? fixture.score.home : fixture.score.away
      const theirs = fixture.home ? fixture.score.away : fixture.score.home
      const outcome: FormResult = mineScore > theirs ? 'W' : mineScore < theirs ? 'L' : 'D'
      result = `${resultPill(outcome)} <b class="num-text">${fixture.score.home}:${fixture.score.away}</b>`
    }
    return `<tr class="${fixture.key === rows[anchor]?.key ? 'me' : ''}">
      <td class="num-text dim">${esc(kickoffTimeLabel(fixture.kickoffAt))}</td>
      <td>${tag(esc(fixture.competition), fixture.competitionTone)} <small class="muted">${esc(fixture.roundLabel)}</small></td>
      <td class="dim">${fixture.home ? '主' : '客'}</td>
      <td>${clubName(fixture.opponent)}</td>
      <td class="num">${result || '<span class="muted small">未赛</span>'}</td>
    </tr>`
  }).join('')}</tbody></table></div>`
}

function myRankTrendPanel(divisionLabel: string): string {
  const season = game.season
  const names = new Map<string, string>([
    [PLAYER_TEAM_ID, game.clubName],
    ...game.aiTeams.map((team) => [team.id, team.name] as [string, string]),
  ])
  if (game.world) {
    for (const club of game.world.clubs) {
      if (!names.has(club.id)) names.set(club.id, club.id === PLAYER_TEAM_ID ? game.clubName : club.name)
    }
  }
  const teamIds = season.table.length > 0
    ? season.table.map((row) => row.teamId)
    : [PLAYER_TEAM_ID, ...game.aiTeams.map((team) => team.id)]
  const trend = computeTeamRankTrend({
    teamId: PLAYER_TEAM_ID,
    teamIds,
    fixtures: season.fixtures,
    names,
  })
  const look = clubLook(PLAYER_TEAM_ID)
  return panel(
    '本赛季排名变化',
    renderRankTrendChart(trend, {
      tier: season.tier,
      color: look.color,
      isPlayer: true,
      clubNames: names,
    }),
    {
      aside: `${crest(look, 16)}<span>${ownName(game.clubName)}</span>${tag(esc(divisionLabel))}`,
    },
  )
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
    !season.finished && fixture && !fixture.played && !game.activeMatch
      ? (isOnlineMode()
        ? `<span class="continue-wait">${icon('clock', 14)}下场比赛倒计时 · ${esc(nextMatchCountdown(game, serverNow()))}</span>`
        : `<button class="btn primary" data-action="start-league">${icon('play', 14)}跳至下一轮 · 对阵 ${esc(teamName(game, fixture.homeId === PLAYER_TEAM_ID ? fixture.awayId : fixture.homeId))}</button>`)
      : '',
    !fixture && !season.finished && !game.activeMatch ? '<button class="btn" data-action="sim-round">模拟本轮</button>' : '',
  ].join('')
  return `
    ${pageHead({
      kicker: `第 ${season.index} 赛季 · ${esc(division)}`,
      title: season.finished ? '赛季结束' : `第 ${season.round} / 38 轮`,
      sub: `20 队双循环：每天北京时间 02:00 / 06:00 / 10:00 / 14:00 / 18:00 / 22:00 固定 6 轮（每 4 小时一轮，一周一赛季）；杯赛在 12:00 / 20:00 额外加赛。联赛允许平局，比赛显示 90 分钟（现实约 10 分钟）。${season.finished ? '' : `距下一轮自动结算：${esc(matchdayCountdown(game))}。`}${tierNote()}`,
      actions,
    })}
    ${season.finished ? `<div class="banner ${inPostseason(game) ? 'info' : 'good'}">${icon(inPostseason(game) ? 'clock' : 'star', 18)}<b>${inPostseason(game) ? `赛后休整 · 还剩 ${esc(nextSeasonCountdown(game))}` : '赛季结束'}</b><span>冠军：${ownName(teamName(game, season.champion ?? ''), season.champion === PLAYER_TEAM_ID)} · 你的最终排名：第 ${season.playerFinish ?? '—'} 名${inPostseason(game) ? ' · 休整期间可以约友谊赛，升级杯正在进行' : ''}</span></div>` : ''}
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
        ${panel('我的赛程', myFixtures(), { flush: true, aside: `<span class="muted small">北京时间 · 联赛近况 ${teamForm(PLAYER_TEAM_ID, season.fixtures).length} 场</span>` })}
      </div>
    </div>
    ${myRankTrendPanel(division)}
    ${game.world?.seasonCupMode === 1 ? `<div class="btn-row pad"><button class="btn" data-nav="cups">${icon('badge', 14)} 查看赛季杯赛对阵与排行</button>${season.finished ? `<button class="btn primary" data-action="go-cup" data-cup="promotion">${icon('flag', 14)} 查看升级杯赛程与战报</button>` : ''}</div>` : ''}
    <div class="grid season-bottom">
      ${leaderPanels(season, { limit: 8 })}
    </div>
  `
}
