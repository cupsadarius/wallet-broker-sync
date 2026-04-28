import { CouchClient } from '@/src/sync/couch'
import { deterministicId } from '@/src/sync/ids'

function must(k: string): string {
  const v = process.env[k]
  if (!v) { console.error(`missing env var: ${k}`); process.exit(1) }
  return v
}

async function main() {
  const cfg = {
    url: must('COUCH_URL'), dbName: must('COUCH_DB'),
    auth: { login: must('COUCH_LOGIN'), token: must('COUCH_TOKEN') },
  }
  const accountId = must('COUCH_TEST_ACCOUNT')
  const assetId = must('COUCH_TEST_ASSET')
  const ownerId = cfg.auth.login

  const client = new CouchClient(cfg)
  const now = new Date().toISOString()
  const probeIdBuy = `wallet-broker-sync-probe-${Date.now()}-buy`
  const probeIdSell = `wallet-broker-sync-probe-${Date.now()}-sell`

  const buyDoc = {
    _id: deterministicId('xtb', probeIdBuy),
    reservedModelType: 'AssetTransaction', reservedOwnerId: ownerId, reservedAuthorId: ownerId,
    reservedSource: 'wallet-broker-sync', reservedCreatedAt: now, reservedUpdatedAt: now,
    assetId, accountId, assetType: 1, transactionType: 0,
    date: now, quantity: 0.0001, price: 100, cashAmount: 0.01,
    priceCurrencyCode: 'EUR', cashAmountCurrencyCode: 'EUR',
    externalSource: 'wallet-broker-sync-probe', externalId: probeIdBuy,
  }
  const sellDoc = { ...buyDoc, _id: deterministicId('xtb', probeIdSell), transactionType: 1, externalId: probeIdSell }

  console.log('Writing probe buy + sell with deterministic v5 _ids...')
  const writeRes = await client.bulkDocs([buyDoc, sellDoc])
  console.log('bulkDocs response:', JSON.stringify(writeRes, null, 2))
  if (!writeRes.every(r => r.status === 'inserted')) {
    console.error('At least one doc was not inserted. _id format may need to change to v4-flip.')
    process.exit(2)
  }

  console.log('Reading back via _changes...')
  const docs = await client.listAssetTransactions(accountId)
  const buyMatch = docs.find(d => d._id === buyDoc._id)
  const sellMatch = docs.find(d => d._id === sellDoc._id)
  if (!buyMatch || !sellMatch) { console.error('Probe docs not round-tripped.'); process.exit(3) }

  console.log('Both probe docs round-tripped. Deleting...')
  await client.bulkDocs([
    { ...buyMatch, _deleted: true },
    { ...sellMatch, _deleted: true },
  ])
  console.log('Done. transactionType: 0=buy, 1=sell confirmed. Deterministic _id accepted.')
}

main().catch(err => { console.error(err); process.exit(99) })
