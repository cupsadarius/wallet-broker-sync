/** "2.345,00" → 2345, "12345,00" → 12345. */
export function roNumber(s: string): number {
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${s}`)
  return n
}

export const toCents = (n: number) => Math.round(n * 100)

/** "15.06.2011" or "01-09-2026" → "2011-06-15". */
export function roDate(s: string): string {
  const m = /^(\d{2})[.-](\d{2})[.-](\d{4})$/.exec(s.trim())
  if (!m) throw new Error(`Not a date: ${s}`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

const CENTURY: Record<string, string> = { '1': '19', '2': '19', '3': '18', '4': '18', '5': '20', '6': '20' }

/** The birth date encoded in a Romanian CNP; nothing else of it is kept. */
export function birthDateFromCnp(cnp: string): string | null {
  const m = /^([1-6])(\d{2})(\d{2})(\d{2})\d{6}$/.exec(cnp)
  if (!m) return null
  const iso = `${CENTURY[m[1]]}${m[2]}-${m[3]}-${m[4]}`
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null
}

/** Birth date from the first CNP-shaped token in the text. */
export function birthDateIn(lines: string[]): string | null {
  for (const l of lines) for (const t of l.match(/\b\d{13}\b/g) ?? []) {
    const d = birthDateFromCnp(t)
    if (d) return d
  }
  return null
}

/** First capture of the first line that matches. */
export function find(lines: string[], re: RegExp): RegExpExecArray | null {
  for (const l of lines) {
    const m = re.exec(l)
    if (m) return m
  }
  return null
}

export function need(lines: string[], re: RegExp, what: string): RegExpExecArray {
  const m = find(lines, re)
  if (!m) throw new Error(`Statement has no ${what}`)
  return m
}
