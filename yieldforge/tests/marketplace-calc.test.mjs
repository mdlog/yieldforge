import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyCost } from '../src/utils/math.ts';

const YOCTO = 10n ** 24n;

// New split calc that avoids u128 overflow (as fixed in marketplace/src/lib.rs)
// old: quantity * unit_price / YOCTO  -> overflows u128 for 0.05e24 * 0.1416e24 = 7e45 > 3e38
// new: split via 1e6
function calc_cost_split(quantity, unit_price) {
  const qh = quantity / 1000000n;
  const ql = quantity % 1000000n;
  const ph = unit_price / 1000000n;
  const pl = unit_price % 1000000n;
  // qh*ph/1e12 + (qh*pl+ql*ph)/1e18  (integer division, matches Rust split)
  return qh * ph / 1000000000000n + (qh * pl + ql * ph) / 1000000000000000000n;
}
function calc_cost_naive(quantity, unit_price) {
  return (quantity * unit_price) / YOCTO;
}
function wouldOverflowU128(a, b) {
  const MAX_U128 = (1n << 128n) - 1n;
  return a * b > MAX_U128;
}

test('calc_cost split avoids u128 overflow for 0.05 YT', () => {
  const qty = 50000000000000000000000n; // 0.05e24
  const price = 141600000000000000000000n; // 0.1416e24
  assert.equal(wouldOverflowU128(qty, price), true, 'naive would overflow u128');
  const cost = calc_cost_split(qty, price);
  assert.equal(cost, 7080000000000000000000n, '0.05*0.1416 = 0.00708 NEAR');
  assert.equal(calc_cost_naive(qty, price), cost, 'naive BigInt matches split');
});

test('calc_cost split for 0.82 YT (max listing)', () => {
  const qty = 820000000000000000000000n; // 0.82
  const price = 141600000000000000000000n;
  assert.equal(wouldOverflowU128(qty, price), true);
  const cost = calc_cost_split(qty, price);
  assert.equal(cost, 116112000000000000000000n, '0.82*0.1416 = 0.116112 NEAR');
  const fee = cost * 25n / 10000n;
  assert.equal(fee, 290280000000000000000n);
  assert.equal(cost + fee, 116402280000000000000000n);
});

test('calc_cost split for 0.10 YT (listing 3)', () => {
  const qty = 100000000000000000000000n;
  const price = 141600000000000000000000n;
  const cost = calc_cost_split(qty, price);
  assert.equal(cost, 14160000000000000000000n);
});

test('calc_cost deposit exact BigInt vs toFixed(6) drift', () => {
  const qty = 50000000000000000000000n;
  const price = 141600000000000000000000n;
  const cost = calc_cost_split(qty, price);
  const fee = cost * 25n / 10000n;
  const total = cost + fee; // 7097700000000000000000
  // toFixed(6) would give 0.014195 *1e24 = 14195000000000000000000 vs exact 14160000000000000000000? Actually 0.05 case:
  // total = 7097700000000000000000 = 0.0070977 NEAR, toFixed(6) = 0.007098 -> 7098000000000000000000 drift 3e18
  const drift = 7098000000000000000000n - total;
  assert.equal(drift, 300000000000000000n, 'toFixed(6) drifts 3e17, must use exact');
});

// ---- Frontend attached deposit (src/utils/math.ts buyCost) vs the contract's requirement ----
function contractRequired(quantity, unitPrice) {
  const cost = calc_cost_split(quantity, unitPrice);
  return cost + (cost * 25n) / 10000n;
}

test('buyCost always attaches at least what the contract requires', () => {
  const cases = [
    [50000000000000000000000n, 141600000000000000000000n],
    [820000000000000000000000n, 141600000000000000000000n],
    [123456789012345678901234n, 141666666666666666666667n],
    [1n, 999999999999999999999999n],
    [7n * 10n ** 26n, 3n * 10n ** 23n + 1n],
  ];
  for (const [qty, price] of cases) {
    const { total } = buyCost(qty, price);
    assert.ok(total >= contractRequired(qty, price), `qty=${qty} price=${price}`);
    assert.ok(total - contractRequired(qty, price) <= 3n, 'overpays by at most a few yocto');
  }
});

test('regression: pricing from the 4-decimal display value underpays (old bug)', () => {
  const qty = 10n * 10n ** 24n; // 10 YT
  const exactPrice = 141666666666666666666667n; // 0.141666… NEAR on-chain
  const displayPrice = 141600000000000000000000n; // what Number(formatYocto(price, 4)) gave back
  assert.ok(buyCost(qty, displayPrice).total < contractRequired(qty, exactPrice), 'rounded price → Insufficient deposit');
  assert.ok(buyCost(qty, exactPrice).total >= contractRequired(qty, exactPrice), 'exact price is accepted');
});
