import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { UseTxReturn } from '@/hooks/useTx'
import { isLiveMode } from '@/lib/near/wallet'
import { ExplorerLink } from './ExplorerLink'
import { ProgressSteps } from './ProgressSteps'

const STEPS = ['Review', 'Signature', 'Submitted', 'Confirmed']

/**
 * Shared transaction state block: progress → confirmed / failed. Renders nothing while idle,
 * so callers show their action button when `tx.phase === 'idle'`.
 */
export function TxFeedback({
  tx,
  failedTitle,
  successTitle,
  successBody,
  successAction,
}: {
  tx: UseTxReturn
  failedTitle: string
  successTitle: string
  successBody?: ReactNode
  successAction?: ReactNode
}) {
  const live = isLiveMode()

  if (tx.phase === 'awaiting_signature' || tx.phase === 'submitted') {
    return (
      <div className="tx-progress" role="status" aria-live="polite">
        <ProgressSteps active={tx.phase === 'awaiting_signature' ? 1 : 2} steps={STEPS} />
        <small>
          {!live
            ? 'Simulating wallet confirmation in demo mode…'
            : tx.phase === 'awaiting_signature'
              ? 'Waiting for wallet approval…'
              : 'Transaction submitted. Awaiting on-chain finality…'}
        </small>
        {tx.explorerUrl && <ExplorerLink href={tx.explorerUrl}>View on explorer</ExplorerLink>}
        {!live && (
          <button type="button" className="simulate-failure" onClick={() => tx.fail('Wallet rejected the transaction (simulated). Nothing changed.')}>
            Simulate rejected signature
          </button>
        )}
      </div>
    )
  }

  if (tx.phase === 'failed') {
    return (
      <div className="failure-state" role="alert">
        <span aria-hidden>
          <CircleAlert size={20} />
        </span>
        <div>
          <strong>{failedTitle}</strong>
          <p>{tx.error ?? 'The transaction did not complete. Nothing changed.'}</p>
          {tx.explorerUrl && <ExplorerLink href={tx.explorerUrl}>View attempt</ExplorerLink>}
        </div>
        <button type="button" onClick={tx.reset}>
          Try again
        </button>
      </div>
    )
  }

  if (tx.phase === 'confirmed' || tx.phase === 'indexing') {
    return (
      <div className="confirmed-state" role="status">
        <span aria-hidden>
          <CircleCheck size={20} />
        </span>
        <div>
          <strong>{successTitle}</strong>
          {successBody && <p>{successBody}</p>}
          {tx.phase === 'indexing' && <p>Confirmed on-chain. The indexer may take a moment to catch up.</p>}
          {tx.explorerUrl && <ExplorerLink href={tx.explorerUrl}>View transaction</ExplorerLink>}
        </div>
        {successAction}
      </div>
    )
  }

  return null
}
