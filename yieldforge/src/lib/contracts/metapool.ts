import { viewCall } from '@/lib/near/wallet'
import { getNearConfig } from '@/lib/near/config'
import { functionCall, tgas, type TxRequest } from '@/lib/near/tx'

/** Meta Pool's minimum stake (min_deposit_amount). */
export const MIN_STAKE_YOCTO = 10n ** 24n

/**
 * NEAR that `deposit_and_stake` keeps for storage before staking: Meta Pool's storage minimum while the wallet is
 * unregistered (0.00125 NEAR on mainnet), 0 after. Throws if either view fails, so the caller can stop.
 */
export async function getStakeStorageFee(accountId: string): Promise<bigint> {
  const cfg = getNearConfig()
  const registered = await viewCall<unknown>(cfg.stNearContractId, 'storage_balance_of', { account_id: accountId })
  if (registered != null) return 0n
  const bounds = await viewCall<{ min: string }>(cfg.stNearContractId, 'storage_balance_bounds', {})
  return BigInt(bounds.min)
}

/** NEAR value of one stNEAR, scaled by 1e24. */
export function getStNearPrice(): Promise<string> {
  const cfg = getNearConfig()
  return viewCall<string>(cfg.stNearContractId, 'get_st_near_price', {})
}

/** stNEAR held by any account, e.g. a series contract's collateral. */
export function getStNearBalance(accountId: string): Promise<string> {
  const cfg = getNearConfig()
  return viewCall<string>(cfg.stNearContractId, 'ft_balance_of', { account_id: accountId })
}

/** Stake NEAR for stNEAR (testnet helper — metapool.app only serves mainnet). */
export function buildStakeTx(amountYocto: string): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.stNearContractId,
    actions: [functionCall('deposit_and_stake', {}, tgas(50), amountYocto)],
  }
}
