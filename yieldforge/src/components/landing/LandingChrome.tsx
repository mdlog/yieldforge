import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { NearMark } from '@/components/ui/TokenBadge'
import { BrandMark } from '@/components/BrandMark'
import { explorerAccountUrl, getNearConfig } from '@/lib/near/config'
import { isLiveMode } from '@/lib/near/wallet'
import '@/styles/landing.css'

const SECTIONS = [
  ['how', 'How it works'],
  ['strategies', 'Strategies'],
  ['simulate', 'Simulator'],
  ['security', 'Security'],
  ['faq', 'FAQ'],
] as const

function Brand() {
  return (
    <Link to="/" className="lp-brand" aria-label="YieldForge home">
      <BrandMark size={34} />
      <span>yieldforge</span>
    </Link>
  )
}

/** Top bar shared by the landing page and the docs. Section links stay in-page on the landing page. */
export function LandingNav({ page }: { page: 'home' | 'docs' }) {
  const live = isLiveMode()
  const { network } = getNearConfig()
  return (
    <nav className="lp-nav" aria-label="Main">
      <div className="lp-wrap lp-nav-inner">
        <Brand />
        <div className="lp-nav-links">
          {SECTIONS.map(([id, label]) =>
            page === 'home' ? (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ) : (
              <Link key={id} to={`/#${id}`}>
                {label}
              </Link>
            ),
          )}
          <Link to="/docs" className={page === 'docs' ? 'lp-nav-active' : undefined} aria-current={page === 'docs' ? 'page' : undefined}>
            Docs
          </Link>
        </div>
        <div className="lp-nav-actions">
          <Link to="/docs" className={`lp-nav-docs ${page === 'docs' ? 'lp-nav-active' : ''}`}>
            Docs
          </Link>
          <span className={`lp-net ${live ? 'lp-net-live' : ''}`}>
            <span aria-hidden /> {live ? 'Live ·' : 'Demo ·'} <NearMark className="lp-net-near" /> {network}
          </span>
          <Link className="lp-btn lp-btn-acid lp-btn-sm" to="/marketplace">
            Launch app
          </Link>
        </div>
      </div>
    </nav>
  )
}

export function LandingFooter() {
  const live = isLiveMode()
  const cfg = getNearConfig()
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-grid">
        <div className="lp-footer-brand">
          <Brand />
          <p>A fixed-price market for stNEAR yield rights on NEAR Protocol.</p>
        </div>
        <div>
          <h4>App</h4>
          <Link to="/marketplace">Buy YT</Link>
          <Link to="/earn">Deposit &amp; sell</Link>
          <Link to="/portfolio">Portfolio</Link>
          <Link to="/calculator">Calculator</Link>
        </div>
        <div>
          <h4>Protocol</h4>
          <Link to="/series">Series &amp; risk</Link>
          {live && (
            <a href={explorerAccountUrl(cfg.seriesContractId)} target="_blank" rel="noreferrer">
              Series contract <ArrowUpRight size={12} aria-hidden />
            </a>
          )}
          <a href={explorerAccountUrl(cfg.stNearContractId)} target="_blank" rel="noreferrer">
            Meta Pool stNEAR <ArrowUpRight size={12} aria-hidden />
          </a>
        </div>
        <div>
          <h4>Resources</h4>
          <Link to="/docs">Documentation</Link>
          <a href="https://docs.near.org" target="_blank" rel="noreferrer">
            NEAR docs <ArrowUpRight size={12} aria-hidden />
          </a>
          <a href={cfg.explorerUrl} target="_blank" rel="noreferrer">
            NearBlocks <ArrowUpRight size={12} aria-hidden />
          </a>
        </div>
      </div>
      <div className="lp-wrap lp-footer-base">
        <span>
          NEAR {cfg.network} · {live ? 'live contracts' : 'demo data'}
        </span>
        <span>Unaudited {cfg.network === 'testnet' ? 'testnet ' : ''}software. Nothing here is financial advice.</span>
      </div>
    </footer>
  )
}
