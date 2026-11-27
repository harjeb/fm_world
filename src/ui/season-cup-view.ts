import type { GameState } from '../game/types.ts'
import { LEGEND_GROUP_ROUNDS, SEASON_CUP_NAMES, previousChampionsTop4, promotionCupQualifiers, seasonCupChampions, type SeasonCup, type SeasonCupId } from '../game/season-cups.ts'
import { promotionSpotCount } from '../game/world.ts'
import { LEGEND_CUP_META } from '../game/data/legend-cup-teams.ts'
import { SEASON_CUP_REWARDS } from '../game/data/season-cup-rewards.ts'
import { seasonCupLeaders, type CupLeaderKind } from '../game/season-cup-stats.ts'
import { CUP_DEFS } from '../game/data/cup-config.ts'
import { buildSeasonCupBracket, type CupBracketNode } from './season-cup-bracket.ts'
import { assetUrl, bookTitle, clubName, emptyState, pageHead, panel, tag, trophyImage } from './components.ts'
import { cupRoundLabel, esc, kickoffTimeLabel } from './format.ts'

const CUP_ORDER: SeasonCupId[] = ['community', 'league', 'champions', 'cross', 'legend', 'promotion']

function displayId(id: string, ownId: string): string { return id === ownId ? 'player' : id }
function nodeWinner(node: CupBracketNode): string | undefined {
  if (node.byeTeam) return node.byeTeam
  if (node.leg2Round) return node.leg2?.played ? node.leg2.winnerId : undefined
  return node.fixture?.played ? node.fixture.winnerId : undefined
}
function goalsForTeam(teamId: string | undefined, fixture?: SeasonCup['rounds'][number]['fixtures'][number]): number {
  if (!teamId || !fixture?.played || !fixture.score) return 0
  if (fixture.homeId === teamId) return fixture.score.home
  if (fixture.awayId === teamId) return fixture.score.away
  return 0
}
function teamCell(id: string | undefined, ownId: string, placeholder: string, score?: number, won = false): string {
  return `<div class="sc-team${won ? ' is-winner' : ''}">${id ? clubName(displayId(id, ownId), 17) : `<span class="sc-pending">${esc(placeholder)}</span>`}${score !== undefined ? `<b class="sc-score">${score}</b>` : ''}</div>`
}
function bracketCard(game: GameState, cup: SeasonCup, node: CupBracketNode, ownId: string): string {
  if (node.leg2Round) {
    const leg1 = node.leg1
    const leg2 = node.leg2
    // 叶子节点（8 强）上方显示小组头名（首回合客、次回合主），子节点汇聚轮次（半决赛）按上下半区顺序显示
    const top = node.children ? (leg1?.homeId ?? nodeWinner(node.children[0])) : (leg2?.homeId ?? leg1?.awayId)
    const bot = node.children ? (leg1?.awayId ?? nodeWinner(node.children[1])) : (leg2?.awayId ?? leg1?.homeId)
    const hasScore = !!(leg1?.played || leg2?.played)
    const topAgg = hasScore ? goalsForTeam(top, leg1) + goalsForTeam(top, leg2) : undefined
    const botAgg = hasScore ? goalsForTeam(bot, leg1) + goalsForTeam(bot, leg2) : undefined
    const winnerId = leg2?.played ? leg2.winnerId : undefined
    const shootout = leg2?.played && leg2.shootout && top
      ? (leg2.homeId === top ? leg2.shootout : { home: leg2.shootout.away, away: leg2.shootout.home })
      : undefined
    const legLine = (label: string, date: number | undefined, fx: SeasonCup['rounds'][number]['fixtures'][number] | undefined) => {
      const replay = fx?.matchId && game.challengeHistory.some(record => record.id === fx.matchId)
      const scoreText = fx?.played && fx.score && top && bot ? `${goalsForTeam(top, fx)}:${goalsForTeam(bot, fx)}` : date ? kickoffTimeLabel(date) : '待定'
      return `<div class="sc-card-extra sc-leg-line"><span>${esc(label)}</span><span class="num-text">${esc(scoreText)}</span>${replay ? `<button class="link" data-action="open-review" data-record="${esc(fx!.matchId!)}">战报</button>` : ''}</div>`
    }
    return `<article class="sc-card sc-two-leg" data-cup-node="${esc(node.id)}"><header><span>${esc(node.tieTitle ?? '两回合淘汰赛')}</span><time>${hasScore ? '总比分' : esc(kickoffTimeLabel(cup.dates[node.round - 1]))}</time></header>
      ${teamCell(top, ownId, node.homePlaceholder ?? '前轮胜者待定', topAgg, !!winnerId && winnerId === top)}
      ${teamCell(bot, ownId, node.awayPlaceholder ?? '前轮胜者待定', botAgg, !!winnerId && winnerId === bot)}
      ${legLine('首回合', cup.dates[node.round - 1], leg1)}
      ${legLine('次回合', cup.dates[node.leg2Round - 1], leg2)}
      ${shootout ? `<div class="sc-card-extra">点球 ${shootout.home} : ${shootout.away}</div>` : ''}</article>`
  }
  const fixture = node.fixture
  const home = fixture?.homeId ?? (node.children ? nodeWinner(node.children[0]) : node.byeTeam)
  const away = fixture?.awayId ?? (node.children ? nodeWinner(node.children[1]) : undefined)
  const score = fixture?.played ? fixture.score : undefined
  const replay = fixture?.matchId && game.challengeHistory.some(record => record.id === fixture.matchId)
  const bye = !!node.byeTeam
  const title = node.tieTitle ?? cupRoundLabel(node.round, cup.dates.length, !cup.groups?.length && (cup.rounds[0]?.byes.length ?? 0) > 0, 'knockout')
  return `<article class="sc-card${bye ? ' sc-bye' : ''}" data-cup-node="${esc(node.id)}"><header><span>${esc(title)}</span><time>${esc(kickoffTimeLabel(cup.dates[node.round - 1]))}</time></header>
    ${teamCell(home, ownId, node.homePlaceholder ?? '前轮胜者待定', score?.home, !!fixture?.winnerId && fixture.winnerId === home)}
    ${bye ? '<div class="sc-bye-label">轮空 · 直接晋级</div>' : teamCell(away, ownId, node.awayPlaceholder ?? '前轮胜者待定', score?.away, !!fixture?.winnerId && fixture.winnerId === away)}
    ${fixture?.shootout ? `<div class="sc-card-extra">点球 ${fixture.shootout.home} : ${fixture.shootout.away}</div>` : ''}
    ${replay ? `<button class="link sc-card-extra" data-action="open-review" data-record="${esc(fixture!.matchId)}">查看战报</button>` : ''}</article>`
}
function renderBranch(game: GameState, cup: SeasonCup, node: CupBracketNode, ownId: string): string {
  const card = bracketCard(game, cup, node, ownId)
  if (!node.children) return card
  return `<div class="sc-branch"><div class="sc-children"><div class="sc-child">${renderBranch(game, cup, node.children[0], ownId)}</div><div class="sc-child">${renderBranch(game, cup, node.children[1], ownId)}</div></div><div class="sc-parent">${card}</div></div>`
}
function fixtureList(cup: SeasonCup, ownId: string): string {
  return cup.rounds.map(round => `<section class="sc-fallback-round"><h3>${esc(cupRoundLabel(round.round, cup.dates.length, !cup.groups?.length && (cup.rounds[0]?.byes.length ?? 0) > 0, round.stage, round.leg))} · ${esc(kickoffTimeLabel(round.kickoffAt))}</h3><div class="rows">${round.byes.map(id => `<div class="row-line">${clubName(displayId(id, ownId), 17)}<span class="muted">轮空</span></div>`).join('')}${round.fixtures.map(fixture => `<div class="row-line">${clubName(displayId(fixture.homeId, ownId), 17)}<b>${fixture.score ? `${fixture.score.home} : ${fixture.score.away}` : 'VS'}</b>${clubName(displayId(fixture.awayId, ownId), 17)}</div>`).join('')}</div></section>`).join('')
}
function groupStagePanel(game: GameState, cup: SeasonCup, ownId: string): string {
  const groups = cup.groups
  if (!groups?.length) return ''
  const groupFixtures = cup.rounds.filter(round => round.stage === 'group').flatMap(round => round.fixtures)
  const cards = groups.map(group => {
    const rowsHtml = group.table.map((row, index) => {
      const gd = row.gf - row.ga
      const isMe = row.teamId === ownId
      return `<tr class="${index < 2 ? 'sc-group-qual' : ''}${isMe ? ' me' : ''}">
        <td class="num">${index + 1}</td>
        <td>${clubName(displayId(row.teamId, ownId), 15)}</td>
        <td class="num">${row.played}</td>
        <td class="num dim">${row.won}-${row.drawn}-${row.lost}</td>
        <td class="num dim">${gd > 0 ? `+${gd}` : gd}</td>
        <td class="num strong">${row.points}</td>
      </tr>`
    }).join('')
    const matches = groupFixtures.filter(fixture => fixture.groupIndex === group.index)
    const fxHtml = matches.map(fixture => {
      const replay = fixture.matchId && game.challengeHistory.some(record => record.id === fixture.matchId)
      return `<div class="sc-group-fx">
        <span class="muted small">第 ${fixture.round} 轮</span>
        <span class="sc-group-fx-pair">${clubName(displayId(fixture.homeId, ownId), 14)} <b class="num-text">${fixture.played && fixture.score ? `${fixture.score.home}:${fixture.score.away}` : 'VS'}</b> ${clubName(displayId(fixture.awayId, ownId), 14)}</span>
        ${replay ? `<button class="link small" data-action="open-review" data-record="${esc(fixture.matchId!)}">战报</button>` : `<time class="muted small">${esc(kickoffTimeLabel(fixture.kickoffAt))}</time>`}
      </div>`
    }).join('')
    return panel(group.name, `<div class="table-scroll"><table class="dt"><thead><tr><th class="num">#</th><th>球队</th><th class="num">赛</th><th class="num">胜平负</th><th class="num">净胜</th><th class="num">分</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${fxHtml ? `<div class="sc-group-fx-list">${fxHtml}</div>` : ''}`, { flush: true, aside: '<span class="muted small">前 2 晋级</span>' })
  }).join('')
  return `<section class="sc-groups-section"><h2>小组赛积分榜与赛果</h2><p class="hint">4 组单循环共 3 轮，常规时间允许平局（胜 3 分 / 平 1 分 / 负 0 分），每组前 2 名晋级 8 强淘汰赛；同分依次比较净胜球、进球数与相互战绩。小组赛不发放参赛奖金。</p><div class="grid sc-groups-grid">${cards}</div></section>`
}
function bracketPanel(game: GameState, cup: SeasonCup, ownId: string, drawSeed: number | undefined): string {
  const root = buildSeasonCupBracket(cup, drawSeed)
  const heading = cup.groups?.length ? '淘汰赛对阵图（8 强 → 决赛）' : '淘汰赛对阵图'
  const hint = cup.groups?.length
    ? '小组赛结束后每组前 2 名落位 8 强（A1vB2、C1vD2、B1vA2、D1vC2）：1/4 决赛与半决赛为主客场两回合（小组第 1 享次回合主场，两回合总比分决胜、不计客场进球加权，总比分战平于次回合点球），决赛单场决胜；淘汰赛每轮发一次参赛金。'
    : '从左至右查看晋级路径；尚未决出的球队显示“待定”，轮空球队直接晋级。'
  const body = root
    ? `<p class="hint pad">${hint}</p><div class="sc-tree-viewport" aria-label="${esc(cup.name)}淘汰赛对阵树"><div class="sc-tree">${renderBranch(game, cup, root, ownId)}</div></div>`
    : `<p class="hint pad">签表来源未完整记录，显示已公布对阵，避免画错晋级路径。</p>${fixtureList(cup, ownId)}`
  return panel(heading, body, { flush: true })
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
    return `<details><summary>第 ${run.seasonIndex} 赛季 · ${esc(name)} · ${esc(labels[run.status] ?? run.status)}</summary><div class="rows">${fixtures.map(fixture => `<div class="row-line"><span>${fixture.homeId === 'player' ? `<span class="own-name">${esc(game.clubName)}</span>` : esc(run.participants[fixture.homeId]?.name ?? fixture.homeId)} ${fixture.score!.home} : ${fixture.score!.away} ${fixture.awayId === 'player' ? `<span class="own-name">${esc(game.clubName)}</span>` : esc(run.participants[fixture.awayId]?.name ?? fixture.awayId)}</span></div>`).join('') || '<p class="hint pad">没有已保存的比赛。</p>'}</div></details>`
  }).join('')
  return panel('旧版挑战杯历史', `<p class="hint pad">旧赛程已关闭，已获得的奖杯和奖励保留。</p>${rows}`, { flush: true })
}

function legendPreview(game: GameState, ownId: string): string {
  const reward = SEASON_CUP_REWARDS.legend
  const prevTop4 = game.world ? previousChampionsTop4(game.world) : []
  const champTable = game.world?.divisions.find(div => div.divisionId === 'champions')?.table ?? []
  const currentTop4 = champTable.slice(0, 4).map(row => row.teamId)
  const qualifierTitle = prevTop4.length === 4 ? '本赛季已获资格（上赛季冠军联赛前 4）' : '下赛季暂定晋级席位（当前冠军联赛前 4）'
  const qualifierIds = prevTop4.length === 4 ? prevTop4 : currentTop4
  const qualifierHtml = qualifierIds.length
    ? `<div class="rows">${qualifierIds.map((id, index) => `<div class="row-line"><span class="rank-no">${index + 1}</span>${clubName(displayId(id, ownId), 17)}</div>`).join('')}</div>`
    : '<p class="hint pad">待冠军联赛积分榜产生前 4 名。</p>'
  const legendRows = LEGEND_CUP_META.map((meta, index) => `<tr>
    <td class="num">${index + 1}</td>
    <td>${clubName(meta.id, 17)}</td>
    <td>${esc(meta.coach)}</td>
    <td class="num strong">${tag(`CA ${meta.targetCa}`, 'gold')}</td>
    <td class="dim">${esc(meta.note)}</td>
  </tr>`).join('')
  const summary = `<div class="sc-summary"><span>状态：<b>${prevTop4.length === 4 ? '第 5 轮后开赛（至赛季末）' : '下赛季开启'}</b></span><span>赛制：<b>4 组 × 4 队小组赛 + 8 强主客场淘汰赛（决赛单场）</b></span><span>淘汰赛每轮参赛金：<b>${reward.appearance.toLocaleString()}（小组赛不发奖金）</b></span><span>冠军额外金币：<b>${reward.champion.toLocaleString()}</b></span><span>首次夺冠专属奖励：${tag('传奇之星', 'skill-rainbow')}</span></div>
    <p class="hint pad">冠军联赛每赛季最终前 4 名获得下赛季传奇杯资格，与真实足球史上最强的 12 支传奇俱乐部（一俱乐部一支，首发 CA 1300–1600）分入 4 个小组（每组 1 支联赛队 + 3 支历史豪门）踢单循环小组赛；赛程从第 5 轮起一直延续到赛季结束（决赛在赛季收官休整期压轴进行），小组赛允许平局且不发奖金，各组前 2 名晋级 8 强（1/4 决赛与半决赛主客场两回合、决赛单场，淘汰赛每轮发放一次参赛金）。传奇杯首次夺冠不叠加属性上限，改为发放专属技能书 ${bookTitle('传奇之星', 'rainbow')}：培养前带入书槽即全程生效（不占实战技能槽），每次常规行动 10% 概率触发彩色事件，从 2 项随机未满主属性中二选一 +100（每轮最多 3 次）。</p>`
  const rosterTable = panel('特邀 12 支历史最强俱乐部（点击查看阵容）', `<div class="table-scroll"><table class="dt"><thead><tr><th class="num">#</th><th>俱乐部</th><th>主教练</th><th class="num">首发 CA</th><th>历史成就</th></tr></thead><tbody>${legendRows}</tbody></table></div>`, { flush: true })
  return `${summary}${panel(qualifierTitle, qualifierHtml, { flush: true })}${rosterTable}`
}

function promotionPreview(game: GameState, ownId: string): string {
  const world = game.world
  const spots = world ? promotionSpotCount(world) : 3
  const qualified = world ? promotionCupQualifiers(world) : { champions: [] as string[], qualifierPairs: [] as [string, string][], entrants: [] as string[] }
  const rows = qualified.entrants.map((id, index) => `<div class="row-line"><span class="rank-no">${index + 1}</span>${clubName(displayId(id, ownId), 17)}<span class="muted small">${qualified.champions.includes(id) ? '直通小组赛（首轮轮空）' : '首轮资格赛'}</span></div>`).join('')
  const formatText = spots === 6
    ? '首轮资格赛决出 12 强 → A/B/C 3 组 × 4 队单循环（3 轮）→ 3 场跨组附加赛（A2vB3 / B2vC3 / C2vA3）'
    : '各区第 2/3 资格赛 → 2 组循环赛 → 小组第 2 附加赛'
  const detailText = spots === 6
    ? '常规赛 38 轮全部结束后进入 16 小时赛后休整期，升级杯共 5 轮自动分轮排期并采用 2D 正式赛直播与战报（赛前 30 分钟锁阵）：首轮资格赛决出 12 支小组赛球队，随机分入 A / B / C 三个 4 队小组踢 3 轮单循环（零轮空）；每组第 1 直接升入精英联赛（3 队），末轮由 3 场跨组附加赛（A2 vs B3、B2 vs C3、C2 vs A3，单场平局点球）再决出 3 队，共 6 队升入精英联赛。'
    : '常规赛 38 轮全部结束后进入 16 小时赛后休整期，升级杯自动分轮排期并采用 2D 正式赛直播与战报（赛前 30 分钟锁阵）：各先锋赛区第 1 名首轮轮空，第 2/3 名踢单场资格赛；晋级队与各区第 1 随机分入 A/B 两组踢单循环，小组第 1 直接升级，两个小组第 2 再战单场附加赛决出第 3 个升级名额。'
  const summary = `<div class="sc-summary"><span>状态：<b>第 38 轮常规赛结束后开赛</b></span><span>赛制：<b>${formatText}</b></span><span>升级名额：<b>共 ${spots} 支球队升入精英联赛</b></span></div>
    <p class="hint pad">${detailText}</p>`
  return `${summary}${panel(`当前暂定升级杯资格（${qualified.entrants.length} 队）`, rows ? `<div class="rows">${rows}</div>` : '<p class="hint pad">等待先锋联赛积分榜更新。</p>', { flush: true })}`
}

function promotionStatusLabel(cup: SeasonCup, ownId: string): string {
  if (cup.promotedIds?.includes(ownId)) return '已升级（升入精英联赛）'
  if (!cup.entrants.includes(ownId)) return '未获得资格'
  if (cup.championId) return '未获升级'
  const current = cup.rounds.at(-1)
  if (!current) return '待开赛'
  if (current.byes.includes(ownId)) return current.round === 1 ? '首轮轮空（直通小组赛）' : '本轮轮空'
  const playing = current.fixtures.some(f => !f.played && (f.homeId === ownId || f.awayId === ownId))
  if (playing) return cupRoundLabel(current.round, cup.dates.length, false, current.stage, current.leg, 'promotion')
  const round1 = cup.rounds[0]
  if (round1?.fixtures.some(f => f.played && (f.homeId === ownId || f.awayId === ownId) && f.winnerId !== ownId)) return '资格赛出局'
  if (cup.groups?.length && current.round > 1 && current.stage === 'knockout') return '小组赛出局'
  return '参赛中'
}

function renderPromotionCup(game: GameState, cup: SeasonCup, ownId: string): string {
  const status = promotionStatusLabel(cup, ownId)
  const r1 = cup.rounds[0]
  const groupCount = cup.groups?.length ?? 0
  const isSixSpot = groupCount >= 3 || ((r1?.byes.length ?? 0) + (r1?.fixtures.length ?? 0) >= 12) || (game.world ? promotionSpotCount(game.world) === 6 : false)
  const spots = isSixSpot ? 6 : 3
  const promoted = cup.promotedIds ?? []
  const promotedHtml = promoted.length
    ? promoted.map(id => clubName(displayId(id, ownId), 15)).join(' · ')
    : '<span class="muted">待决出</span>'
  const scheduleChips = cup.dates.map((date, idx) => {
    const stage = idx === 0 ? 'knockout' : idx === cup.dates.length - 1 ? 'knockout' : 'group'
    const label = cupRoundLabel(idx + 1, cup.dates.length, false, stage, undefined, 'promotion')
    return `<span>${esc(label)}：<b>${esc(kickoffTimeLabel(date))}</b></span>`
  }).join('')
  const summaryNote = isSixSpot
    ? '升级杯在赛后 16 小时休整期内按 5 轮档期自动开赛（赛前 30 分钟锁阵、2D 直播、完整战报进复盘）：首轮资格赛决出 12 强进入小组赛，随机分入 A / B / C 三个 4 队小组踢 3 轮单循环；各组第 1 直接升入精英联赛（3 队），末轮由 3 场跨组附加赛（A2vB3、B2vC3、C2vA3，平局点球）再决出 3 个升级名额，共 6 队升级。'
    : '升级杯在赛后 16 小时休整期内按档期自动开赛（赛前 30 分钟锁阵、2D 直播、完整战报进复盘）：首轮各先锋赛区第 1 名轮空、第 2/3 名踢资格赛（平局点球）；出线队与轮空队分 A/B 两组踢单循环，各组第 1 直接升入精英联赛，两个小组第 2 踢单场附加赛争夺第 3 个升级名额。'
  const summary = `<div class="sc-summary"><span>状态：<b>${esc(status)}</b></span><span>参赛球队：<b>${cup.entrants.length}</b></span><span>已锁定升级（${promoted.length}/${spots}）：<b>${promotedHtml}</b></span></div>
    <div class="sc-summary">${scheduleChips}</div>
    <p class="hint pad">${summaryNote}</p>`

  const fxRow = (fixture: SeasonCup['rounds'][number]['fixtures'][number], prefix = '') => {
    const replay = fixture.matchId && game.challengeHistory.some(record => record.id === fixture.matchId)
    const scoreText = fixture.played && fixture.score
      ? `${fixture.score.home} : ${fixture.score.away}${fixture.shootout ? ` (点 ${fixture.shootout.home}:${fixture.shootout.away})` : ''}`
      : 'VS'
    return `<div class="sc-group-fx">
      ${prefix ? `<span class="muted small">${esc(prefix)}</span>` : ''}
      <span class="sc-group-fx-pair">${clubName(displayId(fixture.homeId, ownId), 15)} <b class="num-text">${esc(scoreText)}</b> ${clubName(displayId(fixture.awayId, ownId), 15)}</span>
      ${replay ? `<button class="link small" data-action="open-review" data-record="${esc(fixture.matchId!)}">查看战报</button>` : `<time class="muted small">${esc(kickoffTimeLabel(fixture.kickoffAt))}</time>`}
    </div>`
  }

  // 1. 首轮资格赛
  const r1Html = r1
    ? `${r1.fixtures.length ? `<div class="sc-group-fx-list">${r1.fixtures.map(f => fxRow(f, '资格赛')).join('')}</div>` : '<p class="hint pad">本季无需资格赛，12 支直通队全部轮空进入小组赛。</p>'}${r1.byes.length ? `<p class="hint pad">首轮轮空（直通小组赛）：${r1.byes.map(id => clubName(displayId(id, ownId), 14)).join('、')}</p>` : ''}`
    : '<p class="hint pad">等待开赛。</p>'
  const qualifierPanel = panel(`第 1 阶段 · 资格赛（${kickoffTimeLabel(cup.dates[0])}）`, r1Html, { flush: true })

  // 2. 小组赛（2 组或 A/B/C 3 组）
  let groupSection = ''
  if (cup.groups?.length) {
    const groupFixtures = cup.rounds.filter(round => round.stage === 'group').flatMap(round => round.fixtures)
    const playoffCutoff = isSixSpot ? 3 : 2
    const groupCards = cup.groups.map(group => {
      const rowsHtml = group.table.map((row, index) => {
        const gd = row.gf - row.ga
        const isMe = row.teamId === ownId
        return `<tr class="${index === 0 ? 'sc-group-qual' : ''}${isMe ? ' me' : ''}">
          <td class="num">${index + 1}</td>
          <td>${clubName(displayId(row.teamId, ownId), 15)}${index === 0 ? ` ${tag('升级区', 'good')}` : index < playoffCutoff ? ` ${tag('附加赛', 'gold')}` : ''}</td>
          <td class="num">${row.played}</td>
          <td class="num dim">${row.won}-${row.drawn}-${row.lost}</td>
          <td class="num dim">${gd > 0 ? `+${gd}` : gd}</td>
          <td class="num strong">${row.points}</td>
        </tr>`
      }).join('')
      const matches = groupFixtures.filter(f => f.groupIndex === group.index)
      const fxHtml = matches.map(f => fxRow(f, `第 ${Math.max(1, f.round - 1)} 轮`)).join('')
      return panel(group.name, `<div class="table-scroll"><table class="dt"><thead><tr><th class="num">#</th><th>球队</th><th class="num">赛</th><th class="num">胜平负</th><th class="num">净胜</th><th class="num">分</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>${fxHtml ? `<div class="sc-group-fx-list">${fxHtml}</div>` : ''}`, { flush: true, aside: `<span class="muted small">${isSixSpot ? '第 1 升级 · 第 2/3 进附加赛' : '第 1 升级 · 第 2 进附加赛'}</span>` })
    }).join('')
    groupSection = `<section class="sc-groups-section"><h2>第 2 阶段 · 小组循环赛</h2><p class="hint">常规时间允许平局（胜 3 分 / 平 1 分 / 负 0 分），同分依次比较净胜球、进球数与相互战绩。每组第 1 直接升入精英联赛，${isSixSpot ? '各组第 2 与第 3 进入最终跨组附加赛。' : '第 2 进入最终附加赛。'}</p><div class="grid sc-groups-grid">${groupCards}</div></section>`
  } else {
    groupSection = panel('第 2 阶段 · 小组循环赛', `<p class="hint pad">资格赛（${esc(kickoffTimeLabel(cup.dates[0]))}）公布结果后，胜者与轮空队自动抽签分成 ${isSixSpot ? 'A / B / C 三组（每组 4 队）' : 'A / B 两组'}，并于 ${esc(kickoffTimeLabel(cup.dates[1]))} 起开踢小组赛。</p>`, { flush: true })
  }

  // 3. 升级附加赛
  const finalRound = cup.groups?.length ? cup.rounds.find(round => round.round > 1 && round.stage === 'knockout') : undefined
  const finalDate = cup.dates[cup.dates.length - 1]
  const finalLabels = isSixSpot ? ['A2 vs B3', 'B2 vs C3', 'C2 vs A3'] : ['附加赛']
  const finalBody = finalRound?.fixtures.length
    ? `<div class="sc-group-fx-list">${finalRound.fixtures.map((f, idx) => fxRow(f, finalLabels[idx] ?? '附加赛')).join('')}</div>`
    : `<p class="hint pad">${isSixSpot ? '3 场跨组单场决胜（A 组第 2 vs B 组第 3、B 组第 2 vs C 组第 3、C 组第 2 vs A 组第 3，平局点球），3 支胜者拿下其余 3 个升级名额' : 'A 组第 2 vs B 组第 2，单场决胜（平局点球），胜者拿下第 3 个升级名额'} · 开球时间 ${esc(kickoffTimeLabel(finalDate))}。</p>`
  const finalPanel = panel(`第 3 阶段 · ${isSixSpot ? '跨组升级附加赛' : '小组第二附加赛'}（${kickoffTimeLabel(finalDate)}）`, finalBody, { flush: true })

  const leaders = `<div class="grid sc-leader-grid">${leaderPanel(cup, ownId, 'goals', '射手榜', '进球')}${leaderPanel(cup, ownId, 'assists', '助攻榜', '助攻')}${leaderPanel(cup, ownId, 'shots', '射门榜', '射门')}${leaderPanel(cup, ownId, 'tackles', '抢断榜', '抢断')}${leaderPanel(cup, ownId, 'saves', '扑救榜', '扑救')}</div>`
  return `${summary}${qualifierPanel}${groupSection}${finalPanel}<h2>比赛数据排行</h2>${leaders}`
}

function cupStatusLabel(cup: SeasonCup, ownId: string): string {
  const entered = cup.entrants.includes(ownId)
  if (cup.championId === ownId) return '冠军'
  if (!entered) return '未获得资格'
  if (cup.groups?.length) {
    const koRounds = cup.rounds.filter(round => round.stage !== 'group')
    if (!koRounds.length) return '小组赛进行中'
    const inKo = koRounds[0].fixtures.some(fixture => fixture.homeId === ownId || fixture.awayId === ownId)
    if (!inKo) return '小组出局'
    // 两回合首回合不淘汰，仅次回合或单场决赛决出胜负后才判定出局
    const koEliminated = koRounds.flatMap(round => round.fixtures).some(fixture => fixture.played && fixture.leg !== 1 && (fixture.homeId === ownId || fixture.awayId === ownId) && fixture.winnerId !== ownId)
    if (koEliminated) return '淘汰赛出局'
    return cup.championId ? '已结束' : '淘汰赛参赛中'
  }
  const ownMatches = cup.rounds.flatMap(round => round.fixtures).filter(fixture => fixture.homeId === ownId || fixture.awayId === ownId)
  const eliminated = ownMatches.some(fixture => fixture.played && fixture.winnerId !== ownId)
  return eliminated ? '已淘汰' : cup.championId ? '已结束' : '参赛中'
}

function cupChampionsHistoryPanel(game: GameState, cupId: SeasonCupId, ownId: string): string {
  if (cupId === 'promotion') return ''
  const champions = seasonCupChampions(game, cupId, ownId)
  const body = champions.length
    ? `<div class="rows">${champions.map((entry) => `<div class="row-line"><span class="dim">第 ${entry.seasonIndex} 赛季</span><span>${clubName(displayId(entry.championId, ownId), 17)}</span></div>`).join('')}</div>`
    : '<p class="muted pad">暂无历届冠军记录。</p>'
  return panel(`历届冠军 · ${SEASON_CUP_NAMES[cupId]}${champions.length ? ` <small>${champions.length}</small>` : ''}`, body, { flush: true })
}

/** 独立杯赛页只读取服务器已公布的签表和统计，不模拟或报名。 */
export function renderSeasonCups(game: GameState, selected: SeasonCupId = 'community'): string {
  const heading = pageHead({
    lead: trophyImage(selected, 54, SEASON_CUP_NAMES[selected]),
    kicker: `第 ${game.season.index} 赛季 · 正式赛事`,
    title: '杯赛',
    sub: '在北京时间 12:00 / 20:00（5 项赛事并行季启用 16:00，必要时补 08:00）加赛，联赛固定走每天 6 轮不顺延。赛前 30 分钟锁阵，杯赛消耗体能并产生伤病。',
    banner: assetUrl('assets/banners/banner-season-cups.webp'),
    bannerPosition: '82% 38%',
    accent: '#f2b84b',
  })
  if (game.world?.seasonCupMode !== 1) return heading + panel('赛季杯赛', '<p class="hint pad">正式赛季杯赛目前仅在联机共享世界开放。</p>', { flush: true })
  const season = game.world.seasonCups
  const ownId = game.world.clubs.find(club => club.id === 'player')?.squadKey ?? 'player'
  if (!season || season.seasonIndex !== game.season.index) {
    const tabs = `<nav class="seg sc-tabs" aria-label="选择杯赛">${CUP_ORDER.map(id => `<button data-season-cup-tab="${id}" class="${id === selected ? 'active' : ''}" aria-pressed="${id === selected}">${esc(SEASON_CUP_NAMES[id])}</button>`).join('')}</nav>`
    const body = selected === 'legend'
      ? legendPreview(game, ownId)
      : selected === 'promotion'
        ? promotionPreview(game, ownId)
        : panel('赛季杯赛', '<p class="hint pad">第 6 轮结束后确定参赛资格；赛程将在确认后公布。</p>', { flush: true })
    return heading + tabs + body + cupChampionsHistoryPanel(game, selected, ownId) + legacyHistory(game)
  }
  const cup = season.cups.find(item => item.id === selected)
  const activeTab: SeasonCupId = cup?.id ?? selected
  const tabs = `<nav class="seg sc-tabs" aria-label="选择杯赛">${CUP_ORDER.map(id => `<button data-season-cup-tab="${id}" class="${id === activeTab ? 'active' : ''}" aria-pressed="${id === activeTab}">${esc(SEASON_CUP_NAMES[id])}</button>`).join('')}</nav>`
  if (!cup) {
    if (selected === 'legend') return `${heading}${tabs}${legendPreview(game, ownId)}${cupChampionsHistoryPanel(game, selected, ownId)}${legacyHistory(game)}`
    if (selected === 'promotion') return `${heading}${tabs}${promotionPreview(game, ownId)}${legacyHistory(game)}`
    const hasLegend = season.cups.some(item => item.id === 'legend')
    const waitNote = hasLegend
      ? '第 6 轮结束后确定参赛资格；赛程将在确认后公布。传奇杯已提前开赛，可切换到「传奇杯」查看。'
      : '第 6 轮结束后确定参赛资格；赛程将在确认后公布。'
    return `${heading}${tabs}${panel(SEASON_CUP_NAMES[selected], `<p class="hint pad">${waitNote}</p>`, { flush: true })}${cupChampionsHistoryPanel(game, selected, ownId)}${legacyHistory(game)}`
  }
  if (cup.id === 'promotion') {
    return `${heading}${tabs}${renderPromotionCup(game, cup, ownId)}${legacyHistory(game)}`
  }
  const status = cupStatusLabel(cup, ownId)
  const reward = SEASON_CUP_REWARDS[cup.id]
  const hasGroups = !!cup.groups?.length
  const appearanceLabel = hasGroups ? '淘汰赛每轮参赛金' : '每场参赛金'
  const appearanceText = hasGroups ? `${reward.appearance.toLocaleString()}（小组赛不发奖金）` : reward.appearance.toLocaleString()
  const d2ZoneCount = game.world.divisions.filter(div => div.tier === 'division2').length
  const communityRule = cup.id === 'community' && d2ZoneCount > 4
    ? `当前先锋联赛共有 ${d2ZoneCount} 个分区（超过 4 区），社区杯自动按全先锋总积分榜（积分→净胜球→进球）取前 32 支球队踢 5 轮单场淘汰赛。`
    : ''
  const noteText = hasGroups
    ? `小组赛（${LEGEND_GROUP_ROUNDS} 轮单循环）不发参赛奖金；晋级 8 强后 1/4 决赛与半决赛踢主客场两回合、决赛单场决胜，淘汰赛每轮发放一次参赛金；冠军另获额外奖金，首次夺冠发放专属技能书 ${bookTitle('传奇之星', 'rainbow')}（带入培养书槽即生效、不占实战技能槽，每次行动 10% 触发彩色事件随机 2 项未满主属性二选一 +100，每轮最多 3 次）。`
    : `${communityRule}每场参赛双方均获金币，轮空不发；各项杯赛的俱乐部主属性上限仅取已获冠军中的最高值（不叠加），同名旧挑战杯不重复计算。排行只统计已公布且已记录的数据。`
  const championSpecial = reward.book
    ? `<span>首次夺冠专属奖励：${tag('传奇之星', 'skill-rainbow')}</span>`
    : `<span>奖杯主属性上限：<b>+${reward.ceiling}（多杯取最高，不叠加）</b></span>`
  const summary = `<div class="sc-summary"><span>状态：<b>${esc(status)}</b></span><span>参赛球队：<b>${cup.entrants.length}</b></span><span>${appearanceLabel}：<b>${appearanceText}</b></span><span>冠军额外金币：<b>${reward.champion.toLocaleString()}</b></span>${championSpecial}</div><p class="hint pad">${noteText}</p>`
  const championsHistory = cupChampionsHistoryPanel(game, cup.id, ownId)
  const groupStage = hasGroups ? groupStagePanel(game, cup, ownId) : ''
  const board = bracketPanel(game, cup, ownId, season.drawSeed)
  const leaders = `<div class="grid sc-leader-grid">${leaderPanel(cup, ownId, 'goals', '射手榜', '进球')}${leaderPanel(cup, ownId, 'assists', '助攻榜', '助攻')}${leaderPanel(cup, ownId, 'shots', '射门榜', '射门')}${leaderPanel(cup, ownId, 'tackles', '抢断榜', '抢断')}${leaderPanel(cup, ownId, 'saves', '扑救榜', '扑救')}</div>`
  return `${heading}${tabs}${summary}${championsHistory}${groupStage}${board}<h2>比赛数据排行</h2>${leaders}${legacyHistory(game)}`
}
