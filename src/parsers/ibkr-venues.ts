// IBKR ticker → MIC table. IBKR's Activity Statement CSV doesn't expose the
// exchange directly, so we curate a lookup. Add entries as new symbols are
// encountered. For US listings we default to NASDAQ Global Select (XNGS) for
// tech/growth tickers and NYSE (XNYS) for older industrials. Refine when
// captures clarify.
const TICKER_TO_MIC: Record<string, string> = {
  // NASDAQ Global Select (XNGS)
  'AAPL': 'XNGS', 'AMZN': 'XNGS', 'MSFT': 'XNGS', 'META': 'XNGS',
  'GOOGL': 'XNGS', 'TSLA': 'XNGS', 'NFLX': 'XNGS', 'AMD': 'XNGS', 'NVDA': 'XNGS',
  // NYSE (XNYS)
  'T': 'XNYS', 'SHOP': 'XNYS',
  // London Stock Exchange (XLON) — UCITS ETFs
  'VUAA': 'XLON', 'CNDX': 'XLON',
  // XETRA (XETR) — EUR-denominated ETFs
  'VWCE': 'XETR',
}

export function micFromIbkrSymbol(symbol: string): string | null {
  return TICKER_TO_MIC[symbol.toUpperCase()] ?? null
}
