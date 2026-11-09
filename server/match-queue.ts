import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fork, type ChildProcess } from 'node:child_process'
import type { MatchJob, MatchJobResult } from './match-job.ts'

export type JobEntry = Pick<MatchJob, 'id' | 'season' | 'divisionId' | 'round' | 'kickoffAt' | 'lockedAt'> & {
  status: 'queued' | 'running' | 'ready' | 'published'
  attempts: number
  retryAt?: number
  error?: string
}
export type MatchQueueOptions = {
  intervalMs?: number
  /** 测试用确定性执行器；生产默认由唯一的低优先级子进程计算。 */
  compute?: (job: MatchJob) => Promise<MatchJobResult>
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
        if (entry.status !== 'published') entry.status = fs.existsSync(this.file(entry.id, 'result')) ? 'ready' : 'queued'
        this.entries.set(entry.id, entry)
      }
    }
  }

  private file(id: string, kind: 'input' | 'result'): string {
    if (!/^q-[a-f0-9]{64}$/.test(id)) throw new Error('无效比赛任务 ID')
    return path.join(this.dir, `${id}.${kind}.json`)
  }
  private persist(): void { atomicJson(this.indexPath, [...this.entries.values()]) }

  enqueue(input: MatchJob): boolean {
    if (this.entries.has(input.id)) return false
    const file = this.file(input.id, 'input')
    // 崩溃可能发生在写快照和写索引之间；第一次锁定的快照永远优先。
    if (fs.existsSync(file)) input = JSON.parse(fs.readFileSync(file, 'utf8')) as MatchJob
    else atomicJson(file, input)
    const { id, season, divisionId, round, kickoffAt, lockedAt } = input
    this.entries.set(id, { id, season, divisionId, round, kickoffAt, lockedAt, status: fs.existsSync(this.file(id, 'result')) ? 'ready' : 'queued', attempts: 0 })
    this.persist()
    return true
  }

  ready(id: string): boolean {
    const status = this.entries.get(id)?.status
    return status === 'ready' || status === 'published'
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

  /** 每次最多启动一场，任务之间留出空隙；HTTP 请求只负责入队/发布，绝不运行仿真。 */
  async pump(now: number): Promise<void> {
    if (this.busy || this.closed || performance.now() < this.nextRunAt) return
    const entry = [...this.entries.values()].filter((item) => item.status === 'queued' && (item.retryAt ?? -Infinity) <= now)
      .sort((a, b) => a.kickoffAt - b.kickoffAt || a.id.localeCompare(b.id))[0]
    if (!entry) { this.stopWorker(); return }
    this.busy = true
    entry.status = 'running'
    entry.attempts++
    this.persist()
    try {
      const input = JSON.parse(fs.readFileSync(this.file(entry.id, 'input'), 'utf8')) as MatchJob
      const result = await (this.options.compute ? this.options.compute(input) : this.computeInWorker(input))
      if (this.closed) return
      if (result.id !== entry.id || result.record.id !== entry.id || !Number.isFinite(result.record.score.home) || !Number.isFinite(result.record.score.away)) throw new Error('比赛计算结果与任务不一致')
      atomicJson(this.file(entry.id, 'result'), result)
      entry.status = 'ready'
      delete entry.error
      delete entry.retryAt
    } catch (error) {
      if (this.closed) return
      entry.status = 'queued'
      entry.error = error instanceof Error ? error.message : String(error)
      entry.retryAt = now + 10_000
      console.error(`比赛任务 ${entry.id} 计算失败，将使用原快照重试：${entry.error}`)
      this.stopWorker()
    } finally {
      this.busy = false
      this.nextRunAt = performance.now() + this.intervalMs
      if (!this.closed) this.persist()
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
