import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AccountState, WalletSelector } from '@near-wallet-selector/core'
import { getNearConfig } from '@/lib/near/config'

type SignResult = { transaction: { hash: string } } & Record<string, unknown>
type SignRequest = { receiverId: string; actions: unknown[] }

interface WalletContextValue {
  isConnected: boolean
  accountId: string | null
  isConnecting: boolean
  selector: WalletSelector | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  signAndSendTransaction: (params: SignRequest) => Promise<SignResult>
}

/** Minimal surface of a wallet-selector wallet that we call; the library's union types are awkward to narrow. */
interface SigningWallet {
  signIn: (params: { contractId: string }) => Promise<unknown>
  signOut: () => Promise<void>
  signAndSendTransaction: (params: { receiverId: string; actions: unknown[] }) => Promise<SignResult>
}

const PREFERRED_WALLETS = ['meteor-wallet', 'my-near-wallet', 'hot-wallet'] as const

const WalletContext = createContext<WalletContextValue | null>(null)

/**
 * Test-only wallet injection (window.__YF_MOCK_WALLET) for headless checks.
 * Enabled on the dev server, or in a build explicitly flagged with VITE_E2E_MOCK=true — never in production.
 */
function readMockWallet(): { isConnected?: boolean; accountId?: string } | undefined {
  if (!(import.meta.env.DEV || import.meta.env.VITE_E2E_MOCK === 'true') || typeof window === 'undefined') return undefined
  return (window as unknown as { __YF_MOCK_WALLET?: { isConnected?: boolean; accountId?: string } }).__YF_MOCK_WALLET
}

// Wallet-selector v10 + @near-js/transactions expect NAJ actions ({functionCall:{...}}), while our builders
// produce wallet-selector internal {type:'FunctionCall',params:{...}}. Convert so Meteor and MyNearWallet both work.
function toNajActions(actions: unknown[]): unknown[] {
  return actions.map((a) => {
    const act = a as Record<string, unknown>
    if (act.functionCall || act.transfer) return act
    if (act.type === 'FunctionCall' && act.params) {
      const p = act.params as { methodName: string; args: unknown; gas: string | number | bigint; deposit: string | number | bigint }
      // Meteor's najActionToInternal expects args as JSON bytes; Buffer is polyfilled during wallet init.
      let argsBytes: Uint8Array
      if (p.args instanceof Uint8Array) argsBytes = p.args
      else if (typeof p.args === 'string') argsBytes = Buffer.from(p.args)
      else argsBytes = Buffer.from(JSON.stringify(p.args ?? {}))
      return { functionCall: { methodName: p.methodName, args: argsBytes, gas: BigInt(p.gas), deposit: BigInt(p.deposit) } }
    }
    if (act.type === 'Transfer' && act.params) {
      const p = act.params as { deposit: string | number | bigint }
      return { transfer: { deposit: BigInt(p.deposit) } }
    }
    // Unknown — pass through and let the wallet throw with a clear message.
    return act
  })
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null)
  const [accounts, setAccounts] = useState<AccountState[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)
  const cfg = getNearConfig()

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    // Loaded lazily: wallet-selector, near-api-js, and the Buffer polyfill they need are most of the bundle
    // and aren't needed for first paint. Buffer must be global before the wallet modules evaluate.
    import('buffer')
      .then(({ Buffer: BufferPolyfill }) => {
        const g = globalThis as unknown as { Buffer?: typeof BufferPolyfill }
        g.Buffer ??= BufferPolyfill
        return Promise.all([
          import('@near-wallet-selector/core'),
          import('@near-wallet-selector/my-near-wallet'),
          import('@near-wallet-selector/meteor-wallet'),
          import('@near-wallet-selector/hot-wallet'),
        ])
      })
      .then(([{ setupWalletSelector }, { setupMyNearWallet }, { setupMeteorWallet }, { setupHotWallet }]) =>
        setupWalletSelector({ network: cfg.network, modules: [setupMyNearWallet(), setupMeteorWallet(), setupHotWallet()] }),
      )
      .then((sel) => {
        if (cancelled) return
        setSelector(sel)
        setAccounts(sel.store.getState().accounts)
        const subscription = sel.store.observable.subscribe((state) => setAccounts(state.accounts))
        unsubscribe = () => subscription.unsubscribe()
      })
      .catch((e: unknown) => console.error('[WalletSelector] init failed', e))
      .finally(() => {
        if (!cancelled) setIsInitializing(false)
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [cfg.network])

  const mock = readMockWallet()
  const isConnected = mock?.isConnected ?? Boolean(accounts[0]?.accountId)
  const accountId = mock?.accountId ?? accounts[0]?.accountId ?? null

  const getWallet = useCallback(
    async (walletId?: string | null): Promise<SigningWallet> => {
      if (!selector) throw new Error('WalletSelector not ready')
      const id = walletId ?? selector.store.getState().selectedWalletId ?? PREFERRED_WALLETS[0]
      return (await selector.wallet(id)) as unknown as SigningWallet
    },
    [selector],
  )

  const connect = useCallback(async () => {
    if (!selector) {
      console.warn('WalletSelector not ready')
      return
    }
    setIsConnecting(true)
    try {
      // Prefer Meteor; fall back to MyNearWallet, then HOT.
      let wallet: SigningWallet | null = null
      for (const id of PREFERRED_WALLETS) {
        try {
          wallet = await getWallet(id)
          break
        } catch {
          // try the next wallet
        }
      }
      if (!wallet) throw new Error('No supported NEAR wallet is available')
      await wallet.signIn({ contractId: cfg.seriesContractId })
    } catch (e) {
      console.error('Wallet connect failed', e)
    } finally {
      setIsConnecting(false)
    }
  }, [selector, getWallet, cfg.seriesContractId])

  const signAndSendTransaction = useCallback(
    async (params: SignRequest): Promise<SignResult> => {
      if (mock?.isConnected) {
        // Headless mock: succeed without a wallet so UI flows can be driven end to end.
        console.log('[MockWallet] signAndSendTransaction', params.receiverId, params.actions)
        return { transaction: { hash: `mock-${Date.now().toString(36)}` } }
      }
      const wallet = await getWallet()
      return wallet.signAndSendTransaction({ receiverId: params.receiverId, actions: toNajActions(params.actions) })
    },
    [getWallet, mock?.isConnected],
  )

  const disconnect = useCallback(async () => {
    if (!selector) return
    try {
      await (await getWallet()).signOut()
    } catch (e) {
      console.error('Wallet disconnect failed', e)
    } finally {
      setAccounts([])
    }
  }, [selector, getWallet])

  const value = useMemo<WalletContextValue>(
    () => ({
      isConnected,
      accountId,
      isConnecting: isConnecting || isInitializing,
      selector,
      connect,
      disconnect,
      signAndSendTransaction,
    }),
    [isConnected, accountId, isConnecting, isInitializing, selector, connect, disconnect, signAndSendTransaction],
  )

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
