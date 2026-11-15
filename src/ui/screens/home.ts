import { UNPAID_PERFORMANCE, economyOf, wageArrearsOf } from '../../game/economy.ts'
import { transferWindowOpen } from '../../game/market.ts'
import { FORMATIONS } from '../../game/data/formations.ts'
import { PLAYER_TEAM_ID, roundKickoffAt, shortCountdown, teamName } from '../../game/season.ts'
import { validateLineup } from '../../game/squad.ts'
import { SQUAD_LIMIT } from '../../game/market.ts'
import { trainingActionsTotal } from '../../game/training.ts'
import { worldDivisionLabel } from '../../game/world.ts'
import { isOnlineMode, onlineKickoffPending, serverNow } from '../../online.ts'
import { boardMarkings, boardSpot, caHeat, clubLook, crest, emptyState, formPills, humanMark, icon, injuryLabel, leagueTable, meter, ownName, pageHead, panel, recordResult, resultPill, tag, teamForm, tile } from '../components.ts'
import { isHighOffer } from '../../game/transfers.ts'
import { countdownText, esc, kickoffTimeLabel, matchModeLabel, playerCA, pveModeLabel, shortName } from '../format.ts'
import { game } from '../state.ts'
import type { IconName } from '../icons.ts'

function divisionText(): string {
  if (!game.world) return '联赛'
  return worldDivisionLabel(game.world, game.season.divisionId ?? game.world.playerDivisionId)
}

function rankOf(teamId: string): number {
  return game.season.table.findIndex((row) => row.teamId === teamId) + 1
}

function nextMatchSide(teamId: string, align: 'left' | 'right', isMe: boolean): string {
  const look = clubLook(teamId)
  const rank = rankOf(teamId)
  const row = game.season.table.find((item) => item.teamId === teamId)
  return `<div class="nm-team ${align} ${isMe ? 'me' : ''}">
    ${crest(look, 64)}
    <div class="nm-team-text">
      <b>${esc(look.name)}${humanMark(teamId)}</b>
      <span class="muted">${rank ? `第 ${rank} 名 · ${row?.points ?? 0} 分` : ''}</span>
      ${formPills(teamForm(teamId, game.season.fixtures))}
    </div>
  </div>`
}

function recentLeagueResult(): string {
  const fixture = game.season.fixtures.filter(item => item.isPlayer && item.played && item.score)
    .sort((a, b) => b.round - a.round)[0]
  if (!fixture?.score) return ''
  const record = fixture.matchId
    ? game.matchHistory.find(item => item.id === fixture.matchId)
    : game.matchHistory.find(item => item.isLeague && item.round === fixture.round && (item.seasonIndex === game.season.index || item.seasonIndex === undefined && game.season.index === 1))
  const text = `<span class="nm-recent-label">第 ${fixture.round} 轮结果</span><span>${ownName(teamName(game, fixture.homeId), fixture.homeId === PLAYER_TEAM_ID)} <b>${fixture.score.home} : ${fixture.score.away}</b> ${ownName(teamName(game, fixture.awayId), fixture.awayId === PLAYER_TEAM_ID)}</span>`
  return record
    ? `<button class="nm-recent" data-action="open-review" data-record="${esc(record.id)}">${text}<small>查看战报 ${icon('right', 12)}</small></button>`
    : `<div class="nm-recent">${text}</div>`
}

function nextMatchPanel(): string {
  const season = game.season
  if (game.activeMatch) {
    const active = game.activeMatch
    return panel('比赛进行中', `<div class="nm-stack"><div class="nm-live">
      <div>${icon('live', 22)}</div>
      <div><b>对阵 ${esc(active.context.opponentName)}</b><p class="muted">${active.context.isLeague ? `联赛第 ${active.context.round} 轮 · 按现实时间进行` : pveModeLabel(active.context.mode, active.context.stage)} · 种子 ${active.context.seed}</p></div>
      <button class="btn primary" data-nav="match">${icon('play', 14)}继续比赛</button>
    </div>${recentLeagueResult()}</div>`, { className: 'next-match span-8' })
  }
  if (season.finished) {
    return panel('赛季结束', `<div class="nm-stack"><div class="nm-live">
      <div>${icon('star', 22)}</div>
      <div><b>冠军：${ownName(teamName(game, season.champion ?? ''), season.champion === PLAYER_TEAM_ID)}</b><p class="muted">你的最终排名：第 ${season.playerFinish ?? '—'} 名。升降级和合同会在新赛季开始时结算。</p></div>
      <button class="btn primary" data-action="next-season">${icon('play', 14)}开始下一赛季</button>
    </div>${recentLeagueResult()}</div>`, { className: 'next-match span-8' })
  }
  const league = season.fixtures.filter(item => item.isPlayer && !item.played).sort((a, b) => a.round - b.round)[0]
  const clubId = game.world?.clubs.find(club => club.id === 'player')?.squadKey
  const seasonCups = game.world?.seasonCupMode === 1 && game.world.seasonCups?.seasonIndex === season.index ? game.world.seasonCups : undefined
  const cup = clubId && seasonCups ? seasonCups.cups.flatMap(item => item.rounds.flatMap(round => round.fixtures.map(fixture => ({ cup: item, fixture }))))
    .filter(item => !item.fixture.played && (item.fixture.homeId === clubId || item.fixture.awayId === clubId))
    .sort((a, b) => a.fixture.kickoffAt - b.fixture.kickoffAt)[0] : undefined
  const cupFirst = !!cup && (!league || cup.fixture.kickoffAt < roundKickoffAt(game, league.round))
  const fixture = cupFirst ? { ...cup!.fixture, homeId: cup!.fixture.homeId === clubId ? PLAYER_TEAM_ID : cup!.fixture.homeId, awayId: cup!.fixture.awayId === clubId ? PLAYER_TEAM_ID : cup!.fixture.awayId, isPlayer: true } : league
  if (!fixture) {
    return panel('下一场比赛', `<div class="nm-stack"><div class="nm-live"><div>${icon('clock', 22)}</div><div><b>暂无待进行的联赛</b><p class="muted">等待本赛季赛程结算。</p></div></div>${recentLeagueResult()}</div>`, { className: 'next-match span-8' })
  }
  const homeIsMe = fixture.homeId === PLAYER_TEAM_ID
  const kickoffAt = cupFirst ? cup!.fixture.kickoffAt : roundKickoffAt(game, fixture.round)
  const now = isOnlineMode() ? serverNow() : Date.now()
  const countdown = kickoffAt > now ? shortCountdown(kickoffAt - now) : '比赛待结算'
  const startButton = !isOnlineMode() && !cupFirst && fixture.round === season.round
    ? `<button class="btn primary nm-go" data-action="start-league">${icon('play', 14)}跳至比赛日</button>` : ''
  return panel('下一轮预告', `<div class="nm-stack" data-next-round="${fixture.round}"><div class="nm-body">
      ${nextMatchSide(fixture.homeId, 'left', homeIsMe)}
      <div class="nm-center">
        <div class="nm-vs">VS</div>
        <div class="nm-meta">${homeIsMe ? '主场' : '客场'} · ${cupFirst ? tag(esc(cup!.cup.name), 'info') : tag('联赛')} 第 ${fixture.round} 轮</div>
        <div class="nm-meta">${icon('clock', 13)} ${esc(kickoffTimeLabel(kickoffAt))} · ${kickoffAt > now ? `距开赛 ${esc(countdown)}` : esc(countdown)}</div>
        ${startButton}
      </div>
      ${nextMatchSide(fixture.awayId, 'right', !homeIsMe)}
    </div>${recentLeagueResult()}</div>`, { aside: `<span class="muted">${cupFirst ? `${esc(cup!.cup.name)} · ` : ''}第 ${fixture.round} 轮</span>`, className: 'next-match span-8' })
}

function clubStatusPanel(): string {
  const economy = economyOf(game)
  const table = game.season.table
  const me = table.find((row) => row.teamId === PLAYER_TEAM_ID)
  const rank = rankOf(PLAYER_TEAM_ID)
  const wages = game.roster.reduce((sum, player) => sum + (player.contract?.wage ?? 0), 0)
  const sessions = Object.values(game.training).filter((session) => !session.completed).length
  const diff = me ? me.gf - me.ga : 0
  return panel('俱乐部状态', `<div class="tile-grid">
    ${tile('联赛排名', rank ? `${rank}<small> / ${table.length}</small>` : '—', me ? `${me.points} 分` : '')}
    ${tile('战绩', me ? `${me.won}-${me.drawn}-${me.lost}` : '—', `净胜 ${diff > 0 ? '+' : ''}${diff}`)}
    ${tile('余额', economy.balance.toLocaleString(), `工资 ${wages.toLocaleString()} / 轮`)}
    ${tile('阵容', `${game.roster.length}<small> / ${SQUAD_LIMIT}</small>`, sessions ? `${sessions} 人培养中` : '无人培养')}
  </div>`, { className: 'club-status span-4' })
}

function tablePanel(): string {
  const table = game.season.table
  const myIndex = Math.max(0, table.findIndex((row) => row.teamId === PLAYER_TEAM_ID))
  const span = 12
  const from = Math.max(0, Math.min(myIndex - 5, table.length - span))
  return panel('积分榜', leagueTable(table, { tier: game.season.tier, fixtures: game.season.fixtures, compact: true, window: { from, to: from + span } }), {
    flush: true,
    aside: `<button class="link" data-nav="season">完整榜单 ${icon('right', 12)}</button>`,
    className: 'span-4',
  })
}

function recentPanel(): string {
  const records = game.matchHistory.slice(0, 5)
  const body = records.length === 0
    ? '<p class="muted pad">还没有比赛记录。</p>'
    : `<div class="rows">${records.map((record) => `<button class="row-btn result-row" data-action="open-review" data-record="${esc(record.id)}">
        ${resultPill(recordResult(record.result))}
        <span class="result-teams">${ownName(record.homeName, record.homeId === PLAYER_TEAM_ID)} <b>${record.score.home}:${record.score.away}</b> ${ownName(record.awayName, record.awayId === PLAYER_TEAM_ID)}${record.shootout ? ` <small class="muted">点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}</span>
        <small class="muted">${matchModeLabel(record)}</small>
      </button>`).join('')}</div>`
  return panel('最近比赛', body, { flush: true, aside: `<button class="link" data-nav="review">全部复盘 ${icon('right', 12)}</button>` })
}

function trainingPanel(): string {
  const sessions = Object.values(game.training).filter((session) => game.roster.some((player) => player.id === session.playerId)).slice(0, 4)
  const body = sessions.length === 0
    ? '<p class="muted pad">还没有进行中的培养。选一名球员，培养一张角色卡。</p>'
    : `<div class="rows">${sessions.map((session) => {
      const player = game.roster.find((item) => item.id === session.playerId)!
      const total = trainingActionsTotal(session)
      const state = session.pendingEventId ? '<span class="tag gold">待处理事件</span>' : session.completed ? '<span class="tag good">新卡</span>' : ''
      return `<button class="row-btn training-row" data-action="open-training" data-player="${esc(player.id)}">
        <span class="training-name">${esc(player.name)}</span>
        <span class="progress-mini"><i style="width:${((session.action / total) * 100).toFixed(1)}%"></i></span>
        <small class="muted num-text">${session.action}/${total}</small>
        ${state}
      </button>`
    }).join('')}</div>`
  return panel('培养进度', body, { flush: true, aside: `<button class="link" data-nav="training">培养页 ${icon('right', 12)}</button>` })
}

type InboxItem = { tone: 'bad' | 'warn' | 'info' | 'good'; icon: IconName; title: string; detail: string; attrs: string }

function inboxItems(): InboxItem[] {
  const items: InboxItem[] = []
  const check = validateLineup(game.roster, game.lineup)
  if (!check.valid) items.push({ tone: 'bad', icon: 'alert', title: '阵容不合法', detail: check.errors[0] ?? '', attrs: 'data-nav="lineup"' })
  if (game.roster.length > SQUAD_LIMIT) {
    items.push({ tone: 'bad', icon: 'alert', title: `阵容超编 ${game.roster.length} / ${SQUAD_LIMIT}`, detail: `裁掉 ${game.roster.length - SQUAD_LIMIT} 人才能进入比赛。`, attrs: 'data-nav="transfer"' })
  }
  const offers = (game.transferOffers ?? []).filter((offer) => offer.status === 'pending')
  if (offers.length) {
    const soonest = Math.min(...offers.map((offer) => offer.expiresAt))
    items.push({ tone: 'warn', icon: 'swap', title: `收到 ${offers.length} 份转会报价`, detail: `最早的 ${countdownText(soonest - serverNow())} 后过期，不回复算拒绝。`, attrs: 'data-action="go-transfer" data-tab="offers"' })
  }
  for (const player of game.roster) {
    if (!player.unhappy || player.unhappy.until <= serverNow()) continue
    items.push({ tone: 'warn', icon: 'alert', title: `${player.name} 不满`, detail: `${player.unhappy.reason}；${countdownText(player.unhappy.until - serverNow())} 内精力恢复只剩一成。`, attrs: `data-action="detail" data-player="${esc(player.id)}"` })
  }
  const inLineup = new Set([...game.lineup.starters.map((starter) => starter.playerId), ...game.lineup.bench])
  for (const id of Object.keys(game.suspensions ?? {})) {
    const player = game.roster.find((item) => item.id === id)
    if (!player) continue
    items.push({ tone: inLineup.has(id) ? 'bad' : 'warn', icon: 'flag', title: `${player.name} 停赛 ${game.suspensions![id].matches} 场`, detail: inLineup.has(id) ? '仍在比赛名单中，开赛前必须调整。' : '已不在比赛名单中。', attrs: 'data-nav="lineup"' })
  }
  for (const player of game.roster) {
    const label = injuryLabel(player)
    if (label && inLineup.has(player.id)) items.push({ tone: 'warn', icon: 'cross', title: `${player.name} 受伤`, detail: label.replace('受伤 · ', ''), attrs: 'data-nav="lineup"' })
  }
  for (const session of Object.values(game.training)) {
    const player = game.roster.find((item) => item.id === session.playerId)
    if (!player) continue
    if (session.pendingEventId) items.push({ tone: 'warn', icon: 'info', title: `${player.name}：培养事件待处理`, detail: `进度 ${session.action}/${trainingActionsTotal(session)}`, attrs: `data-action="open-training" data-player="${esc(player.id)}"` })
    else if (session.completed) items.push({ tone: 'good', icon: 'check', title: `${player.name}：培养出新球员卡`, detail: '已进入库存，去看看要不要换上。', attrs: `data-action="open-training" data-player="${esc(player.id)}"` })
  }
  const expiring = game.roster.filter((player) => player.contract && player.contract.expiresSeason <= game.season.index)
  if (expiring.length) items.push({ tone: 'warn', icon: 'coach', title: `${expiring.length} 份合同本赛季到期`, detail: expiring.slice(0, 3).map((player) => player.name).join('、'), attrs: 'data-action="go-club" data-tab="contracts"' })
  const listings = game.market?.listings.length ?? 0
  if (listings) items.push({ tone: 'info', icon: 'coin', title: `${listings} 名球员挂牌中`, detail: '下一轮结算时可能成交。', attrs: 'data-action="go-transfer" data-tab="market"' })
  if (game.world) items.push({ tone: 'info', icon: 'swap', title: transferWindowOpen(game) ? '转会窗口开放中' : '转会窗口已关闭', detail: '开放轮次：第 1-10 轮、第 20-30 轮。', attrs: 'data-action="go-transfer" data-tab="free"' })
  return items
}

/** 欠薪时总览最上面的醒目提示：欠多少、球员只发挥一半、能不能马上补发。 */
function wageArrearsAlert(): string {
  const owed = wageArrearsOf(game)
  if (owed <= 0) return ''
  const balance = economyOf(game).balance
  const canPay = balance >= owed
  return `<section class="offer-alert arrears-alert" role="alert">
    <div class="offer-alert-head">${icon('alert', 18)}<b>欠薪 ${owed.toLocaleString()}：球员只能发挥 ${Math.round(UNPAID_PERFORMANCE * 100)}%</b>
      <span class="muted">欠薪期间所有比赛属性减半，直到全部补发${isOnlineMode() ? '（联机按开球前 30 分钟锁定时的状态算）' : ''}</span>
      <button class="btn small danger" data-action="pay-wage-arrears" ${canPay ? '' : 'disabled'}>补发欠薪</button></div>
    <p class="arrears-detail">余额 <b class="num-text">${balance.toLocaleString()}</b>${canPay ? '，够一次还清。' : `，还差 <b class="num-text">${(owed - balance).toLocaleString()}</b>。卖人、接受报价可以凑钱；下次发薪时余额够也会先自动补发。`}
      <button class="link" data-action="go-transfer" data-tab="market">去卖人 ${icon('right', 12)}</button></p>
  </section>`
}

/** 收到转会报价时总览最上面的醒目提示：列出待回复的报价，点任意一条去「收到的报价」。 */
function offerAlert(): string {
  const offers = (game.transferOffers ?? []).filter((offer) => offer.status === 'pending').sort((a, b) => a.expiresAt - b.expiresAt)
  if (!offers.length) return ''
  const shown = offers.slice(0, 3)
  const rows = shown.map((offer) => {
    const premium = offer.value > 0 ? offer.amount / offer.value - 1 : 0
    return `<button class="offer-alert-row" data-action="go-transfer" data-tab="offers">
      <b>${esc(offer.clubName)}</b><span>出价</span><b class="num-text">${offer.amount.toLocaleString()}</b><span>求购</span><b>${esc(offer.playerName)}</b>
      <span class="${premium >= 0 ? 'up' : 'down'} num-text">${premium >= 0 ? '+' : ''}${Math.round(premium * 100)}%</span>
      ${isHighOffer(offer) ? tag('高价：拒绝他会不满', 'gold') : ''}
      <span class="offer-alert-time muted">剩余 <span class="countdown" data-countdown-end="${offer.expiresAt}">${countdownText(offer.expiresAt - serverNow())}</span></span>
    </button>`
  }).join('')
  return `<section class="offer-alert" role="alert">
    <div class="offer-alert-head">${icon('swap', 18)}<b>收到 ${offers.length} 份转会报价</b><span class="muted">过期不回复算拒绝</span>
      <button class="btn small danger" data-action="go-transfer" data-tab="offers">去处理 ${icon('right', 12)}</button></div>
    <div class="offer-alert-list">${rows}${offers.length > shown.length ? `<span class="muted small">还有 ${offers.length - shown.length} 份…</span>` : ''}</div>
  </section>`
}

function inboxPanel(): string {
  const items = inboxItems()
  return panel('待办事项', items.length === 0
    ? emptyState('一切就绪。')
    : `<div class="rows inbox">${items.slice(0, 7).map((item) => `<button class="row-btn msg msg-${item.tone}" ${item.attrs}>
        ${icon(item.icon, 15)}
        <span class="msg-text"><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></span>
      </button>`).join('')}</div>`, { flush: true, aside: items.length ? `<span class="muted">${items.length}</span>` : '' })
}

function lineupPanel(): string {
  const formation = FORMATIONS[game.lineup.formationId]
  const look = clubLook(PLAYER_TEAM_ID)
  const tokens = formation?.slots.map((slot) => {
    const starter = game.lineup.starters.find((item) => item.slotId === slot.id)
    const player = starter ? game.roster.find((item) => item.id === starter.playerId) : undefined
    const { left, top } = boardSpot(slot.x, slot.y)
    return `<div class="mini-token" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%"><i style="background:${esc(look.color)}"></i><span>${esc(player ? shortName(player.name) : slot.label)}</span></div>`
  }).join('') ?? ''
  const starters = game.lineup.starters.map((starter) => game.roster.find((item) => item.id === starter.playerId)).filter((item) => !!item)
  const averageCA = starters.length ? starters.reduce((sum, player) => sum + playerCA(player), 0) / starters.length : 0
  const condition = starters.length ? starters.reduce((sum, player) => sum + (player.condition ?? 100), 0) / starters.length : 0
  return panel(`首发 · ${esc(game.lineup.formationId)}`, `<div class="home-lineup">
      <div class="board mini">${boardMarkings()}${tokens}</div>
      <div class="home-lineup-stats">
        <div><span class="muted small">平均 CA</span>${caHeat(averageCA)}</div>
        <div><span class="muted small">平均体能</span>${meter(condition)}</div>
      </div>
    </div>`, { aside: `<button class="link" data-nav="lineup">调整 ${icon('right', 12)}</button>` })
}

export function renderHome(): string {
  const look = clubLook(PLAYER_TEAM_ID)
  return `
    ${pageHead({
      lead: crest(look, 46),
      kicker: `第 ${game.season.index} 赛季 · ${esc(divisionText())}`,
      title: ownName(game.clubName),
    })}
    ${wageArrearsAlert()}
    ${offerAlert()}
    <div class="dash">
      ${nextMatchPanel()}
      ${clubStatusPanel()}
      ${tablePanel()}
      <div class="dash-col span-4">${recentPanel()}${trainingPanel()}</div>
      <div class="dash-col span-4">${inboxPanel()}${lineupPanel()}</div>
    </div>
  `
}
