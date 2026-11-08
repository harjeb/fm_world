import { buildOwnerlessTeams, d2ClubChoices, divisionLeaders, worldDivisionLabel, worldTierLabel } from '../../game/world.ts'
import { conferenceLabel } from '../../game/data/world-clubs.ts'
import { gameDateOf, seasonEndAt } from '../../game/calendar.ts'
import { leaderPanels } from '../leaderboard.ts'
import { inPostseason, nextSeasonCountdown } from '../../game/season.ts'
import { ATTR_GROUPS } from '../../game/data/attributes.ts'
import { attrRating, mainAttrsFor } from '../../game/rating.ts'
import { publicWorld, onlineState } from '../../online.ts'
import { clubRosterPanel, divisionRatings, publicClubFor } from '../club-view.ts'
import { PLAYER_TEAM_ID } from '../../game/season.ts'
import { attrHeat, attributeRadar, caHeat, crest, icon, leagueTable, pageHead, panel, posBadge, positionMap, primaryPosition, skillGroups, tag, traitLabel } from '../components.ts'
import { attrLabel, esc, playerCA } from '../format.ts'
import { WORLD_CLUB_DEFS } from '../../game/data/world-clubs.ts'
import { game, ui } from '../state.ts'
import type { TierId, WorldState } from '../../game/types.ts'

const TIERS = [
  { id: 'champions', label: '冠军联赛', note: '20 队 · 顶级 3-4 名真实球星', tier: 'champions' as TierId },
  { id: 'division1', label: '一级联赛', note: '20 队 · 1-2 名真实球星', tier: 'division1' as TierId },
  { id: 'd2-north', label: '二级联赛 · 北区', note: '20 队 · 无真实球星', tier: 'division2' as TierId },
  { id: 'd2-south', label: '二级联赛 · 南区', note: '20 队 · 无真实球星', tier: 'division2' as TierId },
]

function tierButton(world: WorldState, item: (typeof TIERS)[number], activeId: string): string {
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const division = snapshot?.divisions.find((entry) => entry.id === item.id) ?? world.divisions.find((entry) => entry.divisionId === item.id)
  const topScorer = division ? divisionLeaders(division, 'goals', 1)[0] : undefined
  const topAssist = division ? divisionLeaders(division, 'assists', 1)[0] : undefined
  const played = division?.fixtures.filter((fixture) => fixture.played).length ?? 0
  const total = division?.fixtures.length ?? 0
  const leaderId = division?.table[0]?.teamId
  const leader = snapshot?.clubs.find((club) => club.id === leaderId) ?? world.clubs.find((club) => club.id === leaderId)
  const mine = world.playerDivisionId === item.id
  return `<button class="tier ${activeId === item.id ? 'active' : ''} ${mine ? 'mine' : ''}" data-world-div="${item.id}">
    <span class="tier-title"><b>${item.label}</b>${mine ? tag('你在这里', 'solid') : ''}</span>
    <span class="tier-note">${item.note}</span>
    <span class="tier-meta"><span>${played} / ${total} 场</span>${leader ? `<span class="club">${crest({ name: leader.id === PLAYER_TEAM_ID ? game.clubName : leader.name, color: leader.color }, 15)}<span>${esc(leader.id === PLAYER_TEAM_ID ? game.clubName : leader.name)} 领跑</span></span>` : ''}</span>
    ${topScorer || topAssist ? `<span class="tier-leaders">
      ${topScorer ? `<span class="tier-leader"><small>射手</small>${esc(topScorer.name)} <b>${topScorer.goals}</b></span>` : ''}
      ${topAssist ? `<span class="tier-leader"><small>助攻</small>${esc(topAssist.name)} <b>${topAssist.assists}</b></span>` : ''}
    </span>` : ''}
  </button>`
}

export function renderWorld(): string {
  if (!game.world) {
    return pageHead({
      kicker: '世界',
      title: '旧存档',
      sub: '当前存档使用旧的单级联赛；开始新游戏即可进入三级共享世界。',
      actions: '<button class="btn primary" data-action="new-game">开始三级世界</button>',
    })
  }
  const world = game.world
  const playerClub = world.clubs.find((club) => club.id === PLAYER_TEAM_ID)
  const activeId = ui.worldDivision && TIERS.some((item) => item.id === ui.worldDivision) ? ui.worldDivision : world.playerDivisionId
  const active = TIERS.find((item) => item.id === activeId) ?? TIERS[0]
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const division = snapshot?.divisions.find((item) => item.id === active.id) ?? world.divisions.find((item) => item.divisionId === active.id)
  const ownId = snapshot?.ownClubId ?? 'player'
  const visibleTable = division?.table.map((row) => ({ ...row, teamId: row.teamId === ownId ? 'player' : row.teamId })) ?? []
  const visibleFixtures = division?.fixtures.map((fixture) => ({ ...fixture, homeId: fixture.homeId === ownId ? 'player' : fixture.homeId, awayId: fixture.awayId === ownId ? 'player' : fixture.awayId })) ?? []
  const clubLabels = snapshot ? Object.fromEntries(snapshot.clubs.map((club) => [club.id === ownId ? 'player' : club.id, { name: club.id === ownId ? game.clubName : club.name, color: club.color }])) : undefined
  const selectedClub = ui.worldClubId ? publicClubFor(world, ui.worldClubId) : null
  const playoff = world.lastPromotionPlayoff ?? world.promotionPlayoff
  const clubLabel = (id: string) => (id === PLAYER_TEAM_ID || id === playerClub?.squadKey ? game.clubName : world.clubs.find((club) => club.id === id)?.name ?? id)
  const picks = d2ClubChoices()
  const colorOf = (id: string) => WORLD_CLUB_DEFS.find((club) => club.id === id)?.color ?? '#64748b'
  return `
    ${pageHead({
      kicker: `赛季 ${snapshot?.seasonIndex ?? world.seasonIndex} · ${world.clubs.length} 支球队`,
      title: '三级共享世界',
      sub: `冠军联赛 / 一级联赛 / 二级联赛（南北两区）。当前执教：<b>${esc(game.clubName)}</b> · ${worldTierLabel(playerClub?.tier ?? 'division2')}${playerClub?.conference ? ` · ${playerClub.conference === 'north' ? '北区' : '南区'}` : ''}。`,
      actions: `${onlineState.status === 'online' ? '' : '<button class="btn" data-action="new-game">开始本地新游戏</button>'}`, 
    })}
    ${inPostseason(game) ? `<div class="banner info">${icon('clock', 18)}<b>赛后休整 · 还剩 ${esc(nextSeasonCountdown(game))}</b><span>升级杯正在进行；所有球队都可以约友谊赛，赛季将在休整窗口结束后自动开始。</span></div>` : ''}
    <div class="pyramid">
      <div class="pyramid-level l1">${tierButton(world, TIERS[0], activeId)}</div>
      <div class="pyramid-level l2">${tierButton(world, TIERS[1], activeId)}</div>
      <div class="pyramid-level l3">${tierButton(world, TIERS[2], activeId)}${tierButton(world, TIERS[3], activeId)}</div>
    </div>
    <div class="grid season-grid">
      ${panel(esc(worldDivisionLabel(world, active.id)), division ? leagueTable(visibleTable, { tier: active.tier, fixtures: visibleFixtures, browseClubs: true, clubLabels, ratings: divisionRatings(world, visibleTable.map((row) => row.teamId)) }) : '<p class="muted pad">当前联赛不存在。</p>', { flush: true, aside: `<span class="muted small">点击球队查看所有球员 · ${active.note}</span>` })}
      <div class="dash-col">
        ${leaderPanels(division, { limit: 5 })}
        ${panel('升降级', `
          <ul class="rule-list">
            <li>${icon('flag', 13)}一级联赛前三升入冠军联赛；冠军联赛后三降入一级联赛。</li>
            <li>${icon('flag', 13)}一级联赛后三降入二级联赛。</li>
            <li>${icon('flag', 13)}二级每个赛区的前 3 名进入升级杯：各区第 1 轮空，2/3 名先加赛一轮；出线的人和轮空的球队随机分成两组打循环（瑞士轮），小组第一直接升级，两个小组第二再打一轮，胜者拿到第 3 个升级名额。</li>
            <li>${icon('flag', 13)}赛区数量不影响升级名额：不管开多少个区，二级每个赛季都是 3 队升入一级联赛。</li>
          </ul>
          ${playoff ? `<p class="small">升级杯：${playoff.promoted.map((id) => esc(clubLabel(id))).join('、') || '进行中'}</p>` : '<p class="hint">常规赛结束后先休整 12 个游戏日踢升级杯，期间可以安排友谊赛。</p>'}
        `)}
        ${world.history.length ? panel('历史', `<div class="rows">${world.history.slice().reverse().slice(0, 5).map((item) => `<div class="row-line"><span class="dim">第 ${item.seasonIndex} 赛季</span><span>冠军 ${esc(item.champion)}</span><span class="muted small">升级 ${item.promotions.length} 队</span></div>`).join('')}</div>`, { flush: true }) : ''}
        ${panel('球队席位', `
          <p class="hint">新账号只会接管<b>二级联赛</b>的空位；二级满员后服务器自动开一个新赛区（第 3 区、第 4 区……），不会把你塞进一级或冠军联赛。联机账号不能自行重开世界；退出账号后可以创建独立的本地存档。</p>
          <div class="club-chips">${picks.slice(0, 8).map((club) => `<span class="club-chip">${crest({ name: club.name, color: colorOf(club.id) }, 15)}${esc(club.name)}<small>${club.conference === 'north' ? '北区' : '南区'}</small></span>`).join('')}</div>
        `)}
      </div>
    </div>
    ${selectedClub ? `<div id="world-roster">${clubRosterPanel(selectedClub, ui.worldPlayerId)}</div>` : '<p class="hint">点击积分榜中的任意球队，即可查看其球员名单、CA 和属性。</p>'}
  `
}
