import type { ReactNode } from 'react'

/** The content column every screen uses. */
export default function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 pb-6 tabular-nums lg:max-w-[1200px] lg:px-14">{children}</main>
}
