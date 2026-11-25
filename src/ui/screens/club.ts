import type { BoardAmbition, BoardGoalOption, Player, SeasonState, TierId } from '../../game/types.ts'
import { CLUB_NAME_MAX } from '../../game/club-name.ts'
import { PLAYER_TEAM_ID } from '../../game/season.ts'
import { worldTierLabel, worldWageBill } from '../../game/world.ts'
import { previewContractRenewal } from '../../game/wages.ts'
import { conferenceLabel } from '../../game/data/world-clubs.ts'
import { isOnlineMode, marketState, onlineState } from '../../online.ts'
import { BASE_ROUND_INCOME, economyOf, FACILITIES, facilityLevel, facilityRoundIncome, facilityStageChance, facilityStageInLevel, facilityUpgradeCost, GOAL_INCOME_BONUS, HOME_ATMOSPHERE_BASE, HOME_STADIUM_MAX_BONUS, homeAtmosphereBonus, LEAGUE_WIN_BONUS, MAX_FACILITY_LEVEL, MAX_FACILITY_STAGE, projectedRoundIncome, STAGES_PER_LEVEL, type FacilityId } from '../../game/economy.ts'
import { committedFunds } from '../../game/auction.ts'
import {
  BOARD_AMBITION_META,
  BOARD_CHOICE_MAX_ROUND,
  BOARD_COMMERCIAL_WAGE_SHARE,
  BOARD_CUP_LABELS,
  BOARD_CUP_STAGE_LABELS,
  BOARD_CUP_STAGE_RANK,
  BOARD_GRADE_META,
  BOARD_WAGE_SLIDER_ROUNDS,
  boardCommercialWageBonus,
  boardEffectiveWageCap,
  boardSliderBounds,
  canSwitchCurrentBoardAmbition,
  ensureBoard,
  evaluateClubCupStage,
  isBoardBudgetActive,
  refreshOffseasonBoardPreview,
  syncBoardLockState,
} from '../../game/board.ts'
import { MAIN_ATTR_SCALE } from '../../game/scale.ts'
import { CATEGORY_BONUS_PER_LEVEL, STADIUM_BONUS_PER_LEVEL } from '../../game/training.ts'
import { achievementCeilingBonus, cupCeilingBonus } from '../../game/cup-rewards.ts'
import { legendBookLabel } from '../../game/legend-books.ts'
import { bestMarketValue, transferWindowOpen } from '../../game/market.ts'
import { caHeat, icon, meter, ownName, pageHead, panel, posBadge, primaryPosition, tag, tile } from '../components.ts'
import { esc, playerCA } from '../format.ts'
import type { IconName } from '../icons.ts'
import { game, ui, type ClubTab } from '../state.ts'

const FACILITY_INFO: Record<FacilityId, { label: string; icon: IconName; effect: string }> = {
  stadium: { label: '球场', icon: 'stadium', effect: `所有属性成长 +${STADIUM_BONUS_PER_LEVEL} / 等级` },
  academy: { label: '青训设施', icon: 'cap', effect: `技术属性成长 +${CATEGORY_BONUS_PER_LEVEL} / 等级；更容易发现高潜力苗子` },
  medical: { label: '医疗设施', icon: 'cross', effect: `身体属性成长 +${CATEGORY_BONUS_PER_LEVEL} / 等级；另缩短新伤恢复` },
  psychology: { label: '心理辅导室', icon: 'psychology', effect: `决断、团队合作、镇定成长 +${CATEGORY_BONUS_PER_LEVEL} / 等级` },
  tactics: { label: '战术研究室', icon: 'tactics', effect: `视野、预判、无球跑动、防守站位成长 +${CATEGORY_BONUS_PER_LEVEL} / 等级` },
  shop: { label: '球迷商店', icon: 'bag', effect: '只提高每轮余额收入，不加属性' },
  sponsor: { label: '赞助商', icon: 'badge', effect: '只提高每轮余额收入，不加属性' },
}

/** 只有这几座设施参与培养加成；球迷商店和赞助商只影响收入。 */
const GROWTH_FACILITIES = new Set<FacilityId>(['stadium', 'academy', 'medical', 'psychology', 'tactics'])

const TABS: { id: ClubTab; label: string }[] = [
  { id: 'board', label: '董事会' },
  { id: 'facilities', label: '设施' },
  { id: 'contracts', label: '合同与工资' },
  { id: 'history', label: '历史成绩' },
]

const TIER_RANK: Record<TierId, number> = { division2: 1, division1: 2, champions: 3 }

/** 历史赛季里对手可能已经不在本赛季的名单里了：先查世界球队，再查当前 AI 球队。 */
function clubNameOf(id: string | null): string {
  if (!id) return '—'
  if (id === PLAYER_TEAM_ID) return game.clubName
  return game.world?.clubs.find((club) => club.id === id)?.name ?? game.aiTeams.find((team) => team.id === id)?.name ?? id
}

function seasonLeague(season: SeasonState): string {
  if (!season.tier) return '联赛'
  const conference = season.conference ? ` · ${conferenceLabel(season.conference)}` : ''
  return `${worldTierLabel(season.tier)}${season.tier === 'division2' ? conference : ''}`
}

/** 杯赛冠军陈列：按杯赛汇总次数 + 最近夺冠记录。 */
function trophyCabinet(): string {
  const trophies = [...(game.pve?.trophies ?? [])].sort((a, b) => b.seasonIndex - a.seasonIndex || b.wonAt - a.wonAt)
  const cupBonus = cupCeilingBonus(game)
  const achBonus = achievementCeilingBonus(game)
  const totalBonus = cupBonus + achBonus
  const bonusParts = [
    cupBonus > 0 ? `<span class="tag gold">奖杯上限 +${cupBonus}（取最高）</span>` : '',
    achBonus > 0 ? `<span class="tag gold">成就上限 +${achBonus}（独立叠加）</span>` : '',
  ].filter(Boolean)
  if (cupBonus > 0 && achBonus > 0) bonusParts.push(`<span class="tag info">总上限 +${totalBonus}</span>`)
  const aside = bonusParts.join(' ')
  if (trophies.length === 0) {
    return panel('荣誉橱窗', '<p class="muted pad">还没有奖杯。赢得杯赛冠军后，奖杯和决赛记录会陈列在这里。</p>', { flush: true, aside })
  }
  const counts = new Map<string, { name: string; count: number; last: number }>()
  for (const trophy of trophies) {
    const row = counts.get(trophy.cupId) ?? { name: trophy.cupName, count: 0, last: 0 }
    row.count += 1
    row.last = Math.max(row.last, trophy.seasonIndex)
    counts.set(trophy.cupId, row)
  }
  return panel(`荣誉橱窗 <small>${trophies.length}</small>`, `
    <div class="trophy-grid">
      ${[...counts.values()].map((row) => `<div class="trophy-card">
        ${icon('star', 20)}
        <div><b>${esc(row.name)}</b><span class="muted small">×${row.count} · 最近第 ${row.last} 赛季</span></div>
      </div>`).join('')}
    </div>
    <div class="rows trophy-list">
      ${trophies.map((trophy) => `<div class="row trophy-row">
        ${icon('star', 14)}
        <span class="result-teams"><b>${esc(trophy.cupName)}</b> <span class="muted">第 ${trophy.seasonIndex} 赛季 · 决赛 ${esc(trophy.finalOpponent)}</span>${trophy.ceilingBonus ? ` <span class="tag gold">主属性上限 +${trophy.ceilingBonus}</span>` : ''}${trophy.rewardBook ? ` ${tag(esc(legendBookLabel(trophy.rewardBook)), 'skill-rainbow')}` : ''}${trophy.goldPrize ? ` <span class="tag gold">夺冠金币 ${trophy.goldPrize.toLocaleString()}</span>` : ''}</span>
        <span class="num"><b>${trophy.finalScore.home}:${trophy.finalScore.away}</b>${trophy.finalShootout ? ` <small class="muted">点球 ${trophy.finalShootout.home}:${trophy.finalShootout.away}</small>` : ''}</span>
        ${trophy.matchId && game.challengeHistory.some((record) => record.id === trophy.matchId) ? `<button class="btn small ghost" data-action="open-review" data-record="${esc(trophy.matchId)}">决赛战报</button>` : ''}
      </div>`).join('')}
    </div>`, { flush: true, aside })
}

/** 每个赛季一行：级别、名次、战绩、冠军，以及下赛季是升级还是降级。 */
function historyTab(): string {
  const seasons = [...(game.seasonHistory ?? []).filter((season) => season.index !== game.season.index), game.season]
    .sort((a, b) => a.index - b.index)
  const rows = seasons.map((season, index) => {
    const position = season.table.findIndex((row) => row.teamId === PLAYER_TEAM_ID)
    const row = position >= 0 ? season.table[position] : undefined
    const current = season === game.season && !season.finished
    const next = seasons[index + 1]
    const moved = next?.tier && season.tier ? TIER_RANK[next.tier] - TIER_RANK[season.tier] : 0
    const finish = season.playerFinish ?? (position >= 0 ? position + 1 : null)
    const badges = [
      current ? tag('进行中', 'info') : '',
      season.finished && season.champion === PLAYER_TEAM_ID ? tag('冠军', 'gold') : '',
      moved > 0 ? tag('升级', 'good') : moved < 0 ? tag('降级', 'bad') : '',
    ].join(' ')
    return `<tr data-key="season-${season.index}">
      <td class="strong">第 ${season.index} 赛季</td>
      <td>${esc(seasonLeague(season))}</td>
      <td class="num strong">${finish ? `${current ? '暂列' : ''}第 ${finish} 名` : '—'}<small class="muted"> / ${season.table.length}</small></td>
      <td class="num">${row ? `${row.played}` : '—'}</td>
      <td class="num">${row ? `${row.won} / ${row.drawn} / ${row.lost}` : '—'}</td>
      <td class="num">${row ? `${row.gf} : ${row.ga}` : '—'}</td>
      <td class="num strong">${row?.points ?? '—'}</td>
      <td>${season.finished ? ownName(clubNameOf(season.champion), season.champion === PLAYER_TEAM_ID) : '<span class="muted">—</span>'}</td>
      <td>${badges}</td>
    </tr>`
  }).reverse().join('')
  const done = seasons.filter((season) => season.finished)
  const total = done.reduce((sum, season) => {
    const row = season.table.find((item) => item.teamId === PLAYER_TEAM_ID)
    if (row) { sum.won += row.won; sum.drawn += row.drawn; sum.lost += row.lost; sum.gf += row.gf; sum.ga += row.ga }
    return sum
  }, { won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 })
  const titles = done.filter((season) => season.champion === PLAYER_TEAM_ID).length
  const promotions = seasons.filter((season, index) => {
    const next = seasons[index + 1]
    return !!(next?.tier && season.tier && TIER_RANK[next.tier] > TIER_RANK[season.tier])
  }).length
  const finishes = done.map((season) => season.playerFinish ?? season.table.findIndex((row) => row.teamId === PLAYER_TEAM_ID) + 1).filter((value) => value > 0)
  const best = done.reduce<SeasonState | null>((pick, season) => {
    if (!season.tier) return pick
    if (!pick?.tier) return season
    const rank = (item: SeasonState) => TIER_RANK[item.tier!] * 100 - (item.playerFinish ?? 99)
    return rank(season) > rank(pick) ? season : pick
  }, null)
  return `${trophyCabinet()}<div class="kpi-row club-kpis">
      ${tile('已完成赛季', String(done.length), seasons.length > done.length ? '本赛季进行中' : '')}
      ${tile('联赛冠军', String(titles))}
      ${tile('升级次数', String(promotions))}
      ${tile('历史最佳', best ? `${seasonLeague(best)} 第 ${best.playerFinish ?? '—'}` : finishes.length ? `第 ${Math.min(...finishes)} 名` : '—')}
      ${tile('联赛总战绩', `${total.won} 胜 ${total.drawn} 平 ${total.lost} 负`, `进 ${total.gf} 失 ${total.ga}`)}
    </div>
    ${panel('历年联赛成绩', `<div class="table-scroll"><table class="dt"><thead><tr><th>赛季</th><th>联赛</th><th class="num">名次</th><th class="num">场次</th><th class="num">胜 / 平 / 负</th><th class="num">进 : 失</th><th class="num">积分</th><th>冠军</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint pad">只统计联赛；友谊赛和升级附加赛不计入。升降级按下一个赛季所在的联赛级别判断。</p>`, { flush: true })}`
}

/** 联机时可以改俱乐部名字；名字由服务器查重名和字数。 */
function renameRow(): string {
  if (!isOnlineMode()) return ''
  return `<div class="club-rename">
    <label for="club-name-input">俱乐部名字</label>
    <input id="club-name-input" type="text" maxlength="${CLUB_NAME_MAX}" value="${esc(game.clubName)}" placeholder="最多 ${CLUB_NAME_MAX} 个字" autocomplete="off" data-club-name-input>
    <button class="btn small" data-action="club-rename" ${game.activeMatch ? 'disabled' : ''}>改名</button>
    <span class="muted small">最多 ${CLUB_NAME_MAX} 个字，不能和全服已有球队重名；改名后所有玩家看到的都是新名字。</span>
  </div>`
}

/** 等级内的 5 个阶段；每个等级的第 5 阶段必成。 */
function stagePips(stage: number): string {
  const current = facilityStageInLevel(stage)
  return `<span class="pips" aria-label="第 ${current} 阶段 / ${STAGES_PER_LEVEL}">${Array.from({ length: STAGES_PER_LEVEL }, (_, index) => `<i class="${index < current ? 'on' : ''}"></i>`).join('')}</span>`
}

function nameCell(player: Player): string {
  return `<td class="name-cell"><button class="name-btn" data-action="detail" data-player="${esc(player.id)}">${esc(player.name)}</button>${player.youthOrigin ? '<span class="youth-badge">青训</span>' : ''}<small>${esc(player.enName)}</small></td>`
}

function boardConfidenceLabel(confidence: number): { text: string; tone: string } {
  if (confidence >= 80) return { text: '高度信任', tone: 'good' }
  if (confidence >= 60) return { text: '信任稳固', tone: 'info' }
  if (confidence >= 40) return { text: '保持观望', tone: 'gold' }
  return { text: '信任危机', tone: 'bad' }
}

function boardOptionCard(
  option: BoardGoalOption,
  selected: boolean,
  scope: 'offseason' | 'current',
  disabled: boolean,
  tier?: TierId,
): string {
  const meta = BOARD_AMBITION_META[option.ambition]
  const cupName = BOARD_CUP_LABELS[option.cupId]
  const badge = option.ambition === 'expected'
    ? tag('推荐', 'gold')
    : option.ambition === 'ambitious'
      ? tag('高风险高回报', 'info')
      : tag('稳健', '')
  const btnText = selected
    ? (scope === 'offseason' ? '已预选（换季生效）' : '当前已选')
    : (scope === 'offseason' ? `预选${meta.label}` : `切换为${meta.label}`)
  return `<div class="board-opt ${selected ? 'selected' : ''}">
    <div class="board-opt-head">
      <b>${esc(meta.label)}</b>
      ${badge}
    </div>
    <p class="muted small board-opt-desc">${esc(meta.tagline)}</p>
    <dl class="board-opt-dl">
      <div><dt>联赛目标</dt><dd><b>前 ${option.leagueTarget} 名</b></dd></div>
      <div><dt>${esc(cupName)}目标</dt><dd><b>${esc(BOARD_CUP_STAGE_LABELS[option.cupTarget])}</b></dd></div>
      <div><dt>独立转会预算</dt><dd class="num-text"><b>${option.transferGrant.toLocaleString()}</b></dd></div>
      <div><dt>独立设施预算</dt><dd class="num-text"><b>${option.facilityGrant.toLocaleString()}</b></dd></div>
      <div><dt>基础工资帽 / 轮</dt><dd class="num-text"><b>${option.wageCap.toLocaleString()}</b></dd></div>
      <div><dt>达标 / 超额奖金</dt><dd class="num-text">${option.meetBonus.toLocaleString()} / ${option.exceedBonus.toLocaleString()}</dd></div>
    </dl>
    <button class="btn small ${selected ? 'ghost' : 'primary'}" data-action="board-choose" data-ambition="${option.ambition}" data-scope="${scope}" ${tier ? `data-tier="${tier}"` : ''} ${disabled || selected ? 'disabled' : ''}>${btnText}</button>
  </div>`
}

function boardTab(): string {
  const board = ensureBoard(game)
  syncBoardLockState(game)
  if (game.season.finished && !board.offseasonPreview) {
    refreshOffseasonBoardPreview(game)
  }
  const active = isBoardBudgetActive(game)
  const economy = economyOf(game)
  const confMeta = boardConfidenceLabel(board.confidence)
  const lastGrade = board.lastGrade ? BOARD_GRADE_META[board.lastGrade] : null

  const headerCard = panel('董事会信任度与政策', `
    <div class="board-conf-row">
      <div class="board-conf-main">
        <div class="board-conf-title">
          <span class="muted small">当前信任度</span>
          <b class="board-conf-num">${board.confidence} <small>/ 100</small></b>
          ${tag(confMeta.text, confMeta.tone)}
          ${lastGrade ? tag(`上季考核 ${lastGrade.label}`, lastGrade.tone) : tag('首次考核将于第 2 赛季末进行', 'info')}
        </div>
        ${meter(board.confidence)}
      </div>
      <div class="board-policy-pills">
        <div><span class="muted small">卖人收入归属</span><b>100% 进俱乐部余额</b></div>
        <div><span class="muted small">商业工资帽加成</span><b>+${boardCommercialWageBonus(economy).toLocaleString()} / 轮</b></div>
        <div><span class="muted small">滑块换算比率</span><b>${BOARD_WAGE_SLIDER_ROUNDS} : 1</b></div>
      </div>
    </div>
    <p class="hint">每赛季开启时由董事会分别拨付「独立转会预算」与「独立设施预算」，均与俱乐部自有余额互不冲突：买人优先抵扣转会预算、升级设施优先抵扣设施预算，预算用完后仍可直接用余额支付；但每轮工资帽严格生效，超帽无法签人。未达标将扣减信任度并在下赛季明显削减预算与工资帽。</p>
  `)

  let currentSection = ''
  if (active && board.current) {
    const m = board.current
    const currentRank = game.season.table.findIndex((row) => row.teamId === PLAYER_TEAM_ID) + 1
    const leagueOnTrack = currentRank > 0 && currentRank <= m.leagueTarget
    const squadKey = game.world?.clubs.find((club) => club.id === 'player')?.squadKey
    const clubIds = ['player', ...(squadKey ? [squadKey] : [])]
    const cupStatus = evaluateClubCupStage(game.world?.seasonCups, clubIds, m.cupId)
    const cupOnTrack = BOARD_CUP_STAGE_RANK[cupStatus.stage] >= BOARD_CUP_STAGE_RANK[m.cupTarget]

    const committed = isOnlineMode() ? committedFunds(marketState.auctions, onlineState.user?.id ?? '') : 0
    const bounds = boardSliderBounds(game, committed)
    const effectiveCap = boardEffectiveWageCap(game) ?? m.wageCap
    const wages = worldWageBill(game)
    const wageHeadroom = effectiveCap - wages
    const commercialBonus = boardCommercialWageBonus(economy)

    // 计算当前滑块范围与安全步长（38 的整数倍）
    const sliderMin = bounds?.minTransferDelta ?? 0
    const sliderMax = bounds?.maxTransferDelta ?? 0
    const draftRaw = Math.max(sliderMin, Math.min(sliderMax, ui.boardSliderDraft))
    const draftWageDelta = draftRaw === 0
      ? 0
      : draftRaw > 0
        ? -Math.floor(draftRaw / BOARD_WAGE_SLIDER_ROUNDS)
        : Math.floor((-draftRaw) / BOARD_WAGE_SLIDER_ROUNDS)
    const draftTransferDelta = -draftWageDelta * BOARD_WAGE_SLIDER_ROUNDS
    ui.boardSliderDraft = draftTransferDelta
    const span = sliderMax - sliderMin
    const sliderStep = span >= BOARD_WAGE_SLIDER_ROUNDS * 500
      ? BOARD_WAGE_SLIDER_ROUNDS * 100
      : span >= BOARD_WAGE_SLIDER_ROUNDS * 50
        ? BOARD_WAGE_SLIDER_ROUNDS * 10
        : BOARD_WAGE_SLIDER_ROUNDS

    const previewTransfer = m.transferBudget + draftTransferDelta
    const previewBaseWage = m.wageCap + draftWageDelta
    const previewEffWage = previewBaseWage + commercialBonus

    const canSwitch = canSwitchCurrentBoardAmbition(game)
    const ambitionLabel = BOARD_AMBITION_META[m.ambition].label

    currentSection = `
      <div class="grid two board-grid">
        ${panel(`第 ${m.seasonIndex} 赛季董事会目标`, `
          <div class="board-targets">
            <div class="board-target-item">
              <span class="muted small">联赛目标（权重 70%）</span>
              <b>${esc(worldTierLabel(m.tier))} · 前 ${m.leagueTarget} 名</b>
              <span class="small ${currentRank ? (leagueOnTrack ? 'up' : 'down') : 'muted'}">${currentRank ? `当前第 ${currentRank} 名 · ${leagueOnTrack ? '达标区间' : '暂未达标'}` : '开赛后统计'}</span>
            </div>
            <div class="board-target-item">
              <span class="muted small">${esc(BOARD_CUP_LABELS[m.cupId])}目标（权重 30%）</span>
              <b>${esc(BOARD_CUP_STAGE_LABELS[m.cupTarget])}</b>
              <span class="small ${cupStatus.cupPresent ? (cupOnTrack ? 'up' : 'muted') : 'muted'}">${cupStatus.cupPresent ? `当前进度：${esc(BOARD_CUP_STAGE_LABELS[cupStatus.stage])}` : '第 6 轮后按排名抽签产生'}</span>
            </div>
          </div>
          <div class="board-meta-strip">
            <span>档位：<b>${esc(ambitionLabel)}</b> ${m.locked ? tag('已锁定', '') : tag(`第 ${BOARD_CHOICE_MAX_ROUND} 轮前可调`, 'gold')}</span>
            <span>赛季初战力预估：<b>第 ${m.powerRank} / ${m.totalClubs}</b></span>
            <span>达标 / 超额奖金：<b class="num-text">${m.meetBonus.toLocaleString()} / ${m.exceedBonus.toLocaleString()}</b></span>
          </div>
          <div class="board-budget-kpis">
            <div class="board-kpi">
              <span class="muted small">独立转会预算</span>
              <b class="num-text">${m.transferBudget.toLocaleString()}</b>
              <small class="muted">初始 ${m.initialTransferBudget.toLocaleString()} · 优先抵扣买人，用完可用余额${committed > 0 ? ` · 竞拍占 ${committed.toLocaleString()}` : ''}</small>
            </div>
            <div class="board-kpi">
              <span class="muted small">独立设施预算</span>
              <b class="num-text">${m.facilityBudget.toLocaleString()}</b>
              <small class="muted">初始 ${m.initialFacilityBudget.toLocaleString()} · 优先抵扣设施升级，用完可用余额</small>
            </div>
            <div class="board-kpi ${wageHeadroom < 0 ? 'over-cap' : ''}">
              <span class="muted small">每轮有效工资帽</span>
              <b class="num-text">${wages.toLocaleString()} / ${effectiveCap.toLocaleString()}</b>
              <small class="${wageHeadroom < 0 ? 'down' : 'muted'}">${wageHeadroom >= 0 ? `剩余空间 +${wageHeadroom.toLocaleString()}/轮` : `已超帽 ${(-wageHeadroom).toLocaleString()}/轮（禁签高薪新援）`} · 基础 ${m.wageCap.toLocaleString()} + 商业 ${commercialBonus.toLocaleString()}</small>
            </div>
          </div>
        `)}
        ${panel('转会预算 ↔ 工资帽调拨滑块', `
          <p class="hint">按 <b>${BOARD_WAGE_SLIDER_ROUNDS} : 1</b>（1 赛季 38 轮）自由在转会预算与每轮基础工资帽之间划转额度；<b>设施预算严格独立，不参与滑块调拨</b>。</p>
          <div class="board-slider-box">
            <div class="board-slider-ends">
              <span class="small muted">← 转入工资帽（最多 +${(bounds?.maxWageDelta ?? 0).toLocaleString()}/轮）</span>
              <span class="small muted">转入转会预算（最多 +${(bounds?.maxTransferDelta ?? 0).toLocaleString()}）→</span>
            </div>
            <input id="board-budget-slider" type="range" min="${sliderMin}" max="${sliderMax}" step="${sliderStep}" value="${draftTransferDelta}" ${sliderMin === sliderMax ? 'disabled' : ''} aria-label="转会预算与工资帽滑块">
            <div class="board-slider-preview" data-board-slider-preview data-base-transfer="${m.transferBudget}" data-base-wage="${m.wageCap}" data-commercial="${commercialBonus}" data-wages="${wages}">
              <div>
                <span class="muted small">调整后转会预算</span>
                <b class="num-text" data-board-preview-transfer>${previewTransfer.toLocaleString()}</b>
                <small class="${draftTransferDelta > 0 ? 'up' : draftTransferDelta < 0 ? 'down' : 'muted'}" data-board-preview-tdelta>${draftTransferDelta === 0 ? '未变动' : `${draftTransferDelta > 0 ? '+' : ''}${draftTransferDelta.toLocaleString()}`}</small>
              </div>
              <div>
                <span class="muted small">调整后有效工资帽 / 轮</span>
                <b class="num-text" data-board-preview-wage>${previewEffWage.toLocaleString()}</b>
                <small class="${draftWageDelta > 0 ? 'up' : draftWageDelta < 0 ? 'down' : 'muted'}" data-board-preview-wdelta>${draftWageDelta === 0 ? `基础 ${m.wageCap.toLocaleString()} + 商业 ${commercialBonus.toLocaleString()}` : `${draftWageDelta > 0 ? '+' : ''}${draftWageDelta.toLocaleString()}/轮（基础 ${previewBaseWage.toLocaleString()}）`}</small>
              </div>
            </div>
            <div class="board-slider-actions">
              <button class="btn small primary" data-action="board-slider-apply" data-board-slider-apply ${draftTransferDelta === 0 ? 'disabled' : ''}>应用调整</button>
              <button class="btn small ghost" data-action="board-slider-reset" data-board-slider-reset ${draftTransferDelta === 0 ? 'disabled' : ''}>重置</button>
              ${m.sliderShift !== 0 ? `<span class="muted small">本季累计滑块净调拨：转会预算 ${m.sliderShift > 0 ? '+' : ''}${m.sliderShift.toLocaleString()}</span>` : ''}
            </div>
          </div>
        `)}
      </div>
      ${canSwitch ? panel(`开季目标确认与档位切换（第 ${game.season.round} / ${BOARD_CHOICE_MAX_ROUND} 轮可调）`, `
        <p class="hint">开季前 ${BOARD_CHOICE_MAX_ROUND} 轮内可切换目标档位（按新旧档位差额实时调整独立预算与工资帽，不影响俱乐部自有余额），第 ${BOARD_CHOICE_MAX_ROUND + 1} 轮起自动锁定。</p>
        <div class="board-options">${m.options.map((opt) => boardOptionCard(opt, opt.ambition === m.ambition, 'current', false)).join('')}</div>
        <div class="board-lock-row">
          <button class="btn small ghost" data-action="board-choose" data-ambition="${m.ambition}" data-scope="current" data-lock="1">确认并立即锁定「${esc(ambitionLabel)}」</button>
        </div>
      `) : ''}
    `
  } else if (!game.season.finished) {
    currentSection = panel('第 1 赛季保护期（未启用预算与工资帽限制）', `
      <ul class="rule-list">
        <li>${icon('info', 13)}第 1 赛季由董事会全额承担球员工资，不限制转会预算、设施预算或工资帽，方便新俱乐部完成初步建队。</li>
        <li>${icon('flag', 13)}第 38 轮常规赛结束进入休赛期后，董事会将立即发布<b>第 2 赛季三档目标方案</b>（稳妥 / 基准 / 野心），供你提前选择并预览下赛季独立预算。</li>
        <li>${icon('coin', 13)}第 2 赛季起，每赛季换季时直接拨付独立的<b>转会预算</b>与<b>设施预算</b>（均优先抵扣，用完可用自有余额），并严格启用<b>每轮工资帽</b>与 <b>38 : 1 转会↔工资帽滑块</b>；未完成目标将扣减信任度并削减下赛季预算。</li>
      </ul>
    `)
  }

  let offseasonSection = ''
  if (game.season.finished && board.offseasonPreview) {
    const prev = board.offseasonPreview
    if (!prev.confirmed) {
      const pickedD1: BoardAmbition = board.pendingChoicesByTier?.division1 ?? 'expected'
      const pickedD2: BoardAmbition = board.pendingChoicesByTier?.division2 ?? 'expected'
      const hasD1Picked = !!board.pendingChoicesByTier?.division1
      const hasD2Picked = !!board.pendingChoicesByTier?.division2
      offseasonSection = panel(`休赛期通知 · 升级杯激战中，请分别为「升级 / 留级」各预选一套第 ${prev.nextSeasonIndex} 赛季方案`, `
        <div class="banner gold">
          ${icon('clock', 16)}
          <b>正在争夺升级席位 · 支持双情景提前预选（换季自动匹配真实级别）</b>
          <span>升精英预选：<b>${esc(BOARD_AMBITION_META[pickedD1].label)}</b>${hasD1Picked ? '' : '（默认）'} · 留先锋预选：<b>${esc(BOARD_AMBITION_META[pickedD2].label)}</b>${hasD2Picked ? '' : '（默认）'}</span>
        </div>
        <p class="hint">预算系数 ${Math.round(prev.budgetMultiplier * 100)}% · 工资帽系数 ${Math.round(prev.wageMultiplier * 100)}%。现在就能把「升入精英」和「留在先锋」两套意向都选好，换季时系统自动按升级杯最终结果生效对应那一套；开季前 ${BOARD_CHOICE_MAX_ROUND} 轮内仍可调整。</p>
        ${prev.promotionOptions?.length ? `<h4 class="board-scenario-title">${tag('情景一', 'good')} 若升级杯成功升入「精英联赛」· 当前预选：<b>${esc(BOARD_AMBITION_META[pickedD1].label)}</b>${hasD1Picked ? '' : '<small class="muted">（默认）</small>'}</h4>
        <div class="board-options">${prev.promotionOptions.map((opt) => boardOptionCard(opt, opt.ambition === pickedD1, 'offseason', false, 'division1')).join('')}</div>` : ''}
        <h4 class="board-scenario-title">${tag('情景二', 'info')} 若升级杯未出线留在「先锋联赛」（战力预估第 ${prev.powerRank}/${prev.totalClubs}）· 当前预选：<b>${esc(BOARD_AMBITION_META[pickedD2].label)}</b>${hasD2Picked ? '' : '<small class="muted">（默认）</small>'}</h4>
        <div class="board-options">${prev.options.map((opt) => boardOptionCard(opt, opt.ambition === pickedD2, 'offseason', false, 'division2')).join('')}</div>
      `)
    } else {
      const picked: BoardAmbition = board.pendingChoicesByTier?.[prev.projectedTier] ?? board.pendingChoice ?? 'expected'
      offseasonSection = panel(`休赛期通知 · 第 ${prev.nextSeasonIndex} 赛季董事会目标与预算预选`, `
        <div class="banner good">
          ${icon('star', 16)}
          <b>下赛季级别已确认：${esc(worldTierLabel(prev.projectedTier))}</b>
          <span>战力预估第 ${prev.powerRank}/${prev.totalClubs} · 预算系数 ${Math.round(prev.budgetMultiplier * 100)}% · 工资帽系数 ${Math.round(prev.wageMultiplier * 100)}% · 当前预选：<b>${esc(BOARD_AMBITION_META[picked].label)}</b></span>
        </div>
        <p class="hint">休赛期可随时更改预选档位，换季开启第 ${prev.nextSeasonIndex} 赛季时自动按所选档位发放独立转会预算与设施预算（未选默认「基准档」）；开季前 ${BOARD_CHOICE_MAX_ROUND} 轮内仍可最后调整一次。</p>
        <div class="board-options">${prev.options.map((opt) => boardOptionCard(opt, opt.ambition === picked, 'offseason', false, prev.projectedTier)).join('')}</div>
      `)
    }
  }

  const historyRows = board.history.map((entry) => {
    const grade = BOARD_GRADE_META[entry.grade]
    const delta = entry.confidenceAfter - entry.confidenceBefore
    return `<tr>
      <td class="strong">第 ${entry.seasonIndex} 赛季</td>
      <td>${esc(worldTierLabel(entry.tier))}</td>
      <td>${esc(BOARD_AMBITION_META[entry.ambition].label)}</td>
      <td class="num">前 ${entry.leagueTarget} / <b>第 ${entry.leagueActual}</b></td>
      <td>${esc(BOARD_CUP_LABELS[entry.cupId])} ${esc(BOARD_CUP_STAGE_LABELS[entry.cupTarget])} / <b>${esc(BOARD_CUP_STAGE_LABELS[entry.cupActual])}</b></td>
      <td>${tag(grade.label, grade.tone)}</td>
      <td class="num ${delta >= 0 ? 'up' : 'down'}">${entry.confidenceBefore} → ${entry.confidenceAfter} (${delta >= 0 ? '+' : ''}${delta})</td>
      <td class="num">${entry.bonusPaid > 0 ? `+${entry.bonusPaid.toLocaleString()}` : '<span class="muted">—</span>'}</td>
      <td class="num">${Math.round(entry.nextBudgetMultiplier * 100)}%</td>
    </tr>`
  }).join('')

  const historySection = panel(`历年董事会考核 <small>${board.history.length}</small>`, historyRows
    ? `<div class="table-scroll"><table class="dt"><thead><tr><th>赛季</th><th>联赛</th><th>档位</th><th class="num">联赛目标 / 实际</th><th>杯赛目标 / 实际</th><th>评级</th><th class="num">信任度变化</th><th class="num">奖金</th><th class="num">下季预算倍率</th></tr></thead><tbody>${historyRows}</tbody></table></div>`
    : '<p class="muted pad">暂无考核记录。第 2 赛季起，每赛季换季结算后将在此记录董事会评定结果与下季预算奖惩。</p>', { flush: true })

  return `${offseasonSection}${headerCard}${currentSection}${historySection}`
}

function facilitiesTab(): string {
  const economy = economyOf(game)
  const boardActive = isBoardBudgetActive(game)
  const facilityBudget = boardActive ? game.board!.current!.facilityBudget : null
  const initialFacilityBudget = boardActive ? game.board!.current!.initialFacilityBudget : null
  const rows = (Object.keys(FACILITIES) as FacilityId[]).map((id) => {
    const info = FACILITY_INFO[id]
    const stage = economy[id]
    const level = facilityLevel(stage)
    const cost = facilityUpgradeCost(id, stage)
    const income = facilityRoundIncome(economy, id)
    const chance = Math.round(facilityStageChance(stage) * 100)
    const effectText = id === 'stadium'
      ? `${info.effect}；仅主场收门票，主场全队约 +${Math.round(homeAtmosphereBonus(stage) * MAIN_ATTR_SCALE)} 主属性氛围`
      : info.effect
    const incomeCell = income
      ? `${income.toLocaleString()}${id === 'stadium' ? '<small class="muted"> / 主场</small>' : ''}`
      : '<span class="muted">—</span>'
    const availBudget = facilityBudget ?? 0
    const lackedFunds = cost !== null && availBudget + economy.balance < cost
    const disabledReason = cost === null ? '已满级' : lackedFunds ? (availBudget > 0 ? '设施预算与余额合计不足' : '余额不足') : ''
    const payHint = cost !== null && !lackedFunds && facilityBudget !== null
      ? availBudget >= cost
        ? `优先扣除独立设施预算 ${cost.toLocaleString()}（不扣余额）`
        : availBudget > 0
          ? `扣除剩余设施预算 ${availBudget.toLocaleString()} + 余额 ${(cost - availBudget).toLocaleString()}`
          : `设施预算已用完，使用俱乐部余额 ${cost.toLocaleString()} 升级`
      : ''
    return `<tr>
      <td><span class="facility-name">${icon(info.icon, 16)}<b>${info.label}</b><span class="lv">LV${level}</span></span></td>
      <td>${stagePips(stage)}<small class="muted stage-count">${facilityStageInLevel(stage)} / ${STAGES_PER_LEVEL}</small></td>
      <td class="num">${GROWTH_FACILITIES.has(id) ? `${chance}%` : '<span class="muted">—</span>'}</td>
      <td class="num">${incomeCell}</td>
      <td class="dim wrap">${effectText}</td>
      <td class="num"><button class="btn small" data-action="club-upgrade" data-facility="${id}" ${disabledReason ? `disabled title="${esc(disabledReason)}"` : payHint ? `title="${esc(payHint)}"` : ''}>${cost === null ? '已满级' : `升级 · ${cost.toLocaleString()}`}</button></td>
    </tr>`
  }).join('')
  const minAtmo = Math.round(HOME_ATMOSPHERE_BASE * MAIN_ATTR_SCALE)
  const maxAtmo = Math.round((HOME_ATMOSPHERE_BASE + HOME_STADIUM_MAX_BONUS) * MAIN_ATTR_SCALE)
  const budgetBanner = boardActive
    ? `<div class="banner ${facilityBudget! > 0 ? 'info' : 'gold'}">${icon('coin', 16)}<b>本赛季独立设施预算：剩余 ${facilityBudget!.toLocaleString()} / 初始 ${initialFacilityBudget!.toLocaleString()}</b><span>升级设施优先扣除独立设施预算（不扣余额）；设施预算不足或用完后，自动使用俱乐部余额补足，两者互不冲突。</span><button class="btn small ghost" data-action="go-club" data-tab="board">查看董事会</button></div>`
    : ''
  return `${budgetBanner}<div class="grid club-grid">
    ${panel('俱乐部设施', `<div class="table-scroll"><table class="dt"><thead><tr><th>设施</th><th>阶段</th><th class="num">成长概率</th><th class="num">每轮 / 主场收入</th><th>加成效果</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`, { flush: true })}
    ${panel('设施规则', `<ul class="rule-list">
      <li>${icon('coin', 13)}每轮保底 ${BASE_ROUND_INCOME.toLocaleString()}；球迷每人贡献 2，球场、商店、赞助收入随球迷规模增长（最多按 4 倍计算）；其中<b>球场门票仅联赛主场发放</b>。</li>
      <li>${icon('stadium', 13)}球场在联赛/杯赛主场为全队提供微弱主场氛围加成（LV1 约 +${minAtmo} 至 LV5 满级约 +${maxAtmo} 主属性有效值），客场及中立挑战赛不生效。</li>
      <li>${icon('flag', 13)}联赛比分推动球迷增长：胜场与进球越多，下一轮收入越高；本轮每进一球另得 ${GOAL_INCOME_BONUS.toLocaleString()}，胜场加 ${LEAGUE_WIN_BONUS.toLocaleString()} + 球迷数的 35%。友谊赛不计收入或涨粉。</li>
      <li>${icon('training', 13)}培养免费，仅消耗 30 精力；设施共 ${MAX_FACILITY_LEVEL} 个等级、每级 ${STAGES_PER_LEVEL} 个阶段（合计 ${MAX_FACILITY_STAGE} 个阶段）。第 ${STAGES_PER_LEVEL} 阶段会升到下一等级，费用明显高于同级的前几个阶段。</li>
      <li>${icon('bag', 13)}球迷商店和赞助商只提高每轮余额收入，不再提供属性成长；其每轮收入的 ${Math.round(BOARD_COMMERCIAL_WAGE_SHARE * 100)}% 将在第 2 赛季起转化为额外董事会工资帽空间。</li>
      <li>${icon('up', 13)}每次培养或事件里，设施加成分两段独立判定：每个等级的第 ${STAGES_PER_LEVEL} 阶段必定触发，等级内其余阶段从该等级的下限线性上升（1 级 20%–100%、2 级 50%–100%、3 级 70%–100%、4 级 80%–100%、5 级 85%–100%）。升级不会让期望成长倒退。</li>
      <li>${icon('cap', 13)}设施提供额外成长，每项主属性各有自己的上限（由球员画像决定，通常不到 1500）。</li>
      <li>${icon('cross', 13)}每次行动或事件中，仅对基础成长为正的属性加成；例如医疗 3 级为每项符合条件的身体主属性额外 +${3 * CATEGORY_BONUS_PER_LEVEL}，球场另计。</li>
      <li>${icon('info', 13)}休息和位置训练不提供额外属性成长；属性达到上限后不再增长。</li>
      <li>${icon('clock', 13)}第 1 赛季单轮培养 15 天（30 时段），第 2 赛季延长 5 天至 20 天（40 时段），第 3 赛季起再延长 5 天至 25 天（50 时段），且第 3 周非比赛日（周二至周四、周六至周日）为国外特训，仅常规训练属性成长 ×3，同时技能卡装备上限提升至 5 张；设施等级在开始培养时锁定，升级从下一次培养生效。</li>
    </ul>`)}
  </div>`
}

function contractsTab(): string {
  const rows = [...game.roster]
    .sort((a, b) => (a.contract?.expiresSeason ?? 0) - (b.contract?.expiresSeason ?? 0) || playerCA(b) - playerCA(a))
    .map((player) => {
      const basePreview = previewContractRenewal(game, player)
      const draftYears = ui.renewYearsByPlayer[player.id]
      const chosenYears = draftYears !== undefined && basePreview.availableYears.includes(draftYears) ? draftYears : undefined
      const preview = chosenYears === undefined ? basePreview : previewContractRenewal(game, player, chosenYears)
      const expiryBadge = !player.contract
        ? ''
        : preview.remainingSeasons <= 0
          ? tag('本季到期', 'gold')
          : preview.remainingSeasons === 1
            ? tag('余 1 季', 'dim')
            : tag(`余 ${preview.remainingSeasons} 季`, 'dim')
      const renewals = player.contract?.renewals ?? 0
      const demandCell = preview.canRenew
        ? `<div class="contract-demand">
            <div>→ <b>${preview.demandedWage.toLocaleString()}</b>/轮 ${preview.raiseAmount > 0 ? `<span class="down">+${preview.raiseAmount.toLocaleString()} (+${preview.raisePct}%)</span>` : '<span class="dim">已封顶</span>'}</div>
            <small class="dim">至第 ${preview.nextExpiresSeason} 赛季 · 要求 ${preview.preferredYears} 年${preview.isEarlyRenewal ? ' · 提前续约' : ''}</small>
          </div>`
        : `<span class="dim">已签满 5 年</span>`
      const renewControl = preview.canRenew
        ? `<select class="contract-years-select" data-renew-years="${esc(player.id)}" aria-label="续约年限">${preview.availableYears.map((y) => `<option value="${y}" ${y === preview.years ? 'selected' : ''}>${y} 年${y === preview.preferredYears ? '·要求' : ''}</option>`).join('')}</select><button class="btn small ${preview.isEarlyRenewal ? '' : 'primary'}" data-action="contract-renew" data-player="${esc(player.id)}" data-years="${preview.years}">${preview.isEarlyRenewal ? '提前续约' : '续约'}</button>`
        : `<button class="btn small" disabled title="${esc(preview.reason ?? '已签满 5 年')}">已签满</button>`
      return `<tr data-key="${esc(player.id)}">
        <td>${posBadge(primaryPosition(player))}</td>
        ${nameCell(player)}
        <td class="num">${player.age ?? 24}</td>
        <td class="num strong">${caHeat(playerCA(player))}</td>
        <td class="num">${player.contract ? `第 ${player.contract.expiresSeason} 赛季` : '—'} ${expiryBadge}</td>
        <td class="num">${player.contract?.wage?.toLocaleString() ?? '—'}${renewals > 0 ? `<small class="dim block-sub">已续 ${renewals} 次</small>` : ''}</td>
        <td class="num">${demandCell}</td>
        <td class="num dim">${bestMarketValue(game, player).toLocaleString()}</td>
        <td class="num actions-cell">${renewControl}<button class="btn small ghost" data-action="contract-release" data-player="${esc(player.id)}">解约</button></td>
      </tr>`
    }).join('')
  const wages = worldWageBill(game)
  const cap = boardEffectiveWageCap(game)
  const headroom = cap === null ? null : cap - wages
  const capBanner = cap !== null
    ? `<div class="banner ${headroom! >= 0 ? 'info' : 'bad'}">${icon('coin', 16)}<b>每轮工资 ${wages.toLocaleString()} / 有效工资帽 ${cap.toLocaleString()}</b><span>${headroom! >= 0 ? `剩余薪资空间 +${headroom!.toLocaleString()}/轮（含商业设施 30% 加成）` : `已超出工资帽 ${(-headroom!).toLocaleString()}/轮：不能签入高薪新援或加薪续约`}</span><button class="btn small ghost" data-action="go-club" data-tab="board">调整工资帽滑块</button></div>`
    : ''
  return `${capBanner}${panel('合同与工资', `<div class="table-scroll"><table class="dt"><thead><tr><th>位置</th><th>球员</th><th class="num">龄</th><th class="num">CA</th><th class="num">合同至</th><th class="num">现工资 / 轮</th><th class="num">续约要求（3–5 年）</th><th class="num">估值</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint pad">球员续约要求签订 3–5 年新合同（从当前赛季起算），每次续约均会根据现工资、培养成长与年限要求加薪；合同余 2–4 季时可随时「提前续约」（需延长到期赛季，并含少量提前锁定溢价），签满 5 年后暂无需再续。合同到期赛季结束后球员进入自由市场，阵容不足 18 人时自动保底续约；第 2 赛季起加薪续约与签约新援受董事会每轮有效工资帽限制。</p>`, { flush: true, aside: `<span class="muted small">每轮工资 ${wages.toLocaleString()}${cap !== null ? ` / 帽 ${cap.toLocaleString()}` : ''}</span>` })}`
}

export function renderClub(): string {
  const economy = economyOf(game)
  const wages = worldWageBill(game)
  const homeIncome = projectedRoundIncome(economy, game.season.tier, true)
  const awayIncome = projectedRoundIncome(economy, game.season.tier, false)
  const wagesDue = game.world && game.world.seasonIndex <= 1 ? 0 : wages
  const net = homeIncome - wagesDue
  const boardActive = isBoardBudgetActive(game)
  const cap = boardEffectiveWageCap(game)
  const body = ui.clubTab === 'board' ? boardTab() : ui.clubTab === 'contracts' ? contractsTab() : ui.clubTab === 'history' ? historyTab() : facilitiesTab()
  return `
    ${pageHead({ kicker: '俱乐部', title: ownName(game.clubName) })}
    ${renameRow()}
    <div class="kpi-row club-kpis">
      ${tile('余额', economy.balance.toLocaleString(), boardActive ? `转会预算 ${game.board!.current!.transferBudget.toLocaleString()} · 设施预算 ${game.board!.current!.facilityBudget.toLocaleString()}` : '')}
      ${tile('球迷', economy.fans.toLocaleString(), economy.lastFanChange === undefined ? '联赛赛果带动球迷增长' : `上轮 ${economy.lastFanChange >= 0 ? '+' : ''}${economy.lastFanChange.toLocaleString()}`)}
      ${tile('预计主场收入', homeIncome.toLocaleString(), economy.lastRoundIncome === undefined ? `客场 ${awayIncome.toLocaleString()}（无门票）` : `客场 ${awayIncome.toLocaleString()} · 上轮实收 ${economy.lastRoundIncome.toLocaleString()}`)}
      ${tile('每轮工资', wages.toLocaleString(), game.world && game.world.seasonIndex <= 1 ? '首赛季由董事会承担' : cap !== null ? `有效工资帽 ${cap.toLocaleString()}（${cap >= wages ? `余 +${(cap - wages).toLocaleString()}` : `超 ${(wages - cap).toLocaleString()}`}）` : `${game.roster.length} 名球员`)}
      ${tile('预计主场净收入', `<span class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${net.toLocaleString()}</span>`, `客场净 ${(awayIncome - wagesDue) >= 0 ? '+' : ''}${(awayIncome - wagesDue).toLocaleString()}（不含奖金交易）`)}
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((tab) => `<button class="tab ${ui.clubTab === tab.id ? 'active' : ''}" role="tab" aria-selected="${ui.clubTab === tab.id}" data-club-tab="${tab.id}">${tab.label}</button>`).join('')}
    </div>
    ${body}
  `
}
