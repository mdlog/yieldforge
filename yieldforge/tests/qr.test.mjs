import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { depositQr, qrPath } from '../src/lib/intents/qr.ts';

describe('deposit address QR code', () => {
  it('draws each dark module as a 1x1 square', () => {
    assert.equal(qrPath([[true, false], [false, true]]), 'M0 0h1v1h-1zM1 1h1v1h-1z');
    assert.equal(qrPath([[false]]), '');
  });

  it('encodes the plain address with a quiet border around the finder patterns', () => {
    const address = '0x5763a8822936b4815846f858c10e8c7f16eA294F';
    const qr = depositQr(address);
    // Version 3 holds 42 bytes at ECC M: 29 modules plus a 2-module border on each side.
    assert.equal(qr.size, 33);
    assert.ok(qr.path.length > 0);
    // The border stays light; the top-left finder pattern starts right after it.
    assert.ok(!qr.path.startsWith('M0 0'));
    assert.ok(qr.path.startsWith('M2 2h1v1h-1z'));
  });

  it('gives a different code for a different address', () => {
    assert.notEqual(depositQr('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq').path, depositQr('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr').path);
  });
});
