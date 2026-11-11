import { ExternalLink } from 'lucide-react'
import { isLiveMode } from '@/lib/near/wallet'
import { getNearConfig } from '@/lib/near/config'

export function DemoBanner({ compact = false }: { compact?: boolean }) {
  const live = isLiveMode()
  const cfg = getNearConfig()

  if (compact) {
    return (
      <span className={`demo-mini ${live ? 'demo-mini-live' : ''}`} aria-label={live ? 'Live mode' : 'Demo mode'}>
        <span className="signal-dot" aria-hidden />
        {live ? `Live · ${cfg.network}` : 'Demo mode'}
      </span>
    )
  }

  // Live mode is already shown in the top bar; the full-width banner only earns its space in demo mode.
  if (live) return null

  return (
    <div className={`demo-banner ${live ? 'demo-banner-live' : ''}`} role="status" aria-label={live ? 'Live mode notice' : 'Demo mode notice'}>
      <span className="signal-line" aria-hidden />
      <div>
        <strong>{live ? `Live · ${cfg.network}` : 'Demo mode'}</strong>
        <span>
          {live
            ? `Contracts are configured for ${cfg.network} — data is read from the chain.`
            : 'Numbers are simulated for product exploration. No listing here implies guaranteed liquidity.'}
        </span>
      </div>
      <a href={cfg.explorerUrl} target="_blank" rel="noreferrer">
        {live ? 'Explorer' : 'What is real?'} <ExternalLink size={13} aria-hidden />
      </a>
    </div>
  )
}
