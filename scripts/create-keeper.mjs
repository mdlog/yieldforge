// Create a dedicated keeper account (keeper.<NEAR_ACCOUNT>) with its own key and a small balance, so the
// hosted keeper (Railway cron, yieldforge/keeper.mjs) never needs the deploy key. capture_baseline and
// request_settlement are permissionless, so this account needs no role on the series contracts.
// Its key is saved to yieldforge/.env as KEEPER_ACCOUNT / KEEPER_PRIVATE_KEY and never printed.
//
//   node scripts/create-keeper.mjs [--name keeper] [--balance 0.25]
import fs from 'fs'
import path from 'path'
import { ROOT, accountExists, connectAs, explorer, fmt, loadEnv, nearApi, nearBalance, parse } from './near-lib.mjs'

const { KeyPair, transactions } = nearApi

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 || !process.argv[i + 1] ? fallback : process.argv[i + 1]
}

const env = loadEnv()
const accountId = `${arg('name', 'keeper')}.${env.NEAR_ACCOUNT}`
const balance = parse(arg('balance', '0.25'))
const envFile = path.join(ROOT, 'yieldforge', '.env')
const original = fs.readFileSync(envFile, 'utf8')

if (/^KEEPER_PRIVATE_KEY=./m.test(original)) throw new Error('yieldforge/.env already has KEEPER_PRIVATE_KEY')
if (await accountExists(accountId)) throw new Error(`${accountId} already exists`)
const available = await nearBalance(env.NEAR_ACCOUNT)
console.log(`deployer ${env.NEAR_ACCOUNT}: ${fmt(available, 3)} NEAR · new keeper ${accountId} with ${fmt(balance, 3)} NEAR`)
if (available < balance + parse('0.05')) throw new Error('Not enough NEAR on the deployer for this balance plus fees')

// Save the key before funding the account, so a funded account is never left without its key on disk.
const keyPair = KeyPair.fromRandom('ed25519')
const nl = original.includes('\r\n') ? '\r\n' : '\n'
fs.writeFileSync(envFile, `${original.trimEnd()}${nl}# Keeper account for the Railway cron (scripts/create-keeper.mjs)${nl}KEEPER_ACCOUNT=${accountId}${nl}KEEPER_PRIVATE_KEY=${keyPair.toString()}${nl}`)

try {
  const { account } = await connectAs([])
  const deployer = await account(env.NEAR_ACCOUNT)
  const outcome = await deployer.signAndSendTransaction({
    receiverId: accountId,
    actions: [transactions.createAccount(), transactions.transfer(balance), transactions.addKey(keyPair.getPublicKey(), transactions.fullAccessKey())],
  })
  const failure = outcome.status?.Failure ?? outcome.receipts_outcome.find((r) => r.outcome.status.Failure)?.outcome.status.Failure
  if (failure) throw new Error(`create failed: ${JSON.stringify(failure)} (${explorer(outcome.transaction.hash)})`)
  console.log(`created ${accountId} · public key ${keyPair.getPublicKey().toString()} · ${explorer(outcome.transaction.hash)}`)
  console.log('KEEPER_ACCOUNT and KEEPER_PRIVATE_KEY saved to yieldforge/.env')
} catch (e) {
  fs.writeFileSync(envFile, original)
  throw e
}
