import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Globe2 } from 'lucide-react'
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
import { buildDepositTx } from '@/lib/contracts/series'
import { buildBuyTx, isBuyable, toUiListing } from '@/lib/contracts/marketplace'
import {
  NEAR_DECIMALS,
  STNEAR_ASSET_ID,
  WNEAR_ASSET_ID,
  asPreview,
  buildBuyYtQuoteRequest,
  buildCashOutQuoteRequest,
  buildCashOutTx,
  buildDepositQuoteRequest,
  buildUnwrapAndBuyPlan,
  buildUnwrapTx,
  expressCheck,
  fromAtomic,
  looksLikeAddress,
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
import { useNearQuery } from '@/hooks/useNearQuery'
import { buyCost, formatBps, previewDeposit } from '@/utils/math'
import { formatYocto, formatYoctoInput, parseNear, shorten } from '@/utils/format'

type Tab = SwapFlow
const TABS: Array<{ id: Tab; label: string; blurb: string }> = [
  { id: 'deposit', label: 'Deposit', blurb: 'Any asset → PT + YT' },
  { id: 'buy-yt', label: 'Buy YT', blurb: 'Pay from any chain' },
  { id: 'cash-out', label: 'Cash out', blurb: 'stNEAR → any chain' },
]
/** Native NEAR kept back for the buy transaction's gas after unwrapping. */
const BUY_GAS_RESERVE_YOCTO = 5n * 10n ** 21n

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
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : ''
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
      <header className="earn-header">
        <span className="eyebrow eyebrow-lime">
          <Globe2 size={12} aria-hidden /> NEAR Intents
        </span>
        <h1 className="ac-title">From any chain</h1>
        <p className="earn-lead">
          Bring USDC, ETH, BTC, SOL or 200+ other assets from 25+ chains into a fixed or leveraged stNEAR yield position, and take the proceeds back out, without a
          bridge UI. Routing and settlement run through NEAR Intents (1Click); you sign once on the chain your money is on.
        </p>
      </header>

      {!intentsLive && (
        <p className="earn-note">
          <strong>Preview mode.</strong> NEAR Intents only settles on NEAR mainnet, and this app is running on {isLiveMode() ? cfg.network : 'demo data'}. Prices below are
          live mainnet quotes (dry runs: nothing is reserved or sent). The send buttons switch on in the mainnet build.
        </p>
      )}
      {tokensError && <p className="earn-note earn-note-warn">Could not load the asset list from NEAR Intents: {tokensError}</p>}

      <div className="ac-tabs" role="tablist" aria-label="Flow">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-on' : undefined} onClick={() => setTab(t.id)}>
            <strong>{t.label}</strong>
            <small>{t.blurb}</small>
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
          <h2 className="earn-card-title">Your cross-chain swaps (this browser)</h2>
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

      <section className="earn-card ac-facts">
        <h2 className="earn-card-title">Read before you send</h2>
        <ul>
          <li>
            <strong>The fixed rate is in NEAR terms.</strong> Your USDC becomes stNEAR. Selling the YT locks the stNEAR-to-NEAR return, not a dollar return: until you cash
            out, you hold NEAR price exposure.
          </li>
          <li>
            <strong>Costs.</strong> 1Click charges 0.2% plus the solver's spread, and some routes have a small withdrawal fee. Every quote above already includes them. Origin-chain
            gas is extra.
          </li>
          <li>
            <strong>Refunds.</strong> If a swap can't be filled before its deadline, 1Click refunds the deposit to the refund address you typed (cash-outs: to your NEAR wallet).
          </li>
          <li>
            <strong>Express deposits</strong> hand the stNEAR to the series in the same settlement (NEAR Intents' custom recipient message). The app only offers it when the series
            will certainly accept: deposits open well past the expected landing time, room under the deposit cap, and above the minimum. Otherwise it uses Standard. 1Click marks this
            feature experimental.
          </li>
        </ul>
      </section>
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

function AmountInput({ id, value, onChange, unit, onMax, disabled, placeholder = '0.0' }: { id: string; value: string; onChange: (v: string) => void; unit: string; onMax?: () => void; disabled?: boolean; placeholder?: string }) {
  return (
    <div className="earn-input">
      <input id={id} inputMode="decimal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      <span>{unit}</span>
      {onMax && (
        <button type="button" onClick={onMax} disabled={disabled}>
          Max
        </button>
      )}
    </div>
  )
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

function QuoteLine({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  if (error) return <p className="earn-note earn-note-warn">{error}</p>
  return (
    <div className={`earn-result ac-quote ${loading ? 'is-loading' : ''}`} aria-live="polite" aria-busy={loading}>
      {children}
    </div>
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

  return (
    <div className="ac-flow">
      <p className="earn-lead">
        Send an asset from another chain; it arrives as stNEAR in <strong>{series?.name ?? cfg.seriesContractId}</strong> and you get PT + YT. Then keep both (leveraged yield),
        or <Link to="/earn?step=sell">sell the YT</Link> to lock a fixed rate.
      </p>
      <div className="earn-grid">
        <AssetPicker id="dep-asset" label="Pay with" tokens={tokens} value={token} onChange={setPicked} excludeChains={['near']} disabled={busy} />
        <Field id="dep-amount" label="Amount" hint={token && atomic && token.price ? `≈ ${usd(Number(amount.replace(',', '.')) * token.price)}` : undefined}>
          <AmountInput id="dep-amount" value={amount} onChange={setAmount} unit={token?.symbol ?? ''} disabled={busy} />
        </Field>
      </div>
      <QuoteLine loading={preview.loading} error={preview.error}>
        <span>
          You get ≈ <strong>{stOut != null ? fmtToken(stOut, NEAR_DECIMALS) : '—'} stNEAR</strong>
          {rate && stOut != null ? ` (≈ ${(Number(fromAtomic(stOut, NEAR_DECIMALS, 6)) * rate).toFixed(3)} NEAR)` : ''}, then
        </span>
        <span className="earn-receive ac-receive">
          <TokenBadge kind="PT" size="sm" /> <strong>{formatYocto(minted.pt, 4)}</strong>
          <TokenBadge kind="YT" size="sm" /> <strong>{formatYocto(minted.yt, 4)}</strong>
        </span>
        <small>
          Worst case {preview.quote ? fmtToken(preview.quote.minAmountOut, NEAR_DECIMALS) : '—'} stNEAR at 1% slippage · {formatBps(feeBps)} series deposit fee ·{' '}
          {preview.quote?.timeEstimate ? `~${Math.max(1, Math.round(preview.quote.timeEstimate / 60))} min` : '—'} · 1Click fee included
        </small>
      </QuoteLine>

      <div className="earn-field">
        <span className="earn-field-label">Delivery</span>
        <div className="earn-chips" role="radiogroup" aria-label="Delivery mode">
          <button type="button" role="radio" aria-checked={mode === 'express'} className={mode === 'express' ? 'is-on' : undefined} onClick={() => setMode('express')} disabled={busy}>
            Express: straight into the series
          </button>
          <button type="button" role="radio" aria-checked={mode === 'standard'} className={mode === 'standard' ? 'is-on' : undefined} onClick={() => setMode('standard')} disabled={busy}>
            Standard: to my wallet, I deposit
          </button>
        </div>
        <small className="earn-hint">
          {mode === 'express'
            ? check && !check.ok
              ? `Express unavailable: ${check.reasons.join(' ')} Standard will be used.`
              : 'One transaction on the origin chain. NEAR Intents delivers the stNEAR to the series, which mints PT + YT to your NEAR account.'
            : 'The stNEAR lands in your NEAR wallet; you sign one deposit on NEAR afterwards. Works even if the series closes meanwhile.'}
        </small>
      </div>

      <Field id="dep-refund" label={`Your ${token ? chainLabel(token.blockchain) : ''} address for refunds`}>
        <AddressInput id="dep-refund" value={refund} onChange={setRefund} chain={token?.blockchain ?? ''} placeholder="Refunds go here if the swap can't be filled" disabled={busy} />
      </Field>
      <p className="earn-hint ac-receiver">
        PT + YT go to <strong>{isConnected ? accountId : 'your connected NEAR account'}</strong>.
      </p>
      <label className="earn-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I understand PT is not principal-protected, YT pays nothing if the stNEAR rate doesn't rise, and the position is in NEAR terms. <Link to="/docs#risks">Risks</Link>
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
      success && (
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
      )
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
      <p className="earn-lead">
        Buy leveraged stNEAR yield with money that lives on another chain. NEAR Intents delivers exactly the NEAR the purchase needs to your wallet; you then sign the buy on
        NEAR.
      </p>
      <div className="earn-grid">
        <Field id="buy-listing" label="Listing">
          <div className="ac-picker">
            <select id="buy-listing" value={listing?.listingId ?? ''} onChange={(e) => setListingId(e.target.value)} disabled={busy || !buyable.length}>
              {!isLiveMode() && <option>Demo mode: no live listings</option>}
              {buyable.map((l) => {
                const u = toUiListing(l)
                return (
                  <option key={l.listingId} value={l.listingId}>
                    #{l.listingId} · {u.remaining.toFixed(4)} YT at {u.unitPrice.toFixed(4)} NEAR
                  </option>
                )
              })}
            </select>
          </div>
        </Field>
        <Field id="buy-qty" label="YT to buy" hint={ui ? `${ui.remaining.toFixed(4)} available` : undefined}>
          <AmountInput id="buy-qty" value={qty} onChange={setQty} unit="YT" placeholder={listing ? fromAtomic(remaining, NEAR_DECIMALS, 4) : '0.0'} onMax={listing ? () => setQty(fromAtomic(remaining, NEAR_DECIMALS)) : undefined} disabled={busy || !listing} />
        </Field>
      </div>
      {tooMuch && <p className="ac-error">The listing only has {formatYocto(remaining, 4)} YT left.</p>}
      <AssetPicker id="buy-asset" label="Pay with" tokens={tokens} value={token} onChange={setPicked} excludeChains={['near']} disabled={busy} />
      <QuoteLine loading={preview.loading} error={preview.error}>
        <span>
          You pay ≈{' '}
          <strong>
            {preview.quote ? `${preview.quote.amountInFormatted.replace(/(\.\d{4})\d+$/, '$1')} ${token?.symbol ?? ''}` : '—'}
          </strong>{' '}
          {preview.quote?.amountInUsd ? `(${usd(preview.quote.amountInUsd)})` : ''}
        </span>
        <small>
          Delivers {cost ? formatYocto(cost.total, 4) : '—'} NEAR for the YT (incl. {formatBps(series?.marketFeeBps ?? 25n)} market fee)
          {(storage.data ?? 0n) > 0n ? ` + ${formatYocto(storage.data!, 4)} one-time YT registration` : ''} + 0.03 NEAR for gas, to your wallet · leftover input is refunded
        </small>
      </QuoteLine>
      <Field id="buy-refund" label={`Your ${token ? chainLabel(token.blockchain) : ''} address for refunds`}>
        <AddressInput id="buy-refund" value={refund} onChange={setRefund} chain={token?.blockchain ?? ''} placeholder="Refunds go here if the swap can't be filled" disabled={busy} />
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
  const balance = stNear.data != null ? BigInt(stNear.data) : null
  const [amount, setAmount] = useState('')
  const [picked, setPicked] = useState<OneClickToken | null>(null)
  const token = picked ?? defaultOrigin(tokens)
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const cashTx = useTx()

  const atomic = toAtomic(amount, NEAR_DECIMALS) ?? (amount.trim() ? null : parseNear('1'))
  const over = atomic != null && balance != null && atomic > balance
  const previewReq = useMemo(
    () => (token && atomic ? asPreview(buildCashOutQuoteRequest({ amountStNearYocto: atomic, destinationAsset: token.assetId, recipient: '', accountId: 'wrap.near', dry: true, now: Date.now() })) : null),
    [token, atomic],
  )
  const preview = useDryQuote(previewReq)
  const recipientOk = token ? looksLikeAddress(token.blockchain, recipient) : false

  const start = async () => {
    if (!token || !atomic || !accountId) return
    if (over) return push('That is more stNEAR than your wallet holds.')
    if (!recipientOk) return push(`Enter the ${chainLabel(token.blockchain)} address that should receive the ${token.symbol}.`)
    setBusy(true)
    try {
      const req = buildCashOutQuoteRequest({ amountStNearYocto: atomic, destinationAsset: token.assetId, recipient, accountId, dry: false, now: Date.now() })
      const { quote } = await getQuote(req)
      if (!quote.depositAddress) throw new Error('NEAR Intents returned no deposit address. Try again.')
      const storageMin = await storageMinimum(cfg.stNearContractId)
      saveSwap({
        flow: 'cash-out',
        network: cfg.network,
        accountId,
        depositAddress: quote.depositAddress,
        createdAt: Date.now(),
        status: 'PENDING_DEPOSIT',
        sendLabel: `${fromAtomic(atomic, NEAR_DECIMALS, 4)} stNEAR`,
        receiveLabel: `≈ ${quote.amountOutFormatted.replace(/(\.\d{4})\d+$/, '$1')} ${token.symbol} on ${chainLabel(token.blockchain)}`,
        amountIn: quote.amountIn,
        amountInFormatted: quote.amountInFormatted,
        originSymbol: 'stNEAR',
        originChain: 'near',
        deadline: quote.deadline ?? req.deadline,
      })
      onStarted(quote.depositAddress)
      const hash = await cashTx.execute(buildCashOutTx({ stNearContractId: cfg.stNearContractId, depositAddress: quote.depositAddress, amountYocto: atomic, storageMinYocto: storageMin }))
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
      <p className="earn-lead">
        Turn stNEAR (for example from a redemption in <Link to="/portfolio">Portfolio</Link>) into USDC, ETH, BTC or anything else, delivered on its own chain. One NEAR
        transaction.
      </p>
      <div className="earn-grid">
        <Field id="out-amount" label="stNEAR to cash out" hint={balance != null ? `Wallet: ${formatYocto(balance, 4)} stNEAR` : 'Connect a wallet to see your balance'}>
          <AmountInput id="out-amount" value={amount} onChange={setAmount} unit="stNEAR" onMax={balance ? () => setAmount(fromAtomic(balance, NEAR_DECIMALS)) : undefined} disabled={busy} />
        </Field>
        <AssetPicker id="out-asset" label="Receive" tokens={tokens} value={token} onChange={setPicked} excludeAssetIds={[STNEAR_ASSET_ID]} disabled={busy} />
      </div>
      {over && <p className="ac-error">That is more stNEAR than your wallet holds.</p>}
      <QuoteLine loading={preview.loading} error={preview.error}>
        <span>
          {amount.trim() ? 'You receive' : '1 stNEAR gets'} ≈{' '}
          <strong>
            {preview.quote ? `${preview.quote.amountOutFormatted.replace(/(\.\d{4})\d+$/, '$1')} ${token?.symbol ?? ''}` : '—'}
          </strong>{' '}
          {preview.quote?.amountOutUsd ? `(${usd(preview.quote.amountOutUsd)})` : ''} {token ? `on ${chainLabel(token.blockchain)}` : ''}
        </span>
        <small>
          Worst case {preview.quote ? preview.quote.minAmountOut && token ? fmtToken(preview.quote.minAmountOut, token.decimals) : '—' : '—'} at 1% slippage · 1Click fee included ·
          destination withdrawal fee may apply
        </small>
      </QuoteLine>
      <Field id="out-recipient" label={`${token ? chainLabel(token.blockchain) : 'Destination'} address that receives it`}>
        <AddressInput id="out-recipient" value={recipient} onChange={setRecipient} chain={token?.blockchain ?? ''} placeholder="Where the funds should arrive" disabled={busy} />
      </Field>
      <small className="earn-hint">Refunds, if any, return as stNEAR to {accountId ?? 'your NEAR wallet'}.</small>
      <TxFeedback tx={cashTx} failedTitle="Transfer failed" successTitle="stNEAR sent to NEAR Intents" />
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

function CashOutTracker({ rec, tx: cashTx }: { rec: SwapRecord; tx: ReturnType<typeof useTx> }) {
  const cfg = getNearConfig()
  const expired = rec.deadline ? Date.parse(rec.deadline) < Date.now() : false
  const retry = async () => {
    const storageMin = await storageMinimum(cfg.stNearContractId)
    const hash = await cashTx.execute(buildCashOutTx({ stNearContractId: cfg.stNearContractId, depositAddress: rec.depositAddress, amountYocto: BigInt(rec.amountIn), storageMinYocto: storageMin }))
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
              <TxFeedback tx={cashTx} failedTitle="Transfer failed" successTitle="stNEAR sent to NEAR Intents" />
              {cashTx.phase === 'idle' &&
                (expired ? (
                  <p className="earn-note">This quote expired before the stNEAR was sent. Nothing left your wallet; hide it and start a new cash-out.</p>
                ) : (
                  <Button onClick={() => void retry()}>Sign the stNEAR transfer</Button>
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
