import { AccountStore, type Account } from '../server/account-store.ts'

/** 用于旧版本游戏迁移的测试夹具；调用前应先 flush 或关闭服务器。 */
export function readStoredAccounts(dataDir: string): { accounts: Account[] } {
  const store = new AccountStore(dataDir)
  try { return { accounts: store.accounts } } finally { store.close() }
}

export function writeStoredAccounts(dataDir: string, db: { accounts: Account[] }): void {
  const store = new AccountStore(dataDir)
  try { for (const account of db.accounts) store.save(account) } finally { store.close() }
}
