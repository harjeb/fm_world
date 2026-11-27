import type { MatchLogEntry, MatchRecord, ReviewRecommendation } from './types.ts'
import { SKILLS } from './data/skills.ts'
import { displayClock, LEAGUE_REALTIME_SECONDS, LOGIC_MATCH_SECONDS } from './match/time.ts'
import { PLAYER_TEAM_ID } from './season.ts'

export type MatchHighlightKind = 'goal' | 'red' | 'penalty' | 'chance' | 'tactic'

export type MatchHighlight = {
  id: string
  seq: number
  kind: MatchHighlightKind
  clock: number
  minute: number
  minuteLabel: string
  team: 'home' | 'away' | 'none'
  isOwn: boolean
  badge: string
  shortLabel: string
  detail: string
  /** 是否计入「精彩集锦」自动连播片段（变阵节点仅在时间轴锚点展示，不单独切镜头）。 */
  actionClip: boolean
}

export type HighlightWindow = {
  index: number
  start: number
  end: number
  peakClock: number
  label: string
  count: number
}

export type AssistantDiagnosisCta = {
  nav: 'lineup' | 'training' | 'youth' | 'club'
  label: string
}

export type AssistantDiagnosis = {
  tone: 'bad' | 'warn' | 'good'
  tag: string
  title: string
  detail: string
  cta?: AssistantDiagnosisCta
}

function playerSideOf(record: Pick<MatchRecord, 'homeId' | 'awayId'>): 'home' | 'away' {
  return record.awayId === PLAYER_TEAM_ID ? 'away' : 'home'
}

function minuteTextOf(clock: number, durationSeconds: number): { minute: number; label: string } {
  const sec = displayClock(clock, durationSeconds)
  const minute = Math.max(1, Math.min(90, Math.floor(sec / 60) + 1))
  return { minute, label: `${minute}'` }
}

function cleanShortActor(entry: MatchLogEntry, goalScorer?: string): string {
  if (goalScorer) return goalScorer
  const m = /^([^\s，。！：,:!(（]{2,10})/.exec(entry.text.trim())
  return m ? m[1] : ''
}

/**
 * 从战报中提取高光时间轴锚点（进球 / 红牌 / 点球 / 绝佳机会 / 战术变阵）。
 * 若全场既无进球红牌也无绝佳机会（如沉闷 0:0），自动提取威胁最高的最多 4 脚射门作为集锦镜头。
 */
export function extractMatchHighlights(record: MatchRecord): MatchHighlight[] {
  const duration = record.durationSeconds ?? LOGIC_MATCH_SECONDS
  const mySide = playerSideOf(record)
  const events = record.keyEvents ?? []
  const goalsByClock = new Map<number, string>()
  for (const g of record.goalDetails ?? []) {
    goalsByClock.set(Math.round(g.clock * 10), g.playerName)
  }

  const out: MatchHighlight[] = []
  const goalClocks: number[] = []
  for (const e of events) {
    if (e.type === 'goal') goalClocks.push(e.clock)
  }

  for (const entry of events) {
    const { minute, label: minuteLabel } = minuteTextOf(entry.clock, duration)
    const isOwn = entry.team === mySide
    if (entry.type === 'goal') {
      const scorer = entry.goal?.playerName ?? goalsByClock.get(Math.round(entry.clock * 10)) ?? cleanShortActor(entry)
      out.push({
        id: `hl-${entry.seq}-goal`,
        seq: entry.seq,
        kind: 'goal',
        clock: entry.clock,
        minute,
        minuteLabel,
        team: entry.team,
        isOwn,
        badge: '进球',
        shortLabel: `${minuteLabel} ${scorer || '破门'}`.trim(),
        detail: entry.text,
        actionClip: true,
      })
      continue
    }
    if (entry.card === 'red') {
      const actor = cleanShortActor(entry)
      out.push({
        id: `hl-${entry.seq}-red`,
        seq: entry.seq,
        kind: 'red',
        clock: entry.clock,
        minute,
        minuteLabel,
        team: entry.team,
        isOwn,
        badge: '红牌',
        shortLabel: `${minuteLabel} ${actor ? `${actor}染红` : '红牌罚下'}`,
        detail: entry.text,
        actionClip: true,
      })
      continue
    }
    const isPen = entry.type === 'penalty' || entry.shotChance?.type === 'penalty'
    if (isPen) {
      // 若紧接着 2.5 逻辑秒内已记录点球破门，避免同一脚点球重复生成两个紧挨着的锚点
      if (goalClocks.some((gc) => Math.abs(gc - entry.clock) <= 2.5)) continue
      out.push({
        id: `hl-${entry.seq}-pen`,
        seq: entry.seq,
        kind: 'penalty',
        clock: entry.clock,
        minute,
        minuteLabel,
        team: entry.team,
        isOwn,
        badge: '点球',
        shortLabel: `${minuteLabel} 点球未进`,
        detail: entry.text,
        actionClip: true,
      })
      continue
    }
    if (
      ['save', 'miss', 'block', 'shot'].includes(entry.type) &&
      entry.shotChance &&
      ['open_goal', 'clear_chance'].includes(entry.shotChance.type)
    ) {
      if (goalClocks.some((gc) => Math.abs(gc - entry.clock) <= 1.5)) continue
      const kindText = entry.type === 'save' ? '神扑化解' : entry.shotChance.type === 'open_goal' ? '空门良机' : '单刀良机'
      out.push({
        id: `hl-${entry.seq}-chance`,
        seq: entry.seq,
        kind: 'chance',
        clock: entry.clock,
        minute,
        minuteLabel,
        team: entry.team,
        isOwn,
        badge: '良机',
        shortLabel: `${minuteLabel} ${kindText}`,
        detail: entry.text,
        actionClip: true,
      })
      continue
    }
    if (entry.type === 'tactic') {
      out.push({
        id: `hl-${entry.seq}-tactic`,
        seq: entry.seq,
        kind: 'tactic',
        clock: entry.clock,
        minute,
        minuteLabel,
        team: entry.team,
        isOwn,
        badge: '变阵',
        shortLabel: `${minuteLabel} 战术调整`,
        detail: entry.text,
        actionClip: false,
      })
    }
  }

  // 若整场没有进球/红牌/单刀空门，从射门事件里挑最多 4 次最高威胁攻门兜底，保证 0:0 也能看精彩集锦
  if (!out.some((item) => item.actionClip)) {
    const fallbackShots = events
      .filter((e) => ['save', 'miss', 'block', 'shot'].includes(e.type))
      .map((e) => ({
        entry: e,
        threat: (e.probabilities?.goal ?? 0) + (e.shotChance?.goalBase ?? 0) + (e.type === 'save' ? 0.15 : 0),
      }))
      .sort((a, b) => b.threat - a.threat || a.entry.clock - b.entry.clock)
      .slice(0, 4)
      .sort((a, b) => a.entry.clock - b.entry.clock)

    for (const { entry } of fallbackShots) {
      const { minute, label: minuteLabel } = minuteTextOf(entry.clock, duration)
      out.push({
        id: `hl-${entry.seq}-shot`,
        seq: entry.seq,
        kind: 'chance',
        clock: entry.clock,
        minute,
        minuteLabel,
        team: entry.team,
        isOwn: entry.team === mySide,
        badge: entry.type === 'save' ? '扑救' : '攻门',
        shortLabel: `${minuteLabel} ${entry.type === 'save' ? '门前扑救' : '威胁攻门'}`,
        detail: entry.text,
        actionClip: true,
      })
    }
    out.sort((a, b) => a.clock - b.clock || a.seq - b.seq)
  }

  // 若是仅含 commentary 的极简记录，用 commentary 里的 goal 兜底
  if (out.length === 0 && record.commentary?.length) {
    for (const c of record.commentary) {
      if (c.type !== 'goal') continue
      const { minute, label: minuteLabel } = minuteTextOf(c.clock, duration)
      out.push({
        id: `hl-c-${c.seq}`,
        seq: c.seq,
        kind: 'goal',
        clock: c.clock,
        minute,
        minuteLabel,
        team: c.team,
        isOwn: c.team === mySide,
        badge: '进球',
        shortLabel: `${minuteLabel} 进球`,
        detail: c.text,
        actionClip: true,
      })
    }
  }

  return out
}

/**
 * 将高光事件合并成不重叠的 2D 连播时间窗（前导约 8 秒现实时间看配合推进，后延约 3.5 秒看球进网/解围）。
 */
export function buildHighlightWindows(highlights: readonly MatchHighlight[], durationSeconds = LOGIC_MATCH_SECONDS): HighlightWindow[] {
  const duration = durationSeconds > 0 ? durationSeconds : LOGIC_MATCH_SECONDS
  const logicPerRealSec = duration / LEAGUE_REALTIME_SECONDS
  const preRoll = 8 * logicPerRealSec
  const postRoll = 3.6 * logicPerRealSec
  const mergeGap = 2.5 * logicPerRealSec

  const clips = highlights.filter((item) => item.actionClip).sort((a, b) => a.clock - b.clock)
  if (clips.length === 0) return []

  const raw: { start: number; end: number; peakClock: number; label: string; count: number }[] = []
  for (const clip of clips) {
    const start = Math.max(0, clip.clock - preRoll)
    const end = Math.min(duration, clip.clock + postRoll)
    const prev = raw.at(-1)
    if (prev && start <= prev.end + mergeGap) {
      prev.end = Math.max(prev.end, end)
      prev.count += 1
      if (clip.kind === 'goal') {
        prev.peakClock = clip.clock
        prev.label = clip.shortLabel
      }
    } else {
      raw.push({ start, end, peakClock: clip.clock, label: clip.shortLabel, count: 1 })
    }
  }

  return raw.map((win, index) => ({ index, ...win }))
}

/**
 * 首席助教「三句话战术诊断」：从本场真实统计、射门质量、体能余量、失败原因与技能触发中，
 * 按严重度与信息量提炼最多 3 条最直白、可直接落地调整的诊断与跳转入口。
 */
export function buildAssistantDiagnosis(record: MatchRecord): AssistantDiagnosis[] {
  const mySide = playerSideOf(record)
  const oppSide = mySide === 'home' ? 'away' : 'home'
  const mine = record.stats[mySide]
  const opp = record.stats[oppSide]
  const duration = record.durationSeconds ?? LOGIC_MATCH_SECONDS
  const items: (AssistantDiagnosis & { priority: number })[] = []

  // 1. 红牌少打一人转折
  if ((mine.redCards ?? 0) > 0) {
    items.push({
      priority: 100,
      tone: 'bad',
      tag: '纪律警报',
      title: `少打一人导致攻防失衡（本场领到 ${mine.redCards} 张红牌）`,
      detail: '减员后阵型空当被明显放大。建议在「战术 → 比赛计划」预设“我方红牌少人自动收缩 4-4-1 / 5-3-1”，并对抢断偏低球员慎开凶狠逼抢。',
      cta: { nav: 'lineup', label: '配置红牌预案' },
    })
  }

  // 2. 下半场体能透支与末段丢球
  const myPlayers = record.playerStats.filter((p) => p.side === mySide && p.minutes >= 55)
  const exhausted = myPlayers.filter((p) => p.staminaLeft <= 42)
  const lateConceded = (record.keyEvents ?? []).filter(
    (e) => e.type === 'goal' && e.team === oppSide && displayClock(e.clock, duration) >= 65 * 60,
  ).length
  if (exhausted.length >= 3 || (exhausted.length >= 2 && lateConceded > 0)) {
    const names = exhausted.slice(0, 2).map((p) => p.name).join('、')
    items.push({
      priority: lateConceded > 0 ? 92 : 78,
      tone: lateConceded > 0 ? 'bad' : 'warn',
      tag: '体能隐患',
      title: `末段体能见底（${exhausted.length} 名主力终场体力 ≤42%${lateConceded > 0 ? `，65' 后丢 ${lateConceded} 球` : ''}）`,
      detail: `${names}等主力后程体能跌破警戒线，容易触发动作变形与盯人漏人。建议在「比赛计划」设置 65 分钟低体能自动换人或切慢节奏控球。`,
      cta: { nav: 'lineup', label: '设置换人与比赛计划' },
    })
  }

  // 3. 进攻质量与终结诊断（兼容 PesEngine 的 goal.chance 与经典引擎的 shotChance）
  const chanceTypeOf = (e: MatchLogEntry) => e.shotChance?.type ?? e.goal?.chance
  const isClearType = (t?: string) => !!t && ['open_goal', 'clear_chance', 'box_open'].includes(t)
  const myShots = (record.keyEvents ?? []).filter((e) => e.team === mySide && (e.shotChance || e.goal || ['goal', 'save', 'miss', 'block', 'shot'].includes(e.type)))
  const myClearFromEvents = myShots.filter((e) => isClearType(chanceTypeOf(e)))
  const myClearGoalsFromDetails = (record.goalDetails ?? []).filter((g) => g.side === mySide && isClearType(g.chance)).length
  const myClearGoals = Math.max(myClearFromEvents.filter((e) => e.type === 'goal').length, myClearGoalsFromDetails)
  const myClearTotal = Math.max(myClearFromEvents.length, myClearGoals)
  const myDifficult = myShots.filter((e) => e.shotChance?.type === 'difficult' || (e.shotChance?.distance ?? 0) >= 22)

  if ((myClearTotal >= 2 && myClearGoals === 0) || (mine.shots >= 6 && mine.xg - mine.goals >= 1.15)) {
    items.push({
      priority: 90,
      tone: record.result === 'win' ? 'warn' : 'bad',
      tag: '终结断层',
      title: `得势不得分：预期进球 ${mine.xg.toFixed(2)} 却仅入 ${mine.goals} 球${myClearTotal > myClearGoals ? `（错失 ${myClearTotal - myClearGoals} 次良机）` : ''}`,
      detail: '前场传跑已经成功撕开防线，但临门一脚被扑或踢偏。建议针对主力射手特训「射术 + 镇定」，或配置《禁区猎手》《小角度巧射》。',
      cta: { nav: 'training', label: '去特训锋线终结' },
    })
  } else if (mine.shots <= 4) {
    items.push({
      priority: 86,
      tone: record.result === 'win' ? 'warn' : 'bad',
      tag: '推进受阻',
      title: `前场火力匮乏：全场仅 ${mine.shots} 次射门（xG ${mine.xg.toFixed(2)}）`,
      detail: '球权很难输送到对方禁区前沿。对阵强敌建议改打「快速防反 + 直传身后」，对阵铁桶阵则建议拉宽阵型增加边翼套上传中。',
      cta: { nav: 'lineup', label: '调整进攻职责' },
    })
  } else if (mine.shots >= 8 && myClearTotal === 0 && myDifficult.length >= Math.ceil(mine.shots * 0.5)) {
    items.push({
      priority: 80,
      tone: 'warn',
      tag: '射门选择',
      title: `外围浪射偏多：${mine.shots} 脚射门中 ${myDifficult.length} 次受封堵或远距勉强起脚`,
      detail: '缺少进入核心区域的绝佳机会。建议下调远射倾向、改用耐心渗透，或在中前场启用带《穿线者》《一脚出球》的组织核心。',
      cta: { nav: 'lineup', label: '优化渗透指令' },
    })
  }

  // 4. 防线身后与中场出球诊断
  const oppClearEvents = (record.keyEvents ?? []).filter((e) => e.team === oppSide && isClearType(chanceTypeOf(e))).length
  const oppClearDetails = (record.goalDetails ?? []).filter((g) => g.side === oppSide && isClearType(g.chance)).length
  const oppClearCount = Math.max(oppClearEvents, oppClearDetails)
  if (oppClearCount >= 3 || opp.goals >= 3) {
    const clearNote = oppClearCount > 0 ? `让对手打进/获得 ${oppClearCount} 次禁区空位或单刀（` : '（'
    items.push({
      priority: 88,
      tone: 'bad',
      tag: '防线告急',
      title: `防线屡遭打穿：${clearNote}失 ${opp.goals} 球 · 对手 xG ${opp.xg.toFixed(2)}）`,
      detail: '防线身后或肋部暴露过多空间。建议适当回收防线高度、安排防守型后腰留守屏障，或为后卫/门将配备《扫荡者》《出击门将》。',
      cta: { nav: 'lineup', label: '稳固防线站位' },
    })
  }

  const passRate = mine.passes > 0 ? mine.passesCompleted / mine.passes : 1
  const unrecognized = record.failureStats.find((f) => f.reason === 'unrecognized')?.count ?? 0
  if ((mine.passes > 20 && passRate < 0.7) || unrecognized >= 5) {
    items.push({
      priority: 74,
      tone: 'warn',
      tag: '中场传导',
      title: `出球失误偏高：传球成功率 ${Math.round(passRate * 100)}%${unrecognized >= 5 ? ` · ${unrecognized} 次空当未识别` : ''}`,
      detail: '受压状态下冒险直传容易在中场被断打反击。建议缩短传球距离、增加中场回撤接应职责，或提升组织者「传球 + 视野」。',
      cta: { nav: 'lineup', label: '调整传控衔接' },
    })
  }

  // 5. 战术兑现与关键球员正面总结（补齐至最多 3 条，让赢球/好局也有清晰复盘价值）
  const topSkills = record.skillStats
    .filter((s) => s.side === mySide && s.applied > 0)
    .sort((a, b) => b.applied - a.applied)
  if (topSkills.length > 0) {
    const best = topSkills[0]
    const extraCount = topSkills.reduce((sum, s) => sum + s.applied, 0)
    items.push({
      priority: 55,
      tone: 'good',
      tag: '技能兑现',
      title: `关键技能发威：${best.name}《${SKILLS[best.skillId]?.name ?? best.skillId}》生效 ${best.applied} 次（全队共 ${extraCount} 次）`,
      detail: '实战技能与当前战术职责契合良好。可在培养新卡时沿用该技能组合，或通过技能书商店补齐同体系副技能。',
    })
  }

  const mvp = [...record.playerStats]
    .filter((p) => p.side === mySide && (p.minutes > 0 || p.touches > 0))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.goals * 3 + (b.assists ?? 0) * 2 + (b.saves ?? 0) - (a.goals * 3 + (a.assists ?? 0) * 2 + (a.saves ?? 0)))[0]
  if (mvp) {
    const parts: string[] = []
    if (mvp.goals > 0) parts.push(`${mvp.goals} 球`)
    if ((mvp.assists ?? 0) > 0) parts.push(`${mvp.assists} 助攻`)
    if ((mvp.saves ?? 0) > 0) parts.push(`${mvp.saves} 次扑救`)
    if (mvp.tackles + mvp.interceptions >= 3) parts.push(`${mvp.tackles + mvp.interceptions} 次抢断拦截`)
    if (parts.length === 0) parts.push(`传球 ${mvp.passesCompleted}/${mvp.passes}`)
    items.push({
      priority: 45,
      tone: 'good',
      tag: '本场核心',
      title: `队内最佳表现：${mvp.name}（${parts.join(' · ')}${mvp.rating ? ` · 评分 ${mvp.rating.toFixed(1)}` : ''}）`,
      detail: record.result === 'win'
        ? `我方全场控球 ${mine.possession}%、射门 ${mine.shots}:${opp.shots}，整体战术执行稳健，成功拿下比赛。`
        : `我方全场控球 ${mine.possession}%、xG ${mine.xg.toFixed(2)}:${opp.xg.toFixed(2)}，可围绕核心强点微调配角职责。`,
    })
  }

  if (items.length < 3) {
    items.push({
      priority: 20,
      tone: 'good',
      tag: '阵型运转',
      title: `攻防体系运转平稳（传球成功率 ${Math.round(passRate * 100)}% · 抢断拦截 ${mine.tackles + mine.interceptions} 次）`,
      detail: '本场未出现明显结构性崩盘。面对下一轮不同风格对手前，可提前检查主力体能与备选比赛计划。',
    })
  }

  return items
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map(({ priority: _p, ...rest }) => rest)
}

export function buildReview(record: MatchRecord): ReviewRecommendation[] {
  const out: ReviewRecommendation[] = []
  const mySide = playerSideOf(record)
  const myStats = record.stats[mySide]
  const totalShots = record.stats.home.shots + record.stats.away.shots
  const totalGoals = record.stats.home.goals + record.stats.away.goals
  if (totalShots < 12) {
    out.push({ title: '射门机会偏少', detail: `全场只有 ${totalShots} 次射门。可以尝试更直接的传递、更多边路传中，或把前锋职责改成“跑位前锋”。`, tone: 'warn' })
  } else if (totalShots > 30) {
    out.push({ title: '射门很多但质量一般', detail: `全场 ${totalShots} 次射门，重点看射门距离与封堵人数，而不是继续堆射门。`, tone: 'warn' })
  }
  if (totalShots > 0 && totalGoals / totalShots < 0.08) {
    out.push({ title: '终结效率偏低', detail: `射门转化率约 ${((totalGoals / totalShots) * 100).toFixed(0)}%。训练射术、镇定，或让“禁区猎手”在禁区内起脚。`, tone: 'bad' })
  }
  if (myStats.possession < 44) {
    out.push({ title: '控球被压制', detail: `控球率 ${myStats.possession}%。可尝试短传、降低节奏，或让中场更多回撤接应。`, tone: 'warn' })
  }
  const passRate = myStats.passes > 0 ? myStats.passesCompleted / myStats.passes : 0
  if (myStats.passes > 20 && passRate < 0.72) {
    out.push({ title: '传球成功率偏低', detail: `传球成功率约 ${(passRate * 100).toFixed(0)}%。检查接应距离与逆足，短传路线通常比强行直塞更稳。`, tone: 'warn' })
  }
  const unrecognized = record.failureStats.find((item) => item.reason === 'unrecognized')?.count ?? 0
  if (unrecognized > 0) {
    out.push({ title: '有线路没被识别', detail: `出现 ${unrecognized} 次“视野不足导致没看到”的失败。提升视野，或降低传球冒险程度。`, tone: 'warn' })
  }
  const noSkill = record.skillStats.filter((skill) => skill.side === mySide && skill.conditions > 0 && skill.applied === 0)
  if (noSkill.length > 0) {
    out.push({ title: '技能有触发但没生效', detail: `${noSkill.slice(0, 3).map((item) => SKILLS[item.skillId].name).join('、')} 满足了条件但没有产生效果，检查技能槽与职责是否匹配。`, tone: 'warn' })
  }
  const shots = record.keyEvents.filter((entry) => entry.shotChance)
  const clear = shots.filter((entry) => ['open_goal', 'clear_chance', 'box_open'].includes(entry.shotChance!.type))
  const clearGoals = clear.filter((entry) => entry.type === 'goal').length
  if (clear.length > 0) {
    out.push({
      title: '清晰机会复盘',
      detail: `全场 ${clear.length} 次空门/单刀/禁区空位，打进 ${clearGoals} 球；这些机会的射正保底分别为 90% / 78% / 65%，射正仍可能被门将扑出。`,
      tone: clearGoals > 0 ? 'good' : 'warn',
    })
  } else if (shots.length > 0) {
    out.push({ title: '没有清晰机会', detail: '本场射门多为普通或困难机会。可尝试更直接的直塞、边路传中或让前锋职责更靠前。', tone: 'warn' })
  }
  const missed = record.decisionStats?.missedChances ?? 0
  if (missed > 0) {
    out.push({ title: '错过了好机会', detail: `有 ${missed} 次清晰射门机会没有起脚；日志里记录了当时的替代动作。`, tone: 'warn' })
  }
  const top = [...record.playerStats].filter((player) => player.side === mySide).sort((a, b) => b.goals - a.goals || b.shots - a.shots)[0]
  if (top && top.goals > 0) {
    out.push({ title: '本场贡献', detail: `${top.name} 打进 ${top.goals} 球，完成 ${top.shots} 次射门。`, tone: 'good' })
  }
  if (out.length === 0) out.push({ title: '比赛运行正常', detail: '没有发现明显的结构性异常。继续观察射门、传球成功率与技能触发。', tone: 'good' })
  return out
}
