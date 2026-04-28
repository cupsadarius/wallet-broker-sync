import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

const dataDir = join(homedir(), '.wallet-broker-sync')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const sqlite = new Database(join(dataDir, 'audit.sqlite'))
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite)

export function runMigrations() {
  migrate(db, { migrationsFolder: 'src/storage/migrations' })
}
