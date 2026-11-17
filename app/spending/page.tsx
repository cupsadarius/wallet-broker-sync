import Link from 'next/link'

export default function SpendingPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-4 text-sm text-muted-foreground">
      Spending review comes in a later update. Until then, see the <Link href="/dashboard/spending" className="text-primary">spending charts</Link>.
    </main>
  )
}
