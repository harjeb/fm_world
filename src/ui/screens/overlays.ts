import type { Player } from '../../game/types.ts'
import { ATTR_GROUPS } from '../../game/data/attributes.ts'
import { bestMarketValue } from '../../game/market.ts'
import { equippedCard, playerCards, untrainedPlayer } from '../../game/cards.ts'
import { attrRating, initialDisplayCA, mainAttrsFor } from '../../game/rating.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS } from '../../game/scale.ts'
import type { ClubPreview } from '../../game/world.ts'
import { marketState, onlineState, publicConfig, registrationClubs } from '../../online.ts'
import { AUCTION_EXTEND_MS, auctionRaiseFee } from '../../game/auction.ts'
import { previewClubSigning } from '../../game/market.ts'
import { SQUAD_STATUS_LABELS } from '../../game/transfer-rules.ts'
import { economyOf } from '../../game/economy.ts'
import { SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, TIER_LABELS, negotiationDemands, negotiationTerms, type SeasonGoal, type SquadRole } from '../../game/negotiation.ts'
import { CA_STOPS, attrHeadCell, attributeRadar, attrHeat, caHeat, cardName, cardRoute, countryLabel, crest, eraLabel, findAnyPlayer, heatLegend, icon, injuryLabel, mainAttrs, meter, positionMap, posBadge, primaryPosition, skillGroups, skillTag, tag, traitLabel } from '../components.ts'
import { attrLabel, esc, playerCA, trainingLogText } from '../format.ts'
import { game, ui } from '../state.ts'
import { careerStats, fixtureTotals, isOwnPlayer, seasonStats } from '../../game/player-stats.ts'
import { APP_VERSION, CHANGELOG_RELEASES } from '../../game/changelog.ts'
import { chemistryPartners } from '../chemistry.ts'
import { comparisonCandidates, renderPlayerComparison } from './player-comparison.ts'
import { renderPlayerPerformance } from './player-performance.ts'

function cardRows(player: Player): string {
  const cards = playerCards(game, player.id)
  const locked = game.activeMatch ? 'disabled title="比赛进行中不能换卡"' : ''
  const row = (id: string, name: string, sub: string, ca: number, active: boolean) => `<div class="card-row ${active ? 'active' : ''}" data-key="${esc(id || 'base')}">
      <span class="card-row-name"><b>${esc(name)}</b><small>${esc(sub)}</small></span>
      <span class="card-row-ca">${caHeat(ca)}</span>
      ${active ? tag('已装备', 'solid') : `<button class="btn small" data-action="card-equip" data-player="${esc(player.id)}" data-card="${esc(id)}" ${locked}>装备</button>`}
    </div>`
  return `<div class="card-rows">
    ${row('', '原始属性', '没有培养过的样子', initialDisplayCA(player), !player.equippedCardId)}
    ${cards.map((card) => row(card.id, cardName(card), cardRoute(card), playerCA(card), card.id === player.equippedCardId)).join('')}
  </div>
  <p class="hint">换卡不影响体能和精力。${cards.length ? `<button class="link" data-nav="inventory">去库存比较 ${icon('right', 12)}</button>` : '培养一轮后这里会多一张卡。'}</p>`
}

/** 本赛季 / 生涯数据；别队球员只能拿到本赛季的进球和助攻。 */
function statsBlock(player: Player): string {
  const own = isOwnPlayer(game, player.id)
  const totals = own
    ? (ui.playerStatsTab === 'career' ? careerStats(game, player.id) : seasonStats(game, player.id))
    : null
  const other = own ? null : fixtureTotals(game, player.id)
  const rows: [string, number | string][] = totals
    ? [
        ['出场', totals.apps], ['进球', totals.goals], ['助攻', totals.assists], ['每场进球', totals.goalsPerMatch.toFixed(2)],
        ['射门', totals.shots], ['传球成功', totals.passes ? `${Math.round((totals.passesCompleted / totals.passes) * 100)}%` : '—'],
        ['抢断', totals.tackles], ['拦截', totals.interceptions], ['出场分钟', Math.round(totals.minutes)],
      ]
    : [
        ['出场', '—'], ['进球', other!.goals], ['助攻', other!.assists],
      ]
  return `<section class="player-stats">
    <div class="stat-tabs">
      <button class="tab ${ui.playerStatsTab === 'season' ? 'active' : ''}" data-player-stats-tab="season">本赛季</button>
      ${own ? `<button class="tab ${ui.playerStatsTab === 'career' ? 'active' : ''}" data-player-stats-tab="career">生涯</button>` : ''}
    </div>
    <dl class="facts">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${own ? '' : '<p class="hint">进球与助攻来自赛程记录；未记录完整出场次数。</p>'}
  </section>`
}

function detailNavigation(): string {
  const tabs = [['profile', '球员档案'], ['performance', '球员表现'], ['compare', '球员对比']] as const
  return `<nav class="player-detail-nav" aria-label="球员详情页面">${tabs.map(([view, label]) => `<button type="button" data-player-detail-view="${view}" class="${ui.playerDetailView === view ? 'active' : ''}" aria-pressed="${ui.playerDetailView === view}">${label}</button>`).join('')}</nav>`
}

export function renderDetailOverlay(): string {
  if (!ui.detailPlayerId) return ''
  const source = findAnyPlayer(ui.detailPlayerId)
  if (!source) return ''
  const owned = game.roster.some((item) => item.id === source.id)
  // 在转会市场预览别人球队的球员时，展示实际能买到的原始球员，而不是不随转会转移的卡。
  const transferPreview = !owned && ui.screen === 'transfer'
  const player = transferPreview ? untrainedPlayer(source) : source
  const gk = player.positions.GK > 0
  const head = `<header class="profile-head">
    <div class="profile-id">${posBadge(primaryPosition(player))}<div>
      <h1>${esc(player.name)} <small>${esc(player.enName)}</small></h1>
      <p class="muted">球员详情 · ${[countryLabel(player), player.era === 'random' ? '' : player.era, gk ? '门将' : '外场'].filter(Boolean).map(esc).join(' · ')}</p>
    </div></div>
    <div class="big-ca"><span>${transferPreview ? '原始 CA' : 'CA'}</span><b>${caHeat(playerCA(player), 1)}</b><small>${transferPreview ? '转会不包含球员卡' : `原始 CA ${initialDisplayCA(player).toFixed(1)}`}</small></div>
  </header>`
  if (ui.playerDetailView !== 'profile') {
    const candidates = comparisonCandidates()
    const opponentSource = candidates.find((candidate) => candidate.id === ui.playerCompareId)
    const opponent = opponentSource && ui.screen === 'transfer' && !game.roster.some((item) => item.id === opponentSource.id) ? untrainedPlayer(opponentSource) : opponentSource
    const content = ui.playerDetailView === 'performance'
      ? renderPlayerPerformance(player, ui.playerPerformancePeriod, ui.playerPerformanceCompetition)
      : renderPlayerComparison(player, opponent, candidates, ui.playerCompareTab)
    return `<div class="overlay" data-action="close-detail">
      <div class="modal profile player-analysis-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="${esc(player.name)} 球员详情">
        <button class="modal-close" data-action="close-detail" aria-label="关闭">${icon('close', 16)}</button>
        ${head}${detailNavigation()}${ui.screen === 'transfer' && ui.playerDetailView === 'compare' ? '<p class="player-analysis-note">转会页面中非本队球员的对比使用转会后可获得的原始属性，不包含球员卡。</p>' : ''}${content}
      </div>
    </div>`
  }
  const session = owned ? game.training[player.id] : undefined
  const candidate = owned ? game.candidates[player.id] : undefined
  const injury = owned ? injuryLabel(player) : ''
  const worn = owned ? equippedCard(game, player) : undefined
  const attrGroups = ATTR_GROUPS.filter((group) => gk || group.name !== '门将').map((group) => {
    const keys = group.attrs.filter((key) => mainAttrsFor(gk).includes(key))
    if (keys.length === 0) return ''
    return `<div class="attr-group">
      <div class="attr-group-title">${group.name}</div>
      ${keys.map((key) => {
        const rating = attrRating(key, player.attrs[key], gk)
        return `<div class="attr-row"><span>${attrLabel(key)}</span><span class="attr-bar"><i style="width:${Math.min(100, rating).toFixed(1)}%"></i></span>${attrHeat(player.attrs[key])}</div>`
      }).join('')}
    </div>`
  }).join('')
  const facts: [string, string][] = [
    ['年龄', `${player.age ?? 24} 岁`],
    ['国籍', esc(countryLabel(player))],
    ['年代', esc(eraLabel(player.era))],
    ['惯用脚', esc(player.foot)],
    ['身高', `${player.height} cm`],
    ['特性', traitLabel(player.traitId)],
    ['当前属性', worn ? cardName(worn) : player.version === 0 ? '原始属性' : '培养过'],
    ['估值', bestMarketValue(game, player).toLocaleString()],
  ]
  if (player.contract) {
    facts.push(['合同至', `第 ${player.contract.expiresSeason} 赛季`], ['工资 / 轮', player.contract.wage.toLocaleString()])
  }
  const personality: [string, number][] = [
    ['职业素养', player.personality.professionalism],
    ['进取心', player.personality.ambition],
    ['适应力', player.personality.adaptability],
  ]
  return `
    <div class="overlay" data-action="close-detail">
      <div class="modal profile" data-stop="true" role="dialog" aria-modal="true" aria-label="${esc(player.name)} 球员详情">
        <button class="modal-close" data-action="close-detail" aria-label="关闭">${icon('close', 16)}</button>
        ${head}${detailNavigation()}
        ${injury ? `<div class="banner bad">${icon('cross', 16)}<span>${injury}；带伤比赛能力下降 30%，不影响精力或培养。</span></div>` : ''}
        <div class="profile-grid">
          <section class="profile-col">
            <h3>主属性${owned ? `<small>${worn ? esc(cardName(worn)) : '原始属性'}</small>` : ''}</h3>
            ${attributeRadar(player)}
            ${attrGroups}
          </section>
          <section class="profile-col">
            <h3>位置熟练度</h3>
            ${positionMap(player)}
            <h3>特性与技能</h3>
            <div class="tag-row">${traitLabel(player.traitId, true)}</div>
            ${skillGroups(player)}
            ${owned ? `<h3>队友默契</h3>${chemistryPartners(player)}<p class="hint">配合越多，默契越高；换卡保留。超过 180 个游戏日未合作会移除。</p>` : ''}
          </section>
          <section class="profile-col">
            ${owned ? `<h3>球员卡</h3>${cardRows(player)}` : ''}
            <h3>档案</h3>
            <dl class="facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
            ${statsBlock(player)}
            ${owned ? `<h3>状态</h3>
            <div class="profile-meters">
              <div><span>比赛体能</span>${meter(player.condition ?? 100)}</div>
              <div><span>训练精力</span>${meter(player.energy ?? 100)}</div>
            </div>` : ''}
            <h3>性格</h3>
            <div class="profile-meters">${personality.map(([label, value]) => `<div><span>${label}</span><span class="meter-wrap"><span class="meter neutral"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></span><span class="meter-value">${Math.round(value)}</span></span></div>`).join('')}</div>
            ${owned ? (session || candidate
              ? `<div class="banner good compact split"><b>${candidate || session?.completed ? '培养出了新球员卡' : '正在培养'}</b><button class="btn primary small" data-action="open-training" data-player="${esc(player.id)}">查看培养</button></div>`
              : `<button class="btn primary wide" data-action="open-training" data-player="${esc(player.id)}">${icon('play', 14)}培养角色卡</button>`) : '<p class="hint">这名球员不在你的阵容中。</p>'}
          </section>
        </div>
        ${owned && player.history?.length ? `<section class="profile-history"><h3>${worn ? `${esc(cardName(worn))}的培养记录` : '培养记录'}</h3><div class="log compact">${player.history.slice(-8).reverse().map((entry) => `<div class="log-row"><div class="log-head"><b>${esc(entry.title)}</b></div><p>${esc(trainingLogText(entry, gk))}</p></div>`).join('')}</div></section>` : ''}
      </div>
    </div>
  `
}

export function renderAccountOverlay(): string {
  if (!ui.accountOpen) return ''
  const online = onlineState.status === 'online'
  const mode = publicConfig.registration
  const canRegister = mode === 'open' || mode === 'invite'
  const registering = ui.authMode === 'register' && canRegister
  const clubs = [...(registrationClubs ?? [])].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name, 'zh-CN'))
  const selectedClub = clubs.find((club) => club.id === ui.registrationClubId)
  const registrationHint = mode === 'closed'
    ? '<p class="hint">本服务器已关闭注册，仅限已有账号登录。</p>'
    : mode === 'unknown'
      ? '<p class="hint">当前离线或服务器不可达，无法注册新账号；本地存档仍可正常游玩。</p>'
      : ''
  return `
    <div class="overlay" data-action="account-close">
      <div class="modal account-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="联机账号">
        <button class="modal-close" data-action="account-close" aria-label="关闭">${icon('close', 16)}</button>
        <div class="kicker">联机账号</div>
        <h1>${online ? '已连接服务器' : registering ? '注册账号' : '登录账号'}</h1>
        ${online ? `
          <p>当前账号：<b>${esc(onlineState.user?.username ?? '')}</b> · ${onlineState.connected ? '实时同步中' : '正在重连服务器'}</p>
          <p class="hint">另一台设备保存后会自动同步到这里。冲突时服务器版本优先。</p>
          <div class="btn-row"><button class="btn primary" data-action="agent-token">复制给 AI（令牌 + 文档 + 简介）</button><button class="btn ghost" data-action="agent-revoke">重置令牌</button></div>
          <p class="hint">复制的内容包含 fm_... 令牌、API 文档链接和游戏简介，直接粘贴给能发 HTTP 请求的 AI（Claude / ChatGPT / Cursor），或把令牌填进 MCP 配置；不需要给账号密码。令牌可随时重置。</p>
          <div class="btn-row"><button class="btn ghost" data-action="account-logout">退出登录</button><button class="btn" data-action="account-close">关闭</button></div>
        ` : `
          <p class="hint">登录后存档保存到服务器，并用 SSE 在多个页面/设备间同步。离线时仍可玩本地存档。</p>
          <div class="form-row"><label for="account-username">用户名</label><input id="account-username" autocomplete="username" placeholder="2-24 位" /></div>
          <div class="form-row"><label for="account-password">密码</label><input id="account-password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="至少 6 位" /></div>
          ${registering && mode === 'invite' ? '<div class="form-row"><label for="account-invite">邀请码</label><input id="account-invite" autocomplete="off" placeholder="向管理员索取" /></div>' : ''}
          ${registering ? `
            <div class="form-row"><label for="account-club">执教球队</label><select id="account-club">
              <option value="">${registrationClubs === null ? '正在加载球队…' : clubs.length ? '请选择一支空缺的二级球队' : '暂无空缺球队'}</option>
              ${clubs.map((club) => `<option value="${esc(club.id)}" ${selectedClub?.id === club.id ? 'selected' : ''}>${esc(club.name)} · ${esc(CONFERENCE_LABELS[club.conference ?? ''] ?? '')} · RANK ${club.rating ?? '—'}</option>`).join('')}
            </select></div>
            ${selectedClub ? `<p class="hint">${[...selectedClub.players].sort((a, b) => b.ca - a.ca).slice(0, 3).map((player) => `${posBadge(primaryPosition(player))} ${esc(player.name)} · CA ${player.ca.toFixed(0)}`).join(' / ')}</p>` : ''}
            <p class="hint">球队在注册时确定，注册后不允许换队；直接继承球队已有战绩，不因注册另算比赛。开赛时间固定为北京时间 12:00 / 20:00。</p>
            <button class="btn ghost small" data-action="registration-clubs-refresh">刷新球队列表</button>
          ` : ''}
          ${registering && publicConfig.turnstileSiteKey ? '<div class="turnstile-slot" id="turnstile-slot" data-morph-skip></div>' : ''}
          ${registrationHint}
          ${onlineState.error ? `<p class="warn-text small">${esc(onlineState.error)}</p>` : ''}
          <div class="btn-row">
            <button class="btn primary" data-action="account-submit">${registering ? '确认球队并注册' : '登录'}</button>
            ${canRegister ? `<button class="btn" data-action="account-mode">${registering ? '已有账号，去登录' : '没有账号，去注册'}</button>` : ''}
          </div>
        `}
      </div>
    </div>
  `
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)

function startersOf(club: ClubPreview): Player[] {
  return club.lineup.starters.flatMap((starter) => club.roster.filter((player) => player.id === starter.playerId))
}

const startersCA = (club: ClubPreview) => average(startersOf(club).map(playerCA))

function pickTable(club: ClubPreview, players: Player[], gk: boolean): string {
  if (players.length === 0) return ''
  const starters = new Set(club.lineup.starters.map((starter) => starter.playerId))
  const bench = new Set(club.lineup.bench)
  const rank = (player: Player) => (starters.has(player.id) ? 0 : bench.has(player.id) ? 1 : 2)
  const sorted = [...players].sort((a, b) => rank(a) - rank(b) || playerCA(b) - playerCA(a))
  const rows = sorted.map((player) => {
    const skills = player.skills.map((skill) => skillTag(player, skill)).join('')
    const status = starters.has(player.id) ? tag('首发', 'good') : bench.has(player.id) ? tag('替补') : '<span class="muted small">预备</span>'
    return `<tr data-key="${esc(player.id)}">
      <td>${posBadge(primaryPosition(player))}</td>
      <td class="name-cell"><b class="pick-player">${esc(player.name)}</b>${player.era === 'random' ? '' : tag('招牌', 'gold')}<small>${esc(player.enName)}</small></td>
      <td class="num">${player.age ?? 24}</td>
      <td class="num strong">${caHeat(playerCA(player))}</td>
      ${mainAttrs(player).map((key) => `<td class="num">${attrHeat(player.attrs[key])}</td>`).join('')}
      <td>${status}</td>
      <td><span class="tag-row">${traitLabel(player.traitId, true)}${skills}</span></td>
    </tr>`
  }).join('')
  return `<div class="table-scroll"><table class="dt pick-table">
    <thead><tr><th>${gk ? '门将' : '位置'}</th><th>球员</th><th class="num">龄</th><th class="num">CA</th>${(gk ? MAIN_GK_ATTRS : MAIN_FIELD_ATTRS).map((key) => `<th class="num">${attrHeadCell(key)}</th>`).join('')}<th></th><th>特性与技能</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`
}

function pickDetail(club: ClubPreview): string {
  const keepers = club.roster.filter((player) => primaryPosition(player) === 'GK')
  const outfield = club.roster.filter((player) => primaryPosition(player) !== 'GK')
  return `<div class="pick-detail">
    <div class="pick-head">
      ${crest({ name: club.name, color: club.color }, 34)}
      <div class="pick-title"><b>${esc(club.name)}</b>${club.enName ? `<small>${esc(club.enName)}</small>` : ''}</div>
    </div>
    <dl class="pick-facts">
      <div><dt>首发平均 CA</dt><dd>${caHeat(startersCA(club))}</dd></div>
      <div><dt>全队平均 CA</dt><dd>${caHeat(average(club.roster.map(playerCA)))}</dd></div>
      <div><dt>平均年龄</dt><dd>${average(club.roster.map((player) => player.age ?? 24)).toFixed(1)}</dd></div>
      <div><dt>阵型</dt><dd>${esc(club.formationId)}</dd></div>
      <div><dt>人数</dt><dd>${club.roster.length}</dd></div>
    </dl>
    ${heatLegend('CA', CA_STOPS)}
    ${pickTable(club, outfield, false)}
    ${pickTable(club, keepers, true)}
  </div>`
}

/** 新游戏选队：替代原先的 confirm + prompt，只有确认时才覆盖存档。看到的就是开局的真实名单。 */
export function renderNewGameOverlay(): string {
  if (!ui.newGameOpen) return ''
  const picks = ui.newGamePreview?.clubs ?? []
  const selected = picks.find((club) => club.id === ui.newGameClubId) ?? picks[0] ?? null
  const column = (conference: 'north' | 'south', label: string) => `<div class="pick-column">
    <h3>${label}</h3>
    <div class="pick-grid">${picks.filter((club) => club.conference === conference).sort((a, b) => startersCA(b) - startersCA(a)).map((club) => `<button class="pick-club ${club.id === selected?.id ? 'active' : ''}" data-action="newgame-pick" data-club="${esc(club.id)}" data-key="${esc(club.id)}">${crest({ name: club.name, color: club.color }, 22)}<span class="pick-club-name"><b>${esc(club.name)}</b>${club.enName ? `<small>${esc(club.enName)}</small>` : ''}</span><span class="pick-club-ca">${caHeat(startersCA(club))}</span></button>`).join('')}</div>
  </div>`
  const required = ui.newGameRequired
  return `
    <div class="overlay" ${required ? '' : 'data-action="newgame-close"'}>
      <div class="modal newgame-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="开始新游戏">
        ${required ? '' : `<button class="modal-close" data-action="newgame-close" aria-label="关闭">${icon('close', 16)}</button>`}
        <div class="kicker">${required ? '离线模式' : '开始新游戏'}</div>
        <h1>选择要接管的二级联赛球队</h1>
        ${required ? '' : `<div class="banner bad compact">${icon('alert', 15)}<span>开始新游戏会覆盖当前存档，无法撤销。</span></div>`}
        <div class="pick-layout">
          <div class="pick-list">${column('north', '北区')}${column('south', '南区')}</div>
          ${selected ? pickDetail(selected) : ''}
        </div>
        <div class="btn-row modal-actions">
          ${required ? '' : '<button class="btn" data-action="newgame-close">取消</button>'}
          <button class="btn primary" data-action="newgame-confirm" ${selected ? '' : 'disabled'}>${selected ? `接管${esc(selected.name)}${required ? '并开始' : '，覆盖存档并开始'}` : required ? '开始' : '覆盖存档并开始'}</button>
        </div>
      </div>
    </div>
  `
}

/**
 * 球员谈判：他会问你赛季目标和队内位置，也可能直说要去的球队或要求的联赛级别。
 * 报价越高成功率越高，但级别/下家这种硬条件光靠钱很难抹平。
 */
export function renderNegotiationOverlay(): string {
  const draft = ui.negotiation
  if (!draft) return ''
  const sourcePlayer = findAnyPlayer(draft.playerId)
  if (!sourcePlayer) return ''
  const player = untrainedPlayer(sourcePlayer)
  const demands = negotiationDemands(game, player)
  const tier = game.season.tier ?? 'division2'
  const terms = negotiationTerms({
    demands,
    value: draft.value,
    asking: draft.asking,
    offer: draft.offer,
    answers: { goal: draft.goal, role: draft.role },
    clubTier: tier,
    clubId: 'player',
  })
  // 向 AI 球队买人：先过俱乐部（主力 / 年龄 / 最近出场 / 溢价），再过球员本人，成功率是两关相乘。
  const seller = draft.kind === 'club' ? game.aiTeams.find((team) => team.id === draft.clubId) : undefined
  const clubPreview = seller ? previewClubSigning(game, seller, player, draft.offer, { goal: draft.goal, role: draft.role }) : undefined
  const chance = Math.round((clubPreview ? clubPreview.chance : terms.chance) * 1000) / 10
  const clubSection = clubPreview ? `<div class="nego-club">
      <p><b>俱乐部这关</b> · ${tag(SQUAD_STATUS_LABELS[clubPreview.club.status], clubPreview.club.status === 'key' ? 'good' : clubPreview.club.status === 'rotation' ? 'info' : '')} ${clubPreview.club.age} 岁 · 最近 20 场出场 ${Math.round(clubPreview.club.minutesShare * 100)}%${clubPreview.club.recorded >= 5 ? '' : '（按阵容估算）'} · 身价 ${clubPreview.value.toLocaleString()}</p>
      <p class="hint">${esc(clubPreview.club.blocked ?? clubPreview.club.reasons.join('；'))} · 俱乐部点头 <b>${(clubPreview.club.chance * 100).toFixed(0)}%</b> × 球员点头 <b>${(clubPreview.player.chance * 100).toFixed(0)}%</b></p>
    </div>` : ''
  const clubNameOf = (id: string) => game.world?.clubs.find((club) => club.id === id)?.name ?? game.aiTeams.find((team) => team.id === id)?.name ?? id
  const source = draft.kind === 'free' ? '自由球员' : draft.kind === 'bid' ? '全服竞拍' : `来自 ${clubNameOf(draft.clubId ?? '')}`
  const goalButtons = (Object.keys(SEASON_GOAL_LABELS) as SeasonGoal[]).map((goal) =>
    `<button class="btn small ${draft.goal === goal ? 'primary' : 'ghost'}" data-action="nego-goal" data-goal="${goal}">${SEASON_GOAL_LABELS[goal]}</button>`).join('')
  const roleButtons = (Object.keys(SQUAD_ROLE_LABELS) as SquadRole[]).map((role) =>
    `<button class="btn small ${draft.role === role ? 'primary' : 'ghost'}" data-action="nego-role" data-role="${role}">${SQUAD_ROLE_LABELS[role]}</button>`).join('')
  const demandsLine = [
    `他想听到的目标：<b>${SEASON_GOAL_LABELS[demands.goal]}</b>`,
    `他要求的定位：<b>${SQUAD_ROLE_LABELS[demands.role]}</b>`,
  ].join(' · ')
  const hardLines = [
    demands.wantsClubId && demands.wantsClubId !== 'player' ? `<p class="warn-text small">${icon('flag', 13)} 他直说了更想去 <b>${esc(demands.wantsClubName ?? '')}</b>，除非报价高出一大截。</p>` : '',
    demands.minTier ? `<p class="warn-text small">${icon('star', 13)} 他要求至少踢 <b>${TIER_LABELS[demands.minTier]}</b>（你现在是 ${TIER_LABELS[tier]}）。</p>` : '',
  ].join('')
  const reasons = terms.reasons.map((line) => `<li>${esc(line)}</li>`).join('')
  // 全服竞拍里已经有人出过价：这口是跟价，要另交不退还的手续费；最后 10 分钟内跟价，倒计时重新回到 10 分钟。
  const auction = draft.kind === 'bid' ? marketState.auctions.find((item) => item.playerId === draft.playerId && item.bids.length > 0) : undefined
  const fee = auction ? auctionRaiseFee(draft.offer) : 0
  const canPay = economyOf(game).balance >= draft.offer + fee
  return `
    <div class="overlay" data-action="nego-cancel">
      <div class="modal nego-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="球员谈判">
        <button class="modal-close" data-action="nego-cancel" aria-label="关闭">${icon('close', 16)}</button>
        <div class="kicker">球员谈判 · ${esc(source)}</div>
        <h1>${esc(player.name)} <small>${posBadge(primaryPosition(player))} 原始 CA ${initialDisplayCA(player).toFixed(0)}</small></h1>
        <p class="hint">球员按原始属性转会，培养出的球员卡不随人转移。</p>
        <p class="hint">${demandsLine}</p>
        ${hardLines}
        <div class="nego-answers">
          <div class="form-row"><label>你的赛季目标</label><div class="seg wrap">${goalButtons}</div></div>
          <div class="form-row"><label>你给他的位置</label><div class="seg wrap">${roleButtons}</div></div>
        </div>
        ${clubSection}
        <div class="form-row"><label for="nego-offer">报价（${draft.kind === 'club' ? '俱乐部要价' : '底价'} ${draft.asking.toLocaleString()}，余额 ${economyOf(game).balance.toLocaleString()}）</label>
          <input id="nego-offer" type="number" min="${draft.asking}" step="1000" value="${draft.offer}" data-nego-offer></div>
        <div class="nego-chance ${chance >= 70 ? 'good' : chance >= 35 ? 'warn' : 'bad'}">
          <span>谈判成功率</span><b>${chance.toFixed(1)}%</b><span class="nego-bar"><i style="width:${Math.min(100, chance)}%"></i></span>
        </div>
        <ul class="nego-reasons">${reasons}</ul>
        ${draft.message ? `<p class="warn-text">${esc(draft.message)}</p>` : ''}
        ${fee ? `<p class="warn-text small">${icon('coin', 13)} 跟价手续费 <b>${fee.toLocaleString()}</b>（出价的 2%，至少 1,000），出价成功立即扣除、不退还；如果离落槌不到 ${AUCTION_EXTEND_MS / 60_000} 分钟，倒计时重新回到 ${AUCTION_EXTEND_MS / 60_000} 分钟。</p>` : ''}
        ${!canPay ? `<p class="warn-text small">余额不够这个报价${fee ? '（含手续费）' : ''}。</p>` : ''}
        <div class="btn-row">
          <button class="btn primary" data-action="nego-confirm" ${canPay ? '' : 'disabled'}>${draft.kind === 'bid' ? '确认出价' : '确认谈判'}</button>
          <button class="btn ghost" data-action="nego-cancel">再想想</button>
        </div>
        <p class="hint">同一份报价 + 同一组回答，结果固定；换报价或换个承诺才会重新掷骰。</p>
      </div>
    </div>`
}

const CONFERENCE_LABELS: Record<string, string> = { north: '北区', south: '南区' }

export function renderChangelogOverlay(): string {
  if (!ui.changelogOpen) return ''
  const [latest, ...older] = CHANGELOG_RELEASES
  if (!latest) return ''
  return `
    <div class="overlay" data-action="changelog-close">
      <div class="modal changelog-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="版本更新说明">
        <button class="modal-close" data-action="changelog-close" aria-label="关闭">${icon('close', 16)}</button>
        <div class="changelog-head">
          <div class="kicker">版本更新说明 · ${esc(APP_VERSION)}</div>
          <span class="tag good">${esc(latest.version)} · ${esc(latest.date)}</span>
        </div>
        <h1>${esc(latest.headline)}</h1>
        <p class="hint changelog-summary">${esc(latest.summary)}</p>
        <div class="changelog-list">
          ${latest.items
            .map(
              (item) => `<div class="changelog-card">
                <div class="changelog-card-head">${tag(item.badge, item.tone ?? '')}<b>${esc(item.title)}</b></div>
                <p>${esc(item.desc)}</p>
              </div>`,
            )
            .join('')}
        </div>
        ${older.length
          ? `<details class="changelog-history">
              <summary>往期版本记录（${older.map((r) => esc(r.version)).join(' / ')}）</summary>
              ${older
                .map(
                  (rel) => `<div class="changelog-old-block">
                    <div class="changelog-old-head"><b>${esc(rel.version)} · ${esc(rel.headline)}</b><span class="muted small">${esc(rel.date)}</span></div>
                    <ul>${rel.items.map((it) => `<li><b>${esc(it.title)}：</b>${esc(it.desc)}</li>`).join('')}</ul>
                  </div>`,
                )
                .join('')}
            </details>`
          : ''}
        <div class="btn-row modal-actions">
          <span class="muted small">随时可点击右上角「${esc(APP_VERSION)} 更新说明」再次查看</span>
          <button class="btn primary" data-action="changelog-close">${icon('check', 14)}我知道了</button>
        </div>
      </div>
    </div>`
}
