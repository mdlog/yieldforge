import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSeriesList } from '../src/lib/near/config.ts';

describe('series list configuration', () => {
  const fallback = 'series.yieldforge.testnet';

  it('reads a comma-separated ladder in order', () => {
    assert.deepEqual(parseSeriesList('a.testnet,b.testnet,c.testnet', 'x.testnet', fallback), ['a.testnet', 'b.testnet', 'c.testnet']);
  });

  it('ignores blanks, whitespace and duplicates', () => {
    assert.deepEqual(parseSeriesList(' a.testnet , ,b.testnet,a.testnet ', undefined, fallback), ['a.testnet', 'b.testnet']);
  });

  it('falls back to the single-series setting, then the network default', () => {
    assert.deepEqual(parseSeriesList(undefined, 'x.testnet', fallback), ['x.testnet']);
    assert.deepEqual(parseSeriesList('', '  ', fallback), [fallback]);
    assert.deepEqual(parseSeriesList(undefined, undefined, fallback), [fallback]);
  });
});
