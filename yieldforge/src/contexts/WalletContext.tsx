import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { NearConnector } from '@hot-labs/near-connect'
import { getNearConfig } from '@/lib/near/config'
import { isWalletRejection } from '@/lib/near/outcome'

type SignResult = { transaction: { hash: string } } & Record<string, unknown>
type SignRequest = { receiverId: string; actions: unknown[] }

interface WalletContextValue {
  isConnected: boolean
  accountId: string | null
  isConnecting: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  signAndSendTransaction: (params: SignRequest) => Promise<SignResult>
}

const WalletContext = createContext<WalletContextValue | null>(null)

/**
 * NEAR Connect fetches its wallet list from GitHub (jsDelivr as fallback) with no timeout, and never settles if that
 * list is malformed. Past this the button stops waiting: the session restore still lands if it resolves later, and a
 * click without a wallet list does nothing rather than leaving the button stuck on "Connecting…".
 */
const WALLET_LIST_WAIT_MS = 8_000
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Test-only wallet injection (window.__YF_MOCK_WALLET) for headless checks.
 * Enabled on the dev server, or in a build explicitly flagged with VITE_E2E_MOCK=true — never in production.
 */
function readMockWallet(): { isConnected?: boolean; accountId?: string } | undefined {
  if (!(import.meta.env.DEV || import.meta.env.VITE_E2E_MOCK === 'true') || typeof window === 'undefined') return undefined
  return (window as unknown as { __YF_MOCK_WALLET?: { isConnected?: boolean; accountId?: string } }).__YF_MOCK_WALLET
}

/**
 * Wallets connect through NEAR Connect (@hot-labs/near-connect), the connector NEAR's docs and the hackathon's agent
 * skills recommend. Its picker lists every wallet whose manifest supports this network; each wallet runs sandboxed.
 * The app's transaction builders already produce the {type:'FunctionCall', params} actions it passes to the wallet.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [connector, setConnector] = useState<NearConnector | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const cfg = getNearConfig()

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | undefined

    // Loaded lazily so the connector isn't part of first paint.
    import('@hot-labs/near-connect')
      .then(async ({ NearConnector }) => {
        if (cancelled) return
        const c = new NearConnector({ network: cfg.network })
        const onSignIn = ({ accounts }: { accounts: { accountId: string }[] }) => setAccount(accounts[0]?.accountId ?? null)
        const onSignOut = () => setAccount(null)
        c.on('wallet:signIn', onSignIn)
        c.on('wallet:signOut', onSignOut)
        detach = () => {
          c.off('wallet:signIn', onSignIn)
          c.off('wallet:signOut', onSignOut)
        }
        setConnector(c)
        // Restore the session from the last visit; throws when nobody is signed in.
        const restoring = c
          .getConnectedWallet()
          .then(({ accounts }) => {
            if (!cancelled) setAccount(accounts[0]?.accountId ?? null)
          })
          .catch(() => {})
        await Promise.race([restoring, sleep(WALLET_LIST_WAIT_MS)])
      })
      .catch((e: unknown) => console.error('[NearConnect] init failed', e))
      .finally(() => {
        if (!cancelled) setIsInitializing(false)
      })

    return () => {
      cancelled = true
      detach?.()
    }
  }, [cfg.network])

  const mock = readMockWallet()
  const isConnected = mock?.isConnected ?? Boolean(account)
  const accountId = mock?.accountId ?? account

  const connect = useCallback(async () => {
    if (!connector) {
      console.warn('NEAR Connect not ready')
      return
    }
    const quiet = (e: unknown) => {
      // Closing the picker ("User rejected") or the wallet window ("Wallet closed") is a cancel, not a failure.
      if (!isWalletRejection(e instanceof Error ? e.message : String(e))) console.error('Wallet connect failed', e)
    }
    // "Connecting…" covers the picker only. The wallet's own sign-in window can take as long as the user needs, and
    // NEAR Connect never settles it if that window is closed before the wallet loads, so it must not hold the button.
    setIsConnecting(true)
    let walletId: string
    try {
      const listed = await Promise.race([connector.whenManifestLoaded.then(() => true, () => true), sleep(WALLET_LIST_WAIT_MS).then(() => false)])
      if (!listed) {
        console.warn('NEAR Connect: the wallet list did not load')
        return
      }
      walletId = await connector.selectWallet()
    } catch (e) {
      return quiet(e)
    } finally {
      setIsConnecting(false)
    }
    // Signs in with the chosen wallet; the wallet:signIn event sets the account.
    await connector.connect({ walletId }).catch(quiet)
  }, [connector])

  const signAndSendTransaction = useCallback(
    async (params: SignRequest): Promise<SignResult> => {
      if (mock?.isConnected) {
        // Headless mock: succeed without a wallet so UI flows can be driven end to end.
        console.log('[MockWallet] signAndSendTransaction', params.receiverId, params.actions)
        return { transaction: { hash: `mock-${Date.now().toString(36)}` } }
      }
      if (!connector) throw new Error('NEAR Connect not ready')
      const wallet = await connector.wallet()
      const actions = params.actions as Parameters<typeof wallet.signAndSendTransaction>[0]['actions']
      return (await wallet.signAndSendTransaction({ receiverId: params.receiverId, actions })) as unknown as SignResult
    },
    [connector, mock?.isConnected],
  )

  const disconnect = useCallback(async () => {
    if (!connector) return
    try {
      await connector.disconnect()
    } catch (e) {
      console.error('Wallet disconnect failed', e)
    } finally {
      setAccount(null)
    }
  }, [connector])

  const value = useMemo<WalletContextValue>(
    () => ({
      isConnected,
      accountId,
      isConnecting: isConnecting || isInitializing,
      connect,
      disconnect,
      signAndSendTransaction,
    }),
    [isConnected, accountId, isConnecting, isInitializing, connect, disconnect, signAndSendTransaction],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
