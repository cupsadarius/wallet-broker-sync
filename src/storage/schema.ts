import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'
import type { Spec } from '@json-render/core'
import type { Tools } from '@/src/ask/run'

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

// Investment plans. `amount` is int*100 in `currency`; recurring plans need amount, currency and
// frequency, rollovers need target_product (CHECKs in 0007_plans.sql).
export const plan = sqliteTable('plan', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['recurring', 'rollover'] }).notNull(),
  name: text('name').notNull(),
  accountId: text('account_id').notNull(),
  amount: integer('amount'),
  currency: text('currency'),
  frequency: text('frequency', { enum: ['weekly', 'monthly'] }),
  startDate: text('start_date').notNull(),
  targetSymbol: text('target_symbol'),
  wholeShares: integer('whole_shares', { mode: 'boolean' }).notNull().default(false),
  maturityId: integer('maturity_id').references(() => maturity.id, { onDelete: 'set null' }),
  targetProduct: text('target_product'),
  status: text('status', { enum: ['active', 'paused', 'archived'] }).notNull().default('active'),
})

// AI rule proposals. `id` is the MagicRule `_id` the proposal would write, so a rejected
// proposal stays rejected when the model suggests it again. `keywords` is a JSON string array.
export const ruleProposal = sqliteTable('rule_proposal', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull(),
  categoryId: text('category_id').notNull(),
  status: text('status', { enum: ['open', 'approved', 'rejected'] }).notNull().default('open'),
  createdAt: text('created_at').notNull(),
})

// Ask tab chats. `session_id` is the chat's opencode session, so follow-ups keep their context.
export const askChat = sqliteTable('ask_chat', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  sessionId: text('session_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const askMessage = sqliteTable('ask_message', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: integer('chat_id').notNull().references(() => askChat.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
  text: text('text').notNull(),
  spec: text('spec', { mode: 'json' }).$type<Spec>(),
  tools: text('tools', { mode: 'json' }).$type<Tools>(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  idxChat: index('ask_message_chat').on(t.chatId),
}))

// AI budget limit proposals. `id` is the budget id plus the proposed limit, so a rejected proposal stays
// rejected when the model suggests it again. Limits are int*100 in the budget currency.
export const budgetProposal = sqliteTable('budget_proposal', {
  id: text('id').primaryKey(),
  budgetId: text('budget_id').notNull(),
  currentLimit: integer('current_limit').notNull(),
  limit: integer('limit').notNull(),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['open', 'approved', 'rejected'] }).notNull().default('open'),
  createdAt: text('created_at').notNull(),
})

// Weekly AI money notes. `week` is the Monday of the week the note is for; a flagged note failed the number check.
export const weeklyNote = sqliteTable('weekly_note', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  week: text('week').notNull(),
  text: text('text').notNull(),
  status: text('status', { enum: ['ok', 'flagged'] }).notNull(),
  problem: text('problem'),
  createdAt: text('created_at').notNull(),
})

// Retirement accounts read from provider statements (Pilon 1/2/3, unit-linked). Money is int*100 in the
// account currency; a Pilon 1 statement has no money and keeps its period and points in `details`.
export const retirementAccount = sqliteTable('retirement_account', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['pilon1', 'pilon2', 'pilon3', 'unit-linked'] }).notNull(),
  provider: text('provider').notNull(),
  product: text('product').notNull(),
  contract: text('contract').notNull(),
  currency: text('currency').notNull(),
  releaseDate: text('release_date'),
  createdAt: text('created_at').notNull(),
})

export type Pilon1Details = {
  period: { years: number; months: number; days: number }
  points: number
  pointsByYear: { year: number; points: number }[]
}

export const retirementStatement = sqliteTable('retirement_statement', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: text('account_id').notNull(),
  asOf: text('as_of').notNull(),
  value: integer('value'),
  paidIn: integer('paid_in'),
  fees: integer('fees'),
  details: text('details', { mode: 'json' }).$type<Pilon1Details>(),
  fileHash: text('file_hash').notNull(),
  uploadedAt: text('uploaded_at').notNull(),
})

export const retirementContribution = sqliteTable('retirement_contribution', {
  accountId: text('account_id').notNull(),
  date: text('date').notNull(),
  gross: integer('gross').notNull(),
  fee: integer('fee').notNull(),
}, (t) => ({
  byAccount: index('retirement_contribution_account').on(t.accountId),
}))
