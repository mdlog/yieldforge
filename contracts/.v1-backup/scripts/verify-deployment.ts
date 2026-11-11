/**
 * Verify YieldForge contracts on testnet — read-only checks against live RPC.
 * Run: npx tsx scripts/verify-deployment.ts
 */
import { getNearConfig } from '../yieldforge/src/lib/near/config'

async function view(contractId: string, method: string, args: Record<string, unknown> = {}) {
  const cfg = getNearConfig()
  const res = await fetch(cfg.nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'verify',
      method: 'query',
      params: {
        request_type: 'call_function',
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        finality: 'final',
      },
    }),
  })
  const json: any = await res.json()
  if (json.error) throw new Error(JSON.stringify(json.error))
  const str = Buffer.from(json.result.result).toString()
  return JSON.parse(str)
}

async function main() {
  const cfg = getNearConfig()
  console.log('Network:', cfg.network)
  console.log('Node:', cfg.nodeUrl)
  console.log('Series:', cfg.seriesContractId)
  console.log('stNEAR:', cfg.stNearContractId)
  console.log('Market:', cfg.marketplaceContractId)

  try {
    console.log('\n--- stNEAR get_st_near_price ---')
    const price = await view(cfg.stNearContractId, 'get_st_near_price')
    console.log('stNEAR price:', price)
  } catch (e) {
    console.log('stNEAR price unavailable (contract not deployed or method name differs):', (e as Error).message)
  }

  try {
    console.log('\n--- Series get_series ---')
    const series = await view(cfg.seriesContractId, 'get_series')
    console.log(JSON.stringify(series, null, 2))
  } catch (e) {
    console.log('Series not deployed yet (expected before deploy):', (e as Error).message)
  }

  try {
    console.log('\n--- Marketplace get_listings ---')
    const listings = await view(cfg.marketplaceContractId, 'get_listings', { from_index: '0', limit: 5 })
    console.log(JSON.stringify(listings, null, 2))
  } catch (e) {
    console.log('Marketplace not deployed yet:', (e as Error).message)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
