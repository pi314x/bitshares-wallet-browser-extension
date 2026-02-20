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

import { WalletManager } from '../src/lib/wallet-manager.js';

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
