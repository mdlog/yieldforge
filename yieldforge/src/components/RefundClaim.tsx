import { Button, TxFeedback } from '@/components/ui'
import { getNearConfig } from '@/lib/near/config'
import { buildStorageDepositTx, needsStorageDeposit, storageMinimum } from '@/lib/near/tx'
import { buildClaimRefundTx, fetchRefund } from '@/lib/contracts/series'
import { useNearQuery } from '@/hooks/useNearQuery'
import { useTx } from '@/hooks/useTx'
import { formatYocto } from '@/utils/format'

/**
 * stNEAR a series is holding for this account because a cross-chain (Express) deposit arrived when it could
 * not accept it: closed, paused, full or under the minimum. Renders nothing when there is none.
 * Claiming pays to the wallet's stNEAR balance, so an account that never held stNEAR registers first.
 */
export function RefundClaim({ accountId, contractId, label }: { accountId: string | null; contractId: string; label?: string }) {
  const stNear = getNearConfig().stNearContractId
  const storageTx = useTx()
  const claimTx = useTx()
  const refund = useNearQuery(async () => (accountId ? BigInt(await fetchRefund(accountId, contractId)) : 0n), [accountId, contractId, claimTx.phase, storageTx.phase])
  const unregistered = useNearQuery(async () => (accountId && refund.data ? needsStorageDeposit(accountId, stNear) : false), [accountId, refund.data, storageTx.phase])

  if (!accountId || !refund.data) return claimTx.phase === 'confirmed' ? <TxFeedback tx={claimTx} failedTitle="Claim failed" successTitle="Refund sent to your wallet" /> : null

  const claim = async () => {
    if (unregistered.data) {
      const hash = await storageTx.execute(buildStorageDepositTx(stNear, accountId, await storageMinimum(stNear)))
      if (!hash) return
    }
    await claimTx.execute(buildClaimRefundTx(contractId))
  }

  return (
    <div className="earn-note earn-note-warn ac-refund" role="status">
      <p>
        <strong>{formatYocto(refund.data, 4)} stNEAR is waiting for you</strong>
        {label ? ` in ${label}` : ''}. A cross-chain deposit reached the series when it could no longer accept it (closed, paused, full or under the minimum), so the series kept it
        for you instead of minting PT and YT.
        {unregistered.data ? ' Your account is not registered on stNEAR yet; claiming registers it first (0.00125 NEAR, a second signature).' : ''}
      </p>
      <TxFeedback tx={storageTx} failedTitle="Registration failed" successTitle="Registered on stNEAR" />
      <TxFeedback tx={claimTx} failedTitle="Claim failed" successTitle="Refund sent to your wallet" />
      {claimTx.phase === 'idle' && (
        <Button onClick={() => void claim()} disabled={storageTx.phase !== 'idle' && storageTx.phase !== 'confirmed'}>
          Claim {formatYocto(refund.data, 4)} stNEAR
        </Button>
      )}
    </div>
  )
}
