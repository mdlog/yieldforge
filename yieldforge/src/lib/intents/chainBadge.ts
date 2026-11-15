/** The letters shown in place of a chain logo that isn't published: the two words' initials, else the first two letters. */
export function chainInitials(label: string): string {
  const [first, second] = label.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!first) return '?'
  if (second) return (first.charAt(0) + second.charAt(0)).toUpperCase()
  return first.slice(0, 2)
}

/** Type-ahead in the chain list: the next label after `from` that starts with `ch`, wrapping; `from` when none does. */
export function typeaheadIndex(labels: string[], from: number, ch: string): number {
  const c = ch.toLowerCase()
  for (let step = 1; step <= labels.length; step++) {
    const i = (from + step) % labels.length
    if (labels[i]?.toLowerCase().startsWith(c)) return i
  }
  return from
}
