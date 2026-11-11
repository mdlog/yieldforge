import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakEvenApr, buildScenarioRows, fairYtPrice, feeBpsFromTotals, filledVolumeYocto, listingExpiryOptions, lockedApr, previewDeposit, previewRedemption, projectPayout } from '../src/utils/math.ts';
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
  it('pays nothing at or below the baseline and shows a negative buyer delta', () => {
    const rows = buildScenarioRows(1.15, 10, 2);
    const unchanged = rows.find((r) => r.tone === 'muted');
    const falling = rows.find((r) => r.tone === 'risk');
    assert.equal(unchanged.yield, 0);
    assert.equal(falling.yield, 0);
    assert.equal(falling.buyerPayoff, -2);
  });

  it('scales the payout with rate appreciation and quantity', () => {
    const plus5 = buildScenarioRows(1.2, 10, 0).find((r) => r.label === 'Illustrative +5%');
    assert.ok(Math.abs(plus5.yield - 0.6) < 1e-9); // (1.26 - 1.2) × 10
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
  it('prices one YT at R0 × APR × days / 365', () => {
    assert.ok(Math.abs(fairYtPrice(3.198752, 7, 7) - 0.0042942) < 1e-6);
    assert.equal(fairYtPrice(3.2, 7, -5), 0);
  });

  it('turns a price back into the break-even APR, fee included', () => {
    const apr = breakEvenApr(0.0043, 25n, 3.198752, 7);
    assert.ok(apr !== null && Math.abs(apr - 7.027) < 0.01);
    assert.equal(breakEvenApr(0.0043, 25n, 3.2, 0), null);
  });
});

describe('seller and holder views', () => {
  it('turns a YT price into the APR the seller locks in (fair price round-trips)', () => {
    const price = fairYtPrice(3.2, 4, 30);
    assert.ok(Math.abs(lockedApr(price, 3.2, 30) - 4) < 1e-9);
    assert.equal(lockedApr(0.01, 3.2, 0), null);
    // The buyer needs a little more than the seller locks in: the market fee.
    assert.ok(breakEvenApr(price, 25n, 3.2, 30) > lockedApr(price, 3.2, 30));
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
