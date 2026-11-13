import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakEvenApr, buildScenarioRows, fairYtPrice, feeBpsFromTotals, filledVolumeYocto, listingExpiryOptions, lockedApr, previewDeposit, previewRedemption, projectPayout, stakeMintYocto, zapDepositYocto } from '../src/utils/math.ts';
import { formatYoctoInput } from '../src/utils/format.ts';

describe('redemption preview', () => {
  it('does not imply principal protection when the settlement rate falls', () => {
    const result = previewRedemption({
      qYocto: 100n * 10n ** 24n,
      r0Scaled: 120n * 10n ** 22n,
      rtScaled: 110n * 10n ** 22n,
    });

    assert.equal(result.ytValue, 0n);
    assert.equal(result.ptValue, 110n * 10n ** 24n);
    assert.equal(result.total, 110n * 10n ** 24n);
  });

  it('splits upside between PT and YT at settlement', () => {
    const result = previewRedemption({
      qYocto: 100n * 10n ** 24n,
      r0Scaled: 110n * 10n ** 22n,
      rtScaled: 120n * 10n ** 22n,
    });

    assert.equal(result.ptValue + result.ytValue, result.total);
    assert.equal(result.total, 120n * 10n ** 24n);
  });
});

describe('deposit preview', () => {
  it('mints PT and YT on the amount net of the 0.25% fee, like the series contract', () => {
    const { pt, yt, fee } = previewDeposit(100n * 10n ** 24n);
    assert.equal(fee, 25n * 10n ** 22n); // 0.25 stNEAR
    assert.equal(pt, 9975n * 10n ** 22n); // 99.75
    assert.equal(yt, pt);
  });
});

describe('illustrative scenarios', () => {
  const base = { r0: 1.2, rateNow: 1.2, aprPercent: 6, daysLeft: 365, ytQuantity: 10, costNear: 0.5 };

  it('moves the staking APR one point either way instead of jumping the rate by 2-5%', () => {
    const rows = buildScenarioRows(base);
    assert.deepEqual(rows.map((r) => r.label), ['Staking APR 5.0%', 'Staking APR 6.0% (today)', 'Staking APR 7.0%', 'Rate falls 1%']);
    const today = rows[1];
    assert.ok(Math.abs(today.rate - 1.272) < 1e-9); // 1.2 × (1 + 6% × 1 year)
    assert.ok(Math.abs(today.yield - 0.72) < 1e-9); // (1.272 − 1.2) × 10
    assert.ok(Math.abs(today.buyerPayoff - 0.22) < 1e-9);
  });

  it('pays nothing when the rate falls below R0, and the buyer loses the cost', () => {
    const falling = buildScenarioRows(base).find((r) => r.tone === 'risk');
    assert.equal(falling.yield, 0);
    assert.equal(falling.buyerPayoff, -0.5);
  });

  it('counts yield already accrued since the cutoff', () => {
    // R0 1.2, rate already 1.23: even at 0% APR from here the YT pays 0.03 per unit.
    const rows = buildScenarioRows({ ...base, rateNow: 1.23, aprPercent: 1, daysLeft: 0 });
    assert.ok(Math.abs(rows[0].yield - 0.3) < 1e-9);
    assert.equal(rows[0].label, 'Staking APR 0.0%');
  });
});

describe('chain-derived values (no hardcoded data in live mode)', () => {
  it('derives the deposit fee from series totals', () => {
    // Live testnet series: 0.83 stNEAR deposited, 0.827925 PT minted.
    assert.equal(feeBpsFromTotals(830000000000000000000000n, 827925000000000000000000n), 25n);
    assert.equal(feeBpsFromTotals(0n, 0n), null, 'no deposits yet → caller falls back to the protocol default');
    assert.equal(feeBpsFromTotals(1n, 2n), null, 'inconsistent totals are rejected');
  });

  it('counts filled volume only where the remainder is trustworthy', () => {
    const rows = [
      { status: 'FILLED', quantityTotal: '100000000000000000000000', quantityRemaining: '0', unitPrice: '141600000000000000000000' },
      { status: 'PARTIALLY_FILLED', quantityTotal: '100000000000000000000000', quantityRemaining: '50000000000000000000000', unitPrice: '141600000000000000000000' },
      { status: 'CANCELLED', quantityTotal: '100000000000000000000000', quantityRemaining: '0', unitPrice: '141600000000000000000000' },
      { status: 'OPEN', quantityTotal: '100000000000000000000000', quantityRemaining: '100000000000000000000000', unitPrice: '141600000000000000000000' },
    ];
    assert.equal(filledVolumeYocto(rows), 21240000000000000000000n); // 0.1 + 0.05 YT × 0.1416
  });

  it('formats exact yocto amounts for inputs without float noise', () => {
    assert.equal(formatYoctoInput(49980000000000000000000n), '0.04998');
    assert.equal(formatYoctoInput(118n * 10n ** 24n), '118');
    assert.equal(formatYoctoInput(0n), '0');
  });
});

describe('listing expiry options are capped at maturity', () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 11);

  it('offers every preset plus maturity when the series has 90 days left', () => {
    const options = listingExpiryOptions(now, now + 90 * DAY);
    assert.deepEqual(options.map((o) => o.key), ['1', '3', '7', '14', '30', '45', '60', 'maturity']);
    assert.ok(options.every((o) => o.ms <= now + 90 * DAY));
  });

  it('drops presets that would outlive the series', () => {
    const maturity = now + 40 * DAY;
    const options = listingExpiryOptions(now, maturity);
    assert.deepEqual(options.map((o) => o.key), ['1', '3', '7', '14', '30', 'maturity']);
    assert.equal(options.at(-1).ms, maturity);
    assert.equal(options.at(-1).days, null);
  });

  it('keeps short presets for short series and only "at maturity" at the very end', () => {
    assert.deepEqual(listingExpiryOptions(now, now + 9 * DAY).map((o) => o.key), ['1', '3', '7', 'maturity']);
    assert.deepEqual(listingExpiryOptions(now, now + 12 * 3_600_000).map((o) => o.key), ['maturity']);
  });

  it('offers nothing once matured or while maturity is unknown', () => {
    assert.deepEqual(listingExpiryOptions(now, now), []);
    assert.deepEqual(listingExpiryOptions(now, now - DAY), []);
    assert.deepEqual(listingExpiryOptions(now, null), []);
  });
});

describe('YT pricing helpers', () => {
  it('prices one YT at R0 × APR × days / 365 before the cutoff', () => {
    assert.ok(Math.abs(fairYtPrice(3.198752, 7, 7) - 0.0042942) < 1e-6);
    assert.equal(fairYtPrice(3.2, 7, -5), 0);
  });

  it('adds the yield already accrued since the cutoff and projects the rest from today\'s rate', () => {
    // R0 3.2, rate now 3.21: 0.01 is already earned; 30 more days at 5% on 3.21.
    const p = fairYtPrice(3.2, 5, 30, 3.21);
    assert.ok(Math.abs(p - (0.01 + 3.21 * 0.05 * 30 / 365)) < 1e-12);
    // A rate below R0 has earned nothing yet, but the future yield still counts.
    assert.ok(Math.abs(fairYtPrice(3.2, 5, 30, 3.19) - 3.19 * 0.05 * 30 / 365) < 1e-12);
  });

  it('turns a price back into the break-even APR, fee included', () => {
    const apr = breakEvenApr(0.0043, 25n, 3.198752, 7);
    assert.ok(apr !== null && Math.abs(apr - 7.027) < 0.01);
    assert.equal(breakEvenApr(0.0043, 25n, 3.2, 0), null);
  });

  it('subtracts the accrued yield from what the remaining days must earn', () => {
    const price = fairYtPrice(3.2, 5, 30, 3.21);
    assert.ok(Math.abs(breakEvenApr(price, 0n, 3.2, 30, 3.21) - 5) < 1e-9);
    // A price below the yield already earned pays back at any APR.
    assert.equal(breakEvenApr(0.005, 25n, 3.2, 30, 3.21), 0);
  });
});

describe('seller and holder views', () => {
  it('turns a YT price into the APR the seller locks in over the term (fair price round-trips)', () => {
    const price = fairYtPrice(3.2, 4, 30);
    assert.ok(Math.abs(lockedApr(price, 3.2, 30) - 4) < 1e-9);
    assert.equal(lockedApr(0.01, 3.2, 0), null);
    // The buyer needs a little more than the seller locks in: the market fee.
    assert.ok(breakEvenApr(price, 25n, 3.2, 30) > lockedApr(price, 3.2, 30));
  });

  it('nets the deposit fee out of the APR the seller locks in', () => {
    const price = fairYtPrice(3.2, 4, 30);
    // Fee 0.25% on a 30-day term: (1 − f)(1 + p/R0) − 1, annualised.
    const net = lockedApr(price, 3.2, 30, 25n);
    const expected = ((1 - 0.0025) * (1 + price / 3.2) - 1) * (365 / 30) * 100;
    assert.ok(Math.abs(net - expected) < 1e-9);
    assert.ok(net < 1, 'a 0.25% fee eats most of a 30-day 4% yield');
  });

  it('projects PT and YT from the current rate before settlement', () => {
    const p = projectPayout({ pt: 10, yt: 10, rateNow: 3.2, r0: 3.2, rt: null, aprPercent: 3.65, daysLeft: 100 });
    assert.equal(p.settled, false);
    assert.ok(Math.abs(p.ptNear - 32) < 1e-9);
    assert.ok(Math.abs(p.ytNear - 10 * 3.2 * 0.01) < 1e-9);
    assert.equal(p.ytAccruedNear, 0);
  });

  it('uses the recorded rates once settled, and YT gets nothing when the rate fell', () => {
    const up = projectPayout({ pt: 1, yt: 2, rateNow: 3.5, r0: 3.2, rt: 3.3, aprPercent: 50, daysLeft: 0 });
    assert.equal(up.settled, true);
    assert.ok(Math.abs(up.ytNear - 0.2) < 1e-9);
    assert.ok(Math.abs(up.ytAccruedNear - 0.2) < 1e-9);
    const down = projectPayout({ pt: 1, yt: 1, rateNow: 3.1, r0: 3.2, rt: 3.1, aprPercent: 4, daysLeft: 0 });
    assert.equal(down.ytNear, 0);
    assert.ok(Math.abs(down.ptNear - 3.1) < 1e-9);
  });

  it('counts no accrued yield before R0 is captured', () => {
    const p = projectPayout({ pt: 0, yt: 5, rateNow: 3.2, r0: null, rt: null, aprPercent: 4, daysLeft: 30 });
    assert.equal(p.ytAccruedNear, 0);
    assert.ok(p.ytNear > 0);
  });
});

describe('stake and deposit in one transaction', () => {
  const Y = 10n ** 24n;
  it('mints floor(NEAR / price) stNEAR, like Meta Pool', () => {
    const price = 3198752259237337050198977n;
    const minted = stakeMintYocto(Y, price);
    assert.equal(minted, (Y * Y) / price);
    assert.ok(minted * price <= Y * Y);
    assert.equal(stakeMintYocto(Y, 0n), 0n);
  });

  it('deposits all but a 0.01% buffer, so a small price rise cannot overdraw', () => {
    const price = 3198752259237337050198977n;
    const deposit = zapDepositYocto(stakeMintYocto(5n * Y, price));
    // A price up 0.005% (about one mainnet epoch) still mints at least the deposit.
    const later = price + price / 20_000n;
    assert.ok(stakeMintYocto(5n * Y, later) >= deposit);
    assert.equal(zapDepositYocto(10_000n), 9_999n);
  });
});
