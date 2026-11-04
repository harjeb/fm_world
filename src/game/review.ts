import type { MatchRecord, ReviewRecommendation } from './types.ts'
import { SKILLS } from './data/skills.ts'

export function buildReview(record: MatchRecord): ReviewRecommendation[] {
  const out: ReviewRecommendation[] = []
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
  if (record.stats.home.possession < 44) {
    out.push({ title: '控球被压制', detail: `控球率 ${record.stats.home.possession}%。可尝试短传、降低节奏，或让中场更多回撤接应。`, tone: 'warn' })
  }
  const passRate = record.stats.home.passes > 0 ? record.stats.home.passesCompleted / record.stats.home.passes : 0
  if (record.stats.home.passes > 20 && passRate < 0.72) {
    out.push({ title: '传球成功率偏低', detail: `传球成功率约 ${(passRate * 100).toFixed(0)}%。检查接应距离与逆足，短传路线通常比强行直塞更稳。`, tone: 'warn' })
  }
  const unrecognized = record.failureStats.find((item) => item.reason === 'unrecognized')?.count ?? 0
  if (unrecognized > 0) {
    out.push({ title: '有线路没被识别', detail: `出现 ${unrecognized} 次“视野不足导致没看到”的失败。提升视野，或降低传球冒险程度。`, tone: 'warn' })
  }
  const noSkill = record.skillStats.filter((skill) => skill.side === 'home' && skill.conditions > 0 && skill.applied === 0)
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
  const top = [...record.playerStats].filter((player) => player.side === 'home').sort((a, b) => b.goals - a.goals || b.shots - a.shots)[0]
  if (top && top.goals > 0) {
    out.push({ title: '本场贡献', detail: `${top.name} 打进 ${top.goals} 球，完成 ${top.shots} 次射门。`, tone: 'good' })
  }
  if (out.length === 0) out.push({ title: '比赛运行正常', detail: '没有发现明显的结构性异常。继续观察射门、传球成功率与技能触发。', tone: 'good' })
  return out
}
