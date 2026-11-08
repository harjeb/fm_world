import type { AITeam, EconomyState, FacilityId, WorldState } from '../game/types.ts'
import { clubRatings, lineupRating } from '../game/club-rating.ts'
import { FACILITIES, facilityLevel, facilityStageInLevel } from '../game/economy.ts'
import { buildOwnerlessTeams } from '../game/world.ts'
import { ATTR_GROUPS } from '../game/data/attributes.ts'
import { attrRating, mainAttrsFor } from '../game/rating.ts'
import { publicWorld, onlineState, type WorldPublicClub, type WorldPublicPlayer } from '../online.ts'
import { PLAYER_TEAM_ID } from '../game/season.ts'
import { attrHeat, attributeRadar, caHeat, icon, panel, posBadge, positionMap, primaryPosition, skillGroups, tag, traitLabel } from './components.ts'
import { attrLabel, esc, playerCA } from './format.ts'
import { tipAttrs } from './tooltip.ts'
import { game, ui } from './state.ts'

let ownerlessMemo: { key: string; teams: Record<string, AITeam> } | null = null

/**
 * 按世界种子复原的全部球队名单，并带上后台培养出来的卡（单机时 AI 账本在本地推进）。
 * 同一轮、账本没变化时复用上次结果，免得每次渲染都重新生成上千名球员。
 */
export function ownerlessTeamsNow(world: WorldState): Record<string, AITeam> {
  const book = game.aiClubs
  const progress = Object.values(book ?? {}).reduce((sum, club) => sum + club.trained + (club.signings?.length ?? 0), 0)
  const key = `${game.seed}|${world.seasonIndex}|${game.season?.round ?? 0}|${progress}`
  if (ownerlessMemo?.key !== key) ownerlessMemo = { key, teams: buildOwnerlessTeams(world, game.seed, book) }
  return ownerlessMemo.teams
}

/**
 * 一个联赛里每支球队的 RANK（首发 CA 之和）。联机时用服务器算好的值；
 * 单机时本联赛用真实阵容，其他联赛用复原名单（含后台培养出的卡）。
 */
export function divisionRatings(world: WorldState, teamIds: string[]): Map<string, number> {
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const ratings = new Map<string, number>()
  if (snapshot) {
    for (const club of snapshot.clubs) {
      if (club.rating !== undefined) ratings.set(club.id === snapshot.ownClubId ? PLAYER_TEAM_ID : club.id, club.rating)
    }
    return ratings
  }
  const own = clubRatings(game)
  let ownerless: Record<string, AITeam> | undefined
  for (const id of teamIds) {
    const known = own.get(id)
    if (known !== undefined) {
      ratings.set(id, known)
      continue
    }
    const team = (ownerless ??= ownerlessTeamsNow(world))[id]
    if (team) ratings.set(id, lineupRating(team.players, team.lineup))
  }
  return ratings
}

/** 任意界面点开一支球队时用的公开资料；联机时以服务器快照为准。 */
export function publicClubFor(world: WorldState | undefined, id: string): WorldPublicClub | null {
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  const found = snapshot?.clubs.find((club) => club.id === id || (id === 'player' && club.id === snapshot.ownClubId))
  if (found) return found
  if (snapshot) return null
  if (!world) return null
  const club = world.clubs.find((item) => item.id === id)
  if (!club) return null
  const roster = id === PLAYER_TEAM_ID
    ? game.roster
    : game.aiTeams.find((item) => item.id === id)?.players ?? ownerlessTeamsNow(world)[id]?.players ?? []
  return {
    id,
    name: id === PLAYER_TEAM_ID ? game.clubName : club.name,
    color: club.color,
    tier: club.tier,
    conference: club.conference,
    formationId: club.formationId,
    facilities: id === PLAYER_TEAM_ID ? undefined : publicFacilityStages(game.aiClubs?.[id]?.economy),
    players: roster.map(({ id: playerId, name, enName, country, era, age, foot, height, positions, attrs, baseAttrs, traitId, skills, skillTiers }) => ({
      id: playerId, name, enName, country, era, age, foot, height, positions,
      attrs: Object.fromEntries(mainAttrsFor(positions.GK > 0).map((key) => [key, attrs[key]])),
      traitId, skills, skillTiers, ca: playerCA({ attrs, positions }),
      baseCa: baseAttrs ? playerCA({ attrs: baseAttrs, positions }) : undefined,
    })),
  }
}

/** 公开球员详情：CA、主属性、位置、技能；不显示体能/精力/伤病。 */
export function publicPlayerPanel(player: WorldPublicPlayer): string {
  const gk = player.positions.GK > 0
  const attrs = ATTR_GROUPS.filter((group) => gk || group.name !== '门将').map((group) => {
    const keys = group.attrs.filter((key) => mainAttrsFor(gk).includes(key))
    return keys.length
      ? `<div class="attr-group"><div class="attr-group-title">${esc(group.name)}</div>${keys.map((key) => `<div class="attr-row"><span>${esc(attrLabel(key))}</span><span class="attr-bar"><i style="width:${Math.min(100, attrRating(key, player.attrs[key] ?? 0, gk)).toFixed(1)}%"></i></span>${attrHeat(player.attrs[key] ?? 0)}</div>`).join('')}</div>`
      : ''
  }).join('')
  return `<div class="profile-grid"><div>${attributeRadar(player)}${attrs}</div><div><h3>位置熟练度</h3>${positionMap(player)}<h3>技能与特性</h3>${traitLabel(player.traitId, true)}${skillGroups(player)}</div><div><h3>档案</h3><dl class="facts"><div><dt>年龄</dt><dd>${player.age ?? 24}</dd></div><div><dt>国籍</dt><dd>${esc(player.country)}</dd></div><div><dt>身高</dt><dd>${player.height} cm</dd></div><div><dt>惯用脚</dt><dd>${esc(player.foot)}</dd></div><div><dt>装备球员卡</dt><dd>${equippedCardCell(player)}</dd></div></dl><p class="hint">实时体能、训练精力与伤病状态不公开。</p></div></div>`
}

const FACILITY_IDS = Object.keys(FACILITIES) as FacilityId[]

function publicFacilityStages(economy: EconomyState | undefined): WorldPublicClub['facilities'] {
  if (!economy) return undefined
  return Object.fromEntries(FACILITY_IDS.map((id) => [id, economy[id]]))
}

/** 电脑球队的设施等级：比如“球场 3级2阶”。 */
function facilityTags(facilities: NonNullable<WorldPublicClub['facilities']>): string {
  return FACILITY_IDS.filter((id) => facilities[id] !== undefined).map((id) => {
    const stage = facilities[id]!
    return tag(`${FACILITIES[id].label} ${facilityLevel(stage)}级${facilityStageInLevel(stage)}阶`, facilityLevel(stage) >= 3 ? 'gold' : '')
  }).join(' ')
}

/** 他现在装备的球员卡：比原始属性强多少。没练过（或没有原始数据）就只标原始。 */
export function equippedCardGain(player: Pick<WorldPublicPlayer, 'ca' | 'baseCa'>): number | null {
  if (player.baseCa === undefined) return null
  const gain = Math.round(player.ca) - Math.round(player.baseCa)
  return gain >= 1 ? gain : 0
}

function equippedCardCell(player: WorldPublicPlayer): string {
  const gain = equippedCardGain(player)
  if (gain === null) return '<span class="muted small">—</span>'
  if (gain === 0) return '<span class="muted small">原始</span>'
  const tip = tipAttrs('装备球员卡', `原始 CA ${Math.round(player.baseCa!)} → 装备卡 CA ${Math.round(player.ca)}`)
  return `<span class="has-tip" ${tip}><span class="muted small">原始 ${Math.round(player.baseCa!)}</span> ${tag(`卡 +${gain}`, 'gold')}</span>`
}

/** 任意界面点击球队后弹出的名单（世界页也复用同一份）。 */
export function clubRosterPanel(club: WorldPublicClub, selectedId?: string | null): string {
  const selected = selectedId ? club.players.find((player) => player.id === selectedId) : undefined
  const rows = [...club.players].sort((a, b) => b.ca - a.ca).map((player) => `<tr class="${player.id === selectedId ? 'me' : ''}">
    <td>${posBadge(primaryPosition(player))}</td>
    <td><button class="name-btn" data-club-player="${esc(player.id)}" data-club="${esc(club.id)}">${esc(player.name)}</button></td>
    <td class="num">${player.age ?? 24}</td><td class="num strong">${caHeat(player.ca)}</td>
    <td>${equippedCardCell(player)}</td>
    <td>${traitLabel(player.traitId)}</td></tr>`).join('')
  return `${panel(`${esc(club.name)} · 球员名单`, `<p class="hint">公开 CA、属性、位置、技能和他们现在装备的球员卡；实时体能、训练精力与伤病状态不公开。CA 是装备卡的评分，“原始”是没练过的属性。</p>
    ${club.facilities ? `<p class="hint">设施：${facilityTags(club.facilities)}</p>` : ''}
    <div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">年龄</th><th class="num">CA</th><th>装备卡</th><th>特性</th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true })}
    ${selected ? `<div id="club-player-detail">${publicPlayerPanel(selected)}</div>` : ''}`
}

export function renderClubOverlay(): string {
  if (!ui.clubViewId) return ''
  const club = publicClubFor(game.world, ui.clubViewId)
  if (!club) return ''
  return `<div class="overlay" data-action="close-club-view">
    <div class="modal club-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="${esc(club.name)} 球员名单">
      <button class="modal-close" data-action="close-club-view" aria-label="关闭">${icon('close', 16)}</button>
      ${clubRosterPanel(club, ui.clubViewPlayerId)}
    </div>
  </div>`
}
