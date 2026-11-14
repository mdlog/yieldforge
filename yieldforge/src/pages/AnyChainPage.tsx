import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { Button, TokenBadge, TxFeedback } from '@/components/ui'
import { AssetPicker } from '@/components/intents/AssetPicker'
import { FundsTracker } from '@/components/intents/FundsTracker'
import { useWallet } from '@/contexts/WalletContext'
import { useToast } from '@/contexts/ToastContext'
import { useSeries } from '@/contexts/SeriesContext'
import { getNearConfig } from '@/lib/near/config'
import { getNearBalance, isLiveMode, viewCall } from '@/lib/near/wallet'
import { needsStorageDeposit, storageMinimum } from '@/lib/near/tx'
import { ftTransferCallUsed, panicMessage } from '@/lib/near/outcome'
import { buildDepositTx, fetchRefund } from '@/lib/contracts/series'
import { RefundClaim } from '@/components/RefundClaim'
import { buildBuyTx, isBuyable, toUiListing } from '@/lib/contracts/marketplace'
import {
  NEAR_DECIMALS,
  STNEAR_ASSET_ID,
  WNEAR_ASSET_ID,
  asPreview,
  buildBuyYtQuoteRequest,
  buildCashOutNearTx,
  buildCashOutQuoteRequest,
  buildCashOutTx,
  buildDepositQuoteRequest,
  buildUnwrapAndBuyPlan,
  buildUnwrapTx,
  expressCheck,
  fromAtomic,
  looksLikeAddress,
  roundTripEstimate,
  toAtomic,
  trackerState,
  type OneClickToken,
  type Quote,
  type QuoteRequest,
} from '@/lib/intents/flows'
import { chainLabel, fetchTokens, getQuote, submitDepositTx } from '@/lib/intents/oneclick'
import { loadSwaps, removeSwap, saveSwap, subscribeSwaps, type SwapFlow, type SwapRecord } from '@/lib/intents/swapStore'
import { useTx, type OutcomeCheck } from '@/hooks/useTx'
import { useLiveListings, useLiveSeries, useStNearBalance, useStNearPrice } from '@/hooks/useLiveData'
import { useSeriesDisplay } from '@/hooks/useSeriesDisplay'
import { useStakingApr } from '@/hooks/useStakingApr'
import { useNearQuery } from '@/hooks/useNearQuery'
import { buyCost, formatBps, previewDeposit } from '@/utils/math'
import { formatYocto, formatYoctoInput, parseNear, shorten } from '@/utils/format'

type Tab = SwapFlow
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'buy-yt', label: 'Buy YT' },
  { id: 'cash-out', label: 'Cash out' },
]
/** Native NEAR kept back for the buy transaction's gas after unwrapping. */
const BUY_GAS_RESERVE_YOCTO = 5n * 10n ** 21n
/** Native NEAR kept back when cashing out NEAR: gas plus two wrap.near storage registrations. */
const CASH_OUT_NEAR_RESERVE_YOCTO = 5n * 10n ** 22n

/** 1Click only routes on NEAR mainnet. Elsewhere the page prices routes (dry quotes) but sends nothing. */
function useIntentsLive(): boolean {
  return isLiveMode() && getNearConfig().network === 'mainnet'
}

function wnearContract(): string {
  return getNearConfig().network === 'mainnet' ? 'wrap.near' : 'wrap.testnet'
}

function useTokens() {
  const [tokens, setTokens] = useState<OneClickToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    fetchTokens()
      .then((t) => !off && setTokens(t))
      .catch((e: unknown) => !off && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      off = true
    }
  }, [])
  return { tokens, error }
}

/** A dry quote for `req`, refreshed 500 ms after the inputs settle and every 30 s after that. */
function useDryQuote(req: QuoteRequest | null) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // The deadline changes on every render; it doesn't change the price.
  const key = req ? JSON.stringify({ ...req, deadline: undefined }) : null
  useEffect(() => {
    if (!req) {
      setQuote(null)
      setError(null)
      return
    }
    let off = false
    let timer: number | undefined
    const run = async () => {
      setLoading(true)
      try {
        const res = await getQuote({ ...req, deadline: new Date(Date.now() + 3_600_000).toISOString() })
        if (!off) {
          setQuote(res.quote)
          setError(null)
        }
      } catch (e) {
        if (!off) {
          setQuote(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!off) setLoading(false)
      }
      if (!off) timer = window.setTimeout(run, 30_000)
    }
    timer = window.setTimeout(run, 500)
    return () => {
      off = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { quote, error, loading }
}

function useSwaps(): SwapRecord[] {
  const [list, setList] = useState<SwapRecord[]>(() => loadSwaps())
  useEffect(() => subscribeSwaps(setList), [])
  return list
}

const NEW = '__new__'

/** A swap the open tab should keep showing: still moving, or delivered but waiting for the user's NEAR step. */
function needsAttention(s: SwapRecord, now = Date.now()): boolean {
  const st = trackerState(s.status)
  if (st.terminal) return s.status === 'SUCCESS' && !s.finishedTx && (s.flow === 'buy-yt' || (s.flow === 'deposit' && s.mode === 'standard'))
  // A quote nobody funded: 1Click keeps it at PENDING_DEPOSIT after the deadline.
  const stale = (s.status === 'PENDING_DEPOSIT' || !s.status) && s.deadline != null && Date.parse(s.deadline) + 3_600_000 < now
  return !stale
}

function usd(v: string | number | undefined): string {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
}

function fmtToken(atomic: string | bigint | undefined, decimals: number, frac = 4): string {
  return atomic == null ? '—' : fromAtomic(BigInt(atomic), decimals, frac)
}

export default function AnyChainPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'deposit') as Tab
  const intentsLive = useIntentsLive()
  const cfg = getNearConfig()
  const { tokens, error: tokensError } = useTokens()
  const swaps = useSwaps()
  const { accountId } = useWallet()
  const [focus, setFocus] = useState<string | null>(null)

  const setTab = (id: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
    setFocus(null)
  }
  const mine = swaps.filter((s) => s.network === cfg.network && (!accountId || s.accountId === accountId))
  // The swap the open tab is following: the one picked from the history, else the newest unfinished one of this flow.
  const current = focus === NEW ? undefined : (mine.find((s) => s.depositAddress === focus && s.flow === tab) ?? mine.find((s) => s.flow === tab && needsAttention(s)))

  return (
    <div className="page-wrap earn-page ac-page">
      <header className="ac-head">
        <h1 className="ac-title">From any chain</h1>
        <p className="earn-lead">Use USDC, ETH, BTC, SOL and 200+ other assets from 25+ chains, and cash out to any of them. NEAR Intents handles the routing.</p>
        {!intentsLive && (
          <p className="ac-preview">
            <span className="ac-preview-dot" aria-hidden />
            <span>
              Preview on {isLiveMode() ? cfg.network : 'demo data'}: live mainnet quotes, nothing is sent. Swaps run on mainnet.
            </span>
          </p>
        )}
      </header>

      {tokensError && <p className="earn-note earn-note-warn">Could not load the asset list from NEAR Intents: {tokensError}</p>}

      <div className="ac-tabs" role="tablist" aria-label="Flow">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <section className="earn-card ac-card" role="tabpanel">
        {current && (
          <button type="button" className="earn-skip ac-new" onClick={() => setFocus(NEW)}>
            {tab === 'deposit' ? 'New deposit' : tab === 'buy-yt' ? 'New YT purchase' : 'New cash-out'} <ArrowRight size={13} aria-hidden />
          </button>
        )}
        {tab === 'deposit' && <DepositFlow tokens={tokens} intentsLive={intentsLive} current={current} onStarted={setFocus} />}
        {tab === 'buy-yt' && <BuyYtFlow tokens={tokens} intentsLive={intentsLive} current={current} onStarted={setFocus} />}
        {tab === 'cash-out' && <CashOutFlow tokens={tokens} intentsLive={intentsLive} current={current} onStarted={setFocus} />}
      </section>

      {mine.length > 0 && (
        <section className="earn-card">
          <h2 className="earn-card-title">Recent swaps in this browser</h2>
          <ul className="ac-history">
            {mine.map((s) => {
              const st = trackerState(s.status)
              return (
                <li key={s.depositAddress}>
                  <span className={`ac-dot ac-tone-${st.tone}`} aria-hidden />
                  <span className="ac-history-main">
                    <span>
                      <strong>{TABS.find((t) => t.id === s.flow)?.label}</strong> · {s.sendLabel} → {s.receiveLabel}
                    </span>
                    <small>
                      {new Date(s.createdAt).toLocaleString()} · {s.status || 'quoted'} · {shorten(s.depositAddress, 8, 6)}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="earn-inline"
                    onClick={() => {
                      setTab(s.flow)
                      setFocus(s.depositAddress)
                    }}
                  >
                    Track
                  </button>
                  {(st.terminal || !needsAttention(s)) && (
                    <button type="button" className="earn-inline" onClick={() => removeSwap(s.depositAddress)}>
                      Hide
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <details className="buy-details ac-facts">
        <summary>Before you send</summary>
        <ul>
          <li>
            <strong>The fixed rate is in NEAR terms.</strong> Your USDC becomes stNEAR. Selling the YT locks the stNEAR-to-NEAR return, not a dollar return; until you cash
            out, you hold NEAR price exposure.
          </li>
          <li>
            <strong>Costs.</strong> 1Click charges 0.2% plus the solver's spread, and some routes add a withdrawal fee. Quotes include them; origin-chain gas is extra. Coming in
            and cashing out each cost about that much, so on a short term a small position can lose more on the round trip than the yield pays.
          </li>
          <li>
            <strong>YT sales pay NEAR, redemptions pay stNEAR.</strong> Cash out either one from the Cash out tab.
          </li>
          <li>
            <strong>Refunds.</strong> A swap that can't be filled before its deadline is refunded to your refund address (cash-outs: to your NEAR wallet).
          </li>
          <li>
            <strong>Express delivery</strong> sends the stNEAR straight into the series. The app offers it only when the series should accept it (open long enough, room under
            the deposit cap, above the minimum); otherwise it uses Standard. If the series still refuses it, the stNEAR is held for your NEAR account and you claim it in
            Portfolio. 1Click marks this feature experimental.
          </li>
        </ul>
      </details>
    </div>
  )
}

// ---- Shared pieces --------------------------------------------------------------------------

function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="earn-field">
      <label className="earn-field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <small className="earn-hint">{hint}</small>}
    </div>
  )
}

/** One side of the swap: a label row (with an optional note on the right) over an amount and its asset. */
function SwapBox({ label, htmlFor, aside, children }: { label: string; htmlFor?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="ac-box">
      <div className="ac-box-head">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {aside ? <span className="ac-box-aside">{aside}</span> : null}
      </div>
      <div className="ac-box-main">{children}</div>
    </div>
  )
}

function SwapArrow() {
  return (
    <div className="ac-swap-arrow" aria-hidden>
      <ArrowDown size={14} />
    </div>
  )
}

function AmountField({ id, value, onChange, disabled, placeholder = '0' }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return <input id={id} className="ac-amount" inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
}

/** A quoted amount: read-only, dimmed while a fresh quote loads. */
function QuotedAmount({ loading, className = '', children }: { loading: boolean; className?: string; children: ReactNode }) {
  return (
    <output className={`ac-amount ac-amount-out ${className} ${loading ? 'is-loading' : ''}`} aria-live="polite" aria-busy={loading}>
      {children}
    </output>
  )
}

function MaxButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="earn-inline" onClick={onClick} disabled={disabled}>
      Max
    </button>
  )
}

/** Quote details, folded: the summary line stays visible, the rows open on demand. */
function QuoteDetails({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="ac-details">
      <summary>
        <span>{summary}</span>
        <span className="ac-details-toggle">Details</span>
      </summary>
      <dl className="ac-dl">{children}</dl>
    </details>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function eta(q: Quote | null): string | null {
  return q?.timeEstimate ? `~${Math.max(1, Math.round(q.timeEstimate / 60))} min` : null
}

const trim4 = (s: string) => s.replace(/(\.\d{4})\d+$/, '$1')

/** The folded details' summary: the parts that are known, joined, starting with a capital. */
function summaryLine(...parts: Array<string | null>): string {
  const line = parts.filter(Boolean).join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

function AddressInput({ id, value, onChange, chain, placeholder, disabled }: { id: string; value: string; onChange: (v: string) => void; chain: string; placeholder: string; disabled?: boolean }) {
  const bad = value.trim() !== '' && !looksLikeAddress(chain, value)
  return (
    <>
      <div className={`earn-input ac-address-input ${bad ? 'is-bad' : ''}`}>
        <input id={id} spellCheck={false} autoComplete="off" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value.trim())} disabled={disabled} aria-invalid={bad} />
      </div>
      {bad && <small className="ac-error">That doesn't look like a {chainLabel(chain)} address.</small>}
    </>
  )
}

function StartButton({ intentsLive, ready, busy, onClick, children }: { intentsLive: boolean; ready: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  const { isConnected, connect } = useWallet()
  if (!intentsLive) {
    return (
      <Button disabled title="NEAR Intents settles on mainnet only">
        {children} · mainnet only
      </Button>
    )
  }
  if (!isConnected) return <Button onClick={() => void connect()}>Connect NEAR wallet</Button>
  return (
    <Button onClick={onClick} disabled={!ready || busy}>
      {busy ? 'Getting a deposit address…' : children}
    </Button>
  )
}

const defaultOrigin = (tokens: OneClickToken[] | null) => tokens?.find((t) => t.blockchain === 'arb' && t.symbol === 'USDC') ?? tokens?.find((t) => t.blockchain !== 'near') ?? null

// ---- Flow 1: deposit from any chain ---------------------------------------------------------

function DepositFlow({ tokens, intentsLive, current, onStarted }: { tokens: OneClickToken[] | null; intentsLive: boolean; current?: SwapRecord; onStarted: (a: string) => void }) {
  const cfg = getNearConfig()
  const { accountId, isConnected } = useWallet()
  const { push } = useToast()
  const { active, select } = useSeries()
  const { display: series } = useSeriesDisplay()
  const raw = useLiveSeries().data
  const price = useStNearPrice().data
  const [picked, setPicked] = useState<OneClickToken | null>(null)
  const token = picked ?? defaultOrigin(tokens)
  const [amount, setAmount] = useState('25')
  const [refund, setRefund] = useState('')
  const [mode, setMode] = useState<'express' | 'standard'>('express')
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState(false)

  const atomic = token ? toAtomic(amount, token.decimals) : null
  const previewReq = useMemo(
    () =>
      token && atomic
        ? asPreview(buildDepositQuoteRequest({ originAsset: token.assetId, amountAtomic: atomic, refundTo: '', accountId: 'wrap.near', seriesContractId: cfg.seriesContractId, mode: 'standard', dry: true, now: Date.now() }))
        : null,
    [token, atomic, cfg.seriesContractId],
  )
  const preview = useDryQuote(previewReq)
  const stOut = preview.quote ? BigInt(preview.quote.amountOut) : null
  const feeBps = series?.depositFeeBps ?? 25n
  const minted = previewDeposit(stOut ?? 0n, feeBps)
  // NEAR per stNEAR. On mainnet, Meta Pool's own rate; in preview mode the app's chain is testnet, whose Meta Pool
  // rate has nothing to do with the mainnet stNEAR being quoted, so use the 1Click price ratio instead.
  const stTok = tokens?.find((t) => t.assetId === STNEAR_ASSET_ID)
  const wTok = tokens?.find((t) => t.assetId === WNEAR_ASSET_ID)
  const rate = intentsLive && price ? Number(BigInt(price) / 10n ** 16n) / 1e8 : stTok?.price && wTok?.price ? stTok.price / wTok.price : null

  const check = useMemo(() => {
    if (!series || !preview.quote) return null
    return expressCheck({
      series: {
        depositsOpen: series.depositsOpen,
        depositsCloseAtMs: series.cutoffMs,
        capRemainingYocto: raw?.depositCapRemaining != null ? BigInt(raw.depositCapRemaining) : null,
        minDepositYocto: series.minDepositYocto,
        paused: raw?.paused === true,
      },
      quote: preview.quote,
      now: Date.now(),
    })
  }, [series, raw, preview.quote])
  const effective = mode === 'express' && check?.ok ? 'express' : 'standard'
  const refundOk = token ? looksLikeAddress(token.blockchain, refund) : false
  // What coming in and going back out costs, next to what the series term earns at today's APR.
  const staking = useStakingApr()
  const roundTrip = preview.quote
    ? roundTripEstimate({
        usdIn: Number(preview.quote.amountInUsd ?? 0),
        usdOut: Number(preview.quote.amountOutUsd ?? 0),
        depositFeeBps: feeBps,
        aprPercent: staking.aprPercent,
        termDays: series?.termDays ?? 0,
      })
    : null

  const start = async () => {
    if (!token || !atomic || !accountId) return
    if (!series?.depositsOpen) return push('This series no longer takes deposits. Pick an open series on Deposit & sell.')
    if (!refundOk) return push(`Enter your ${chainLabel(token.blockchain)} address for refunds.`)
    if (!ack) return push('Tick the box to confirm you understand the risks.')
    setBusy(true)
    try {
      const req = buildDepositQuoteRequest({ originAsset: token.assetId, amountAtomic: atomic, refundTo: refund, accountId, seriesContractId: cfg.seriesContractId, mode: effective, dry: false, now: Date.now() })
      const { quote } = await getQuote(req)
      if (!quote.depositAddress) throw new Error('NEAR Intents returned no deposit address. Try again.')
      if (effective === 'express' && series) {
        const again = expressCheck({
          series: { depositsOpen: series.depositsOpen, depositsCloseAtMs: series.cutoffMs, capRemainingYocto: raw?.depositCapRemaining != null ? BigInt(raw.depositCapRemaining) : null, minDepositYocto: series.minDepositYocto, paused: raw?.paused === true },
          quote,
          now: Date.now(),
        })
        if (!again.ok) {
          setMode('standard')
          throw new Error(`Express is not safe for this quote (${again.reasons.join(' ')}). Switched to Standard; get a new address.`)
        }
      }
      saveSwap({
        flow: 'deposit',
        network: cfg.network,
        accountId,
        depositAddress: quote.depositAddress,
        createdAt: Date.now(),
        status: 'PENDING_DEPOSIT',
        sendLabel: `${quote.amountInFormatted} ${token.symbol} on ${chainLabel(token.blockchain)}`,
        receiveLabel: `≈ ${fmtToken(quote.amountOut, NEAR_DECIMALS)} stNEAR → PT + YT`,
        amountIn: quote.amountIn,
        amountInFormatted: quote.amountInFormatted,
        originSymbol: token.symbol,
        originChain: token.blockchain,
        deadline: quote.deadline ?? req.deadline,
        mode: effective,
        seriesContract: cfg.seriesContractId,
      })
      onStarted(quote.depositAddress)
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'warning')
    } finally {
      setBusy(false)
    }
  }

  if (current) return <DepositTracker rec={current} active={active} select={select} />

  const usdIn = token?.price && atomic ? usd(Number(amount.replace(',', '.')) * token.price) : ''
  const nearOut = rate && stOut != null ? ` ≈ ${(Number(fromAtomic(stOut, NEAR_DECIMALS, 6)) * rate).toFixed(3)} NEAR` : ''

  return (
    <div className="ac-flow">
      <div className="ac-swap">
        <SwapBox label="You pay" htmlFor="dep-amount" aside={usdIn ? `≈ ${usdIn}` : null}>
          <AmountField id="dep-amount" value={amount} onChange={setAmount} disabled={busy} />
          <AssetPicker id="dep-asset" label="Pay with" tokens={tokens} value={token} onChange={setPicked} excludeChains={['near']} disabled={busy} />
        </SwapBox>
        <SwapArrow />
        <SwapBox label="You get" aside={stOut != null ? `${fmtToken(stOut, NEAR_DECIMALS)} stNEAR${nearOut}` : null}>
          <QuotedAmount loading={preview.loading} className="ac-get">
            <span className="ac-get-item">
              <TokenBadge kind="PT" size="sm" />
              {stOut != null ? formatYocto(minted.pt, 4) : '—'}
            </span>
            <span className="ac-plus">+</span>
            <span className="ac-get-item">
              <TokenBadge kind="YT" size="sm" />
              {stOut != null ? formatYocto(minted.yt, 4) : '—'}
            </span>
          </QuotedAmount>
        </SwapBox>
      </div>
      {preview.error && <p className="earn-note earn-note-warn">{preview.error}</p>}
      {roundTrip?.costsMoreThanYield && series?.termDays ? (
        <p className="earn-note earn-note-warn ac-warn">
          Moving in and out costs about {roundTrip.roundTripPct.toFixed(2)}%, more than this {series.termDays}-day term earns ({roundTrip.termYieldPct.toFixed(2)}%). It pays off
          over several terms.
        </p>
      ) : null}

      <QuoteDetails summary={summaryLine(eta(preview.quote), effective === 'express' ? 'Express delivery' : 'Standard delivery', 'fees included')}>
        <Row k="Series">{series?.name ?? cfg.seriesContractId}</Row>
        <Row k="Minimum received">{preview.quote ? `${fmtToken(preview.quote.minAmountOut, NEAR_DECIMALS)} stNEAR (1% slippage)` : '—'}</Row>
        <Row k="Fees">1Click fee included · {formatBps(feeBps)} series deposit fee</Row>
        {roundTrip && series?.termDays ? (
          <Row k="Round trip">
            ≈ {roundTrip.roundTripPct.toFixed(2)}%: {roundTrip.entryPct.toFixed(2)}% in, about the same out, plus the deposit fee. The {series.termDays}-day term earns ≈{' '}
            {roundTrip.termYieldPct.toFixed(2)}% at {staking.aprPercent.toFixed(1)}% staking APR.
          </Row>
        ) : null}
        <Row k="Delivery">
          <div className="ac-stack">
            <div className="earn-chips" role="radiogroup" aria-label="Delivery mode">
              <button type="button" role="radio" aria-checked={mode === 'express'} className={mode === 'express' ? 'is-on' : undefined} onClick={() => setMode('express')} disabled={busy}>
                Express
              </button>
              <button type="button" role="radio" aria-checked={mode === 'standard'} className={mode === 'standard' ? 'is-on' : undefined} onClick={() => setMode('standard')} disabled={busy}>
                Standard
              </button>
            </div>
            <span>
              {mode === 'express'
                ? check && !check.ok
                  ? `Express unavailable: ${check.reasons.join(' ')} Standard will be used.`
                  : 'Straight into the series in one origin-chain transaction; PT + YT are minted to your NEAR account.'
                : 'The stNEAR lands in your NEAR wallet and you sign the deposit on NEAR. Works even if the series closes meanwhile.'}
            </span>
          </div>
        </Row>
        <Row k="PT + YT go to">
          {isConnected ? accountId : 'your connected NEAR account'}. Keep both for leveraged yield, or <Link to="/earn?step=sell">sell the YT</Link> to lock a fixed rate.
        </Row>
      </QuoteDetails>

      <Field id="dep-refund" label={`Refund address${token ? ` on ${chainLabel(token.blockchain)}` : ''}`}>
        <AddressInput id="dep-refund" value={refund} onChange={setRefund} chain={token?.blockchain ?? ''} placeholder="Used if the swap can't be filled" disabled={busy} />
      </Field>
      <label className="earn-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I understand PT isn't principal-protected, YT can pay nothing, and the position is in NEAR terms. <Link to="/docs#risks">Risks</Link>
        </span>
      </label>
      <div className="earn-actions">
        <StartButton intentsLive={intentsLive} ready={!!atomic && refundOk && !!preview.quote} busy={busy} onClick={() => void start()}>
          Get deposit address
        </StartButton>
      </div>
    </div>
  )
}

function DepositTracker({ rec, active, select }: { rec: SwapRecord; active: string; select: (id: string) => void }) {
  const { accountId } = useWallet()
  const depositTx = useTx()
  const stNear = useStNearBalance(accountId)
  const delivered = rec.amountOut ? BigInt(rec.amountOut) : null
  const wallet = stNear.data != null ? BigInt(stNear.data) : null
  const amount = delivered != null && wallet != null ? (wallet < delivered ? wallet : delivered) : null
  const success = rec.status === 'SUCCESS'
  const wrongSeries = rec.seriesContract && rec.seriesContract !== active
  // Express: a delivery the series refused (closed, paused, full, under the minimum) is held as a refund.
  const held = useNearQuery(
    async () => (rec.mode === 'express' && success && rec.seriesContract ? BigInt(await fetchRefund(rec.accountId, rec.seriesContract)) : 0n),
    [rec.mode, success, rec.seriesContract, rec.accountId],
  )

  const refused: OutcomeCheck = ({ value, receiptErrors }) => {
    if (ftTransferCallUsed(value) !== 0n) return null
    const reason = receiptErrors.map(panicMessage).find(Boolean)
    return `The series refused the deposit${reason ? ` (“${reason}”)` : ''}, so the stNEAR stayed in your wallet.`
  }
  const deposit = async () => {
    if (!amount) return
    const hash = await depositTx.execute(buildDepositTx({ amountYocto: amount.toString() }), refused)
    if (hash) saveSwap({ depositAddress: rec.depositAddress, finishedTx: hash })
  }

  const finalAction =
    rec.mode === 'express' ? (
      success &&
      (held.data ? (
        <RefundClaim accountId={rec.accountId} contractId={rec.seriesContract!} label={rec.seriesContract} />
      ) : (
        <div className="confirmed-state">
          <div>
            <strong>PT + YT minted to {rec.accountId}</strong>
            <p>No NEAR transaction needed. Keep both for leveraged yield, or sell the YT to lock a fixed rate.</p>
          </div>
          <Link className="earn-inline" to="/earn?step=sell">
            Sell YT <ArrowRight size={12} aria-hidden />
          </Link>
          <Link className="earn-inline" to="/portfolio">
            Portfolio
          </Link>
        </div>
      ))
    ) : success && !rec.finishedTx ? (
      <div className="ac-final">
        {wrongSeries ? (
          <Button onClick={() => select(rec.seriesContract!)}>Switch to {rec.seriesContract}</Button>
        ) : (
          <>
            <TxFeedback tx={depositTx} failedTitle="Deposit failed" successTitle="PT and YT received" />
            {depositTx.phase === 'idle' && (
              <Button onClick={() => void deposit()} disabled={!amount}>
                Deposit {amount != null ? formatYoctoInput(amount, 4) : '…'} stNEAR into the series
              </Button>
            )}
          </>
        )}
      </div>
    ) : rec.finishedTx ? (
      <div className="confirmed-state">
        <div>
          <strong>Deposited. PT + YT are in your wallet.</strong>
        </div>
        <Link className="earn-inline" to="/earn?step=sell">
          Sell YT for a fixed rate <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
    ) : null

  return (
    <div className="ac-flow">
      <p className="earn-lead">
        {rec.sendLabel} → {rec.receiveLabel} · {rec.mode === 'express' ? 'Express' : 'Standard'} delivery
      </p>
      <FundsTracker rec={rec} finalLabel={rec.mode === 'express' ? 'PT + YT minted' : 'Deposited'} finalDone={rec.mode === 'express' ? success : !!rec.finishedTx} finalAction={finalAction} />
    </div>
  )
}

// ---- Flow 2: buy YT from any chain ----------------------------------------------------------

function BuyYtFlow({ tokens, intentsLive, current, onStarted }: { tokens: OneClickToken[] | null; intentsLive: boolean; current?: SwapRecord; onStarted: (a: string) => void }) {
  const cfg = getNearConfig()
  const { accountId } = useWallet()
  const { push } = useToast()
  const [params] = useSearchParams()
  const { display: series } = useSeriesDisplay()
  const listingsQuery = useLiveListings()
  const buyable = useMemo(() => (listingsQuery.data ?? []).filter(isBuyable).sort((a, b) => (BigInt(a.unitPrice) < BigInt(b.unitPrice) ? -1 : 1)), [listingsQuery.data])
  const [listingId, setListingId] = useState<string | null>(params.get('listing'))
  const listing = buyable.find((l) => l.listingId === listingId) ?? buyable[0] ?? null
  const ui = listing ? toUiListing(listing) : null
  const [qty, setQty] = useState('')
  const [picked, setPicked] = useState<OneClickToken | null>(null)
  const token = picked ?? defaultOrigin(tokens)
  const [refund, setRefund] = useState('')
  const [busy, setBusy] = useState(false)

  const remaining = listing ? BigInt(listing.quantityRemaining) : 0n
  const qtyYocto = qty.trim() ? toAtomic(qty, NEAR_DECIMALS) : remaining || null
  const cost = listing && qtyYocto ? buyCost(qtyYocto, BigInt(listing.unitPrice), series?.marketFeeBps) : null
  const storage = useNearQuery(async () => {
    if (!accountId) return 0n
    return (await needsStorageDeposit(accountId, cfg.ytTokenContractId)) ? await storageMinimum(cfg.ytTokenContractId) : 0n
  }, [accountId, cfg.ytTokenContractId])
  const need = cost ? cost.total + (storage.data ?? 0n) : null
  const tooMuch = qtyYocto != null && qtyYocto > remaining

  const previewReq = useMemo(
    () => (token && need && !tooMuch ? asPreview(buildBuyYtQuoteRequest({ originAsset: token.assetId, nearNeededYocto: need, refundTo: '', accountId: 'wrap.near', dry: true, now: Date.now() })) : null),
    [token, need, tooMuch],
  )
  const preview = useDryQuote(previewReq)
  const refundOk = token ? looksLikeAddress(token.blockchain, refund) : false

  const start = async () => {
    if (!token || !need || !listing || !qtyYocto || !accountId) return
    if (!refundOk) return push(`Enter your ${chainLabel(token.blockchain)} address for refunds.`)
    setBusy(true)
    try {
      const req = buildBuyYtQuoteRequest({ originAsset: token.assetId, nearNeededYocto: need, refundTo: refund, accountId, dry: false, now: Date.now() })
      const { quote } = await getQuote(req)
      if (!quote.depositAddress) throw new Error('NEAR Intents returned no deposit address. Try again.')
      saveSwap({
        flow: 'buy-yt',
        network: cfg.network,
        accountId,
        depositAddress: quote.depositAddress,
        createdAt: Date.now(),
        status: 'PENDING_DEPOSIT',
        sendLabel: `${quote.amountInFormatted} ${token.symbol} on ${chainLabel(token.blockchain)}`,
        receiveLabel: `${formatYocto(qtyYocto, 4)} YT (listing #${listing.listingId})`,
        amountIn: quote.amountIn,
        amountInFormatted: quote.amountInFormatted,
        originSymbol: token.symbol,
        originChain: token.blockchain,
        deadline: quote.deadline ?? req.deadline,
        listingId: listing.listingId,
        quantityYocto: qtyYocto.toString(),
        needYocto: need.toString(),
        seriesContract: cfg.seriesContractId,
      })
      onStarted(quote.depositAddress)
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'warning')
    } finally {
      setBusy(false)
    }
  }

  if (current) return <BuyTracker rec={current} />

  if (isLiveMode() && !listingsQuery.loading && buyable.length === 0) {
    return (
      <p className="earn-note">
        No YT is for sale in {series?.name ?? 'this series'} right now. Check another series on <Link to="/marketplace">Buy YT</Link>, or{' '}
        <Link to="/any-chain?tab=deposit">deposit from any chain</Link>{' '}
        to mint your own.
      </p>
    )
  }

  return (
    <div className="ac-flow">
      <div className="ac-swap">
        <SwapBox label="You pay" aside={preview.quote?.amountInUsd ? `≈ ${usd(preview.quote.amountInUsd)}` : null}>
          <QuotedAmount loading={preview.loading}>{preview.quote ? trim4(preview.quote.amountInFormatted) : '—'}</QuotedAmount>
          <AssetPicker id="buy-asset" label="Pay with" tokens={tokens} value={token} onChange={setPicked} excludeChains={['near']} disabled={busy} />
        </SwapBox>
        <SwapArrow />
        <SwapBox
          label="You get"
          htmlFor="buy-qty"
          aside={
            ui ? (
              <>
                {ui.remaining.toFixed(4)} YT available <MaxButton onClick={() => setQty(fromAtomic(remaining, NEAR_DECIMALS))} disabled={busy} />
              </>
            ) : null
          }
        >
          <AmountField id="buy-qty" value={qty} onChange={setQty} placeholder={listing ? fromAtomic(remaining, NEAR_DECIMALS, 4) : '0'} disabled={busy || !listing} />
          <div className="ac-picker">
            <select aria-label="Listing" value={listing?.listingId ?? ''} onChange={(e) => setListingId(e.target.value)} disabled={busy || !buyable.length}>
              {!isLiveMode() && <option>Demo: no live listings</option>}
              {buyable.map((l) => (
                <option key={l.listingId} value={l.listingId}>
                  YT · #{l.listingId} at {toUiListing(l).unitPrice.toFixed(4)} NEAR
                </option>
              ))}
            </select>
          </div>
        </SwapBox>
      </div>
      {tooMuch && <p className="ac-error">The listing only has {formatYocto(remaining, 4)} YT left.</p>}
      {preview.error && <p className="earn-note earn-note-warn">{preview.error}</p>}

      <QuoteDetails summary={summaryLine(eta(preview.quote), 'then you sign the buy on NEAR')}>
        <Row k="Delivered to you">
          {cost ? formatYocto(cost.total, 4) : '—'} NEAR for the YT, incl. {formatBps(series?.marketFeeBps ?? 25n)} market fee
        </Row>
        {(storage.data ?? 0n) > 0n ? <Row k="YT registration">{formatYocto(storage.data!, 4)} NEAR, one time</Row> : null}
        <Row k="Gas">0.03 NEAR, delivered with it</Row>
        <Row k="Leftovers">Any unused input is refunded</Row>
      </QuoteDetails>

      <Field id="buy-refund" label={`Refund address${token ? ` on ${chainLabel(token.blockchain)}` : ''}`}>
        <AddressInput id="buy-refund" value={refund} onChange={setRefund} chain={token?.blockchain ?? ''} placeholder="Used if the swap can't be filled" disabled={busy} />
      </Field>
      <div className="earn-actions">
        <StartButton intentsLive={intentsLive} ready={!!need && !tooMuch && refundOk && !!preview.quote} busy={busy} onClick={() => void start()}>
          Get deposit address
        </StartButton>
      </div>
    </div>
  )
}

function BuyTracker({ rec }: { rec: SwapRecord }) {
  const { accountId } = useWallet()
  const unwrapTx = useTx()
  const buyTx = useTx()
  const success = rec.status === 'SUCCESS'
  const balances = useNearQuery(async () => {
    if (!success || !accountId) return null
    const [native, wnear] = await Promise.all([getNearBalance(accountId), viewCall<string>(wnearContract(), 'ft_balance_of', { account_id: accountId }).catch(() => '0')])
    return { native: BigInt(native), wnear: BigInt(wnear) }
  }, [success, accountId, unwrapTx.phase])
  const need = BigInt(rec.needYocto ?? '0')
  const plan = balances.data ? buildUnwrapAndBuyPlan({ needYocto: need, nativeYocto: balances.data.native, wnearYocto: balances.data.wnear, gasReserveYocto: BUY_GAS_RESERVE_YOCTO }) : null

  const unwrap = async () => {
    if (!plan?.ok || plan.unwrapYocto === 0n) return
    await unwrapTx.execute(buildUnwrapTx({ wnearContractId: wnearContract(), amountYocto: plan.unwrapYocto }))
  }
  const buy = async () => {
    if (!rec.listingId || !rec.quantityYocto) return
    const hash = await buyTx.execute(buildBuyTx({ listingId: rec.listingId, quantityYocto: rec.quantityYocto, attachedDepositYocto: need.toString() }))
    if (hash) saveSwap({ depositAddress: rec.depositAddress, finishedTx: hash })
  }

  const finalAction = !success ? null : rec.finishedTx && buyTx.phase === 'idle' ? (
    <div className="confirmed-state">
      <div>
        <strong>YT bought. It's in your portfolio.</strong>
      </div>
      <Link className="earn-inline" to="/portfolio">
        Portfolio <ArrowRight size={12} aria-hidden />
      </Link>
    </div>
  ) : (
    <div className="ac-final">
      {plan && !plan.ok && (
        <p className="earn-note earn-note-warn">
          Your wallet is {formatYocto(plan.shortfallYocto, 4)} NEAR short of the purchase, probably because the price or the storage fee changed. Top up, or buy a smaller amount on{' '}
          <Link to={`/listing/${rec.listingId}`}>the listing page</Link>.
        </p>
      )}
      <TxFeedback tx={unwrapTx} failedTitle="Unwrap failed" successTitle="wNEAR unwrapped to NEAR" />
      <TxFeedback
        tx={buyTx}
        failedTitle="Purchase failed"
        successTitle="YT bought"
        successBody="If the listing sold out first, the contract refunded the NEAR to your wallet."
        successAction={
          <Link className="earn-inline" to="/portfolio">
            Portfolio
          </Link>
        }
      />
      {plan?.ok && unwrapTx.phase !== 'awaiting_signature' && unwrapTx.phase !== 'submitted' && buyTx.phase === 'idle' && (
        <div className="earn-actions">
          {plan.unwrapYocto > 0n ? (
            <Button onClick={() => void unwrap()}>Unwrap {formatYocto(plan.unwrapYocto, 4)} wNEAR</Button>
          ) : (
            <Button onClick={() => void buy()}>
              Buy {formatYocto(BigInt(rec.quantityYocto ?? '0'), 4)} YT for {formatYocto(need, 4)} NEAR
            </Button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="ac-flow">
      <p className="earn-lead">
        {rec.sendLabel} → {rec.receiveLabel}
      </p>
      <FundsTracker rec={rec} finalLabel="YT bought" finalDone={!!rec.finishedTx} finalAction={finalAction} />
    </div>
  )
}

// ---- Flow 3: cash out to any chain ----------------------------------------------------------

function CashOutFlow({ tokens, intentsLive, current, onStarted }: { tokens: OneClickToken[] | null; intentsLive: boolean; current?: SwapRecord; onStarted: (a: string) => void }) {
  const cfg = getNearConfig()
  const { accountId } = useWallet()
  const { push } = useToast()
  const stNear = useStNearBalance(accountId)
  // YT sale proceeds and PT/YT redemptions arrive as NEAR and stNEAR respectively, so both can be cashed out.
  const [source, setSource] = useState<'stnear' | 'near'>('stnear')
  const native = useNearQuery(async () => (accountId ? BigInt(await getNearBalance(accountId)) : null), [accountId])
  const spendableNear = native.data != null ? (native.data > CASH_OUT_NEAR_RESERVE_YOCTO ? native.data - CASH_OUT_NEAR_RESERVE_YOCTO : 0n) : null
  const balance = source === 'near' ? spendableNear : stNear.data != null ? BigInt(stNear.data) : null
  const unit = source === 'near' ? 'NEAR' : 'stNEAR'
  const originAsset = source === 'near' ? WNEAR_ASSET_ID : STNEAR_ASSET_ID
  const [amount, setAmount] = useState('')
  const [picked, setPicked] = useState<OneClickToken | null>(null)
  const token = picked ?? defaultOrigin(tokens)
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const cashTx = useTx()

  const atomic = toAtomic(amount, NEAR_DECIMALS) ?? (amount.trim() ? null : parseNear('1'))
  const over = atomic != null && balance != null && atomic > balance
  const previewReq = useMemo(
    () => (token && atomic ? asPreview(buildCashOutQuoteRequest({ amountStNearYocto: atomic, originAsset, destinationAsset: token.assetId, recipient: '', accountId: 'wrap.near', dry: true, now: Date.now() })) : null),
    [token, atomic, originAsset],
  )
  const preview = useDryQuote(previewReq)
  const recipientOk = token ? looksLikeAddress(token.blockchain, recipient) : false

  const start = async () => {
    if (!token || !atomic || !accountId) return
    if (over) return push(source === 'near' ? 'That is more NEAR than your wallet can spare (0.05 NEAR stays for gas).' : 'That is more stNEAR than your wallet holds.')
    if (!recipientOk) return push(`Enter the ${chainLabel(token.blockchain)} address that should receive the ${token.symbol}.`)
    setBusy(true)
    try {
      const req = buildCashOutQuoteRequest({ amountStNearYocto: atomic, originAsset, destinationAsset: token.assetId, recipient, accountId, dry: false, now: Date.now() })
      const { quote } = await getQuote(req)
      if (!quote.depositAddress) throw new Error('NEAR Intents returned no deposit address. Try again.')
      saveSwap({
        flow: 'cash-out',
        network: cfg.network,
        accountId,
        depositAddress: quote.depositAddress,
        createdAt: Date.now(),
        status: 'PENDING_DEPOSIT',
        sendLabel: `${fromAtomic(atomic, NEAR_DECIMALS, 4)} ${unit}`,
        receiveLabel: `≈ ${quote.amountOutFormatted.replace(/(\.\d{4})\d+$/, '$1')} ${token.symbol} on ${chainLabel(token.blockchain)}`,
        amountIn: quote.amountIn,
        amountInFormatted: quote.amountInFormatted,
        originSymbol: unit,
        originChain: 'near',
        deadline: quote.deadline ?? req.deadline,
      })
      onStarted(quote.depositAddress)
      const hash = await cashTx.execute(await cashOutTx(source, accountId, quote.depositAddress, atomic))
      if (hash) {
        saveSwap({ depositAddress: quote.depositAddress, fundingTx: hash })
        submitDepositTx(hash, quote.depositAddress).catch(() => undefined)
      }
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), 'warning')
    } finally {
      setBusy(false)
    }
  }

  if (current) return <CashOutTracker rec={current} tx={cashTx} />

  return (
    <div className="ac-flow">
      <div className="ac-swap">
        <SwapBox
          label="You send"
          htmlFor="out-amount"
          aside={
            balance != null ? (
              <>
                {source === 'near' ? 'Spendable' : 'Wallet'} {formatYocto(balance, 4)} {balance > 0n && <MaxButton onClick={() => setAmount(fromAtomic(balance, NEAR_DECIMALS))} disabled={busy} />}
              </>
            ) : null
          }
        >
          <AmountField id="out-amount" value={amount} onChange={setAmount} placeholder="1" disabled={busy} />
          <div className="ac-picker">
            <select aria-label="Asset to cash out" value={source} onChange={(e) => setSource(e.target.value as 'stnear' | 'near')} disabled={busy}>
              <option value="stnear">stNEAR</option>
              <option value="near">NEAR</option>
            </select>
          </div>
        </SwapBox>
        <SwapArrow />
        <SwapBox label="You receive" aside={preview.quote?.amountOutUsd ? `≈ ${usd(preview.quote.amountOutUsd)}` : null}>
          <QuotedAmount loading={preview.loading}>{preview.quote ? trim4(preview.quote.amountOutFormatted) : '—'}</QuotedAmount>
          <AssetPicker id="out-asset" label="Receive" tokens={tokens} value={token} onChange={setPicked} excludeAssetIds={[STNEAR_ASSET_ID, WNEAR_ASSET_ID]} disabled={busy} />
        </SwapBox>
      </div>
      {over && <p className="ac-error">That is more {unit} than your wallet {source === 'near' ? 'can spare' : 'holds'}.</p>}
      {preview.error && <p className="earn-note earn-note-warn">{preview.error}</p>}

      <QuoteDetails summary={summaryLine(eta(preview.quote), 'one NEAR transaction', 'fees included')}>
        <Row k="Minimum received">{preview.quote?.minAmountOut && token ? `${fmtToken(preview.quote.minAmountOut, token.decimals)} ${token.symbol} (1% slippage)` : '—'}</Row>
        <Row k="Fees">1Click fee included; the destination chain may charge a withdrawal fee</Row>
        {source === 'near' ? <Row k="Kept for gas">0.05 NEAR stays in your wallet</Row> : null}
        <Row k="What to send">
          stNEAR from a redemption in <Link to="/portfolio">Portfolio</Link>, or NEAR from selling YT
        </Row>
        <Row k="Refunds">
          Return as {source === 'near' ? 'wNEAR' : 'stNEAR'} to {accountId ?? 'your NEAR wallet'}
        </Row>
      </QuoteDetails>

      <Field id="out-recipient" label={`Receiving address${token ? ` on ${chainLabel(token.blockchain)}` : ''}`}>
        <AddressInput id="out-recipient" value={recipient} onChange={setRecipient} chain={token?.blockchain ?? ''} placeholder="Where the funds should arrive" disabled={busy} />
      </Field>
      <TxFeedback tx={cashTx} failedTitle="Transfer failed" successTitle={`${unit} sent to NEAR Intents`} />
      {cashTx.phase === 'idle' && (
        <div className="earn-actions">
          <StartButton intentsLive={intentsLive} ready={!!atomic && !over && recipientOk && !!preview.quote} busy={busy} onClick={() => void start()}>
            Cash out
          </StartButton>
        </div>
      )}
    </div>
  )
}

/** The NEAR transaction that funds a cash-out deposit address, for stNEAR or (wrapped) native NEAR. */
async function cashOutTx(source: 'stnear' | 'near', accountId: string, depositAddress: string, amountYocto: bigint) {
  const cfg = getNearConfig()
  if (source === 'near') {
    const storageMinYocto = await storageMinimum(wnearContract())
    return buildCashOutNearTx({ wnearContractId: wnearContract(), accountId, depositAddress, amountYocto, storageMinYocto })
  }
  return buildCashOutTx({ stNearContractId: cfg.stNearContractId, depositAddress, amountYocto, storageMinYocto: await storageMinimum(cfg.stNearContractId) })
}

function CashOutTracker({ rec, tx: cashTx }: { rec: SwapRecord; tx: ReturnType<typeof useTx> }) {
  const expired = rec.deadline ? Date.parse(rec.deadline) < Date.now() : false
  const unit = rec.originSymbol === 'NEAR' ? 'NEAR' : 'stNEAR'
  const retry = async () => {
    const hash = await cashTx.execute(await cashOutTx(unit === 'NEAR' ? 'near' : 'stnear', rec.accountId, rec.depositAddress, BigInt(rec.amountIn)))
    if (hash) {
      saveSwap({ depositAddress: rec.depositAddress, fundingTx: hash })
      submitDepositTx(hash, rec.depositAddress).catch(() => undefined)
    }
  }
  const unfunded = !rec.fundingTx && (rec.status === 'PENDING_DEPOSIT' || !rec.status)
  return (
    <div className="ac-flow">
      <p className="earn-lead">
        {rec.sendLabel} → {rec.receiveLabel}
      </p>
      <FundsTracker
        rec={rec}
        finalLabel="Delivered"
        finalDone={rec.status === 'SUCCESS'}
        finalAction={
          unfunded ? (
            <div className="ac-final">
              <TxFeedback tx={cashTx} failedTitle="Transfer failed" successTitle={`${unit} sent to NEAR Intents`} />
              {cashTx.phase === 'idle' &&
                (expired ? (
                  <p className="earn-note">This quote expired before the {unit} was sent. Nothing left your wallet; hide it and start a new cash-out.</p>
                ) : (
                  <Button onClick={() => void retry()}>Sign the {unit} transfer</Button>
                ))}
            </div>
          ) : rec.status === 'SUCCESS' ? (
            <div className="confirmed-state">
              <div>
                <strong>Delivered: {rec.receiveLabel.replace('≈ ', '')}</strong>
              </div>
            </div>
          ) : null
        }
      />
    </div>
  )
}
