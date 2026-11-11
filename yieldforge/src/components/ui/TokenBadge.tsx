// Official NEAR logo mark (viewBox 0 0 90.1 90), drawn in currentColor.
const NEAR_MARK_PATH =
  'M72.2,4.6L53.4,32.5c-1.3,1.9,1.2,4.2,3,2.6L74.9,19c0.5-0.4,1.2-0.1,1.2,0.6v50.3c0,0.7-0.9,1-1.3,0.5l-56-67C17,1.2,14.4,0,11.5,0h-2C4.3,0,0,4.3,0,9.6v70.8C0,85.7,4.3,90,9.6,90c3.3,0,6.4-1.7,8.2-4.6l18.8-27.9c1.3-1.9-1.2-4.2-3-2.6l-18.5,16c-0.5,0.4-1.2,0.1-1.2-0.6V20.1c0-0.7,0.9-1,1.3-0.5l56,67c1.8,2.2,4.5,3.4,7.3,3.4h2c5.3,0,9.6-4.3,9.6-9.6V9.6c0-5.3-4.3-9.6-9.6-9.6C77.1,0,74,1.7,72.2,4.6z'

export function NearMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 90.1 90" aria-hidden focusable="false">
      <path fill="currentColor" d={NEAR_MARK_PATH} />
    </svg>
  )
}

/** PT / YT token chip: the NEAR logo in a disc, followed by the claim label. */
export function TokenBadge({
  kind,
  size = 'md',
  muted = false,
  decorative = false,
}: {
  kind: 'PT' | 'YT'
  size?: 'sm' | 'md' | 'lg'
  muted?: boolean
  /** Hide from assistive tech when nearby text already names the token. */
  decorative?: boolean
}) {
  return (
    <span className={`token-badge token-${kind.toLowerCase()} token-${size}${muted ? ' token-muted' : ''}`} aria-hidden={decorative || undefined}>
      <span className="token-logo">
        <NearMark />
      </span>
      <span className="token-label">{kind}</span>
    </span>
  )
}
