import type { BrokerId, CanonicalTxn } from '@/src/types'

export type ParserInput = { bytes: Uint8Array; filename: string; mimeHint?: string }
export type UnsupportedRow = { row: string | number; reason: string; raw: Record<string, unknown> }
export type ParseResult = { txns: CanonicalTxn[]; unsupported: UnsupportedRow[] }
export type ParserFormat = 'csv' | 'xlsx' | 'pdf' | 'html'

export interface BrokerParser {
  id: BrokerId
  displayName: string
  acceptedFormats: ParserFormat[]
  detect(input: ParserInput): boolean
  parse(input: ParserInput): ParseResult | Promise<ParseResult>
}
