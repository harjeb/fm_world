import type { GameState } from '../game/types.ts'
import { SEASON_CUP_NAMES, type SeasonCup, type SeasonCupId } from '../game/season-cups.ts'
import { SEASON_CUP_REWARDS } from '../game/data/season-cup-rewards.ts'
import { seasonCupLeaders, type CupLeaderKind } from '../game/season-cup-stats.ts'
import { CUP_DEFS } from '../game/data/cup-config.ts'
import { buildSeasonCupBracket, type CupBracketNode } from './season-cup-bracket.ts'
import { clubName, emptyState, pageHead, panel } from './components.ts'
import { esc } from './format.ts'

const CUP_ORDER: SeasonCupId[] = ['community', 'league', 'champions', 'cross']

function displayId(id: string, ownId: string): string { return id === ownId ? 'player' : id }
function kickoff(at: number): string {
  return new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
function roundLabel(round: number, total: number, prelim: boolean): string {
  if (round === 1 && prelim) return '预选赛'
  const remaining = total - round
  if (remaining === 0) return '决赛'
  if (remaining === 1) return '半决赛'
  if (remaining === 2) return '四分之一决赛'
  const teams = 2 ** (remaining + 1)
  return `${teams} 强`
}
function nodeWinner(node: CupBracketNode): string | undefined {
  return node.byeTeam ?? (node.fixture?.played ? node.fixture.winnerId : undefined)
}
function teamCell(id: string | undefined, ownId: string, placeholder: string, score?: number, won = false): string {
  return `<div class="sc-team${won ? ' is-winner' : ''}">${id ? clubName(displayId(id, ownId), 17) : `<span class="sc-pending">${esc(placeholder)}</span>`}${score !== undefined ? `<b class="sc-score">${score}</b>` : ''}</div>`
}
function bracketCard(game: GameState, cup: SeasonCup, node: CupBracketNode, ownId: string): string {
  const fixture = node.fixture
  const home = fixture?.homeId ?? (node.children ? nodeWinner(node.children[0]) : node.byeTeam)
  const away = fixture?.awayId ?? (node.children ? nodeWinner(node.children[1]) : undefined)
  const score = fixture?.played ? fixture.score : undefined
  const replay = fixture?.matchId && game.challengeHistory.some(record => record.id === fixture.matchId)
  const bye = !!node.byeTeam
  const title = roundLabel(node.round, cup.dates.length, cup.rounds[0].byes.length > 0)
  return `<article class="sc-card${bye ? ' sc-bye' : ''}" data-cup-node="${esc(node.id)}"><header><span>${esc(title)}</span><time>${esc(kickoff(cup.dates[node.round - 1]))}</time></header>
    ${teamCell(home, ownId, '前轮胜者待定', score?.home, !!fixture?.winnerId && fixture.winnerId === home)}
    ${bye ? '<div class="sc-bye-label">轮空 · 直接晋级</div>' : teamCell(away, ownId, '前轮胜者待定', score?.away, !!fixture?.winnerId && fixture.winnerId === away)}
    ${fixture?.shootout ? `<div class="sc-card-extra">点球 ${fixture.shootout.home} : ${fixture.shootout.away}</div>` : ''}
    ${replay ? `<button class="link sc-card-extra" data-action="open-review" data-record="${esc(fixture!.matchId)}">查看战报</button>` : ''}</article>`
}
function renderBranch(game: GameState, cup: SeasonCup, node: CupBracketNode, ownId: string): string {
  const card = bracketCard(game, cup, node, ownId)
  if (!node.children) return card
  return `<div class="sc-branch"><div class="sc-children"><div class="sc-child">${renderBranch(game, cup, node.children[0], ownId)}</div><div class="sc-child">${renderBranch(game, cup, node.children[1], ownId)}</div></div><div class="sc-parent">${card}</div></div>`
}
function fixtureList(cup: SeasonCup, ownId: string): string {
  return cup.rounds.map(round => `<section class="sc-fallback-round"><h3>第 ${round.round} 轮 · ${esc(kickoff(round.kickoffAt))}</h3><div class="rows">${round.byes.map(id => `<div class="row-line">${clubName(displayId(id, ownId), 17)}<span class="muted">轮空</span></div>`).join('')}${round.fixtures.map(fixture => `<div class="row-line">${clubName(displayId(fixture.homeId, ownId), 17)}<b>${fixture.score ? `${fixture.score.home} : ${fixture.score.away}` : 'VS'}</b>${clubName(displayId(fixture.awayId, ownId), 17)}</div>`).join('')}</div></section>`).join('')
}
function bracketPanel(game: GameState, cup: SeasonCup, ownId: string, drawSeed: number | undefined): string {
  const root = buildSeasonCupBracket(cup, drawSeed)
  const body = root
    ? `<p class="hint pad">从左至右查看晋级路径；尚未决出的球队显示“待定”，轮空球队直接晋级。</p><div class="sc-tree-viewport" aria-label="${esc(cup.name)}淘汰赛对阵树"><div class="sc-tree">${renderBranch(game, cup, root, ownId)}</div></div>`
    : `<p class="hint pad">签表来源未完整记录，显示已公布对阵，避免画错晋级路径。</p>${fixtureList(cup, ownId)}`
  return panel('淘汰赛对阵图', body, { flush: true })
}
function leaderPanel(cup: SeasonCup, ownId: string, kind: CupLeaderKind, title: string, unit: string): string {
  const leaders = seasonCupLeaders(cup, kind, 10)
  const body = leaders.length ? `<div class="rows leader-rows">${leaders.map((row, index) => `<div class="row-line"><span class="rank-no">${index + 1}</span><span class="leader-name"><button class="name-btn" data-club-player="${esc(row.playerId)}" data-club="${esc(displayId(row.teamId, ownId))}">${esc(row.name)}</button></span><span class="sc-leader-club">${clubName(displayId(row.teamId, ownId), 14)}</span><b class="num strong">${row.value}</b></div>`).join('')}</div>` : emptyState('暂无已公布数据。')
  return panel(title, body, { flush: true, aside: `<span class="muted small">${esc(unit)}</span>` })
}
function legacyHistory(game: GameState): string {
  const runs = [...Object.values(game.pve?.cups ?? {}), ...(game.pve?.cupHistory ?? [])].filter(run => !!run)
  const unique = new Map(runs.map(run => [`${run.cupId}:${run.seasonIndex}`, run]))
  if (!unique.size) return ''
  const labels: Record<string, string> = { active: '旧版赛程已关闭', champion: '已夺冠', eliminated: '已淘汰', void: '已归档' }
  const rows = [...unique.values()].sort((a, b) => b.seasonIndex - a.seasonIndex).map(run => {
    const name = CUP_DEFS.find(def => def.id === run.cupId)?.name ?? run.cupId
    const fixtures = [...(run.groups ?? []).flatMap(group => group.fixtures ?? []), ...(run.rounds ?? []).flatMap(round => round.ties.flatMap(tie => tie.legs))].filter(fixture => fixture.played && fixture.score)
    return `<details><summary>第 ${run.seasonIndex} 赛季 · ${esc(name)} · ${esc(labels[run.status] ?? run.status)}</summary><div class="rows">${fixtures.map(fixture => `<div class="row-line"><span>${esc(fixture.homeId === 'player' ? game.clubName : run.participants[fixture.homeId]?.name ?? fixture.homeId)} ${fixture.score!.home} : ${fixture.score!.away} ${esc(fixture.awayId === 'player' ? game.clubName : run.participants[fixture.awayId]?.name ?? fixture.awayId)}</span></div>`).join('') || '<p class="hint pad">没有已保存的比赛。</p>'}</div></details>`
  }).join('')
  return panel('旧版挑战杯历史', `<p class="hint pad">旧赛程已关闭，已获得的奖杯和奖励保留。</p>${rows}`, { flush: true })
}

/** 独立杯赛页只读取服务器已公布的签表和统计，不模拟或报名。 */
export function renderSeasonCups(game: GameState, selected: SeasonCupId = 'community'): string {
  const heading = pageHead({ kicker: `第 ${game.season.index} 赛季 · 正式赛事`, title: '杯赛', sub: '每场 18:00 开赛，杯赛日当晚联赛顺延至 22:00。赛前 30 分钟锁阵，杯赛消耗体能并产生伤病。' })
  if (game.world?.seasonCupMode !== 1) return heading + panel('赛季杯赛', '<p class="hint pad">正式赛季杯赛目前仅在联机共享世界开放。</p>', { flush: true })
  const season = game.world.seasonCups
  if (!season || season.seasonIndex !== game.season.index) return heading + panel('赛季杯赛', '<p class="hint pad">第 6 轮结束后确定参赛资格；赛程将在确认后公布。</p>', { flush: true }) + legacyHistory(game)
  const ownId = game.world.clubs.find(club => club.id === 'player')?.squadKey ?? 'player'
  const cup = season.cups.find(item => item.id === selected) ?? season.cups[0]
  if (!cup) return heading + emptyState('暂无杯赛。')
  const tabs = `<nav class="seg sc-tabs" aria-label="选择杯赛">${CUP_ORDER.map(id => `<button data-season-cup-tab="${id}" class="${id === cup.id ? 'active' : ''}" aria-pressed="${id === cup.id}">${esc(SEASON_CUP_NAMES[id])}</button>`).join('')}</nav>`
  const entered = cup.entrants.includes(ownId)
  const ownMatches = cup.rounds.flatMap(round => round.fixtures).filter(fixture => fixture.homeId === ownId || fixture.awayId === ownId)
  const eliminated = ownMatches.some(fixture => fixture.played && fixture.winnerId !== ownId)
  const status = cup.championId === ownId ? '冠军' : !entered ? '未获得资格' : eliminated ? '已淘汰' : cup.championId ? '已结束' : '参赛中'
  const reward = SEASON_CUP_REWARDS[cup.id]
  const summary = `<div class="sc-summary"><span>状态：<b>${esc(status)}</b></span><span>参赛球队：<b>${cup.entrants.length}</b></span><span>每场参赛金：<b>${reward.appearance.toLocaleString()}</b></span><span>冠军额外金币：<b>${reward.champion.toLocaleString()}</b></span><span>首次夺冠主属性上限：<b>+${reward.ceiling}</b></span></div><p class="hint pad">每场参赛双方均获金币，轮空不发；同名旧挑战杯已获得的上限加成不重复发放。排行只统计已公布且已记录的数据。</p>`
  const board = bracketPanel(game, cup, ownId, season.drawSeed)
  const leaders = `<div class="grid sc-leader-grid">${leaderPanel(cup, ownId, 'goals', '射手榜', '进球')}${leaderPanel(cup, ownId, 'assists', '助攻榜', '助攻')}${leaderPanel(cup, ownId, 'shots', '射门榜', '射门')}${leaderPanel(cup, ownId, 'tackles', '抢断榜', '抢断')}${leaderPanel(cup, ownId, 'saves', '扑救榜', '扑救')}</div>`
  return `${heading}${tabs}${summary}${board}<h2>比赛数据排行</h2>${leaders}${legacyHistory(game)}`
}
