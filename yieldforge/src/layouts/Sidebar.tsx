import { NavLink } from 'react-router-dom'
import type { ComponentType } from 'react'
import { FileText, ArrowRight, HandCoins, ShoppingBag, ShieldCheck, WalletCards, Gauge, History, Globe2 } from 'lucide-react'
import { getNearConfig } from '@/lib/near/config'
import { isLiveMode } from '@/lib/near/wallet'
import { BrandMark } from '@/components/BrandMark'

export function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const cfg = getNearConfig()
  return (
    <aside id="sidebar" className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Primary navigation">
      <div className="brand-block">
        <NavLink to="/" className="brand" aria-label="YieldForge home" onClick={onClose}>
          <BrandMark size={30} />
          <span className="brand-name">yieldforge</span>
        </NavLink>
      </div>

      <nav className="sidebar-section" aria-label="Trade">
        <span className="sidebar-label">Trade</span>
        <NavItem to="/marketplace" label="Buy YT" icon={ShoppingBag} onClick={onClose} />
        <NavItem to="/earn" label="Deposit & sell" icon={HandCoins} onClick={onClose} />
        <NavItem to="/any-chain" label="From any chain" icon={Globe2} onClick={onClose} />
        <NavItem to="/portfolio" label="Portfolio" icon={WalletCards} onClick={onClose} />
      </nav>

      <nav className="sidebar-section" aria-label="More">
        <span className="sidebar-label">More</span>
        <NavItem to="/series" label="Series & risk" icon={ShieldCheck} onClick={onClose} />
        <NavItem to="/calculator" label="Calculator" icon={Gauge} onClick={onClose} />
        <NavItem to="/transactions/activity" label="Activity" icon={History} onClick={onClose} />
      </nav>

      <div className="sidebar-footer">
        <div className="network-badge">
          <span className="network-indicator" aria-hidden />
          <div>
            <strong>NEAR {cfg.network}</strong>
            <small>{isLiveMode() ? 'Live contracts' : 'Demo data'}</small>
          </div>
        </div>
        <NavLink className="docs-link" to="/docs" onClick={onClose}>
          <FileText size={15} aria-hidden />
          Documentation <ArrowRight size={13} aria-hidden />
        </NavLink>
      </div>
    </aside>
  )
}

function NavItem({
  to,
  label,
  icon: Icon,
  onClick,
}: {
  to: string
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          <Icon size={17} strokeWidth={isActive ? 2.4 : 1.8} />
          <span>{label}</span>
          {isActive && <span className="nav-active-line" aria-hidden />}
        </>
      )}
    </NavLink>
  )
}
