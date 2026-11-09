import { computeMatchJob, type MatchJob } from './match-job.ts'

// 单一低优先级子进程；不读取生产配置或数据，只接收一场不可变的比赛快照。
process.on('message', (job: MatchJob) => {
  try {
    process.send?.({ ok: true, result: computeMatchJob(job) })
  } catch (error) {
    process.send?.({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})
process.on('disconnect', () => process.exit(0))
