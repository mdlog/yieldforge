import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chainInitials, typeaheadIndex } from '../src/lib/intents/chainBadge.ts';

const DIR = new URL('../src/assets/chains/', import.meta.url);
// Every chain 1Click listed on 2026-11-15 that has a published logo. ADI, Aleo, Fogo, Miden, PRL and QTC have none,
// and HOOD is left out until its chain is confirmed; those show a letter badge.
const WITH_LOGO = [
  'abs', 'aptos', 'arb', 'avax', 'base', 'bch', 'bera', 'bsc', 'btc', 'cardano', 'dash', 'doge', 'eth', 'gnosis', 'hypercore', 'ltc',
  'monad', 'movement', 'near', 'op', 'plasma', 'pol', 'scroll', 'sol', 'starknet', 'stellar', 'sui', 'ton', 'tron', 'xlayer', 'xrp', 'zec',
];

describe('chain logos', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.svg'));

  it('has a logo file for every chain that has one', () => {
    assert.deepEqual(files.map((f) => f.replace(/\.svg$/, '')).sort(), [...WITH_LOGO].sort());
  });

  it('ships plain SVG: nothing that runs or loads from elsewhere', () => {
    for (const f of files) {
      const svg = readFileSync(new URL(f, DIR), 'utf8');
      assert.match(svg, /^<svg[\s>]/, f);
      assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+\s*=|href\s*=\s*["'](?!#)/i, f);
    }
  });

  it('gives chains without a logo a two-letter badge', () => {
    assert.equal(chainInitials('Aleo'), 'Al');
    assert.equal(chainInitials('ADI'), 'AD');
    assert.equal(chainInitials('X Layer'), 'XL');
    assert.equal(chainInitials(''), '?');
  });
});

describe('jumping through the chain list by letter', () => {
  const labels = ['Ethereum', 'Arbitrum', 'Base', 'Solana', 'Avalanche', 'Aptos'];

  it('goes to the next chain starting with the letter, after the current one', () => {
    assert.equal(typeaheadIndex(labels, 0, 'a'), 1);
    assert.equal(typeaheadIndex(labels, 1, 'A'), 4);
    assert.equal(typeaheadIndex(labels, 4, 'a'), 5);
  });

  it('wraps around, and stays put when nothing matches', () => {
    assert.equal(typeaheadIndex(labels, 5, 'a'), 1);
    assert.equal(typeaheadIndex(labels, 2, 'z'), 2);
  });
});
