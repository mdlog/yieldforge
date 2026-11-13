import { useEffect, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, LoaderCircle, Undo2 } from 'lucide-react'
import { CopyButton, ExplorerLink } from '@/components/ui'
import { TRACKER_STEPS, trackerState } from '@/lib/intents/flows'
import { chainLabel, getStatus, type StatusResponse } from '@/lib/intents/oneclick'
import { saveSwap, type SwapRecord } from '@/lib/intents/swapStore'

const POLL_MS = 6000

/** Poll 1Click for one swap until it finishes, writing each new status to the local history. */
export function useSwapStatus(rec: SwapRecord | null) {
  const [details, setDetails] = useState<StatusResponse['swapDetails'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const address = rec?.depositAddress ?? null
  const terminal = rec ? trackerState(rec.status).terminal : true

  useEffect(() => {
    if (!address || rec?.network !== 'mainnet') return
    let stop = false
    let timer: number | undefined
    const tick = async () => {
      try {
        const res = await getStatus(address)
        if (stop) return
        setError(null)
        setDetails(res.swapDetails ?? null)
        saveSwap({ depositAddress: address, status: res.status, amountOut: res.swapDetails?.amountOut, refundReason: res.swapDetails?.refundReason })
        if (trackerState(res.status).terminal) return
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e))
      }
      if (!stop) timer = window.setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
    // A finished swap is read once (for its details) and not polled again.
  }, [address, rec?.network, terminal])

  return { details, error }
}

/**
 * Where the user's funds are, step by step: quote → sent on the origin chain → swapping on NEAR Intents →
 * arrived on NEAR → the app's final step (deposit, buy, or nothing for a cash-out). Refunds and failures say so plainly.
 */
export function FundsTracker({ rec, finalLabel, finalDone, finalAction }: { rec: SwapRecord; finalLabel: string; finalDone: boolean; finalAction?: ReactNode }) {
  const { details, error } = useSwapStatus(rec)
  const state = trackerState(rec.status)
  const active = state.tone === 'done' ? (finalDone ? 5 : 4) : state.index
  const steps = [...TRACKER_STEPS.slice(0, 4), finalLabel]
  const waitingForDeposit = rec.flow !== 'cash-out' && (rec.status === 'PENDING_DEPOSIT' || rec.status === 'INCOMPLETE_DEPOSIT' || !rec.status)
  const deadline = rec.deadline ? new Date(rec.deadline) : null

  return (
    <div className={`ac-tracker ac-tone-${state.tone}`}>
      <ol className="ac-steps" aria-label="Where your funds are">
        {steps.map((label, i) => {
          const status = i < active ? 'done' : i === active ? (state.tone === 'refunded' || state.tone === 'failed' ? state.tone : 'now') : 'todo'
          return (
            <li key={label} className={`ac-step ac-step-${status}`} aria-current={status === 'now' ? 'step' : undefined}>
              <span aria-hidden>
                {status === 'done' ? <CircleCheck size={15} /> : status === 'now' ? <LoaderCircle size={15} className="ac-spin" /> : status === 'refunded' ? <Undo2 size={15} /> : status === 'failed' ? <CircleAlert size={15} /> : i + 1}
              </span>
              <small>{label}</small>
            </li>
          )
        })}
      </ol>

      <p className="ac-tracker-status" role="status" aria-live="polite">
        <strong>{state.tone === 'done' && !finalDone && rec.flow !== 'cash-out' ? 'Arrived in your NEAR account' : state.label}</strong>
        {rec.refundReason && <span> · {rec.refundReason}</span>}
        {error && <span className="ac-muted"> · status check failed, retrying ({error})</span>}
      </p>

      {waitingForDeposit && (
        <div className="ac-deposit-box">
          <span className="ac-muted">
            Send exactly <strong>{rec.amountInFormatted} {rec.originSymbol}</strong> on <strong>{chainLabel(rec.originChain)}</strong> to
          </span>
          <code className="ac-address">{rec.depositAddress}</code>
          <div className="ac-row">
            <CopyButton value={rec.depositAddress} label="Copy address" />
            <CopyButton value={rec.amountInFormatted} label="Copy amount" />
          </div>
          <small className="ac-muted">
            Use the {chainLabel(rec.originChain)} network only. {deadline ? `Quote valid until ${deadline.toUTCString().slice(5, 22)} UTC; ` : ''}
            later or short deposits are refunded to your refund address.
          </small>
        </div>
      )}

      <div className="ac-row ac-links">
        {details?.originChainTxHashes?.map((h) =>
          h.explorerUrl ? (
            <ExplorerLink key={h.hash} href={h.explorerUrl}>
              Origin tx
            </ExplorerLink>
          ) : null,
        )}
        {details?.destinationChainTxHashes?.map((h) =>
          h.explorerUrl ? (
            <ExplorerLink key={h.hash} href={h.explorerUrl}>
              Delivery tx
            </ExplorerLink>
          ) : null,
        )}
        <ExplorerLink href={`https://explorer.near-intents.org/transactions/${rec.depositAddress}`}>NEAR Intents explorer</ExplorerLink>
      </div>

      {finalAction}
    </div>
  )
}
