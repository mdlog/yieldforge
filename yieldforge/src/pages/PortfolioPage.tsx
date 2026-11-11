import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react'
import { ActivityList, Button, DemoBanner, Eyebrow, FlatRateNote, InlineEmpty, Panel, RiskCallout, SectionHeading, StatusPill, TransactionRow, TxFeedback, TokenBadge } from '@/components/ui'
import { demoOwnedListingIds, listings as demoListings, positions, transactions } from '@/lib/demoData'
import { useWallet } from '@/contexts/WalletContext'
import { useSeries, withSeries } from '@/contexts/SeriesContext'
import { useToast } from '@/contexts/ToastContext'
import { isLiveMode } from '@/lib/near/wallet'
import { buildCaptureBaselineTx, buildRedeemTx, buildRequestSettlementTx, fetchRedeemPreview } from '@/lib/contracts/series'
import { getNearConfig } from '@/lib/near/config'
import { buildStorageDepositTx, needsStorageDeposit, storageMinimum } from '@/lib/near/tx'
import { useNearQuery } from '@/hooks/useNearQuery'
import { buildCancelListingTx, isFillable, toUiListing } from '@/lib/contracts/marketplace'
import { useAccountActivity, useLiveListings, useLivePosition } from '@/hooks/useLiveData'
import { useSeriesDisplay } from '@/hooks/useSeriesDisplay'
import { tenorLabel, useAllPositions, useAllSeries } from '@/hooks/useAllSeries'
import { isRateFlat, useStakingApr } from '@/hooks/useStakingApr'
import type { SeriesDisplay } from '@/hooks/useSeriesDisplay'
import { useTx } from '@/hooks/useTx'
import { formatYocto, toBigInt } from '@/utils/format'
import { projectPayout } from '@/utils/math'

const DAY_MS = 86_400_000
const near = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })

/** Days of yield still to accrue: from the cutoff (or now, if later) to maturity. */
function accrualDaysLeft(d: SeriesDisplay): number {
  if (!d.maturityMs) return 0
  return Math.max(0, (d.maturityMs - Math.max(Date.now(), d.cutoffMs ?? 0)) / DAY_MS)
}

export default function PortfolioPage() {
  const navigate = useNavigate()
  const { isConnected, connect, accountId } = useWallet()
  const { push } = useToast()
  const live = isLiveMode()
  const { display: series, refresh: refreshSeries } = useSeriesDisplay()
  const positionQuery = useLivePosition(isConnected ? accountId : null)
  const { seriesIds, active, select } = useSeries()
  const allSeries = useAllSeries()
  const allPositions = useAllPositions(live && isConnected && seriesIds.length > 1 ? accountId : null)
  // Projections use the rate this app's stNEAR actually grows at; mainnet's rate is shown alongside when that one is flat.
  const staking = useStakingApr()
  const accrualApr = staking.app?.aprPercent ?? staking.aprPercent
  const accrualLabel = staking.app ? `${staking.app.contractId.includes('testnet') ? 'testnet' : 'this'} stNEAR, last ${Math.round(staking.app.days)} days` : staking.label
  const appFlat = isRateFlat(staking.app)
  const listingsQuery = useLiveListings()
  const activity = useAccountActivity(isConnected ? accountId : null, 4)
  const redeemTx = useTx()
  const settleTx = useTx()
  const baselineTx = useTx()
  const storageTx = useTx()
  const cancelTx = useTx()
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const position = positionQuery.data
  const pt = toBigInt(position?.ptBalance)
  const yt = toBigInt(position?.ytBalance)
  const locked = toBigInt(position?.lockedStNear)
  const hasPosition = position != null && (pt > 0n || yt > 0n || locked > 0n)
  const positionLoading = live && isConnected && positionQuery.loading
  const redeemable = live && position?.redeemable === true
  const stNearContract = getNearConfig().stNearContractId

  // Exact stNEAR the contract would pay for the current balances (preview_redeem), once settled.
  const preview = useNearQuery(() => (redeemable ? fetchRedeemPreview(pt.toString(), yt.toString()) : Promise.resolve(null)), [redeemable, pt.toString(), yt.toString()])
  // Payouts are stNEAR transfers; Meta Pool only sends to registered accounts (else the claim is restored).
  const payoutRegistration = useNearQuery(
    () => (redeemable && accountId ? needsStorageDeposit(accountId, stNearContract) : Promise.resolve(false)),
    [redeemable, accountId],
  )
  const needsPayoutStorage = payoutRegistration.data === true

  const ownedListings = useMemo(
    () => (live && accountId ? (listingsQuery.data ?? []).filter((l) => l.seller === accountId) : []),
    [live, accountId, listingsQuery.data],
  )
  const openOwned = ownedListings.filter(isFillable)
  const closedCount = ownedListings.length - openOwned.length

  // Re-read chain state after any confirmed action on this page.
  const { refresh: refreshPosition } = positionQuery
  const { refresh: refreshListings } = listingsQuery
  useEffect(() => {
    if (!live) return
    if (redeemTx.phase === 'confirmed') refreshPosition()
    if (settleTx.phase === 'confirmed' || baselineTx.phase === 'confirmed') refreshSeries()
    if (cancelTx.phase === 'confirmed') refreshListings()
    if (storageTx.phase === 'confirmed') payoutRegistration.refresh()
    // The refresh callbacks are recreated each render; the phase transitions are what matter here.
  }, [live, redeemTx.phase, settleTx.phase, baselineTx.phase, storageTx.phase, cancelTx.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRedeem = async (kind: 'pt' | 'yt') => {
    if (!isConnected) return void connect()
    if (!live) {
      if (await redeemTx.simulate()) push('Demo redemption confirmed. Funds simulated.', 'success')
      return
    }
    if (!position?.redeemable) return push('Redemption opens once the series is matured and settled.')
    const amount = kind === 'pt' ? pt : yt
    if (amount <= 0n) return push(`No ${kind.toUpperCase()} left to redeem.`)
    const hash = await redeemTx.execute(buildRedeemTx({ amountYocto: amount.toString(), isPt: kind === 'pt' }))
    if (hash) push(`${kind.toUpperCase()} redemption submitted. Finality is being checked.`, 'success')
  }

  const requestSettlement = async () => {
    if (!isConnected) return void connect()
    const hash = await settleTx.execute(buildRequestSettlementTx())
    if (hash) push('Settlement requested. The series reads the Meta Pool rate and stores it once.', 'success')
  }

  const captureBaseline = async () => {
    if (!isConnected) return void connect()
    const hash = await baselineTx.execute(buildCaptureBaselineTx())
    if (hash) push('Baseline requested. The series reads the Meta Pool rate once.', 'success')
  }

  const enablePayouts = async () => {
    if (!isConnected || !accountId) return void connect()
    const deposit = await storageMinimum(stNearContract).catch(() => 1_250_000_000_000_000_000_000n)
    await storageTx.execute(buildStorageDepositTx(stNearContract, accountId, deposit))
  }

  const cancelListing = async (listingId: string) => {
    if (!isConnected) return void connect()
    setCancellingId(listingId)
    const hash = await cancelTx.execute(buildCancelListingTx(listingId))
    if (hash) push(`Cancellation of listing #${listingId} submitted.`, 'success')
  }

  const demoActive = positions.find((p) => p.status === 'Active')
  const demoMatured = positions.find((p) => p.status === 'Matured')
  const demoOwned = demoListings.filter((l) => demoOwnedListingIds.includes(l.id))
  const demoOpenOwned = demoOwned.filter((l) => l.status === 'Open' || l.status === 'Partial')
  const demoRedeemed = !live && (redeemTx.phase === 'confirmed' || redeemTx.phase === 'indexing')
  const redeemBusy = redeemTx.phase === 'awaiting_signature' || redeemTx.phase === 'submitted'
  const fmt = (v: bigint) => formatYocto(v, 2)


  return (
    <>
      <div className="page-header">
        <div>
          <h1>Portfolio</h1>
          <p>
            {!isConnected
              ? live
                ? 'Connect a wallet to see live on-chain positions.'
                : 'Demo positions are visible for inspection. Connect a wallet to manage them.'
              : live
                ? 'Your PT, YT and listings, read from each series contract.'
                : 'Positions below are demo data.'}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate('/earn')}>
          Deposit &amp; sell <ArrowRight size={15} aria-hidden />
        </Button>
      </div>

      <DemoBanner />

      {!isConnected && (
        <div className="connect-strip" role="status">
          <Wallet size={17} aria-hidden />
          <span>
            <strong>Connect to manage positions.</strong> Browsing is read-only until a wallet is connected.
          </span>
          <Button size="sm" onClick={() => void connect()}>
            Connect wallet
          </Button>
        </div>
      )}

      {live && isConnected && seriesIds.length > 1 && (
        <Panel className="all-positions-panel">
          <SectionHeading eyebrow="All series" title="Your positions" description="Each series pays out on its own date. Pick one to see its details below." />
          {appFlat && staking.app && allPositions.data?.some((r) => toBigInt(r.position.ytBalance) > 0n) && <FlatRateNote app={staking.app} reference={staking.reference} />}
          {allPositions.loading && !allPositions.data ? (
            <InlineEmpty title="Reading your positions in every series…" />
          ) : !allPositions.data || allPositions.data.length === 0 ? (
            <InlineEmpty title="No position in any series yet." detail="Deposit into a series that is open, or buy YT on the marketplace." />
          ) : (
            <div className="all-positions">
              {allPositions.data.map(({ contractId, position }) => {
                const d = allSeries.data?.find((row) => row.contractId === contractId)?.display
                const current = contractId === active
                const projection = (aprPercent: number) =>
                  d?.currentRate != null
                    ? projectPayout({
                        pt: Number(formatYocto(position.ptBalance, 8)),
                        yt: Number(formatYocto(position.ytBalance, 8)),
                        rateNow: d.currentRate,
                        r0: d.baselineRate,
                        rt: d.settlementRate,
                        aprPercent,
                        daysLeft: accrualDaysLeft(d),
                      })
                    : null
                const est = projection(accrualApr)
                const ifMainnet = appFlat && staking.reference && est && !est.settled && toBigInt(position.ytBalance) > 0n ? projection(staking.reference.aprPercent) : null
                return (
                  <div key={contractId} className={`all-position ${current ? 'all-position-current' : ''}`}>
                    <div className="all-position-series">
                      <strong>
                        {d ? `${tenorLabel(d)} · ${d.id}` : contractId.split('.')[0]}
                      </strong>
                      <small>{d ? `${d.phase} · matures ${d.maturityLabel}` : contractId}</small>
                    </div>
                    <div className="all-position-balances">
                      <span>
                        <TokenBadge kind="PT" size="sm" /> {formatYocto(position.ptBalance, 4)}
                      </span>
                      <span>
                        <TokenBadge kind="YT" size="sm" /> {formatYocto(position.ytBalance, 4)}
                      </span>
                    </div>
                    <div className="all-position-est">
                      {est ? (
                        <>
                          <span>
                            {est.settled ? 'Pays' : 'At maturity ≈'} <strong>{near(est.ptNear + est.ytNear)} NEAR</strong>
                          </span>
                          <small>
                            PT {near(est.ptNear)} + YT {near(est.ytNear)}
                            {est.settled ? ' · settled' : ` · at ${accrualApr.toFixed(1)}% (${accrualLabel})`}
                          </small>
                          {est.ytAccruedNear > 0 && !est.settled && <small>YT earned so far {near(est.ytAccruedNear)} NEAR</small>}
                          {ifMainnet && staking.reference && (
                            <small>
                              If it grew like mainnet ({staking.reference.aprPercent.toFixed(1)}%): YT ≈ {near(ifMainnet.ytNear)} NEAR
                            </small>
                          )}
                        </>
                      ) : (
                        <small>Projection unavailable</small>
                      )}
                    </div>
                    <div className="all-position-actions">
                      {toBigInt(position.ytBalance) > 0n && d && !d.matured && (
                        <Button size="sm" onClick={() => navigate(withSeries('/earn?step=sell', contractId))}>
                          Sell YT
                        </Button>
                      )}
                      {current ? (
                        <StatusPill tone="lime">Shown below</StatusPill>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => select(contractId)}>
                          Details
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      )}

      <div className="portfolio-layout">
        <div className="portfolio-main">
          <Panel className="positions-panel">
            <SectionHeading eyebrow="Selected series" title={series ? `${series.id} · ${series.phase}` : 'Series position'} />

            {live ? (
              !isConnected ? (
                <InlineEmpty title="Connect wallet to see your on-chain positions." action={<Button size="sm" onClick={() => void connect()}>Connect wallet <ArrowRight size={13} aria-hidden /></Button>} />
              ) : positionLoading ? (
                <InlineEmpty title="Loading on-chain positions…" />
              ) : positionQuery.error ? (
                <InlineEmpty title="Could not read the series contract." detail={positionQuery.error} action={<Button size="sm" variant="secondary" onClick={refreshPosition}>Retry</Button>} />
              ) : !hasPosition ? (
                <InlineEmpty title="No live positions yet." detail="Deposit stNEAR to mint PT and YT on-chain." action={<Button size="sm" onClick={() => navigate('/earn')}>Deposit stNEAR <ArrowRight size={13} aria-hidden /></Button>} />
              ) : (
                <div className="position-card active-position">
                  <div className="position-card-head">
                    <div className="position-series">
                      <span className="position-mark" aria-hidden>
                        YF
                      </span>
                      <div>
                        <strong>{series?.name ?? 'Active series'}</strong>
                        <small>On-chain position · {accountId}</small>
                      </div>
                    </div>
                    <StatusPill tone={series?.matured ? 'lime' : 'success'}>{series?.phase ?? 'Active'}</StatusPill>
                  </div>
                  <div className="position-balance-grid">
                    <div>
                      <span>Locked underlying</span>
                      <strong>{fmt(locked)} stNEAR</strong>
                      <small>matures {series?.maturityLabel ?? '—'}</small>
                    </div>
                    <div>
                      <TokenBadge kind="PT" size="sm" />
                      <strong>{fmt(pt)}</strong>
                      <small>series ledger</small>
                    </div>
                    <div>
                      <TokenBadge kind="YT" size="sm" />
                      <strong>{fmt(yt)}</strong>
                      <small>NEP-141 token{openOwned.length ? ` · ${openOwned.length} listed` : ''}</small>
                    </div>
                  </div>
                  <div className="position-card-foot">
                    <span>
                      <span className="signal-dot" aria-hidden /> {series?.matured ? 'Matured — see redemption below' : 'Early redemption is unavailable before maturity'}
                    </span>
                    <div>
                      <Button variant="secondary" size="sm" onClick={() => navigate(withSeries('/earn?step=sell', getNearConfig().seriesContractId))} disabled={yt <= 0n}>
                        List YT
                      </Button>
                      <Button size="sm" onClick={() => navigate('/series')}>
                        View series <ArrowRight size={13} aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            ) : (
              demoActive && (
                <div className="position-card active-position">
                  <div className="position-card-head">
                    <div className="position-series">
                      <span className="position-mark" aria-hidden>
                        YF
                      </span>
                      <div>
                        <strong>{demoActive.series}</strong>
                        <small>Position {demoActive.id} · Active</small>
                      </div>
                    </div>
                    <StatusPill tone="success">{demoActive.maturity}</StatusPill>
                  </div>
                  <div className="position-balance-grid">
                    <div>
                      <span>Locked underlying</span>
                      <strong>{demoActive.deposited.toFixed(2)} stNEAR</strong>
                      <small>baseline {demoActive.baseline.toFixed(4)}</small>
                    </div>
                    <div>
                      <TokenBadge kind="PT" size="sm" />
                      <strong>{demoActive.pt.toFixed(2)}</strong>
                      <small>principal-side units</small>
                    </div>
                    <div>
                      <TokenBadge kind="YT" size="sm" />
                      <strong>{demoActive.yt.toFixed(2)}</strong>
                      <small>yield-right units</small>
                    </div>
                  </div>
                  <div className="position-card-foot">
                    <span>
                      <span className="signal-dot" aria-hidden /> Rate now {demoActive.current.toFixed(4)}{' '}
                      <span className="positive">+{((demoActive.current / demoActive.baseline - 1) * 100).toFixed(2)}%</span>
                    </span>
                    <div>
                      <Button variant="secondary" size="sm" onClick={() => navigate(withSeries('/earn?step=sell', getNearConfig().seriesContractId))}>
                        List YT
                      </Button>
                      <Button size="sm" onClick={() => navigate('/series')}>
                        View series <ArrowRight size={13} aria-hidden />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            )}

            {live && isConnected && series?.baselinePending && !series.matured && (
              <div className="position-card matured-position">
                <div className="position-card-head">
                  <div className="position-series">
                    <span className="position-mark muted-mark" aria-hidden>
                      R0
                    </span>
                    <div>
                      <strong>Baseline not captured yet</strong>
                      <small>Deposits closed {series.cutoffLabel}</small>
                    </div>
                  </div>
                  <StatusPill tone="warning">Awaiting baseline</StatusPill>
                </div>
                <TxFeedback tx={baselineTx} failedTitle="Baseline request failed" successTitle="Baseline captured" successBody="YT accrues from this rate onwards." />
                {baselineTx.phase === 'idle' && (
                  <div className="position-card-foot">
                    <span>Anyone can record the starting rate from Meta Pool. It is stored once and cannot change.</span>
                    <Button size="sm" onClick={captureBaseline}>
                      Capture baseline <ArrowRight size={13} aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
            )}

            {live && isConnected && hasPosition && series?.matured && (
              <div className="position-card matured-position">
                <div className="position-card-head">
                  <div className="position-series">
                    <span className="position-mark muted-mark" aria-hidden>
                      YF
                    </span>
                    <div>
                      <strong>Maturity & redemption</strong>
                      <small>{series.settled ? 'Settlement rate recorded' : 'Settlement pending'}</small>
                    </div>
                  </div>
                  <StatusPill tone={position?.redeemable ? 'lime' : 'warning'}>{position?.redeemable ? 'Redeemable' : 'Awaiting settlement'}</StatusPill>
                </div>
                <div className="matured-copy">
                  <div>
                    <span>Settlement rate</span>
                    <strong>{series.settlementRate != null ? `${series.settlementRate.toFixed(4)} NEAR / stNEAR` : 'Not recorded yet'}</strong>
                    <small>Read once from Meta Pool, then immutable</small>
                  </div>
                  <div>
                    <span>{redeemable ? 'You receive (exact)' : 'Claims to redeem'}</span>
                    <strong>{redeemable && preview.data ? `${formatYocto(toBigInt(preview.data.pt) + toBigInt(preview.data.yt), 4)} stNEAR` : `${fmt(pt + yt)} units`}</strong>
                    <small>
                      {redeemable && preview.data
                        ? `PT ${fmt(pt)} → ${formatYocto(preview.data.pt, 4)} · YT ${fmt(yt)} → ${formatYocto(preview.data.yt, 4)} stNEAR`
                        : `PT ${fmt(pt)} + YT ${fmt(yt)}`}
                    </small>
                  </div>
                </div>
                {!series.settled ? (
                  <>
                    <TxFeedback tx={settleTx} failedTitle="Settlement request failed" successTitle="Settlement requested" successBody="Refreshing the series state." />
                    {settleTx.phase === 'idle' && (
                      <div className="position-card-foot">
                        <span>Anyone can request settlement after maturity.</span>
                        <Button size="sm" onClick={requestSettlement}>
                          Request settlement <ArrowRight size={13} aria-hidden />
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {needsPayoutStorage && (
                      <>
                        <TxFeedback tx={storageTx} failedTitle="Registration failed" successTitle="stNEAR payouts enabled" />
                        {storageTx.phase === 'idle' && (
                          <div className="position-card-foot">
                            <span>Payouts arrive as stNEAR. Register this account on {stNearContract} first (one-time storage).</span>
                            <Button size="sm" onClick={enablePayouts}>
                              Enable stNEAR payouts <ArrowRight size={13} aria-hidden />
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                    <TxFeedback tx={redeemTx} failedTitle="Redemption failed" successTitle="Redemption confirmed on-chain" successBody="Claims burned and stNEAR sent to your wallet." />
                    {redeemTx.phase === 'idle' && !needsPayoutStorage && (
                      <div className="position-card-foot">
                        <span>{pt + yt > 0n ? 'Each claim unit can be redeemed once.' : 'Nothing left to redeem.'}</span>
                        <div>
                          <Button size="sm" onClick={() => handleRedeem('pt')} disabled={pt <= 0n || redeemBusy}>
                            Redeem PT <ArrowRight size={13} aria-hidden />
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => handleRedeem('yt')} disabled={yt <= 0n || redeemBusy}>
                            Redeem YT
                          </Button>
                        </div>
                      </div>
                    )}
                    <RiskCallout title="If a payout fails">If Meta Pool rejects the stNEAR transfer, the contract gives the burned claim back so you can retry.</RiskCallout>
                  </>
                )}
              </div>
            )}

            {!live && demoMatured && (
              <div className={`position-card matured-position ${demoRedeemed ? 'position-redeemed' : ''}`}>
                <div className="position-card-head">
                  <div className="position-series">
                    <span className="position-mark muted-mark" aria-hidden>
                      YF
                    </span>
                    <div>
                      <strong>{demoMatured.series}</strong>
                      <small>
                        Position {demoMatured.id} · {demoRedeemed ? 'Redeemed' : 'Matured'}
                      </small>
                    </div>
                  </div>
                  <StatusPill tone={demoRedeemed ? 'neutral' : 'lime'}>{demoRedeemed ? 'Consumed' : 'Redeemable'}</StatusPill>
                </div>
                <div className="matured-copy">
                  <div>
                    <span>Settlement rate</span>
                    <strong>{demoMatured.current.toFixed(4)} NEAR / stNEAR</strong>
                    <small>Snapshot at maturity · {demoMatured.maturity}</small>
                  </div>
                  <div>
                    <span>Total redemption</span>
                    <strong>{demoRedeemed ? '0.00' : demoMatured.redemption?.total.toFixed(2)} NEAR</strong>
                    <small>
                      PT {demoMatured.redemption?.pt.toFixed(2)} + YT {demoMatured.redemption?.yt.toFixed(2)}
                    </small>
                  </div>
                </div>
                <TxFeedback tx={redeemTx} failedTitle="Redemption failed" successTitle="Demo redemption confirmed" successBody="Claims have been consumed." />
                {redeemTx.phase === 'idle' && (
                  <div className="position-card-foot">
                    <span>Matured — each claim unit can be redeemed once.</span>
                    <div>
                      <Button size="sm" onClick={() => handleRedeem('pt')}>
                        Redeem PT <ArrowRight size={13} aria-hidden />
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleRedeem('yt')}>
                        Redeem YT
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel className="listings-owned-panel">
            <SectionHeading eyebrow="Your listings" title="Open offers" action={<StatusPill tone="info">{`${live ? openOwned.length : demoOpenOwned.length} open`}</StatusPill>} />
            {live ? (
              !isConnected ? (
                <InlineEmpty title="Connect wallet to see your listings." action={<Button size="sm" onClick={() => void connect()}>Connect wallet <ArrowRight size={13} aria-hidden /></Button>} />
              ) : listingsQuery.loading ? (
                <InlineEmpty title="Loading your listings…" />
              ) : ownedListings.length === 0 ? (
                <InlineEmpty title="No listings yet." detail="Create a YT listing to offer your future-yield right." action={<Button size="sm" onClick={() => navigate(withSeries('/earn?step=sell', getNearConfig().seriesContractId))}>Create listing <ArrowRight size={13} aria-hidden /></Button>} />
              ) : (
                <>
                  {(showClosed ? ownedListings : openOwned).map((view) => {
                    const l = toUiListing(view)
                    const open = isFillable(view)
                    return (
                      <div key={l.id} className={`owned-listing ${open ? '' : 'secondary-owned'}`}>
                        <button className="listing-id owned-listing-link" onClick={() => navigate(withSeries(`/listing/${l.id}`, getNearConfig().seriesContractId))}>
                          <TokenBadge kind="YT" size="sm" muted={!open} decorative />
                          <span>
                            <strong>#{l.id}</strong>
                            <small>
                              {l.remaining.toFixed(2)} of {l.quantity.toFixed(2)} YT · {l.unitPrice.toFixed(4)} NEAR
                            </small>
                          </span>
                        </button>
                        <div>
                          <span className="owned-label">Expiry</span>
                          <strong>{l.expiry}</strong>
                        </div>
                        <StatusPill tone={open ? 'success' : 'neutral'}>{l.status}</StatusPill>
                        {open ? (
                          <button
                            className="text-link"
                            onClick={() => cancelListing(l.id)}
                            disabled={cancelTx.phase === 'awaiting_signature' || cancelTx.phase === 'submitted'}
                            aria-label={`Cancel listing ${l.id}`}
                          >
                            Cancel
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    )
                  })}
                  {openOwned.length === 0 && !showClosed && <InlineEmpty title="No open offers right now." />}
                  {closedCount > 0 && (
                    <button className="text-link owned-toggle" onClick={() => setShowClosed((v) => !v)}>
                      {showClosed ? 'Hide' : 'Show'} {closedCount} filled / closed listing{closedCount === 1 ? '' : 's'}
                    </button>
                  )}
                  {cancellingId && (
                    <TxFeedback
                      tx={cancelTx}
                      failedTitle={`Cancelling #${cancellingId} failed`}
                      successTitle={`Listing #${cancellingId} cancelled`}
                      successAction={<button onClick={() => { cancelTx.reset(); setCancellingId(null) }}>Dismiss</button>}
                    />
                  )}
                </>
              )
            ) : (
              <>
                {demoOwned.map((l) => {
                  const open = l.status === 'Open' || l.status === 'Partial'
                  return (
                    <div key={l.id} className={`owned-listing ${open ? '' : 'secondary-owned'}`}>
                      <div className="listing-id">
                        <TokenBadge kind="YT" size="sm" muted={!open} decorative />
                        <div>
                          <strong>{l.id}</strong>
                          <small>{open ? `${l.remaining.toFixed(2)} YT · at ${l.unitPrice.toFixed(4)} NEAR` : `${l.remaining.toFixed(2)} YT remaining · ${l.status.toLowerCase()}`}</small>
                        </div>
                      </div>
                      <div>
                        <span className="owned-label">{open ? 'Proceeds at full fill' : 'Filled'}</span>
                        <strong>{open ? `${l.totalPrice.toFixed(2)} NEAR` : `${l.filled.toFixed(2)} YT`}</strong>
                      </div>
                      <StatusPill tone={open ? 'success' : 'warning'}>{l.status}</StatusPill>
                      {open ? (
                        <button className="text-link" onClick={() => push('Demo: cancelling would close the offer and release the unfilled YT.')} aria-label={`Cancel listing ${l.id}`}>
                          Cancel
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </Panel>
        </div>

        <aside className="portfolio-side">
          <Panel className="quick-actions">
            <Eyebrow tone="lime">Next</Eyebrow>
            <h3>What would you like to do?</h3>
            <button onClick={() => navigate('/earn')}>
              <span className="quick-icon" aria-hidden>
                <ArrowDownRight size={15} />
              </span>
              <span>
                <strong>Deposit &amp; sell yield</strong>
                <small>Stake, deposit and list YT in one flow</small>
              </span>
              <ArrowRight size={14} aria-hidden />
            </button>
            <button onClick={() => navigate('/marketplace')}>
              <span className="quick-icon" aria-hidden>
                <ArrowUpRight size={15} />
              </span>
              <span>
                <strong>Buy YT</strong>
                <small>Open listings across every series</small>
              </span>
              <ArrowRight size={14} aria-hidden />
            </button>
          </Panel>

          <Panel className="activity-panel">
            <SectionHeading
              eyebrow="Activity"
              title="Recent transactions"
              action={
                <button className="text-link" onClick={() => navigate('/transactions/activity')}>
                  All <ArrowUpRight size={13} aria-hidden />
                </button>
              }
            />
            {!live ? (
              transactions.slice(0, 4).map((t) => <TransactionRow key={t.id} transaction={t} onOpen={(txId) => navigate(`/transactions/${txId}`)} />)
            ) : !isConnected || !accountId ? (
              <InlineEmpty title="Connect wallet to see activity." />
            ) : activity.loading ? (
              <InlineEmpty title="Loading recent transactions…" />
            ) : activity.data && activity.data.length > 0 ? (
              <ActivityList items={activity.data} accountId={accountId} />
            ) : (
              <InlineEmpty title="No activity yet for this wallet." detail="Deposit, list, or buy — every action links to the explorer." />
            )}
          </Panel>
        </aside>
      </div>
    </>
  )
}
