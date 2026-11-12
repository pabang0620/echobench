// Money is handled as integer cents. Amounts from PayPal arrive as decimal strings.
export function toCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new Error(`Bad amount: ${value}`)
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0)
}

export function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
