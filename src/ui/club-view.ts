import type { WorldState } from '../game/types.ts'
import { buildOwnerlessTeams } from '../game/world.ts'
import { ATTR_GROUPS } from '../game/data/attributes.ts'
import { attrRating, mainAttrsFor } from '../game/rating.ts'
import { publicWorld, onlineState, type WorldPublicClub, type WorldPublicPlayer } from '../online.ts'
import { PLAYER_TEAM_ID } from '../game/season.ts'
import { attrHeat, attributeRadar, caHeat, icon, panel, posBadge, positionMap, primaryPosition, skillGroups, traitLabel } from './components.ts'
import { attrLabel, esc, playerCA } from './format.ts'
import { game, ui } from './state.ts'

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
    : game.aiTeams.find((item) => item.id === id)?.players ?? buildOwnerlessTeams(world, game.seed)[id]?.players ?? []
  return {
    id,
    name: id === PLAYER_TEAM_ID ? game.clubName : club.name,
    color: club.color,
    tier: club.tier,
    conference: club.conference,
    formationId: club.formationId,
    players: roster.map(({ id: playerId, name, enName, country, era, age, foot, height, positions, attrs, traitId, skills, skillTiers }) => ({
      id: playerId, name, enName, country, era, age, foot, height, positions,
      attrs: Object.fromEntries(mainAttrsFor(positions.GK > 0).map((key) => [key, attrs[key]])),
      traitId, skills, skillTiers, ca: playerCA({ attrs, positions }),
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
  return `<div class="profile-grid"><div>${attributeRadar(player)}${attrs}</div><div><h3>位置熟练度</h3>${positionMap(player)}<h3>技能与特性</h3>${traitLabel(player.traitId, true)}${skillGroups(player)}</div><div><h3>档案</h3><dl class="facts"><div><dt>年龄</dt><dd>${player.age ?? 24}</dd></div><div><dt>国籍</dt><dd>${esc(player.country)}</dd></div><div><dt>身高</dt><dd>${player.height} cm</dd></div><div><dt>惯用脚</dt><dd>${esc(player.foot)}</dd></div></dl><p class="hint">实时体能、训练精力与伤病状态不公开。</p></div></div>`
}

/** 任意界面点击球队后弹出的名单（世界页也复用同一份）。 */
export function clubRosterPanel(club: WorldPublicClub, selectedId?: string | null): string {
  const selected = selectedId ? club.players.find((player) => player.id === selectedId) : undefined
  const rows = [...club.players].sort((a, b) => b.ca - a.ca).map((player) => `<tr class="${player.id === selectedId ? 'me' : ''}">
    <td>${posBadge(primaryPosition(player))}</td>
    <td><button class="name-btn" data-club-player="${esc(player.id)}" data-club="${esc(club.id)}">${esc(player.name)}</button></td>
    <td class="num">${player.age ?? 24}</td><td class="num strong">${caHeat(player.ca)}</td>
    <td>${traitLabel(player.traitId)}</td></tr>`).join('')
  return `${panel(`${esc(club.name)} · 球员名单`, `<p class="hint">公开 CA、属性、位置、技能等资料；实时体能、训练精力与伤病状态不公开。</p>
    <div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">年龄</th><th class="num">CA</th><th>特性</th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true })}
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
