import { db } from '@/src/storage/db'
import { assetAlias } from '@/src/storage/schema'
import AliasForm from './AliasForm'

export default async function AliasesPage({
  searchParams,
}: {
  searchParams: Promise<{ broker?: string; fromSymbol?: string; fromExchange?: string }>
}) {
  const params = await searchParams
  const aliases = await db.select().from(assetAlias)

  return (
    <main className="container mx-auto max-w-3xl py-4 px-4 md:py-12">
      <h1 className="text-2xl font-semibold mb-2">Asset aliases</h1>
      <p className="text-muted-foreground mb-6">
        When a broker reports a ticker your Wallet doesn&apos;t have under that exact symbol/exchange,
        map it here. The sync will substitute on lookup.
      </p>
      <AliasForm
        prefill={{
          broker: params.broker as 'xtb' | 'ibkr' | 'tradeville' | undefined,
          fromSymbol: params.fromSymbol,
          fromExchange: params.fromExchange,
        }}
        existing={aliases}
      />
    </main>
  )
}
