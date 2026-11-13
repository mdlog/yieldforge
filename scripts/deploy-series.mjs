// Create a sub-account of NEAR_ACCOUNT, deploy the v3 series contract, and initialize it — one atomic
// transaction, so a failed `new` leaves no half-initialized account behind.
//
//   node scripts/deploy-series.mjs --account yf-90d-02 --series-id stnear-90d-02 \
//     --close 2026-11-11T00:00:00Z --maturity 2027-02-09T00:00:00Z [--fee-bps 25] [--cap 100] [--min-deposit 1] [--balance N]
//
// Mainnet: NEAR_NETWORK=mainnet node scripts/deploy-series.mjs ... (key in yieldforge/.env.mainnet.local).
// --cap is the most stNEAR the series accepts in total (required on mainnet: the contract is unaudited).
// --min-deposit is the smallest deposit in stNEAR (default 1 on mainnet, 0.01 on testnet, never below 0.01).
//   The series pays the storage of every new depositor (~375 bytes), so the minimum bounds that cost.
// --balance defaults to the storage the code needs (1 NEAR per 100 kB) plus 0.15 NEAR for state, plus a
//   reserve of 0.005 NEAR for each depositor the cap allows (cap / min-deposit).
//
// Times may also be relative: --close +6m --maturity +12m
import fs from 'fs'
import path from 'path'
import { NETWORK, ROOT, STNEAR, TGAS, accountExists, connectAs, ensureStNearStorage, explorer, fmt, nearApi, nearBalance, parse, view } from './near-lib.mjs'

const { transactions } = nearApi

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || !process.argv[i + 1]) {
    if (fallback === undefined) throw new Error(`--${name} is required`)
    return fallback
  }
  return process.argv[i + 1]
}

function toNanos(value) {
  const rel = value.match(/^\+(\d+)([mhd])$/)
  const ms = rel ? Date.now() + Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2]] : Date.parse(value)
  if (!Number.isFinite(ms)) throw new Error(`Bad time: ${value}`)
  return (BigInt(Math.floor(ms)) * 1_000_000n).toString()
}

const wasmPath = path.join(ROOT, 'contracts', 'target', 'yieldforge_series_v3.wasm')
const code = fs.readFileSync(wasmPath)
const { env, publicKey, account } = await connectAs([])
const subId = `${arg('account')}.${env.NEAR_ACCOUNT}`
const close = toNanos(arg('close'))
const maturity = toNanos(arg('maturity'))
// Storage staking: 10^19 yoctoNEAR per byte. The code dominates; 0.15 NEAR covers the series' own state.
const STORAGE_PER_BYTE = 10n ** 19n
const capArg = process.argv.includes('--cap') ? parse(arg('cap')) : null
if (NETWORK === 'mainnet' && capArg === null) throw new Error('Mainnet series need --cap <stNEAR>: the contract is unaudited')
const minDeposit = parse(arg('min-deposit', NETWORK === 'mainnet' ? '1' : '0.01'))
if (minDeposit < parse('0.01')) throw new Error('--min-deposit cannot be below 0.01 stNEAR')
// Each depositor's PT, YT and deposit records take ~375 bytes (0.00375 NEAR); 0.005 leaves headroom.
const depositorReserve = capArg === null ? 0n : ((capArg + minDeposit - 1n) / minDeposit) * parse('0.005')
const balance = process.argv.includes('--balance')
  ? parse(arg('balance'))
  : BigInt(code.length) * STORAGE_PER_BYTE + parse('0.15') + depositorReserve
const initArgs = {
  owner_id: env.NEAR_ACCOUNT,
  series_id: arg('series-id'),
  underlying_token: STNEAR,
  deposits_close_at: close,
  maturity_at: maturity,
  deposit_fee_bps: Number(arg('fee-bps', '25')),
  fee_collector: env.NEAR_ACCOUNT,
  deposit_cap: capArg === null ? null : capArg.toString(),
  min_deposit: minDeposit.toString(),
}

if (await accountExists(subId)) throw new Error(`${subId} already exists — pick another --account`)
const available = await nearBalance(env.NEAR_ACCOUNT)
console.log(`${NETWORK} · deployer ${env.NEAR_ACCOUNT}: ${fmt(available, 3)} NEAR · wasm ${(code.length / 1024).toFixed(1)} KB · min deposit ${fmt(minDeposit, 2)} stNEAR · new account balance ${fmt(balance, 3)} NEAR (depositor reserve ${fmt(depositorReserve, 3)})`)
if (available < balance + parse('0.05')) throw new Error('Not enough NEAR on the deployer for this balance plus fees')

const deployer = await account(env.NEAR_ACCOUNT)
const outcome = await deployer.signAndSendTransaction({
  receiverId: subId,
  actions: [
    transactions.createAccount(),
    transactions.transfer(balance),
    transactions.addKey(publicKey, transactions.fullAccessKey()),
    transactions.deployContract(code),
    transactions.functionCall('new', Buffer.from(JSON.stringify(initArgs)), 100n * TGAS, 0n),
  ],
})
const failure = outcome.status?.Failure ?? outcome.receipts_outcome.find((r) => r.outcome.status.Failure)?.outcome.status.Failure
if (failure) throw new Error(`deploy failed: ${JSON.stringify(failure)} (tx ${outcome.transaction.hash})`)
console.log(`deployed ${subId} · tx ${outcome.transaction.hash}`)

// The series must be registered on stNEAR to receive deposits via ft_transfer_call.
const reg = await ensureStNearStorage(deployer, subId)
if (reg) console.log(`registered ${subId} on ${STNEAR} · tx ${explorer(reg.hash)}`)

const s = await view(subId, 'get_series')
console.log(JSON.stringify({ series_id: s.series_id, status: s.status, deposits_close_at: new Date(Number(BigInt(s.deposits_close_at) / 1_000_000n)).toISOString(), maturity_at: new Date(Number(BigInt(s.maturity_at) / 1_000_000n)).toISOString(), deposit_fee_bps: s.deposit_fee_bps, deposit_cap: s.deposit_cap, min_deposit: s.min_deposit, yt_token: s.yt_token }, null, 2))
