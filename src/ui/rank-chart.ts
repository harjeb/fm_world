import type { Fixture, TierId } from '../game/types.ts'
import { computeTeamRankTrend, type RankTrendSummary } from '../game/standings-history.ts'
import { PLAYER_TEAM_ID, teamName } from '../game/season.ts'
import { worldDivisionLabel } from '../game/world.ts'
import { onlineState, publicWorld } from '../online.ts'
import { clubLook, crest, panel, tag } from './components.ts'
import { esc } from './format.ts'
import { tipAttrs } from './tooltip.ts'
import { game } from './state.ts'

const RESULT_LABELS: Record<'W' | 'D' | 'L', string> = { W: '胜', D: '平', L: '负' }
const RESULT_COLORS: Record<'W' | 'D' | 'L', string> = { W: '#4fd08a', D: '#f2b84b', L: '#f2706a' }

function hexLuminance(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return 0.5
  const value = parseInt(match[1], 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((part) => {
    const c = part / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** 深色球衣在石墨底面板上对比度过低时，回退为高亮天蓝色以保证折线清晰可读。 */
function readableLineColor(color: string | undefined, isPlayer: boolean): string {
  if (isPlayer) return 'var(--accent)'
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return 'var(--info)'
  return hexLuminance(color) < 0.14 ? '#62aef5' : color
}

function uniqueSorted(nums: number[]): number[] {
  return [...new Set(nums)].sort((a, b) => a - b)
}

export function renderRankTrendChart(
  trend: RankTrendSummary,
  options: {
    tier?: TierId
    color?: string
    isPlayer?: boolean
    clubNames?: ReadonlyMap<string, string>
  } = {},
): string {
  const width = 680
  const height = 186
  const left = 38
  const right = width - 16
  const top = 14
  const bottom = height - 26
  const plotW = right - left
  const plotH = bottom - top
  const totalTeams = Math.max(2, trend.totalTeams)
  const totalRounds = Math.max(2, trend.totalRounds)

  const xOf = (round: number) => left + ((Math.max(1, Math.min(totalRounds, round)) - 1) / (totalRounds - 1)) * plotW
  const yOf = (rank: number) => top + ((Math.max(1, Math.min(totalTeams, rank)) - 1) / (totalTeams - 1)) * plotH
  const bandRect = (fromRank: number, toRank: number, cls: string) => {
    const y1 = Math.max(top - 5, yOf(fromRank - 0.45))
    const y2 = Math.min(bottom + 5, yOf(toRank + 0.45))
    if (y2 <= y1) return ''
    return `<rect x="${left}" y="${y1.toFixed(1)}" width="${plotW}" height="${(y2 - y1).toFixed(1)}" class="rank-zone ${cls}"/>`
  }

  let zones = ''
  if (options.tier === 'champions') {
    zones = `${bandRect(1, 1, 'champion')}${totalTeams >= 6 ? bandRect(totalTeams - 2, totalTeams, 'relegate') : ''}`
  } else if (options.tier === 'division1') {
    zones = `${bandRect(1, Math.min(3, totalTeams), 'promote')}${totalTeams >= 6 ? bandRect(totalTeams - 2, totalTeams, 'relegate') : ''}`
  } else if (options.tier === 'division2') {
    zones = bandRect(1, Math.min(3, totalTeams), 'playoff')
  }

  const yRanks = uniqueSorted(
    [1, 3, Math.round(totalTeams / 2), totalTeams >= 6 ? totalTeams - 2 : 1, totalTeams].filter((r) => r >= 1 && r <= totalTeams),
  )
  const hGrid = yRanks.map((rank) => {
    const y = yOf(rank).toFixed(1)
    return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="rank-grid-line${rank === 1 ? ' top' : ''}"/>
      <text x="${left - 7}" y="${(Number(y) + 3.8).toFixed(1)}" text-anchor="end" class="rank-axis-label">#${rank}</text>`
  }).join('')

  const xTicks = uniqueSorted(
    [1, 5, 10, 15, 19, 25, 30, 35, totalRounds].filter((r) => r >= 1 && r <= totalRounds),
  )
  const vAxis = xTicks.map((round) => {
    const x = xOf(round).toFixed(1)
    return `<line x1="${x}" y1="${bottom}" x2="${x}" y2="${bottom + 4}" class="rank-tick"/>
      <text x="${x}" y="${height - 8}" text-anchor="middle" class="rank-axis-label">${round}</text>`
  }).join('')

  const stroke = readableLineColor(options.color, !!options.isPlayer)
  let bodySvg = ''
  if (trend.points.length === 0) {
    bodySvg = `<text x="${((left + right) / 2).toFixed(1)}" y="${((top + bottom) / 2 + 4).toFixed(1)}" text-anchor="middle" class="rank-empty-text">首轮联赛结算后自动生成本赛季排名折线</text>`
  } else {
    const coords = trend.points.map((p) => ({ p, x: xOf(p.round), y: yOf(p.rank) }))
    const polyPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    const first = coords[0]
    const last = coords[coords.length - 1]
    const areaPoints = coords.length >= 2
      ? `${first.x.toFixed(1)},${bottom.toFixed(1)} ${polyPoints} ${last.x.toFixed(1)},${bottom.toFixed(1)}`
      : ''
    const singleGuide = coords.length === 1
      ? `<line x1="${left}" y1="${first.y.toFixed(1)}" x2="${first.x.toFixed(1)}" y2="${first.y.toFixed(1)}" class="rank-guide-line" style="stroke:${stroke}"/>`
      : ''
    const dots = coords.map(({ p, x, y }, index) => {
      const isLatest = index === coords.length - 1
      const oppName = p.opponentId
        ? (options.clubNames?.get(p.opponentId) ?? clubLook(p.opponentId).name)
        : ''
      const matchDesc = p.score && p.result
        ? `${p.isHome ? '主' : '客'} ${p.score.home}:${p.score.away} ${RESULT_LABELS[p.result]} ${oppName}`
        : `已赛 ${p.played} 场`
      const gdText = p.gd >= 0 ? `+${p.gd}` : `${p.gd}`
      const tipTitle = `第 ${p.round} 轮 · 第 ${p.rank} 名`
      const tipBody = `${matchDesc} · 积分 ${p.points}（净胜 ${gdText}）`
      const dotFill = p.result ? RESULT_COLORS[p.result] : stroke
      return `<g class="rank-dot${isLatest ? ' latest' : ''}" ${tipAttrs(tipTitle, tipBody)}>
        <title>${esc(`${tipTitle}｜${tipBody}`)}</title>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="transparent"/>
        ${isLatest ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="none" stroke="${stroke}" stroke-width="1.4" opacity="0.65"/>` : ''}
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isLatest ? '3.8' : '3'}" fill="${dotFill}" stroke="var(--panel)" stroke-width="1.2"/>
      </g>`
    }).join('')

    bodySvg = `
      ${areaPoints ? `<polygon points="${areaPoints}" class="rank-area" style="fill:${stroke}"/>` : ''}
      ${singleGuide}
      ${coords.length >= 2 ? `<polyline points="${polyPoints}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${dots}
    `
  }

  const deltaBadge = trend.points.length < 2
    ? ''
    : trend.deltaFromPrev > 0
      ? `<span class="rank-delta up">↑${trend.deltaFromPrev}</span>`
      : trend.deltaFromPrev < 0
        ? `<span class="rank-delta down">↓${Math.abs(trend.deltaFromPrev)}</span>`
        : '<span class="rank-delta flat">持平</span>'

  const zoneLegend = options.tier === 'champions'
    ? '<span class="legend-item"><i class="swatch zone-champion"></i>榜首争冠</span><span class="legend-item"><i class="swatch zone-relegate"></i>降级区</span>'
    : options.tier === 'division1'
      ? '<span class="legend-item"><i class="swatch zone-promote"></i>前三升级区</span><span class="legend-item"><i class="swatch zone-relegate"></i>后三降级区</span>'
      : options.tier === 'division2'
        ? '<span class="legend-item"><i class="swatch zone-playoff"></i>前三升级杯区</span>'
        : ''

  return `<div class="rank-chart-wrap">
    <div class="rank-kpis">
      <div class="rank-kpi"><span>当前排名</span><b>${trend.currentRank ? `#${trend.currentRank}` : '—'}${deltaBadge}</b></div>
      <div class="rank-kpi"><span>赛季最高</span><b>${trend.bestRank ? `#${trend.bestRank}` : '—'}</b></div>
      <div class="rank-kpi"><span>赛季最低</span><b>${trend.worstRank ? `#${trend.worstRank}` : '—'}</b></div>
      <div class="rank-kpi"><span>已统计轮次</span><b>${trend.points.length} <small>/ ${trend.totalRounds} 轮</small></b></div>
    </div>
    <svg class="rank-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="本赛季排名变化折线图">
      ${zones}
      ${hGrid}
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="rank-axis-line"/>
      ${vAxis}
      ${bodySvg}
    </svg>
    <div class="legend rank-legend">
      ${zoneLegend}
      <span class="legend-item"><i class="swatch rank-dot-w"></i>胜</span>
      <span class="legend-item"><i class="swatch rank-dot-d"></i>平</span>
      <span class="legend-item"><i class="swatch rank-dot-l"></i>负</span>
      <span class="muted small">悬停或点击圆点查看当轮比分与积分</span>
    </div>
  </div>`
}

/**
 * 根据球队 ID 在当前世界（联机快照或本地世界 / 单级联赛）中定位其所属联赛，渲染该队本赛季排名变化面板。
 */
export function renderClubRankTrendPanel(clubId: string, options: { extraAside?: string; titlePrefix?: string } = {}): string {
  const snapshot = onlineState.status === 'online' ? publicWorld : null
  if (snapshot) {
    const ownId = snapshot.ownClubId ?? PLAYER_TEAM_ID
    const rawTarget = clubId === PLAYER_TEAM_ID ? ownId : clubId
    const division = snapshot.divisions.find((div) =>
      div.table.some((row) => row.teamId === rawTarget || row.teamId === clubId)
      || div.fixtures.some((fx) => fx.homeId === rawTarget || fx.awayId === rawTarget),
    )
    if (!division) return ''
    const normId = (id: string) => (id === ownId ? PLAYER_TEAM_ID : id)
    const targetId = normId(rawTarget)
    const names = new Map<string, string>()
    for (const club of snapshot.clubs) {
      const id = normId(club.id)
      names.set(id, id === PLAYER_TEAM_ID ? game.clubName : club.name)
    }
    const clubMeta = snapshot.clubs.find((c) => c.id === rawTarget || normId(c.id) === targetId)
    const fixtures: Fixture[] = division.fixtures.map((fx) => ({
      ...fx,
      homeId: normId(fx.homeId),
      awayId: normId(fx.awayId),
    }))
    const teamIds = division.table.map((row) => normId(row.teamId))
    const trend = computeTeamRankTrend({ teamId: targetId, teamIds, fixtures, names })
    const clubTitle = targetId === PLAYER_TEAM_ID ? game.clubName : (clubMeta?.name ?? clubLook(targetId).name)
    const divLabel = game.world ? worldDivisionLabel(game.world, division.id) : division.id
    const color = clubMeta?.color ?? clubLook(targetId).color
    const title = options.titlePrefix ?? `${esc(clubTitle)} · 本赛季排名变化`
    return panel(
      title,
      renderRankTrendChart(trend, {
        tier: division.tier,
        color,
        isPlayer: targetId === PLAYER_TEAM_ID,
        clubNames: names,
      }),
      {
        aside: `${crest({ name: clubTitle, color }, 16)}${tag(esc(divLabel))}${options.extraAside ? ` ${options.extraAside}` : ''}`,
      },
    )
  }

  if (game.world) {
    const world = game.world
    const division = world.divisions.find((div) =>
      div.clubIds?.includes(clubId)
      || div.table.some((row) => row.teamId === clubId)
      || div.fixtures.some((fx) => fx.homeId === clubId || fx.awayId === clubId),
    ) ?? (clubId === PLAYER_TEAM_ID ? game.season : undefined)
    if (!division) return ''
    const names = new Map<string, string>(
      world.clubs.map((club) => [club.id, club.id === PLAYER_TEAM_ID ? game.clubName : club.name]),
    )
    const teamIds = division.table.length > 0 ? division.table.map((r) => r.teamId) : (division.clubIds ?? [])
    const trend = computeTeamRankTrend({ teamId: clubId, teamIds, fixtures: division.fixtures, names })
    const look = clubLook(clubId)
    const divId = division.divisionId ?? world.playerDivisionId
    const divLabel = worldDivisionLabel(world, divId)
    const title = options.titlePrefix ?? `${esc(look.name)} · 本赛季排名变化`
    return panel(
      title,
      renderRankTrendChart(trend, {
        tier: division.tier,
        color: look.color,
        isPlayer: clubId === PLAYER_TEAM_ID,
        clubNames: names,
      }),
      {
        aside: `${crest(look, 16)}${tag(esc(divLabel))}${options.extraAside ? ` ${options.extraAside}` : ''}`,
      },
    )
  }

  // 单级联赛旧存档回退
  const season = game.season
  if (!season) return ''
  const names = new Map<string, string>([
    [PLAYER_TEAM_ID, game.clubName],
    ...game.aiTeams.map((team) => [team.id, team.name] as [string, string]),
  ])
  const teamIds = season.table.map((row) => row.teamId)
  if (!teamIds.includes(clubId)) return ''
  const trend = computeTeamRankTrend({ teamId: clubId, teamIds, fixtures: season.fixtures, names })
  const look = { name: teamName(game, clubId), color: clubLook(clubId).color }
  const title = options.titlePrefix ?? `${esc(look.name)} · 本赛季排名变化`
  return panel(
    title,
    renderRankTrendChart(trend, {
      tier: season.tier,
      color: look.color,
      isPlayer: clubId === PLAYER_TEAM_ID,
      clubNames: names,
    }),
    {
      aside: `${crest(look, 16)}${options.extraAside ? ` ${options.extraAside}` : ''}`,
    },
  )
}
