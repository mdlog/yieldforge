import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { synthesizeFallbackActivity, parseNearBlocksResponse } from '../src/lib/near/activity.ts';

const contracts = { marketplaceContractId: 'market.solidnecktie5405.testnet', seriesContractId: 'series.solidnecktie5405.testnet' };
const listing = (overrides) => ({
  listingId: '7',
  seller: 'broadlemon3381.testnet',
  seriesId: 'stnear-90d-01',
  ytToken: 'yt.testnet',
  quantityTotal: '100000000000000000000000',
  quantityRemaining: '50000000000000000000000',
  settlementAsset: 'NEAR',
  unitPrice: '141600000000000000000000',
  expiresAt: '1796157371656000000',
  status: 'OPEN',
  ...overrides,
});

describe('Activity fallback — NearBlocks returns [] on testnet but the contracts have state', () => {
  it('parseNearBlocksResponse returns [] for an empty v3 list without throwing', () => {
    assert.deepEqual(parseNearBlocksResponse({ data: [], meta: {} }), []);
  });

  it('parseNearBlocksResponse handles v3 list, detail, null, array, and empty shapes', () => {
    assert.equal(parseNearBlocksResponse({ data: [{ transaction_hash: 'abc' }], meta: { next_page: 'x' } }).length, 1);
    assert.equal(parseNearBlocksResponse({ data: { transaction_hash: 'abc' } }).length, 1, 'v3 detail: data is one object');
    assert.deepEqual(parseNearBlocksResponse({ data: null }), [], 'v3 unknown hash: data is null');
    assert.deepEqual(parseNearBlocksResponse({ data: null, errors: [{ message: 'API v1 was retired' }] }), []);
    assert.equal(parseNearBlocksResponse([{ transaction_hash: 'abc' }]).length, 1);
    assert.equal(parseNearBlocksResponse({ transaction_hash: 'abc' }).length, 1);
    assert.deepEqual(parseNearBlocksResponse(null), []);
    assert.deepEqual(parseNearBlocksResponse({}), []);
  });

  it('returns nothing when the indexer is empty and the account has no listings or position', () => {
    const result = synthesizeFallbackActivity({ accountId: 'broadlemon3381.testnet', nearBlocksTxns: { data: [] }, listings: [], hasPosition: false, ...contracts });
    assert.deepEqual(result, []);
  });

  it('falls back to the account’s own listings, pointing at the marketplace contract', () => {
    const listings = [listing(), listing({ listingId: '8', seller: 'other.testnet', quantityRemaining: '0', status: 'FILLED' })];
    const result = synthesizeFallbackActivity({ accountId: 'broadlemon3381.testnet', nearBlocksTxns: [], listings, hasPosition: false, ...contracts });
    assert.equal(result.length, 1);
    assert.equal(result[0].listingId, '7');
    assert.equal(result[0].hash, null, 'derived rows must not pretend to be transactions');
    assert.equal(result[0].source, 'listing');
    assert.equal(result[0].receiver, 'market.solidnecktie5405.testnet');
  });

  it('falls back to the position when there are no listings', () => {
    const result = synthesizeFallbackActivity({ accountId: 'a.testnet', nearBlocksTxns: null, listings: [], hasPosition: true, ...contracts });
    assert.equal(result.length, 1);
    assert.equal(result[0].source, 'position');
    assert.equal(result[0].receiver, 'series.solidnecktie5405.testnet');
  });

  it('prefers NearBlocks when it has data and reads method + timestamp', () => {
    const nearBlocksTxns = {
      data: [{ transaction_hash: 'hashReal12345678901234567890', signer_account_id: 'solidnecktie5405.testnet', receiver_account_id: 'market.testnet', block_timestamp: '1700000000000000000', actions: [{ action: 'FUNCTION_CALL', method: 'buy' }], outcomes: { status: true } }],
    };
    const result = synthesizeFallbackActivity({ accountId: 'solidnecktie5405.testnet', nearBlocksTxns, listings: [listing({ seller: 'solidnecktie5405.testnet' })], hasPosition: true, ...contracts });
    assert.equal(result.length, 1);
    assert.equal(result[0].hash, 'hashReal12345678901234567890');
    assert.equal(result[0].source, 'indexer');
    assert.equal(result[0].method, 'buy');
    assert.equal(result[0].timestampMs, 1_700_000_000_000);
  });

  it('reads real NearBlocks v3 rows and flags failed transactions', () => {
    const v3 = {
      data: [
        { transaction_hash: 'B5rd9QU52amKt7uxybo4fhddDR8XD9E61NBWfj5qCwis', signer_account_id: 'solidnecktie5405.testnet', receiver_account_id: 'stnear-90d-02.solidnecktie5405.testnet', block_timestamp: '1794349898832535297', actions: [{ action: 'FUNCTION_CALL', method: 'buy' }], outcomes: { status: true } },
        { transaction_hash: 'FailedTx11111111111111111111111111111111111', signer_account_id: 'solidnecktie5405.testnet', receiver_account_id: 'stnear-90d-02.solidnecktie5405.testnet', block_timestamp: '1794349800000000000', actions: [{ action: 'FUNCTION_CALL', method: 'buy' }], outcomes: { status: false } },
      ],
      meta: { next_page: 'opaque' },
    };
    const [ok, failed] = synthesizeFallbackActivity({ accountId: 'solidnecktie5405.testnet', nearBlocksTxns: v3, listings: [], hasPosition: true, ...contracts });
    assert.equal(ok.method, 'buy');
    assert.equal(ok.receiver, 'stnear-90d-02.solidnecktie5405.testnet');
    assert.equal(ok.timestampMs, 1794349898832);
    assert.equal(ok.failed, false);
    assert.equal(failed.failed, true);
  });
});
