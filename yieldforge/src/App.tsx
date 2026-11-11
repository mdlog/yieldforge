import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { WalletProvider } from '@/contexts/WalletContext'
import { SeriesProvider } from '@/contexts/SeriesContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { AppShell } from '@/layouts/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// AppShell wraps <Outlet /> in Suspense, so lazy pages load inside the persistent shell.
const LandingPage = lazy(() => import('@/pages/LandingPage'))
const DocsPage = lazy(() => import('@/pages/DocsPage'))
const MarketplacePage = lazy(() => import('@/pages/MarketplacePage'))
const SeriesPage = lazy(() => import('@/pages/SeriesPage'))
const EarnPage = lazy(() => import('@/pages/EarnPage'))
const ListingDetailPage = lazy(() => import('@/pages/ListingDetailPage'))
const PortfolioPage = lazy(() => import('@/pages/PortfolioPage'))
const CalculatorPage = lazy(() => import('@/pages/CalculatorPage'))
const TransactionPage = lazy(() => import('@/pages/TransactionPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function RedirectKeepingQuery({ to }: { to: string }) {
  const { search } = useLocation()
  const target = new URL(to, window.location.origin)
  new URLSearchParams(search).forEach((value, key) => target.searchParams.set(key, value))
  return <Navigate to={`${target.pathname}${target.search}`} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <SeriesProvider>
          <WalletProvider>
            <ToastProvider>
              <Routes>
                <Route
                  path="/"
                  element={
                    <Suspense fallback={<div className="page-loading" aria-busy="true" aria-live="polite">Loading…</div>}>
                      <LandingPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/docs"
                  element={
                    <Suspense fallback={<div className="page-loading" aria-busy="true" aria-live="polite">Loading…</div>}>
                      <DocsPage />
                    </Suspense>
                  }
                />
                <Route element={<AppShell />}>
                  <Route path="/marketplace" element={<MarketplacePage />} />
                  <Route path="/series" element={<SeriesPage />} />
                  <Route path="/earn" element={<EarnPage />} />
                  {/* Deposit and listing used to be separate pages; both now live in the guided flow. */}
                  <Route path="/deposit" element={<RedirectKeepingQuery to="/earn" />} />
                  <Route path="/create-listing" element={<RedirectKeepingQuery to="/earn?step=sell" />} />
                  <Route path="/listing/:id" element={<ListingDetailPage />} />
                  <Route path="/portfolio" element={<PortfolioPage />} />
                  <Route path="/calculator" element={<CalculatorPage />} />
                  <Route path="/transactions/:id" element={<TransactionPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </ToastProvider>
          </WalletProvider>
        </SeriesProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
