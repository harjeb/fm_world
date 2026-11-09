import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildOwnerlessTeams, createOwnerlessWorld } from '../src/game/world.ts'
import { computeMatchJob, matchJobId, type MatchJob, type MatchJobResult } from '../server/match-job.ts'
import { MatchQueue } from '../server/match-queue.ts'

const dirs: string[] = [], queues: MatchQueue[] = []
afterEach(() => {
  while (queues.length) queues.pop()!.close()
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const makeDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-queue-')); dirs.push(dir); return dir }
const makeQueue = (dir: string, compute?: (job: MatchJob) => Promise<MatchJobResult>) => {
  const queue = new MatchQueue(dir, { intervalMs: 0, compute }); queues.push(queue); return queue
}
function makeJob(): MatchJob {
  const kickoffAt = Date.UTC(2026, 10, 9, 12)
  const { world } = createOwnerlessWorld(17, kickoffAt)
  const teams = buildOwnerlessTeams(world, 17)
  const division = world.divisions[0], fixture = division.fixtures[0]
  return {
    id: matchJobId(1, division.divisionId!, fixture), season: 1, divisionId: division.divisionId!, round: 1,
    kickoffAt, lockedAt: kickoffAt - 30 * 60_000, seed: 71, gameDayMs: division.gameDayMs,
    home: { team: teams[fixture.homeId], injuries: {}, suspended: [], medical: 1 },
    away: { team: teams[fixture.awayId], injuries: {}, suspended: [], medical: 1 },
  }
}

describe('持久化比赛任务队列', () => {
  it('相同快照和种子产生完全相同的结果，不修改快照，也不依赖计算时的真实时间', () => {
    const job = makeJob(), before = structuredClone(job)
    const first = computeMatchJob(job)
    vi.spyOn(Date, 'now').mockReturnValue(job.kickoffAt + 1_000_000)
    expect(computeMatchJob(job)).toEqual(first)
    expect(job).toEqual(before)
    expect(first.record.createdAt).toBe(job.kickoffAt)
    expect(first.id).toBe(job.id)
  })

  it('最多一场在计算；快照和已计算结果重启后复用，不受后来改阵容/属性影响', async () => {
    const dir = makeDir(), job = makeJob(), frozen = structuredClone(job)
    let finish!: (value: MatchJobResult) => void
    const compute = vi.fn(() => new Promise<MatchJobResult>((resolve) => { finish = resolve }))
    const queue = makeQueue(dir, compute)
    queue.enqueue(job)
    job.home.team.players[0].attrs.passing += 100
    const first = queue.pump(job.lockedAt)
    await queue.pump(job.lockedAt)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(queue.entries.get(job.id)!.status).toBe('running')
    finish(computeMatchJob(frozen)); await first
    expect(queue.read(job.id).input).toEqual(JSON.parse(JSON.stringify(frozen)))
    const result = queue.read(job.id).result
    queue.close()
    const never = vi.fn(async () => { throw new Error('已算好的结果不能重算') })
    const restored = makeQueue(dir, never)
    expect(restored.enqueue(job)).toBe(false)
    await restored.pump(job.kickoffAt)
    expect(never).not.toHaveBeenCalled()
    expect(restored.read(job.id).result).toEqual(result)
    expect(restored.entries.get(job.id)!.attempts).toBe(1)
  })

  it('在结果落盘而索引尚未更新时崩溃，重启仍直接恢复结果', async () => {
    const dir = makeDir(), job = makeJob()
    const queue = makeQueue(dir, async (input) => computeMatchJob(input))
    queue.enqueue(job); await queue.pump(job.lockedAt); queue.close()
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))
    index[0].status = 'running'
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index))
    const restored = makeQueue(dir)
    expect(restored.ready(job.id)).toBe(true)
    expect(restored.entries.get(job.id)!.attempts).toBe(1)
  })

  it('失败只重试同一份快照和种子，不重新抽取比赛输入', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dir = makeDir(), job = makeJob()
    const compute = vi.fn(async (input: MatchJob) => {
      if (compute.mock.calls.length === 1) throw new Error('临时失败')
      return computeMatchJob(input)
    })
    const queue = makeQueue(dir, compute)
    queue.enqueue(job); await queue.pump(job.lockedAt)
    expect(queue.entries.get(job.id)!.status).toBe('queued')
    await queue.pump(job.lockedAt + 10_001)
    expect(queue.ready(job.id)).toBe(true)
    expect(compute.mock.calls[1][0]).toEqual(compute.mock.calls[0][0])
  })

  it('索引损坏时明确报错，不静默丢弃锁定快照', () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, 'index.json'), '{invalid')
    expect(() => new MatchQueue(dir)).toThrow()
  })
})
