const SUFFIX_TO_MIC: Record<string, string> = {
  '.DE': 'XETR', '.UK': 'XLON', '.US': 'XNYS',
  '.PL': 'XWAR', '.NL': 'XAMS', '.IT': 'MTAA',
  '.FR': 'XPAR', '.ES': 'XMAD', '.PT': 'XLIS',
}

export function micFromXtbSymbol(symbol: string): { mic: string; bareSymbol: string } | null {
  for (const [suffix, mic] of Object.entries(SUFFIX_TO_MIC)) {
    if (symbol.endsWith(suffix)) return { mic, bareSymbol: symbol.slice(0, -suffix.length) }
  }
  return null
}
