'use client'

import { useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** Dialog content classes: centred on desktop, a bottom sheet below `lg`. */
export const SHEET = 'max-h-[85dvh] grid-cols-[minmax(0,1fr)] gap-5 overflow-y-auto p-5 max-lg:top-auto max-lg:bottom-0 max-lg:max-w-none max-lg:translate-y-0 max-lg:rounded-b-none max-lg:rounded-t-2xl max-lg:pb-[max(1.25rem,env(safe-area-inset-bottom))]'

/** A dialog on desktop and a bottom sheet on phone. Children get `close` to call after a save. */
export default function EditSheet({ title, description, label = 'Edit', triggerClassName, children }: {
  title: string; description?: string; label?: string; triggerClassName?: string
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn('flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line-2 px-3 text-[13px] text-foreground', triggerClassName)}>
        <Pencil aria-hidden className="size-3.5" />{label}
      </DialogTrigger>
      <DialogContent className={cn(SHEET, 'lg:max-w-md')}>
        <span aria-hidden className="mx-auto -mt-1 h-1 w-10 rounded-full bg-line-2 lg:hidden" />
        <div>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description && <DialogDescription className="mt-1 text-[13px] text-muted-foreground">{description}</DialogDescription>}
        </div>
        {typeof children === 'function' ? children(() => setOpen(false)) : children}
      </DialogContent>
    </Dialog>
  )
}
