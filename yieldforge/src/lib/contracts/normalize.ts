// Contracts return snake_case JSON; earlier mocks used camelCase. Accept both, emit camelCase.

export type RawView = Record<string, unknown>

export function pick(raw: RawView, camel: string, snake: string): unknown {
  return raw[camel] ?? raw[snake]
}

export function pickString(raw: RawView, camel: string, snake: string, fallback = ''): string {
  const v = pick(raw, camel, snake)
  return v == null ? fallback : String(v)
}

export function pickOptional(raw: RawView, camel: string, snake: string): string | undefined {
  const v = pick(raw, camel, snake)
  return v == null || v === '' ? undefined : String(v)
}
