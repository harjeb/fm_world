import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fork, type ChildProcess } from 'node:child_process'
import type { MatchJob, MatchJobResult } from './match-job.ts'

export type JobEntry = Pick<MatchJob, 'id' | 'season' | 'divisionId' | 'round' | 'kickoffAt' | 'lockedAt'> & {
  status: 'queued' | 'running' | 'ready' | 'published' | 'pruning'
  attempts: number
  retryAt?: number
  error?: string
  /** 直播中途收到新喊话后置为 true：保持直播可读的同时优先重算，重算完成前阻止发布旧结果。 */
  pendingRecompute?: boolean
}
export type MatchQueueOptions = {
  intervalMs?: number
  /** 测试用确定性执行器；生产默认由唯一的低优先级子进程计算。 */
  compute?: (job: MatchJob) => Promise<MatchJobResult>
  /** 任务结果被写入/重算覆盖后触发，用于刷新服务器直播缓存。 */
  onResultUpdated?: (id: string) => void
}

const atomicJson = (file: string, value: unknown) => {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value))
  fs.renameSync(`${file}.tmp`, file)
}

/** 私有队列。快照先落盘；计算结果先落盘再标 ready，发布是否成功另由 world.json 的赛果判断。 */
export class MatchQueue {
  readonly entries = new Map<string, JobEntry>()
  private readonly indexPath: string
  private busy = false
  private recomputingId: string | null = null
  private closed = false
  private nextRunAt = 0
  private child: ChildProcess | null = null
  private cancelCompute: ((error: Error) => void) | null = null
  private readonly intervalMs: number

  constructor(private readonly dir: string, private readonly options: MatchQueueOptions = {}) {
    fs.mkdirSync(dir, { recursive: true })
    this.indexPath = path.join(dir, 'index.json')
    this.intervalMs = options.intervalMs ?? 1000
    if (fs.existsSync(this.indexPath)) {
      // 损坏的队列不能静默丢弃，否则会用新阵容重算已经锁定的比赛。
      const entries = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as JobEntry[]
      for (const entry of entries) {
        if (entry.status !== 'published' && entry.status !== 'pruning') entry.status = fs.existsSync(this.file(entry.id, 'result')) ? 'ready' : 'queued'
        this.entries.set(entry.id, entry)
      }
      // 仅续做已经在换季提交后获准的删除，不从文件时间猜赛季。
      this.finishPruning()
    }
  }

  prunePublishedBefore(season: number): void {
    const expired = [...this.entries.values()].filter(entry => entry.status === 'published' && entry.season < season)
    if (expired.length) {
      for (const entry of expired) entry.status = 'pruning'
      // 删除授权先原子写入索引；中途退出不会把半删的任务重新排队。
      try { this.persist() } catch (error) {
        for (const entry of expired) entry.status = 'published'
        throw error
      }
    }
    this.finishPruning()
  }

  private finishPruning(): void {
    let changed = false
    for (const entry of this.entries.values()) {
      if (entry.status !== 'pruning') continue
      try {
        for (const kind of ['input', 'result'] as const) fs.rmSync(this.file(entry.id, kind), { force: true })
        this.entries.delete(entry.id)
        changed = true
      } catch (error) { console.error(`旧比赛任务 ${entry.id} 清理失败，下次重试`, error) }
    }
    if (changed) this.persist()
  }

  private file(id: string, kind: 'input' | 'result'): string {
    if (!/^q-[a-f0-9]{64}$/.test(id)) throw new Error('无效比赛任务 ID')
    return path.join(this.dir, `${id}.${kind}.json`)
  }
  private persist(): void { atomicJson(this.indexPath, [...this.entries.values()]) }

  enqueue(input: MatchJob, deferPersist = false): boolean {
    if (this.entries.has(input.id)) return false
    const file = this.file(input.id, 'input')
    // 崩溃可能发生在写快照和写索引之间；第一次锁定的快照永远优先。
    if (fs.existsSync(file)) input = JSON.parse(fs.readFileSync(file, 'utf8')) as MatchJob
    else atomicJson(file, input)
    const { id, season, divisionId, round, kickoffAt, lockedAt } = input
    this.entries.set(id, { id, season, divisionId, round, kickoffAt, lockedAt, status: fs.existsSync(this.file(id, 'result')) ? 'ready' : 'queued', attempts: 0 })
    if (!deferPersist) this.persist()
    return true
  }

  flushIndex(): void {
    this.persist()
  }

  ready(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    if (entry.status === 'ready' || entry.status === 'published') return true
    return !!entry.pendingRecompute && fs.existsSync(this.file(id, 'result'))
  }
  /** 可正式发布到积分榜/战报的判定：必须已完成全部直播重算，绝不发布过期赛果。 */
  publishReady(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry || entry.pendingRecompute || this.recomputingId === id) return false
    return entry.status === 'ready' || entry.status === 'published'
  }
  /** 直播中途更新任务输入（如写入带时间戳的喊话），立刻标记高优重算并保持当前直播不断流。 */
  recomputeLive(id: string, mutate: (job: MatchJob) => void): MatchJob {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('比赛任务不存在')
    if (entry.status === 'published' || entry.status === 'pruning') throw new Error('比赛已公布赛果，无法再调整')
    const input = JSON.parse(fs.readFileSync(this.file(id, 'input'), 'utf8')) as MatchJob
    mutate(input)
    atomicJson(this.file(id, 'input'), input)
    entry.pendingRecompute = true
    delete entry.retryAt
    this.persist()
    void this.pump(Date.now())
    return input
  }
  read(id: string): { input: MatchJob; result: MatchJobResult } {
    return {
      input: JSON.parse(fs.readFileSync(this.file(id, 'input'), 'utf8')) as MatchJob,
      result: JSON.parse(fs.readFileSync(this.file(id, 'result'), 'utf8')) as MatchJobResult,
    }
  }
  published(ids: string[]): void {
    let changed = false
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry && entry.status !== 'published') { entry.status = 'published'; changed = true }
    }
    if (changed) this.persist()
  }

  /** 每次最多启动一场，任务之间留出空隙；直播重算任务（pendingRecompute）最高优先且不等空隙。 */
  async pump(now: number): Promise<void> {
    if (this.busy || this.closed) return
    let entry: JobEntry | undefined
    for (const item of this.entries.values()) {
      if (item.pendingRecompute && item.status !== 'published' && item.status !== 'pruning' && (item.retryAt ?? -Infinity) <= now) {
        if (!entry || !entry.pendingRecompute || item.kickoffAt < entry.kickoffAt || (item.kickoffAt === entry.kickoffAt && item.id.localeCompare(entry.id) < 0)) {
          entry = item
        }
        continue
      }
      if (entry?.pendingRecompute) continue
      if (item.status !== 'queued' || (item.retryAt ?? -Infinity) > now) continue
      if (!entry || item.kickoffAt < entry.kickoffAt || (item.kickoffAt === entry.kickoffAt && item.id.localeCompare(entry.id) < 0)) {
        entry = item
      }
    }
    if (!entry) { this.stopWorker(); return }
    if (!entry.pendingRecompute && performance.now() < this.nextRunAt) return
    this.busy = true
    const wasRecompute = !!entry.pendingRecompute
    if (wasRecompute) {
      this.recomputingId = entry.id
      entry.pendingRecompute = false
    } else {
      entry.status = 'running'
    }
    entry.attempts++
    if (!this.options.compute) this.persist()
    try {
      const input = JSON.parse(fs.readFileSync(this.file(entry.id, 'input'), 'utf8')) as MatchJob
      const result = await (this.options.compute ? this.options.compute(input) : this.computeInWorker(input))
      if (this.closed) return
      if (result.id !== entry.id || result.record.id !== entry.id || !Number.isFinite(result.record.score.home) || !Number.isFinite(result.record.score.away)) throw new Error('比赛计算结果与任务不一致')
      atomicJson(this.file(entry.id, 'result'), result)
      entry.status = 'ready'
      delete entry.error
      delete entry.retryAt
      this.options.onResultUpdated?.(entry.id)
    } catch (error) {
      if (this.closed) return
      if (wasRecompute) entry.pendingRecompute = true
      else entry.status = 'queued'
      entry.error = error instanceof Error ? error.message : String(error)
      entry.retryAt = now + 10_000
      console.error(`比赛任务 ${entry.id} 计算失败，将使用原快照重试：${entry.error}`)
      this.stopWorker()
    } finally {
      this.recomputingId = null
      this.busy = false
      this.nextRunAt = performance.now() + this.intervalMs
      if (!this.closed) this.persist()
      if (!this.closed && [...this.entries.values()].some((item) => item.pendingRecompute)) {
        void this.pump(Date.now())
      }
    }
  }

  private computeInWorker(input: MatchJob): Promise<MatchJobResult> {
    if (!this.child) {
      this.child = fork(new URL('./match-worker.ts', import.meta.url), [], {
        execArgv: ['--import', 'tsx', '--max-old-space-size=256'],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { PATH: process.env.PATH, LANG: process.env.LANG, TZ: process.env.TZ, NODE_ENV: 'production', UV_THREADPOOL_SIZE: '1', GOMAXPROCS: '1', RAYON_NUM_THREADS: '1' },
      })
      try { if (this.child.pid) os.setPriority(this.child.pid, 19) } catch { /* 非 POSIX 平台仍保持单任务、限内存。 */ }
      this.child.stderr?.on('data', (data) => console.error(String(data).trim()))
    }
    const child = this.child
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => fail(new Error('单场计算超过 120 秒')), 120_000)
      const cleanup = () => {
        clearTimeout(timeout)
        child.off('message', message)
        child.off('exit', exit)
        child.off('error', fail)
        this.cancelCompute = null
      }
      const fail = (error: Error) => { cleanup(); reject(error) }
      const exit = (code: number | null) => fail(new Error(`计算子进程退出 (${code})`))
      const message = (reply: { ok: boolean; result?: MatchJobResult; error?: string }) => {
        cleanup()
        if (reply.ok && reply.result) resolve(reply.result)
        else reject(new Error(reply.error ?? '比赛计算失败'))
      }
      this.cancelCompute = fail
      child.once('message', message)
      child.once('exit', exit)
      child.once('error', fail)
      child.send(input, (error) => { if (error) fail(error) })
    })
  }

  private stopWorker(): void {
    const child = this.child
    this.child = null
    if (child) { child.removeAllListeners('exit'); child.kill() }
  }
  close(): void {
    this.closed = true
    this.cancelCompute?.(new Error('比赛队列关闭'))
    this.stopWorker()
  }
}
