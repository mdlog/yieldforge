import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { Button, DemoBanner, TokenBadge, TxFeedback } from '@/components/ui'
import { demoWallet } from '@/lib/demoData'
import { useWallet } from '@/contexts/WalletContext'
import { useToast } from '@/contexts/ToastContext'
import { useSeries, withSeries } from '@/contexts/SeriesContext'
import { getNearConfig } from '@/lib/near/config'
import { isLiveMode } from '@/lib/near/wallet'
import { buildDepositTx, buildStakeAndDepositTx } from '@/lib/contracts/series'
import { buildStakeTx, getStNearPrice, MIN_STAKE_YOCTO } from '@/lib/contracts/metapool'
import { buildCreateListingTx } from '@/lib/contracts/marketplace'
import { ftTransferCallUsed, panicMessage } from '@/lib/near/outcome'
import { useTx, type OutcomeCheck } from '@/hooks/useTx'
import { useLivePosition, useNearBalance, useStNearBalance, useStNearPrice } from '@/hooks/useLiveData'
import { useSeriesDisplay } from '@/hooks/useSeriesDisplay'
import { bySchedule, tenorLabel, useAllSeries } from '@/hooks/useAllSeries'
import { useStakingApr } from '@/hooks/useStakingApr'
import { DEPOSIT_FEE_BPS, MARKET_FEE_BPS, buyCost, fairYtPrice, formatBps, listingExpiryOptions, lockedApr, previewDeposit, stakeMintYocto, zapDepositYocto } from '@/utils/math'
import { formatDate, formatYocto, formatYoctoInput, msToNanos, parseNear, toBigInt } from '@/utils/format'

type StepId = 'stake' | 'deposit' | 'sell'

const DAY_MS = 86_400_000
/** NEAR kept back from "Max" so the wallet can still pay gas and storage. */
const GAS_RESERVE_YOCTO = parseNear('0.1')

function toYocto(value: string): bigint | null {
  try {
    const v = parseNear(value.trim().replace(',', '.'))
    return v > 0n ? v : null
  } catch {
    return null
  }
}

function countdown(targetMs: number | null): string {
  if (targetMs == null) return '—'
  const diff = targetMs - Date.now()
  if (diff <= 0) return 'now'
  const days = Math.floor(diff / DAY_MS)
  const hours = Math.floor((diff % DAY_MS) / 3_600_000)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${Math.floor((diff % 3_600_000) / 60_000)}m`
}

/**
 * Deposit & sell, as one guided flow: get stNEAR, deposit it into a series for PT + YT, then optionally
 * list the YT. The open step follows the wallet (no stNEAR → stake, stNEAR → deposit, YT → sell).
 */
export default function EarnPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const live = isLiveMode()
  const cfg = getNearConfig()
  const { isConnected, connect, accountId } = useWallet()
  const { push } = useToast()
  const { active, select } = useSeries()
  const { display: series } = useSeriesDisplay()
  const all = useAllSeries()
  const staking = useStakingApr()
  const nearQuery = useNearBalance(isConnected ? accountId : null)
  const stNearQuery = useStNearBalance(isConnected ? accountId : null)
  const positionQuery = useLivePosition(isConnected ? accountId : null)
  const stakeTx = useTx()
  const zapTx = useTx()
  const depositTx = useTx()
  const priceQuery = useStNearPrice()
  const listTx = useTx()

  const balances = useMemo(() => {
    if (!live) {
      return { near: parseNear('25'), stNear: parseNear(String(demoWallet.stNear)), pt: parseNear(String(demoWallet.pt)), yt: parseNear(String(demoWallet.yt)) }
    }
    if (!isConnected) return null
    const position = positionQuery.data
    return {
      near: nearQuery.data != null ? BigInt(nearQuery.data) : null,
      stNear: stNearQuery.data != null ? BigInt(stNearQuery.data) : null,
      pt: position ? toBigInt(position.ptBalance) : positionQuery.loading ? null : 0n,
      yt: position ? toBigInt(position.ytBalance) : positionQuery.loading ? null : 0n,
    }
  }, [live, isConnected, nearQuery.data, stNearQuery.data, positionQuery.data, positionQuery.loading])

  // ---- Which step is open ------------------------------------------------------------------
  const minDeposit = series?.minDepositYocto ?? parseNear('0.01')
  const hasStNear = (balances?.stNear ?? 0n) >= minDeposit
  const hasYt = (balances?.yt ?? 0n) > 0n
  const autoStep: StepId = params.get('step') === 'sell' || hasYt ? 'sell' : hasStNear ? 'deposit' : 'stake'
  const [picked, setPicked] = useState<StepId | null>(null)
  const openStep = picked ?? autoStep

  // After each confirmation, refresh what changed and move on to the next step.
  const { refresh: refreshNear } = nearQuery
  const { refresh: refreshStNear } = stNearQuery
  const { refresh: refreshPosition } = positionQuery
  useEffect(() => {
    if (stakeTx.phase !== 'confirmed') return
    refreshNear()
    refreshStNear()
    setPicked('deposit')
  }, [stakeTx.phase, refreshNear, refreshStNear])
  useEffect(() => {
    if (depositTx.phase !== 'confirmed' && zapTx.phase !== 'confirmed') return
    refreshNear()
    refreshStNear()
    refreshPosition()
    setPicked('sell')
  }, [depositTx.phase, zapTx.phase, refreshNear, refreshStNear, refreshPosition])
  useEffect(() => {
    // A refused deposit still moved funds: the stake went through, or the refunded stNEAR is back.
    if (depositTx.phase !== 'failed' && zapTx.phase !== 'failed') return
    refreshNear()
    refreshStNear()
  }, [depositTx.phase, zapTx.phase, refreshNear, refreshStNear])
  useEffect(() => {
    if (listTx.phase === 'confirmed') refreshPosition()
  }, [listTx.phase, refreshPosition])

  // ---- Series choice -----------------------------------------------------------------------
  const rows = useMemo(() => [...(all.data ?? [])].sort(bySchedule), [all.data])
  const openRows = rows.filter((r) => r.display.depositsOpen)
  const choices = openRows.some((r) => r.contractId === active) ? openRows : [...rows.filter((r) => r.contractId === active), ...openRows]
  const chooseSeries = (contractId: string) => {
    if (contractId === active) return
    select(contractId)
    // Drop any ?series= so a reload keeps this choice.
    navigate(params.get('step') ? '/earn?step=sell' : '/earn', { replace: true })
  }

  const rate = series?.currentRate ?? null
  const accrualStart = Math.max(Date.now(), series?.cutoffMs ?? 0)
  const yieldDays = series?.maturityMs ? Math.max(0, (series.maturityMs - accrualStart) / DAY_MS) : 0
  const r0 = series?.baselineRate ?? rate

  // ---- Step 1: stake -----------------------------------------------------------------------
  const [stakeAmount, setStakeAmount] = useState(formatYoctoInput(MIN_STAKE_YOCTO))
  const stakeYocto = toYocto(stakeAmount)
  const stakeMax = balances?.near != null && balances.near > GAS_RESERVE_YOCTO ? balances.near - GAS_RESERVE_YOCTO : null
  const stake = async () => {
    if (live && !isConnected) return void connect()
    if (stakeYocto === null) return push('Enter how much NEAR to stake.')
    if (stakeYocto < MIN_STAKE_YOCTO) return push(`Meta Pool's minimum stake is ${formatYoctoInput(MIN_STAKE_YOCTO)} NEAR.`)
    if (balances?.near != null && stakeYocto > balances.near) return push('That is more NEAR than your wallet holds.')
    if (!live) {
      if (await stakeTx.simulate()) push('Demo stake confirmed.', 'success')
      return
    }
    if (await stakeTx.execute(buildStakeTx(stakeYocto.toString()))) push('Stake sent. stNEAR arrives once it confirms.', 'success')
  }

  // ---- Step 2: deposit ---------------------------------------------------------------------
  const [depositAmount, setDepositAmount] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const depositYocto = toYocto(depositAmount)
  const feeBps = series?.depositFeeBps ?? DEPOSIT_FEE_BPS
  const preview = previewDeposit(depositYocto ?? 0n, feeBps)

  // ft_transfer_call succeeds even when the series refuses the stNEAR: the stNEAR contract refunds it and the
  // transaction returns "0". Without this check that would read as a confirmed deposit.
  const refusedDeposit =
    (kept: string): OutcomeCheck =>
    ({ value, receiptErrors }) => {
      if (ftTransferCallUsed(value) !== 0n) return null
      const reason = receiptErrors.map(panicMessage).find(Boolean)
      return `The series refused the deposit${reason ? ` (“${reason}”)` : ''}, so ${kept}.`
    }

  // ---- Step 1 + 2 in one transaction ---------------------------------------------------------
  const canZap = series?.depositsOpen === true
  const [zap, setZap] = useState(true)
  const zapping = zap && canZap
  const priceScaled = priceQuery.data ? BigInt(priceQuery.data) : rate ? parseNear(rate.toFixed(12)) : null
  const zapPreview = previewDeposit(stakeYocto != null && priceScaled ? zapDepositYocto(stakeMintYocto(stakeYocto, priceScaled)) : 0n, feeBps)
  const stakeAndDeposit = async () => {
    if (live && !isConnected) return void connect()
    if (!series?.depositsOpen) return push('This series no longer takes deposits. Pick an open series above.')
    if (stakeYocto === null) return push('Enter how much NEAR to stake.')
    if (stakeYocto < MIN_STAKE_YOCTO) return push(`Meta Pool's minimum stake is ${formatYoctoInput(MIN_STAKE_YOCTO)} NEAR.`)
    if (balances?.near != null && stakeYocto > balances.near) return push('That is more NEAR than your wallet holds.')
    if (!acknowledged) return push('Tick the box to confirm you understand the risks.')
    if (!live) {
      if (await zapTx.simulate()) push('Demo stake and deposit confirmed.', 'success')
      return
    }
    // Price the deposit off a fresh read, right before signing.
    const fresh = await getStNearPrice().then(BigInt).catch(() => null)
    if (!fresh) return push('Could not read the stNEAR price. Try again.')
    const amount = zapDepositYocto(stakeMintYocto(stakeYocto, fresh))
    if (amount < minDeposit) return push(`That stakes too little to deposit; the minimum deposit is ${formatYoctoInput(minDeposit)} stNEAR.`)
    const hash = await zapTx.execute(
      buildStakeAndDepositTx({ nearYocto: stakeYocto.toString(), depositYocto: amount.toString() }),
      refusedDeposit('your NEAR was staked and the new stNEAR is in your wallet'),
    )
    if (hash) push('Sent. PT and YT arrive once it confirms.', 'success')
  }
  const deposit = async () => {
    if (live && !isConnected) return void connect()
    if (!series?.depositsOpen) return push('This series no longer takes deposits. Pick an open series above.')
    if (depositYocto === null) return push('Enter how much stNEAR to deposit.')
    if (depositYocto < minDeposit) return push(`The minimum deposit is ${formatYoctoInput(minDeposit)} stNEAR.`)
    if (balances?.stNear != null && depositYocto > balances.stNear) return push('That is more stNEAR than your wallet holds.')
    if (!acknowledged) return push('Tick the box to confirm you understand the risks.')
    if (!live) {
      if (await depositTx.simulate()) push('Demo deposit confirmed.', 'success')
      return
    }
    const hash = await depositTx.execute(buildDepositTx({ amountYocto: depositYocto.toString() }), refusedDeposit('the stNEAR came back to your wallet'))
    if (hash) push('Deposit sent. PT and YT arrive once it confirms.', 'success')
  }

  // ---- Step 3: sell YT ---------------------------------------------------------------------
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [expiryKey, setExpiryKey] = useState('')
  const [now] = useState(() => Date.now())
  const qtyYocto = toYocto(quantity)
  const priceYocto = toYocto(price)
  const suggested = r0 != null ? fairYtPrice(r0, staking.aprPercent, yieldDays, rate ?? r0) : null
  // The APR a depositor fixes by selling all their YT at this price, over the whole term and net of the
  // deposit fee, next to what staking pays today.
  const depositFeeBps = series?.depositFeeBps ?? DEPOSIT_FEE_BPS
  const locked = priceYocto !== null && r0 != null && series?.termDays ? lockedApr(Number(formatYocto(priceYocto, 8)), r0, series.termDays, depositFeeBps) : null
  const proceeds = buyCost(qtyYocto ?? 0n, priceYocto ?? 0n, series?.marketFeeBps ?? MARKET_FEE_BPS).cost
  const expiries = useMemo(() => listingExpiryOptions(now, series?.maturityMs), [now, series?.maturityMs])
  const expiry = expiries.find((o) => o.key === expiryKey) ?? expiries.find((o) => o.key === '7') ?? expiries.at(-1) ?? null
  // Pre-fill "sell everything" once the YT balance is known.
  useEffect(() => {
    if (balances?.yt != null && balances.yt > 0n) setQuantity((q) => q || formatYoctoInput(balances.yt!))
  }, [balances?.yt])
  const list = async () => {
    if (live && !isConnected) return void connect()
    if (balances?.yt == null || balances.yt === 0n) return push('You have no YT in this series yet. Deposit first.')
    if (qtyYocto === null || qtyYocto > balances.yt) return push(`Enter a quantity up to ${formatYocto(balances.yt, 4)} YT.`)
    if (priceYocto === null) return push('Enter a price per YT.')
    if (!expiry) return push('This series has matured, so its YT can no longer be listed.')
    if (!live) {
      if (await listTx.simulate()) push('Demo listing published.', 'success')
      return
    }
    const hash = await listTx.execute(buildCreateListingTx({ quantityYocto: qtyYocto.toString(), unitPriceYocto: priceYocto.toString(), expiresAtNanos: msToNanos(expiry.ms) }))
    if (hash) push('Listing sent. It shows on Buy YT once it confirms.', 'success')
  }

  const fmt = (v: bigint | null | undefined, digits = 4) => (v == null ? (isConnected || !live ? '…' : '—') : formatYocto(v, digits))
  const seriesName = series ? `${tenorLabel(series)} · ${series.id}` : 'this series'

  return (
    <div className="earn-page">
      <div className="page-header earn-header">
        <div>
          <h1>Deposit &amp; sell yield</h1>
          <p>Turn stNEAR into PT + YT, then sell the YT for NEAR now. Three steps, one page.</p>
        </div>
      </div>

      <DemoBanner />

      <section className="earn-card" aria-labelledby="earn-series-title">
        <h2 id="earn-series-title" className="earn-card-title">
          Series
        </h2>
        {choices.length === 0 ? (
          <p className="earn-muted">{all.loading ? 'Reading the series…' : 'No series is open for deposits right now.'}</p>
        ) : (
          <div className="earn-series" role="radiogroup" aria-label="Series">
            {choices.map(({ contractId, display: d }) => (
              <button key={contractId} type="button" role="radio" aria-checked={contractId === active} className={`earn-series-option ${contractId === active ? 'is-on' : ''}`} onClick={() => chooseSeries(contractId)}>
                <strong>{tenorLabel(d)}</strong>
                <span>{d.id}</span>
                <small>{d.depositsOpen ? `Deposits close in ${countdown(d.cutoffMs)}` : 'Deposits closed'}</small>
                <small>Matures {formatDate(d.maturityMs)}</small>
              </button>
            ))}
          </div>
        )}
        {live && isConnected && balances && (
          <div className="earn-wallet">
            <span>Your wallet</span>
            <strong>{fmt(balances.near, 2)} NEAR</strong>
            <strong>{fmt(balances.stNear)} stNEAR</strong>
            <span>
              <TokenBadge kind="PT" size="sm" /> {fmt(balances.pt)}
            </span>
            <span>
              <TokenBadge kind="YT" size="sm" /> {fmt(balances.yt)}
            </span>
          </div>
        )}
        {live && !isConnected && (
          <div className="earn-connect">
            <span>Connect a wallet to see your balances and sign.</span>
            <Button size="sm" onClick={() => void connect()}>
              Connect wallet <ArrowRight size={13} aria-hidden />
            </Button>
          </div>
        )}
      </section>

      <ol className="earn-steps">
        <Step
          n={1}
          title="Get stNEAR"
          open={openStep === 'stake'}
          onOpen={() => setPicked('stake')}
          done={hasStNear || hasYt}
          summary={balances?.stNear != null ? `${formatYocto(balances.stNear, 4)} stNEAR in your wallet` : 'Stake NEAR with Meta Pool'}
        >
          <p className="earn-lead">Stake NEAR with Meta Pool. You get stNEAR back, which keeps earning staking rewards.</p>
          <AmountField
            id="stake-amount"
            label="NEAR to stake"
            unit="NEAR"
            value={stakeAmount}
            onChange={setStakeAmount}
            onMax={stakeMax != null ? () => setStakeAmount(formatYoctoInput(stakeMax)) : undefined}
            disabled={stakeTx.phase !== 'idle' || zapTx.phase !== 'idle'}
          />
          {canZap && (
            <label className="earn-check earn-zap">
              <input type="checkbox" checked={zap} onChange={(e) => setZap(e.target.checked)} disabled={stakeTx.phase !== 'idle' || zapTx.phase !== 'idle'} />
              <span>
                <strong>Also deposit it into {seriesName}</strong> — stake and deposit in one transaction, one signature. If the transaction fails, nothing is
                staked; if the series refuses the deposit, the new stNEAR stays in your wallet.
              </span>
            </label>
          )}
          {zapping ? (
            <>
              <div className="earn-receive" aria-live="polite">
                <span>You receive ≈</span>
                <span>
                  <TokenBadge kind="PT" size="sm" /> <strong>{formatYocto(zapPreview.pt, 4)}</strong>
                </span>
                <span>
                  <TokenBadge kind="YT" size="sm" /> <strong>{formatYocto(zapPreview.yt, 4)}</strong>
                </span>
              </div>
              <small className="earn-hint">
                Minimum 1 NEAR{rate ? ` · 1 stNEAR = ${rate.toFixed(4)} NEAR` : ''} · {formatBps(feeBps)} deposit fee · 0.01% of the stNEAR stays in your wallet as a
                price buffer
              </small>
              <label className="earn-check">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <span>
                  I understand PT is not principal-protected and YT pays nothing if the stNEAR rate doesn’t rise.{' '}
                  <Link to="/docs#risks">Risks</Link>
                </span>
              </label>
            </>
          ) : (
            <p className="earn-result">
              <span>
                You get ≈ <strong>{stakeYocto != null && rate ? (Number(formatYocto(stakeYocto, 6)) / rate).toFixed(4) : '—'} stNEAR</strong>
              </span>
              <small>Minimum 1 NEAR{rate ? ` · 1 stNEAR = ${rate.toFixed(4)} NEAR` : ''}</small>
            </p>
          )}
          <TxFeedback tx={stakeTx} failedTitle="Staking failed" successTitle="stNEAR received" />
          <TxFeedback tx={zapTx} failedTitle="Stake and deposit failed" successTitle="PT and YT received" />
          {stakeTx.phase === 'idle' && zapTx.phase === 'idle' && (
            <div className="earn-actions">
              {zapping ? (
                <Button onClick={stakeAndDeposit}>{isConnected || !live ? 'Stake & deposit' : 'Connect wallet'}</Button>
              ) : (
                <Button onClick={stake}>{isConnected || !live ? 'Stake NEAR' : 'Connect wallet'}</Button>
              )}
              <button type="button" className="earn-skip" onClick={() => setPicked('deposit')}>
                I already have stNEAR <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          )}
        </Step>

        <Step
          n={2}
          title="Deposit stNEAR"
          open={openStep === 'deposit'}
          onOpen={() => setPicked('deposit')}
          done={(balances?.pt ?? 0n) > 0n}
          summary={(balances?.pt ?? 0n) > 0n ? `You hold ${formatYocto(balances!.pt!, 4)} PT in ${seriesName}` : `Receive PT + YT in ${seriesName}`}
        >
          {series && !series.depositsOpen ? (
            <p className="earn-note earn-note-warn">
              {series.id} stopped taking deposits on {series.cutoffLabel}. Pick a series above whose deposits are still open.
            </p>
          ) : (
            <>
              <p className="earn-lead">
                Your stNEAR stays in the {seriesName} contract until {series?.maturityExactLabel ?? 'maturity'}. You get one PT and one YT per stNEAR, minus a{' '}
                {formatBps(feeBps)} fee.
              </p>
              <AmountField
                id="deposit-amount"
                label="stNEAR to deposit"
                unit="stNEAR"
                value={depositAmount}
                onChange={setDepositAmount}
                onMax={balances?.stNear ? () => setDepositAmount(formatYoctoInput(balances.stNear!)) : undefined}
                hint={`Available ${fmt(balances?.stNear)} stNEAR · minimum ${formatYoctoInput(minDeposit)}`}
                disabled={depositTx.phase !== 'idle'}
              />
              <div className="earn-receive" aria-live="polite">
                <span>You receive</span>
                <span>
                  <TokenBadge kind="PT" size="sm" /> <strong>{formatYocto(preview.pt, 4)}</strong>
                </span>
                <span>
                  <TokenBadge kind="YT" size="sm" /> <strong>{formatYocto(preview.yt, 4)}</strong>
                </span>
              </div>
              <label className="earn-check">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
                <span>
                  I understand PT is not principal-protected and YT pays nothing if the stNEAR rate doesn’t rise.{' '}
                  <Link to="/docs#risks">Risks</Link>
                </span>
              </label>
              <TxFeedback tx={depositTx} failedTitle="Deposit failed" successTitle="PT and YT received" />
              {depositTx.phase === 'idle' && (
                <div className="earn-actions">
                  <Button onClick={deposit}>{isConnected || !live ? 'Deposit' : 'Connect wallet'}</Button>
                </div>
              )}
            </>
          )}
        </Step>

        <Step
          n={3}
          title="Sell your YT"
          optional
          open={openStep === 'sell'}
          onOpen={() => setPicked('sell')}
          done={listTx.phase === 'confirmed'}
          summary={hasYt ? `${formatYocto(balances!.yt!, 4)} YT ready to sell` : 'Get NEAR now for your future yield'}
        >
          {!hasYt && listTx.phase !== 'confirmed' ? (
            <p className="earn-note">You don’t hold YT in {seriesName} yet. Deposit first, or switch to a series where you hold YT.</p>
          ) : expiries.length === 0 ? (
            <p className="earn-note earn-note-warn">{series?.id} has matured, so its YT can no longer be listed. Redeem it from Portfolio.</p>
          ) : (
            <>
              <p className="earn-lead">
                Selling YT locks in your return now: buyers pay you NEAR, and you keep the PT, which redeems your principal after{' '}
                {series?.maturityLabel ?? 'maturity'}.
              </p>
              <div className="earn-grid">
                <AmountField
                  id="sell-qty"
                  label="YT to sell"
                  unit="YT"
                  value={quantity}
                  onChange={setQuantity}
                  onMax={balances?.yt ? () => setQuantity(formatYoctoInput(balances.yt!)) : undefined}
                  hint={`You hold ${fmt(balances?.yt)} YT`}
                  disabled={listTx.phase !== 'idle'}
                />
                <AmountField
                  id="sell-price"
                  label="Price per YT"
                  unit="NEAR"
                  value={price}
                  onChange={setPrice}
                  hint={
                    suggested != null ? (
                      <>
                        Fair value ≈ {suggested.toFixed(4)} at {staking.aprPercent.toFixed(1)}% ({staking.label}){' '}
                        <button type="button" className="earn-inline" onClick={() => setPrice(suggested.toFixed(4))}>
                          Use
                        </button>
                      </>
                    ) : undefined
                  }
                  disabled={listTx.phase !== 'idle'}
                />
              </div>
              <div className="earn-field">
                <span className="earn-field-label">Listing open for</span>
                <div className="earn-chips" role="radiogroup" aria-label="Listing expiry">
                  {expiries.map((o) => (
                    <button key={o.key} type="button" role="radio" aria-checked={o.key === expiry?.key} className={o.key === expiry?.key ? 'is-on' : undefined} onClick={() => setExpiryKey(o.key)} disabled={listTx.phase !== 'idle'}>
                      {o.days === null ? 'Until maturity' : `${o.days} day${o.days === 1 ? '' : 's'}`}
                    </button>
                  ))}
                </div>
                <small className="earn-hint">Ends {expiry ? formatDate(expiry.ms) : '—'} · cancel any time from Portfolio</small>
              </div>
              <p className="earn-result">
                <span>
                  You receive <strong>{formatYocto(proceeds, 4)} NEAR</strong> when it’s fully bought
                </span>
                {locked != null && (
                  <span className="earn-lock">
                    Deposit and sell all your YT at this price and you lock in <strong>{locked.toFixed(2)}% APR</strong> until {series?.maturityLabel ?? 'maturity'}, after the{' '}
                    {formatBps(depositFeeBps)} deposit fee. It is fixed in NEAR, not in dollars, and holds while the stNEAR rate does not fall · staking pays about{' '}
                    {staking.aprPercent.toFixed(1)}% today, variable ({staking.label})
                  </span>
                )}
                <small>Buyers pay the {formatBps(series?.marketFeeBps ?? MARKET_FEE_BPS)} market fee · partial buys are paid as they happen</small>
              </p>
              <TxFeedback
                tx={listTx}
                failedTitle="Listing failed"
                successTitle="Your YT is listed"
                successBody="Buyers can see it on Buy YT now. You are paid in NEAR the moment someone buys."
                successAction={
                  <button onClick={() => navigate(withSeries('/marketplace', active))}>
                    See it on Buy YT <ArrowRight size={14} aria-hidden />
                  </button>
                }
              />
              {listTx.phase === 'idle' && (
                <div className="earn-actions">
                  <Button onClick={list}>{isConnected || !live ? 'List YT for sale' : 'Connect wallet'}</Button>
                  <button type="button" className="earn-skip" onClick={() => navigate('/portfolio')}>
                    Keep my YT instead <ArrowRight size={13} aria-hidden />
                  </button>
                </div>
              )}
            </>
          )}
        </Step>
      </ol>

      <p className="earn-footnote">
        New to PT and YT? <Link to="/docs#tokens">How it works</Link> · Payouts are in stNEAR from {live ? cfg.stNearContractId : 'Meta Pool'}.
      </p>
    </div>
  )
}

function Step({
  n,
  title,
  open,
  onOpen,
  done,
  optional = false,
  summary,
  children,
}: {
  n: number
  title: string
  open: boolean
  onOpen: () => void
  done: boolean
  optional?: boolean
  summary: string
  children: ReactNode
}) {
  return (
    <li className={`earn-step ${open ? 'is-open' : ''} ${done ? 'is-done' : ''}`}>
      <button type="button" className="earn-step-head" onClick={onOpen} aria-expanded={open}>
        <span className="earn-step-n" aria-hidden>
          {done && !open ? <Check size={14} /> : n}
        </span>
        <span className="earn-step-title">
          <strong>
            {title}
            {optional && <em>Optional</em>}
          </strong>
          {!open && <small>{summary}</small>}
        </span>
      </button>
      {open && <div className="earn-step-body">{children}</div>}
    </li>
  )
}

function AmountField({
  id,
  label,
  unit,
  value,
  onChange,
  onMax,
  hint,
  disabled,
}: {
  id: string
  label: string
  unit: string
  value: string
  onChange: (v: string) => void
  onMax?: () => void
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="earn-field">
      <label className="earn-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="earn-input">
        <input id={id} inputMode="decimal" placeholder="0.0" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
        <span>{unit}</span>
        {onMax && (
          <button type="button" onClick={onMax} disabled={disabled}>
            Max
          </button>
        )}
      </div>
      {hint && <small className="earn-hint">{hint}</small>}
    </div>
  )
}
