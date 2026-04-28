import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, runMigrations } from '@/src/storage/db'
import { config, brokerAccountMap } from '@/src/storage/schema'
import { saveCouchCreds, loadCouchCreds } from '@/src/storage/credentials'

// Run migrations on first import
runMigrations()

export async function GET() {
  try {
    const rows = await db.select().from(config)
    const configMap = Object.fromEntries(rows.map(r => [r.key, r.value]))

    const creds = await loadCouchCreds()
    const hasCreds = creds !== null
    const configured = hasCreds && !!configMap['couchUrl'] && !!configMap['dbName']

    const mappingRows = await db.select().from(brokerAccountMap)
    const mappingsByBroker = Object.fromEntries(mappingRows.map(r => [r.broker, r.accountId]))

    return NextResponse.json({
      configured,
      hasCreds,
      mappings: {
        xtb: mappingsByBroker['xtb'] ?? null,
        ibkr: mappingsByBroker['ibkr'] ?? null,
        tradeville: mappingsByBroker['tradeville'] ?? null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

const ConnectionSchema = z.object({
  kind: z.literal('connection'),
  couchUrl: z.string().url(),
  dbName: z.string().min(1),
  login: z.string().min(1),
  token: z.string().min(1),
})

const BrokerSchema = z.enum(['xtb', 'ibkr', 'tradeville'])

const MappingsSchema = z.object({
  kind: z.literal('mappings'),
  mappings: z.array(z.object({
    broker: BrokerSchema,
    accountId: z.string().min(1),
    currencyCode: z.string().min(1),
  })),
})

const ConfigPayloadSchema = z.discriminatedUnion('kind', [ConnectionSchema, MappingsSchema])

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
    }

    const parsed = ConfigPayloadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 },
      )
    }

    const data = parsed.data

    if (data.kind === 'connection') {
      await saveCouchCreds({ login: data.login, token: data.token })
      await db.insert(config).values({ key: 'couchUrl', value: data.couchUrl })
        .onConflictDoUpdate({ target: config.key, set: { value: data.couchUrl } })
      await db.insert(config).values({ key: 'dbName', value: data.dbName })
        .onConflictDoUpdate({ target: config.key, set: { value: data.dbName } })
    } else {
      // kind === 'mappings'
      for (const m of data.mappings) {
        await db.insert(brokerAccountMap)
          .values({ broker: m.broker, accountId: m.accountId, currencyCode: m.currencyCode })
          .onConflictDoUpdate({
            target: brokerAccountMap.broker,
            set: { accountId: m.accountId, currencyCode: m.currencyCode },
          })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
