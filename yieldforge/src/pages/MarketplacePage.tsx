import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, RefreshCcw } from 'lucide-react'
import { Button, DemoBanner, FlatRateNote, InlineEmpty, Panel, TokenBadge } from '@/components/ui'
import { listings as demoListings } from '@/lib/demoData'
import { isLiveMode } from '@/lib/near/wallet'
import { withSeries } from '@/contexts/SeriesContext'
import { isFillable, toUiListing } from '@/lib/contracts/marketplace'
import { bySchedule, tenorLabel, useAllSeries } from '@/hooks/useAllSeries'
import type { SeriesDisplay } from '@/hooks/useSeriesDisplay'
import { isRateFlat, useStakingApr } from '@/hooks/useStakingApr'
import { breakEvenApr, MARKET_FEE_BPS } from '@/utils/math'
import { formatDate, formatYocto } from '@/utils/format'
import type { Listing } from '@/types'

const DAY_MS = 86_400_000

/** Exact on-chain amounts when we have them; the rounded UI numbers otherwise (demo). */
const available = (l: Listing) => (l.remainingYocto ? formatYocto(l.remainingYocto, 4) : l.remaining.toLocaleString('en-US', { maximumFractionDigits: 4 }))
const unitPrice = (l: Listing) => (l.unitPriceYocto ? Number(formatYocto(l.unitPriceYocto, 8)) : l.unitPrice)

interface Offer {
  contractId: string
  series: SeriesDisplay
  listing: Listing
  breakEven: number | null
}

/** Days of yield a YT bought now still collects. */
function yieldDaysLeft(d: SeriesDisplay): number {
  if (!d.maturityMs) return 0
  return Math.max(0, (d.maturityMs - Math.max(Date.now(), d.cutoffMs ?? 0)) / DAY_MS)
}

/** Buy YT: every open listing across every series, with the one number a buyer decides on. */
export default function MarketplacePage() {
  const navigate = useNavigate()
  const live = isLiveMode()
  const all = useAllSeries()
  const staking = useStakingApr()

  const offers = useMemo<Offer[] | null>(() => {
    if (!all.data) return null
    const rows = [...all.data].sort(bySchedule)
    const out: Offer[] = []
    for (const row of rows) {
      const d = row.display
      const r0 = d.baselineRate ?? d.currentRate
      const listings = live ? row.listings.filter(isFillable).map(toUiListing) : demoListings.filter((l) => l.status === 'Open' || l.status === 'Partial')
      for (const listing of listings) {
        out.push({ contractId: row.contractId, series: d, listing, breakEven: r0 ? breakEvenApr(unitPrice(listing), d.marketFeeBps ?? MARKET_FEE_BPS, r0, yieldDaysLeft(d)) : null })
      }
    }
    return out
  }, [all.data, live])

  const open = (o: Offer) => navigate(withSeries(`/listing/${o.listing.id}`, o.contractId))

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Buy YT</h1>
          <p>Each listing sells the future staking yield of stNEAR in one series. You pay NEAR now; YT pays out in stNEAR after the series matures.</p>
        </div>
        <div className="page-header-action">
          <Button variant="secondary" onClick={() => navigate('/earn')}>
            Sell your yield <ArrowRight size={15} aria-hidden />
          </Button>
        </div>
      </div>

      <DemoBanner />

      {live && staking.app && isRateFlat(staking.app) && <FlatRateNote app={staking.app} reference={staking.reference} />}

      <Panel className="market-panel">
        {offers === null ? (
          <InlineEmpty title={all.error ? 'Could not read the listings.' : 'Loading listings…'} detail={all.error ?? undefined} action={all.error ? <Button size="sm" variant="secondary" onClick={all.refresh}>Retry</Button> : undefined} />
        ) : offers.length === 0 ? (
          <InlineEmpty
            title="No YT for sale right now."
            detail="Listings appear here as soon as someone deposits stNEAR and lists their YT."
            action={
              <Button size="sm" onClick={() => navigate('/earn')}>
                Deposit & sell yours <ArrowRight size={13} aria-hidden />
              </Button>
            }
          />
        ) : (
          <div className="market-table" role="table" aria-label="Open YT listings">
            <div className="market-row market-head" role="row">
              <span role="columnheader">Series</span>
              <span role="columnheader">Available</span>
              <span role="columnheader">Price / YT</span>
              <span role="columnheader">Break-even APR</span>
              <span role="columnheader">Listing ends</span>
              <span role="columnheader" aria-hidden />
            </div>
            {offers.map((o) => (
              <div key={`${o.contractId}-${o.listing.id}`} className="market-row" role="row">
                <span role="cell" className="market-series">
                  <TokenBadge kind="YT" size="sm" decorative />
                  <span>
                    <strong>
                      {tenorLabel(o.series)} · {o.series.id}
                    </strong>
                    <small>
                      Matures {formatDate(o.series.maturityMs)} · #{o.listing.id}
                    </small>
                  </span>
                </span>
                <span role="cell" data-label="Available">
                  {available(o.listing)} YT
                </span>
                <span role="cell" data-label="Price / YT">
                  {unitPrice(o.listing).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })} NEAR
                </span>
                <span role="cell" data-label="Break-even APR" className={`market-be ${o.breakEven != null && o.breakEven < staking.aprPercent ? 'market-be-under' : ''}`}>
                  {o.breakEven != null ? `${o.breakEven.toFixed(1)}%` : '—'}
                  {o.breakEven != null && <small>{o.breakEven < staking.aprPercent ? 'below' : 'above'} today’s {staking.aprPercent.toFixed(1)}%</small>}
                </span>
                <span role="cell" data-label="Ends">
                  {o.listing.expiry}
                </span>
                <span role="cell" className="market-buy">
                  <Button size="sm" onClick={() => open(o)}>
                    Buy
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="market-foot">
          <span>
            <strong>Break-even APR</strong> is the stNEAR staking rate needed until maturity for a purchase to pay back, fee included. Lower is better.
            Staking pays about <strong>{staking.aprPercent.toFixed(1)}%</strong> today ({staking.label}).{' '}
            <Link to="/docs#guide-buy">How buying works</Link>
          </span>
          {live && (
            <button type="button" className="icon-button" onClick={all.refresh} aria-label="Refresh listings">
              <RefreshCcw size={14} aria-hidden />
            </button>
          )}
        </div>
      </Panel>
    </>
  )
}
