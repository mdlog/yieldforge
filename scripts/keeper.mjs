// One pass over every series in VITE_SERIES_CONTRACTS: record R0 once the deposit cutoff has passed and
// RT once maturity has passed. Both calls are permissionless and idempotent, so this is safe to run on a
// schedule (Task Scheduler, cron) — R0 is fairest when captured right after the cutoff.
//
//   node scripts/keeper.mjs            act on every series that is due
//   node scripts/keeper.mjs --dry-run  only report what is due
import { TGAS, callFn, connectAs, explorer, fmt, loadEnv, rpc, view } from './near-lib.mjs'

const dryRun = process.argv.includes('--dry-run')
const env = loadEnv()
const ids = (env.VITE_SERIES_CONTRACTS || env.VITE_SERIES_CONTRACT || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (ids.length === 0) throw new Error('No series configured (VITE_SERIES_CONTRACTS or VITE_SERIES_CONTRACT in yieldforge/.env)')

const iso = (nanos) => new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString()
// Due-ness follows the chain's clock, not this machine's.
const block = await rpc('block', { finality: 'final' })
const chainNow = BigInt(block.header.timestamp_nanosec ?? block.header.timestamp)
console.log(`chain time ${iso(chainNow)} · ${ids.length} series${dryRun ? ' · dry run' : ''}`)

let caller = null
async function call(id, method) {
  if (dryRun) return console.log(`  would call ${method}`)
  if (!caller) {
    const { account, env: e } = await connectAs([])
    caller = await account(e.NEAR_ACCOUNT)
  }
  try {
    const r = await callFn(caller, id, method, {}, { gas: 60n * TGAS })
    console.log(`  ${method}: ${explorer(r.hash)} · callback returned ${JSON.stringify(r.value)}`)
  } catch (e) {
    console.log(`  ${method} failed: ${e.message}${e.hash ? ` · ${explorer(e.hash)}` : ''}`)
  }
}

for (const id of ids) {
  const s = await view(id, 'get_series').catch((e) => {
    console.log(`${id}: unreadable (${e.message})`)
    return null
  })
  if (!s) continue
  console.log(`${s.series_id} · ${s.status} · cutoff ${iso(s.deposits_close_at)} · maturity ${iso(s.maturity_at)}`)
  if (!s.baseline_rate && chainNow >= BigInt(s.deposits_close_at)) await call(id, 'capture_baseline')
  if (!s.settlement_rate && chainNow >= BigInt(s.maturity_at)) await call(id, 'request_settlement')
  const after = dryRun ? s : await view(id, 'get_series')
  console.log(`  R0 ${after.baseline_rate ? fmt(after.baseline_rate, 6) : '—'} · RT ${after.settlement_rate ? fmt(after.settlement_rate, 6) : '—'}`)
}
