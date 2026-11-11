import { useCallback, useRef, useState } from 'react'
import { useWallet } from '@/contexts/WalletContext'
import { explorerTxUrl } from '@/lib/near/config'
import { awaitTxFinality, extractTxHash, friendlyTxError, stringifyError, type TxOutcome, type TxPhase, type TxRequest } from '@/lib/near/tx'

/** Reads a successful outcome and returns why it still didn't do its job, or null when it did. */
export type OutcomeCheck = (outcome: TxOutcome) => string | null

const DEMO_CONFIRM_MS = 1100

export interface UseTxReturn {
  phase: TxPhase
  hash: string | null
  explorerUrl: string | null
  error: string | null
  /**
   * Sign and send for real; resolves to the tx hash once the wallet returns one. `check` turns a transaction that
   * succeeded on chain but did not do its job (e.g. a refunded ft_transfer_call) into a failure.
   */
  execute: (request: TxRequest, check?: OutcomeCheck) => Promise<string | null>
  /** Demo mode: walk the same phases without a wallet. Resolves true when "confirmed". */
  simulate: () => Promise<boolean>
  /** Mark the current attempt as failed (used by the demo "Simulate rejected signature" control). */
  fail: (message: string) => void
  reset: () => void
}

export function useTx(): UseTxReturn {
  const { signAndSendTransaction, accountId } = useWallet()
  const [phase, setPhase] = useState<TxPhase>('idle')
  const [hash, setHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Guards against a stale async step overwriting a newer attempt's state.
  const runId = useRef(0)

  const begin = () => {
    runId.current += 1
    setError(null)
    setHash(null)
    setPhase('awaiting_signature')
    return runId.current
  }

  const reset = useCallback(() => {
    runId.current += 1
    setPhase('idle')
    setHash(null)
    setError(null)
  }, [])

  const fail = useCallback((message: string) => {
    runId.current += 1
    setError(message)
    setPhase('failed')
  }, [])

  const simulate = useCallback((): Promise<boolean> => {
    const run = begin()
    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (runId.current !== run) return resolve(false)
        setPhase('confirmed')
        resolve(true)
      }, DEMO_CONFIRM_MS)
    })
  }, [])

  const execute = useCallback(
    async (request: TxRequest, check?: OutcomeCheck): Promise<string | null> => {
      const run = begin()
      try {
        const outcome = await signAndSendTransaction(request)
        const h = extractTxHash(outcome)
        if (runId.current !== run) return h
        setPhase('submitted')
        // Redirect wallets: the hash only exists after the wallet returns to the app.
        if (!h) return null
        setHash(h)

        // A signed wallet response is not an on-chain success. Confirm with the RPC before
        // ever moving to `confirmed`; a pending check keeps the UI honest at `submitted`.
        if (!h.startsWith('mock-') && accountId) {
          void awaitTxFinality({ hash: h, senderAccountId: accountId, receiverAccountId: request.receiverId })
            .then((result) => {
              if (runId.current !== run) return
              if (result.status === 'success') {
                const problem = check?.(result.outcome) ?? null
                if (problem) {
                  setError(problem)
                  setPhase('failed')
                  return
                }
                setPhase('confirmed')
                window.setTimeout(() => setPhase((p) => (p === 'confirmed' ? 'indexing' : p)), 1200)
              } else if (result.status === 'failure') {
                setError(friendlyTxError(result.error))
                setPhase('failed')
              }
            })
            .catch((e: unknown) => {
              if (runId.current !== run) return
              setError(friendlyTxError(e instanceof Error ? e.message : String(e)))
              setPhase('failed')
            })
        }
        return h
      } catch (e: unknown) {
        if (runId.current === run) {
          setError(friendlyTxError(stringifyError(e)))
          setPhase('failed')
        }
        return null
      }
    },
    [signAndSendTransaction, accountId],
  )

  const explorerUrl = hash && !hash.startsWith('mock-') ? explorerTxUrl(hash) : null

  return { phase, hash, explorerUrl, error, execute, simulate, fail, reset }
}
