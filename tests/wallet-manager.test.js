/**
 * Tests for src/lib/wallet-manager.js
 *
 * Coverage:
 *  - hasWallet()       — false when storage empty, true after wallet saved
 *  - createWallet()    — creates wallet, stores to chrome.storage.local
 *  - unlock()          — correct password → true, wrong password → false
 *  - lock()            — wallet becomes locked after call
 *  - isUnlocked()      — reflects locked/unlocked state
 *
 * The chrome.storage.local mock (tests/__mocks__/chrome.js) is injected
 * via setupFiles in jest config and is available on global.chrome.
 */

import { WalletManager, AUTH_FIELDS, OP_AUTH_FIELD, authFieldsFor } from '../src/lib/wallet-manager.js';

// ---------------------------------------------------------------------------
// Global teardown: clear any lingering auto-lock timers after all tests
// ---------------------------------------------------------------------------
afterAll(() => {
  // Jest uses fake or real timers; calling jest.clearAllTimers() ensures the
  // WalletManager's setTimeout-based auto-lock timer doesn't prevent the
  // worker from exiting cleanly.
  jest.clearAllTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_BRAINKEY =
  'ABANDON ABILITY ABLE ABOUT ABOVE ABSENT ABSORB ABSTRACT ABSURD ABUSE ACCESS ACCIDENT ACCOUNT ACCUSE ACHIEVE ACID';
const TEST_PASSWORD = 'TestPassword123!';
const WRONG_PASSWORD = 'WrongPassword999!';

/**
 * Resets the in-memory chrome.storage mock between tests so that each
 * test starts with a clean slate.
 */
function resetStorage() {
  if (global.chrome && global.chrome.__resetStorage) {
    global.chrome.__resetStorage();
  }
}

/**
 * Silently lock a manager to clear its auto-lock timer without asserting anything.
 */
async function silentLock(mgr) {
  try {
    if (mgr && mgr.autoLockTimer) {
      clearTimeout(mgr.autoLockTimer);
      mgr.autoLockTimer = null;
    }
    if (mgr) {
      mgr.isUnlockedState = false;
      mgr.decryptedKeys = null;
      mgr._sessionEncryptionKey = null;
    }
  } catch (_) {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// hasWallet
// ---------------------------------------------------------------------------
describe('WalletManager.hasWallet()', () => {
  let manager;

  beforeEach(() => {
    resetStorage();
    manager = new WalletManager();
  });

  afterEach(async () => {
    await silentLock(manager);
  });

  test('returns false when storage is empty', async () => {
    const result = await manager.hasWallet();
    expect(result).toBe(false);
  });

  test('returns true after a wallet has been saved to storage', async () => {
    // Manually place a wallet object in storage (simulating a previous createWallet call)
    await new Promise((resolve) => {
      global.chrome.storage.local.set({ wallet: { name: 'test', encrypted: 'abc' } }, resolve);
    });
    const result = await manager.hasWallet();
    expect(result).toBe(true);
  });

  test('returns false after storage is cleared', async () => {
    await new Promise((resolve) =>
      global.chrome.storage.local.set({ wallet: { name: 'test' } }, resolve)
    );
    // Verify it's there first
    expect(await manager.hasWallet()).toBe(true);
    // Then clear
    resetStorage();
    expect(await manager.hasWallet()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createWallet
// ---------------------------------------------------------------------------
describe('WalletManager.createWallet()', () => {
  let manager;

  beforeEach(() => {
    resetStorage();
    manager = new WalletManager();
  });

  afterEach(async () => {
    await silentLock(manager);
  });

  test('resolves to true on success', async () => {
    const result = await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    expect(result).toBe(true);
  });

  test('stores wallet in chrome.storage.local', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);

    const stored = await new Promise((resolve) =>
      global.chrome.storage.local.get(['wallet'], resolve)
    );
    expect(stored.wallet).toBeDefined();
    expect(stored.wallet.name).toBe('My Wallet');
  });

  test('stored wallet has expected structure', async () => {
    await manager.createWallet('Test Wallet', TEST_PASSWORD, TEST_BRAINKEY);

    const stored = await new Promise((resolve) =>
      global.chrome.storage.local.get(['wallet'], resolve)
    );
    const wallet = stored.wallet;

    expect(wallet).toHaveProperty('name', 'Test Wallet');
    expect(wallet).toHaveProperty('encrypted');
    expect(wallet).toHaveProperty('salt');
    expect(wallet).toHaveProperty('publicKeys');
    expect(wallet.publicKeys).toHaveProperty('active');
    expect(wallet.publicKeys).toHaveProperty('owner');
    expect(wallet.publicKeys).toHaveProperty('memo');
    expect(wallet).toHaveProperty('version', 2);
  });

  test('wallet is unlocked immediately after creation', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    expect(manager.isUnlockedState).toBe(true);
    expect(manager.decryptedKeys).not.toBeNull();
  });

  test('hasWallet() returns true after createWallet()', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    const has = await manager.hasWallet();
    expect(has).toBe(true);
  });

  test('wallet is encrypted — raw storage does not contain the brainkey in plaintext', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);

    const stored = await new Promise((resolve) =>
      global.chrome.storage.local.get(['wallet'], resolve)
    );
    // The encrypted field should be a base64 string, not the raw brainkey
    expect(stored.wallet.encrypted).not.toContain('ABANDON');
  });
}, 60000);

// ---------------------------------------------------------------------------
// unlock
// ---------------------------------------------------------------------------
describe('WalletManager.unlock()', () => {
  let manager;

  beforeEach(async () => {
    resetStorage();
    // Create a fresh manager and wallet for each test
    manager = new WalletManager();
    await manager.createWallet('Test Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    // Lock it manually so we can test unlock
    await manager.lock();
  });

  afterEach(async () => {
    await silentLock(manager);
  });

  test('returns true with the correct password', async () => {
    const result = await manager.unlock(TEST_PASSWORD);
    expect(result).toBe(true);
  });

  test('returns false with wrong password', async () => {
    const result = await manager.unlock(WRONG_PASSWORD);
    expect(result).toBe(false);
  });

  test('sets isUnlockedState to true on correct password', async () => {
    await manager.unlock(TEST_PASSWORD);
    expect(manager.isUnlockedState).toBe(true);
  });

  test('isUnlockedState remains false on wrong password', async () => {
    await manager.unlock(WRONG_PASSWORD);
    expect(manager.isUnlockedState).toBe(false);
  });

  test('decryptedKeys is populated after successful unlock', async () => {
    await manager.unlock(TEST_PASSWORD);
    expect(manager.decryptedKeys).not.toBeNull();
    expect(manager.decryptedKeys).toHaveProperty('active');
    expect(manager.decryptedKeys).toHaveProperty('owner');
    expect(manager.decryptedKeys).toHaveProperty('memo');
  });

  test('decryptedKeys is null after failed unlock', async () => {
    await manager.unlock(WRONG_PASSWORD);
    expect(manager.decryptedKeys).toBeNull();
  });

  test('rejects with error when no wallet exists', async () => {
    resetStorage(); // Clear the wallet
    const freshManager = new WalletManager();
    await expect(freshManager.unlock(TEST_PASSWORD)).rejects.toThrow('No wallet found');
  });
}, 60000);

// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------
describe('WalletManager.lock()', () => {
  let manager;

  beforeEach(async () => {
    resetStorage();
    manager = new WalletManager();
    await manager.createWallet('Test Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    // Wallet is unlocked after createWallet
  });

  afterEach(async () => {
    await silentLock(manager);
  });

  test('sets isUnlockedState to false', async () => {
    expect(manager.isUnlockedState).toBe(true);
    await manager.lock();
    expect(manager.isUnlockedState).toBe(false);
  });

  test('clears decryptedKeys', async () => {
    expect(manager.decryptedKeys).not.toBeNull();
    await manager.lock();
    expect(manager.decryptedKeys).toBeNull();
  });

  test('calling lock twice does not throw', async () => {
    await manager.lock();
    await expect(manager.lock()).resolves.not.toThrow();
  });

  test('wallet can be unlocked again after being locked', async () => {
    await manager.lock();
    const result = await manager.unlock(TEST_PASSWORD);
    expect(result).toBe(true);
    expect(manager.isUnlockedState).toBe(true);
  });

  test('sends WALLET_LOCKED message via chrome.runtime.sendMessage', async () => {
    await manager.lock();
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'WALLET_LOCKED' });
  });
}, 60000);

// ---------------------------------------------------------------------------
// isUnlocked
// ---------------------------------------------------------------------------
describe('WalletManager.isUnlocked()', () => {
  let manager;

  beforeEach(async () => {
    resetStorage();
    manager = new WalletManager();
  });

  test('returns false when wallet has never been unlocked', async () => {
    const result = await manager.isUnlocked();
    expect(result).toBe(false);
  });

  test('returns true immediately after createWallet (wallet is unlocked on creation)', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    const result = await manager.isUnlocked();
    expect(result).toBe(true);
  });

  test('returns true after successful unlock', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    await manager.lock();
    await manager.unlock(TEST_PASSWORD);
    const result = await manager.isUnlocked();
    expect(result).toBe(true);
  });

  test('returns false after lock()', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);

    // Force-clear session key and session storage so isUnlocked() cannot
    // restore from session (simulates a freshly restarted service worker
    // with no persisted session).
    await manager.lock();
    // After locking, _sessionEncryptionKey is wiped. Also clear session storage.
    resetStorage(); // wipes session storage entries set during createWallet/lock
    // Re-add only the wallet so hasWallet still works
    const wallet = manager.currentWallet;
    if (wallet) {
      await new Promise((resolve) =>
        global.chrome.storage.local.set({ wallet }, resolve)
      );
    }

    const result = await manager.isUnlocked();
    expect(result).toBe(false);
  });

  test('reflects the in-memory isUnlockedState when decryptedKeys are present', async () => {
    await manager.createWallet('My Wallet', TEST_PASSWORD, TEST_BRAINKEY);
    // In-memory state is true, decryptedKeys populated — should return true immediately
    expect(manager.isUnlockedState).toBe(true);
    expect(manager.decryptedKeys).not.toBeNull();
    const result = await manager.isUnlocked();
    expect(result).toBe(true);
  });
}, 60000);

describe('authority fields per operation type', () => {
    // These decide two things at once: which account the wallet signs with, and which
    // accounts the connected-site boundary check constrains. Getting the field wrong
    // therefore either blocks a legitimate transaction or, worse, fails to constrain one.

    test('generic operations still use the shared field list', () => {
        // transfer (0) names its signer with `from`
        expect(authFieldsFor([0, {from: '1.2.17', to: '1.2.18'}])).toBe(AUTH_FIELDS);
    });

    test('vesting_balance_create is NOT treated as owner-signed', () => {
        // The regression this guards: `owner` there is the beneficiary and `creator` signs.
        // If `owner` were added to AUTH_FIELDS globally, creating a vesting balance for
        // somebody else would start being rejected as "not connected to this site".
        const fields = authFieldsFor([32, {creator: '1.2.17', owner: '1.2.99'}]);
        expect(fields).toBe(AUTH_FIELDS);
        expect(fields).not.toContain('owner');
    });

    test('oracle_publish resolves to the producer, not the owner', () => {
        // An oracle's owner may not publish to it unless separately listed as a producer,
        // so signing a publish as the owner would produce a guaranteed rejection.
        expect(authFieldsFor([81, {producer: '1.2.17', oracle_id: '1.23.0'}])).toEqual([
            'producer'
        ]);
    });

    test('futures_liquidate resolves to the liquidator', () => {
        // Liquidation is permissionless: the signer is whoever calls it, never the owner
        // of the position being liquidated.
        expect(authFieldsFor([88, {liquidator: '1.2.17'}])).toEqual(['liquidator']);
    });

    test('every futures and oracle operation has an authority field', () => {
        // 86 is futures_fill, a virtual operation the chain emits itself -- no wallet
        // should ever be asked to sign one, so it must NOT appear here.
        const signable = [78, 79, 80, 81, 82, 83, 84, 85, 87, 88, 89];
        signable.forEach(type => {
            expect(OP_AUTH_FIELD[type]).toBeDefined();
        });
        expect(OP_AUTH_FIELD[86]).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// decryptHistoryMemo()
//
// Every failure here has to be a REASON, not an exception. A single memo that cannot be
// read must not empty the history list, and the user needs to tell apart "unlock the
// wallet" from "this account has no memo key" — those have different remedies.
// ---------------------------------------------------------------------------
describe('WalletManager.decryptHistoryMemo()', () => {
  let wm;

  beforeEach(() => {
    resetStorage();
    wm = new WalletManager();
  });

  test('an operation with no memo reports "none", not an error', async () => {
    await expect(wm.decryptHistoryMemo(null, '1.2.100'))
      .resolves.toEqual({unavailable: 'none'});
    await expect(wm.decryptHistoryMemo({}, '1.2.100'))
      .resolves.toEqual({unavailable: 'none'});
  });

  test('a locked wallet reports "locked" rather than throwing', async () => {
    const memo = {from: 'BTS1', to: 'BTS2', nonce: '1', message: 'ab'};
    const result = await wm.decryptHistoryMemo(memo, '1.2.100');
    expect(result.text).toBeUndefined();
    expect(['locked', 'no_memo_key']).toContain(result.unavailable);
  });

  test('a hybrid memo without the KEM key reports a post-quantum reason', async () => {
    // Der Schluessel ist da, der post-quantum Anteil nicht: der Unterschied muss beim
    // Nutzer ankommen, sonst sucht er den Fehler beim klassischen Memo-Schluessel.
    wm.getAccountKeys = async () => ({memo: {privateKey:
      '5JNxWXucnrvsZAcBvRatf2NnTjG7zSsWc1tzCmmUziL73zLdgT3'}});
    wm._pqCredentialsFor = () => async () => null;

    const memo = {
      from: 'BTS1', to: 'BTS2', nonce: '1', message: 'ab',
      pq_ciphertext: 'aa'.repeat(1088)
    };
    await expect(wm.decryptHistoryMemo(memo, '1.2.100'))
      .resolves.toEqual({unavailable: 'locked'});
  });

  test('a wrong KEM key surfaces as pq_failed, not as garbled text', async () => {
    // ML-KEM weist einen falschen Schluessel nicht zurueck (FIPS 203, implicit rejection),
    // sondern liefert ein pseudozufaelliges Geheimnis. Auffallen darf das erst an der
    // Pruefsumme -- aber auffallen MUSS es.
    wm.getAccountKeys = async () => ({memo: {privateKey:
      '5JNxWXucnrvsZAcBvRatf2NnTjG7zSsWc1tzCmmUziL73zLdgT3'}});
    wm._pqCredentialsFor = () => async () => (
      {accountName: 'somebody-else', rootSecret: 'a-different-secret'});

    const memo = {
      from: 'BTS8g9Uhs5WFAFtp8QbwhotamFApRUcx6SGEjDc4Mw2QMmX1Sqq4V',
      to:   'BTS6XFoP7CtdZMiCA78T689UachQh8bAvJx7kXh5ST17QeKwqatxn',
      nonce: '1234567890123456789',
      message: 'bbcd8c51409a9f3363d0540707c033fb02f22f7af21df443bb94d7e8c45f168a5e0c41dcf713644e388939aca1f85748',
      pq_ciphertext: 'aa'.repeat(1088)
    };
    const result = await wm.decryptHistoryMemo(memo, '1.2.100');
    expect(result.text).toBeUndefined();
    expect(result.unavailable).toBe('pq_failed');
  }, 30000);
});
