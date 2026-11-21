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

export function prepareColdDataWriters(db) {
  const saveMatchDetail = db.prepare(`INSERT INTO match_record_details (account_id, match_id, detail_json) VALUES (?, ?, ?)
    ON CONFLICT(account_id, match_id) DO UPDATE SET detail_json=excluded.detail_json`)
  const saveSeasonFixtures = db.prepare(`INSERT INTO season_history_fixtures (account_id, season_index, fixtures_json) VALUES (?, ?, ?)
    ON CONFLICT(account_id, season_index) DO UPDATE SET fixtures_json=excluded.fixtures_json`)
  return (id, matchDetails, seasonFixtures) => {
    if (Array.isArray(matchDetails)) {
      for (const { matchId, detailJson } of matchDetails) {
        saveMatchDetail.run(id, matchId, detailJson)
      }
    }
    if (Array.isArray(seasonFixtures)) {
      for (const { seasonIndex, fixturesJson } of seasonFixtures) {
        saveSeasonFixtures.run(id, seasonIndex, fixturesJson)
      }
    }
  }
}
