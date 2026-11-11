export function formatNear(value: number, decimals = 2): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} NEAR`
}

export function shorten(value: string, left = 7, right = 4): string {
  if (value.length <= left + right + 1) return value
  return `${value.slice(0, left)}…${value.slice(-right)}`
}

// yocto helpers (24 decimals)
const YOCTO = 10n ** 24n

export function parseNear(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.trim().split('.')
  const fracPadded = (frac + '0'.repeat(24)).slice(0, 24)
  return BigInt(whole) * YOCTO + BigInt(fracPadded || '0')
}

export function formatYocto(yocto: string | bigint, decimals = 2): string {
  const v = typeof yocto === 'string' ? BigInt(yocto) : yocto
  const whole = v / YOCTO
  const frac = v % YOCTO
  const fracStr = frac.toString().padStart(24, '0').slice(0, decimals)
  return `${whole.toString()}.${fracStr}`
}

/** Yocto amount as an input-friendly decimal string (truncated, trailing zeros trimmed). */
export function formatYoctoInput(yocto: string | bigint, decimals = 6): string {
  const s = formatYocto(yocto, decimals)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Yocto amount as a truncated display number. Never feed the result back into a transaction. */
export function yoctoToNumber(yocto: string | bigint | null | undefined, decimals = 4): number {
  if (yocto == null || yocto === '') return 0
  try {
    return Number(formatYocto(yocto, decimals))
  } catch {
    return 0
  }
}

// NEAR timestamps are U64 nanoseconds. Values small enough to be seconds are scaled up,
// matching how the marketplace contract normalizes `expires_at`.
export function nanosToMs(nanos: string | number | bigint | null | undefined): number | null {
  if (nanos == null || nanos === '') return null
  try {
    let v = BigInt(nanos)
    if (v <= 0n) return null
    if (v < 1_000_000_000_000n) v *= 1_000_000_000n
    return Number(v / 1_000_000n)
  } catch {
    return null
  }
}

export function msToNanos(ms: number): string {
  return (BigInt(Math.floor(ms)) * 1_000_000n).toString()
}

/** Calendar date in UTC — maturities and expiries are UTC instants, so local time zones must not shift the day. */
export function formatDate(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  return new Date(ms).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function formatDateTimeUtc(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const date = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
  return `${date} · ${time} UTC`
}

export function formatNanosDate(nanos: string | number | bigint | null | undefined): string {
  return formatDate(nanosToMs(nanos))
}

export function daysUntil(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((ms - Date.now()) / 86_400_000))
}

/** Parse a U128/U64 string from a view without throwing on malformed input. */
export function toBigInt(value: string | number | bigint | null | undefined, fallback = 0n): bigint {
  if (value == null || value === '') return fallback
  try {
    return BigInt(value)
  } catch {
    return fallback
  }
}
