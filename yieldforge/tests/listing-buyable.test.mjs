import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listingOpenAt } from '../src/utils/math.ts';

describe('listing expiry', () => {
  const expiresAt = (BigInt(Date.parse('2026-11-20T00:00:00Z')) * 1_000_000n).toString();

  it('is fillable only while now is before expires_at', () => {
    assert.equal(listingOpenAt(expiresAt, Date.parse('2026-11-19T23:59:59Z')), true);
    // The contract requires block time < expires_at, so the expiry instant itself is too late.
    assert.equal(listingOpenAt(expiresAt, Date.parse('2026-11-20T00:00:00Z')), false);
    assert.equal(listingOpenAt(expiresAt, Date.parse('2026-11-21T00:00:00Z')), false);
  });

  it('treats a missing or malformed expiry as closed', () => {
    assert.equal(listingOpenAt('0', Date.parse('2026-11-12T00:00:00Z')), false);
    assert.equal(listingOpenAt('soon', Date.parse('2026-11-12T00:00:00Z')), false);
  });
});
