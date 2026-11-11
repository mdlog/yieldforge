// Keeper: one pass over the configured series. It records R0 once a deposit cutoff has passed and RT once
// maturity has passed. Both calls are permissionless and idempotent, so any account can run this on a
// schedule. The hosted copy is a Railway cron service (`npm run keeper`) signing with a dedicated, low-balance
// keeper account; scripts/keeper.mjs runs the same code locally.
//
//   npm run keeper                  act on every series that is due (needs KEEPER_ACCOUNT, KEEPER_PRIVATE_KEY)
//   npm run keeper -- --dry-run     only report what is due (no key needed)
//
// Series and RPC come from VITE_SERIES_CONTRACTS / VITE_NEAR_NODE_URL in the environment, else from
// .env.testnet next to this file. The key is never printed. Each run also checks that the key is on chain for
// KEEPER_ACCOUNT, and exits non-zero if it is not or a due call fails.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, keyStores, KeyPair, transactions } from 'near-api-js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dryRun = process.argv.includes('--dry-run')
const TGAS = 10n ** 12n
const YOCTO = 10n ** 24n

function fileEnv(name) {
  const file = path.join(here, name)
  const env = {}
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = { ...fileEnv('.env.testnet'), ...process.env }
const networkId = env.VITE_NEAR_NETWORK || 'testnet'
const nodeUrl = env.VITE_NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com'
const ids = (env.VITE_SERIES_CONTRACTS || env.VITE_SERIES_CONTRACT || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (ids.length === 0) throw new Error('No series configured (VITE_SERIES_CONTRACTS)')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const iso = (nanos) => new Date(Number(BigInt(nanos) / 1_000_000n)).toISOString()
const rate = (yocto) => {
  const v = BigInt(yocto)
  return `${v / YOCTO}.${(v % YOCTO).toString().padStart(24, '0').slice(0, 6)}`
}

// Public RPCs rate-limit bursts; a scheduled run should ride that out rather than skip a due call.
async function rpc(method, params) {
  let last
  for (const wait of [0, 1000, 3000, 8000]) {
    if (wait) await sleep(wait)
    try {
      const res = await fetch(nodeUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      if (res.status === 429 || res.status >= 500) throw new Error(`RPC ${res.status}`)
      const json = await res.json()
      if (json.error) throw new Error(JSON.stringify(json.error))
      return json.result
    } catch (e) {
      last = e
    }
  }
  throw last
}

async function view(contractId, method) {
  const r = await rpc('query', { request_type: 'call_function', account_id: contractId, method_name: method, args_base64: 'e30=', finality: 'optimistic' })
  return JSON.parse(Buffer.from(r.result).toString())
}

let signer = null
async function getSigner() {
  if (signer) return signer
  const accountId = env.KEEPER_ACCOUNT
  const key = env.KEEPER_PRIVATE_KEY
  if (!accountId || !key) throw new Error('KEEPER_ACCOUNT / KEEPER_PRIVATE_KEY are not set')
  const keyStore = new keyStores.InMemoryKeyStore()
  await keyStore.setKey(networkId, accountId, KeyPair.fromString(key))
  const near = await connect({ networkId, nodeUrl, keyStore })
  signer = await near.account(accountId)
  return signer
}

let failures = 0
async function call(contractId, method) {
  if (dryRun) return console.log(`  would call ${method}`)
  try {
    const account = await getSigner()
    const outcome = await account.signAndSendTransaction({
      receiverId: contractId,
      actions: [transactions.functionCall(method, Buffer.from('{}'), 60n * TGAS, 0n)],
    })
    const failed = [outcome.status, ...(outcome.receipts_outcome ?? []).map((r) => r.outcome?.status)].find((s) => s?.Failure)
    const link = `https://testnet.nearblocks.io/txns/${outcome.transaction.hash}`
    if (failed) throw Object.assign(new Error(JSON.stringify(failed.Failure)), { link })
    console.log(`  ${method}: ${link}`)
  } catch (e) {
    failures++
    console.log(`  ${method} failed: ${e.message}${e.link ? ` · ${e.link}` : ''}`)
  }
}

// Prove on every run, without a transaction, that the key can sign for the keeper account, so a bad key
// shows up as a failed run long before a cutoff is due.
async function checkSigner() {
  const accountId = env.KEEPER_ACCOUNT
  const key = env.KEEPER_PRIVATE_KEY
  if (!accountId || !key) {
    failures++
    return console.log('signer: KEEPER_ACCOUNT / KEEPER_PRIVATE_KEY are not set, so due calls would fail')
  }
  const publicKey = KeyPair.fromString(key).getPublicKey().toString()
  try {
    const access = await rpc('query', { request_type: 'view_access_key', account_id: accountId, public_key: publicKey, finality: 'final' })
    if (access.error) throw new Error(access.error)
    const account = await rpc('query', { request_type: 'view_account', account_id: accountId, finality: 'final' })
    console.log(`signer ${accountId} · key ${publicKey} is on chain · balance ${rate(account.amount)} NEAR`)
  } catch (e) {
    failures++
    console.log(`signer ${accountId}: key ${publicKey} not usable (${e.message})`)
  }
}

// Due-ness follows the chain's clock, not this machine's.
const block = await rpc('block', { finality: 'final' })
const chainNow = BigInt(block.header.timestamp_nanosec ?? block.header.timestamp)
console.log(`chain time ${iso(chainNow)} · ${ids.length} series${dryRun ? ' · dry run' : ''}`)
if (!dryRun) await checkSigner()

for (const id of ids) {
  const s = await view(id, 'get_series').catch((e) => {
    failures++
    console.log(`${id}: unreadable (${e.message})`)
    return null
  })
  if (!s) continue
  console.log(`${s.series_id} · ${s.status} · cutoff ${iso(s.deposits_close_at)} · maturity ${iso(s.maturity_at)}`)
  const dueBaseline = !s.baseline_rate && chainNow >= BigInt(s.deposits_close_at)
  const dueSettlement = !s.settlement_rate && chainNow >= BigInt(s.maturity_at)
  if (dueBaseline) await call(id, 'capture_baseline')
  if (dueSettlement) await call(id, 'request_settlement')
  const after = dryRun || !(dueBaseline || dueSettlement) ? s : await view(id, 'get_series').catch(() => s)
  console.log(`  R0 ${after.baseline_rate ? rate(after.baseline_rate) : '—'} · RT ${after.settlement_rate ? rate(after.settlement_rate) : '—'}`)
}
if (failures) process.exitCode = 1
