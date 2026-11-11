import { useId, useMemo } from 'react'
import type { RatePoint } from '@/types'

const HEIGHT = 86
const PAD_X = 12

/**
 * Historical stNEAR/NEAR rate. Without points (live mode has no history feed yet) it says so
 * instead of drawing placeholder data.
 */
export function RateChart({ points, compact = false }: { points?: RatePoint[]; compact?: boolean }) {
  // useId output contains characters that are awkward inside url(#…); keep it alphanumeric.
  const gradientId = `rate-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const width = compact ? 140 : 350

  const coords = useMemo(() => {
    if (!points || points.length < 2) return []
    const rates = points.map((p) => p.rate)
    const lo = Math.min(...rates) - 0.004
    const hi = Math.max(...rates) + 0.004
    const step = (width - PAD_X * 2) / (points.length - 1)
    return points.map((p, i) => ({ x: PAD_X + i * step, y: 74 - ((p.rate - lo) / (hi - lo)) * 52 }))
  }, [points, width])

  if (coords.length === 0 || !points) {
    return (
      <div className="rate-chart rate-chart-empty" role="img" aria-label="Historical rate unavailable">
        Historical rate feed unavailable · current on-chain rate only
      </div>
    )
  }

  const line = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const first = coords[0]!
  const last = coords[coords.length - 1]!

  return (
    <div className={`rate-chart ${compact ? 'rate-chart-compact' : ''}`}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Historical stNEAR exchange rate">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#d8f36b" stopOpacity=".24" />
            <stop offset="100%" stopColor="#d8f36b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {!compact && [22, 48, 74].map((y) => <line key={y} x1="0" y1={y} x2={width} y2={y} className="chart-grid" />)}
        <polygon points={`${first.x},${HEIGHT} ${line} ${last.x},${HEIGHT}`} fill={`url(#${gradientId})`} />
        <polyline points={line} fill="none" stroke="#b7d550" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {!compact && coords.map((c, i) => <circle key={points[i]!.date} cx={c.x} cy={c.y} r="2.7" fill="#f3f1eb" stroke="#b7d550" strokeWidth="2" />)}
      </svg>
      {!compact && (
        <div className="chart-labels">
          <span>{points[0]!.date}</span>
          <span>{points[points.length - 1]!.date}</span>
        </div>
      )}
    </div>
  )
}
