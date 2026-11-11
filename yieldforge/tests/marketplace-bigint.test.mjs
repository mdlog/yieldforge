import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatYocto } from '../src/utils/format.ts';

// Simulated test for BigInt handling in MarketplacePage activeListings mapping
// Replicates the fixed logic: explicit BigInt conversions, never mixing with number

describe('MarketplacePage BigInt mapping', () => {
  it('maps on-chain ListingView with explicit BigInt conversions', () => {
    const l = {
      listingId: '1',
      seller: 'alice.testnet',
      quantityTotal: '100000000000000000000000000', // 100 * 1e24
      quantityRemaining: '50000000000000000000000000', // 50 * 1e24
      unitPrice: '141600000000000000000000', // 0.1416 * 1e24
      settlementAsset: 'NEAR',
      expiresAt: '1890000000',
      status: 'OPEN',
    };
    const qtyTotal = BigInt(l.quantityTotal);
    const qtyRem = BigInt(l.quantityRemaining);
    const price = BigInt(l.unitPrice);
    const YOCTO = 10n ** 24n;
    const totalYocto = (price * qtyRem) / YOCTO;
    const filledYocto = qtyTotal - qtyRem;
    // Should not throw "Cannot mix BigInt and other types"
    assert.equal(totalYocto.toString(), '7080000000000000000000000'); // 7.08 * 1e24 = 7080000...
    assert.equal(filledYocto.toString(), '50000000000000000000000000');
    // formatYocto should handle
    const totalPrice = Number(formatYocto(totalYocto.toString(), 2));
    assert.ok(totalPrice > 7 && totalPrice < 8);
    const filled = Number(formatYocto(filledYocto.toString(), 2));
    assert.equal(filled, 50);
  });

  it('handles both array and wrapped listings shapes', () => {
    const vec = [{ listingId:'1', quantityTotal:'1', quantityRemaining:'1', unitPrice:'1', settlementAsset:'NEAR', expiresAt:'1', status:'OPEN', seller:'a', series_id:'s', yt_token:'y' }];
    const rawArray = vec;
    const rawWrapped = { listings: vec };
    const getVec = (raw) => Array.isArray(raw) ? raw : (raw?.listings ?? []);
    assert.equal(getVec(rawArray).length, 1);
    assert.equal(getVec(rawWrapped).length, 1);
    assert.equal(getVec(null).length, 0);
    assert.equal(getVec({ listings: undefined }).length, 0);
  });

  it('fully real — when live and empty, returns empty not demo', () => {
    const live = true;
    const liveListingsRes = { listings: [] };
    const demoListings = [{ id:'YF-0421', status:'Open' }];
    const getActive = (isLive, res) => {
      if (isLive) {
        if (!res) return null;
        const raw = res;
        const vec = Array.isArray(raw) ? raw : (raw?.listings ?? []);
        if (vec.length === 0) return [];
        return vec;
      }
      return demoListings;
    };
    assert.deepEqual(getActive(live, liveListingsRes), []);
    assert.equal(getActive(live, null), null);
    assert.deepEqual(getActive(false, null), demoListings);
  });

  it('formatYocto handles 24 decimals correctly', () => {
    assert.equal(formatYocto('1000000000000000000000000', 2), '1.00');
    assert.equal(formatYocto('141600000000000000000000', 4), '0.1416');
    assert.equal(formatYocto('0', 2), '0.00');
  });
});
