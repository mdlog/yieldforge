import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeSuccessValue, ftTransferCallUsed, isWalletRejection, panicMessage } from '../src/lib/near/outcome.ts';

describe('reading a transaction outcome', () => {
  it('decodes the base64 SuccessValue', () => {
    // Stake-and-deposit HVvQH2…cffjN on testnet: ft_transfer_call returned the amount the series kept.
    assert.equal(decodeSuccessValue('IjMxMjU5MDYzNTAyNDE3MDczNTgwNjc1MiI='), '"312590635024170735806752"');
    assert.equal(decodeSuccessValue(''), '');
    assert.equal(decodeSuccessValue(undefined), null);
  });

  it('reads how much an ft_transfer_call moved', () => {
    assert.equal(ftTransferCallUsed('"312590635024170735806752"'), 312590635024170735806752n);
    // A refused deposit: the token refunds everything and the transaction still succeeds with "0".
    assert.equal(ftTransferCallUsed(decodeSuccessValue('IjAi')), 0n);
    assert.equal(ftTransferCallUsed(''), null);
    assert.equal(ftTransferCallUsed('{"used":"1"}'), null);
    assert.equal(ftTransferCallUsed(null), null);
  });

  it('pulls the contract panic out of a receipt failure', () => {
    const failure = JSON.stringify({ ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: Deposits closed' } } } });
    assert.equal(panicMessage(failure), 'Deposits closed');
    assert.equal(panicMessage('Exceeded the prepaid gas.'), null);
  });
});

describe('telling a wallet cancel from a failure', () => {
  it('treats closing the NEAR Connect wallet window or picker as a cancel', () => {
    // stringifyError(new Error('Wallet closed')) as NEAR Connect 0.12 rejects when the wallet popup is closed.
    assert.equal(isWalletRejection('{} Wallet closed'), true);
    assert.equal(isWalletRejection('{} User rejected'), true);
    assert.equal(isWalletRejection('User cancelled the request'), true);
  });

  it('does not hide real failures', () => {
    assert.equal(isWalletRejection('{} No accounts found'), false);
    assert.equal(isWalletRejection('Smart contract panicked: Deposits closed'), false);
    assert.equal(isWalletRejection('PUBLISHING_TRANSACTION_FAILED: cancelled by timeout'), false);
  });
});
