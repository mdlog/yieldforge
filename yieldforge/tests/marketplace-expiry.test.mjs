import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Repro for WASM unreachable on YT listing: expiry sent as seconds (1e9) vs block_timestamp nanos (1e18)
// Marketplace asserts expires_at > block_timestamp, so seconds always fails.

describe('Marketplace expiry trap repro', () => {
  const blockTimestampNanos = 1762000000 * 1_000_000_000; // ~ Nov 2026 in nanos

  function parseExpiryOld(label) {
    const parsed = Date.parse(label);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
    return Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  }
  function parseExpiryNew(label) {
    const parsed = Date.parse(label);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000) * 1_000_000_000;
    return (Math.floor(Date.now() / 1000) + 30 * 24 * 3600) * 1_000_000_000;
  }
  function marketplaceWouldPanic(expiresAt) {
    // marketplace check: assert!(expires_at > env::block_timestamp())
    return !(expiresAt > blockTimestampNanos);
  }

  it('old frontend sends seconds -> marketplace panics (repro unreachable)', () => {
    const sec = parseExpiryOld('Dec 01, 2026');
    // Dec 01 2026 in seconds ~ 1796000000
    assert.ok(sec < 2_000_000_000, 'seconds should be ~1.7e9');
    assert.ok(marketplaceWouldPanic(sec), 'marketplace should panic on seconds (1e9 < 1e18) — this is the trap');
  });

  it('new frontend sends nanos -> marketplace does not panic', () => {
    const nanos = parseExpiryNew('Dec 01, 2026');
    assert.ok(nanos > 1_700_000_000_000_000_000, 'nanos should be ~1.79e18');
    assert.ok(!marketplaceWouldPanic(nanos), 'marketplace should NOT panic on nanos');
  });

  it('marketplace should tolerate both units by normalizing', () => {
    function normalizeExpiresAt(raw) {
      // If raw < 1e12, it's seconds -> convert to nanos
      const v = BigInt(raw);
      if (v < 1_000_000_000_000n) return v * 1_000_000_000n;
      return v;
    }
    const sec = BigInt(parseExpiryOld('Dec 01, 2026'));
    const nanos = BigInt(parseExpiryNew('Dec 01, 2026'));
    const normSec = normalizeExpiresAt(sec);
    const normNanos = normalizeExpiresAt(nanos);
    assert.equal(normSec.toString(), nanos.toString(), 'normalized seconds should equal nanos');
    assert.ok(normSec > BigInt(blockTimestampNanos), 'normalized should be future');
    assert.ok(normNanos > BigInt(blockTimestampNanos), 'nanos stays future');
  });

  it('FT ft_transfer_call must not trap on valid YT listing (mock)', () => {
    // FT's ft_transfer_call should not be a no-op (old code ignored msg and never called marketplace)
    // We test that builder sends correct msg shape that marketplace expects
    const msg = JSON.stringify({ action:'create_listing', unit_price:'141600000000000000000000', expires_at:String(parseExpiryNew('Dec 01, 2026')), settlement_asset:'NEAR' });
    const parsed = JSON.parse(msg);
    assert.equal(parsed.unit_price, '141600000000000000000000');
    assert.ok(BigInt(parsed.expires_at) > 1_000_000_000_000n, 'expires_at must be nanos string');
  });
});
