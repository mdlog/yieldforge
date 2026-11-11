import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import mark from '@/assets/brand/yieldforge-mark.webp'

/** True when the visitor asked the OS for less motion; animations then render their end state. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Eases a number up to `value` when it first arrives or changes (instant with reduced motion). */
export function CountUp({ value, digits, ms = 900 }: { value: number | null; digits: number; ms?: number }) {
  const [shown, setShown] = useState<number | null>(value != null && prefersReducedMotion() ? value : null)
  const from = useRef(0)
  useEffect(() => {
    if (value == null) return setShown(null)
    if (prefersReducedMotion()) return setShown(value)
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const next = begin + (value - begin) * (1 - Math.pow(1 - p, 3))
      setShown(next)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  if (shown == null) return <>—</>
  return <>{shown.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}</>
}

// Rising "yield motes" in the hero background: fixed positions so server and client render the same.
const MOTES = [
  [6, 0], [14, 3.2], [23, 1.4], [31, 5.1], [42, 2.3], [50, 6.4], [57, 0.8], [66, 4.2], [74, 2.9], [83, 5.8], [91, 1.9], [97, 3.7],
] as const

/** Decorative hero background: drifting aurora, a fading grid and rising motes. */
export function HeroBackdrop() {
  return (
    <div className="lp-hero-bg" aria-hidden>
      <span className="lp-aurora lp-aurora-1" />
      <span className="lp-aurora lp-aurora-2" />
      <span className="lp-aurora lp-aurora-3" />
      <span className="lp-hero-lines" />
      {MOTES.map(([left, delay]) => (
        <span key={left} className="lp-mote" style={{ left: `${left}%`, animationDelay: `${delay}s` } as CSSProperties} />
      ))}
    </div>
  )
}

const IN = 'M78 75 L160 75'
const TO_PT = 'M212 75 C258 75 262 34 312 34'
const TO_YT = 'M212 75 C258 75 262 116 312 116'

/** stNEAR flows into the series and comes out as PT (principal) and YT (yield). */
export function ForgeDiagram({ pt, yt }: { pt: string; yt: string }) {
  const [moving] = useState(() => !prefersReducedMotion())
  return (
    <figure className="lp-forge" aria-label={`1 stNEAR becomes ${pt} PT plus ${yt} YT`}>
      <svg viewBox="0 0 420 150" role="img" aria-hidden>
        <defs>
          <linearGradient id="lp-yt-grad" x1="0" x2="1">
            <stop offset="0" stopColor="#d8f36b" stopOpacity=".2" />
            <stop offset="1" stopColor="#d8f36b" />
          </linearGradient>
          <linearGradient id="lp-pt-grad" x1="0" x2="1">
            <stop offset="0" stopColor="#fbfaf7" stopOpacity=".15" />
            <stop offset="1" stopColor="#fbfaf7" stopOpacity=".85" />
          </linearGradient>
          <radialGradient id="lp-core-glow">
            <stop offset="0" stopColor="#d8f36b" stopOpacity=".35" />
            <stop offset="1" stopColor="#d8f36b" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* rails */}
        <path d={IN} className="lp-forge-rail" />
        <path d={TO_PT} className="lp-forge-rail" />
        <path d={TO_YT} className="lp-forge-rail" />
        <path d={IN} className="lp-forge-flow" stroke="#fbfaf7" />
        <path d={TO_PT} className="lp-forge-flow" stroke="url(#lp-pt-grad)" />
        <path d={TO_YT} className="lp-forge-flow lp-forge-flow-yt" stroke="url(#lp-yt-grad)" />

        {/* input coin */}
        <circle cx="46" cy="75" r="32" className="lp-forge-coin" />
        <circle cx="46" cy="75" r="25" className="lp-forge-coin-ring" />
        <text x="46" y="72" textAnchor="middle" className="lp-forge-coin-amt">1.00</text>
        <text x="46" y="86" textAnchor="middle" className="lp-forge-coin-sym">stNEAR</text>

        {/* the series contract */}
        <circle cx="186" cy="75" r="44" fill="url(#lp-core-glow)" className="lp-forge-halo" />
        <rect x="160" y="49" width="52" height="52" rx="12" className="lp-forge-core" />
        <image href={mark} x="170" y="59" width="32" height="32" />
        <text x="186" y="122" textAnchor="middle" className="lp-forge-cap">series contract</text>

        {/* outputs */}
        <rect x="312" y="18" width="100" height="32" rx="16" className="lp-forge-pt" />
        <text x="327" y="38.5" className="lp-forge-tok lp-forge-tok-pt">PT</text>
        <text x="352" y="38.5" className="lp-forge-out lp-forge-out-pt">{pt}</text>
        <rect x="312" y="100" width="100" height="32" rx="16" className="lp-forge-yt" />
        <text x="327" y="120.5" className="lp-forge-tok">YT</text>
        <text x="352" y="120.5" className="lp-forge-out">{yt}</text>
        <text x="362" y="66" textAnchor="middle" className="lp-forge-cap">principal</text>
        <text x="362" y="94" textAnchor="middle" className="lp-forge-cap lp-forge-cap-yt">all the yield</text>

        {moving && (
          <>
            {[0, 0.8, 1.6].map((b) => (
              <circle key={`in${b}`} r="3" className="lp-forge-dot">
                <animateMotion dur="2.4s" begin={`${b}s`} repeatCount="indefinite" path={IN} />
              </circle>
            ))}
            {[0.5, 1.7].map((b) => (
              <circle key={`pt${b}`} r="3" className="lp-forge-dot">
                <animateMotion dur="2.4s" begin={`${b}s`} repeatCount="indefinite" path={TO_PT} />
              </circle>
            ))}
            {[0.9, 2.1].map((b) => (
              <circle key={`yt${b}`} r="3.4" className="lp-forge-dot lp-forge-dot-yt">
                <animateMotion dur="2.4s" begin={`${b}s`} repeatCount="indefinite" path={TO_YT} />
              </circle>
            ))}
          </>
        )}
      </svg>
    </figure>
  )
}

/** Hero visual wrapper: a soft 3D tilt and spotlight that follow the pointer (off with reduced motion). */
export function TiltStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [enabled] = useState(() => !prefersReducedMotion() && typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches === true)
  const set = (rx: number, ry: number, mx: number, my: number) => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--rx', `${rx}deg`)
    el.style.setProperty('--ry', `${ry}deg`)
    el.style.setProperty('--mx', `${mx}%`)
    el.style.setProperty('--my', `${my}%`)
  }
  return (
    <div
      ref={ref}
      className="lp-hero-visual"
      onPointerMove={(e) => {
        if (!enabled) return
        const r = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width
        const y = (e.clientY - r.top) / r.height
        set((0.5 - y) * 6, (x - 0.5) * 7, x * 100, y * 100)
      }}
      onPointerLeave={() => set(0, 0, 50, 0)}
    >
      {children}
    </div>
  )
}
