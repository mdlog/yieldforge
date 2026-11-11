// Reading what an executed NEAR transaction returned. No app imports, so tests can load this file directly.

/** A transaction's base64 `SuccessValue`, decoded to text (JSON for most methods); null when absent or malformed. */
export function decodeSuccessValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/**
 * How much an NEP-141 `ft_transfer_call` actually moved, read from its return value. When the receiver's
 * `ft_on_transfer` refuses the tokens, the token contract refunds them and the transaction still succeeds,
 * returning "0". Null when the value is not an amount.
 */
export function ftTransferCallUsed(value: string | null): bigint | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' && /^\d+$/.test(parsed) ? BigInt(parsed) : null
  } catch {
    return null
  }
}

/** The contract's own panic text from an execution error, e.g. "Deposits closed"; null when there is none. */
export function panicMessage(error: string): string | null {
  const match = /Smart contract panicked: ([^"\\]+)/.exec(error)
  return match ? match[1]!.trim() : null
}
