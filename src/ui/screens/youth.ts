import type { DetailedPosition } from '../../game/types.ts'
import { DETAILED_POSITIONS, DETAILED_POSITION_LABELS } from '../../game/detailed-positions.ts'
import { DAY_MS } from '../../game/calendar.ts'
import { lineupLockState } from '../../game/season.ts'
import { YOUTH_CAPACITY, YOUTH_DOWNTIME_COMPENSATION_ID, YOUTH_FOCUSES, YOUTH_INTAKE_KEEP, YOUTH_WAGE, pendingYouthDowntimeCompensation, youthCA, youthNextIntakeAt, youthPlayer, type YouthMember } from '../../game/youth.ts'
import { isOnlineMode, serverNow } from '../../online.ts'
import { icon, pageHead, panel, tag, youthBadge } from '../components.ts'
import { esc } from '../format.ts'
import { game } from '../state.ts'
import '../youth.css'
import { starRating, youthRatingSummary, youthStars } from '../stars.ts'
function duration(ms: number): string {
  const hours = Math.max(0, Math.ceil(ms / 3_600_000))
  return hours >= 24 ? `${Math.floor(hours / 24)} 天 ${hours % 24} 小时` : hours > 0 ? `${hours} 小时` : '即将更新'
}
const date = (at: number) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
function positionOptions(current: DetailedPosition, gk?: boolean): string {
  return DETAILED_POSITIONS.filter(pos => gk === undefined || (pos === 'GK') === gk).map(pos => `<option value="${pos}" ${pos === current ? 'selected' : ''}>${DETAILED_POSITION_LABELS[pos]}</option>`).join('')
}
function memberCard(member: YouthMember, now: number, locked: boolean, candidate = false): string {
  const player = youthPlayer(game, member)
  const current = youthCA(player)
  const gk = player.basePositions.GK > 0
  const completed = now >= member.endsAt
  const last = member.growth.at(-1)
  const weekSessions = member.growth.filter(g => g.at > now - 7 * DAY_MS && g.caAfter > g.caBefore + 1e-8).length
  const focuses = Object.entries(YOUTH_FOCUSES).filter(([key]) => gk || !['saves', 'handling', 'distribution'].includes(key))
  return `<article class="youth-card ${member.tier === 'genius' ? 'youth-genius' : ''}" data-youth-member="${esc(player.id)}" data-key="youth-${esc(player.id)}">
    <header class="youth-card-head">
      <div><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button>${youthBadge(player)}<small>${player.age} 岁 · ${esc(DETAILED_POSITION_LABELS[member.plan.position])} · ${esc(player.country)}</small></div>
      ${member.compensationId === YOUTH_DOWNTIME_COMPENSATION_ID ? tag('宕机补偿', 'gold') : ''}
    </header>
    ${youthRatingSummary(current, member.ceiling)}
    ${candidate ? `<p class="hint">可免费签入青训营</p><button class="btn primary" data-action="youth-sign" data-player="${esc(player.id)}" ${game.youth!.members.length >= YOUTH_CAPACITY || game.youth!.intake.signed.length >= YOUTH_INTAKE_KEEP ? 'disabled' : ''}>免费签入</button>` : `
      <div class="youth-status">${tag(member.calledUp ? '临时征召' : '在营', member.calledUp ? 'solid' : '')}${completed ? tag('成长结束', 'warn') : `<span>剩余 ${duration(member.endsAt - now)}</span>`}</div>
      <div class="youth-plan">
        <label>目标位置<select id="youth-position-${esc(player.id)}" data-youth-position aria-label="${esc(player.name)}的目标位置" ${completed ? 'disabled' : ''}>${positionOptions(member.plan.position, gk)}</select></label>
        <label>重点能力<select id="youth-focus-${esc(player.id)}" data-youth-focus aria-label="${esc(player.name)}的重点能力" ${completed ? 'disabled' : ''}>${focuses.map(([key, value]) => `<option value="${key}" ${key === member.plan.focus ? 'selected' : ''}>${value.label}</option>`).join('')}</select></label>
      </div>
      <button class="btn" data-action="youth-plan" data-player="${esc(player.id)}" ${completed ? 'disabled' : ''}>保存培养方向</button>
      <div class="youth-growth"><span>最近一次 <b>${last ? last.caAfter > last.caBefore + 1e-8 ? '有所进步' : '暂无变化' : '等待训练'}</b></span><span>近 7 天 <b>${weekSessions} 次成长</b></span></div>
      <p class="hint">${completed ? '青训成长已结束，可正式提拔。' : `下次结算：${esc(date(Math.min(member.settledAt + DAY_MS, member.endsAt)))}${member.settledAt + DAY_MS <= now ? '（等待正式比赛公布）' : ''}`}</p>
      <div class="youth-actions">
        <button class="btn" data-action="youth-${member.calledUp ? 'return' : 'call_up'}" data-player="${esc(player.id)}" ${locked ? 'disabled' : ''}>${member.calledUp ? '返回青训营' : '临时征召'}</button>
        <button class="btn primary" data-action="youth-promote" data-player="${esc(player.id)}" ${locked ? 'disabled' : ''}>正式提拔</button>
        <button class="btn ghost" data-action="youth-release" data-player="${esc(player.id)}" ${locked ? 'disabled' : ''}>解约</button>
      </div>
      ${member.growth.length ? `<details class="youth-log"><summary>最近成长记录</summary><div class="table-scroll"><table class="dt"><thead><tr><th>结算</th><th>培养方向</th><th>出场</th><th>比赛系数</th><th>当前能力</th></tr></thead><tbody>${member.growth.slice(-7).reverse().map(g => `<tr><td>${esc(date(g.at))}</td><td>${DETAILED_POSITION_LABELS[g.plan.position]} · ${YOUTH_FOCUSES[g.plan.focus].label}</td><td>${Math.round(g.minutes)} 分钟</td><td>×${g.matchFactor.toFixed(2)}</td><td>${starRating(youthStars(g.caAfter), '训练后当前能力')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    `}
  </article>`
}
export function renderYouth(): string {
  const youth = game.youth
  if (!youth) return pageHead({ title: '青训', sub: '正在准备青训营，请稍候刷新。' })
  const now = isOnlineMode() ? serverNow() : Date.now()
  const lockNotice = game.activeMatch ? '比赛进行中，结束后可调整青训名单。'
    : lineupLockState(game, now).locked ? '阵容已锁定，暂不能征召、下放、提拔或解约；仍可保存培养方向。' : ''
  const candidates = youth.intake.candidates.filter(m => !youth.intake.signed.includes(m.player.id))
  const called = youth.members.filter(m => m.calledUp).length
  return `${pageHead({ kicker: 'YOUTH ACADEMY', title: '青训', sub: '发现苗子，塑造位置，培养属于俱乐部的未来。' })}
    <div class="youth-overview"><div><span>在营人数</span><b>${youth.members.length}<small> / ${YOUTH_CAPACITY}</small></b></div><div><span>临时征召</span><b>${called}</b></div><div><span>本期可签</span><b>${youth.intake.period > 0 ? Math.max(0, YOUTH_INTAKE_KEEP - youth.intake.signed.length) : 0}</b></div><div><span>下一期招募</span><b class="youth-countdown">${duration(youthNextIntakeAt(game) - now)}</b></div></div>
    ${panel('在营球员', `<p class="hint">按「位置＋重点能力」自动培养，每 24 小时结算一次，离线同样成长。修改方向从下个培养周期生效。星级为青训基础能力与潜力评价，潜力不保证完全兑现；18 岁所在赛季结束后停止成长。</p>${lockNotice ? `<p class="hint">${lockNotice}</p>` : ''}<div class="youth-grid">${youth.members.map(m => memberCard(m, now, !!lockNotice)).join('') || '<p class="hint">青训营暂无球员，等待下期招募。解约不会自动补发新人。</p>'}</div>`)}
    ${panel('本期招募', `${pendingYouthDowntimeCompensation(game) ? `<div class="banner gold">${icon('star', 16)}<b>服务器宕机补偿 · 下期青训保底 5★ 即战力</b><span>下期招募将额外保底出现 1 名 <b>17 岁 · 当前 4★ · 潜力 5★</b> 的即战力新星（位置严格按下方「下期重点寻找」生成，下赛季可直接征召上场），请在刷新前选好心仪位置。</span></div>` : ''}<div class="youth-recruit"><label>下期重点寻找<select id="youth-recruit-position">${positionOptions(youth.recruitPosition)}</select></label><button class="btn" data-action="youth-recruit_position">保存招募方向</button></div><p class="hint">首次提供 6 名青年；之后每现实周提供 5 名候选人，可免费留下 2 人。至少一人符合重点位置；青训设施等级越高，越容易发现高潜力、五星黄金苗子与 14–15 岁年轻苗子。下期：${esc(date(youthNextIntakeAt(game)))}。</p><div class="youth-grid">${candidates.map(m => memberCard(m, now, false, true)).join('') || '<p class="hint">本期没有待签候选人。</p>'}</div>`)}
    ${panel('征召与提拔', `<div class="youth-rules"><p><b>临时征召</b>：进入一线队名单，可以踢正式比赛，仍继续青训成长；返回青训营不重置体能、伤病或停赛。不能制作、装备球员卡。</p><p><b>正式提拔</b>：免费转为正式球员，基础属性永久定型，之后使用现有培养卡体系。不可退回青训继续涨基础。</p><p><b>比赛成长</b>：联赛、正式杯赛的出场与表现影响本周期成长，每周期按开球顺序最多计入 90 分钟。友谊赛和可重复挑战不计；表现较差只降低成长效率，不扣已有属性。</p><p><b>合同与转会</b>：征召或提拔后工资 ${YOUTH_WAGE} 金币／联赛轮，在营不收工资。正式提拔满一周后才可转会；青训解约不返金币、材料或球员卡。</p></div>`)}
  `
}
