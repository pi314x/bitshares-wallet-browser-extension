/**
 * BitShares Wallet Manager
 * Handles wallet creation, encryption, storage, and key management
 */

import { CryptoUtils, bytesToBase64, base64ToBytes } from './crypto-utils.js';
import { BitSharesAPI } from './bitshares-api.js';

export class WalletManager {
  constructor() {
    this.isUnlockedState = false;
    this.currentWallet = null;
    this.decryptedKeys = null;
    this.api = null;

    // Auto-lock duration (timer managed via chrome.alarms)
    this.autoLockDuration = 15 * 60 * 1000; // Default: 15 minutes

    // Mutex to prevent concurrent lock/unlock race conditions
    this._lockMutex = Promise.resolve();

    // Unlock attempt rate-limiting
    this._failedUnlockAttempts = 0;
    this._unlockLockoutUntil = 0;
  }

  /**
   * Check if a wallet exists in storage
   */
  async hasWallet() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['wallet'], (result) => {
        resolve(!!result.wallet);
      });
    });
  }

  /**
   * Check if the wallet is currently unlocked
   * Checks both memory state and session storage for persisted unlock state
   */
  async isUnlocked() {
    // If already unlocked in memory, return true
    if (this.isUnlockedState && this.decryptedKeys !== null) {
      return true;
    }

    // Check if there's a valid session in storage and try to restore it
    return new Promise((resolve) => {
      const storage = chrome.storage.session || chrome.storage.local;
      storage.get(['encryptedSessionData', 'unlockTimestamp', 'autoLockDuration', 'persistedSessionKey'], async (result) => {
        if (!result.encryptedSessionData || !result.unlockTimestamp) {
          resolve(false);
          return;
        }

        // Check if unlock is still valid (within auto-lock period)
        const autoLockMs = result.autoLockDuration !== undefined ? result.autoLockDuration : this.autoLockDuration;
        if (autoLockMs > 0) {
          const elapsed = Date.now() - result.unlockTimestamp;
          if (elapsed >= autoLockMs) {
            // Session expired, clear it
            await this.clearSessionPassword();
            resolve(false);
            return;
          }
        }

        // Try to restore session encryption key if needed
        if (!this._sessionEncryptionKey && result.persistedSessionKey) {
          try {
            this._sessionEncryptionKey = new Uint8Array(
              base64ToBytes(result.persistedSessionKey)
            );
          } catch (e) {
            resolve(false);
            return;
          }
        }

        // If we have the session key, try to restore the session
        if (this._sessionEncryptionKey) {
          const restored = await this.restoreFromSession();
          resolve(restored);
        } else {
          // No session key available
          resolve(false);
        }
      });
    });
  }

  /**
   * Ensure the wallet is unlocked, restoring from session if needed
   * Call this before operations that require decrypted keys
   */
  async ensureUnlocked() {
    // Serialize lock/unlock to prevent race conditions
    const prev = this._lockMutex;
    let release;
    this._lockMutex = new Promise(r => { release = r; });
    await prev;
    try {
      // If already unlocked in memory with keys, we're good
      if (this.isUnlockedState && this.decryptedKeys !== null) {
        return true;
      }

      // Try to restore from session
      const restored = await this.restoreFromSession();
      if (!restored) {
        throw new Error('Wallet is locked');
      }
      return true;
    } finally {
      release();
    }
  }

  /**
   * Share the popup's already-connected API instance with the wallet manager.
   * Called from popup.js after initializeAPI() so that account operations use
   * the same network (mainnet/testnet) the user selected.
   */
  setApi(api) {
    this.api = api;
    // Remember the nodes so reconnection uses the same network
    this._apiNodes = api && api.nodes ? [...api.nodes] : null;
  }

  /**
   * Ensure the BitSharesAPI instance exists and its WebSocket is connected.
   * Re-creates and reconnects whenever the instance is missing or the socket
   * has dropped (e.g. after service-worker idle, network hiccup, etc.).
   * Uses the nodes saved via setApi() so reconnection stays on the correct network.
   */
  async ensureApiConnected() {
    if (!this.api || !this.api.isConnected) {
      this.api = new BitSharesAPI(this._apiNodes || null);
      await this.api.connect();
    }
  }

  /**
   * Restore unlock state from session storage
   * Used when service worker restarts but session is still valid
   *
   * SECURITY NOTE: The session encryption key is stored only in memory by default.
   * When auto-lock is disabled, the key is persisted to allow session restoration.
   */
  async restoreFromSession() {
    return new Promise((resolve) => {
      const storage = chrome.storage.session || chrome.storage.local;
      storage.get(['encryptedSessionData', 'unlockTimestamp', 'autoLockDuration', 'persistedSessionKey'], async (result) => {
        // Check if session data exists
        if (!result.unlockTimestamp || !result.encryptedSessionData) {
          resolve(false);
          return;
        }

        const autoLockMs = result.autoLockDuration !== undefined ? result.autoLockDuration : this.autoLockDuration;
        if (autoLockMs > 0) {
          const elapsed = Date.now() - result.unlockTimestamp;
          if (elapsed >= autoLockMs) {
            // Session expired - clear data
            await this.clearSessionPassword();
            resolve(false);
            return;
          }
        }

        // Try to restore session encryption key from storage (when auto-lock disabled)
        if (!this._sessionEncryptionKey && result.persistedSessionKey) {
          try {
            this._sessionEncryptionKey = new Uint8Array(
              base64ToBytes(result.persistedSessionKey)
            );
          } catch (e) {
            // Failed to restore key
            resolve(false);
            return;
          }
        }

        // If we still don't have the session encryption key, we can't restore
        if (!this._sessionEncryptionKey) {
          resolve(false);
          return;
        }

        try {
          // Decrypt the password from session storage
          const password = await this._decryptFromSession(result.encryptedSessionData);
          // Try to unlock with decrypted password
          const success = await this.unlock(password);
          resolve(success);
        } catch (error) {
          // Failed to decrypt or unlock - session is invalid
          await this.clearSessionPassword();
          resolve(false);
        }
      });
    });
  }

  // === Auto-lock Timer Methods ===

  /**
   * Set auto-lock duration in milliseconds
   * Set to 0 to disable auto-lock
   */
  async setAutoLockDuration(durationMs) {
    this.autoLockDuration = durationMs;
    // Persist setting to local storage
    return new Promise((resolve) => {
      chrome.storage.local.set({ autoLockDuration: durationMs }, () => {
        // Reset timer with new duration if unlocked
        if (this.isUnlockedState) {
          this.resetAutoLockTimer();
        }

        // Update session storage with new duration and reset timestamp
        const storage = chrome.storage.session || chrome.storage.local;
        storage.set({
          autoLockDuration: durationMs,
          unlockTimestamp: Date.now() // Reset timer when changing duration
        }, () => resolve());
      });
    });
  }

  /**
   * Get current auto-lock duration in milliseconds
   */
  async getAutoLockDuration() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['autoLockDuration'], (result) => {
        if (result.autoLockDuration !== undefined) {
          this.autoLockDuration = result.autoLockDuration;
        }
        resolve(this.autoLockDuration);
      });
    });
  }

  /**
   * Reset the auto-lock timer
   * Call this after any wallet activity to extend the unlock period
   */
  resetAutoLockTimer() {
    // Don't start timer if auto-lock is disabled or wallet is locked
    if (this.autoLockDuration <= 0 || !this.isUnlockedState) {
      return;
    }

    // Update unlock timestamp in session storage
    const storage = chrome.storage.session || chrome.storage.local;
    storage.set({ unlockTimestamp: Date.now() });

    // Delegate to chrome.alarms (survives service worker restarts).
    // The alarm listener is registered in service-worker.js setupAutoLock().
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.clear('auto-lock');
      chrome.alarms.create('auto-lock', {
        delayInMinutes: this.autoLockDuration / 60000
      });
    }
  }

  /**
   * Touch the wallet to reset auto-lock timer
   * Call this on any user activity
   */
  touch() {
    if (this.isUnlockedState) {
      this.resetAutoLockTimer();
    }
  }

  /**
   * Get remaining time until auto-lock in milliseconds
   * Returns 0 if auto-lock is disabled or wallet is locked
   */
  getTimeUntilLock() {
    if (!this.isUnlockedState || this.autoLockDuration <= 0 || !this.autoLockTimer) {
      return 0;
    }
    // Note: This is an approximation since we don't track exact start time
    return this.autoLockDuration;
  }

  /**
   * Create a new wallet with the given parameters.
   * When bitsharesAccountName and bitsharesPassword are provided (password-based
   * cloud wallet, matching wallet.bitshares.org / ex.xbts.io), keys are derived
   * from those credentials via generateKeysFromPassword.  The brainkey is stored
   * as an alternative recovery path.  When only a brainkey is supplied the legacy
   * SLIP-48 derivation is used instead.
   */
  async createWallet(name, password, brainkey, bitsharesAccountName, bitsharesPassword, network = 'mainnet') {
    try {
      // Normalize brainkey (always generated, kept as backup)
      const normalizedBrainkey = CryptoUtils.normalizeBrainkey(brainkey);

      // Validate brainkey has sufficient entropy (expect 12+ words)
      const wordCount = normalizedBrainkey.split(' ').length;
      if (wordCount < 12) {
        throw new Error(`Brainkey too short (${wordCount} words). Must be at least 12 words for sufficient entropy.`);
      }

      // Determine primary keys:
      // • password-based (cloud wallet) when BitShares credentials are provided
      // • brainkey-based (SLIP-48 HD) as fallback
      let keys;
      if (bitsharesAccountName && bitsharesPassword) {
        keys = await CryptoUtils.generateKeysFromPassword(bitsharesAccountName, bitsharesPassword);
      } else {
        keys = await CryptoUtils.generateKeysFromBrainkey(normalizedBrainkey);
      }

      // Generate unique salt for this wallet
      const salt = CryptoUtils.generateSalt();

      // Encrypt the wallet data with unique salt
      const encryptionKey = await CryptoUtils.deriveKey(password, salt);
      const encryptedData = await CryptoUtils.encrypt({
        brainkey: normalizedBrainkey,
        bitsharesAccountName: bitsharesAccountName || null,
        // Note: bitsharesPassword is intentionally NOT stored — only derived keys are kept.
        keys: keys,
        accounts: []
      }, encryptionKey);

      // Create wallet structure with salt (version 2 = with salt)
      const wallet = {
        name: name,
        encrypted: encryptedData,
        salt: salt,
        publicKeys: {
          active: keys.active.publicKey,
          owner: keys.owner.publicKey,
          memo: keys.memo.publicKey
        },
        createdAt: Date.now(),
        version: 2
      };

      // Store wallet
      await this.saveWallet(wallet);

      // Set as unlocked
      this.currentWallet = wallet;
      this.decryptedKeys = keys;
      this.isUnlockedState = true;

      // Store password for session
      await this.storeSessionPassword(password);

      // Try to find associated account on chain
      if (bitsharesAccountName) {
        await this.findAndAddAccountByName(bitsharesAccountName, network);
      } else {
        await this.findAndAddAccount(keys.active.publicKey, network);
      }

      return true;
    } catch (error) {
      throw new Error('Failed to create wallet: ' + error.message);
    }
  }

  /**
   * Import an existing wallet
   */
  async importWallet(importData, password, network = 'mainnet') {
    try {
      let keys;
      let brainkey = null;

      let bitsharesAccountName = null;

      switch (importData.type) {
        case 'account':
          // Generate keys from account name and password
          keys = await CryptoUtils.generateKeysFromPassword(
            importData.accountName,
            importData.password
          );
          bitsharesAccountName = importData.accountName;
          break;

        case 'brainkey':
          brainkey = CryptoUtils.normalizeBrainkey(importData.brainkey);
          keys = await CryptoUtils.generateKeysFromBrainkey(brainkey);
          break;

        default:
          throw new Error('Invalid import type');
      }

      // Generate unique salt for this wallet
      const salt = CryptoUtils.generateSalt();

      // Encrypt wallet data with unique salt
      const encryptionKey = await CryptoUtils.deriveKey(password, salt);
      const encryptedData = await CryptoUtils.encrypt({
        brainkey: brainkey,
        bitsharesAccountName: bitsharesAccountName,
        // Note: bitsharesPassword is intentionally NOT stored — only derived keys are kept.
        keys: keys,
        accounts: []
      }, encryptionKey);

      // Create wallet structure with salt (version 2)
      const wallet = {
        name: 'Imported Wallet',
        encrypted: encryptedData,
        salt: salt,
        publicKeys: {
          active: keys.active.publicKey,
          owner: keys.owner?.publicKey,
          memo: keys.memo?.publicKey
        },
        importType: importData.type,
        createdAt: Date.now(),
        version: 2
      };

      // Store wallet
      await this.saveWallet(wallet);

      // Set as unlocked
      this.currentWallet = wallet;
      this.decryptedKeys = keys;
      this.isUnlockedState = true;

      // Store password for session
      await this.storeSessionPassword(password);

      // Find and add account
      if (importData.type === 'account' && importData.accountName) {
        // For account import, look up the account directly by name
        await this.findAndAddAccountByName(importData.accountName, network);
      } else {
        // For other types, try to find by public key
        await this.findAndAddAccount(keys.active.publicKey, network);
      }

      return true;
    } catch (error) {
      console.error('Import wallet error:', error);
      throw new Error('Failed to import wallet: ' + error.message);
    }
  }

  /**
   * Find account by public key and add to wallet
   */
  async findAndAddAccount(publicKey, network = 'mainnet') {
    try {
      await this.ensureApiConnected();

      const accounts = await this.api.getAccountsByKey(publicKey);

      if (accounts && accounts.length > 0) {
        const accountName = accounts[0];
        const accountInfo = await this.api.getAccount(accountName);

        if (accountInfo) {
          await this.addAccount({
            name: accountName,
            id: accountInfo.id,
            network
          });
        }
      }
    } catch (error) {
      console.error('Find account error:', error);
      // Don't throw - account might not exist yet
    }
  }

  /**
   * Find account by name and add to wallet
   */
  async findAndAddAccountByName(accountName, network = 'mainnet') {
    try {
      await this.ensureApiConnected();

      const accountInfo = await this.api.getAccount(accountName);

      if (accountInfo) {
        await this.addAccount({
          name: accountInfo.name,
          id: accountInfo.id,
          network
        });
      } else {
        console.warn('Account not found on chain:', accountName);
      }
    } catch (error) {
      console.error('Find account by name error:', error);
      // Don't throw - account might not exist yet
    }
  }

  /**
   * Register a new account on-chain directly using an existing wallet account as registrar.
   * The fee-paying account must be a lifetime member.
   *
   * @param {string} newAccountName - desired BitShares account name
   * @param {{ owner: {publicKey}, active: {publicKey}, memo: {publicKey} }} newKeys
   * @param {string} feePayingAccountName - name of the lifetime-member account in this wallet
   */
  async createAccountOnChain(newAccountName, newKeys, feePayingAccountName) {
    await this.ensureUnlocked();
    this.touch();

    await this.ensureApiConnected();

    // Resolve the fee-paying (registrar) account
    const registrar = await this.api.getAccount(feePayingAccountName);
    if (!registrar) {
      throw new Error(`Account "${feePayingAccountName}" not found on the blockchain.`);
    }

    // Get the signing keys for the registrar from this wallet
    const registrarKeys = await this.getAccountKeys(registrar.id);

    const operation = {
      fee: { amount: 0, asset_id: '1.3.0' },
      registrar: registrar.id,
      referrer: registrar.id,
      referrer_percent: 0,
      name: newAccountName,
      owner: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[newKeys.owner.publicKey, 1]],
        address_auths: []
      },
      active: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[newKeys.active.publicKey, 1]],
        address_auths: []
      },
      options: {
        memo_key: newKeys.memo.publicKey,
        voting_account: '1.2.5',
        num_witness: 0,
        num_committee: 0,
        votes: [],
        extensions: []
      }
    };

    await this.api.broadcastTransaction('account_create', operation, registrarKeys.active.privateKey);
  }

  /**
   * Register a new account on the BitShares blockchain via the faucet.
   *
   * The faucet pays the account_create fee and broadcasts the transaction.
   * Throws a descriptive Error if the faucet rejects the request.
   *
   * @param {string} accountName  - desired BitShares account name
   * @param {{ owner: {publicKey}, active: {publicKey}, memo: {publicKey} }} keys
   * @param {string} [faucetUrl]  - override the default faucet endpoint
   */
  async registerAccountViaFaucet(accountName, keys, faucetUrl = 'https://faucet.xbts.io/api/v1/accounts') {
    const payload = {
      account: {
        name: accountName,
        owner_key: keys.owner.publicKey,
        active_key: keys.active.publicKey,
        memo_key: keys.memo.publicKey,
        refcode: '',
        referrer: ''
      }
    };

    let response;
    try {
      response = await fetch(faucetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (networkError) {
      throw new Error('Could not reach the faucet. Check your internet connection and try again.');
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Faucet returned status ${response.status}. Please try again later.`);
    }

    // Faucet can return errors even on 2xx, and can also return 5xx with a JSON body
    if (data.error) {
      // Faucet returns errors as { error: { base: ["msg"] } } or { error: "msg" }
      const msg =
        (data.error.base && data.error.base[0]) ||
        (typeof data.error === 'string' ? data.error : null) ||
        JSON.stringify(data.error);
      throw new Error(msg);
    }

    if (!response.ok) {
      throw new Error(`Faucet returned status ${response.status}. Please try again later.`);
    }

    return data;
  }

  /**
   * Add an account to the wallet
   */
  async addAccount(account) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet'], async (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        try {
          const wallet = result.wallet;
          
          // Decrypt current data
          if (!this.decryptedKeys) {
            reject(new Error('Wallet is locked'));
            return;
          }

          // Get current accounts
          let accounts = [];
          try {
            const password = await this.getStoredPassword();
            const salt = this._getWalletSalt(wallet);
            const encryptionKey = await CryptoUtils.deriveKey(password, salt);
            const decrypted = await CryptoUtils.decrypt(wallet.encrypted, encryptionKey);
            accounts = decrypted.accounts || [];
          } catch (e) {
            accounts = [];
          }

          // Add account if not exists
          if (!accounts.find(a => a.id === account.id)) {
            accounts.push({
              name: account.name,
              id: account.id,
              network: account.network || 'mainnet',
              addedAt: Date.now()
            });
          }

          // Update wallet account list (unencrypted for quick access)
          wallet.accounts = accounts.map(a => ({ name: a.name, id: a.id, network: a.network || 'mainnet' }));
          
          await this.saveWallet(wallet);
          this.currentWallet = wallet;
          
          resolve(true);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Get the salt for a wallet (supports legacy wallets without salt)
   */
  _getWalletSalt(wallet) {
    return wallet?.salt || null; // null for legacy wallets
  }

  /**
   * Unlock the wallet with password
   */
  async unlock(password) {
    // Rate-limit failed attempts: exponential backoff (1s, 2s, 4s, 8s, 16s)
    const now = Date.now();
    if (now < this._unlockLockoutUntil) {
      const waitSec = Math.ceil((this._unlockLockoutUntil - now) / 1000);
      throw new Error(`Too many failed attempts. Try again in ${waitSec}s.`);
    }

    // Serialize lock/unlock to prevent race conditions
    const prev = this._lockMutex;
    let release;
    this._lockMutex = new Promise(r => { release = r; });
    await prev;
    try {
      const success = await new Promise((resolve, reject) => {
        chrome.storage.local.get(['wallet', 'autoLockDuration'], async (result) => {
          if (!result.wallet) {
            reject(new Error('No wallet found'));
            return;
          }

          try {
            const wallet = result.wallet;
            const salt = this._getWalletSalt(wallet);
            const encryptionKey = await CryptoUtils.deriveKey(password, salt);
            const decrypted = await CryptoUtils.decrypt(wallet.encrypted, encryptionKey);

            this.currentWallet = wallet;
            this.decryptedKeys = decrypted.keys;
            this.isUnlockedState = true;

            // Store password hash temporarily for session
            await this.storeSessionPassword(password);

            // Load saved auto-lock duration and start timer
            if (result.autoLockDuration !== undefined) {
              this.autoLockDuration = result.autoLockDuration;
            }
            this.resetAutoLockTimer();

            resolve(true);
          } catch (error) {
            resolve(false);
          }
        });
      });

      if (success) {
        this._failedUnlockAttempts = 0;
        this._unlockLockoutUntil = 0;
      } else {
        this._failedUnlockAttempts++;
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 60s
        const delaySec = Math.min(60, Math.pow(2, this._failedUnlockAttempts - 1));
        this._unlockLockoutUntil = Date.now() + delaySec * 1000;
      }
      return success;
    } finally {
      release();
    }
  }

  /**
   * Lock the wallet
   */
  async lock() {
    // Serialize lock/unlock to prevent race conditions
    const prev = this._lockMutex;
    let release;
    this._lockMutex = new Promise(r => { release = r; });
    await prev;
    try {
      // Clear auto-lock alarm
      if (typeof chrome !== 'undefined' && chrome.alarms) {
        chrome.alarms.clear('auto-lock');
      }

      this.isUnlockedState = false;
      this.decryptedKeys = null;
      await this.clearSessionPassword();
    } finally {
      release();
    }

    // Notify background script
    chrome.runtime.sendMessage({ type: 'WALLET_LOCKED' });
  }

  /**
   * Get current account
   */
  async getCurrentAccount() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet', 'activeAccount'], (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        const wallet = result.wallet;
        const activeAccountId = result.activeAccount;

        if (wallet.accounts && wallet.accounts.length > 0) {
          // Return active account or first account
          const account = activeAccountId
            ? wallet.accounts.find(a => a.id === activeAccountId)
            : wallet.accounts[0];

          resolve(account || wallet.accounts[0]);
        } else {
          // Return placeholder if no accounts found yet
          resolve({
            name: 'No Account',
            id: '1.2.0'
          });
        }
      });
    });
  }

  /**
   * Get all accounts in the wallet
   */
  async getAllAccounts(network = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['wallet', 'activeAccount'], (result) => {
        if (!result.wallet || !result.wallet.accounts) {
          resolve([]);
          return;
        }

        const activeAccountId = result.activeAccount;
        let accounts = result.wallet.accounts.map(a => ({
          ...a,
          // Legacy accounts without network field default to mainnet
          network: a.network || 'mainnet',
          isActive: a.id === activeAccountId || (!activeAccountId && result.wallet.accounts.indexOf(a) === 0)
        }));

        // Filter by network if specified
        if (network) {
          accounts = accounts.filter(a => a.network === network);
        }

        resolve(accounts);
      });
    });
  }

  /**
   * Set the active account
   */
  async setActiveAccount(accountId) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet'], (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        const wallet = result.wallet;
        const account = wallet.accounts?.find(a => a.id === accountId);

        if (!account) {
          reject(new Error('Account not found'));
          return;
        }

        chrome.storage.local.set({ activeAccount: accountId }, () => {
          // Notify about account change
          chrome.runtime.sendMessage({
            type: 'ACCOUNT_CHANGED',
            data: account
          }).catch(() => {});

          resolve(account);
        });
      });
    });
  }

  /**
   * Update the network assignment for an account
   * @param {string} accountId - Account ID
   * @param {string} network - 'mainnet' | 'testnet'
   */
  async updateAccountNetwork(accountId, network) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet'], (result) => {
        if (!result.wallet || !result.wallet.accounts) {
          reject(new Error('No wallet found'));
          return;
        }
        const wallet = result.wallet;
        const account = wallet.accounts.find(a => a.id === accountId);
        if (!account) {
          reject(new Error('Account not found'));
          return;
        }
        account.network = network;
        this.saveWallet(wallet).then(() => {
          this.currentWallet = wallet;
          resolve(true);
        }).catch(reject);
      });
    });
  }

  /**
   * Add a new account by credentials (account name + BitShares password)
   * @param {string} accountName - BitShares account name
   * @param {string} bitsharesPassword - BitShares password for key derivation
   * @param {string} walletPassword - Wallet password for encryption
   * @param {boolean} skipVerify - Skip key verification (for accounts with custom keys)
   */
  async addAccountByCredentials(accountName, bitsharesPassword, walletPassword, skipVerify = false, keyPrefix = 'BTS', network = 'mainnet') {
    // Verify wallet password first
    const passwordValid = await this.verifyPassword(walletPassword);
    if (!passwordValid) {
      throw new Error('Invalid wallet password');
    }

    try {
      await this.ensureApiConnected();

      // Check if account exists on chain
      const accountInfo = await this.api.getAccount(accountName);
      if (!accountInfo) {
        throw new Error('Account not found on BitShares network');
      }

      // Generate keys from credentials using the correct prefix for this network
      const keys = await CryptoUtils.generateKeysFromPassword(accountName, bitsharesPassword, keyPrefix);

      // Verify keys match unless skipVerify is true
      if (!skipVerify) {
        // Verify at least one of the generated keys matches the account's keys
        // Check active, owner, and memo keys
        const generatedActiveKey = keys.active?.publicKey;
        const generatedOwnerKey = keys.owner?.publicKey;
        const generatedMemoKey = keys.memo?.publicKey;

        // Get account keys from chain
        const accountActiveKeys = accountInfo.active?.key_auths?.map(k => k[0]) || [];
        const accountOwnerKeys = accountInfo.owner?.key_auths?.map(k => k[0]) || [];
        const accountMemoKey = accountInfo.options?.memo_key;

        // Helper to compare keys (handles different prefix formats)
        const keysMatch = (key1, key2) => {
          if (!key1 || !key2) return false;
          // Remove common prefixes for comparison
          const normalize = (k) => k.replace(/^(BTS|GPH|TEST)/, '');
          return normalize(key1) === normalize(key2);
        };

        // Check if any generated key matches any account key
        const activeMatches = accountActiveKeys.some(k => keysMatch(generatedActiveKey, k));
        const ownerMatches = accountOwnerKeys.some(k => keysMatch(generatedOwnerKey, k));
        const memoMatches = keysMatch(generatedMemoKey, accountMemoKey);

        // Key verification complete - no debug logging in production

        if (!activeMatches && !ownerMatches && !memoMatches) {
          // Provide more helpful error message
          throw new Error(
            'Password does not match this account. None of the generated keys match the on-chain active, owner, or memo authority.'
          );
        }
      }

      // Check if account already exists in wallet
      const existingAccounts = await this.getAllAccounts();
      if (existingAccounts.find(a => a.id === accountInfo.id)) {
        throw new Error('Account already exists in wallet');
      }

      // Store the account with its own encrypted keys
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(['wallet'], async (result) => {
          try {
            const wallet = result.wallet;
            const salt = this._getWalletSalt(wallet);

            // Get encryption key from wallet password
            const encryptionKey = await CryptoUtils.deriveKey(walletPassword, salt);

            // Encrypt the account's keys (password intentionally not stored)
            const encryptedAccountData = await CryptoUtils.encrypt({
              keys: keys
            }, encryptionKey);

            // Add to accounts list
            if (!wallet.accounts) {
              wallet.accounts = [];
            }

            // Store encrypted keys in a separate storage with account ID as key
            const accountKeyData = {};
            accountKeyData[`accountKeys_${accountInfo.id}`] = encryptedAccountData;

            wallet.accounts.push({
              name: accountInfo.name,
              id: accountInfo.id,
              hasOwnKeys: true,
              network,
              addedAt: Date.now()
            });

            await this.saveWallet(wallet);

            // Store encrypted keys separately
            chrome.storage.local.set(accountKeyData, () => {
              resolve({
                name: accountInfo.name,
                id: accountInfo.id
              });
            });
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Add account error:', error);
      throw error;
    }
  }

  /**
   * Add a watch-only account (no private keys, view only)
   * @param {string} accountName - BitShares account name
   */
  async addWatchOnlyAccount(accountName, network = 'mainnet') {
    try {
      await this.ensureApiConnected();

      // Check if account exists on chain
      const accountInfo = await this.api.getAccount(accountName);
      if (!accountInfo) {
        throw new Error('Account not found on BitShares network');
      }

      // Check if account already exists in wallet
      const existingAccounts = await this.getAllAccounts();
      if (existingAccounts.find(a => a.id === accountInfo.id)) {
        throw new Error('Account already exists in wallet');
      }

      // Add to accounts list without keys
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(['wallet'], async (result) => {
          try {
            const wallet = result.wallet;

            if (!wallet.accounts) {
              wallet.accounts = [];
            }

            wallet.accounts.push({
              name: accountInfo.name,
              id: accountInfo.id,
              watchOnly: true,
              network,
              addedAt: Date.now()
            });

            await this.saveWallet(wallet);
            this.currentWallet = wallet;

            resolve({
              name: accountInfo.name,
              id: accountInfo.id,
              watchOnly: true
            });
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Add watch-only account error:', error);
      throw error;
    }
  }

  /**
   * Check if an account is watch-only
   * @param {string} accountId - Account ID to check
   */
  async isWatchOnlyAccount(accountId) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['wallet'], (result) => {
        if (!result.wallet || !result.wallet.accounts) {
          resolve(false);
          return;
        }
        const account = result.wallet.accounts.find(a => a.id === accountId);
        resolve(account?.watchOnly === true);
      });
    });
  }

  /**
   * Remove an account from the wallet
   */
  async removeAccount(accountId) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet', 'activeAccount'], async (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        const wallet = result.wallet;

        if (!wallet.accounts || wallet.accounts.length === 0) {
          reject(new Error('No accounts to remove'));
          return;
        }

        // Don't allow removing the last account
        if (wallet.accounts.length === 1) {
          reject(new Error('Cannot remove the last account'));
          return;
        }

        const accountIndex = wallet.accounts.findIndex(a => a.id === accountId);
        if (accountIndex === -1) {
          reject(new Error('Account not found'));
          return;
        }

        // Remove the account
        wallet.accounts.splice(accountIndex, 1);
        await this.saveWallet(wallet);

        // Remove encrypted keys for this account
        chrome.storage.local.remove([`accountKeys_${accountId}`]);

        // If removing active account, switch to first remaining account
        if (result.activeAccount === accountId) {
          const newActiveAccount = wallet.accounts[0];
          chrome.storage.local.set({ activeAccount: newActiveAccount.id });
        }

        resolve(true);
      });
    });
  }

  /**
   * Verify wallet password
   */
  async verifyPassword(password) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['wallet'], async (result) => {
        if (!result.wallet) {
          resolve(false);
          return;
        }

        try {
          const salt = this._getWalletSalt(result.wallet);
          const encryptionKey = await CryptoUtils.deriveKey(password, salt);
          await CryptoUtils.decrypt(result.wallet.encrypted, encryptionKey);
          resolve(true);
        } catch (e) {
          resolve(false);
        }
      });
    });
  }

  /**
   * Get keys for a specific account (for signing)
   */
  async getAccountKeys(accountId) {
    if (!this.isUnlockedState) {
      throw new Error('Wallet is locked');
    }

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet', `accountKeys_${accountId}`], async (result) => {
        try {
          const wallet = result.wallet;
          const account = wallet?.accounts?.find(a => a.id === accountId);

          if (!account) {
            reject(new Error('Account not found'));
            return;
          }

          // If account has its own keys, decrypt them
          if (account.hasOwnKeys && result[`accountKeys_${accountId}`]) {
            const password = await this.getStoredPassword();
            const salt = this._getWalletSalt(wallet);
            const encryptionKey = await CryptoUtils.deriveKey(password, salt);
            const decrypted = await CryptoUtils.decrypt(
              result[`accountKeys_${accountId}`],
              encryptionKey
            );
            resolve(decrypted.keys);
          } else {
            // Use the default wallet keys
            resolve(this.decryptedKeys);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Get brainkey (requires unlock)
   */
  async getBrainkey() {
    // Restores session if the popup was reopened (service worker may have restarted)
    await this.ensureUnlocked();

    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet'], async (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        try {
          const password = await this.getStoredPassword();
          const salt = this._getWalletSalt(result.wallet);
          const encryptionKey = await CryptoUtils.deriveKey(password, salt);
          const decrypted = await CryptoUtils.decrypt(result.wallet.encrypted, encryptionKey);
          resolve(decrypted.brainkey);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Send a transfer transaction
   */
  async sendTransfer(to, amount, assetId, memo, encryptMemo = false) {
    // Ensure unlocked (will restore from session if service worker restarted)
    await this.ensureUnlocked();

    // Reset auto-lock timer on activity
    this.touch();

    try {
      await this.ensureApiConnected();

      const fromAccount = await this.getCurrentAccount();

      // Get the correct keys for this account
      const keys = await this.getAccountKeys(fromAccount.id);
      const toAccount = await this.api.getAccount(to);

      if (!toAccount) {
        throw new Error('Recipient account not found');
      }

      // Get asset info
      const asset = await this.api.getAsset(assetId);
      const precision = Math.pow(10, asset.precision);
      const amountInt = Math.round(parseFloat(amount) * precision);

      // Build transfer operation
      let memoObject = null;
      if (memo && memo.trim()) {
        // Get memo keys for proper memo structure
        const fromMemoKey = fromAccount.options?.memo_key;
        const toMemoKey = toAccount.options?.memo_key;

        // Only create memo if both accounts have memo keys
        if (fromMemoKey && toMemoKey && fromMemoKey.length > 10 && toMemoKey.length > 10) {
          // Convert memo string to hex-encoded bytes
          const encoder = new TextEncoder();
          const memoBytes = encoder.encode(memo);
          const memoHex = Array.from(memoBytes).map(b => b.toString(16).padStart(2, '0')).join('');

          // Generate unique nonce: timestamp (ms) in upper 48 bits + 16 random bits
          const ts = BigInt(Date.now());
          const randBytes = crypto.getRandomValues(new Uint8Array(2));
          const rand = BigInt(randBytes[0]) << 8n | BigInt(randBytes[1]);
          const nonce = ((ts << 16n) | rand).toString();

          // BitShares requires full memo_data structure
          memoObject = {
            from: fromMemoKey,
            to: toMemoKey,
            nonce: nonce,
            message: memoHex
          };
        } else {
          console.warn('Cannot send memo: one or both accounts missing memo key');
        }
      }

      const operation = {
        fee: { amount: 0, asset_id: '1.3.0' },
        from: fromAccount.id,
        to: toAccount.id,
        amount: { amount: amountInt, asset_id: assetId }
      };

      // Only include memo field if we have a memo
      if (memoObject) {
        operation.memo = memoObject;
      }

      // Sign and broadcast
      const result = await this.api.broadcastTransaction(
        'transfer',
        operation,
        keys.active.privateKey
      );

      return { success: true, result };
    } catch (error) {
      console.error('Transfer error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign a transaction from dApp request
   */
  async signTransaction(transaction) {
    // Ensure unlocked (will restore from session if service worker restarted)
    await this.ensureUnlocked();

    // Reset auto-lock timer on activity
    this.touch();

    try {
      await this.ensureApiConnected();

      // Get keys for the current account
      const currentAccount = await this.getCurrentAccount();
      const keys = await this.getAccountKeys(currentAccount.id);

      // Normalise: accept either a full tx object or a raw operations array
      let tx;
      if (transaction && Array.isArray(transaction.operations)) {
        tx = transaction;
      } else if (Array.isArray(transaction)) {
        tx = { operations: transaction, extensions: [] };
      } else {
        throw new Error('Invalid transaction format: expected { operations: [...] } or [[opType, opData], ...]');
      }

      // Sign the transaction AND broadcast it (fills fees, refreshes headers, signs, broadcasts)
      const result = await this.api.signAndBroadcast(tx, keys.active.privateKey);
      return { success: true, result };
    } catch (error) {
      console.error('Sign transaction error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset wallet - removes all data
   */
  async resetWallet() {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        this.currentWallet = null;
        this.decryptedKeys = null;
        this.isUnlockedState = false;
        resolve(true);
      });
    });
  }

  // === Private Helper Methods ===

  async saveWallet(wallet) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ wallet }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async storeSessionPassword(password) {
    // Generate a new key locally — do NOT assign to this._sessionEncryptionKey yet.
    // Updating the in-memory key before the storage write completes causes a race:
    // concurrent callers find the new key in memory but old-key-encrypted data in
    // storage, producing "Failed to decrypt session data".
    const newKey = CryptoUtils.randomBytes(32);

    const encryptedPassword = await this._encryptForSession(password, newKey);

    return new Promise((resolve) => {
      // Prefer session storage (cleared on browser close) over local storage.
      // Firefox MV2 lacks chrome.storage.session — fall back with a warning.
      const storage = chrome.storage.session || chrome.storage.local;
      if (!chrome.storage.session) {
        console.warn('chrome.storage.session unavailable; session key stored in local storage (Firefox MV2 fallback)');
      }
      const sessionData = {
        encryptedSessionData: encryptedPassword,
        unlockTimestamp: Date.now(),
        autoLockDuration: this.autoLockDuration,
        persistedSessionKey: bytesToBase64(newKey)
      };

      storage.set(sessionData, () => {
        // Commit new key to memory only after the storage write is confirmed.
        this._sessionEncryptionKey = newKey;
        resolve();
      });
    });
  }

  async _encryptForSession(data, rawKey = this._sessionEncryptionKey) {
    if (!rawKey) {
      throw new Error('No session encryption key');
    }
    // Use AES-GCM with the provided key
    const iv = CryptoUtils.randomBytes(12);
    const key = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );
    const encoded = new TextEncoder().encode(data);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );
    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return bytesToBase64(combined);
  }

  async _decryptFromSession(encryptedData) {
    if (!this._sessionEncryptionKey) {
      throw new Error('No session encryption key - session expired');
    }
    const combined = base64ToBytes(encryptedData);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const key = await crypto.subtle.importKey(
      'raw',
      this._sessionEncryptionKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }

  async getStoredPassword() {
    // Always read persistedSessionKey fresh from storage.
    // The popup and the service worker are separate JS contexts, each with their own
    // WalletManager instance and their own this._sessionEncryptionKey in memory.
    // When the popup re-unlocks it writes a NEW key to storage; the service worker's
    // in-memory copy is now stale. Reading the key from storage on every call
    // guarantees both contexts always decrypt with the correct, current key.
    return new Promise((resolve, reject) => {
      const storage = chrome.storage.session || chrome.storage.local;
      storage.get(['encryptedSessionData', 'persistedSessionKey'], async (result) => {
        if (!result?.encryptedSessionData || !result?.persistedSessionKey) {
          reject(new Error('Session expired'));
          return;
        }
        try {
          // Restore the current key from storage and sync in-memory copy
          const currentKey = new Uint8Array(
            base64ToBytes(result.persistedSessionKey)
          );
          this._sessionEncryptionKey = currentKey;
          const password = await this._decryptFromSession(result.encryptedSessionData);
          resolve(password);
        } catch (e) {
          reject(new Error('Failed to decrypt session data: ' + e.message));
        }
      });
    });
  }

  async clearSessionPassword() {
    // Securely clear the session encryption key
    if (this._sessionEncryptionKey) {
      this._sessionEncryptionKey.fill(0);
      this._sessionEncryptionKey = null;
    }
    return new Promise((resolve) => {
      const storage = chrome.storage.session || chrome.storage.local;
      storage.remove(['encryptedSessionData', 'unlockTimestamp', 'persistedSessionKey'], () => resolve());
    });
  }

  /**
   * Get all connected sites
   * @param {string} accountId - Optional filter by account ID
   */
  async getConnectedSites(accountId = null, network = null) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['connectedSites'], (result) => {
        let sites = result.connectedSites || [];
        if (accountId) {
          sites = sites.filter(s => s.accountId === accountId);
        }
        if (network) {
          // Legacy sites without network field are treated as mainnet
          sites = sites.filter(s => (s.network || 'mainnet') === network);
        }
        resolve(sites);
      });
    });
  }

  /**
   * Add a connected site for a specific account
   * @param {string} origin - Site origin URL
   * @param {string} accountId - Account ID to connect
   * @param {string} accountName - Account name for display
   * @param {Array} permissions - Permissions granted
   */
  async addConnectedSite(origin, accountId, accountName, permissions = [], network = 'mainnet') {
    const sites = await this.getConnectedSites();
    // Check if this origin+account+network combination already exists
    const existingIndex = sites.findIndex(s => s.origin === origin && s.accountId === accountId && (s.network || 'mainnet') === network);

    if (existingIndex >= 0) {
      sites[existingIndex].permissions = permissions;
      sites[existingIndex].lastConnected = Date.now();
    } else {
      sites.push({
        origin,
        accountId,
        accountName,
        permissions,
        network,
        connectedAt: Date.now(),
        lastConnected: Date.now()
      });
    }

    return new Promise((resolve) => {
      chrome.storage.local.set({ connectedSites: sites }, resolve);
    });
  }

  /**
   * Remove a connected site
   * @param {string} origin - Site origin URL
   * @param {string} accountId - Optional account ID (removes all if not provided)
   */
  async removeConnectedSite(origin, accountId = null) {
    const sites = await this.getConnectedSites();
    let filtered;
    if (accountId) {
      // Remove only the specific origin+account connection
      filtered = sites.filter(s => !(s.origin === origin && s.accountId === accountId));
    } else {
      // Remove all connections for this origin (legacy behavior)
      filtered = sites.filter(s => s.origin !== origin);
    }

    return new Promise((resolve) => {
      chrome.storage.local.set({ connectedSites: filtered }, resolve);
    });
  }

  /**
   * Check if site is connected (to any account or specific account)
   * @param {string} origin - Site origin URL
   * @param {string} accountId - Optional specific account ID to check
   */
  async isSiteConnected(origin, accountId = null, network = null) {
    const sites = await this.getConnectedSites();
    return sites.some(s => {
      if (s.origin !== origin) return false;
      if (accountId && s.accountId !== accountId) return false;
      if (network && (s.network || 'mainnet') !== network) return false;
      return true;
    });
  }

  /**
   * Get connected account for a site
   * @param {string} origin - Site origin URL
   * @returns {Object|null} Account info or null
   */
  async getConnectedAccountForSite(origin, network = null) {
    const sites = await this.getConnectedSites();
    const connection = sites.find(s => s.origin === origin && (!network || (s.network || 'mainnet') === network));
    if (connection) {
      return {
        accountId: connection.accountId,
        accountName: connection.accountName
      };
    }
    return null;
  }

  /**
   * Change wallet password
   */
  async changePassword(currentPassword, newPassword) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['wallet'], async (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        try {
          const wallet = result.wallet;
          const salt = this._getWalletSalt(wallet);

          // Verify current password by trying to decrypt
          const currentKey = await CryptoUtils.deriveKey(currentPassword, salt);
          let decrypted;
          try {
            decrypted = await CryptoUtils.decrypt(wallet.encrypted, currentKey);
          } catch (e) {
            // Current password is wrong
            resolve(false);
            return;
          }

          // Re-encrypt with new password using same salt
          const newKey = await CryptoUtils.deriveKey(newPassword, salt);
          const newEncrypted = await CryptoUtils.encrypt(decrypted, newKey);

          // Update wallet
          wallet.encrypted = newEncrypted;
          await this.saveWallet(wallet);

          // Update session password
          await this.storeSessionPassword(newPassword);

          resolve(true);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Get private key (requires password verification)
   * @param {string} password - Wallet password
   * @param {string} keyType - Key type: 'active', 'owner', or 'memo'
   * @param {string} accountId - Optional account ID (uses default wallet keys if not provided)
   */
  async getPrivateKey(password, keyType = 'active', accountId = null) {
    return new Promise((resolve, reject) => {
      const storageKeys = ['wallet'];
      if (accountId) {
        storageKeys.push(`accountKeys_${accountId}`);
      }

      chrome.storage.local.get(storageKeys, async (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        try {
          const wallet = result.wallet;
          const salt = this._getWalletSalt(wallet);

          // Verify password by decrypting main wallet
          const encryptionKey = await CryptoUtils.deriveKey(password, salt);
          let decrypted;
          try {
            decrypted = await CryptoUtils.decrypt(wallet.encrypted, encryptionKey);
          } catch (e) {
            // Password is wrong
            resolve(null);
            return;
          }

          // Get keys - either from specific account or default wallet keys
          let keys;
          if (accountId && result[`accountKeys_${accountId}`]) {
            // Decrypt account-specific keys
            const account = wallet.accounts?.find(a => a.id === accountId);
            if (account?.hasOwnKeys) {
              try {
                const accountData = await CryptoUtils.decrypt(
                  result[`accountKeys_${accountId}`],
                  encryptionKey
                );
                keys = accountData.keys;
              } catch (e) {
                // Fall back to default wallet keys
                keys = decrypted.keys;
              }
            } else {
              keys = decrypted.keys;
            }
          } else {
            keys = decrypted.keys;
          }

          let privateKey = null;
          let publicKey = null;

          switch (keyType) {
            case 'active':
              privateKey = keys.active?.privateKey;
              publicKey = keys.active?.publicKey;
              break;
            case 'owner':
              privateKey = keys.owner?.privateKey;
              publicKey = keys.owner?.publicKey;
              break;
            case 'memo':
              privateKey = keys.memo?.privateKey;
              publicKey = keys.memo?.publicKey;
              break;
          }

          if (privateKey) {
            resolve({ privateKey, publicKey });
          } else {
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Get BitShares password (requires wallet password verification)
   * Only available for wallets imported via account+password method
   * @param {string} password - Wallet password
   * @param {string} accountId - Optional account ID (uses default wallet if not provided)
   */
  async getBitsharesPassword(password, accountId = null) {
    return new Promise((resolve, reject) => {
      const storageKeys = ['wallet'];
      if (accountId) {
        storageKeys.push(`accountKeys_${accountId}`);
      }

      chrome.storage.local.get(storageKeys, async (result) => {
        if (!result.wallet) {
          reject(new Error('No wallet found'));
          return;
        }

        try {
          const wallet = result.wallet;
          const salt = this._getWalletSalt(wallet);

          // Verify password by decrypting
          const encryptionKey = await CryptoUtils.deriveKey(password, salt);
          let decrypted;
          try {
            decrypted = await CryptoUtils.decrypt(wallet.encrypted, encryptionKey);
          } catch (e) {
            // Password is wrong
            resolve(null);
            return;
          }

          // Check for account-specific BitShares password
          if (accountId && result[`accountKeys_${accountId}`]) {
            const account = wallet.accounts?.find(a => a.id === accountId);
            if (account?.hasOwnKeys) {
              try {
                const accountData = await CryptoUtils.decrypt(
                  result[`accountKeys_${accountId}`],
                  encryptionKey
                );
                if (accountData.bitsharesPassword) {
                  resolve({
                    accountName: accountData.bitsharesAccountName || account.name,
                    password: accountData.bitsharesPassword
                  });
                  return;
                }
              } catch (e) {
                // Fall through to default wallet
              }
            }
          }

          // Check default wallet's BitShares password
          if (decrypted.bitsharesPassword) {
            resolve({
              accountName: decrypted.bitsharesAccountName,
              password: decrypted.bitsharesPassword
            });
          } else {
            // Wallet was not imported via account+password method
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Broadcast a custom operation (for swap, etc.)
   */
  async broadcastOperation(operationType, operationData) {
    // Ensure unlocked (will restore from session if service worker restarted)
    await this.ensureUnlocked();

    // Reset auto-lock timer on activity
    this.touch();

    try {
      await this.ensureApiConnected();

      // Get keys for the current account
      const currentAccount = await this.getCurrentAccount();
      const keys = await this.getAccountKeys(currentAccount.id);

      const result = await this.api.broadcastTransaction(
        operationType,
        operationData,
        keys.active.privateKey
      );

      return result;
    } catch (error) {
      console.error('Broadcast operation error:', error);
      throw error;
    }
  }
}
