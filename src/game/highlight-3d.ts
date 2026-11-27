/**
 * 赛后复盘与聊天战报「3D 进球/高光特写剧场」纯逻辑合成层（无 DOM / Three.js 依赖）。
 *
 * 设计目标：
 * 1. 不依赖完整 2D 引擎状态快照（engineState）：无论是在线新战报、离线本地比赛、
 *    超过 7 天已清理回放快照的历史战报，还是全服聊天里别人晒出的 ChatSharedMatch，
 *    都能由 goalDetails / keyEvents 确定性合成半场禁区 3D 特写镜头；
 * 2. 涵盖运动战配合破门（助攻直塞/倒三角 + 迎球抽射）、边路传中冲顶头球、直接任意球绕人墙、
 *    点球对决、关键神扑与门框惊魂六类高光演出。
 */
import type { ChatSharedGoal, ChatSharedMatch } from './chat.ts'
import { displayClock, LOGIC_MATCH_SECONDS } from './match/time.ts'
import { shotPositionText, shotTargetText } from './match/shooting.ts'
import { finishBall, netImpact, POST_DURATION, settleNonGoalBall, type Impact, type Vec3 } from './penalty/net.ts'
import { clamp, GLOVE_Z, HALF, HEIGHT, keeperAt, postKeeperPose, R, SPOT, STANDARD, type Ability, type Dive, type Shot } from './penalty/practice.ts'
import type { GoalDetail, MatchLogEntry, MatchRecord, Player } from './types.ts'

const KEEPER_ABILITY: Ability = { ...STANDARD, reflexes: 0.68, acceleration: 0.72, handling: 0.68 }

export type Highlight3DKind =
  | 'goal'
  | 'header_goal'
  | 'freekick_goal'
  | 'penalty_goal'
  | 'save'
  | 'woodwork'

export type Highlight3DActor = {
  id: string
  name: string
  number: number
  height: number
}

export type Highlight3DTeam = {
  name: string
  color: string
}

export type Highlight3DClip = {
  id: string
  index: number
  minute: number
  minuteLabel: string
  clock: number
  kind: Highlight3DKind
  side: 'home' | 'away'
  isGoal: boolean
  outcome: 'goal' | 'catch' | 'parry' | 'frame'
  badge: string
  chipLabel: string
  title: string
  subtitle: string
  scoreBefore: { home: number; away: number }
  scoreAfter: { home: number; away: number }
  attackTeam: Highlight3DTeam
  defendTeam: Highlight3DTeam
  striker: Highlight3DActor
  keeper: Highlight3DActor
  assister?: Highlight3DActor
  defenders: Highlight3DActor[]
  /** 射门或头球触球点（3D 半场米制坐标：门线 z=0，禁区外为 +z，射手左侧为 -x，右侧为 +x）。 */
  spot: { x: number; z: number }
  /** 助攻传球或传中起点（若有）。 */
  passOrigin?: { x: number; z: number }
  /** 球门平面（z=0）上的目标点。 */
  target: { x: number; y: number }
  bodyPart: 'left' | 'right' | 'head'
  technique: 'power' | 'placed' | 'header'
  situation: 'open' | 'penalty' | 'free_kick'
  distance: number
  leadInSec: number
  flightSec: number
  postSec: number
  totalSec: number
  arc: number
  curve: number
  /** 内部复用的等效 Shot 对象（供 netImpact / keeperAt 计算）。 */
  shotModel: Shot
  keeperDive: Dive
}

export type ActorPose3D = {
  visible: boolean
  x: number
  z: number
  yaw: number
  mode: 'idle' | 'sprint' | 'pass' | 'kick_windup' | 'kick_follow' | 'header_jump' | 'wall' | 'celebrate'
  phase: number
  lift: number
}

export type Highlight3DFrame = {
  phase: 'lead_in' | 'flight' | 'impact'
  ball: Vec3
  trail: Vec3[]
  striker: ActorPose3D
  assister: ActorPose3D
  defenders: ActorPose3D[]
  keeperPose: ReturnType<typeof keeperAt> & { landed: number }
  netHit: Impact | null
  sinceImpact: number
  bannerActive: boolean
  liveScore: { home: number; away: number }
  cinemaCam: { pos: Vec3; look: Vec3; fov: number }
}

function hash32(seedStr: string): number {
  let h = 2166136261
  for (const ch of seedStr) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619)
  return h >>> 0
}

function nextU32(h: number): number {
  return (Math.imul(h, 1664525) + 1013904223) >>> 0
}

function unitFloat(h: number): number {
  return (h >>> 0) / 0xffffffff
}

/** 将 MatchRecord 球场坐标 (0..100, 0..64) 映射为 3D 半场禁区米制坐标 (x ∈ [-15.5, 15.5], z ∈ [5.0, 26.5])。 */
export function goalOriginTo3D(
  side: 'home' | 'away',
  origin: { x: number; y: number },
  situation: GoalDetail['situation'],
): { x: number; z: number } {
  if (situation === 'penalty') return { x: 0, z: SPOT }
  const rawDepth = side === 'home' ? (100 - origin.x) * 1.05 : origin.x * 1.05
  const rawLat = side === 'home' ? (origin.y - 32) * 1.06 : (32 - origin.y) * 1.06
  const minZ = situation === 'free_kick' ? 17.2 : 5.2
  const maxZ = situation === 'free_kick' ? 26.5 : 25.5
  return {
    x: Math.round(clamp(rawLat, -15.2, 15.2) * 100) / 100,
    z: Math.round(clamp(rawDepth, minZ, maxZ) * 100) / 100,
  }
}

/** 将射门落点枚举映射为 3D 球门平面坐标（带微量确定性扰动避免千篇一律）。 */
export function goalTargetTo3D(
  target: GoalDetail['target'],
  seed: number,
  outcome: Highlight3DClip['outcome'] = 'goal',
): { x: number; y: number } {
  const s1 = nextU32(seed)
  const s2 = nextU32(s1)
  const jx = (unitFloat(s1) * 2 - 1) * 0.28
  const jy = (unitFloat(s2) * 2 - 1) * 0.14

  if (outcome === 'frame') {
    // 门柱或横梁惊魂：落点精准贴在立柱或横梁上
    if (target.startsWith('top_')) {
      const baseX = target.endsWith('left') ? -2.2 : target.endsWith('right') ? 2.2 : jx * 2
      return { x: clamp(baseX, -HALF + 0.2, HALF - 0.2), y: HEIGHT - R * 0.35 }
    }
    const sideSign = target.endsWith('left') ? -1 : target.endsWith('right') ? 1 : (s1 & 1 ? 1 : -1)
    return { x: sideSign * (HALF - R * 0.3), y: clamp(1.15 + jy * 2.2, 0.45, HEIGHT - 0.3) }
  }

  const baseX = target.endsWith('left') ? -2.76 : target.endsWith('right') ? 2.76 : 0
  const baseY = target.startsWith('top_') ? 1.94 : 0.38
  return {
    x: Math.round(clamp(baseX + jx, -HALF + R + 0.16, HALF - R - 0.16) * 100) / 100,
    y: Math.round(clamp(baseY + jy, R + 0.08, HEIGHT - R - 0.14) * 100) / 100,
  }
}

function makeActor(
  id: string,
  name: string,
  fallbackNum: number,
  rosterLookup?: Map<string, Pick<Player, 'id' | 'name' | 'number' | 'height'>>,
): Highlight3DActor {
  const found = rosterLookup?.get(id) ?? (name ? [...(rosterLookup?.values() ?? [])].find((p) => p.name === name) : undefined)
  if (found) {
    return {
      id: found.id,
      name: found.name,
      number: found.number > 0 ? found.number : fallbackNum,
      height: found.height || 181,
    }
  }
  const h = hash32(`${id}|${name}`)
  const num = fallbackNum > 0 ? fallbackNum : 2 + (h % 29)
  const height = 175 + ((h >>> 5) % 16)
  return { id: id || `actor-${h}`, name: name || '球员', number: num, height }
}

function buildSingleClip(params: {
  id: string
  index: number
  minute: number
  clock: number
  side: 'home' | 'away'
  outcome: Highlight3DClip['outcome']
  scoreBefore: { home: number; away: number }
  scoreAfter: { home: number; away: number }
  attackTeam: Highlight3DTeam
  defendTeam: Highlight3DTeam
  striker: Highlight3DActor
  keeper: Highlight3DActor
  assister?: Highlight3DActor
  defenders: Highlight3DActor[]
  origin: { x: number; y: number }
  distance: number
  bodyPart: GoalDetail['bodyPart']
  technique: GoalDetail['technique']
  situation: GoalDetail['situation']
  targetZone: GoalDetail['target']
  seedKey: string
  customDetail?: string
}): Highlight3DClip {
  const seed = hash32(params.seedKey)
  const isHeader = params.bodyPart === 'head' || params.technique === 'header'
  const spot = goalOriginTo3D(params.side, params.origin, params.situation)
  if (isHeader && params.situation === 'open') {
    spot.z = clamp(spot.z, 5.6, 11.4)
    spot.x = clamp(spot.x, -4.8, 4.8)
  }
  const target = goalTargetTo3D(params.targetZone, seed, params.outcome)
  const dist3d = Math.hypot(target.x - spot.x, spot.z)

  const speed =
    params.situation === 'penalty'
      ? params.technique === 'placed' ? 21.5 : 27.5
      : params.situation === 'free_kick'
        ? 23.5
        : isHeader
          ? 17.5
          : params.technique === 'power'
            ? 28.5
            : 22.0

  const flightSec = clamp(dist3d / speed, 0.36, 1.18)
  const arc =
    params.situation === 'free_kick'
      ? clamp(0.62 + (spot.z - 16) * 0.03, 0.55, 1.05)
      : isHeader
        ? 0.16
        : params.technique === 'placed'
          ? 0.34
          : 0.22
  const curveSign = params.bodyPart === 'left' ? 1 : params.bodyPart === 'right' ? -1 : 0
  const curve =
    params.situation === 'free_kick'
      ? (curveSign || 1) * 0.65
      : params.technique === 'placed'
        ? curveSign * 0.38
        : curveSign * 0.12

  let passOrigin: { x: number; z: number } | undefined
  if (isHeader && params.situation === 'open') {
    const flankSign = spot.x >= 0 ? -1 : 1
    passOrigin = { x: flankSign * (12.8 + (seed % 3)), z: clamp(spot.z + 2.4, 7.5, 16.5) }
  } else if (params.assister && params.situation === 'open') {
    const sideOffset = spot.x > 3 ? -5.8 : spot.x < -3 ? 5.8 : ((seed & 1) ? 6.2 : -6.2)
    passOrigin = {
      x: clamp(spot.x + sideOffset, -14.8, 14.8),
      z: clamp(spot.z + 4.5 + (seed % 4), 7.5, 25.8),
    }
  }

  const leadInSec =
    params.situation === 'penalty' || params.situation === 'free_kick'
      ? 0.92
      : isHeader
        ? 1.36
        : 1.22
  const postSec = POST_DURATION + 0.35
  const totalSec = leadInSec + flightSec + postSec

  // 构造供 netImpact 与 keeperAt 复用的等效 Shot
  const shotModel: Shot = {
    target,
    time: flightSec,
    arc,
    curve,
    zone: '合适',
  }

  const mkDive = (at: number, tx: number, ty: number): Dive => {
    const dx = tx
    const dy = ty - 1.06
    const len = Math.hypot(dx, dy) || 1
    return { at, dir: { x: dx / len, y: dy / len }, target: { x: tx, y: ty } }
  }

  // 门将扑救规划：神扑时精准拦截，进球时反应略晚或差半掌距离，呈现真实飞身扑救视觉张力
  let keeperDive: Dive
  if (params.outcome === 'catch' || params.outcome === 'parry') {
    keeperDive = mkDive(Math.max(0.02, flightSec * 0.08), target.x, clamp(target.y, 0.35, HEIGHT - 0.15))
  } else {
    const wrongWay = params.situation === 'penalty' && (seed % 5 === 0)
    const tx = wrongWay ? -Math.sign(target.x || 1) * 2.1 : target.x * 0.74
    const ty = clamp(target.y * 0.82, 0.35, 1.95)
    keeperDive = mkDive(Math.min(flightSec * 0.38, 0.2), tx, ty)
  }

  const minuteLabel = `${params.minute}'`
  const isGoal = params.outcome === 'goal'
  const kind: Highlight3DKind = !isGoal
    ? params.outcome === 'frame' ? 'woodwork' : 'save'
    : params.situation === 'penalty'
      ? 'penalty_goal'
      : params.situation === 'free_kick'
        ? 'freekick_goal'
        : isHeader
          ? 'header_goal'
          : 'goal'

  const badge = {
    goal: '⚽ 进球',
    header_goal: '🦅 头球破门',
    freekick_goal: '🎯 任意球破门',
    penalty_goal: '🥅 点球命中',
    save: '🧤 关键神扑',
    woodwork: '💥 击中门框',
  }[kind]

  const bodyText = { left: '左脚', right: '右脚', head: '头球' }[params.bodyPart]
  const techText = isHeader ? '冲顶' : params.technique === 'power' ? '劲射' : '巧射'
  const posText = shotPositionText({ side: params.side, origin: params.origin })
  const cornerText = shotTargetText(params.targetZone)

  const title = isGoal
    ? `${minuteLabel} ${params.striker.name}${params.assister ? `（助攻：${params.assister.name}）` : ''}`
    : kind === 'save'
      ? `${minuteLabel} ${params.keeper.name} 飞身化解 ${params.striker.name} 射门`
      : `${minuteLabel} ${params.striker.name} 攻门击中门框弹出`

  const subtitle =
    params.customDetail ||
    `${params.attackTeam.name} · ${posText}${bodyText}${techText} · ${params.distance.toFixed(1)}m → ${cornerText}`

  const chipLabel = isGoal
    ? `${minuteLabel} ${params.striker.name}`
    : kind === 'save'
      ? `${minuteLabel} ${params.keeper.name}扑救`
      : `${minuteLabel} ${params.striker.name}中柱`

  return {
    id: params.id,
    index: params.index,
    minute: params.minute,
    minuteLabel,
    clock: params.clock,
    kind,
    side: params.side,
    isGoal,
    outcome: params.outcome,
    badge,
    chipLabel,
    title,
    subtitle,
    scoreBefore: params.scoreBefore,
    scoreAfter: params.scoreAfter,
    attackTeam: params.attackTeam,
    defendTeam: params.defendTeam,
    striker: params.striker,
    keeper: params.keeper,
    ...(params.assister ? { assister: params.assister } : {}),
    defenders: params.defenders,
    spot,
    ...(passOrigin ? { passOrigin } : {}),
    target,
    bodyPart: params.bodyPart,
    technique: params.technique,
    situation: params.situation,
    distance: params.distance,
    leadInSec,
    flightSec,
    postSec,
    totalSec,
    arc,
    curve,
    shotModel,
    keeperDive,
  }
}

function extractActorNameFromLog(entry: MatchLogEntry): string {
  const head = entry.text.trim().split(/(?:\s+|在禁区|禁区|远射|起脚|推射|抽射|头球|主罚|单刀|面对)/)[0]?.replace(/[，。！：,:!(（].*$/, '') ?? ''
  return head.length >= 2 && head.length <= 10 ? head : '主攻球员'
}

/**
 * 从完整战报（MatchRecord）提取并合成 3D 高光特写片段列表。
 * 即使该战报没有 2D 回放快照（如离线老存档、超过 7 天已清理回放的联机战报），依然能 100% 合成重演。
 */
export function buildHighlight3DClipsFromRecord(
  record: MatchRecord,
  kits: { home: string; away: string },
  rosterLookup?: Map<string, Pick<Player, 'id' | 'name' | 'number' | 'height'>>,
): Highlight3DClip[] {
  const duration = record.durationSeconds ?? LOGIC_MATCH_SECONDS
  const homeTeam: Highlight3DTeam = { name: record.homeName, color: kits.home }
  const awayTeam: Highlight3DTeam = { name: record.awayName, color: kits.away }

  // 从 playerStats 推断双方门将名字
  const findKeeperName = (side: 'home' | 'away') => {
    const gkStat = [...(record.playerStats ?? [])]
      .filter((p) => p.side === side && ((p.saves ?? 0) > 0 || (p.claims ?? 0) > 0 || (p.xgConceded ?? 0) > 0))
      .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0]
    return gkStat?.name || (side === 'home' ? `${record.homeName}门将` : `${record.awayName}门将`)
  }
  const homeGk = makeActor(`${record.homeId}-gk`, findKeeperName('home'), 1, rosterLookup)
  const awayGk = makeActor(`${record.awayId}-gk`, findKeeperName('away'), 1, rosterLookup)

  const makeDefenders = (defSide: 'home' | 'away', seedBase: string): Highlight3DActor[] => {
    const defStats = (record.playerStats ?? []).filter((p) => p.side === defSide && p.name !== (defSide === 'home' ? homeGk.name : awayGk.name))
    return Array.from({ length: 4 }, (_, i) => {
      const picked = defStats[i % Math.max(1, defStats.length)]
      return makeActor(picked?.sourceId || `${seedBase}-def-${i}`, picked?.name || `后卫${i + 2}`, 2 + i, rosterLookup)
    })
  }

  type RawEvent =
    | { clock: number; kind: 'goal'; goal: GoalDetail }
    | { clock: number; kind: 'save' | 'frame'; entry: MatchLogEntry }

  const rawList: RawEvent[] = []
  for (const g of record.goalDetails ?? []) {
    rawList.push({ clock: g.clock, kind: 'goal', goal: g })
  }

  // 补充最多 2~4 个极具观赏性的非进球扑救/中柱绝佳镜头（尤其 0:0 时保证也有高光可看）
  const maxExtras = rawList.length === 0 ? 4 : 2
  const extraCandidates = (record.keyEvents ?? []).filter((e) => {
    if (e.type !== 'save' && e.type !== 'miss') return false
    if (e.type === 'save') return true
    return e.text.includes('门柱') || e.text.includes('横梁') || e.shotChance?.type === 'open_goal' || e.shotChance?.type === 'clear_chance'
  })
  const sortedExtras = [...extraCandidates].sort((a, b) => {
    const scoreOf = (e: MatchLogEntry) =>
      (e.text.includes('点球') ? 5 : 0) +
      (e.text.includes('门柱') || e.text.includes('横梁') ? 4 : 0) +
      (e.shotChance?.type === 'clear_chance' || e.shotChance?.type === 'open_goal' ? 3 : 1)
    return scoreOf(b) - scoreOf(a) || a.clock - b.clock
  }).slice(0, maxExtras)

  for (const entry of sortedExtras) {
    if (entry.team === 'none') continue
    const isFrame = entry.type === 'miss' && (entry.text.includes('门柱') || entry.text.includes('横梁'))
    rawList.push({ clock: entry.clock, kind: isFrame ? 'frame' : 'save', entry })
  }

  rawList.sort((a, b) => a.clock - b.clock)

  // 若连 keyEvents 都为空（极早期极简战报且 0:0），保底生成 1 段双方门前攻防特写
  if (rawList.length === 0) {
    const h = hash32(record.id)
    const striker = makeActor(`${record.homeId}-st`, record.playerStats?.find((p) => p.side === 'home')?.name || `${record.homeName}前锋`, 9, rosterLookup)
    return [
      buildSingleClip({
        id: `${record.id}-hl3d-0`,
        index: 0,
        minute: 62,
        clock: duration * 0.68,
        side: 'home',
        outcome: 'parry',
        scoreBefore: { home: 0, away: 0 },
        scoreAfter: { home: 0, away: 0 },
        attackTeam: homeTeam,
        defendTeam: awayTeam,
        striker,
        keeper: awayGk,
        defenders: makeDefenders('away', record.id),
        origin: { x: 86, y: 26 + (h % 12) },
        distance: 15.2,
        bodyPart: 'right',
        technique: 'power',
        situation: 'open',
        targetZone: 'top_right',
        seedKey: `${record.id}-fallback`,
      }),
    ]
  }

  let homeScore = 0
  let awayScore = 0
  const clips: Highlight3DClip[] = []

  rawList.forEach((item, idx) => {
    const minute = Math.max(1, Math.min(90, Math.floor(displayClock(item.clock, duration) / 60) + 1))
    const before = { home: homeScore, away: awayScore }
    if (item.kind === 'goal') {
      const g = item.goal
      if (g.side === 'home') homeScore++
      else awayScore++
      const after = { home: homeScore, away: awayScore }
      const attackTeam = g.side === 'home' ? homeTeam : awayTeam
      const defendTeam = g.side === 'home' ? awayTeam : homeTeam
      const keeper = g.side === 'home' ? awayGk : homeGk
      const striker = makeActor(g.playerId, g.playerName, 9, rosterLookup)
      const assister = g.assistName ? makeActor(g.assistId || `${g.playerId}-ast`, g.assistName, 10, rosterLookup) : undefined
      clips.push(
        buildSingleClip({
          id: `${record.id}-hl3d-${idx}`,
          index: idx,
          minute,
          clock: g.clock,
          side: g.side,
          outcome: 'goal',
          scoreBefore: before,
          scoreAfter: after,
          attackTeam,
          defendTeam,
          striker,
          keeper,
          assister,
          defenders: makeDefenders(g.side === 'home' ? 'away' : 'home', `${record.id}-${idx}`),
          origin: g.origin,
          distance: g.distance,
          bodyPart: g.bodyPart,
          technique: g.technique,
          situation: g.situation,
          targetZone: g.target,
          seedKey: `${record.id}|goal|${idx}|${g.clock}`,
        }),
      )
    } else {
      const e = item.entry
      const side = e.team === 'away' ? 'away' : 'home'
      const h = hash32(`${record.id}|ev|${e.seq}`)
      const attackTeam = side === 'home' ? homeTeam : awayTeam
      const defendTeam = side === 'home' ? awayTeam : homeTeam
      const keeper = side === 'home' ? awayGk : homeGk
      const actorName = extractActorNameFromLog(e)
      const striker = makeActor(`${side}-${e.seq}`, actorName, 11, rosterLookup)
      const isPen = e.text.includes('点球')
      const dist = isPen ? 11 : e.shotChance?.distance ?? (12 + (h % 10))
      const latY = 22 + ((h >>> 4) % 21)
      const progX = side === 'home' ? Math.max(76, 100 - dist * 0.95) : Math.min(24, dist * 0.95)
      const zones: GoalDetail['target'][] = ['top_left', 'top_right', 'bottom_left', 'bottom_right']
      const targetZone = zones[(h >>> 8) % zones.length]
      clips.push(
        buildSingleClip({
          id: `${record.id}-hl3d-${idx}`,
          index: idx,
          minute,
          clock: e.clock,
          side,
          outcome: item.kind === 'frame' ? 'frame' : (h & 1 ? 'parry' : 'catch'),
          scoreBefore: before,
          scoreAfter: before,
          attackTeam,
          defendTeam,
          striker,
          keeper,
          defenders: makeDefenders(side === 'home' ? 'away' : 'home', `${record.id}-${idx}`),
          origin: isPen ? { x: side === 'home' ? 89 : 11, y: 32 } : { x: progX, y: latY },
          distance: dist,
          bodyPart: (h & 2) ? 'left' : 'right',
          technique: dist > 18 ? 'power' : 'placed',
          situation: isPen ? 'penalty' : 'open',
          targetZone,
          seedKey: `${record.id}|extra|${e.seq}`,
          customDetail: e.text,
        }),
      )
    }
  })

  return clips
}

/**
 * 从全服聊天分享的战报快照（ChatSharedMatch）合成 3D 进球/高光片段。
 * 新分享自带精确射门坐标/部位/落点；旧消息缺省时按确定性哈希还原合理禁区攻门轨迹。
 */
export function buildHighlight3DClipsFromSharedMatch(
  match: ChatSharedMatch,
  kits: { home: string; away: string },
): Highlight3DClip[] {
  const homeTeam: Highlight3DTeam = { name: match.homeName, color: kits.home }
  const awayTeam: Highlight3DTeam = { name: match.awayName, color: kits.away }
  const homeGk = makeActor(`${match.recordId}-hgk`, `${match.homeName}门将`, 1)
  const awayGk = makeActor(`${match.recordId}-agk`, `${match.awayName}门将`, 1)
  const makeDefs = (side: 'home' | 'away', tag: string) =>
    Array.from({ length: 4 }, (_, i) => makeActor(`${match.recordId}-${side}-d${i}-${tag}`, `后卫${i + 2}`, 2 + i))

  if (match.goals.length === 0) {
    const h = hash32(match.recordId)
    return [
      buildSingleClip({
        id: `${match.recordId}-chat3d-0`,
        index: 0,
        minute: 70,
        clock: 420,
        side: 'home',
        outcome: 'parry',
        scoreBefore: { home: 0, away: 0 },
        scoreAfter: { home: 0, away: 0 },
        attackTeam: homeTeam,
        defendTeam: awayTeam,
        striker: makeActor(`${match.recordId}-mvp`, match.mvp?.name || `${match.homeName}主攻手`, 9),
        keeper: awayGk,
        defenders: makeDefs('away', '0'),
        origin: { x: 87, y: 27 + (h % 10) },
        distance: 14.5,
        bodyPart: 'right',
        technique: 'power',
        situation: 'open',
        targetZone: 'top_left',
        seedKey: `${match.recordId}|0-0`,
      }),
    ]
  }

  let homeScore = 0
  let awayScore = 0
  return match.goals.map((g: ChatSharedGoal, idx: number) => {
    const h = hash32(`${match.recordId}|g|${idx}|${g.playerName}`)
    const before = { home: homeScore, away: awayScore }
    if (g.side === 'home') homeScore++
    else awayScore++
    const after = { home: homeScore, away: awayScore }
    const minNum = parseInt(g.minute, 10)
    const minute = Number.isFinite(minNum) ? clamp(minNum, 1, 90) : 45
    const dist = g.distance ?? (11.5 + (h % 11))
    const fallbackOrigin =
      g.side === 'home'
        ? { x: clamp(100 - dist * 0.94, 76, 93), y: 21 + ((h >>> 3) % 22) }
        : { x: clamp(dist * 0.94, 7, 24), y: 21 + ((h >>> 3) % 22) }
    const zones: GoalDetail['target'][] = ['top_left', 'top_right', 'bottom_left', 'bottom_right', 'bottom_center']
    const bodyParts: GoalDetail['bodyPart'][] = ['right', 'left', 'head']
    const bodyPart = g.bodyPart ?? bodyParts[(h >>> 6) % (g.assistName ? 3 : 2)]
    const technique: GoalDetail['technique'] =
      g.technique ?? (bodyPart === 'head' ? 'header' : (h & 4) ? 'power' : 'placed')
    const situation = g.situation ?? 'open'
    const targetZone = g.target ?? zones[(h >>> 9) % zones.length]
    const attackTeam = g.side === 'home' ? homeTeam : awayTeam
    const defendTeam = g.side === 'home' ? awayTeam : homeTeam

    return buildSingleClip({
      id: `${match.recordId}-chat3d-${idx}`,
      index: idx,
      minute,
      clock: minute * 10,
      side: g.side,
      outcome: 'goal',
      scoreBefore: before,
      scoreAfter: after,
      attackTeam,
      defendTeam,
      striker: makeActor(`${match.recordId}-s-${idx}`, g.playerName, 9 + (idx % 3)),
      keeper: g.side === 'home' ? awayGk : homeGk,
      assister: g.assistName ? makeActor(`${match.recordId}-a-${idx}`, g.assistName, 7 + (idx % 4)) : undefined,
      defenders: makeDefs(g.side === 'home' ? 'away' : 'home', String(idx)),
      origin: g.origin ?? fallbackOrigin,
      distance: dist,
      bodyPart,
      technique,
      situation,
      targetZone,
      seedKey: `${match.recordId}|chat|${idx}`,
    })
  })
}

function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ))
}

function sampleFlightBall(clip: Highlight3DClip, tFlight: number): Vec3 {
  const u = clamp(tFlight / clip.flightSec, 0, 1)
  const startY = clip.kind === 'header_goal' ? 2.02 : R
  const endZ = clip.outcome === 'catch' || clip.outcome === 'parry' ? GLOVE_Z : 0
  const x = clip.spot.x + (clip.target.x - clip.spot.x) * u + 4 * clip.curve * u * (1 - u)
  const y = Math.max(R, startY + (clip.target.y - startY) * u + 4 * clip.arc * u * (1 - u))
  const z = clip.spot.z + (endZ - clip.spot.z) * u
  return { x, y, z }
}

/**
 * 采样单个高光镜头在 elapsedSec（0 .. clip.totalSec）时刻的完整 3D 世界帧。
 */
export function sampleHighlight3DFrame(clip: Highlight3DClip, rawElapsed: number): Highlight3DFrame {
  const elapsed = clamp(rawElapsed, 0, clip.totalSec)
  const rel = elapsed - clip.leadInSec
  const isHeader = clip.kind === 'header_goal'
  const isFreeKick = clip.situation === 'free_kick'
  const isPenalty = clip.situation === 'penalty'

  const hiddenActor: ActorPose3D = { visible: false, x: 0, z: 20, yaw: 0, mode: 'idle', phase: 0, lift: 0 }

  // 1. 计算皮球位置与尾迹
  let ball: Vec3
  const trail: Vec3[] = []
  let netHit: Impact | null = null
  let sinceImpact = 0

  if (rel < 0) {
    const u = clamp(elapsed / clip.leadInSec, 0, 1)
    if (isHeader && clip.passOrigin) {
      // 边路高空传中弧线飞向争顶头球点
      const passU = clamp((u - 0.1) / 0.9, 0, 1)
      ball = {
        x: clip.passOrigin.x + (clip.spot.x - clip.passOrigin.x) * passU,
        y: R + (2.02 - R) * passU + Math.sin(passU * Math.PI) * 1.65,
        z: clip.passOrigin.z + (clip.spot.z - clip.passOrigin.z) * passU,
      }
      for (let k = 1; k <= 5; k++) {
        const pu = clamp(passU - k * 0.045, 0, 1)
        if (pu > 0) {
          trail.push({
            x: clip.passOrigin.x + (clip.spot.x - clip.passOrigin.x) * pu,
            y: R + (2.02 - R) * pu + Math.sin(pu * Math.PI) * 1.65,
            z: clip.passOrigin.z + (clip.spot.z - clip.passOrigin.z) * pu,
          })
        }
      }
    } else if (clip.passOrigin) {
      // 地面直塞 / 倒三角喂球滚入射门点
      const passU = clamp((u - 0.12) / 0.88, 0, 1)
      const easePass = 1 - (1 - passU) * (1 - passU)
      ball = {
        x: clip.passOrigin.x + (clip.spot.x - clip.passOrigin.x) * easePass,
        y: R + Math.sin(passU * Math.PI) * 0.12,
        z: clip.passOrigin.z + (clip.spot.z - clip.passOrigin.z) * easePass,
      }
    } else if (!isPenalty && !isFreeKick) {
      // 单骑推进趟球至起脚点
      const startX = clip.spot.x * 1.12
      const startZ = clip.spot.z + 3.6
      ball = {
        x: startX + (clip.spot.x - startX) * u,
        y: R + Math.abs(Math.sin(u * Math.PI * 3)) * 0.04,
        z: startZ + (clip.spot.z - startZ) * u - 0.25 * (1 - u),
      }
    } else {
      ball = { x: clip.spot.x, y: R, z: clip.spot.z }
    }
  } else if (rel <= clip.flightSec) {
    ball = sampleFlightBall(clip, rel)
    const steps = 7
    for (let k = steps; k >= 0; k--) {
      const st = Math.max(0, rel - k * 0.032)
      trail.push(sampleFlightBall(clip, st))
    }
  } else {
    sinceImpact = rel - clip.flightSec
    const preVelBall = sampleFlightBall(clip, Math.max(0, clip.flightSec - 0.02))
    const endBall = sampleFlightBall(clip, clip.flightSec)
    const vel: Vec3 = {
      x: (endBall.x - preVelBall.x) / 0.02,
      y: (endBall.y - preVelBall.y) / 0.02,
      z: (endBall.z - preVelBall.z) / 0.02,
    }
    if (clip.outcome === 'goal') {
      netHit = netImpact(clip.shotModel, '进球')
      ball = netHit ? finishBall(clip.shotModel, netHit, sinceImpact) : { x: clip.target.x, y: R, z: -0.6 }
    } else {
      const kPose = postKeeperPose(
        clip.keeperDive,
        KEEPER_ABILITY,
        clip.flightSec,
        sinceImpact,
        clip.outcome === 'catch',
      )
      const glovesMid: Vec3 = {
        x: (kPose.left.x + kPose.right.x) * 0.5,
        y: (kPose.left.y + kPose.right.y) * 0.5,
        z: GLOVE_Z,
      }
      ball = settleNonGoalBall(endBall, vel, clip.outcome, sinceImpact, glovesMid)
    }
  }

  // 2. 门将姿态
  let keeperPose: ReturnType<typeof keeperAt> & { landed: number }
  if (rel <= 0) {
    const idle = keeperAt(null, KEEPER_ABILITY, 0)
    keeperPose = { ...idle, landed: 0 }
  } else if (rel <= clip.flightSec) {
    const live = keeperAt(clip.keeperDive, KEEPER_ABILITY, rel)
    keeperPose = { ...live, landed: 0 }
  } else {
    keeperPose = postKeeperPose(
      clip.keeperDive,
      KEEPER_ABILITY,
      clip.flightSec,
      rel - clip.flightSec,
      clip.outcome === 'catch',
    )
  }

  // 3. 主攻射手、助攻队友与防守球员姿态
  const aimYaw = yawToward(clip.spot.x, clip.spot.z, clip.target.x * 0.45, 0)
  let striker: ActorPose3D

  if (isHeader) {
    const startX = clip.spot.x - Math.sign(clip.passOrigin?.x || 1) * 1.15
    const startZ = clip.spot.z + 2.7
    if (rel < 0) {
      const u = clamp(elapsed / clip.leadInSec, 0, 1)
      const jumpWindow = u > 0.62 ? (u - 0.62) / 0.38 : 0
      const lift = jumpWindow > 0 ? Math.sin(jumpWindow * Math.PI * 0.5) * 0.56 : 0
      striker = {
        visible: true,
        x: startX + (clip.spot.x - startX) * u,
        z: startZ + (clip.spot.z - startZ) * u,
        yaw: aimYaw,
        mode: jumpWindow > 0 ? 'header_jump' : 'sprint',
        phase: jumpWindow > 0 ? jumpWindow * 0.5 : u * 2.4,
        lift,
      }
    } else {
      const landU = clamp(rel / 0.38, 0, 1)
      const lift = (1 - landU) * 0.56
      const celebU = clip.isGoal && rel > clip.flightSec ? clamp((rel - clip.flightSec) / 1.2, 0, 1) : 0
      striker = {
        visible: true,
        x: clip.spot.x + celebU * 0.85,
        z: clip.spot.z - Math.min(0.45, rel * 0.3) + celebU * 0.4,
        yaw: celebU > 0 ? aimYaw + celebU * 0.65 : aimYaw,
        mode: celebU > 0.08 ? 'celebrate' : landU < 1 ? 'header_jump' : 'kick_follow',
        phase: celebU > 0.08 ? rel - clip.flightSec : 0.5 + landU * 0.5,
        lift,
      }
    }
  } else {
    // 脚下抽射 / 巧射 / 任意球 / 点球
    const runStartZ = clip.spot.z + (isPenalty || isFreeKick ? 2.1 : 3.8)
    const runStartX = clip.spot.x + (isPenalty || isFreeKick ? -0.32 : clip.spot.x * 0.1)
    if (rel < 0) {
      const u = clamp(elapsed / clip.leadInSec, 0, 1)
      striker = {
        visible: true,
        x: runStartX + (clip.spot.x - 0.16 - runStartX) * u,
        z: runStartZ + (clip.spot.z + 0.24 - runStartZ) * u,
        yaw: aimYaw,
        mode: u < 0.78 ? 'sprint' : 'kick_windup',
        phase: u < 0.78 ? u * 2.6 : (u - 0.78) / 0.22,
        lift: u < 0.78 ? Math.abs(Math.sin(u * Math.PI * 4)) * 0.035 : 0,
      }
    } else {
      const followU = clamp(rel / 0.55, 0, 1)
      const celebU = clip.isGoal && rel > clip.flightSec ? clamp((rel - clip.flightSec) / 1.2, 0, 1) : 0
      striker = {
        visible: true,
        x: clip.spot.x - 0.12 + followU * 0.14 + celebU * 0.9,
        z: clip.spot.z + 0.22 - followU * 0.36,
        yaw: celebU > 0 ? aimYaw + celebU * 0.75 : aimYaw,
        mode: celebU > 0.08 ? 'celebrate' : 'kick_follow',
        phase: celebU > 0.08 ? rel - clip.flightSec : followU,
        lift: 0,
      }
    }
  }

  // 助攻者姿态
  let assister: ActorPose3D = hiddenActor
  if (clip.passOrigin && clip.assister) {
    const passYaw = yawToward(clip.passOrigin.x, clip.passOrigin.z, clip.spot.x, clip.spot.z)
    const u = clamp(elapsed / clip.leadInSec, 0, 1)
    assister = {
      visible: true,
      x: clip.passOrigin.x + (u > 0.2 ? Math.sin(passYaw) * -0.45 * Math.min(1, u) : 0),
      z: clip.passOrigin.z - Math.min(0.8, elapsed * 0.35),
      yaw: passYaw,
      mode: elapsed < 0.45 ? 'pass' : 'idle',
      phase: clamp(elapsed / 0.45, 0, 1),
      lift: 0,
    }
  }

  // 防守球员 / 人墙姿态
  const defenders: ActorPose3D[] = []
  if (isFreeKick) {
    const wallZ = Math.max(3.8, clip.spot.z - 9.15)
    const wallCenterX = clip.spot.x * (wallZ / Math.max(8, clip.spot.z)) + (clip.spot.x >= 0 ? -0.38 : 0.38)
    const jumpLift = rel > 0.02 && rel < 0.62 ? Math.sin((rel / 0.6) * Math.PI) * 0.44 : 0
    for (let i = 0; i < 4; i++) {
      const wx = wallCenterX + (i - 1.5) * 0.52
      defenders.push({
        visible: true,
        x: wx,
        z: wallZ,
        yaw: yawToward(wx, wallZ, clip.spot.x, clip.spot.z),
        mode: 'wall',
        phase: jumpLift,
        lift: jumpLift,
      })
    }
  } else if (!isPenalty) {
    // 运动战 2 名回追/盯防后卫
    const d0StartX = clip.spot.x + (clip.spot.x >= 0 ? -1.4 : 1.4)
    const d0StartZ = clip.spot.z + 1.35
    const chaseT = clamp(elapsed / (clip.leadInSec + 0.35), 0, 1)
    const headerDefWindow = isHeader && rel > -0.45 && rel < 0.32 ? (rel + 0.45) / 0.77 : 0
    const headerDefLift = headerDefWindow > 0 ? Math.max(0, Math.sin(headerDefWindow * Math.PI)) * 0.36 : 0
    defenders.push({
      visible: true,
      x: d0StartX + (clip.spot.x * 0.88 - d0StartX) * chaseT * 0.65,
      z: d0StartZ - chaseT * 1.15,
      yaw: yawToward(d0StartX, d0StartZ, clip.spot.x, clip.spot.z * 0.6),
      mode: headerDefLift > 0.04 ? 'header_jump' : chaseT < 0.95 ? 'sprint' : 'idle',
      phase: headerDefLift > 0.04 ? headerDefWindow : chaseT * 2.8,
      lift: headerDefLift,
    })
    const d1X = clamp(-clip.spot.x * 0.45 + (clip.spot.x >= 0 ? -2.6 : 2.6), -9, 9)
    const d1Z = clamp(clip.spot.z - 1.8, 3.8, 16)
    defenders.push({
      visible: true,
      x: d1X,
      z: d1Z - chaseT * 0.8,
      yaw: yawToward(d1X, d1Z, clip.spot.x, clip.spot.z),
      mode: chaseT < 0.9 ? 'sprint' : 'idle',
      phase: chaseT * 2.3 + 0.5,
      lift: 0,
    })
  }

  // 4. 导演自动跟拍机位（平滑衔接传球配合 → 射门飞行 → 球门破网特写）
  const leadU = clamp(elapsed / clip.leadInSec, 0, 1)
  const shotU = rel > 0 ? clamp(rel / (clip.flightSec + 0.45), 0, 1) : 0
  const smoothShot = shotU * shotU * (3 - 2 * shotU)

  const baseCamX = clip.spot.x * 1.08 + (clip.spot.x >= 0 ? 1.55 : -1.55)
  const baseCamZ = clip.spot.z + (clip.spot.z > 15 ? 7.2 : 6.4)
  const baseCamY = clip.spot.z > 15 ? 2.65 : 2.18

  const preOffsetX = clip.passOrigin ? (clip.passOrigin.x - clip.spot.x) * 0.24 * (1 - leadU) : 0
  const preOffsetZ = clip.passOrigin ? 1.8 * (1 - leadU) : 1.1 * (1 - leadU)

  const cinemaCam = {
    pos: {
      x: baseCamX + preOffsetX - clip.spot.x * 0.22 * smoothShot,
      y: baseCamY + 0.35 * (1 - leadU) - 0.18 * smoothShot,
      z: baseCamZ + preOffsetZ - Math.min(3.4, clip.spot.z * 0.24) * smoothShot,
    },
    look: {
      x: ball.x * 0.45 + clip.target.x * 0.35 * smoothShot,
      y: clamp(0.95 + ball.y * 0.25, 0.85, 1.85),
      z: clamp(ball.z * 0.52 * (1 - smoothShot * 0.65), -0.4, 12),
    },
    fov: clip.spot.z > 16 ? 37 : 40,
  }

  const impactReached = rel >= clip.flightSec
  return {
    phase: rel < 0 ? 'lead_in' : rel <= clip.flightSec ? 'flight' : 'impact',
    ball,
    trail,
    striker,
    assister,
    defenders,
    keeperPose,
    netHit,
    sinceImpact,
    bannerActive: impactReached,
    liveScore: impactReached ? clip.scoreAfter : clip.scoreBefore,
    cinemaCam,
  }
}
