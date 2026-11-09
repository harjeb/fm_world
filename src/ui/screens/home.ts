import { economyOf } from '../../game/economy.ts'
import { transferWindowOpen } from '../../game/market.ts'
import { FORMATIONS } from '../../game/data/formations.ts'
import { PLAYER_TEAM_ID, matchdayCountdown, nextMatchCountdown, playerFixture, seasonRoundLabel, teamName } from '../../game/season.ts'
import { validateLineup } from '../../game/squad.ts'
import { SQUAD_LIMIT } from '../../game/market.ts'
import { trainingActionsTotal } from '../../game/training.ts'
import { worldDivisionLabel } from '../../game/world.ts'
import { isOnlineMode, onlineKickoffPending, serverNow } from '../../online.ts'
import { boardMarkings, boardSpot, caHeat, clubLook, crest, emptyState, formPills, icon, injuryLabel, leagueTable, meter, pageHead, panel, recordResult, resultPill, teamForm, tile } from '../components.ts'
import { countdownText, esc, matchModeLabel, playerCA, pveModeLabel, shortName } from '../format.ts'
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
      <b>${esc(look.name)}</b>
      <span class="muted">${rank ? `第 ${rank} 名 · ${row?.points ?? 0} 分` : ''}</span>
      ${formPills(teamForm(teamId, game.season.fixtures))}
    </div>
  </div>`
}

function nextMatchPanel(): string {
  const season = game.season
  if (game.activeMatch) {
    const active = game.activeMatch
    return panel('比赛进行中', `<div class="nm-live">
      <div>${icon('live', 22)}</div>
      <div><b>对阵 ${esc(active.context.opponentName)}</b><p class="muted">${active.context.isLeague ? `联赛第 ${active.context.round} 轮 · 按现实时间进行` : pveModeLabel(active.context.mode, active.context.stage)} · 种子 ${active.context.seed}</p></div>
      <button class="btn primary" data-nav="match">${icon('play', 14)}继续比赛</button>
    </div>`, { className: 'next-match span-8' })
  }
  if (season.finished) {
    return panel('赛季结束', `<div class="nm-live">
      <div>${icon('star', 22)}</div>
      <div><b>冠军：${esc(teamName(game, season.champion ?? ''))}</b><p class="muted">你的最终排名：第 ${season.playerFinish ?? '—'} 名。升降级和合同会在新赛季开始时结算。</p></div>
      <button class="btn primary" data-action="next-season">${icon('play', 14)}开始下一赛季</button>
    </div>`, { className: 'next-match span-8' })
  }
  const fixture = playerFixture(game)
  if (!fixture) {
    return panel('下一场比赛', `<div class="nm-live"><div>${icon('clock', 22)}</div><div><b>本轮没有你的比赛</b><p class="muted">等待结算 · 距下一轮 ${esc(matchdayCountdown(game))}</p></div></div>`, { className: 'next-match span-8' })
  }
  const homeIsMe = fixture.homeId === PLAYER_TEAM_ID
  const played = fixture.played && fixture.score
  return panel(played ? '本轮结果' : '下一场比赛', `<div class="nm-body">
      ${nextMatchSide(fixture.homeId, 'left', homeIsMe)}
      <div class="nm-center">
        ${played ? `<div class="nm-score">${fixture.score!.home} : ${fixture.score!.away}</div>` : '<div class="nm-vs">VS</div>'}
        <div class="nm-meta">${homeIsMe ? '主场' : '客场'} · ${esc(divisionText())}</div>
        ${isOnlineMode()
          ? `<div class="nm-meta">${icon('clock', 13)} 下场比赛倒计时 ${esc(nextMatchCountdown(game, serverNow()))}</div>`
          : played
            ? `<div class="nm-meta">下一轮 ${esc(matchdayCountdown(game))}</div>`
            : `<div class="nm-meta">${icon('clock', 13)} 距自动结算 ${esc(matchdayCountdown(game))}</div><button class="btn primary nm-go" data-action="start-league">${icon('play', 14)}跳至比赛日</button>`}
      </div>
      ${nextMatchSide(fixture.awayId, 'right', !homeIsMe)}
    </div>`, { aside: `<span class="muted">${esc(seasonRoundLabel(game))}</span>`, className: 'next-match span-8' })
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
        <span class="result-teams">${esc(record.homeName)} <b>${record.score.home}:${record.score.away}</b> ${esc(record.awayName)}${record.shootout ? ` <small class="muted">点球 ${record.shootout.home}:${record.shootout.away}</small>` : ''}</span>
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
      title: esc(game.clubName),
    })}
    <div class="dash">
      ${nextMatchPanel()}
      ${clubStatusPanel()}
      ${tablePanel()}
      <div class="dash-col span-4">${recentPanel()}${trainingPanel()}</div>
      <div class="dash-col span-4">${inboxPanel()}${lineupPanel()}</div>
    </div>
  `
}
