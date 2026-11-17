import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

const dataDir = process.env.WALLET_DATA_DIR ?? join(homedir(), '.wallet-broker-sync')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const sqlite = new Database(join(dataDir, 'audit.sqlite'))
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite)

// Resolve migrations to an absolute path so this works regardless of process CWD
// (e.g. if `next start` is invoked from a different directory).
const MIGRATIONS_FOLDER = resolve(process.cwd(), 'src/storage/migrations')

export function runMigrations() {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}
