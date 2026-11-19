/** Offline-only compatibility step before returning to a pre-deduplication server. */
import fs from 'node:fs'
import path from 'node:path'
import { ACCOUNT_DB_FILE, AccountStore } from '../server/account-store.ts'

const [flag, dir] = process.argv.slice(2)
if (flag !== '--server-stopped' || !dir || !fs.existsSync(path.join(dir, ACCOUNT_DB_FILE))) {
  throw new Error('Stop the server and back up the database first. Usage: node --import tsx scripts/expand-account-saves.ts --server-stopped <dataDir>')
}
const store = new AccountStore(dir, 1000, false)
try {
  for (const account of store.accounts) store.save(account)
  await store.flush()
  console.log(`Expanded ${store.accounts.length} account saves without changing their revisions.`)
} finally {
  store.close()
}
