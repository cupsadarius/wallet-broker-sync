import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

describe('0012 Signal Iduna contract key', () => {
  it('drops the "/N" suffix from the Signal account and its rows, and leaves others alone', () => {
    const sqlite = new Database(':memory:')
    migrate(drizzle(sqlite), { migrationsFolder: 'src/storage/migrations' })
    sqlite.exec(`
      INSERT INTO retirement_account VALUES
        ('signal-iduna:1000001/4', 'unit-linked', 'signal-iduna', '101 Invest', '1000001/4', 'EUR', NULL, 'x'),
        ('bt-pensia-noastra:ABC/1', 'pilon2', 'bt-pensia-noastra', 'Pensia Noastră', 'ABC/1', 'RON', NULL, 'x');
      INSERT INTO retirement_statement (account_id, as_of, value, paid_in, fees, file_hash, uploaded_at)
        VALUES ('signal-iduna:1000001/4', '2026-07-14', 1, 1, 0, 'h1', 'x');
    `)
    sqlite.exec(readFileSync('src/storage/migrations/0012_signal_contract.sql', 'utf8').replaceAll('--> statement-breakpoint', ''))
    expect(sqlite.prepare('SELECT id, contract FROM retirement_account ORDER BY id').all()).toEqual([
      { id: 'bt-pensia-noastra:ABC/1', contract: 'ABC/1' },
      { id: 'signal-iduna:1000001', contract: '1000001' },
    ])
    expect(sqlite.prepare('SELECT account_id FROM retirement_statement').all()).toEqual([{ account_id: 'signal-iduna:1000001' }])
  })
})
