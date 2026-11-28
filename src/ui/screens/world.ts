import { divisionHonorFor, divisionLeaders, hasDualD1, promotionSpotCount, worldDivisionLabel, worldTierLabel } from '../../game/world.ts'
import { latestPlayedRound } from '../../game/standings-history.ts'
import { leaderPanels } from '../leaderboard.ts'
import { renderClubRankTrendPanel } from '../rank-chart.ts'
import { inPostseason, nextSeasonCountdown, PLAYER_TEAM_ID } from '../../game/season.ts'
import { publicWorld, onlineState } from '../../online.ts'
import { clubRosterPanel, divisionRatings, publicClubFor } from '../club-view.ts'
import { clubLook, crest, emptyState, fixtureRow, humanMark, icon, leagueTable, pageHead, panel, styledClubName, tag } from '../components.ts'
import { esc } from '../format.ts'
import { conferenceLabel, conferenceOfDivision } from '../../game/data/world-clubs.ts'
import { game, ui } from '../state.ts'
import type { Fixture, SeasonTableRow, TierId, WorldState } from '../../game/types.ts'

type DivisionTierMeta = { id: string; label: string; note: string; tier: TierId }

function allTierMetas(world: WorldState): DivisionTierMeta[] {
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const extraIds = [
    ...(snapshot?.divisions.map((d) => d.id) ?? []),
    ...world.divisions.map((d) => d.divisionId ?? ''),
  ]
  const dualD1 = extraIds.includes('d1-north') || extraIds.includes('d1-south') || hasDualD1(world)
  const items: DivisionTierMeta[] = [
    { id: 'champions', label: '冠军联赛', note: '20 队 · 顶级 3-4 名真实球星', tier: 'champions' },
    ...(dualD1
      ? [
          { id: 'd1-north', label: '精英联赛 · 群英区', note: '20 队 · 1-2 名真实球星', tier: 'division1' as TierId },
          { id: 'd1-south', label: '精英联赛 · 豪强区', note: '20 队 · 1-2 名真实球星', tier: 'division1' as TierId },
        ]
      : [{ id: 'division1', label: '精英联赛', note: '20 队 · 1-2 名真实球星', tier: 'division1' as TierId }]),
    { id: 'd2-north', label: '先锋联赛 · 北区', note: '20 队 · 无真实球星', tier: 'division2' },
    { id: 'd2-south', label: '先锋联赛 · 南区', note: '20 队 · 无真实球星', tier: 'division2' },
  ]
  const seen = new Set(items.map((item) => item.id))
  for (const id of extraIds) {
    // 快照和账号存档通常包含同一赛区；逐项检查，避免两边的扩展赛区重复渲染。
    if (!id || seen.has(id)) continue
    if (dualD1 && id === 'division1') continue
    seen.add(id)
    const tier: TierId = id === 'champions' ? 'champions' : (id === 'division1' || id.startsWith('d1-')) ? 'division1' : 'division2'
    items.push({
      id,
      label: worldDivisionLabel(world, id),
      note: tier === 'division1' ? '20 队 · 1-2 名真实球星' : '20 队 · 扩展赛区',
      tier,
    })
  }
  return items
}

function tierButton(world: WorldState, item: DivisionTierMeta, activeId: string): string {
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const division = snapshot?.divisions.find((entry) => entry.id === item.id) ?? world.divisions.find((entry) => entry.divisionId === item.id)
  const topScorer = division ? divisionLeaders(division, 'goals', 1)[0] : undefined
  const topAssist = division ? divisionLeaders(division, 'assists', 1)[0] : undefined
  const played = division?.fixtures.filter((fixture) => fixture.played).length ?? 0
  const total = division?.fixtures.length ?? 0
  const leaderId = division?.table[0]?.teamId
  const leader = snapshot?.clubs.find((club) => club.id === leaderId) ?? world.clubs.find((club) => club.id === leaderId)
  const ownId = snapshot?.ownClubId ?? PLAYER_TEAM_ID
  const leaderIsOwn = !!leader && (leader.id === PLAYER_TEAM_ID || leader.id === ownId)
  const leaderName = leader ? (leaderIsOwn ? game.clubName : leader.name) : ''
  const leaderDisplayId = leader ? (leaderIsOwn ? PLAYER_TEAM_ID : leader.id) : undefined
  const mine = world.playerDivisionId === item.id
  return `<button class="tier ${activeId === item.id ? 'active' : ''} ${mine ? 'mine' : ''}" data-world-div="${esc(item.id)}">
    <span class="tier-title"><b>${esc(item.label)}</b>${mine ? tag('你在这里', 'solid') : ''}</span>
    <span class="tier-note">${esc(item.note)}</span>
    <span class="tier-meta"><span>${played} / ${total} 场</span>${leader ? `<span class="club">${crest({ name: leaderName, color: leader.color }, 15)}<span>${styledClubName(leaderDisplayId, leaderName, leaderIsOwn)}${humanMark(leaderDisplayId ?? leader.id)} 领跑</span></span>` : ''}</span>
    ${topScorer || topAssist ? `<span class="tier-leaders">
      ${topScorer ? `<span class="tier-leader"><small>射手</small>${esc(topScorer.name)} <b>${topScorer.goals}</b></span>` : ''}
      ${topAssist ? `<span class="tier-leader"><small>助攻</small>${esc(topAssist.name)} <b>${topAssist.assists}</b></span>` : ''}
    </span>` : ''}
  </button>`
}

function divisionMatchHistoryPanel(
  divisionLabel: string,
  table: SeasonTableRow[],
  fixtures: Fixture[],
  clubLabels: Record<string, { name: string; color: string }> | undefined,
  highlightedClubId: string | null,
): string {
  if (fixtures.length === 0) {
    return panel(`${esc(divisionLabel)} · 历史比赛记录`, emptyState('暂无赛程记录。'), { flush: true })
  }
  const lastRound = fixtures.reduce((max, item) => Math.max(max, item.round), 1)
  const latestRound = latestPlayedRound(fixtures, 1)
  const viewRound = Math.max(1, Math.min(lastRound, ui.worldRound ?? latestRound))
  const validClubFilter = ui.worldFixtureClubId !== 'ALL' && table.some((row) => row.teamId === ui.worldFixtureClubId)
    ? ui.worldFixtureClubId
    : 'ALL'

  const nameOf = (id: string) => clubLabels?.[id]?.name ?? clubLook(id).name
  const clubOptions = [
    `<option value="ALL" ${validClubFilter === 'ALL' ? 'selected' : ''}>全部球队（按轮次）</option>`,
    ...table.map((row, idx) => `<option value="${esc(row.teamId)}" ${validClubFilter === row.teamId ? 'selected' : ''}>#${idx + 1} ${esc(nameOf(row.teamId))}</option>`),
  ].join('')

  if (validClubFilter !== 'ALL') {
    const clubMatches = fixtures
      .filter((fx) => fx.homeId === validClubFilter || fx.awayId === validClubFilter)
      .sort((a, b) => a.round - b.round)
    const playedMatches = clubMatches.filter((fx) => fx.played && fx.score).reverse()
    let won = 0
    let drawn = 0
    let lost = 0
    for (const fx of playedMatches) {
      const home = fx.homeId === validClubFilter
      const mine = home ? fx.score!.home : fx.score!.away
      const theirs = home ? fx.score!.away : fx.score!.home
      if (mine > theirs) won++
      else if (mine < theirs) lost++
      else drawn++
    }
    const listHtml = playedMatches.length > 0
      ? `<div class="fx-list world-fx-scroll">${playedMatches.map((fx) => fixtureRow(fx, { highlightTeamId: validClubFilter, showRound: true })).join('')}</div>`
      : `<div class="fx-list">${clubMatches.slice(0, 6).map((fx) => fixtureRow(fx, { highlightTeamId: validClubFilter, showRound: true })).join('')}</div><p class="hint pad">该球队本赛季尚未产生完赛记录，上方为前 6 轮赛程。</p>`

    return panel(
      `${styledClubName(validClubFilter, nameOf(validClubFilter), validClubFilter === PLAYER_TEAM_ID)} · 联赛比赛记录`,
      `<div class="world-fx-bar">
        <select class="world-fx-select" data-world-fx-club aria-label="按球队筛选比赛记录">${clubOptions}</select>
        <span class="muted small">已完赛 ${playedMatches.length} 场 · ${won}胜 ${drawn}平 ${lost}负</span>
      </div>
      ${listHtml}`,
      {
        flush: true,
        aside: `<button type="button" class="btn small ghost" data-action="world-filter-club" data-club="ALL">按轮次浏览</button>`,
      },
    )
  }

  const playedCountByRound = new Map<number, { played: number; total: number }>()
  for (const fx of fixtures) {
    const stat = playedCountByRound.get(fx.round) ?? { played: 0, total: 0 }
    stat.total++
    if (fx.played && fx.score) stat.played++
    playedCountByRound.set(fx.round, stat)
  }
  const roundOptions: string[] = []
  for (let r = 1; r <= lastRound; r++) {
    const stat = playedCountByRound.get(r)
    const suffix = !stat || stat.played === 0
      ? ' · 未赛'
      : stat.played >= stat.total
        ? ' · 已完赛'
        : ` · ${stat.played}/${stat.total}`
    roundOptions.push(`<option value="${r}" ${r === viewRound ? 'selected' : ''}>第 ${r} 轮${suffix}</option>`)
  }
  const roundFixtures = fixtures.filter((fx) => fx.round === viewRound)
  const roundStat = playedCountByRound.get(viewRound)
  const statusTag = roundStat && roundStat.played > 0
    ? tag(roundStat.played >= roundStat.total ? '已完赛' : `进行中 ${roundStat.played}/${roundStat.total}`, roundStat.played >= roundStat.total ? 'good' : 'gold')
    : tag('未开赛')

  return panel(
    `历史比赛记录 · 第 ${viewRound} 轮`,
    `<div class="world-fx-bar">
      <select class="world-fx-select" data-world-round aria-label="选择轮次">${roundOptions.join('')}</select>
      <select class="world-fx-select" data-world-fx-club aria-label="按球队筛选比赛记录">${clubOptions}</select>
      ${statusTag}
    </div>
    <div class="fx-list">${roundFixtures.map((fx) => fixtureRow(fx, { highlightTeamId: highlightedClubId })).join('') || emptyState('本轮没有比赛。')}</div>`,
    {
      flush: true,
      aside: `<div class="pager-inline">
        <button type="button" class="btn small ghost" data-action="world-round" data-delta="-1" ${viewRound <= 1 ? 'disabled' : ''} aria-label="上一轮">${icon('left', 13)}</button>
        ${viewRound !== latestRound ? '<button type="button" class="btn small ghost" data-action="world-round" data-delta="0">最新赛果</button>' : ''}
        <button type="button" class="btn small ghost" data-action="world-round" data-delta="1" ${viewRound >= lastRound ? 'disabled' : ''} aria-label="下一轮">${icon('right', 13)}</button>
      </div>`,
    },
  )
}

export function renderWorld(): string {
  if (!game.world) {
    return pageHead({
      kicker: '世界',
      title: '旧存档',
      sub: onlineState.status === 'online' ? '当前联机存档没有世界数据。' : '当前存档使用旧的单级联赛；开始新游戏即可进入三级共享世界。',
      actions: onlineState.status === 'online' ? '' : '<button class="btn primary" data-action="new-game">开始三级世界</button>',
    })
  }
  const world = game.world
  const tiers = allTierMetas(world)
  const d1Tiers = tiers.filter((item) => item.tier === 'division1')
  const d2Tiers = tiers.filter((item) => item.tier === 'division2')
  const dualD1 = d1Tiers.length >= 2
  const promoSpots = promotionSpotCount(world)
  const playerClub = world.clubs.find((club) => club.id === PLAYER_TEAM_ID)
  const activeId = ui.worldDivision && tiers.some((item) => item.id === ui.worldDivision) ? ui.worldDivision : world.playerDivisionId
  const active = tiers.find((item) => item.id === activeId) ?? tiers[0]
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const division = snapshot?.divisions.find((item) => item.id === active.id) ?? world.divisions.find((item) => item.divisionId === active.id)
  const ownId = snapshot?.ownClubId ?? PLAYER_TEAM_ID
  const visibleTable = division?.table.map((row) => ({ ...row, teamId: row.teamId === ownId ? PLAYER_TEAM_ID : row.teamId })) ?? []
  const visibleFixtures = division?.fixtures.map((fixture) => ({
    ...fixture,
    homeId: fixture.homeId === ownId ? PLAYER_TEAM_ID : fixture.homeId,
    awayId: fixture.awayId === ownId ? PLAYER_TEAM_ID : fixture.awayId,
    isPlayer: fixture.homeId === ownId || fixture.awayId === ownId || fixture.isPlayer,
  })) ?? []
  const clubLabels = snapshot
    ? Object.fromEntries(snapshot.clubs.map((club) => [club.id === ownId ? PLAYER_TEAM_ID : club.id, { name: club.id === ownId ? game.clubName : club.name, color: club.color }]))
    : undefined
  const selectedClub = ui.worldClubId ? publicClubFor(world, ui.worldClubId) : null
  const normalizedSelectedId = selectedClub ? (selectedClub.id === ownId ? PLAYER_TEAM_ID : selectedClub.id) : null
  const activeDivLabel = worldDivisionLabel(world, active.id)
  const playoff = world.promotionPlayoff ?? world.lastPromotionPlayoff
  const clubLabel = (id: string) => (id === PLAYER_TEAM_ID || id === playerClub?.squadKey || id === ownId ? game.clubName : snapshot?.clubs.find((c) => c.id === id)?.name ?? world.clubs.find((club) => club.id === id)?.name ?? id)
  const selectedInActiveDiv = !!normalizedSelectedId && visibleTable.some((row) => row.teamId === normalizedSelectedId)

  const d2Summary = d2Tiers.length <= 2
    ? '南北两区'
    : d2Tiers.length <= 5
      ? d2Tiers.map((item) => conferenceLabel(conferenceOfDivision(item.id))).filter(Boolean).join(' / ')
      : '多个赛区'

  return `
    ${pageHead({
      kicker: `赛季 ${snapshot?.seasonIndex ?? world.seasonIndex} · ${snapshot?.clubs.length ?? world.clubs.length} 支球队`,
      title: '三级共享世界',
      sub: `冠军联赛 / 精英联赛${dualD1 ? '（群英 / 豪强双区）' : ''} / 先锋联赛（${d2Summary}）。当前执教：<b>${styledClubName(PLAYER_TEAM_ID, game.clubName, true)}</b> · ${worldTierLabel(playerClub?.tier ?? 'division2')}${playerClub?.conference ? ` · ${conferenceLabel(playerClub.conference, playerClub.tier)}` : ''}。`,
      actions: `${onlineState.status === 'online' ? '' : '<button class="btn" data-action="new-game">开始本地新游戏</button>'}`,
    })}
    ${inPostseason(game) ? `<div class="banner info">${icon('clock', 18)}<b>赛后休整 · 还剩 ${esc(nextSeasonCountdown(game))}</b><span>升级杯正在进行；所有球队都可以约友谊赛，赛季将在休整窗口结束后自动开始。</span></div>` : ''}
    <div class="pyramid">
      <div class="pyramid-level l1">${tierButton(world, tiers[0], activeId)}</div>
      <div class="pyramid-level l2${dualD1 ? ' dual' : ''}">${d1Tiers.map((item) => tierButton(world, item, activeId)).join('')}</div>
      <div class="pyramid-level l3">${d2Tiers.map((item) => tierButton(world, item, activeId)).join('')}</div>
    </div>
    <div class="grid season-grid">
      ${panel(esc(activeDivLabel), division ? leagueTable(visibleTable, { tier: active.tier, fixtures: visibleFixtures, browseClubs: true, clubLabels, ratings: divisionRatings(world, visibleTable.map((row) => row.teamId)) }) : '<p class="muted pad">当前联赛不存在。</p>', { flush: true, aside: `<span class="muted small">点击球队查看排名走势与球员名单 · ${esc(active.note)}</span>` })}
      <div class="dash-col">
        ${divisionMatchHistoryPanel(activeDivLabel, visibleTable, visibleFixtures, clubLabels, normalizedSelectedId)}
        ${leaderPanels(division, { limit: 5 })}
        ${panel('升降级', `
          <ul class="rule-list">
            ${dualD1
              ? `<li>${icon('flag', 13)}精英联赛双区（群英区 / 豪强区）第 1 名直接升入冠军联赛，两区第 2 名按积分/净胜球/进球比较，成绩更好者拿到第 3 个升级名额；冠军联赛后三降入精英联赛。</li>
                 <li>${icon('flag', 13)}精英联赛双区各自后三名（共 6 队）降入先锋联赛。</li>`
              : `<li>${icon('flag', 13)}精英联赛前三升入冠军联赛；冠军联赛后三降入精英联赛。</li>
                 <li>${icon('flag', 13)}精英联赛后三降入先锋联赛。${promoSpots === 6 ? '（下赛季起精英联赛扩编为群英 / 豪强双区，本季先锋升 6 队）' : ''}</li>`}
            ${promoSpots === 6
              ? `<li>${icon('flag', 13)}先锋升级杯（6 席方案）：首轮资格赛决出 12 强，分 A / B / C 3 个 4 队小组踢 3 轮单循环；各组第 1 直接升级（3 队），3 场跨组附加赛（A2vB3、B2vC3、C2vA3）胜者升级（3 队），共 6 队升入精英联赛。</li>`
              : `<li>${icon('flag', 13)}先锋每个赛区的前 3 名进入升级杯：各区第 1 轮空，2/3 名先加赛一轮；出线球队与轮空球队随机分成两组踢单循环，小组第一直接升级，两个小组第二附加赛决出第 3 个升级名额。</li>`}
          </ul>
          ${playoff
            ? `<p class="small">升级杯${playoff.finished ? '已完赛，升级球队' : '进行中，已锁定升级'}：${playoff.promoted.map((id) => styledClubName(id === ownId || id === playerClub?.squadKey ? PLAYER_TEAM_ID : id, clubLabel(id), clubLabel(id) === game.clubName)).join('、') || '待决出'}</p>`
            : '<p class="hint">常规赛结束后留 16 小时休整踢升级杯，期间可以安排友谊赛。</p>'}
          ${world.seasonCupMode === 1 ? `<div class="btn-row" style="margin-top:8px"><button class="btn small" data-action="go-cup" data-cup="promotion">${icon('flag', 13)} 查看升级杯赛程与分组</button></div>` : ''}
        `)}
        ${(() => {
          if (!world.history.length) return ''
          const divHonors = world.history
            .slice()
            .reverse()
            .map((item) => ({ seasonIndex: item.seasonIndex, honor: divisionHonorFor(world, item, active.id) }))
            .filter((entry): entry is { seasonIndex: number; honor: NonNullable<typeof entry.honor> } => entry.honor !== null)
            .slice(0, 5)
          const honorBody = divHonors.length
            ? `<div class="rows">${divHonors.map(({ seasonIndex, honor }) => {
                const isOwn = !!honor.championId
                  ? (honor.championId === PLAYER_TEAM_ID || honor.championId === ownId || honor.championId === playerClub?.squadKey)
                  : honor.champion === game.clubName
                const champName = isOwn
                  ? game.clubName
                  : (honor.championId ? clubLabel(honor.championId) : honor.champion) || honor.champion
                const champDisplayId = isOwn ? PLAYER_TEAM_ID : honor.championId
                return `<div class="row-line"><span class="dim">第 ${seasonIndex} 赛季</span><span>冠军 ${styledClubName(champDisplayId, champName, isOwn)}</span></div>`
              }).join('')}</div>`
            : '<p class="muted pad">本联赛暂无历届荣誉记录。</p>'
          return panel(`历届荣誉 · ${esc(activeDivLabel)}`, honorBody, { flush: true })
        })()}
      </div>
    </div>
    ${selectedClub ? `<div id="world-roster" class="world-club-detail">
      ${renderClubRankTrendPanel(selectedClub.id, {
        extraAside: selectedInActiveDiv && normalizedSelectedId
          ? `<button type="button" class="btn small ghost" data-action="world-filter-club" data-club="${esc(normalizedSelectedId)}">查看该队比赛记录</button>`
          : '',
      })}
      ${clubRosterPanel(selectedClub, ui.worldPlayerId)}
    </div>` : '<p class="hint">点击积分榜或比赛记录中的任意球队，即可查看该队本赛季排名变化折线图、球员名单与属性。</p>'}
  `
}
