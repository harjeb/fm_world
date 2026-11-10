import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'

let db
let saveAccount
let saveSession
let deleteSession
let startupError
try {
  db = new DatabaseSync(workerData.filename)
  db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
  saveAccount = db.prepare(workerData.accountSql)
  saveSession = db.prepare(workerData.sessionSql)
  deleteSession = db.prepare(workerData.deleteSessionSql)
} catch (error) {
  startupError = error
}

// 单线程串行提交；共享状态让停服时主线程也能同步等到当前事务真正落盘。
parentPort.on('message', (message) => {
  const status = new Int32Array(message.status)
  let transaction = false
  let error
  try {
    if (message.close) {
      db?.close()
      parentPort.close()
    } else {
      if (startupError) throw startupError
      db.exec('BEGIN IMMEDIATE')
      transaction = true
      for (const values of message.accounts) saveAccount.run(...values)
      for (const [token, accountId] of message.sessions) {
        if (accountId === null) deleteSession.run(token)
        else saveSession.run(token, accountId)
      }
      db.exec('COMMIT')
      transaction = false
    }
  } catch (caught) {
    if (transaction) {
      try { db.exec('ROLLBACK') } catch { /* 原始写入错误优先；主线程会保留待保存状态。 */ }
    }
    error = caught instanceof Error ? caught.message : String(caught)
  }
  Atomics.store(status, 0, error ? -1 : 1)
  Atomics.notify(status, 0)
  if (!message.close) parentPort.postMessage({ id: message.id, error })
})
