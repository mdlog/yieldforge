import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button, CopyButton, DemoBanner, EmptyState, ExplorerLink, InfoLine, InlineEmpty, Panel, StatusPill, TokenBadge, TxFeedback } from '@/components/ui'
import { listings as demoListings } from '@/lib/demoData'
import { useWallet } from '@/contexts/WalletContext'
import { useToast } from '@/contexts/ToastContext'
import { isLiveMode } from '@/lib/near/wallet'
import { explorerAccountUrl, getNearConfig } from '@/lib/near/config'
import { needsStorageDeposit, storageMinimum } from '@/lib/near/tx'
import { buildBuyTx, fetchListing, isFillable, toUiListing } from '@/lib/contracts/marketplace'
import { useLiveListing } from '@/hooks/useLiveData'
import { useNearQuery } from '@/hooks/useNearQuery'
import { useSeriesDisplay } from '@/hooks/useSeriesDisplay'
import { tenorLabel } from '@/hooks/useAllSeries'
import { useTx } from '@/hooks/useTx'
import { breakEvenApr, buildScenarioRows, buyCost, formatBps, MARKET_FEE_BPS } from '@/utils/math'
import { formatNear, formatYocto, formatYoctoInput, parseNear, toBigInt } from '@/utils/format'
import type { Listing } from '@/types'

const DAY_MS = 86_400_000

function toYocto(value: string): bigint | null {
  try {
    const v = parseNear(value.trim().replace(',', '.'))
    return v > 0n ? v : null
  } catch {
    return null
  }
}

/** One listing, built around the buy decision: what you pay, what you get, when it pays back. */
export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { isConnected, connect, accountId } = useWallet()
  const { push } = useToast()
  const live = isLiveMode()
  const cfg = getNearConfig()
  const tx = useTx()
  const { display: series } = useSeriesDisplay()
  const listingQuery = useLiveListing(id)

  const listing = useMemo<Listing | null>(() => {
    if (!live) return demoListings.find((l) => l.id === id) ?? null
    return listingQuery.data ? toUiListing(listingQuery.data) : null
  }, [live, id, listingQuery.data])

  // First-time holders of this series' YT pay its one-time storage registration inside `buy`.
  const storage = useNearQuery(async () => {
    if (!live || !accountId) return 0n
    return (await needsStorageDeposit(accountId, cfg.ytTokenContractId)) ? await storageMinimum(cfg.ytTokenContractId) : 0n
  }, [live, accountId, cfg.ytTokenContractId])

  const remainingYocto = listing ? (listing.remainingYocto ? toBigInt(listing.remainingYocto) : parseNear(String(listing.remaining))) : 0n
  const unitPriceYocto = listing ? (listing.unitPriceYocto ? toBigInt(listing.unitPriceYocto) : parseNear(String(listing.unitPrice))) : 0n

  const [quantity, setQuantity] = useState('')
  useEffect(() => {
    if (listing) setQuantity(formatYoctoInput(remainingYocto))
  }, [listing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshListing = listingQuery.refresh
  const refreshStorage = storage.refresh
  useEffect(() => {
    if (live && tx.phase === 'confirmed') {
      refreshListing()
      refreshStorage()
    }
  }, [live, tx.phase, refreshListing, refreshStorage])

  if (live && listingQuery.loading && !listingQuery.data) {
    return (
      <Panel>
        <InlineEmpty title={`Loading listing #${id}…`} />
      </Panel>
    )
  }

  if (!listing) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Listing not found</h1>
            <p>{listingQuery.error ? `Could not read the listing: ${listingQuery.error}` : `There is no listing #${id} in this series.`}</p>
          </div>
        </div>
        <Panel>
          <EmptyState
            title="Nothing to buy here"
            description="It may belong to another series, or it was filled or cancelled."
            action={
              <Button onClick={() => navigate('/marketplace')}>
                See all listings <ArrowRight size={14} aria-hidden />
              </Button>
            }
          />
        </Panel>
      </>
    )
  }

  const fillable = listing.status === 'Open' || listing.status === 'Partial'
  const qtyYocto = toYocto(quantity)
  const qtyExceeds = qtyYocto !== null && qtyYocto > remainingYocto
  const feeBps = series?.marketFeeBps ?? MARKET_FEE_BPS
  const cost = buyCost(qtyYocto ?? 0n, unitPriceYocto, feeBps)
  const storageYocto = storage.data ?? 0n
  const r0 = series?.baselineRate ?? series?.currentRate ?? null
  const yieldDays = series?.maturityMs ? Math.max(0, (series.maturityMs - Math.max(Date.now(), series.cutoffMs ?? 0)) / DAY_MS) : 0
  const unitPrice = Number(formatYocto(unitPriceYocto, 8))
  const breakEven = r0 ? breakEvenApr(unitPrice, feeBps, r0, yieldDays) : null
  const qtyNumber = Number(formatYocto(qtyYocto ?? 0n, 6))
  const scenarios = series?.baselineRate != null ? buildScenarioRows(series.baselineRate, qtyNumber, Number(formatYocto(cost.total, 6))) : null
  const seriesName = series ? `${tenorLabel(series)} · ${series.id}` : 'this series'

  const buy = async () => {
    if (live && !isConnected) return void connect()
    if (!fillable) return push('This listing can no longer be bought.')
    if (qtyYocto === null) return push('Enter how much YT to buy.')
    if (qtyExceeds) {
      setQuantity(formatYoctoInput(remainingYocto))
      return push(`Only ${formatYocto(remainingYocto, 4)} YT is available; the amount was adjusted.`)
    }
    if (!live) {
      if (await tx.simulate()) push('Demo purchase confirmed.', 'success')
      return
    }
    // Re-read right before signing so a stale page can't overfill or hit a closed listing.
    const fresh = await fetchListing(listing.id).catch(() => null)
    if (fresh && !isFillable(fresh)) return push('This listing was just filled or cancelled.')
    if (fresh && qtyYocto > toBigInt(fresh.quantityRemaining)) return push(`Only ${formatYocto(fresh.quantityRemaining, 4)} YT remain. Try a smaller amount.`)
    const hash = await tx.execute(buildBuyTx({ listingId: listing.id, quantityYocto: qtyYocto.toString(), attachedDepositYocto: (cost.total + storageYocto).toString() }))
    if (hash) push('Purchase sent. Your YT arrives once it confirms.', 'success')
  }

  return (
    <div className="buy-page">
      <div className="page-header">
        <div>
          <Link className="back-link" to="/marketplace">
            ← All listings
          </Link>
          <h1>Buy YT · {seriesName}</h1>
          <p>
            Listing #{listing.id} by <span className="mono">{listing.seller}</span>
          </p>
        </div>
      </div>

      <DemoBanner />

      <div className="buy-layout">
        <Panel className="buy-card">
          <div className="buy-facts">
            <div>
              <span>Price</span>
              <strong>{unitPrice.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })} NEAR</strong>
              <small>per YT</small>
            </div>
            <div>
              <span>Available</span>
              <strong>{formatYocto(remainingYocto, 4)} YT</strong>
              <small>listing ends {listing.expiry}</small>
            </div>
            <div>
              <span>Break-even APR</span>
              <strong>{breakEven != null ? `${breakEven.toFixed(1)}%` : '—'}</strong>
              <small>staking APR needed until {series?.maturityLabel ?? 'maturity'}</small>
            </div>
          </div>

          {fillable ? (
            <>
              <div className="earn-field">
                <label className="earn-field-label" htmlFor="buy-qty">
                  YT to buy
                </label>
                <div className="earn-input">
                  <input id="buy-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={tx.phase !== 'idle'} />
                  <span>YT</span>
                  <button type="button" onClick={() => setQuantity(formatYoctoInput(remainingYocto))} disabled={tx.phase !== 'idle'}>
                    Max
                  </button>
                </div>
                {qtyExceeds && <small className="earn-hint">More than is available.</small>}
              </div>

              <div className="buy-total">
                <InfoLine label={`Price + ${formatBps(feeBps)} fee`} value={`${formatYocto(cost.total, 6)} NEAR`} />
                {storageYocto > 0n && <InfoLine label="One-time registration (first YT in this series)" value={`${formatYocto(storageYocto, 5)} NEAR`} hint="unused part is refunded" />}
                <InfoLine label="You pay" value={`${formatYocto(cost.total + storageYocto, 6)} NEAR`} />
                <InfoLine label="You get" value={`${formatYocto(qtyYocto ?? 0n, 4)} YT · paid out after ${series?.maturityLabel ?? 'maturity'}`} />
              </div>

              <p className="buy-risk">
                YT pays nothing if the stNEAR rate doesn’t rise above R0 by maturity. The most you can lose is what you pay. <Link to="/docs#risks">Risks</Link>
              </p>

              <TxFeedback
                tx={tx}
                failedTitle="Purchase failed"
                successTitle="YT bought"
                successBody={`${formatYocto(qtyYocto ?? 0n, 4)} YT is in your wallet.`}
                successAction={
                  <button onClick={() => navigate('/portfolio')}>
                    View in Portfolio <ArrowRight size={14} aria-hidden />
                  </button>
                }
              />
              {tx.phase === 'idle' && (
                <Button className="buy-cta" onClick={buy} disabled={qtyYocto === null}>
                  {isConnected || !live ? 'Buy YT' : 'Connect wallet to buy'} <ArrowRight size={15} aria-hidden />
                </Button>
              )}
            </>
          ) : (
            <p className="earn-note">
              This listing is {listing.status.toLowerCase()}. <Link to="/marketplace">See open listings</Link>
            </p>
          )}
        </Panel>

        <div className="buy-more">
          <details className="buy-details">
            <summary>What could this pay?</summary>
            {scenarios ? (
              <div className="scenario-table">
                <div className="scenario-head" aria-hidden>
                  <span>Scenario</span>
                  <span>Rate at maturity</span>
                  <span>YT payout</span>
                  <span>Your result</span>
                </div>
                {scenarios.map((row) => (
                  <div className={`scenario-row scenario-${row.tone}`} key={row.label}>
                    <span>
                      <i aria-hidden />
                      {row.label}
                    </span>
                    <strong>{row.rate.toFixed(4)}</strong>
                    <span>{formatNear(row.yield, 4)}</span>
                    <span>{`${row.buyerPayoff >= 0 ? '+' : '−'}${formatNear(Math.abs(row.buyerPayoff), 4)}`}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="earn-muted">Scenarios appear once the series baseline R0 is recorded ({series?.cutoffLabel ?? 'at the cutoff'}).</p>
            )}
          </details>
          <details className="buy-details">
            <summary>Listing details</summary>
            <InfoLine label="Status" value={<StatusPill tone={listing.status === 'Open' ? 'success' : listing.status === 'Partial' ? 'info' : 'warning'}>{listing.status}</StatusPill>} />
            <InfoLine label="Listed" value={`${listing.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} YT · ${listing.filled.toLocaleString('en-US', { maximumFractionDigits: 4 })} bought`} />
            <InfoLine label="Seller" value={<span className="buy-seller">{listing.seller} <CopyButton value={listing.seller} label="Copy seller" className="icon-button" iconOnly /></span>} />
            <InfoLine label="Series matures" value={series?.maturityExactLabel ?? '—'} />
            {live && <ExplorerLink href={explorerAccountUrl(cfg.marketplaceContractId)}>Series contract on the explorer</ExplorerLink>}
          </details>
        </div>
      </div>
    </div>
  )
}
