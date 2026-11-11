import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lifecycleOf, phaseOf } from '../src/utils/seriesPhase.ts';

const ms = (iso) => Date.parse(iso);

// stnear-7d-02 terms: cutoff Nov 20, maturity Nov 27 2026.
const series = (over) => ({ cutoffMs: ms('2026-11-20T00:00:00Z'), maturityMs: ms('2026-11-27T00:00:00Z'), status: 'DepositOpen', paused: false, ...over });

describe('series lifecycle', () => {
  it('follows the dates and stored rates', () => {
    assert.equal(lifecycleOf(series(), ms('2026-11-15T00:00:00Z')), 'Deposit open');
    assert.equal(lifecycleOf(series({ status: 'Active' }), ms('2026-11-21T00:00:00Z')), 'Awaiting baseline');
    assert.equal(lifecycleOf(series({ status: 'Active', baselineRate: '3198752259237337050198977' }), ms('2026-11-21T00:00:00Z')), 'Active');
    assert.equal(lifecycleOf(series({ status: 'Matured' }), ms('2026-11-28T00:00:00Z')), 'Matured');
    assert.equal(lifecycleOf(series({ status: 'Settled', settlementRate: '3200000000000000000000000' }), ms('2026-11-28T00:00:00Z')), 'Settled');
  });

  it('trusts the chain status when the browser clock runs behind the cutoff', () => {
    assert.equal(lifecycleOf(series({ status: 'Active' }), ms('2026-11-19T23:59:00Z')), 'Awaiting baseline');
  });
});

describe('a paused series', () => {
  // While paused the contract reports status "Paused", whatever the dates say.
  const paused = (over) => series({ status: 'Paused', paused: true, ...over });

  it('shows as Paused', () => {
    const s = paused();
    assert.equal(phaseOf(s, lifecycleOf(s, ms('2026-11-15T00:00:00Z'))), 'Paused');
  });

  it('is not taken to be past its cutoff before the cutoff', () => {
    assert.equal(lifecycleOf(paused(), ms('2026-11-15T00:00:00Z')), 'Deposit open');
  });

  it('keeps capture_baseline, settlement and redemption reachable', () => {
    assert.equal(lifecycleOf(paused(), ms('2026-11-21T00:00:00Z')), 'Awaiting baseline');
    assert.equal(lifecycleOf(paused(), ms('2026-11-28T00:00:00Z')), 'Matured');
    assert.equal(lifecycleOf(paused({ settlementRate: '3200000000000000000000000' }), ms('2026-11-28T00:00:00Z')), 'Settled');
  });
});
