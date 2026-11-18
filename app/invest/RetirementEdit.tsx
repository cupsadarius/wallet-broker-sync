'use client'

import { useState, type ReactNode } from 'react'
import EditSheet from '@/app/ui/EditSheet'
import { big } from '@/app/ui/chartFormat'
import { projectFrom } from '@/src/retirement/chart'
import { saveContribution, saveReleaseDate, saveReturn, saveVpr } from './retirement/actions'

const INPUT = 'min-h-11 w-full rounded-lg border bg-background pl-3 pr-14 text-[0.9375rem] tabular-nums'

function Field({ label, hint, unit, children }: { label: string; hint?: string; unit?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <span className="relative">
        {children}
        {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">{unit}</span>}
      </span>
      {hint && <span className="text-[0.8125rem] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Buttons({ close }: { close: () => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={close} className="min-h-11 rounded-lg border text-sm font-semibold">Cancel</button>
      <button className="min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground">Save</button>
    </div>
  )
}

/** The return a year that every retirement projection uses. */
export function ReturnEdit({ percent }: { percent: number }) {
  return (
    <EditSheet title="Projection" description="Used for all retirement accounts.">
      {close => (
        <form action={async f => { await saveReturn(f); close() }} className="flex flex-col gap-5">
          <Field label="Return a year" unit="%" hint="Before inflation.">
            <input name="rate" type="number" inputMode="decimal" step="0.1" min="-10" max="30" defaultValue={percent} required className={INPUT} />
          </Field>
          <Buttons close={close} />
        </form>
      )}
    </EditSheet>
  )
}

/** Unlock date, money paid in a year and the return, with the value at unlock as you type. ×100 amounts. */
export function AccountEdit({ id, name, currency, value, paidIn, asOf, releaseDate, contribution, fallback, percent }: {
  id: string; name: string; currency: string; value: number; paidIn: number; asOf: string; releaseDate: string | null
  contribution: number | null; fallback: number; percent: number
}) {
  const [date, setDate] = useState(releaseDate ?? '')
  const [amount, setAmount] = useState(contribution === null ? '' : String(contribution / 100))
  const [rate, setRate] = useState(String(percent))
  const yearly = amount === '' ? fallback : Number(amount) * 100
  const end = date > asOf && Number.isFinite(yearly) && rate !== ''
    ? [...projectFrom({ value, paidIn }, asOf, date, { rate: Number(rate) / 100, contribution: yearly }).values()].at(-1)
    : undefined
  const save = async (f: FormData) => {
    await saveReleaseDate(f)
    await saveContribution(f)
    if (rate !== String(percent)) await saveReturn(f)
  }
  return (
    <EditSheet title={`Projection for ${name}`} description="The result updates as you type.">
      {close => (
        <form action={async f => { await save(f); close() }} className="flex flex-col gap-5">
          <input type="hidden" name="accountId" value={id} />
          <Field label="Unlock date">
            <input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT} />
          </Field>
          <Field label="Paid in a year" unit={currency}
            hint={`From the last 12 months: ${Math.round(fallback / 100).toLocaleString('en-US')}. Leave it empty to use that.`}>
            <input name="amount" type="number" inputMode="decimal" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={String(Math.round(fallback / 100))} className={INPUT} />
          </Field>
          <Field label="Return a year" unit="%" hint="Used for all retirement accounts.">
            <input name="rate" type="number" inputMode="decimal" step="0.1" min="-10" max="30" value={rate} onChange={e => setRate(e.target.value)} required className={INPUT} />
          </Field>
          <div className="flex items-baseline justify-between rounded-xl bg-secondary px-4 py-3" aria-live="polite">
            <span className="text-sm text-muted-foreground">At unlock</span>
            <b className="text-xl tabular-nums">{end ? `≈ ${big(end.value / 100)} ${currency}` : 'Set a future date'}</b>
          </div>
          <Buttons close={close} />
        </form>
      )}
    </EditSheet>
  )
}

/** The value of one Pilon 1 point, which sets the monthly estimate. ×100 RON. */
export function Pilon1Edit({ vpr }: { vpr: number }) {
  return (
    <EditSheet title="State pension" description="The monthly estimate is your points times the point value.">
      {close => (
        <form action={async f => { await saveVpr(f); close() }} className="flex flex-col gap-5">
          <Field label="Point value" unit="RON" hint="Set each year by law.">
            <input name="vpr" type="number" inputMode="decimal" min="1" step="0.01" defaultValue={vpr / 100} required className={INPUT} />
          </Field>
          <Buttons close={close} />
        </form>
      )}
    </EditSheet>
  )
}
