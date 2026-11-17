import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'

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

export const recordFallback = sqliteTable('record_fallback', {
  broker: text('broker').notNull(),
  exchange: text('exchange').notNull(),
  symbol: text('symbol').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.broker, t.exchange, t.symbol] }),
}))

export const manualLink = sqliteTable('manual_link', {
  broker: text('broker').notNull(),
  externalId: text('external_id').notNull(),
  existingDocId: text('existing_doc_id').notNull(),
}, (t) => ({
  // Composite PK includes existingDocId so one (broker, externalId) can map to
  // multiple existing Wallet entries (partial-fill grouping).
  pk: primaryKey({ columns: [t.broker, t.externalId, t.existingDocId] }),
}))

// Local mirror of CouchDB docs we care about. Keyed by (scope, docId), where
// scope is `${couchUrl}|${dbName}`. Persisted across runs so dry-runs only
// fetch the delta via _changes?since=<lastSeq> instead of re-scanning the DB.
export const couchDocCache = sqliteTable('couch_doc_cache', {
  scope: text('scope').notNull(),
  docId: text('doc_id').notNull(),
  modelType: text('model_type').notNull(),
  json: text('json').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.scope, t.docId] }),
}))

export const couchCacheMeta = sqliteTable('couch_cache_meta', {
  scope: text('scope').primaryKey(),
  lastSeq: text('last_seq').notNull(),
})

// Daily closing prices for assets held in the portfolio. Keyed by the Yahoo
// ticker (canonical symbol + exchange suffix). `close` is int*10000 so we
// preserve 4 decimals without floats; `currency` is the listing currency.
export const priceHistory = sqliteTable('price_history', {
  symbol: text('symbol').notNull(),
  date: text('date').notNull(),
  close: integer('close').notNull(),
  currency: text('currency').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.symbol, t.date] }),
  idxSymbol: index('price_history_symbol').on(t.symbol),
}))

// Daily FX rates: 1 unit of `base` in `quote` currency. Stored int*1000000
// (6 decimals).
export const fxHistory = sqliteTable('fx_history', {
  base: text('base').notNull(),
  quote: text('quote').notNull(),
  date: text('date').notNull(),
  rate: integer('rate').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.base, t.quote, t.date] }),
}))

// Deposits and bonds the user enters by hand: Wallet has no maturity or rate fields.
// `principal` is int*100 in `currency`; `rate_bps` is the annual rate or coupon.
export const maturity = sqliteTable('maturity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind', { enum: ['deposit', 'bond'] }).notNull(),
  name: text('name').notNull(),
  accountId: text('account_id'),
  symbol: text('symbol'),
  currency: text('currency').notNull(),
  principal: integer('principal').notNull(),
  rateBps: integer('rate_bps'),
  startDate: text('start_date'),
  maturityDate: text('maturity_date').notNull(),
})
