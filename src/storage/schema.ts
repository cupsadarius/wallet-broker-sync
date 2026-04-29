import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const brokerAccountMap = sqliteTable('broker_account_map', {
  broker: text('broker').primaryKey(),
  accountId: text('account_id').notNull(),
  currencyCode: text('currency_code').notNull(),
})

export const syncRun = sqliteTable('sync_run', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  broker: text('broker').notNull(),
  accountId: text('account_id').notNull(),
  sourceFilename: text('source_filename').notNull(),
  sourceSha256: text('source_sha256').notNull(),
  parsedCount: integer('parsed_count').notNull(),
  insertedCount: integer('inserted_count').notNull(),
  conflictCount: integer('conflict_count').notNull(),
  errorCount: integer('error_count').notNull(),
})

export const syncRunDoc = sqliteTable('sync_run_doc', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull(),
  externalId: text('external_id'),
  docId: text('doc_id'),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
})

export const assetAlias = sqliteTable('asset_alias', {
  broker: text('broker').notNull(),
  fromSymbol: text('from_symbol').notNull(),
  fromExchange: text('from_exchange').notNull(),
  toSymbol: text('to_symbol').notNull(),
  toExchange: text('to_exchange').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.broker, t.fromSymbol, t.fromExchange] }),
}))
