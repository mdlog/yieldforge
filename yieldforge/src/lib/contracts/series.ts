import type { SeriesStatus, SeriesView, PositionView } from '@/types'
import { viewCall } from '@/lib/near/wallet'
import { getNearConfig } from '@/lib/near/config'
import { functionCall, ONE_YOCTO, tgas, type TxRequest } from '@/lib/near/tx'
import { pickOptional, pickString, type RawView } from './normalize'

const optionalNumber = (raw: RawView, key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : undefined)

export function normalizeSeries(raw: RawView): SeriesView {
  return {
    seriesId: pickString(raw, 'seriesId', 'series_id'),
    underlyingToken: pickString(raw, 'underlyingToken', 'underlying_token'),
    ptToken: pickString(raw, 'ptToken', 'pt_token'),
    ytToken: pickString(raw, 'ytToken', 'yt_token'),
    maturityAt: pickString(raw, 'maturityAt', 'maturity_at', '0'),
    depositsCloseAt: pickString(raw, 'depositsCloseAt', 'deposits_close_at', '0'),
    status: pickString(raw, 'status', 'status', 'Draft') as SeriesStatus,
    baselineRate: pickOptional(raw, 'baselineRate', 'baseline_rate'),
    baselineTimestamp: pickOptional(raw, 'baselineTimestamp', 'baseline_timestamp'),
    settlementRate: pickOptional(raw, 'settlementRate', 'settlement_rate'),
    settlementTimestamp: pickOptional(raw, 'settlementTimestamp', 'settlement_timestamp'),
    totalStNearDeposited: pickString(raw, 'totalStNearDeposited', 'total_stnear_deposited', '0'),
    totalPtMinted: pickString(raw, 'totalPtMinted', 'total_pt_minted', '0'),
    paused: raw.paused === true,
    depositFeeBps: optionalNumber(raw, 'deposit_fee_bps'),
    marketFeeBps: optionalNumber(raw, 'market_fee_bps'),
    minDeposit: pickOptional(raw, 'minDeposit', 'min_deposit'),
    escrowedYt: pickOptional(raw, 'escrowedYt', 'escrowed_yt'),
    ptSupply: pickOptional(raw, 'ptSupply', 'pt_supply'),
    ytSupply: pickOptional(raw, 'ytSupply', 'yt_supply'),
    feeBalance: pickOptional(raw, 'feeBalance', 'fee_balance'),
    ptPayoutPerUnit: pickOptional(raw, 'ptPayoutPerUnit', 'pt_payout_per_unit'),
    ytPayoutPerUnit: pickOptional(raw, 'ytPayoutPerUnit', 'yt_payout_per_unit'),
  }
}

export function normalizePosition(raw: RawView): PositionView {
  return {
    accountId: pickString(raw, 'accountId', 'account_id'),
    seriesId: pickString(raw, 'seriesId', 'series_id'),
    ptBalance: pickString(raw, 'ptBalance', 'pt_balance', '0'),
    ytBalance: pickString(raw, 'ytBalance', 'yt_balance', '0'),
    lockedStNear: pickString(raw, 'lockedStNear', 'locked_stnear', '0'),
    maturityAt: pickString(raw, 'maturityAt', 'maturity_at', '0'),
    redeemable: raw.redeemable === true,
    baselineRate: pickOptional(raw, 'baselineRate', 'baseline_rate'),
  }
}

export async function fetchSeries(contractId = getNearConfig().seriesContractId): Promise<SeriesView> {
  return normalizeSeries(await viewCall<RawView>(contractId, 'get_series', {}))
}

export async function fetchPosition(accountId: string, contractId = getNearConfig().seriesContractId): Promise<PositionView | null> {
  const raw = await viewCall<RawView | null>(contractId, 'get_position', { account_id: accountId })
  return raw ? normalizePosition(raw) : null
}

/** Deposit = stNEAR ft_transfer_call into the series (NEP-141). */
export function buildDepositTx(params: { amountYocto: string }): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.stNearContractId,
    // meta-v2.pool.testnet's ft_transfer_call needs more than 46 Tgas.
    actions: [functionCall('ft_transfer_call', { receiver_id: cfg.seriesContractId, amount: params.amountYocto, msg: '' }, tgas(55), ONE_YOCTO)],
  }
}

/** stNEAR that redeeming these amounts pays now; null until the series is settled. */
export async function fetchRedeemPreview(ptYocto: string, ytYocto: string): Promise<{ pt: string; yt: string } | null> {
  const cfg = getNearConfig()
  const r = await viewCall<[string, string] | null>(cfg.seriesContractId, 'preview_redeem', { pt_amount: ptYocto, yt_amount: ytYocto })
  return r ? { pt: r[0], yt: r[1] } : null
}

/** Permissionless after the deposit cutoff: reads the baseline rate from Meta Pool once. */
export function buildCaptureBaselineTx(): TxRequest {
  const cfg = getNearConfig()
  return { receiverId: cfg.seriesContractId, actions: [functionCall('capture_baseline', {}, tgas(50))] }
}

/** Permissionless after maturity: queries the Meta Pool rate and stores the settlement snapshot. */
export function buildRequestSettlementTx(): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.seriesContractId,
    actions: [functionCall('request_settlement', {}, tgas(50))],
  }
}

/** Burns the claim and pays stNEAR via Meta Pool's ft_transfer; the claim is restored if that transfer fails. */
export function buildRedeemTx(params: { amountYocto: string; isPt: boolean }): TxRequest {
  const cfg = getNearConfig()
  return {
    receiverId: cfg.seriesContractId,
    actions: [functionCall(params.isPt ? 'redeem_pt' : 'redeem_yt', { amount: params.amountYocto }, tgas(50), ONE_YOCTO)],
  }
}
