import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STNEAR_ASSET_ID,
  WNEAR_ASSET_ID,
  asPreview,
  buildBuyYtQuoteRequest,
  buildCashOutQuoteRequest,
  buildCashOutTx,
  buildDepositQuoteRequest,
  buildUnwrapAndBuyPlan,
  expressCheck,
  fromAtomic,
  looksLikeAddress,
  pruneSwaps,
  trackerState,
  toAtomic,
  upsertSwap,
} from '../src/lib/intents/flows.ts';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const USDC_ARB = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';
const EVM = '0x00000000000000000000000000000000000000a1';

describe('atomic amounts', () => {
  it('converts decimal text to atomic units and back without float error', () => {
    assert.equal(toAtomic('12.345678', 6), 12345678n);
    assert.equal(toAtomic('0.1', 24), 10n ** 23n);
    assert.equal(toAtomic('3', 18), 3n * 10n ** 18n);
    assert.equal(fromAtomic(12345678n, 6), '12.345678');
    assert.equal(fromAtomic(10n ** 23n, 24), '0.1');
    assert.equal(fromAtomic(123456789n, 6, 2), '123.45');
    assert.equal(fromAtomic(0n, 6), '0');
  });

  it('refuses amounts with more decimals than the token has, and junk', () => {
    assert.equal(toAtomic('1.1234567', 6), null);
    assert.equal(toAtomic('abc', 6), null);
    assert.equal(toAtomic('', 6), null);
    assert.equal(toAtomic('-1', 6), null);
    assert.equal(toAtomic('0', 6), null);
    assert.equal(toAtomic('1,5', 6), 1500000n);
  });
});

describe('origin address check', () => {
  it('accepts plausible addresses per chain family and rejects the rest', () => {
    assert.equal(looksLikeAddress('arb', EVM), true);
    assert.equal(looksLikeAddress('eth', '0x123'), false);
    assert.equal(looksLikeAddress('sol', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'), true);
    assert.equal(looksLikeAddress('btc', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'), true);
    assert.equal(looksLikeAddress('near', 'alice.near'), true);
    assert.equal(looksLikeAddress('near', 'a'.repeat(64)), true);
    assert.equal(looksLikeAddress('near', 'Alice.near'), false);
    assert.equal(looksLikeAddress('arb', ''), false);
  });
});

describe('deposit-from-any-chain quote request', () => {
  const base = { originAsset: USDC_ARB, amountAtomic: 5_000_000n, refundTo: EVM, accountId: 'alice.near', seriesContractId: 'series-a.yieldforge.near', now: NOW };

  it('express mode delivers stNEAR straight into the series and names the user as the PT/YT receiver', () => {
    const req = buildDepositQuoteRequest({ ...base, mode: 'express', dry: false });
    assert.equal(req.swapType, 'EXACT_INPUT');
    assert.equal(req.originAsset, USDC_ARB);
    assert.equal(req.destinationAsset, STNEAR_ASSET_ID);
    assert.equal(req.amount, '5000000');
    assert.equal(req.recipient, 'series-a.yieldforge.near');
    assert.equal(req.recipientType, 'DESTINATION_CHAIN');
    assert.deepEqual(JSON.parse(req.customRecipientMsg), { receiver_id: 'alice.near' });
    assert.equal(req.depositType, 'ORIGIN_CHAIN');
    assert.equal(req.refundTo, EVM);
    assert.equal(req.refundType, 'ORIGIN_CHAIN');
    assert.equal(req.dry, false);
    assert.equal(Date.parse(req.deadline) > NOW, true);
  });

  it('standard mode sends stNEAR to the wallet and has no custom message', () => {
    const req = buildDepositQuoteRequest({ ...base, mode: 'standard', dry: true });
    assert.equal(req.recipient, 'alice.near');
    assert.equal('customRecipientMsg' in req, false);
    assert.equal(req.dry, true);
  });
});

describe('buy-YT-from-any-chain quote request', () => {
  it('asks for exactly the NEAR the purchase needs plus a gas buffer, as wNEAR to the wallet', () => {
    const req = buildBuyYtQuoteRequest({ originAsset: USDC_ARB, nearNeededYocto: 2n * 10n ** 24n, refundTo: EVM, accountId: 'bob.near', dry: true, now: NOW });
    assert.equal(req.swapType, 'EXACT_OUTPUT');
    assert.equal(req.destinationAsset, WNEAR_ASSET_ID);
    assert.equal(req.recipient, 'bob.near');
    assert.equal(BigInt(req.amount) > 2n * 10n ** 24n, true);
    assert.equal(BigInt(req.amount) - 2n * 10n ** 24n <= 5n * 10n ** 22n, true);
  });
});

describe('unwrap-and-buy plan once wNEAR has arrived', () => {
  const need = 2n * 10n ** 24n;
  it('unwraps only the shortfall when the wallet already has some native NEAR', () => {
    const plan = buildUnwrapAndBuyPlan({ needYocto: need, nativeYocto: 5n * 10n ** 23n, wnearYocto: 3n * 10n ** 24n, gasReserveYocto: 10n ** 22n });
    assert.equal(plan.ok, true);
    assert.equal(plan.unwrapYocto, need - 5n * 10n ** 23n + 10n ** 22n);
  });
  it('needs no unwrap when native NEAR covers it', () => {
    const plan = buildUnwrapAndBuyPlan({ needYocto: need, nativeYocto: 3n * 10n ** 24n, wnearYocto: 0n, gasReserveYocto: 10n ** 22n });
    assert.equal(plan.ok, true);
    assert.equal(plan.unwrapYocto, 0n);
  });
  it('reports the shortfall when wNEAR plus NEAR is not enough', () => {
    const plan = buildUnwrapAndBuyPlan({ needYocto: need, nativeYocto: 0n, wnearYocto: 10n ** 24n, gasReserveYocto: 10n ** 22n });
    assert.equal(plan.ok, false);
    assert.equal(plan.shortfallYocto, need + 10n ** 22n - 10n ** 24n);
  });
});

describe('cash out to another chain', () => {
  it('quotes stNEAR from the NEAR wallet to the destination chain, refunding to the wallet', () => {
    const req = buildCashOutQuoteRequest({ amountStNearYocto: 10n ** 24n, destinationAsset: USDC_ARB, recipient: EVM, accountId: 'alice.near', dry: false, now: NOW });
    assert.equal(req.originAsset, STNEAR_ASSET_ID);
    assert.equal(req.destinationAsset, USDC_ARB);
    assert.equal(req.recipient, EVM);
    assert.equal(req.refundTo, 'alice.near');
    assert.equal(req.depositType, 'ORIGIN_CHAIN');
    assert.equal(req.amount, (10n ** 24n).toString());
  });

  it('registers the deposit address on the stNEAR contract and transfers in one transaction (plain ft_transfer)', () => {
    const dep = 'f'.repeat(64);
    const tx = buildCashOutTx({ stNearContractId: 'meta-pool.near', depositAddress: dep, amountYocto: 10n ** 24n, storageMinYocto: 1_250_000_000_000_000_000_000n });
    assert.equal(tx.receiverId, 'meta-pool.near');
    assert.deepEqual(tx.actions.map((a) => a.params.methodName), ['storage_deposit', 'ft_transfer']);
    assert.deepEqual(tx.actions[0].params.args, { account_id: dep, registration_only: true });
    assert.equal(tx.actions[0].params.deposit, '1250000000000000000000');
    assert.equal(tx.actions[1].params.args.receiver_id, dep);
    assert.equal(tx.actions[1].params.args.amount, (10n ** 24n).toString());
    assert.equal(tx.actions[1].params.deposit, '1');
  });
});

describe('express safety check', () => {
  const series = { depositsOpen: true, depositsCloseAtMs: NOW + 3 * 86_400_000, capRemainingYocto: null, minDepositYocto: 10n ** 22n, paused: false };
  const quote = { amountOut: (9n * 10n ** 23n).toString(), minAmountOut: (89n * 10n ** 22n).toString(), timeEstimate: 30 };

  it('allows express when the window is open, the cap fits and the minimum is met', () => {
    assert.deepEqual(expressCheck({ series, quote, now: NOW }), { ok: true, reasons: [] });
  });
  it('blocks express when deposits close too soon', () => {
    const r = expressCheck({ series: { ...series, depositsCloseAtMs: NOW + 10 * 60_000 }, quote, now: NOW });
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(' '), /close/i);
  });
  it('blocks express when the remaining cap could not take the deposit', () => {
    const r = expressCheck({ series: { ...series, capRemainingYocto: 5n * 10n ** 23n }, quote, now: NOW });
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(' '), /cap/i);
  });
  it('blocks express below the series minimum, when paused, or when closed', () => {
    assert.equal(expressCheck({ series: { ...series, minDepositYocto: 10n ** 24n }, quote, now: NOW }).ok, false);
    assert.equal(expressCheck({ series: { ...series, paused: true }, quote, now: NOW }).ok, false);
    assert.equal(expressCheck({ series: { ...series, depositsOpen: false }, quote, now: NOW }).ok, false);
  });
});

describe('funds tracker', () => {
  it('maps 1Click statuses to tracker steps', () => {
    assert.equal(trackerState(null).index, 1);
    assert.equal(trackerState('PENDING_DEPOSIT').index, 1);
    assert.equal(trackerState('KNOWN_DEPOSIT_TX').index, 2);
    assert.equal(trackerState('PROCESSING').index, 2);
    assert.equal(trackerState('SUCCESS').index, 3);
    assert.equal(trackerState('SUCCESS').terminal, true);
    assert.equal(trackerState('REFUNDED').tone, 'refunded');
    assert.equal(trackerState('REFUNDED').terminal, true);
    assert.equal(trackerState('FAILED').tone, 'failed');
    assert.equal(trackerState('INCOMPLETE_DEPOSIT').tone, 'warn');
    assert.equal(trackerState('INCOMPLETE_DEPOSIT').terminal, false);
  });

  it('keeps one record per deposit address, newest first, and prunes old finished swaps', () => {
    const a = { depositAddress: 'a', createdAt: NOW - 1000, status: 'PENDING_DEPOSIT' };
    const b = { depositAddress: 'b', createdAt: NOW, status: 'PROCESSING' };
    let list = upsertSwap([], a);
    list = upsertSwap(list, b);
    list = upsertSwap(list, { ...a, status: 'SUCCESS' });
    assert.deepEqual(list.map((s) => s.depositAddress), ['b', 'a']);
    assert.equal(list.find((s) => s.depositAddress === 'a').status, 'SUCCESS');

    const old = { depositAddress: 'c', createdAt: NOW - 8 * 86_400_000, status: 'SUCCESS' };
    const oldPending = { depositAddress: 'd', createdAt: NOW - 8 * 86_400_000, status: 'PROCESSING' };
    const pruned = pruneSwaps([...list, old, oldPending], NOW);
    assert.deepEqual(pruned.map((s) => s.depositAddress), ['b', 'a', 'd']);
  });
});

describe('price-only previews', () => {
  it('stand in for addresses so a route can be priced before the user types any', () => {
    const req = buildDepositQuoteRequest({ originAsset: USDC_ARB, amountAtomic: 5_000_000n, refundTo: '', accountId: 'alice.testnet', seriesContractId: 'series-a.yieldforge.testnet', mode: 'express', dry: false, now: NOW });
    const p = asPreview(req);
    assert.equal(p.dry, true);
    assert.equal(p.refundType, 'INTENTS');
    assert.equal(p.recipient, 'aurora');
    assert.notEqual(p.recipient, 'wrap.near', 'never the token contract being delivered');
    assert.equal(p.recipientType, 'DESTINATION_CHAIN');
    assert.equal('customRecipientMsg' in p, false);
    assert.equal(p.amount, '5000000');
    assert.equal(req.dry, false, 'the original request is untouched');
  });
  it('can price a wNEAR delivery (the recipient is not wrap.near itself)', () => {
    const p = asPreview(buildBuyYtQuoteRequest({ originAsset: USDC_ARB, nearNeededYocto: 10n ** 24n, refundTo: '', accountId: 'bob.testnet', dry: false, now: NOW }));
    assert.equal(p.destinationAsset, WNEAR_ASSET_ID);
    assert.notEqual(p.recipient, 'wrap.near');
  });
  it('keeps cash-out previews inside the intents ledger, since a foreign-chain recipient cannot be stood in for', () => {
    const req = buildCashOutQuoteRequest({ amountStNearYocto: 10n ** 24n, destinationAsset: USDC_ARB, recipient: '', accountId: 'alice.near', dry: false, now: NOW });
    assert.equal(asPreview(req).recipientType, 'INTENTS');
  });
});
