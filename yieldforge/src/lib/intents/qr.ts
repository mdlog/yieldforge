import { encode } from 'uqr'

/** An SVG path that draws every dark module of a QR matrix as a 1×1 square. The matrix size is the viewBox. */
export function qrPath(modules: boolean[][]): string {
  let d = ''
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`
    }),
  )
  return d
}

/**
 * The QR code of a deposit address. It holds the plain address, not a payment URI, so any wallet on that chain reads it,
 * and the user still picks the token and types the amount in their wallet.
 */
export function depositQr(address: string): { size: number; path: string } {
  const { data } = encode(address, { ecc: 'M', border: 2 })
  return { size: data.length, path: qrPath(data) }
}
