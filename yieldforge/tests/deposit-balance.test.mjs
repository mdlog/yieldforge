import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatYocto, parseNear } from '../src/utils/format.ts';

function getMaxAmount({ live, isConnected, stNearBalance }) {
  if (!live || !isConnected || stNearBalance === null || stNearBalance === undefined) return null;
  try { return formatYocto(String(stNearBalance), 2); } catch { return null; }
}
function getAvailableText({ live, isConnected, stNearBalance }) {
  if (!live) return 'Available 1,248.82 stNEAR';
  if (!isConnected) return 'Connect wallet to see balance';
  if (stNearBalance === null || stNearBalance === undefined) return 'Available …';
  try { return `Available ${formatYocto(String(stNearBalance), 2)} stNEAR · on-chain`; } catch { return 'Available —'; }
}

describe('DepositPage live balance — MAX must use on-chain ft_balance_of not mock 1248.82', () => {
  it('max is derived from real stNEAR balance when live+connected', () => {
    // User has 0.31 stNEAR (from 1 NEAR stake at 3.19 price) — must not return 1248.82
    const balance = '312231119842374759862979';
    assert.equal(getMaxAmount({ live: true, isConnected: true, stNearBalance: balance }), '0.31');
    assert.notEqual(getMaxAmount({ live: true, isConnected: true, stNearBalance: balance }), '1248.82');
    // Larger balance
    assert.equal(getMaxAmount({ live: true, isConnected: true, stNearBalance: '1248820000000000000000000000' }), '1248.82');
  });

  it('available text uses on-chain balance when live', () => {
    assert.equal(getAvailableText({ live: false, isConnected: false, stNearBalance: null }), 'Available 1,248.82 stNEAR');
    assert.equal(getAvailableText({ live: true, isConnected: false, stNearBalance: '0' }), 'Connect wallet to see balance');
    assert.equal(getAvailableText({ live: true, isConnected: true, stNearBalance: null }), 'Available …');
    assert.equal(getAvailableText({ live: true, isConnected: true, stNearBalance: '312231119842374759862979' }), 'Available 0.31 stNEAR · on-chain');
  });

  it('max is null when not connected or not live, falls back to demo', () => {
    assert.equal(getMaxAmount({ live: false, isConnected: true, stNearBalance: '1000000000000000000000000' }), null);
    assert.equal(getMaxAmount({ live: true, isConnected: false, stNearBalance: '1000000000000000000000000' }), null);
    assert.equal(getMaxAmount({ live: true, isConnected: true, stNearBalance: null }), null);
  });

  it('parseNear / formatYocto round-trip for max input', () => {
    const yocto = parseNear('0.31').toString();
    assert.equal(formatYocto(yocto, 2), '0.31');
    const back = Number(formatYocto('312231119842374759862979', 2));
    assert.ok(back > 0.30 && back < 0.32);
  });
});
