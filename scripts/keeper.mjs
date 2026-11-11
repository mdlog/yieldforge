// Local entry for the keeper (yieldforge/keeper.mjs, which the Railway cron service runs as `npm run keeper`).
// It signs with KEEPER_ACCOUNT / KEEPER_PRIVATE_KEY from yieldforge/.env when set, else with the deployer key
// (NEAR_ACCOUNT / NEAR_PRIVATE_KEY). R0 is fairest when captured right after a cutoff. The key is never printed.
//
//   node scripts/keeper.mjs            act on every series that is due
//   node scripts/keeper.mjs --dry-run  only report what is due
import { loadEnv } from './near-lib.mjs'

const env = loadEnv()
for (const [key, value] of Object.entries(env)) process.env[key] ??= value
process.env.KEEPER_ACCOUNT ??= env.NEAR_ACCOUNT
process.env.KEEPER_PRIVATE_KEY ??= env.NEAR_PRIVATE_KEY
await import('../yieldforge/keeper.mjs')
