declare module 'xirr' {
  type CashFlow = { amount: number; when: Date }
  function xirr(cashFlows: CashFlow[], opts?: { guess?: number }): number
  export = xirr
}
