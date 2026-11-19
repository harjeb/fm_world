import type { DatabaseSync } from 'node:sqlite'
import type { AccountPart } from './account-parts.ts'

export function prepareAccountParts(db: DatabaseSync): (id: string, parts: readonly AccountPart[]) => void
