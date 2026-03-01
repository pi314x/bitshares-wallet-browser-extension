/**
 * BitShares Wallet - Inpage Script
 * Provides the BitShares wallet API to web pages
 * This script runs in the page context
 */

(function() {
  'use strict';

  // Prevent multiple definitions
  if (window.bitsharesWallet) {
    return;
  }

  let requestId = 0;
  const pendingRequests = new Map();
  const eventListeners = new Map();

  /**
   * Send a request to the extension
   */
  function sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      
      pendingRequests.set(id, { resolve, reject });

      // Set timeout
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 120000); // 2 minute timeout for user interactions

      window.postMessage({
        type: 'BITSHARES_WALLET_REQUEST',
        method,
        params,
        id
      }, window.location.origin);
    });
  }

  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const { type, id, data, error, event: eventType } = event.data;

    if (type === 'BITSHARES_WALLET_RESPONSE') {
      if (id && pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id);
        pendingRequests.delete(id);

        if (error) {
          reject(new Error(error));
        } else {
          resolve(data);
        }
      }
    } else if (type === 'BITSHARES_WALLET_EVENT') {
      // Update internal state for account changes
      if (eventType === 'accountChanged' && event.data.data) {
        updateProviderAccount(event.data.data);
      }
      // Update cached chainId when the network changes or the wallet unlocks
      if ((eventType === 'networkChanged' || eventType === 'unlocked') && event.data.data && providerInstance) {
        providerInstance.chainId = event.data.data.chainId || null;
      }
      // Emit event to listeners
      emitEvent(eventType, event.data.data);
    }
  });

  /**
   * Emit event to all listeners
   */
  function emitEvent(eventType, data) {
    const listeners = eventListeners.get(eventType) || [];
    listeners.forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error('BitShares Wallet event listener error:', err);
      }
    });
  }

  /**
   * Update provider account from account change event
   */
  let providerInstance = null;
  function updateProviderAccount(accountData) {
    if (providerInstance && accountData) {
      providerInstance.account = {
        name: accountData.name,
        id: accountData.id
      };
    }
  }

  /**
   * BitShares Wallet Provider API
   * Similar to MetaMask's ethereum provider
   */
  class BitSharesProvider {
    constructor() {
      this.isBitSharesWallet = true;
      this.isConnected = false;
      this.chainId = null;
      this.account = null;
    }

    /**
     * Connect to the wallet
     * @param {Object} options - Connection options
     * @returns {Promise<{account: {name: string, id: string}, balances: Array}>}
     */
    async connect(options = {}) {
      const response = await sendRequest('connect', options);
      if (response.connected) {
        this.isConnected = true;
        // Use account from connection response (avoid extra request)
        if (response.account) {
          this.account = response.account;
        }
        // Return full response with account and balances
        return {
          account: response.account || this.account,
          balances: response.balances || []
        };
      }
      throw new Error('Connection rejected');
    }

    /**
     * Disconnect from the wallet
     * @returns {Promise<void>}
     */
    async disconnect() {
      await sendRequest('disconnect');
      this.isConnected = false;
      this.account = null;
    }

    /**
     * Check if current account is connected to this site
     * @returns {Promise<{connected: boolean, account: Object|null}>}
     */
    async checkConnection() {
      const response = await sendRequest('checkConnection');
      this.isConnected = response.connected;
      if (response.connected && response.account) {
        this.account = response.account;
      }
      return response;
    }

    /**
     * Get current account
     * @returns {Promise<{name: string, id: string}>}
     */
    async getAccount() {
      const response = await sendRequest('getAccount');
      return {
        name: response.name,
        id: response.id
      };
    }

    /**
     * Get chain ID
     * @returns {Promise<string>}
     */
    async getChainId() {
      const response = await sendRequest('getChainId');
      this.chainId = response.chainId;
      return response.chainId;
    }

    /**
     * Sign and broadcast a transaction
     * @param {Object} transaction - Transaction object
     * @returns {Promise<Object>}
     */
    async signTransaction(transaction) {
      if (!this.isConnected) {
        throw new Error('Not connected');
      }
      return await sendRequest('signTransaction', { transaction });
    }

    /**
     * Sign a message (not broadcasted)
     * @param {string} message - Message to sign
     * @returns {Promise<string>}
     */
    async signMessage(message) {
      if (!this.isConnected) {
        throw new Error('Not connected');
      }
      return await sendRequest('signMessage', { message });
    }

    /**
     * Request transfer
     * @param {Object} params - Transfer parameters
     * @returns {Promise<Object>}
     */
    async transfer(params) {
      if (!this.isConnected) {
        throw new Error('Not connected');
      }
      return await sendRequest('transfer', params);
    }

    /**
     * Vote for witnesses/committee
     * @param {Object} params - Vote parameters
     * @returns {Promise<Object>}
     */
    async vote(params) {
      if (!this.isConnected) {
        throw new Error('Not connected');
      }
      return await sendRequest('vote', params);
    }

    /**
     * Generic request method
     * @param {string} method - Method name
     * @param {Object} params - Parameters
     * @returns {Promise<any>}
     */
    async request(method, params = {}) {
      return await sendRequest(method, params);
    }

    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(callback);
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    off(event, callback) {
      const listeners = eventListeners.get(event);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }

    /**
     * Add one-time event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    once(event, callback) {
      const wrapper = (data) => {
        this.off(event, wrapper);
        callback(data);
      };
      this.on(event, wrapper);
    }

    /**
     * Remove all listeners for an event
     * @param {string} event - Event name (optional)
     */
    removeAllListeners(event) {
      if (event) {
        eventListeners.delete(event);
      } else {
        eventListeners.clear();
      }
    }
  }

  /**
   * BeetEOS-compatible API wrapper
   * For compatibility with existing BeetEOS dApps
   */
  class BeetCompatAPI {
    constructor(provider) {
      this.provider = provider;
    }

    /**
     * Request identity (BeetEOS compatibility)
     */
    async requestIdentity() {
      const account = await this.provider.connect();
      return {
        accounts: [{
          name: account.name,
          authority: 'active',
          blockchain: 'BTS',
          chainId: await this.provider.getChainId()
        }]
      };
    }

    /**
     * Request sign (BeetEOS compatibility)
     */
    async requestSignature(payload) {
      return await this.provider.signTransaction(payload.transaction);
    }

    /**
     * Forget identity (BeetEOS compatibility)
     */
    async forgetIdentity() {
      await this.provider.disconnect();
      return true;
    }

    /**
     * Check if connected
     */
    isConnected() {
      return this.provider.isConnected;
    }
  }

  // Create provider instance
  const provider = new BitSharesProvider();
  providerInstance = provider; // Store reference for account updates
  const beetCompat = new BeetCompatAPI(provider);

  // Expose API to window
  window.bitsharesWallet = provider;
  window.bitshares = provider; // Alias
  
  // BeetEOS compatibility
  window.beet = beetCompat;
  window.scatter = beetCompat; // Some dApps use scatter interface

  // Announce availability
  window.dispatchEvent(new CustomEvent('bitsharesWalletReady', {
    detail: { provider }
  }));

  // Also dispatch for beet compatibility
  window.dispatchEvent(new CustomEvent('beetReady', {
    detail: { beet: beetCompat }
  }));

})();
