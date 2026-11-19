// Both the worker and synchronous shutdown use the same statements inside their account transaction.
export function prepareAccountParts(db) {
  const select = db.prepare('SELECT slot, hash FROM account_game_refs WHERE account_id = ?')
  const insert = db.prepare('INSERT OR IGNORE INTO account_game_parts (hash, json) VALUES (?, ?)')
  const set = db.prepare(`INSERT INTO account_game_refs (account_id, slot, hash) VALUES (?, ?, ?)
    ON CONFLICT(account_id, slot) DO UPDATE SET hash=excluded.hash`)
  const remove = db.prepare('DELETE FROM account_game_refs WHERE account_id = ? AND slot = ?')
  const prune = db.prepare('DELETE FROM account_game_parts WHERE hash = ? AND NOT EXISTS (SELECT 1 FROM account_game_refs WHERE hash = ?)')
  return (id, parts) => {
    const previous = new Map(select.all(id).map(({ slot, hash }) => [slot, hash]))
    const stale = new Set()
    for (const { slot, hash, json } of parts) {
      const before = previous.get(slot)
      previous.delete(slot)
      if (before === hash) continue
      insert.run(hash, json)
      set.run(id, slot, hash)
      if (before !== undefined) stale.add(before)
    }
    for (const [slot, hash] of previous) {
      remove.run(id, slot)
      stale.add(hash)
    }
    for (const hash of stale) prune.run(hash, hash)
  }
}
