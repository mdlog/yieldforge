import { useState, Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { CircleCheck, CircleAlert, X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { useToast } from '@/contexts/ToastContext'
import { useSeries } from '@/contexts/SeriesContext'

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { toasts, dismiss } = useToast()
  const { active } = useSeries()

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <main className="main-area" id="main-content" tabIndex={-1}>
        <Topbar mobileOpen={mobileOpen} onToggle={() => setMobileOpen((open) => !open)} />
        <div className="page-wrap">
          <Suspense fallback={<div className="page-loading" aria-busy="true" aria-live="polite">Loading…</div>}>
            {/* Keyed by series so every page re-reads its data after a switch. */}
            <Outlet key={active} />
          </Suspense>
        </div>
      </main>

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role="status">
            <span aria-hidden>{t.tone === 'success' ? <CircleCheck size={17} /> : <CircleAlert size={17} />}</span>
            {t.message}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
