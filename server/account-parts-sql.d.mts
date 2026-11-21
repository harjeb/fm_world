import type { DatabaseSync } from 'node:sqlite'
import type { AccountPart, MatchDetailWrite, SeasonFixturesWrite } from './account-parts.ts'

export function prepareAccountParts(db: DatabaseSync): (id: string, parts: readonly AccountPart[]) => void
export function prepareColdDataWriters(db: DatabaseSync): (
  id: string,
  matchDetails?: readonly MatchDetailWrite[],
  seasonFixtures?: readonly SeasonFixturesWrite[],
) => void
