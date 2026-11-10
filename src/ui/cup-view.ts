import type { CupRun, CupFixture } from '../game/types.ts'
import { CUP_DEFS, CUP_SEED, type CupId } from '../game/data/cup-config.ts'
import { buildCupField, buildCupGroups } from '../game/cup.ts'
import { cupPlayerFixture } from '../game/cup-run.ts'
import { sortCupTable } from '../game/cup-table.ts'
import { splitSeed } from '../game/rng.ts'
import { panel, tag } from './components.ts'
import { esc } from './format.ts'
import { pveTeamButton } from './pve-details.ts'
import { game, ui } from './state.ts'

const STATUS = { active: '进行中', eliminated: '已淘汰', champion: '已夺冠', void: '已作废' }
const STAGE = { group: '小组赛', r16: '16 强', qf: '1/4 决赛', sf: '半决赛', final: '决赛', done: '结束' }
const nameOf = (run: CupRun, id: string) => run.participants[id]?.name ?? id

function review(fixture: CupFixture): string {
  return fixture.matchId && game.challengeHistory.some((record) => record.id === fixture.matchId)
    ? `<button class="btn small ghost" data-action="open-review" data-record="${esc(fixture.matchId)}">战报</button>` : ''
}

function teamLink(run: CupRun, id: string): string {
  return id === 'player' ? `<b>${esc(game.clubName)} ${tag('你', 'good')}</b>`
    : pveTeamButton(`cup:${run.cupId}:${id}`, nameOf(run, id))
}

function fixtureRow(run: CupRun, fixture: CupFixture): string {
  return `<div class="cup-fixture ${[fixture.homeId, fixture.awayId].includes('player') ? 'mine' : ''}"><span>${teamLink(run, fixture.homeId)}</span><b>${fixture.score ? `${fixture.score.home}:${fixture.score.away}` : '未赛'}</b><span>${teamLink(run, fixture.awayId)}</span>${fixture.shootout ? `<small>点球 ${fixture.shootout.home}:${fixture.shootout.away}</small>` : ''}${review(fixture)}</div>`
}

function runView(run: CupRun): string {
  const next = cupPlayerFixture(run)
  const nextText = next ? `${STAGE[run.stage]} · ${nameOf(run, next.fixture.homeId)} vs ${nameOf(run, next.fixture.awayId)}${next.tie?.legs.length === 2 ? ` · 第 ${next.fixture.round} 回合` : ''}` : STATUS[run.status]
  const seed = splitSeed(CUP_SEED, `${run.cupId}-${run.seasonIndex}`)
  const rounds = [...(run.rounds ?? [])]
  if (run.knockout && !rounds.some((round) => round.round === run.knockout!.round)) rounds.push(run.knockout)
  return `<p class="hint pad">第 ${run.seasonIndex} 赛季 · ${esc(nextText)}。小组前 2 出线；两回合不计客场进球，总比分平局才点球。</p>
    <div class="cup-groups">${run.groups.map((group) => `<details class="cup-group" ${group.index === run.playerGroupIndex ? 'open' : ''}>
      <summary>${String.fromCharCode(65 + group.index)} 组 ${group.index === run.playerGroupIndex ? '· 你的分组' : ''}</summary>
      <div class="table-scroll"><table class="dt"><thead><tr><th>球队</th><th>场</th><th>胜/平/负</th><th>进:失</th><th>分</th></tr></thead><tbody>
      ${sortCupTable(group, seed).map((row, index) => `<tr class="${index < 2 ? 'cup-qualified' : ''}"><td>${teamLink(run, row.teamId)}</td><td>${row.played}</td><td>${row.won}/${row.drawn}/${row.lost}</td><td>${row.gf}:${row.ga}</td><td><b>${row.points}</b></td></tr>`).join('')}
      </tbody></table></div>${group.fixtures.map((fixture) => fixtureRow(run, fixture)).join('')}
    </details>`).join('')}</div>
    ${rounds.map((round) => panel(STAGE[round.round], `<div class="cup-ties">${round.ties.map((tie) => `<div class="cup-tie">
      ${tie.legs.map((fixture) => fixtureRow(run, fixture)).join('')}
      ${tie.aggregate ? `<p class="small">总比分（${esc(nameOf(run, tie.legs[0].homeId))} 在前）：<b>${tie.aggregate.home}:${tie.aggregate.away}</b>${tie.shootout ? ` · 点球 ${tie.shootout.home}:${tie.shootout.away}` : ''}</p>` : ''}
      ${tie.winnerId ? `<p class="small">${round.round === 'final' ? '冠军' : '晋级'}：${esc(nameOf(run, tie.winnerId))}</p>` : ''}
    </div>`).join('')}</div>`, { flush: true })).join('')}`
}

function preview(cupId: CupId): string {
  const groups = buildCupGroups(cupId, buildCupField(cupId, game), game.season.index)
  return `<div class="cup-groups">${groups.map((group) => `<section class="cup-group"><h3>${String.fromCharCode(65 + group.index)} 组</h3><ul>${group.teams.map((entry) => `<li>${tag(entry.kind === 'player' ? '你' : entry.kind === 'world' ? '世界' : '随机', entry.kind === 'player' ? 'good' : '')} ${esc(entry.name)}</li>`).join('')}</ul></section>`).join('')}</div><p class="hint pad">每组 4 队单循环，3 轮；按你自己的节奏逐场比赛，不绑定现实开赛时间。</p>`
}

export function renderCup(): string {
  const selected = CUP_DEFS.find((def) => def.id === ui.cupPreviewId)
  const past = [...(game.pve?.cupHistory ?? [])]
  for (const run of Object.values(game.pve?.cups ?? {})) if (run.seasonIndex < game.season.index && !past.some((old) => old.cupId === run.cupId && old.seasonIndex === run.seasonIndex)) past.push(run)
  const shown = selected && ui.cupHistorySeason !== null
    ? past.find((run) => run.cupId === selected.id && run.seasonIndex === ui.cupHistorySeason)
    : selected && game.pve?.cups[selected.id]?.seasonIndex === game.season.index ? game.pve.cups[selected.id] : undefined
  return `<div class="cup-cards">${CUP_DEFS.map((def) => {
    const saved = game.pve?.cups[def.id]
    const run = saved?.seasonIndex === game.season.index ? saved : undefined
    const enter = !run || run.status === 'void'
    return panel(def.name, `<p>${esc(def.description)}</p><div class="tag-row">${tag(`${def.size} 队`)}${tag(`${def.groups} 组`)}${tag(run ? STATUS[run.status] : '未报名', run?.status === 'champion' ? 'gold' : '')}</div><div class="cup-actions">
      ${enter ? `<button class="btn small" data-action="enter-cup" data-cup="${def.id}" ${game.activeMatch || game.season.finished ? 'disabled' : ''}>报名</button>` : run?.status === 'active' ? `<button class="btn small" data-action="start-cup-match" data-cup="${def.id}" ${!cupPlayerFixture(run) || game.activeMatch ? 'disabled' : ''}>继续比赛</button>` : `<span class="muted small">本季已结束，下赛季可重新报名。</span>`}
      <button class="btn small ghost" data-action="cup-preview" data-cup="${def.id}">查看${run ? '赛程' : '分组'}</button></div>`)
  }).join('')}</div>
  ${selected ? panel(`${selected.name} · ${ui.cupHistorySeason === null ? '本赛季' : `第 ${ui.cupHistorySeason} 赛季`}`, shown ? runView(shown) : preview(selected.id), { flush: true }) : ''}
  ${panel('历届杯赛记录', past.length ? `<div class="rows">${past.sort((a, b) => b.seasonIndex - a.seasonIndex).map((run) => `<button class="row-btn" data-cup-history="${run.cupId}" data-season="${run.seasonIndex}">第 ${run.seasonIndex} 赛季 · ${esc(CUP_DEFS.find((def) => def.id === run.cupId)?.name ?? run.cupId)} · ${STATUS[run.status]}</button>`).join('')}</div>` : '<p class="muted pad">换季后保留完整小组赛与淘汰赛记录。</p>', { flush: true })}`
}
