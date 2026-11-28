import '../events.css'
import type { ElevenFormationId, Position, SkillBookId } from '../../game/types.ts'
import { caOf } from '../../game/ca.ts'
import { mainAttrsFor } from '../../game/scale.ts'
import { attrLabel } from '../../game/data/attributes.ts'
import { SKILLS } from '../../game/data/skills.ts'
import { skillEffectText } from '../../game/data/skill-effects.ts'
import { DETAILED_POSITION_LABELS } from '../../game/detailed-positions.ts'
import { FORMATIONS } from '../../game/data/formations.ts'
import { lineupRating } from '../../game/club-rating.ts'
import { hasLegendBook, legendBookLabel } from '../../game/legend-books.ts'
import {
  currentSeasonEnvironment,
  DRAFT_RANK_REWARDS,
  DRAFT_REWARD_BOOKS,
  DUPLICATE_ALL_BOOKS_SHOP_POINTS,
  ENABLED_SEASON_EVENT_MODES,
  ensureSeasonEvents,
  EVENT_STAGE_COUNT,
  eventDailyQuota,
  featuredEventForSeason,
  FREEKICK_REWARD_BOOKS,
  FREEKICK_STAGES,
  isSeasonEventModeEnabled,
  isSeasonEventsOpen,
  PENALTY_REWARD_BOOKS,
  PENALTY_STAGES,
  SEASON_EVENTS_MIN_SEASON,
  STAGE_3_REWARD_COINS,
  STAGE_6_REWARD_COINS,
  type SeasonEventMode,
} from '../../game/events/season-events.ts'
import {
  computeDraftStandings,
  DRAFT_PACK_ROUNDS,
  DRAFT_PICKS_PER_PACK,
  DRAFT_POOL_THEMES,
  DRAFT_SQUAD_TARGET,
  DRAFT_SWISS_ROUNDS,
  draftCardRarity,
  draftThemeForSeason,
  squadPositionCounts,
  type DraftCupState,
  type DraftPoolThemeId,
} from '../../game/events/draft-cup.ts'
import { environmentHudSummary, SURFACE_LABELS, WEATHER_LABELS } from '../../game/penalty/environment.ts'
import { isOnlineMode, serverNow } from '../../online.ts'
import { bookTitle, caHeat, icon, pageHead, panel, tag, tile } from '../components.ts'
import { countdownText, esc } from '../format.ts'
import { game, ui } from '../state.ts'

const EVENT_TITLES: Record<SeasonEventMode, { name: string; tag: string; desc: string }> = {
  penalty: {
    name: '十二码之夜',
    tag: '3D 点球大战',
    desc: '九关递进手动点球与扑救挑战，本季统一固定球场环境；支持无门将空门自由训练。',
  },
  freekick: {
    name: '任意球实验室',
    tag: '3D 定位球攻防',
    desc: '禁区外多球位弧线绕墙、电梯球急坠、贴地钻墙与后点冲顶配合；支持无门将/无人墙练习。',
  },
  draft: {
    name: '星秀轮抽杯',
    tag: '2D 八人轮抽瑞士轮',
    desc: '与 7 名不同流派 AI 同桌传包轮抽（每包 12 人先选 1 人传余包），选满 20 名 CA 800–1400 成品卡踢 2D 瑞士轮排位赛。',
  },
}

function renderEnvironmentCard(): string {
  const env = currentSeasonEnvironment(game)
  const info = environmentHudSummary(env)
  const tips =
    env.id === 'sahara'
      ? '狂沙横逆风下高球偏移显著，可瞄准门柱外侧借风兜入死角；松软沙地更利好挑射与后点高球配合。'
      : env.id === 'blizzard'
        ? '积雪球场启用冬歇期亮橙比赛用球！低平贴地球擦雪面会打滑窜射提速，慎用慢速高飘球顶逆风。'
        : env.id === 'monsoon'
          ? '暴雨湿滑大幅提高门将扑救脱手率，泥泞草地会拖慢贴地滚球，推荐半高重炮轰门制造脱手！'
          : env.id === 'gale'
            ? '16m/s 强劲东风横吹球门，远距离任意球可打出夸张外围大弧线，点球抽射更抗风偏。'
            : '晴朗无风标准草皮，最适合打磨各脚法绿区节奏与门将读秒预判。'
  return `<div class="env-showcase" data-weather="${env.weather}">
    <div class="env-meta">
      <div>${tag(`第 ${game.season.index} 赛季主场环境`, 'gold')} <b>${esc(env.label)} · ${esc(env.subtitle)}</b></div>
      <small>${esc(tips)}</small>
    </div>
    <div class="env-pills">
      ${tag(`风场：${info.windText}`, info.hasWind ? 'warn' : '')}
      ${tag(`天气：${WEATHER_LABELS[env.weather]}`, '')}
      ${tag(`场地：${SURFACE_LABELS[env.surface]}`, 'good')}
    </div>
  </div>`
}

function renderRewardBooksPanel(mode: 'penalty' | 'freekick'): string {
  const ev = ensureSeasonEvents(game)
  const track = ev[mode]
  const books = mode === 'penalty' ? PENALTY_REWARD_BOOKS : FREEKICK_REWARD_BOOKS
  const cleared9 = track.cleared >= EVENT_STAGE_COUNT
  const done = Boolean(track.chosenBook || track.shopFallbackClaimed)
  const allOwned = books.every((id) => hasLegendBook(game, id, 'rainbow'))

  const cards = books
    .map((bookId) => {
      const owned = hasLegendBook(game, bookId, 'rainbow')
      const chosen = track.chosenBook === bookId
      const sk = SKILLS[bookId]
      return `<div class="reward-book-card">
        <div>
          <div class="row-between">${bookTitle(legendBookLabel({ id: bookId, tier: 'rainbow' }), 'rainbow')} ${
            chosen ? tag('本季已选', 'gold') : owned ? tag('已拥有', 'good') : tag('可选大奖', '')
          }</div>
          <p class="hint" style="margin:8px 0 0">${esc(sk?.desc ?? '')}</p>
          ${skillEffectText(bookId, 'rainbow') ? `<p class="hint" style="margin:4px 0 0">${esc(skillEffectText(bookId, 'rainbow'))}</p>` : ''}
        </div>
        <button class="btn ${cleared9 && !done && (!owned || allOwned) ? 'primary' : 'small'}" data-action="event-claim-book" data-event-mode="${mode}" data-book="${bookId}" ${
          !cleared9 || done || (owned && !allOwned) ? 'disabled' : ''
        }>${
          chosen
            ? '已领取'
            : allOwned
              ? `全齐折算 +${DUPLICATE_ALL_BOOKS_SHOP_POINTS} 点券`
              : owned
                ? '已拥有此书'
                : cleared9
                  ? '选择领取此彩书'
                  : '通关第 9 关解锁'
        }</button>
      </div>`
    })
    .join('')

  return panel(
    `通关奖励 · 第 3/6 关首通发金币，第 9 关主题彩书三选一`,
    `<div class="pad" style="padding-bottom:0">
      <span>第 3 关首通：<b>${STAGE_3_REWARD_COINS.toLocaleString()} 金币</b> ${track.stage3Claimed ? tag('已到账', 'good') : tag('待通关自动发放', '')}</span>
      <span style="margin-left:16px">第 6 关首通：<b>${STAGE_6_REWARD_COINS.toLocaleString()} 金币</b> ${track.stage6Claimed ? tag('已到账', 'good') : tag('待通关自动发放', '')}</span>
    </div>
    <div class="reward-books-row">${cards}</div>`,
    { flush: true },
  )
}

function render3DStageEvent(mode: 'penalty' | 'freekick', now: number): string {
  const ev = ensureSeasonEvents(game, now)
  const track = ev[mode]
  const quota = eventDailyQuota(game, now)
  const stages = mode === 'penalty' ? PENALTY_STAGES : FREEKICK_STAGES
  const currentStage = Math.min(EVENT_STAGE_COUNT, track.cleared + 1)
  const practiceAction = mode === 'penalty' ? 'penalty-training' : 'freekick-training'

  const stageCards = stages
    .map((st) => {
      const isDone = st.stage <= track.cleared
      const isCurrent = st.stage === currentStage && track.cleared < EVENT_STAGE_COUNT
      const isLocked = st.stage > track.cleared + 1
      const canStart = !isLocked && quota.remaining > 0 && !game.activeMatch
      return `<article class="event-stage-card ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''} ${isLocked ? 'is-locked' : ''}">
        <div>
          <div class="event-stage-top">
            <span class="event-stage-num">STAGE 0${st.stage}</span>
            ${isDone ? tag('已过关', 'good') : isCurrent ? tag('当前挑战', 'gold') : tag('待解锁', '')}
          </div>
          <h4 style="margin:6px 0 4px">${esc(st.title)} <small class="muted">· ${esc(st.sceneDesc)}</small></h4>
          <p class="event-stage-goal">${esc(st.goalDesc)}</p>
        </div>
        <button class="btn ${isCurrent ? 'primary' : 'small'}" data-action="event-start-stage" data-event-mode="${mode}" data-stage="${st.stage}" ${
          canStart ? '' : 'disabled'
        }>${isLocked ? '需先过上一关' : quota.remaining <= 0 ? '今日次数已用完' : isDone ? '重温本关（扣1次）' : `挑战第 ${st.stage} 关`}</button>
      </article>`
    })
    .join('')

  return `
    ${renderEnvironmentCard()}
    <div class="toolbar">
      <strong>3D 自由训练场（含无门将空门模式 & 全赛季环境切换）</strong>
      <button class="btn primary" data-action="${practiceAction}">${icon('play', 14)}进入${mode === 'penalty' ? ' 3D 点球训练场' : ' 3D 任意球实验室'}</button>
      <small class="muted">不扣每日挑战次数 · 可自由练无门将空门、狂风沙暴与雪地亮橙球</small>
    </div>
    ${panel(
      `${EVENT_TITLES[mode].name} · 九关挑战进度（已过 ${track.cleared} / ${EVENT_STAGE_COUNT} 关）`,
      `<p class="hint pad" style="padding-bottom:0">每次开启正式关卡消耗 1 次今日挑战机会（失败留在本关，过关推进进度；北京时间每日 00:00 刷新 ${quota.limit} 次，下次刷新：${esc(countdownText(quota.resetAt - now))}）。活动不消耗联赛体能、不产生伤病。</p>
      <div class="event-stage-grid">${stageCards}</div>`,
      { flush: true },
    )}
    ${renderRewardBooksPanel(mode)}
  `
}

function primaryPositionOf(positions: Record<Position, number>): Position {
  if (positions.GK > 0) return 'GK'
  return (['CB', 'W', 'CM', 'ST'] as Position[]).sort((a, b) => positions[b] - positions[a])[0]
}

function primaryDetailedOf(p: import('../../game/types.ts').Player): string {
  const entries = Object.entries(p.detailedPositions ?? {}) as [keyof typeof DETAILED_POSITION_LABELS, number][]
  if (!entries.length) return primaryPositionOf(p.positions)
  entries.sort((a, b) => b[1] - a[1])
  return `${DETAILED_POSITION_LABELS[entries[0][0]]} (${entries[0][0]})`
}

function renderDraftPhase(draft: DraftCupState): string {
  const theme = DRAFT_POOL_THEMES[draft.themeId]
  const playerSeat = draft.seats[0]
  const counts = squadPositionCounts(playerSeat.players)
  const currentPack = draft.seatPacks[0] ?? []
  const passDir = draft.packRound % 2 === 1 ? '顺时针传给下家 AI →' : '← 逆时针传给上家 AI'

  const podSeats = draft.seats
    .map(
      (s) => `<div class="draft-seat-chip ${s.isPlayer ? 'is-player' : ''}">
        <b>${s.seat + 1}号位 · ${esc(s.isPlayer ? '你' : s.name)}</b>
        <small>${esc(s.coachTitle)} · 已选 ${s.players.length}/${DRAFT_SQUAD_TARGET}</small>
      </div>`,
    )
    .join('')

  const packCards = currentPack
    .map((card) => {
      const isGk = card.positions.GK > 0
      const ca = caOf(card.attrs, isGk)
      const rarity = draftCardRarity(ca)
      const topAttrs = [...mainAttrsFor(isGk)]
        .sort((a, b) => card.attrs[b] - card.attrs[a])
        .slice(0, 4)
      const skillsHtml = card.skills
        .map((skId) => {
          const tier = card.skillTiers?.[skId] ?? 'silver'
          return tag(esc(SKILLS[skId]?.name ?? skId), `skill-${tier}`)
        })
        .join('')
      return `<article class="draft-card" data-rarity="${rarity}">
        <div>
          <div class="draft-card-head">
            <div>
              <b>${esc(card.name)}</b> <small class="muted">${card.age}岁</small>
              <div class="muted small" style="margin-top:2px">${esc(primaryDetailedOf(card))}</div>
            </div>
            <div style="text-align:right">
              ${caHeat(ca)}
              <div style="margin-top:3px">${tag(rarity === 'rainbow' ? '传世彩卡' : rarity === 'gold' ? '核心金卡' : '成型银卡', rarity === 'rainbow' ? 'gold' : '')}</div>
            </div>
          </div>
          <div class="draft-card-attrs" style="margin-top:10px">
            ${topAttrs.map((k) => `<span>${esc(attrLabel(k))} <b>${Math.round(card.attrs[k])}</b></span>`).join('')}
          </div>
          <div class="draft-card-skills" style="margin-top:10px">${skillsHtml}</div>
        </div>
        <button class="btn primary" data-action="draft-pick-card" data-card="${esc(card.id)}">选入麾下（余 ${currentPack.length - 1} 张传给 AI）</button>
      </article>`
    })
    .join('')

  const draftedSummary = playerSeat.players.length
    ? `<div class="table-scroll"><table class="dt"><thead><tr><th>#</th><th>球员</th><th>位置</th><th>年龄</th><th class="num">成品 CA</th><th>携带技能</th></tr></thead><tbody>${playerSeat.players
        .map((p, idx) => {
          const ca = caOf(p.attrs, p.positions.GK > 0)
          return `<tr><td>${idx + 1}</td><td><b>${esc(p.name)}</b></td><td>${esc(primaryDetailedOf(p))}</td><td>${p.age}</td><td class="num">${caHeat(ca)}</td><td>${p.skills.map((s) => esc(SKILLS[s]?.name ?? s)).join('、')}</td></tr>`
        })
        .join('')}</tbody></table></div>`
    : '<p class="muted pad">请从上方首包 12 名成品球员中挑走第 1 人！</p>'

  return `
    ${panel(
      `八人同桌轮抽台 · 第 ${draft.packRound}/${DRAFT_PACK_ROUNDS} 包 · 第 ${draft.pickInPack}/${DRAFT_PICKS_PER_PACK} 抓（${passDir}）`,
      `<div class="draft-pos-bar">
        ${tag(theme.label, 'gold')}
        <span>${esc(theme.ruleNote)}</span>
        <span style="margin-left:auto"><b>已选 ${playerSeat.players.length} / ${DRAFT_SQUAD_TARGET} 人</b>：门将 <b>${counts.GK}</b>（建议2）· 中卫 <b>${counts.CB}</b> · 边路 <b>${counts.W}</b> · 中场 <b>${counts.CM}</b> · 前锋 <b>${counts.ST}</b></span>
      </div>
      <div class="draft-pod-bar">${podSeats}</div>`,
      { flush: true },
    )}
    ${panel(
      `当前传到你面前的卡包（共 ${currentPack.length} 人可选 · CA 800–1400 满培养成品卡）`,
      `<div class="draft-pack-grid">${packCards}</div>`,
      { flush: true },
    )}
    ${panel(`已选入阵名单（${playerSeat.players.length} / ${DRAFT_SQUAD_TARGET}）`, draftedSummary, { flush: true })}
  `
}

function renderSwissAndFinishedPhase(draft: DraftCupState, now: number): string {
  const ev = ensureSeasonEvents(game, now)
  const theme = DRAFT_POOL_THEMES[draft.themeId]
  const standings = computeDraftStandings(draft)
  const playerRow = standings.find((r) => r.isPlayer)!
  const playerSeat = draft.seats[0]
  const formation = FORMATIONS[playerSeat.lineup.formationId]
  const playerRankScore = Math.round(lineupRating(playerSeat.players, playerSeat.lineup))
  const currentFixtures = draft.fixtures.filter((f) => f.round === draft.swissRound)
  const completedFixtures = draft.fixtures.filter((f) => f.played).reverse()

  const standingsHtml = `<div class="table-scroll"><table class="dt"><thead><tr><th>名次</th><th>轮抽战队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进/失</th><th>净胜</th><th class="num" title="交手对手总积分">对手分</th><th class="num">积分</th><th class="num">首发 RANK</th></tr></thead><tbody>${standings
    .map((row) => {
      const seat = draft.seats.find((s) => s.id === row.teamId)!
      const rk = Math.round(lineupRating(seat.players, seat.lineup))
      return `<tr class="${row.isPlayer ? 'own-row' : ''}"><td><b>#${row.rank}</b></td><td><b>${esc(row.name)}</b> <small class="muted">${esc(seat.coachTitle)}</small></td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.gf}:${row.ga}</td><td>${row.gd >= 0 ? `+${row.gd}` : row.gd}</td><td class="num">${row.buchholz}</td><td class="num strong">${row.points}</td><td class="num">${rk}</td></tr>`
    })
    .join('')}</tbody></table></div>`

  const currentRoundPanel =
    draft.phase === 'swiss'
      ? panel(
          `瑞士轮 · 第 ${draft.swissRound} / ${DRAFT_SWISS_ROUNDS} 轮对阵（同分优先配对 · 不重复交手）`,
          `<div class="rows">${currentFixtures
            .map((f) => {
              const h = draft.seats.find((s) => s.id === f.homeId)!
              const a = draft.seats.find((s) => s.id === f.awayId)!
              const mine = h.isPlayer || a.isPlayer
              return `<div class="row-line ${mine ? 'own-row' : ''}"><span>${mine ? tag('本轮焦点', 'gold') : ''} <b>${esc(h.name)}</b> vs <b>${esc(a.name)}</b></span><span>${
                f.played && f.score ? `<b>${f.score.home}:${f.score.away}</b>` : '待开赛'
              }</span></div>`
            })
            .join('')}</div>
          <div class="btn-row pad">
            <button class="btn primary" data-action="draft-play-live" ${game.activeMatch ? 'disabled' : ''}>${icon('play', 14)}进入 2D 直播执教本轮（支持换人/变阵/场边喊话）</button>
            <button class="btn" data-action="draft-sim-round" ${game.activeMatch ? 'disabled' : ''}>${icon('skip', 14)}一键快速结算第 ${draft.swissRound} 轮</button>
          </div>`,
          { flush: true },
        )
      : (() => {
          const rw = DRAFT_RANK_REWARDS[playerRow.rank] ?? DRAFT_RANK_REWARDS[8]
          const canBook = rw.canPickBook && !ev.draftBookChosen
          const selectedBook = ui.draftChosenBookId ?? DRAFT_REWARD_BOOKS.find((id) => !hasLegendBook(game, id, 'rainbow')) ?? DRAFT_REWARD_BOOKS[0]
          return panel(
            `瑞士轮全部结束 · 最终第 ${playerRow.rank} 名奖励结算`,
            `<div class="pad">
              <p style="margin:0 0 10px">你在 8 支轮抽战队中位列 <b>第 ${playerRow.rank} 名</b>（${playerRow.won}胜 ${playerRow.drawn}平 ${playerRow.lost}负 · ${playerRow.points} 分）！本档基础奖励：<b>${rw.money.toLocaleString()} 金币</b> + <b>商店点券 +${rw.shopPoints}</b>${rw.canPickBook ? ' + <b>自选主题彩书 ×1</b>' : ''}。</p>
              ${
                canBook
                  ? `<div class="form-row" style="max-width:420px;margin-bottom:10px"><label>前两名专属彩书三选一</label><select id="draft-reward-book">${DRAFT_REWARD_BOOKS.map(
                      (id) =>
                        `<option value="${id}" ${id === selectedBook ? 'selected' : ''} ${hasLegendBook(game, id, 'rainbow') ? 'disabled' : ''}>${legendBookLabel({ id, tier: 'rainbow' })}${hasLegendBook(game, id, 'rainbow') ? '（已拥有）' : ''}</option>`,
                    ).join('')}</select></div>`
                  : ''
              }
              <div class="btn-row">
                <button class="btn primary" data-action="draft-claim-reward" ${draft.rewardClaimed ? 'disabled' : ''}>${draft.rewardClaimed ? '本轮奖励已入账' : '领取瑞士轮排名奖励'}</button>
              </div>
            </div>`,
            { flush: true },
          )
        })()

  // 20-player lineup & bench swap table
  const starterMap = new Map(playerSeat.lineup.starters.map((s) => [s.playerId, formation.slots.find((sl) => sl.id === s.slotId)?.label ?? '首发']))
  const benchSet = new Set(playerSeat.lineup.bench)
  const swapAnchor = ui.draftSwapPlayerId
  const squadRows = playerSeat.players
    .map((p) => {
      const isGk = p.positions.GK > 0
      const ca = caOf(p.attrs, isGk)
      const slotLabel = starterMap.get(p.id)
      const statusTag = slotLabel ? tag(`首发 · ${slotLabel}`, 'good') : benchSet.has(p.id) ? tag('替补席', '') : tag('轮换待命', '')
      const selected = swapAnchor === p.id
      return `<tr class="draft-squad-row ${selected ? 'is-swap-selected' : ''}">
        <td>${statusTag}</td>
        <td><b>${esc(p.name)}</b> <small class="muted">${p.age}岁</small></td>
        <td>${esc(primaryDetailedOf(p))}</td>
        <td class="num">${caHeat(ca)}</td>
        <td>${Math.round(p.condition ?? 100)}%</td>
        <td>${p.skills.map((s) => esc(SKILLS[s]?.name ?? s)).join('、')}</td>
        <td>${
          draft.phase === 'swiss'
            ? `<button class="btn small ${selected ? 'primary' : ''}" data-action="draft-swap-pick" data-player="${esc(p.id)}">${
                selected ? '取消选中' : swapAnchor ? '与此人互换位置' : '调整上场'
              }</button>`
            : ''
        }</td>
      </tr>`
    })
    .join('')

  const formations: ElevenFormationId[] = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1']

  return `
    ${currentRoundPanel}
    ${panel(`瑞士轮实时积分榜（本季卡池：${theme.label} · ${theme.ruleNote}）`, standingsHtml, { flush: true })}
    ${panel(
      `你的 20 人轮抽阵容排布 · 首发总 RANK ${playerRankScore}`,
      `${
        draft.phase === 'swiss'
          ? `<div class="toolbar">
              <span>切换阵型</span>
              <div class="seg">${formations
                .map(
                  (fid) =>
                    `<button class="${playerSeat.lineup.formationId === fid ? 'active' : ''}" data-action="draft-set-formation" data-formation="${fid}">${fid}</button>`,
                )
                .join('')}</div>
              <button class="btn small" data-action="draft-auto-best">一键重排最强 11 人</button>
              <small class="muted">点选任意两名球员即可互换首发/替补席位</small>
            </div>`
          : ''
      }
      <div class="table-scroll"><table class="dt"><thead><tr><th>席位</th><th>球员</th><th>擅长位置</th><th class="num">成品 CA</th><th>体能</th><th>成型技能组</th><th></th></tr></thead><tbody>${squadRows}</tbody></table></div>`,
      { flush: true },
    )}
    ${
      completedFixtures.length
        ? panel(
            `已完赛战报（玩家场次支持完整 2D 录像回放）`,
            `<div class="rows">${completedFixtures
              .map((f) => {
                const h = draft.seats.find((s) => s.id === f.homeId)!
                const a = draft.seats.find((s) => s.id === f.awayId)!
                const scorers = f.scorers?.length ? ` · 进球：${f.scorers.map((s) => `${s.name}${s.goals > 1 ? `×${s.goals}` : ''}`).join('、')}` : ''
                return f.matchRecordId
                  ? `<button class="row-btn result-row" data-action="open-review" data-record="${esc(f.matchRecordId)}">${tag(`第${f.round}轮`, 'gold')}<span class="result-teams"><b>${esc(h.name)} ${f.score!.home}:${f.score!.away} ${esc(a.name)}</b><small class="muted">${esc(scorers)}</small></span><span class="muted small">看 2D 回放 ${icon('right', 12)}</span></button>`
                  : `<div class="row-line"><span>第${f.round}轮 · ${esc(h.name)} <b>${f.score!.home}:${f.score!.away}</b> ${esc(a.name)}</span><small class="muted">${esc(scorers)}</small></div>`
              })
              .join('')}</div>`,
            { flush: true },
          )
        : ''
    }
  `
}

function renderDraftEvent(now: number): string {
  const ev = ensureSeasonEvents(game, now)
  const quota = eventDailyQuota(game, now)
  const seasonDefaultTheme = draftThemeForSeason(game.season.index)
  const draft = ev.draft
  const activeTheme = draft ? DRAFT_POOL_THEMES[draft.themeId] : seasonDefaultTheme
  const selectedTheme: DraftPoolThemeId = ui.draftThemePreview ?? activeTheme.id

  const themeSelector = `<div class="toolbar">
    <span>赛季卡池词条（不用天气场地，每季换主题构筑）</span>
    <select id="draft-theme-select">${(Object.keys(DRAFT_POOL_THEMES) as DraftPoolThemeId[])
      .map((id) => `<option value="${id}" ${id === selectedTheme ? 'selected' : ''}>${DRAFT_POOL_THEMES[id].label}（${DRAFT_POOL_THEMES[id].ruleNote}）</option>`)
      .join('')}</select>
    <button class="btn ${!draft ? 'primary' : 'small'}" data-action="draft-start-new" ${
      draft && quota.remaining <= 0 ? 'disabled' : ''
    }>${!draft ? '免费开启本季首轮八人轮抽' : quota.remaining <= 0 ? '今日重抽次数已用完' : '开启新一轮轮抽（扣1次挑战）'}</button>
  </div>`

  if (!draft) {
    const preview = DRAFT_POOL_THEMES[selectedTheme]
    return `
      ${themeSelector}
      ${panel(
        `2D 星秀轮抽杯 · 玩法说明（本季主题：${preview.label}）`,
        `<div class="pad" style="line-height:1.75">
          <p style="margin:0 0 8px"><b>${esc(preview.summary)}</b></p>
          <ul style="margin:0;padding-left:18px;color:var(--text-2)">
            <li><b>八人传包轮抽</b>：你与 7 位不同战术流派的 AI 教练同桌。第一包打开 <b>12 名球员</b>，你先选走 1 人，剩余 11 人传给下家 AI，同时接过上家传来的 11 人包继续选；两轮大包各抓 10 人，每人选满 <b>20 名球员</b>组队。</li>
            <li><b>全员满练神卡</b>：所有候选均为练好后的成品卡，CA 介于 <b>800–1400</b> 之间，自带 3–5 项成型银/金/彩技能；仅在本活动内公平竞技，不带回正式联赛，也不消耗本队体能。</li>
            <li><b>2D 瑞士轮决胜</b>：8 支队伍进行 <b>${DRAFT_SWISS_ROUNDS} 轮瑞士轮</b>（同战绩优先配对、不重复交手），可亲自进入 <b>2D 实况球场</b> 临场换人喊话，也可一键快速结算；按最终名次领取金币、点券与前两名专属主题彩书！</li>
          </ul>
        </div>`,
        { flush: true },
      )}
    `
  }

  return `${themeSelector}${draft.phase === 'drafting' ? renderDraftPhase(draft) : renderSwissAndFinishedPhase(draft, now)}`
}

export function renderSeasonEvents(): string {
  if (!isSeasonEventsOpen(game)) {
    return `${pageHead({
      kicker: `SEASON EVENT · 第 ${game.season.index} 赛季`,
      title: '十二码之夜',
      sub: `点球活动将于第 ${SEASON_EVENTS_MIN_SEASON} 赛季（S3）正式开放。`,
    })}${panel(
      '活动暂未开放',
      `<p class="hint pad">当前处于第 ${game.season.index} 赛季，点球活动「十二码之夜」与 3D 训练场将在第 ${SEASON_EVENTS_MIN_SEASON} 赛季（S3）解锁。</p><div class="btn-row pad"><button class="btn" data-nav="challenge">返回挑战页</button></div>`,
      { flush: true },
    )}`
  }
  const now = isOnlineMode() ? serverNow() : Date.now()
  const ev = ensureSeasonEvents(game, now)
  const quota = eventDailyQuota(game, now)
  const featured = featuredEventForSeason(game.season.index)
  const activeMode: SeasonEventMode =
    ui.seasonEventMode && isSeasonEventModeEnabled(ui.seasonEventMode) ? ui.seasonEventMode : featured
  const meta = EVENT_TITLES[activeMode]
  const env = currentSeasonEnvironment(game)

  const summaryStatus =
    activeMode === 'draft'
      ? ev.draft
        ? ev.draft.phase === 'drafting'
          ? `轮抽进行中（已选 ${ev.draft.seats[0].players.length}/${DRAFT_SQUAD_TARGET} 人）`
          : ev.draft.phase === 'swiss'
            ? `瑞士轮第 ${ev.draft.swissRound}/${DRAFT_SWISS_ROUNDS} 轮`
            : `本轮完赛（最佳第 ${ev.draft.bestRank ?? computeDraftStandings(ev.draft).find((r) => r.isPlayer)?.rank ?? '-'} 名）`
        : '首轮免费开启八人轮抽'
      : `已过 ${ev[activeMode].cleared}/${EVENT_STAGE_COUNT} 关`

  return `
    ${pageHead({
      kicker: `SEASON EVENT · 第 ${game.season.index} 赛季主题活动`,
      title: meta.name,
      sub: meta.desc,
    })}
    <div class="events-hero">
      <div class="events-hero-main">
        <div class="events-hero-strip">
          ${tag(meta.tag, 'gold')}
          <b>${esc(meta.name)}</b>
          <span class="events-sep">｜</span>
          <span>进度：<b>${esc(summaryStatus)}</b></span>
          <span class="events-sep">｜</span>
          <span>今日剩余：<b>${quota.remaining} / ${quota.limit} 次</b></span>
          <span class="events-sep">｜</span>
          <span>${activeMode === 'draft' ? `卡池：<b>${esc(DRAFT_POOL_THEMES[ev.draft?.themeId ?? draftThemeForSeason(game.season.index).id].label)}</b>` : `本季环境：<b>${esc(env.label)}（${esc(env.subtitle)}）</b>`}</span>
        </div>
      </div>
      ${
        ENABLED_SEASON_EVENT_MODES.length > 1
          ? `<div class="seg" aria-label="切换活动玩法">
        ${ENABLED_SEASON_EVENT_MODES.map(
          (m) =>
            `<button class="${activeMode === m ? 'active' : ''}" data-action="switch-event-mode" data-event-mode="${m}">${EVENT_TITLES[m].name}${featured === m ? ' · 本季主打' : ''}</button>`,
        ).join('')}
      </div>`
          : ''
      }
    </div>
    <div class="kpi-row">
      ${tile('当前模式', meta.tag)}
      ${tile('活动进度', summaryStatus)}
      ${tile('今日剩余挑战', `${quota.remaining} / ${quota.limit}`, `00:00 刷新 · ${countdownText(quota.resetAt - now)}`)}
      ${tile('主大奖', activeMode === 'draft' ? '前二自选彩书 + 百万奖金' : '第9关自选主题彩书')}
    </div>
    ${activeMode === 'draft' ? renderDraftEvent(now) : render3DStageEvent(activeMode, now)}
  `
}
