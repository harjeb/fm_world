import type { GameState } from '../game/types.ts'
import { LEGEND_GROUP_ROUNDS, SEASON_CUP_NAMES, previousChampionsTop4, type SeasonCup, type SeasonCupId } from '../game/season-cups.ts'
import { LEGEND_CUP_META } from '../game/data/legend-cup-teams.ts'
import { SEASON_CUP_REWARDS } from '../game/data/season-cup-rewards.ts'
import { seasonCupLeaders, type CupLeaderKind } from '../game/season-cup-stats.ts'
import { CUP_DEFS } from '../game/data/cup-config.ts'
import { buildSeasonCupBracket, type CupBracketNode } from './season-cup-bracket.ts'
import { clubName, emptyState, pageHead, panel, tag } from './components.ts'
import { cupRoundLabel, esc, kickoffTimeLabel } from './format.ts'

const CUP_ORDER: SeasonCupId[] = ['community', 'league', 'champions', 'cross', 'legend']

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
  const summary = `<div class="sc-summary"><span>状态：<b>${prevTop4.length === 4 ? '第 5 轮后开赛（至赛季末）' : '下赛季开启'}</b></span><span>赛制：<b>4 组 × 4 队小组赛 + 8 强主客场淘汰赛（决赛单场）</b></span><span>淘汰赛每轮参赛金：<b>${reward.appearance.toLocaleString()}（小组赛不发奖金）</b></span><span>冠军额外金币：<b>${reward.champion.toLocaleString()}</b></span><span>首次夺冠专属奖励：${tag('彩书 · 传奇之星', 'skill-rainbow')}</span></div>
    <p class="hint pad">冠军联赛每赛季最终前 4 名获得下赛季传奇杯资格，与真实足球史上最强的 12 支传奇俱乐部（一俱乐部一支，首发 CA 1300–1600）分入 4 个小组（每组 1 支联赛队 + 3 支历史豪门）踢单循环小组赛；赛程从第 5 轮起一直延续到赛季结束（决赛在赛季收官休整期压轴进行），小组赛允许平局且不发奖金，各组前 2 名晋级 8 强（1/4 决赛与半决赛主客场两回合、决赛单场，淘汰赛每轮发放一次参赛金）。传奇杯首次夺冠不叠加属性上限，改为发放唯一彩书《传奇之星》：培养前带入书槽即全程生效（不占实战技能槽），每次常规行动 10% 概率触发彩色事件，从 2 项随机未满主属性中二选一 +100（每轮最多 3 次）。</p>`
  const rosterTable = panel('特邀 12 支历史最强俱乐部（点击查看阵容）', `<div class="table-scroll"><table class="dt"><thead><tr><th class="num">#</th><th>俱乐部</th><th>主教练</th><th class="num">首发 CA</th><th>历史成就</th></tr></thead><tbody>${legendRows}</tbody></table></div>`, { flush: true })
  return `${summary}${panel(qualifierTitle, qualifierHtml, { flush: true })}${rosterTable}`
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

/** 独立杯赛页只读取服务器已公布的签表和统计，不模拟或报名。 */
export function renderSeasonCups(game: GameState, selected: SeasonCupId = 'community'): string {
  const heading = pageHead({ kicker: `第 ${game.season.index} 赛季 · 正式赛事`, title: '杯赛', sub: '在北京时间 12:00 / 20:00（5 项赛事并行季启用 16:00，必要时补 08:00）加赛，联赛固定走每天 6 轮不顺延。赛前 30 分钟锁阵，杯赛消耗体能并产生伤病。' })
  if (game.world?.seasonCupMode !== 1) return heading + panel('赛季杯赛', '<p class="hint pad">正式赛季杯赛目前仅在联机共享世界开放。</p>', { flush: true })
  const season = game.world.seasonCups
  const ownId = game.world.clubs.find(club => club.id === 'player')?.squadKey ?? 'player'
  if (!season || season.seasonIndex !== game.season.index) {
    const tabs = `<nav class="seg sc-tabs" aria-label="选择杯赛">${CUP_ORDER.map(id => `<button data-season-cup-tab="${id}" class="${id === selected ? 'active' : ''}" aria-pressed="${id === selected}">${esc(SEASON_CUP_NAMES[id])}</button>`).join('')}</nav>`
    const body = selected === 'legend'
      ? legendPreview(game, ownId)
      : panel('赛季杯赛', '<p class="hint pad">第 6 轮结束后确定参赛资格；赛程将在确认后公布。</p>', { flush: true })
    return heading + tabs + body + legacyHistory(game)
  }
  const cup = season.cups.find(item => item.id === selected)
  const activeTab: SeasonCupId = cup?.id ?? selected
  const tabs = `<nav class="seg sc-tabs" aria-label="选择杯赛">${CUP_ORDER.map(id => `<button data-season-cup-tab="${id}" class="${id === activeTab ? 'active' : ''}" aria-pressed="${id === activeTab}">${esc(SEASON_CUP_NAMES[id])}</button>`).join('')}</nav>`
  if (!cup) {
    if (selected === 'legend') return `${heading}${tabs}${legendPreview(game, ownId)}${legacyHistory(game)}`
    const hasLegend = season.cups.some(item => item.id === 'legend')
    const waitNote = hasLegend
      ? '第 6 轮结束后确定参赛资格；赛程将在确认后公布。传奇杯已提前开赛，可切换到「传奇杯」查看。'
      : '第 6 轮结束后确定参赛资格；赛程将在确认后公布。'
    return `${heading}${tabs}${panel(SEASON_CUP_NAMES[selected], `<p class="hint pad">${waitNote}</p>`, { flush: true })}${legacyHistory(game)}`
  }
  const status = cupStatusLabel(cup, ownId)
  const reward = SEASON_CUP_REWARDS[cup.id]
  const hasGroups = !!cup.groups?.length
  const appearanceLabel = hasGroups ? '淘汰赛每轮参赛金' : '每场参赛金'
  const appearanceText = hasGroups ? `${reward.appearance.toLocaleString()}（小组赛不发奖金）` : reward.appearance.toLocaleString()
  const noteText = hasGroups
    ? `小组赛（${LEGEND_GROUP_ROUNDS} 轮单循环）不发参赛奖金；晋级 8 强后 1/4 决赛与半决赛踢主客场两回合、决赛单场决胜，淘汰赛每轮发放一次参赛金；冠军另获额外奖金，首次夺冠发放唯一彩书《传奇之星》（带入培养书槽即生效、不占实战技能槽，每次行动 10% 触发彩色事件随机 2 项未满主属性二选一 +100，每轮最多 3 次）。`
    : '每场参赛双方均获金币，轮空不发；各项杯赛的俱乐部主属性上限仅取已获冠军中的最高值（不叠加），同名旧挑战杯不重复计算。排行只统计已公布且已记录的数据。'
  const championSpecial = reward.book
    ? `<span>首次夺冠专属奖励：${tag('彩书 · 传奇之星', 'skill-rainbow')}</span>`
    : `<span>奖杯主属性上限：<b>+${reward.ceiling}（多杯取最高，不叠加）</b></span>`
  const summary = `<div class="sc-summary"><span>状态：<b>${esc(status)}</b></span><span>参赛球队：<b>${cup.entrants.length}</b></span><span>${appearanceLabel}：<b>${appearanceText}</b></span><span>冠军额外金币：<b>${reward.champion.toLocaleString()}</b></span>${championSpecial}</div><p class="hint pad">${noteText}</p>`
  const groupStage = hasGroups ? groupStagePanel(game, cup, ownId) : ''
  const board = bracketPanel(game, cup, ownId, season.drawSeed)
  const leaders = `<div class="grid sc-leader-grid">${leaderPanel(cup, ownId, 'goals', '射手榜', '进球')}${leaderPanel(cup, ownId, 'assists', '助攻榜', '助攻')}${leaderPanel(cup, ownId, 'shots', '射门榜', '射门')}${leaderPanel(cup, ownId, 'tackles', '抢断榜', '抢断')}${leaderPanel(cup, ownId, 'saves', '扑救榜', '扑救')}</div>`
  return `${heading}${tabs}${summary}${groupStage}${board}<h2>比赛数据排行</h2>${leaders}${legacyHistory(game)}`
}
