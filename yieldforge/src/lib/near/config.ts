export type NearNetwork = 'testnet' | 'mainnet'

export interface NearConfig {
  network: NearNetwork
  nodeUrl: string
  explorerUrl: string
  nearBlocksApiUrl: string
  stNearContractId: string
  seriesContractId: string
  ptTokenContractId: string
  ytTokenContractId: string
  marketplaceContractId: string
}

const TESTNET: NearConfig = {
  network: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  explorerUrl: 'https://testnet.nearblocks.io',
  nearBlocksApiUrl: 'https://api-testnet.nearblocks.io',
  stNearContractId: 'meta-v2.pool.testnet',
  seriesContractId: 'series.yieldforge.testnet',
  ptTokenContractId: 'pt.yieldforge.testnet',
  ytTokenContractId: 'yt.yieldforge.testnet',
  marketplaceContractId: 'market.yieldforge.testnet',
}

const MAINNET: NearConfig = {
  network: 'mainnet',
  // rpc.mainnet.near.org rate-limits hard (429s); FastNEAR is the RPC the scripts and keeper use too.
  nodeUrl: 'https://rpc.mainnet.fastnear.com',
  explorerUrl: 'https://nearblocks.io',
  nearBlocksApiUrl: 'https://api.nearblocks.io',
  stNearContractId: 'meta-pool.near',
  seriesContractId: 'series.yieldforge.near',
  ptTokenContractId: 'pt.yieldforge.near',
  ytTokenContractId: 'yt.yieldforge.near',
  marketplaceContractId: 'market.yieldforge.near',
}

/**
 * Series the app lists, in display order: a comma-separated list wins over the single-series setting,
 * which wins over the network default. Blank entries and duplicates are dropped.
 */
export function parseSeriesList(list: string | undefined, single: string | undefined, fallback: string): string[] {
  const ids = (list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (ids.length > 0) return [...new Set(ids)]
  return [single?.trim() || fallback]
}

function networkBase(): NearConfig {
  const envNetwork = (import.meta.env.VITE_NEAR_NETWORK as string | undefined)?.toLowerCase()
  return envNetwork === 'mainnet' ? MAINNET : TESTNET
}

export function seriesContractIds(): string[] {
  return parseSeriesList(
    import.meta.env.VITE_SERIES_CONTRACTS as string | undefined,
    import.meta.env.VITE_SERIES_CONTRACT as string | undefined,
    networkBase().seriesContractId,
  )
}

// The series the app pages act on. Set by SeriesProvider; pages remount when it changes.
let activeSeriesContract: string | null = null

export function setActiveSeriesContract(contractId: string): void {
  activeSeriesContract = contractId
}

export function getNearConfig(): NearConfig {
  const base = networkBase()

  // Env overrides; unset or empty values keep the network default.
  const overrides: Partial<NearConfig> = {
    stNearContractId: import.meta.env.VITE_STNEAR_CONTRACT as string | undefined,
    seriesContractId: import.meta.env.VITE_SERIES_CONTRACT as string | undefined,
    ptTokenContractId: import.meta.env.VITE_PT_CONTRACT as string | undefined,
    ytTokenContractId: import.meta.env.VITE_YT_CONTRACT as string | undefined,
    marketplaceContractId: import.meta.env.VITE_MARKETPLACE_CONTRACT as string | undefined,
    nodeUrl: import.meta.env.VITE_NEAR_NODE_URL as string | undefined,
  }

  const set = (v: string | undefined) => typeof v === 'string' && v.length > 0
  const merged: NearConfig = {
    ...base,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => set(v))),
  }
  // With a series list, every per-series contract follows the active series.
  if (set(import.meta.env.VITE_SERIES_CONTRACTS as string | undefined)) {
    const ids = seriesContractIds()
    const active = activeSeriesContract && ids.includes(activeSeriesContract) ? activeSeriesContract : ids[0]!
    merged.seriesContractId = merged.ytTokenContractId = merged.ptTokenContractId = merged.marketplaceContractId = active
    return merged
  }
  // v2 series contracts are also the YT token, the PT ledger and the marketplace.
  if (set(overrides.seriesContractId)) {
    if (!set(overrides.ytTokenContractId)) merged.ytTokenContractId = merged.seriesContractId
    if (!set(overrides.ptTokenContractId)) merged.ptTokenContractId = merged.seriesContractId
    if (!set(overrides.marketplaceContractId)) merged.marketplaceContractId = merged.seriesContractId
  }
  return merged
}

export function explorerTxUrl(hash: string, config = getNearConfig()): string {
  return `${config.explorerUrl}/txns/${hash}`
}

export function explorerAccountUrl(accountId: string, config = getNearConfig()): string {
  return `${config.explorerUrl}/address/${accountId}`
}
