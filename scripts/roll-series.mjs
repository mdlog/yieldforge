// Deploy the next series of one tenor and add it to the app's series list, so a deposit window is always
// open. The next series' cutoff is the previous one's cutoff plus the tenor (weekly 7D cutoffs, monthly
// 30D cutoffs...), its maturity is one tenor later, and its deposit fee is a yearly rate pro-rated to the
// tenor: 1%/yr on testnet, 0.5%/yr on mainnet (override with --fee-apr <percent>).
//
//   node scripts/roll-series.mjs --tenor 7 [--fee-apr 0.5] [--cap 100] [--min-deposit 1] [--dry-run]
//
// Mainnet only allows tenors of 7 days or more: on a 1-day series the fee and the round trip eat the yield.
//
// Series accounts are named stnear-<tenor>d-NN under NEAR_ACCOUNT. After a real run, rebuild the frontend:
// Vite reads VITE_SERIES_CONTRACTS at build time.
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { APP_ENV_FILE, NETWORK, ROOT, SECRET_ENV_FILE, accountExists, fmt, loadEnv, nearBalance, parse, view } from './near-lib.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 || !process.argv[i + 1] ? fallback : process.argv[i + 1]
}

const DAY_NS = 86_400_000_000_000n
const tenor = Number(arg('tenor'))
if (!Number.isInteger(tenor) || tenor < 1) throw new Error('--tenor <days> is required, e.g. --tenor 7')
if (NETWORK === 'mainnet' && tenor < 7) throw new Error('Mainnet series need --tenor 7 or more')
const feeApr = Number(arg('fee-apr', NETWORK === 'mainnet' ? '0.5' : '1'))
if (!Number.isFinite(feeApr) || feeApr < 0 || feeApr > 5) throw new Error('--fee-apr is a yearly percent between 0 and 5')
const dryRun = process.argv.includes('--dry-run')
const env = loadEnv()
const parent = env.NEAR_ACCOUNT
const listed = (env.VITE_SERIES_CONTRACTS || env.VITE_SERIES_CONTRACT || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Latest series of this tenor, by its sequence number.
const pattern = new RegExp(`^stnear-${tenor}d-(\\d+)\\.${parent.replace(/\./g, '\\.')}$`)
const sameTenor = listed
  .map((id) => ({ id, seq: Number(id.match(pattern)?.[1] ?? NaN) }))
  .filter((s) => Number.isFinite(s.seq))
  .sort((a, b) => b.seq - a.seq)
const iso = (nanos) => new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString()
const nowNs = BigInt(Date.now()) * 1_000_000n

let cutoff
let seq
if (sameTenor[0]) {
  const prev = await view(sameTenor[0].id, 'get_series')
  cutoff = BigInt(prev.deposits_close_at) + BigInt(tenor) * DAY_NS
  seq = sameTenor[0].seq + 1
  console.log(`previous ${tenor}D series: ${sameTenor[0].id} · cutoff ${iso(prev.deposits_close_at)}`)
} else {
  // First series of this tenor: a deposit window of at least two days, cut off at 00:00 UTC.
  const day = new Date(Date.now() + 2 * 86_400_000)
  cutoff = BigInt(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1)) * 1_000_000n
  seq = 1
}
// Never schedule a cutoff that has already passed.
while (cutoff <= nowNs) cutoff += BigInt(tenor) * DAY_NS
const maturity = cutoff + BigInt(tenor) * DAY_NS
const feeBps = feeApr === 0 ? 0 : Math.max(1, Math.round((feeApr * 100 * tenor) / 365))
const name = `stnear-${tenor}d-${String(seq).padStart(2, '0')}`
const accountId = `${name}.${parent}`

console.log(`next: ${accountId} · deposits ${dryRun ? 'would open' : 'open'} now until ${iso(cutoff)} · maturity ${iso(maturity)} · deposit fee ${feeBps} bps`)
console.log(`deployer ${parent}: ${fmt(await nearBalance(parent), 3)} NEAR (a series needs about 3.1 NEAR plus 0.005 per depositor the cap allows)`)
if (await accountExists(accountId)) throw new Error(`${accountId} already exists`)
if (dryRun) process.exit(0)

execFileSync(
  process.execPath,
  [path.join(ROOT, 'scripts', 'deploy-series.mjs'), '--account', name, '--series-id', name, '--close', iso(cutoff), '--maturity', iso(maturity), '--fee-bps', String(feeBps), ...['cap', 'min-deposit'].flatMap((k) => (arg(k) ? [`--${k}`, arg(k)] : []))],
  { stdio: 'inherit' },
)

// Newest series first within its tenor, so the app's default is the one with the longest deposit window.
const ordered = [...listed]
const firstSameTenor = ordered.findIndex((id) => pattern.test(id))
ordered.splice(firstSameTenor === -1 ? ordered.length : firstSameTenor, 0, accountId)
const line = `VITE_SERIES_CONTRACTS=${ordered.join(',')}`
// .env.<network> (public, committed) holds the series list for dev, builds (Railway) and these scripts.
// The network's local secrets file (.env on testnet, .env.mainnet.local on mainnet) is only updated if it still
// carries its own copy of the list; the other network's files are never touched.
for (const name of [APP_ENV_FILE, SECRET_ENV_FILE]) {
  const envFile = path.join(ROOT, 'yieldforge', name)
  if (!fs.existsSync(envFile)) continue
  const text = fs.readFileSync(envFile, 'utf8')
  const has = /^VITE_SERIES_CONTRACTS=.*$/m.test(text)
  if (!has && name === SECRET_ENV_FILE) continue
  fs.writeFileSync(envFile, has ? text.replace(/^VITE_SERIES_CONTRACTS=.*$/m, line) : `${text.trimEnd()}\n${line}\n`)
  console.log(`updated yieldforge/${name}: ${line}`)
}
console.log(`Commit and push yieldforge/${APP_ENV_FILE} so the app (and Railway) lists it.`)
