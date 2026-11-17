import DashboardNav from './DashboardNav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="container mx-auto max-w-6xl py-12 px-4 md:px-6">
      <div className="mb-8 flex flex-col gap-1">
        <p className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground ring-1 ring-accent-foreground/15">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Dashboards
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything synced into Wallet, summarised locally. No data leaves your machine.
        </p>
      </div>
      <DashboardNav />
      <div className="mt-6">{children}</div>
    </main>
  )
}
