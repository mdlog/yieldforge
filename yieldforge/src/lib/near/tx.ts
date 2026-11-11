import { viewCall } from '@/lib/near/wallet'
import { getNearConfig } from '@/lib/near/config'

export type TxPhase = 'idle' | 'awaiting_signature' | 'submitted' | 'confirmed' | 'failed' | 'indexing'

export function tgas(n: number): string {
  return (BigInt(n) * 10n ** 12n).toString()
}

export const ONE_YOCTO = '1'

/** Wallet-selector "internal" action format; WalletContext converts it for the wallet. */
export interface FunctionCallAction {
  type: 'FunctionCall'
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string }
}

export interface TxRequest {
  receiverId: string
  actions: FunctionCallAction[]
}

export function functionCall(methodName: string, args: Record<string, unknown>, gas: string, deposit = '0'): FunctionCallAction {
  return { type: 'FunctionCall', params: { methodName, args, gas, deposit } }
}

// Storage preflight ----------------------------------------------------------
/**
 * True only when the token contract answers and the account is unregistered. If the view fails
 * (RPC error, or no token deployed at that account) we don't ask the user to sign a doomed transaction.
 */
export async function needsStorageDeposit(accountId: string, ftContractId: string): Promise<boolean> {
  try {
    const bal = await viewCall<unknown>(ftContractId, 'storage_balance_of', { account_id: accountId })
    return bal == null
  } catch {
    return false
  }
}

/** NEP-145 minimum storage balance for one account on `contractId`. */
export async function storageMinimum(contractId: string): Promise<bigint> {
  const bounds = await viewCall<{ min: string }>(contractId, 'storage_balance_bounds', {})
  return BigInt(bounds.min)
}

/** Register `accountId` on a NEP-145 contract; registration_only refunds anything above the minimum. */
export function buildStorageDepositTx(contractId: string, accountId: string, depositYocto: bigint): TxRequest {
  return {
    receiverId: contractId,
    actions: [functionCall('storage_deposit', { account_id: accountId, registration_only: true }, tgas(30), depositYocto.toString())],
  }
}

export function extractTxHash(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== 'object') return null
  const o = outcome as Record<string, unknown>
  // wallet-selector FinalExecutionOutcome has transaction.hash
  const tx = o.transaction as Record<string, unknown> | undefined
  if (tx?.hash && typeof tx.hash === 'string') return tx.hash
  if (typeof o.hash === 'string') return o.hash
  // Redirect wallets return nothing; the hash only exists after the wallet returns.
  return null
}

export type TxFinality =
  | { status: 'success' }
  | { status: 'failure'; error: string }
  | { status: 'pending'; error: string }

/**
 * Check execution on the NEAR RPC after a wallet returns a transaction hash.
 * A wallet accepting a signature is not the same as the contract executing it.
 */
export async function awaitTxFinality(params: {
  hash: string
  senderAccountId: string
  receiverAccountId: string
  timeoutMs?: number
}): Promise<TxFinality> {
  const { nodeUrl } = getNearConfig()
  const timeoutMs = params.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs
  let lastError = 'Transaction is not visible on RPC yet.'

  while (Date.now() < deadline) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `yieldforge-${params.hash}`,
          method: 'EXPERIMENTAL_tx_status',
          params: {
            tx_hash: params.hash,
            sender_account_id: params.senderAccountId,
            receiver_account_id: params.receiverAccountId,
            wait_until: 'EXECUTED',
          },
        }),
      })
      const json = (await response.json()) as {
        result?: { status?: { SuccessValue?: unknown; Failure?: unknown }; final_execution_status?: string }
        error?: unknown
      }
      if (json.error) throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error))

      const result = json.result
      const status = result?.status
      if (status && typeof status === 'object') {
        if (Object.prototype.hasOwnProperty.call(status, 'Failure')) {
          const failure = (status as { Failure?: unknown }).Failure
          return { status: 'failure', error: typeof failure === 'string' ? failure : JSON.stringify(failure) }
        }
        if (Object.prototype.hasOwnProperty.call(status, 'SuccessValue')) return { status: 'success' }
      }
      // Some RPC providers omit `status` but report an executed/final outcome.
      if (result?.final_execution_status === 'EXECUTED' || result?.final_execution_status === 'FINAL') {
        return { status: 'success' }
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1000))
  }

  return {
    status: 'pending',
    error: `Still waiting for on-chain confirmation. ${lastError}`,
  }
}

export function stringifyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  try {
    return `${JSON.stringify(error).slice(0, 2000)} ${raw}`
  } catch {
    return raw
  }
}

export function isOnChainFailure(errStr: string): boolean {
  return (
    errStr.includes('unreachable') ||
    errStr.includes('WasmTrap') ||
    errStr.includes('wasm execution failed') ||
    errStr.includes('publishing_transaction_failed') ||
    errStr.includes('FunctionCallError') ||
    errStr.includes('ExecutionError') ||
    errStr.includes('final_execution_outcome') ||
    errStr.includes('ActionError') ||
    errStr.includes('Smart contract panicked')
  )
}

/**
 * Turn wallet/RPC errors into the sentence we actually want to show.
 * Wallet rejection is not an app failure; contract panics get a concrete next action.
 */
export function friendlyTxError(errStr: string): string {
  const low = errStr.toLowerCase()
  if (low.includes('reject') || low.includes('abort') || (low.includes('cancel') && !low.includes('publishing_transaction_failed'))) {
    return 'Transaction was rejected in wallet.'
  }
  if (!isOnChainFailure(errStr)) return errStr

  // Specific panic messages first: contract logs (e.g. "listing status PartiallyFilled") can precede them.
  if (errStr.includes('Seller cannot buy')) return 'You cannot buy your own listing.'
  if (errStr.includes("doesn't have enough balance")) return 'Not enough YT for this amount — part of it may already be listed.'
  if (errStr.includes('for listing storage')) return 'Attach a little NEAR for the listing storage (it is refunded if unused).'
  if (errStr.includes('Baseline is captured at the deposit cutoff')) return 'The baseline can only be captured after the deposit cutoff.'
  if (errStr.includes('Baseline already captured')) return 'The baseline has already been captured.'
  if (errStr.includes('Already settled')) return 'The series is already settled — you can redeem now.'
  if (errStr.includes('Listing not found')) return 'Listing not found — it may have been filled or cancelled.'
  if (errStr.includes('Invalid quantity')) return 'Invalid quantity — amount exceeds remaining. Try a smaller amount or refresh.'
  if (errStr.includes('Insufficient deposit')) return 'Insufficient attached NEAR for price + fee.'
  if (errStr.includes('Listing expired')) return 'Listing has expired.'
  if (errStr.includes('not fillable')) return 'Listing is no longer fillable (filled/cancelled/expired). Refresh the marketplace.'
  if (errStr.includes('Not settled yet')) return 'The series is not settled yet — request settlement first.'
  if (errStr.includes('Not yet matured') || errStr.includes('Not matured') || errStr.includes('not matured')) {
    return 'Redemption opens at series maturity — early redemption is unavailable.'
  }
  if (errStr.includes('Deposits closed') || errStr.includes('Deposits not open')) return 'Deposits are closed for this series.'
  if (low.includes('paused')) return 'The contract is paused. No funds were moved.'
  // Generic wrapper — usually stale UI (quantity above remaining, or already filled).
  return 'Transaction failed on-chain — likely filled, expired, or an invalid amount. Refresh and try again.'
}
