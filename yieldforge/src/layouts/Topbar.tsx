import { useEffect, useRef, useState } from 'react'
import { Menu, X, Wallet, ChevronDown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DemoBanner } from '@/components/ui'
import { useWallet } from '@/contexts/WalletContext'
import { getNearConfig } from '@/lib/near/config'
import { isLiveMode } from '@/lib/near/wallet'
import { useSeries } from '@/contexts/SeriesContext'
import { tenorLabel, useAllSeries } from '@/hooks/useAllSeries'

function pageLabel(pathname: string): string {
  if (pathname.startsWith('/marketplace')) return 'Buy YT'
  if (pathname.startsWith('/earn')) return 'Deposit & sell'
  if (pathname.startsWith('/series')) return 'Series'
  if (pathname.startsWith('/portfolio')) return 'Portfolio'
  if (pathname.startsWith('/any-chain')) return 'From any chain'
  if (pathname.startsWith('/listing')) return 'Buy YT'
  if (pathname.startsWith('/calculator')) return 'Calculator'
  if (pathname.startsWith('/transactions')) return 'Activity'
  return 'Not found'
}

export function Topbar({ mobileOpen, onToggle }: { mobileOpen: boolean; onToggle: () => void }) {
  const { pathname } = useLocation()
  const { isConnected, accountId, isConnecting, connect, disconnect } = useWallet()
  const [walletOpen, setWalletOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cfg = getNearConfig()

  useEffect(() => {
    if (!walletOpen) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrapRef.current?.contains(e.target as Node)) setWalletOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [walletOpen])

  return (
    <header className="topbar" role="banner">
      <button className="mobile-menu" onClick={onToggle} aria-label="Toggle navigation" aria-expanded={mobileOpen} aria-controls="sidebar">
        {mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
      </button>

      <div className="topbar-context" aria-label="Breadcrumb">
        <span className="context-mark" aria-hidden /> <span>YieldForge / {pageLabel(pathname)}</span>
      </div>

      <SeriesSwitcher />

      <div className="topbar-actions">
        <DemoBanner compact />
        <div className="wallet-wrap" ref={wrapRef}>
          <button
            className={`wallet-button ${isConnected ? 'wallet-connected' : ''}`}
            onClick={() => (isConnected ? setWalletOpen((open) => !open) : void connect())}
            aria-expanded={isConnected ? walletOpen : undefined}
            aria-haspopup={isConnected ? 'dialog' : undefined}
            aria-label={isConnected ? `Wallet ${accountId}` : 'Connect wallet'}
            disabled={!isConnected && isConnecting}
          >
            <Wallet size={15} aria-hidden />
            {isConnected ? (
              <>
                <span className="wallet-address">{accountId}</span>
                <span className="wallet-live" aria-hidden />
              </>
            ) : isConnecting ? (
              'Connecting…'
            ) : (
              'Connect wallet'
            )}
            <ChevronDown size={14} aria-hidden />
          </button>

          {walletOpen && isConnected && (
            <div className="wallet-popover" role="dialog" aria-label="Wallet">
              <div className="wallet-popover-head">
                <span className="wallet-popover-icon" aria-hidden>
                  <Wallet size={16} />
                </span>
                <div>
                  <strong>{accountId}</strong>
                  <small>NEAR {cfg.network}</small>
                </div>
              </div>
              <p className="wallet-popover-copy">Transactions are signed in your wallet. YieldForge never holds keys.</p>
              <button
                className="wallet-popover-action"
                onClick={() => {
                  void disconnect()
                  setWalletOpen(false)
                }}
              >
                Disconnect wallet
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/** Picks the series every app page works on. Hidden when only one series is configured. */
function SeriesSwitcher() {
  const { seriesIds, active, select } = useSeries()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const all = useAllSeries()
  // Demo mode has one simulated series; the configured live ladder doesn't apply to it.
  if (seriesIds.length < 2 || !isLiveMode()) return null

  const label = (id: string) => {
    const s = all.data?.find((row) => row.contractId === id)?.display
    return s ? `${tenorLabel(s)} · ${s.id} · ${s.phase}` : id.split('.')[0]!
  }
  const onChange = (id: string) => {
    select(id)
    // Listing ids are per series, and a stale ?series= would win on reload: go to a neutral URL.
    navigate(pathname.startsWith('/listing/') ? '/marketplace' : pathname, { replace: true })
  }

  return (
    <label className="series-switch">
      <span className="series-switch-label">Series</span>
      <select value={active} onChange={(e) => onChange(e.target.value)} aria-label="Active series">
        {seriesIds.map((id) => (
          <option key={id} value={id}>
            {label(id)}
          </option>
        ))}
      </select>
      <ChevronDown size={13} aria-hidden />
    </label>
  )
}
