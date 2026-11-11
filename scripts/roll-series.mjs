// Deploy the next series of one tenor and add it to the app's series list, so a deposit window is always
// open. The next series' cutoff is the previous one's cutoff plus the tenor (weekly 7D cutoffs, monthly
// 30D cutoffs...), its maturity is one tenor later, and its deposit fee is about 1% a year.
//
//   node scripts/roll-series.mjs --tenor 7 [--dry-run]
//
// Series accounts are named stnear-<tenor>d-NN under NEAR_ACCOUNT. After a real run, rebuild the frontend:
// Vite reads VITE_SERIES_CONTRACTS at build time.
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { ROOT, accountExists, fmt, loadEnv, nearBalance, parse, view } from './near-lib.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 || !process.argv[i + 1] ? fallback : process.argv[i + 1]
}

const DAY_NS = 86_400_000_000_000n
const tenor = Number(arg('tenor'))
if (!Number.isInteger(tenor) || tenor < 1) throw new Error('--tenor <days> is required, e.g. --tenor 7')
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
const feeBps = Math.max(1, Math.round((100 * tenor) / 365))
const name = `stnear-${tenor}d-${String(seq).padStart(2, '0')}`
const accountId = `${name}.${parent}`

console.log(`next: ${accountId} · deposits ${dryRun ? 'would open' : 'open'} now until ${iso(cutoff)} · maturity ${iso(maturity)} · deposit fee ${feeBps} bps`)
console.log(`deployer ${parent}: ${fmt(await nearBalance(parent), 3)} NEAR (a series needs 2.85 NEAR plus fees)`)
if (await accountExists(accountId)) throw new Error(`${accountId} already exists`)
if (dryRun) process.exit(0)

execFileSync(
  process.execPath,
  [path.join(ROOT, 'scripts', 'deploy-series.mjs'), '--account', name, '--series-id', name, '--close', iso(cutoff), '--maturity', iso(maturity), '--fee-bps', String(feeBps)],
  { stdio: 'inherit' },
)

// Newest series first within its tenor, so the app's default is the one with the longest deposit window.
const ordered = [...listed]
const firstSameTenor = ordered.findIndex((id) => pattern.test(id))
ordered.splice(firstSameTenor === -1 ? ordered.length : firstSameTenor, 0, accountId)
const line = `VITE_SERIES_CONTRACTS=${ordered.join(',')}`
// .env.testnet (public, committed) holds the series list for dev, builds (Railway) and these scripts.
// A local .env is only updated if it still carries its own copy of the list.
for (const name of ['.env.testnet', '.env']) {
  const envFile = path.join(ROOT, 'yieldforge', name)
  if (!fs.existsSync(envFile)) continue
  const text = fs.readFileSync(envFile, 'utf8')
  const has = /^VITE_SERIES_CONTRACTS=.*$/m.test(text)
  if (!has && name === '.env') continue
  fs.writeFileSync(envFile, has ? text.replace(/^VITE_SERIES_CONTRACTS=.*$/m, line) : `${text.trimEnd()}\n${line}\n`)
  console.log(`updated yieldforge/${name}: ${line}`)
}
console.log('Commit and push yieldforge/.env.testnet so the app (and Railway) lists it.')
