import type { Player } from '../../game/types.ts'
import { ATTR_GROUPS } from '../../game/data/attributes.ts'
import { bestMarketValue } from '../../game/market.ts'
import { equippedCard, playerCards } from '../../game/cards.ts'
import { attrRating, initialDisplayCA, mainAttrsFor } from '../../game/rating.ts'
import { MAIN_FIELD_ATTRS, MAIN_GK_ATTRS } from '../../game/scale.ts'
import type { ClubPreview } from '../../game/world.ts'
import { onlineState, publicConfig } from '../../online.ts'
import { economyOf } from '../../game/economy.ts'
import { SEASON_GOAL_LABELS, SQUAD_ROLE_LABELS, TIER_LABELS, negotiationDemands, negotiationTerms, type SeasonGoal, type SquadRole } from '../../game/negotiation.ts'
import { CA_STOPS, attrHeadCell, attributeRadar, attrHeat, caHeat, cardName, cardRoute, countryLabel, crest, eraLabel, findAnyPlayer, heatLegend, icon, injuryLabel, mainAttrs, meter, positionMap, posBadge, primaryPosition, skillGroups, skillTag, tag, traitLabel } from '../components.ts'
import { attrLabel, esc, playerCA, trainingLogText } from '../format.ts'
import { game, ui } from '../state.ts'
import { careerStats, fixtureTotals, isOwnPlayer, seasonStats } from '../../game/player-stats.ts'

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
        ['出场', other!.apps], ['进球', other!.goals], ['助攻', other!.assists],
      ]
  return `<section class="player-stats">
    <div class="stat-tabs">
      <button class="tab ${ui.playerStatsTab === 'season' ? 'active' : ''}" data-player-stats-tab="season">本赛季</button>
      ${own ? `<button class="tab ${ui.playerStatsTab === 'career' ? 'active' : ''}" data-player-stats-tab="career">生涯</button>` : ''}
    </div>
    <dl class="facts">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${own ? '' : '<p class="hint">其他球队只公开本赛季的进球与助攻；完整数据需要等他加入你的球队。</p>'}
  </section>`
}

export function renderDetailOverlay(): string {
  if (!ui.detailPlayerId) return ''
  const player = findAnyPlayer(ui.detailPlayerId)
  if (!player) return ''
  const owned = game.roster.some((item) => item.id === player.id)
  const gk = player.positions.GK > 0
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
        <header class="profile-head">
          <div class="profile-id">
            ${posBadge(primaryPosition(player))}
            <div>
              <h1>${esc(player.name)} <small>${esc(player.enName)}</small></h1>
              <p class="muted">球员详情 · ${[countryLabel(player), player.era === 'random' ? '' : player.era, gk ? '门将' : '外场'].filter(Boolean).map(esc).join(' · ')}</p>
            </div>
          </div>
          <div class="big-ca"><span>CA</span><b>${caHeat(playerCA(player), 1)}</b><small>原始 CA ${initialDisplayCA(player).toFixed(1)}</small></div>
        </header>
        ${injury ? `<div class="banner bad">${icon('cross', 16)}<span>${injury}；带伤比赛能力下降 30%，不影响精力或培养。</span></div>` : ''}
        <div class="profile-grid">
          <section class="profile-col">
            <h3>主属性（0–1500）${owned ? `<small>${worn ? esc(cardName(worn)) : '原始属性'}</small>` : ''}</h3>
            ${attributeRadar(player)}
            ${attrGroups}
            <p class="hint">隐藏属性不公开数值，只通过事件、配合或测验成长。</p>
          </section>
          <section class="profile-col">
            <h3>位置熟练度</h3>
            ${positionMap(player)}
            <h3>特性与技能</h3>
            <div class="tag-row">${traitLabel(player.traitId, true)}</div>
            ${skillGroups(player)}
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
            </div>` : '<p class="hint">其他球队的实时体能与训练精力不公开。</p>'}
            <h3>性格</h3>
            <div class="profile-meters">${personality.map(([label, value]) => `<div><span>${label}</span><span class="meter-wrap"><span class="meter neutral"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></span><span class="meter-value">${Math.round(value)}</span></span></div>`).join('')}</div>
            ${owned ? (session || candidate
              ? `<div class="banner good compact split"><b>${candidate || session?.completed ? '培养出了新球员卡' : '正在培养'}</b><button class="btn primary small" data-action="open-training" data-player="${esc(player.id)}">查看培养</button></div>`
              : `<button class="btn primary wide" data-action="start-training" data-player="${esc(player.id)}">${icon('play', 14)}培养角色卡</button>`) : '<p class="hint">这名球员不在你的阵容中。</p>'}
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
          <p>当前账号：<b>${esc(onlineState.user?.username ?? '')}</b> · 第 ${onlineState.revision} 版存档${onlineState.connected ? ' · SSE 已连接' : ' · SSE 重连中'}</p>
          <p class="hint">另一台设备保存后会自动同步到这里。冲突时服务器版本优先。</p>
          <div class="btn-row"><button class="btn primary" data-action="agent-token">生成 / 复制 Agent 令牌</button><button class="btn ghost" data-action="agent-revoke">重置令牌</button></div>
          <p class="hint">把 fm_... 令牌交给 Claude / Cursor 的 MCP 配置；不需要给账号密码。令牌可随时重置。</p>
          <div class="btn-row"><button class="btn ghost" data-action="account-logout">退出登录</button><button class="btn" data-action="account-close">关闭</button></div>
        ` : `
          <p class="hint">登录后存档保存到服务器，并用 SSE 在多个页面/设备间同步。离线时仍可玩本地存档。</p>
          <div class="form-row"><label for="account-username">用户名</label><input id="account-username" autocomplete="username" placeholder="2-24 位" /></div>
          <div class="form-row"><label for="account-password">密码</label><input id="account-password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="至少 6 位" /></div>
          ${registering && mode === 'invite' ? '<div class="form-row"><label for="account-invite">邀请码</label><input id="account-invite" autocomplete="off" placeholder="向管理员索取" /></div>' : ''}
          ${registering && publicConfig.turnstileSiteKey ? '<div class="turnstile-slot" id="turnstile-slot" data-morph-skip></div>' : ''}
          ${registrationHint}
          ${onlineState.error ? `<p class="warn-text small">${esc(onlineState.error)}</p>` : ''}
          <div class="btn-row">
            <button class="btn primary" data-action="account-submit">${registering ? '注册并进入' : '登录'}</button>
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
  const signature = club.roster.find((player) => player.era !== 'random')
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
      ${signature ? `<div><dt>招牌球员（接管后加入）</dt><dd>${esc(signature.name)} ${caHeat(playerCA(signature))}</dd></div>` : ''}
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
  return `
    <div class="overlay" data-action="newgame-close">
      <div class="modal newgame-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="开始新游戏">
        <button class="modal-close" data-action="newgame-close" aria-label="关闭">${icon('close', 16)}</button>
        <div class="kicker">开始新游戏</div>
        <h1>选择要接管的二级联赛球队</h1>
        <div class="banner bad compact">${icon('alert', 15)}<span>开始新游戏会覆盖当前存档，无法撤销。</span></div>
        <div class="pick-layout">
          <div class="pick-list">${column('north', '北区')}${column('south', '南区')}</div>
          ${selected ? pickDetail(selected) : ''}
        </div>
        <div class="btn-row modal-actions">
          <button class="btn" data-action="newgame-close">取消</button>
          <button class="btn primary" data-action="newgame-confirm" ${selected ? '' : 'disabled'}>${selected ? `接管${esc(selected.name)}，覆盖存档并开始` : '覆盖存档并开始'}</button>
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
  const player = findAnyPlayer(draft.playerId)
  if (!player) return ''
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
  const chance = Math.round(terms.chance * 1000) / 10
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
  const canPay = economyOf(game).balance >= draft.offer
  return `
    <div class="overlay" data-action="nego-cancel">
      <div class="modal nego-modal" data-stop="true" role="dialog" aria-modal="true" aria-label="球员谈判">
        <button class="modal-close" data-action="nego-cancel" aria-label="关闭">${icon('close', 16)}</button>
        <div class="kicker">球员谈判 · ${esc(source)}</div>
        <h1>${esc(player.name)} <small>${posBadge(primaryPosition(player))} CA ${playerCA(player).toFixed(0)}</small></h1>
        <p class="hint">${demandsLine}</p>
        ${hardLines}
        <div class="nego-answers">
          <div class="form-row"><label>你的赛季目标</label><div class="seg wrap">${goalButtons}</div></div>
          <div class="form-row"><label>你给他的位置</label><div class="seg wrap">${roleButtons}</div></div>
        </div>
        <div class="form-row"><label for="nego-offer">报价（底价 ${draft.asking.toLocaleString()}，余额 ${economyOf(game).balance.toLocaleString()}）</label>
          <input id="nego-offer" type="number" min="${draft.asking}" step="1000" value="${draft.offer}" data-nego-offer></div>
        <div class="nego-chance ${chance >= 70 ? 'good' : chance >= 35 ? 'warn' : 'bad'}">
          <span>谈判成功率</span><b>${chance.toFixed(1)}%</b><span class="nego-bar"><i style="width:${Math.min(100, chance)}%"></i></span>
        </div>
        <ul class="nego-reasons">${reasons}</ul>
        ${draft.message ? `<p class="warn-text">${esc(draft.message)}</p>` : ''}
        ${!canPay ? '<p class="warn-text small">余额不够这个报价。</p>' : ''}
        <div class="btn-row">
          <button class="btn primary" data-action="nego-confirm" ${canPay ? '' : 'disabled'}>${draft.kind === 'bid' ? '确认出价' : '确认谈判'}</button>
          <button class="btn ghost" data-action="nego-cancel">再想想</button>
        </div>
        <p class="hint">同一份报价 + 同一组回答，结果固定；换报价或换个承诺才会重新掷骰。</p>
      </div>
    </div>`
}
