/**
 * What a site gets from `signTransaction`:
 *   - the signer field of EVERY operation it may submit is known (OP_AUTH_FIELD), so the
 *     "only accounts this site is connected to" boundary can see it;
 *   - a transfer's plain-text memo is encrypted by the wallet, and never sent unencrypted
 *     or dropped;
 *   - the fee asset the operations ask for is the one the fee is priced in.
 */

import {
  WalletManager,
  OP_AUTH_FIELD,
  DAPP_ALLOWED_OPERATIONS,
  authFieldsFor
} from '../src/lib/wallet-manager.js';
import { BitSharesAPI, coreFeeInAssetUnits, plainMemoCipherBytes } from '../src/lib/bitshares-api.js';
import { CryptoUtils } from '../src/lib/crypto-utils.js';
import { makeFixtures } from './fixtures/operations.js';

afterAll(() => {
  jest.clearAllTimers();
});

describe('the signer of every operation a site may submit', () => {
  const PUB = 'BTS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV';
  const A = '1.2.26807';
  const samples = makeFixtures(PUB);

  // 40 (blind_transfer) has no account at all: its fee is paid by the chain's temp account,
  // and 41 (transfer_from_blind) names only the recipient.
  const withoutAccountField = [40, 41];

  const allowed = Object.keys(DAPP_ALLOWED_OPERATIONS).map(Number);
  // the fixtures cover the 78 operations of the original protocol; the oracle and futures
  // operations (78+) have no sample here and are covered by wallet-manager.test.js
  const sampled = allowed.filter(type => samples[type]);

  test('the oracle and futures operations name theirs explicitly', () => {
    allowed.filter(type => !samples[type]).forEach(type => {
      expect(type).toBeGreaterThanOrEqual(78);
      expect(OP_AUTH_FIELD[type]).toBeDefined();
    });
  });

  test.each(sampled)(
    'operation %i names its signer in a field the check looks at',
    type => {
      const sample = samples[type];
      const fields = authFieldsFor([type, sample]);
      const found = fields.filter(field => sample[field] === A);
      if (withoutAccountField.includes(type)) {
        expect(found).toEqual([]);
      } else {
        expect(found.length).toBeGreaterThan(0);
      }
    }
  );

  test('the beneficiary of a vesting balance is not its signer', () => {
    // `owner` there is who receives, `creator` signs
    expect(authFieldsFor([32, { creator: '1.2.17', owner: '1.2.99' }])).toEqual(['creator']);
    expect(OP_AUTH_FIELD[33]).toBe('owner'); // but the owner of a balance withdraws it
  });

  test('a virtual operation is not on the list', () => {
    expect(DAPP_ALLOWED_OPERATIONS[86]).toBeUndefined();
  });
});

describe('plain-text memos in signTransaction', () => {
  let from, to, wm;
  const FROM_ACC = { id: '1.2.100', name: 'alice' };

  beforeAll(async () => {
    from = await CryptoUtils.generateKeysFromPassword('alice', 'alice-secret-pw', 'TEST');
    to = await CryptoUtils.generateKeysFromPassword('bob', 'bob-secret-pw', 'TEST');
  });

  beforeEach(() => {
    wm = Object.create(WalletManager.prototype);
    wm.api = {
      pqSerializationActive: false,
      getAccount: jest.fn(async ref => {
        if (ref === 'alice' || ref === '1.2.100') {
          return { id: '1.2.100', name: 'alice', options: { memo_key: from.memo.publicKey } };
        }
        if (ref === '1.2.200' || ref === 'bob') {
          return { id: '1.2.200', name: 'bob', options: { memo_key: to.memo.publicKey } };
        }
        return null;
      })
    };
  });

  const transfer = memo => [
    0,
    {
      fee: { amount: 0, asset_id: '1.3.0' },
      from: '1.2.100',
      to: '1.2.200',
      amount: { amount: 100000, asset_id: '1.3.0' },
      memo
    }
  ];

  test('are encrypted for the recipient, and the recipient can read them', async () => {
    const ops = [transfer('invoice 42')];
    await wm._encryptStringMemos(ops, FROM_ACC, from);
    const memo = ops[0][1].memo;
    expect(typeof memo).toBe('object');
    expect(memo.from).toBe(from.memo.publicKey);
    expect(memo.to).toBe(to.memo.publicKey);
    expect(memo.message).not.toContain('invoice');
    const read = await CryptoUtils.decryptMemo(memo, to.memo.privateKey);
    expect(read).toBe('invoice 42');
  });

  test('are never sent as they are: no memo key means no transfer', async () => {
    wm.api.getAccount = jest.fn(async ref =>
      ref === '1.2.200'
        ? { id: '1.2.200', name: 'bob', options: { memo_key: '' } }
        : { id: '1.2.100', name: 'alice', options: { memo_key: from.memo.publicKey } }
    );
    await expect(wm._encryptStringMemos([transfer('hello')], FROM_ACC, from)).rejects.toThrow(
      /no memo key on-chain/
    );
  });

  test('need the memo private key of the signing account', async () => {
    await expect(
      wm._encryptStringMemos([transfer('hello')], FROM_ACC, { ...from, memo: undefined })
    ).rejects.toThrow(/memo private key is not in the wallet/);
  });

  test('a memo object is passed through, an empty one is dropped', async () => {
    const encrypted = { from: 'X', to: 'Y', nonce: '1', message: 'abcd' };
    const ops = [transfer(encrypted), transfer('   ')];
    await wm._encryptStringMemos(ops, FROM_ACC, from);
    expect(ops[0][1].memo).toBe(encrypted);
    expect('memo' in ops[1][1]).toBe(false);
    expect(wm.api.getAccount).not.toHaveBeenCalled();
  });

  test('only a transfer can carry one', async () => {
    const op = [
      1,
      { fee: { amount: 0, asset_id: '1.3.0' }, seller: '1.2.100', memo: 'hello' }
    ];
    await expect(wm._encryptStringMemos([op], FROM_ACC, from)).rejects.toThrow(
      /cannot carry a plain-text memo/
    );
  });

  test('are limited in length, and need a recipient that exists', async () => {
    await expect(
      wm._encryptStringMemos([transfer('x'.repeat(2049))], FROM_ACC, from)
    ).rejects.toThrow(/too long/);
    const op = transfer('hello');
    op[1].to = '1.2.999';
    await expect(wm._encryptStringMemos([op], FROM_ACC, from)).rejects.toThrow(
      /Recipient account not found/
    );
  });

  test('operations in the object form are handled too', async () => {
    const op = { type: 0, ...transfer('by object')[1] };
    await wm._encryptStringMemos([op], FROM_ACC, from);
    expect(typeof op.memo).toBe('object');
  });
});

describe('the fee asset of a transaction', () => {
  const OP = (asset_id, extra = {}) => [
    0,
    {
      fee: asset_id === undefined ? undefined : { amount: 0, asset_id },
      from: '1.2.100',
      to: '1.2.200',
      amount: { amount: 1, asset_id: '1.3.0' },
      ...extra
    }
  ];

  test('is the core asset when the operations name none, and the named one otherwise', () => {
    const api = new BitSharesAPI();
    expect(api._requestedFeeAssetId([OP(undefined)])).toBe('1.3.0');
    expect(api._requestedFeeAssetId([OP('1.3.0')])).toBe('1.3.0');
    expect(api._requestedFeeAssetId([OP('1.3.121')])).toBe('1.3.121');
    expect(api._requestedFeeAssetId([OP('1.3.121'), OP('1.3.121')])).toBe('1.3.121');
    expect(api._requestedFeeAssetId([OP('1.3.121'), OP(undefined)])).toBe('1.3.121');
  });

  test('cannot differ between the operations of one transaction', () => {
    const api = new BitSharesAPI();
    expect(() => api._requestedFeeAssetId([OP('1.3.121'), OP('1.3.0')])).toThrow(
      /same asset/
    );
  });

  test('is what the node is asked to price the fee in', async () => {
    const api = new BitSharesAPI();
    api.apiIds = { database: 2 };
    api.getAsset = jest.fn(async id => ({ id, symbol: 'X', precision: 4 }));
    api._resolveOperationIds = jest.fn(async () => {});
    const seen = [];
    api.call = jest.fn(async (_id, method, params) => {
      seen.push([method, params[1]]);
      if (method === 'get_required_fees') return [{ amount: 7, asset_id: params[1] }];
      // stop after the fee step: the rest (block headers, signing) is not under test
      throw new Error('stop here');
    });
    const tx = { operations: [OP('1.3.121')], extensions: [] };
    await expect(api.signAndBroadcast(tx, 'unused')).rejects.toThrow('stop here');
    expect(seen[0]).toEqual(['get_required_fees', '1.3.121']);
    expect(tx.operations[0][1].fee).toEqual({ amount: 7, asset_id: '1.3.121' });
  });

  test('a fee asset the node cannot price is an error, not fee 0', async () => {
    const api = new BitSharesAPI();
    api.apiIds = { database: 2 };
    api.getAsset = jest.fn(async id => ({ id, symbol: 'X', precision: 4 }));
    api._resolveOperationIds = jest.fn(async () => {});
    api.call = jest.fn(async () => {
      throw new Error('Asset cannot pay fees\nstack…');
    });
    await expect(
      api.signAndBroadcast({ operations: [OP('1.3.121')], extensions: [] }, 'unused')
    ).rejects.toThrow('Cannot pay the fee in 1.3.121: Asset cannot pay fees');
  });
});

describe('which key signs, on a chain whose keys have another prefix', () => {
  // The local key is always written with the prefix BTS; the testnet writes TEST for the
  // same key. The two were compared as whole strings, so nothing could be signed there.
  let keys;
  beforeAll(async () => {
    keys = await CryptoUtils.generateKeysFromPassword('alice', 'alice-secret-pw', 'BTS');
  });

  const apiWithActiveKey = key => {
    const api = new BitSharesAPI();
    api.getAccount = jest.fn(async () => ({ id: '1.2.5', active: { key_auths: [[key, 1]] } }));
    return api;
  };

  test.each(['BTS', 'TEST', 'GPH'])('a key the chain writes with the prefix %s is recognised', async prefix => {
    const onChain = prefix + keys.active.publicKey.replace(/^BTS/, '');
    const method = await apiWithActiveKey(onChain).chooseSigningMethod('1.2.5', keys.active.privateKey);
    expect(method).toEqual({ mode: 'classical' });
  });

  test('another key is still refused', async () => {
    const other = await CryptoUtils.generateKeysFromPassword('mallory', 'other-pw', 'TEST');
    await expect(
      apiWithActiveKey(other.active.publicKey).chooseSigningMethod('1.2.5', keys.active.privateKey)
    ).rejects.toThrow("This wallet's key is not in the account's active authority.");
  });
});

describe('the fee the approval dialog shows', () => {
  // 1.0000 of an asset of precision 4 is worth 1 TEST (precision 5)
  const cer = { base: { amount: 10000, asset_id: '1.3.1853' }, quote: { amount: 100000, asset_id: '1.3.0' } };

  test('is the core fee as it is for the core asset', () => {
    expect(coreFeeInAssetUnits(86869, '1.3.0', undefined)).toBe(86869);
  });

  test('is the core fee at the asset\'s core exchange rate, rounded up, for another asset', () => {
    // 0.86869 TEST = 0.8687 of the asset: what the node charged on the testnet (8687 units).
    // Formatting the 86869 core units with the asset\'s precision showed 8.6869, ten times too much.
    expect(coreFeeInAssetUnits(86869, '1.3.1853', cer)).toBe(8687);
  });

  test('reads the rate whichever way round it is stored', () => {
    const inverted = { base: cer.quote, quote: cer.base };
    expect(coreFeeInAssetUnits(86869, '1.3.1853', inverted)).toBe(8687);
  });

  test('refuses a rate it cannot use', () => {
    expect(() => coreFeeInAssetUnits(100, '1.3.5', undefined)).toThrow(/core exchange rate/);
    expect(() => coreFeeInAssetUnits(100, '1.3.5', { base: { amount: 0, asset_id: '1.3.5' }, quote: { amount: 1, asset_id: '1.3.0' } })).toThrow(/core exchange rate/);
  });

  test('counts a plain-text memo as the ciphertext the wallet will make of it', () => {
    // "e2e memo 1792479132" is 19 bytes; on the testnet its ciphertext was 32 bytes
    expect(plainMemoCipherBytes('e2e memo 1792479132')).toBe(32);
    expect(plainMemoCipherBytes('')).toBe(16);
    expect(plainMemoCipherBytes('x'.repeat(11))).toBe(16);
    expect(plainMemoCipherBytes('x'.repeat(12))).toBe(32); // 12 + 4 + 1 > 16
  });
});
