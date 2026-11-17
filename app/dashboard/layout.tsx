import DashboardNav from './DashboardNav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="container mx-auto max-w-6xl py-4 px-4 md:px-6">
      <div className="mb-4 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Spending charts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything synced into Wallet, summarised locally. No data leaves your machine.
        </p>
      </div>
      <DashboardNav />
      <div className="mt-6">{children}</div>
    </main>
  )
}
