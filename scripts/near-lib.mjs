// Shared helpers for the deploy / e2e scripts. Credentials come from yieldforge/.env
// (NEAR_ACCOUNT, NEAR_PRIVATE_KEY) and are never printed.
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..')
const require = createRequire(path.join(ROOT, 'yieldforge', 'package.json'))
export const nearApi = require('near-api-js')
const { connect, keyStores, KeyPair, transactions } = nearApi

export const NETWORK = 'testnet'
export const STNEAR = 'meta-v2.pool.testnet'
export const YOCTO = 10n ** 24n
export const TGAS = 10n ** 12n

/**
 * yieldforge/.env (local, git-ignored: the deploy key) merged with yieldforge/.env.testnet (public app
 * config, committed). As in Vite's testnet mode, values in .env.testnet win for the keys it sets.
 */
export function loadEnv() {
  const read = (name) => {
    const file = path.join(ROOT, 'yieldforge', name)
    const env = {}
    if (!fs.existsSync(file)) return env
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
    return env
  }
  const env = { ...read('.env'), ...read('.env.testnet') }
  if (!env.NEAR_ACCOUNT || !env.NEAR_PRIVATE_KEY) throw new Error('NEAR_ACCOUNT / NEAR_PRIVATE_KEY missing in yieldforge/.env')
  return env
}

export function nodeUrl(env = loadEnv()) {
  return env.VITE_NEAR_NODE_URL || 'https://rpc.testnet.fastnear.com'
}

/** Connection whose key store signs for the deployer and any of its sub-accounts (same key). */
export async function connectAs(accountIds) {
  const env = loadEnv()
  const keyPair = KeyPair.fromString(env.NEAR_PRIVATE_KEY)
  const keyStore = new keyStores.InMemoryKeyStore()
  for (const id of new Set([env.NEAR_ACCOUNT, ...accountIds])) await keyStore.setKey(NETWORK, id, keyPair)
  const near = await connect({ networkId: NETWORK, nodeUrl: nodeUrl(env), keyStore })
  return { near, env, publicKey: keyPair.getPublicKey(), account: (id) => near.account(id) }
}

export async function rpc(method, params) {
  const res = await fetch(nodeUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const json = await res.json()
  if (json.error) throw new Error(JSON.stringify(json.error))
  return json.result
}

export async function view(contractId, method, args = {}) {
  const result = await rpc('query', { request_type: 'call_function', account_id: contractId, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'), finality: 'optimistic' })
  if (result.error) throw new Error(result.error)
  return JSON.parse(Buffer.from(result.result).toString())
}

export async function accountExists(accountId) {
  try {
    await rpc('query', { request_type: 'view_account', account_id: accountId, finality: 'final' })
    return true
  } catch {
    return false
  }
}

export async function nearBalance(accountId) {
  const r = await rpc('query', { request_type: 'view_account', account_id: accountId, finality: 'optimistic' })
  return BigInt(r.amount)
}

export const fmt = (yocto, digits = 6) => {
  const v = BigInt(yocto)
  const neg = v < 0n
  const a = neg ? -v : v
  return `${neg ? '-' : ''}${a / YOCTO}.${(a % YOCTO).toString().padStart(24, '0').slice(0, digits)}`
}
export const parse = (decimal) => {
  const [w, f = ''] = String(decimal).split('.')
  return BigInt(w) * YOCTO + BigInt((f + '0'.repeat(24)).slice(0, 24))
}
export const explorer = (hash) => `https://testnet.nearblocks.io/txns/${hash}`

/** Sign a function call; returns { hash, value } or throws with the contract's panic message. */
export async function callFn(account, contractId, methodName, args, { gas = 30n * TGAS, deposit = 0n } = {}) {
  const outcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [transactions.functionCall(methodName, Buffer.from(JSON.stringify(args)), gas, deposit)],
  })
  const failure = findFailure(outcome)
  if (failure) throw Object.assign(new Error(`${methodName} failed: ${failure}`), { hash: outcome.transaction.hash })
  const raw = outcome.status?.SuccessValue
  let value = null
  if (raw) {
    try {
      value = JSON.parse(Buffer.from(raw, 'base64').toString())
    } catch {
      value = Buffer.from(raw, 'base64').toString()
    }
  }
  return { hash: outcome.transaction.hash, value, outcome }
}

/** Any failed receipt in the outcome tree (async callbacks included), as a readable string. */
export function findFailure(outcome) {
  if (outcome.status?.Failure) return JSON.stringify(outcome.status.Failure)
  for (const r of outcome.receipts_outcome ?? []) {
    const f = r.outcome?.status?.Failure
    if (f) return JSON.stringify(f)
  }
  return null
}

export function logsOf(outcome) {
  return [...(outcome.transaction_outcome?.outcome?.logs ?? []), ...(outcome.receipts_outcome ?? []).flatMap((r) => r.outcome.logs)]
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Meta Pool's stNEAR (NEP-145) only sends to registered accounts: register `accountId` if needed. */
export async function ensureStNearStorage(payer, accountId) {
  const existing = await view(STNEAR, 'storage_balance_of', { account_id: accountId })
  if (existing) return null
  const bounds = await view(STNEAR, 'storage_balance_bounds')
  return callFn(payer, STNEAR, 'storage_deposit', { account_id: accountId, registration_only: true }, { gas: 30n * TGAS, deposit: BigInt(bounds.min) })
}
