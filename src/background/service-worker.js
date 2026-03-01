/**
 * BitShares Wallet - Background Service Worker
 * Handles blockchain connections, dApp communication, and wallet state
 */

import { WalletManager } from '../lib/wallet-manager.js';
import { BitSharesAPI } from '../lib/bitshares-api.js';

// Default nodes per network (mirrors popup.js DEFAULT_NODES)
const DEFAULT_NODES = {
  mainnet: [
    'wss://node.xbts.io/ws',
    'wss://cloud.xbts.io/ws',
    'wss://public.xbts.io/ws',
    'wss://btsws.roelandp.nl/ws',
    'wss://dex.iobanker.com/ws',
    'wss://api.bitshares.dev/ws'
  ],
  testnet: [
    'wss://testnet.xbts.io/ws',
    'wss://testnet.dex.trading/'
  ]
};

class BackgroundService {
  constructor() {
    this.walletManager = new WalletManager();
    this.api = new BitSharesAPI();
    this.pendingRequests = new Map();
    this.contentPorts = new Map(); // Store ports by tabId for responding after approval
    this.autoLockMinutes = 5;

    this.init();
  }

  async init() {
    // Load settings
    await this.loadSettings();
    
    // Setup message listeners
    this.setupMessageListeners();
    
    // Setup alarm for auto-lock
    this.setupAutoLock();
    
    // Try to connect to blockchain
    this.connectToBlockchain();
    
    console.log('BitShares Wallet background service initialized');
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        if (result.settings) {
          this.autoLockMinutes = result.settings.autoLockMinutes || 5;
        }
        resolve();
      });
    });
  }

  async connectToBlockchain(networkOverride = null) {
    try {
      // Use the network passed directly (e.g. from NETWORK_SWITCH message) or
      // fall back to what the user last saved in storage.  Preferring the
      // in-message value avoids a race where chrome.storage.local.get() could
      // still return the old network if the popup's set() hasn't flushed yet.
      const result = await chrome.storage.local.get(['selectedNetwork']);
      const network = networkOverride || result.selectedNetwork || 'mainnet';
      const nodes = DEFAULT_NODES[network] || DEFAULT_NODES.mainnet;

      // Null out the old walletManager API BEFORE connecting so that if the
      // new connection fails, ensureApiConnected() won't fall back to the stale
      // API (which may have the wrong chainId / network).
      this.walletManager.api = null;
      this.walletManager._apiNodes = [...nodes]; // seed reconnect with correct nodes

      this.api = new BitSharesAPI(nodes);

      await this.api.connect();
      console.log('Connected to BitShares blockchain via:', this.api.currentNode);

      // Share the connected API with walletManager so signTransaction, sendTransfer, etc.
      // use the correct network (chain ID, nodes) — not a default mainnet fallback.
      this.walletManager.setApi(this.api);

      // Notify popup of connection status
      chrome.runtime.sendMessage({
        type: 'CONNECTION_STATUS',
        connected: true,
        node: this.api.currentNode
      }).catch(() => {}); // Ignore if popup is closed

    } catch (error) {
      console.error('Failed to connect to blockchain:', error);

      // Notify popup of connection status
      chrome.runtime.sendMessage({
        type: 'CONNECTION_STATUS',
        connected: false,
        error: error.message
      }).catch(() => {});

      // Retry after delay with exponential backoff
      const retryDelay = Math.min(30000, 5000 * (this.api?.connectionAttempts + 1 || 1));
      console.log(`Retrying connection in ${retryDelay/1000} seconds...`);
      setTimeout(() => this.connectToBlockchain(networkOverride), retryDelay);
    }
  }

  setupMessageListeners() {
    // Listen for messages from popup and content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender)
        .then(sendResponse)
        .catch(error => sendResponse({ error: error.message }));
      return true; // Keep channel open for async response
    });

    // Listen for external connections from dApps
    chrome.runtime.onConnectExternal.addListener((port) => {
      this.handleExternalConnection(port);
    });

    // Listen for content script connections
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === 'bitshares-wallet-content') {
        this.handleContentScriptConnection(port);
      }
    });
  }

  async handleMessage(message, sender) {
    const { type, data } = message;

    switch (type) {
      // Wallet operations
      case 'WALLET_HAS_WALLET':
        return { hasWallet: await this.walletManager.hasWallet() };

      case 'WALLET_IS_UNLOCKED':
        return { isUnlocked: await this.walletManager.isUnlocked() };

      case 'WALLET_CREATE':
        return await this.walletManager.createWallet(data.name, data.password, data.brainkey);

      case 'WALLET_IMPORT':
        return await this.walletManager.importWallet(data.importData, data.password);

      case 'WALLET_UNLOCK':
        const unlocked = await this.walletManager.unlock(data.password);
        if (unlocked) {
          this.resetAutoLock();
        }
        return { success: unlocked };

      case 'WALLET_LOCK':
        await this.walletManager.lock();
        return { success: true };

      case 'ACCOUNT_CHANGED':
        // Broadcast account change to all connected content scripts
        this.broadcastToConnectedSites({
          type: 'ACCOUNT_CHANGED',
          data: data
        });
        return { success: true };

      case 'WALLET_GET_ACCOUNT':
        return await this.walletManager.getCurrentAccount();

      case 'WALLET_GET_BRAINKEY':
        return { brainkey: await this.walletManager.getBrainkey() };

      case 'WALLET_RESET':
        await this.walletManager.resetWallet();
        return { success: true };

      // Blockchain operations
      case 'API_GET_BALANCE':
        return await this.getBalance(data.accountId);

      case 'API_GET_ACCOUNT':
        return await this.api.getAccount(data.accountName);

      case 'API_GET_HISTORY':
        return await this.api.getAccountHistory(data.accountId, data.limit);

      case 'API_GET_ASSET':
        return await this.api.getAsset(data.assetId);

      case 'API_GET_MARKET_PRICE':
        return await this.api.getMarketPrice(data.base, data.quote);

      // Transaction operations
      case 'TX_SEND_TRANSFER':
        return await this.walletManager.sendTransfer(
          data.to,
          data.amount,
          data.assetId,
          data.memo,
          data.encryptMemo
        );

      case 'TX_SIGN':
        return await this.walletManager.signTransaction(data.transaction);

      // dApp connection operations
      case 'DAPP_GET_CONNECTED_SITES':
        return await this.walletManager.getConnectedSites();

      case 'DAPP_REMOVE_SITE':
        await this.walletManager.removeConnectedSite(data.origin);
        return { success: true };

      case 'DAPP_APPROVE_CONNECTION':
        return await this.approveConnection(data.requestId, data.approved, data.accountId, data.accountName);

      case 'DAPP_APPROVE_TRANSACTION':
        return await this.approveTransaction(data.requestId, data.approved);

      case 'DAPP_APPROVE_TRANSFER':
        return await this.approveTransfer(data.requestId, data.approved);

      case 'DAPP_REJECT_REQUEST':
        return await this.rejectPendingRequest(data.requestId, data.reason);

      case 'NETWORK_SWITCH':
        // Popup switched networks — reconnect to the new chain so that all
        // subsequent signing operations use the correct chainId and nodes.
        // Pass the network directly from the message to avoid a storage-read
        // race where chrome.storage.local.get could still return the old value
        // if the popup's set() hasn't flushed yet.
        await this.connectToBlockchain(data.network);
        return { success: true };

      // Settings
      case 'SETTINGS_UPDATE':
        await this.updateSettings(data.settings);
        return { success: true };

      case 'SETTINGS_GET':
        return await this.getSettings();

      // Auto-lock
      case 'RESET_AUTO_LOCK':
        this.resetAutoLock();
        return { success: true };

      default:
        console.warn('Unknown message type:', type);
        return { error: 'Unknown message type' };
    }
  }

  async getBalance(accountId) {
    try {
      const balances = await this.api.getAccountBalances(accountId);
      
      // Get asset details for each balance
      const detailedBalances = await Promise.all(
        balances.map(async (balance) => {
          const asset = await this.api.getAsset(balance.asset_id);
          const precision = Math.pow(10, asset.precision);
          return {
            ...balance,
            asset,
            displayAmount: (balance.amount / precision).toFixed(asset.precision),
            symbol: asset.symbol
          };
        })
      );

      return { balances: detailedBalances };
    } catch (error) {
      console.error('Get balance error:', error);
      return { error: error.message };
    }
  }

  handleExternalConnection(port) {
    
    port.onMessage.addListener(async (message) => {
      try {
        const response = await this.handleDAppMessage(message, port.sender);
        port.postMessage(response);
      } catch (error) {
        port.postMessage({ error: error.message });
      }
    });

    port.onDisconnect.addListener(() => {
    });
  }

  handleContentScriptConnection(port) {
    const tabId = port.sender?.tab?.id;
    const origin = port.sender?.origin;


    // Store port for later responses (after popup approval)
    if (tabId) {
      this.contentPorts.set(tabId, port);
    }

    port.onMessage.addListener(async (message) => {
      try {
        const response = await this.handleDAppMessage(message, port.sender, port);
        port.postMessage({ id: message.id, ...response });
      } catch (error) {
        port.postMessage({ id: message.id, error: error.message });
      }
    });

    port.onDisconnect.addListener(() => {
      if (tabId) {
        this.contentPorts.delete(tabId);
      }
    });
  }

  async handleDAppMessage(message, sender, port = null) {
    // Validate that the sender is our own content script (same extension ID)
    if (sender?.id && sender.id !== chrome.runtime.id) {
      throw new Error('Unauthorized sender');
    }

    const origin = sender?.origin || sender?.url;
    const tabId = sender?.tab?.id;
    const { method, params, id } = message;

    switch (method) {
      case 'connect':
        return await this.handleConnectionRequest(origin, params, id, tabId, port);

      case 'getAccount':
        return await this.handleGetAccount(origin);

      case 'signTransaction':
        return await this.handleSignRequest(origin, params, id, tabId);

      case 'disconnect': {
        const disconnectNetwork = await this.getCurrentNetwork();
        await this.walletManager.removeConnectedSite(origin, null, disconnectNetwork);
        return { success: true };
      }

      case 'getChainId':
        return { chainId: await this.api.getChainId() };

      case 'transfer':
        return await this.handleTransferRequest(origin, params, id, tabId);

      case 'getBalance':
        return await this.handleGetBalance(origin, params);

      case 'checkConnection': {
        // Check if current account is connected to this site on the current network
        const checkNetwork = await this.getCurrentNetwork();
        const currentAccount = await this.walletManager.getCurrentAccount();
        if (currentAccount && currentAccount.id) {
          const connected = await this.walletManager.isSiteConnected(origin, currentAccount.id, checkNetwork);
          return { connected, account: connected ? currentAccount : null };
        }
        return { connected: false, account: null };
      }

      case 'signMessage':
        return await this.handleSignMessage(origin, params, id, tabId);

      case 'swap':
        return await this.handleSwapRequest(origin, params, id, tabId);

      case 'createLimitOrder':
        return await this.handleLimitOrderRequest(origin, params, id, tabId);

      case 'keepalive':
        return { alive: true };

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  async handleConnectionRequest(origin, params, messageId, tabId, port) {
    // Validate chain_id if the site specified one
    const activeChainId = await this.api.getChainId();
    if (params && params.chain_id && params.chain_id !== activeChainId) {
      throw new Error(
        `Chain ID mismatch: site expects ${params.chain_id} but the extension is connected to ${activeChainId}. Switch your network in the extension and try again.`
      );
    }

    // Check if CURRENT account is already connected to this site on the current network
    const connNetwork = await this.getCurrentNetwork();
    const account = await this.walletManager.getCurrentAccount();
    if (account && account.id) {
      const isConnected = await this.walletManager.isSiteConnected(origin, account.id, connNetwork);
      if (isConnected) {
        // Return account info and balance for already connected account
        let balances = [];
        try {
          balances = await this.api.getAccountBalances(account.id);
        } catch (e) {
          console.log('Could not fetch balances:', e);
        }
        return {
          connected: true,
          chainId: activeChainId,
          account: {
            name: account.name,
            id: account.id
          },
          balances
        };
      }
    }

    // Create pending request
    const requestId = crypto.randomUUID();

    // Store in memory for active connections
    this.pendingRequests.set(requestId, {
      type: 'connection',
      origin,
      params,
      messageId,
      tabId,
      resolve: null,
      reject: null
    });

    // Open popup for approval
    await this.openPopupForApproval(requestId, 'connection', origin);

    // Wait for user response with timeout
    return new Promise((resolve, reject) => {
      const request = this.pendingRequests.get(requestId);
      request.resolve = resolve;
      request.reject = reject;

      // Timeout after 90 seconds
      request.timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          chrome.storage.local.remove(['pendingApproval']);
          chrome.action.setBadgeText({ text: '' });
          reject(new Error('Connection request timed out. Please click the BitShares extension icon to approve.'));
        }
      }, 90000);
    });
  }

  async getCurrentNetwork() {
    const result = await chrome.storage.local.get(['selectedNetwork']);
    return result.selectedNetwork || 'mainnet';
  }

  async handleGetAccount(origin) {
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    const isUnlocked = await this.walletManager.isUnlocked();
    if (!isUnlocked) {
      throw new Error('Wallet is locked');
    }

    const account = await this.walletManager.getCurrentAccount();
    return {
      name: account.name,
      id: account.id
    };
  }

  async handleSignRequest(origin, params, messageId, tabId) {
    // Rate-limit: reject if there's already a pending request from this origin
    for (const [, req] of this.pendingRequests) {
      if (req.origin === origin && (req.type === 'transaction' || req.type === 'transfer')) {
        throw new Error('A request from this site is already pending approval');
      }
    }

    // Verify connection for current network
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    const isUnlocked = await this.walletManager.isUnlocked();
    if (!isUnlocked) {
      throw new Error('Wallet is locked');
    }

    // Create pending request
    const requestId = crypto.randomUUID();
    this.pendingRequests.set(requestId, {
      type: 'transaction',
      origin,
      params,
      messageId,
      tabId,
      resolve: null,
      reject: null
    });

    // Open popup for approval
    await this.openPopupForApproval(requestId, 'transaction', origin);

    // Wait for user response with timeout
    return new Promise((resolve, reject) => {
      const request = this.pendingRequests.get(requestId);
      request.resolve = resolve;
      request.reject = reject;

      // Timeout after 90 seconds
      request.timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          chrome.storage.local.remove(['pendingApproval']);
          chrome.action.setBadgeText({ text: '' });
          reject(new Error('Transaction signing request timed out. Please click the BitShares extension icon to approve.'));
        }
      }, 90000);
    });
  }

  async handleTransferRequest(origin, params, messageId, tabId) {
    // Rate-limit: reject if there's already a pending request from this origin
    for (const [, req] of this.pendingRequests) {
      if (req.origin === origin && (req.type === 'transaction' || req.type === 'transfer')) {
        throw new Error('A request from this site is already pending approval');
      }
    }

    // Verify connection for current network
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    // Validate params
    const { to, amount, asset, memo } = params;
    if (!to || !amount) {
      throw new Error('Missing required parameters: to, amount');
    }
    if (typeof to !== 'string' || to.length < 1 || to.length > 63) {
      throw new Error('Invalid "to" parameter');
    }
    if (typeof amount !== 'number' && typeof amount !== 'string') {
      throw new Error('Invalid "amount" parameter');
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      throw new Error('Amount must be a positive number');
    }
    // BitShares amounts are int64 in base units; cap to prevent overflow
    if (numAmount > Number.MAX_SAFE_INTEGER) {
      throw new Error('Amount exceeds maximum allowed value');
    }
    if (memo !== undefined && memo !== null && typeof memo !== 'string') {
      throw new Error('Memo must be a string');
    }

    // Create pending request for user approval
    // Note: Don't check if unlocked here - popup will handle unlock if needed
    const requestId = crypto.randomUUID();
    this.pendingRequests.set(requestId, {
      type: 'transfer',
      origin,
      params: { to, amount, asset: asset || 'BTS', memo: memo || '' },
      messageId,
      tabId,
      resolve: null,
      reject: null
    });

    // Open popup for approval (user can unlock there if needed)
    await this.openPopupForApproval(requestId, 'transfer', origin);

    // Wait for user response with timeout
    return new Promise((resolve, reject) => {
      const request = this.pendingRequests.get(requestId);
      request.resolve = resolve;
      request.reject = reject;

      // Timeout after 90 seconds
      request.timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          chrome.storage.local.remove(['pendingApproval']);
          chrome.action.setBadgeText({ text: '' });
          reject(new Error('Transfer request timed out. Please click the BitShares extension icon to approve.'));
        }
      }, 90000);
    });
  }

  async handleGetBalance(origin, params) {
    // Verify connection on current network
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    const isUnlocked = await this.walletManager.isUnlocked();
    if (!isUnlocked) {
      throw new Error('Wallet is locked');
    }

    // Get account
    const account = await this.walletManager.getCurrentAccount();

    // Get balance for specific asset or all balances
    const assetFilter = params?.asset;

    try {
      const balances = await this.api.getAccountBalances(account.id);

      if (assetFilter) {
        // Find specific asset
        const targetAssetId = assetFilter === 'BTS' ? '1.3.0' : assetFilter;
        const balance = balances.find(b => b.asset_id === targetAssetId);

        if (balance) {
          const asset = await this.api.getAsset(targetAssetId);
          const precision = Math.pow(10, asset.precision);
          return {
            balance: (balance.amount / precision).toFixed(asset.precision),
            asset: asset.symbol,
            assetId: targetAssetId
          };
        }
        return { balance: '0', asset: assetFilter, assetId: targetAssetId };
      }

      // Return all balances
      const detailedBalances = await Promise.all(
        balances.map(async (balance) => {
          const asset = await this.api.getAsset(balance.asset_id);
          const precision = Math.pow(10, asset.precision);
          return {
            balance: (balance.amount / precision).toFixed(asset.precision),
            asset: asset.symbol,
            assetId: balance.asset_id
          };
        })
      );

      return { balances: detailedBalances };
    } catch (error) {
      console.error('Get balance error:', error);
      throw error;
    }
  }

  async handleSignMessage(origin, params, messageId, tabId) {
    // Verify connection on current network
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    const { message } = params;
    if (!message) {
      throw new Error('Missing required parameter: message');
    }

    // Create pending request for user approval
    const requestId = crypto.randomUUID();
    this.pendingRequests.set(requestId, {
      type: 'signMessage',
      origin,
      params: { message },
      messageId,
      tabId,
      resolve: null,
      reject: null
    });

    // Open popup for approval
    await this.openPopupForApproval(requestId, 'signMessage', origin);

    // Wait for user response
    return new Promise((resolve, reject) => {
      const request = this.pendingRequests.get(requestId);
      request.resolve = resolve;
      request.reject = reject;

      request.timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          chrome.storage.local.remove(['pendingApproval']);
          chrome.action.setBadgeText({ text: '' });
          reject(new Error('Sign message request timed out'));
        }
      }, 90000);
    });
  }

  async handleSwapRequest(origin, params, messageId, tabId) {
    // Verify connection on current network
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    const { sellAsset, sellAmount, buyAsset, minReceive } = params;
    if (!sellAsset || !sellAmount || !buyAsset) {
      throw new Error('Missing required parameters: sellAsset, sellAmount, buyAsset');
    }

    // Create pending request for user approval
    const requestId = crypto.randomUUID();
    this.pendingRequests.set(requestId, {
      type: 'swap',
      origin,
      params: { sellAsset, sellAmount, buyAsset, minReceive: minReceive || '0' },
      messageId,
      tabId,
      resolve: null,
      reject: null
    });

    // Open popup for approval
    await this.openPopupForApproval(requestId, 'swap', origin);

    // Wait for user response
    return new Promise((resolve, reject) => {
      const request = this.pendingRequests.get(requestId);
      request.resolve = resolve;
      request.reject = reject;

      request.timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          chrome.storage.local.remove(['pendingApproval']);
          chrome.action.setBadgeText({ text: '' });
          reject(new Error('Swap request timed out'));
        }
      }, 90000);
    });
  }

  async handleLimitOrderRequest(origin, params, messageId, tabId) {
    // Verify connection on current network
    const network = await this.getCurrentNetwork();
    const isConnected = await this.walletManager.isSiteConnected(origin, null, network);
    if (!isConnected) {
      throw new Error('Not connected');
    }

    const { sellAsset, sellAmount, buyAsset, buyAmount, expiration } = params;
    if (!sellAsset || !sellAmount || !buyAsset || !buyAmount) {
      throw new Error('Missing required parameters: sellAsset, sellAmount, buyAsset, buyAmount');
    }

    // Create pending request for user approval
    const requestId = crypto.randomUUID();
    this.pendingRequests.set(requestId, {
      type: 'limitOrder',
      origin,
      params: {
        sellAsset,
        sellAmount,
        buyAsset,
        buyAmount,
        expiration: expiration || 86400 // Default 24 hours
      },
      messageId,
      tabId,
      resolve: null,
      reject: null
    });

    // Open popup for approval
    await this.openPopupForApproval(requestId, 'limitOrder', origin);

    // Wait for user response
    return new Promise((resolve, reject) => {
      const request = this.pendingRequests.get(requestId);
      request.resolve = resolve;
      request.reject = reject;

      request.timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          chrome.storage.local.remove(['pendingApproval']);
          chrome.action.setBadgeText({ text: '' });
          reject(new Error('Limit order request timed out'));
        }
      }, 90000);
    });
  }

  async openPopupForApproval(requestId, type, origin) {
    // Get the pending request details to store
    const request = this.pendingRequests.get(requestId);

    // Store pending request info for popup to retrieve when user clicks extension icon
    const pendingNetwork = await this.getCurrentNetwork();
    await chrome.storage.local.set({
      pendingApproval: {
        requestId,
        type,
        origin,
        network: pendingNetwork,
        params: request?.params || {},
        messageId: request?.messageId,
        tabId: request?.tabId
      }
    });

    // Set badge as fallback indicator
    await chrome.action.setBadgeText({ text: '1' });
    await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });

    // Open the popup automatically so the user sees the approval request immediately.
    // Strategy 1: focus the most recent normal window and call openPopup().
    // Strategy 2: if that fails, open a dedicated approval window as a reliable fallback.
    let opened = false;
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const target = windows.find(w => w.focused) || windows[windows.length - 1];
      if (target) await chrome.windows.update(target.id, { focused: true });
      await chrome.action.openPopup();
      opened = true;
    } catch {
      // openPopup() failed (no focused window, unsupported Chrome version, etc.)
    }

    if (!opened) {
      // Don't open a second window if one is already up
      const existing = await chrome.windows.getAll({ windowTypes: ['popup'] });
      const approvalWin = existing.find(w =>
        w.tabs?.some(t => t.url?.includes(chrome.runtime.id))
      );
      if (!approvalWin) {
        try {
          await chrome.windows.create({
            url: chrome.runtime.getURL('popup/popup.html'),
            type: 'popup',
            width: 380,
            height: 620,
            focused: true
          });
        } catch (e) {
          console.log('Could not open approval window:', e.message);
        }
      }
    }
  }

  capitalizeType(type) {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /**
   * Immediately reject any pending request with a custom reason message.
   * Used when the popup detects a network mismatch so the dApp gets a clear
   * error rather than waiting for the 90-second timeout.
   */
  async rejectPendingRequest(requestId, reason = 'Request rejected') {
    let request = this.pendingRequests.get(requestId);
    if (!request) {
      const stored = await chrome.storage.local.get(['pendingApproval']);
      if (stored.pendingApproval?.requestId === requestId) {
        request = stored.pendingApproval;
      }
    }
    if (!request) return { success: true }; // Already gone

    if (request.timeout) clearTimeout(request.timeout);

    if (request.reject) {
      request.reject(new Error(reason));
    } else if (request.tabId && this.contentPorts.has(request.tabId)) {
      const port = this.contentPorts.get(request.tabId);
      port.postMessage({ id: request.messageId, error: reason });
    }

    this.pendingRequests.delete(requestId);
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' });
    return { success: true };
  }

  async approveConnection(requestId, approved, accountId = null, accountName = null) {
    // Try to get from in-memory first
    let request = this.pendingRequests.get(requestId);

    // If not in memory (service worker restarted), get from storage
    if (!request) {
      const stored = await chrome.storage.local.get(['pendingApproval']);
      if (stored.pendingApproval && stored.pendingApproval.requestId === requestId) {
        request = stored.pendingApproval;
      }
    }

    if (!request) {
      throw new Error('Request not found');
    }

    // Clear timeout if exists
    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    if (approved) {
      // Get account info - use provided account or fall back to current account
      let account = null;
      let balances = [];
      try {
        if (accountId && accountName) {
          // Use the specified account
          account = { name: accountName, id: accountId };
        } else {
          // Fall back to current account
          account = await this.walletManager.getCurrentAccount();
        }
        // Fetch balances for the connected account
        if (account && account.id) {
          try {
            balances = await this.api.getAccountBalances(account.id);
          } catch (balErr) {
            console.log('Could not fetch balances:', balErr);
          }
        }
      } catch (e) {
        console.error('Could not get account for approval response:', e);
      }

      // Store connection with account info and current network
      const connNetwork = await this.getCurrentNetwork();
      await this.walletManager.addConnectedSite(
        request.origin,
        account?.id || accountId,
        account?.name || accountName,
        ['getAccount', 'signTransaction', 'transfer'],
        connNetwork
      );

      const response = {
        connected: true,
        chainId: await this.api.getChainId(),
        account: account ? { name: account.name, id: account.id } : null,
        balances
      };

      // If we have resolve callback in memory, use it
      if (request.resolve) {
        request.resolve(response);
      }
      // Otherwise try to respond via stored port (if service worker restarted, port may be gone)
      else if (request.tabId && this.contentPorts.has(request.tabId)) {
        const port = this.contentPorts.get(request.tabId);
        port.postMessage({ id: request.messageId, ...response });
      }
    } else {
      if (request.reject) {
        request.reject(new Error('User rejected connection'));
      } else if (request.tabId && this.contentPorts.has(request.tabId)) {
        const port = this.contentPorts.get(request.tabId);
        port.postMessage({ id: request.messageId, error: 'User rejected connection' });
      }
    }

    this.pendingRequests.delete(requestId);
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' }); // Clear badge

  }

  async approveTransaction(requestId, approved) {
    // Try to get from in-memory first
    let request = this.pendingRequests.get(requestId);

    // If not in memory (service worker restarted), get from storage
    if (!request) {
      const stored = await chrome.storage.local.get(['pendingApproval']);
      if (stored.pendingApproval && stored.pendingApproval.requestId === requestId) {
        request = stored.pendingApproval;
      }
    }

    if (!request) {
      throw new Error('Request not found');
    }

    // Clear timeout if exists
    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    if (approved) {
      try {
        // Support params.transaction or params directly as the transaction object
        const txData = request.params?.transaction || request.params;
        // Let signTransaction determine the signing account from the transaction's own
        // operation fields (e.g. 'from', 'account', 'seller', …).  Passing a conn.accountId
        // override here was the root cause of "Missing Active Authority" for non-primary
        // accounts: when the dApp switched to account B the connection metadata still
        // pointed to the first connected account A, so signatures were produced with A's
        // keys even though the transaction said from = B.
        const result = await this.walletManager.signTransaction(txData, null);
        if (request.resolve) {
          request.resolve(result);
        } else if (request.tabId && this.contentPorts.has(request.tabId)) {
          const port = this.contentPorts.get(request.tabId);
          port.postMessage({ id: request.messageId, ...result });
        }
        this.pendingRequests.delete(requestId);
        await chrome.storage.local.remove(['pendingApproval']);
        await chrome.action.setBadgeText({ text: '' });
        return result; // propagate success/failure back to popup
      } catch (error) {
        if (request.reject) {
          request.reject(error);
        } else if (request.tabId && this.contentPorts.has(request.tabId)) {
          const port = this.contentPorts.get(request.tabId);
          port.postMessage({ id: request.messageId, error: error.message });
        }
        this.pendingRequests.delete(requestId);
        await chrome.storage.local.remove(['pendingApproval']);
        await chrome.action.setBadgeText({ text: '' });
        return { success: false, error: error.message };
      }
    } else {
      if (request.reject) {
        request.reject(new Error('User rejected transaction'));
      } else if (request.tabId && this.contentPorts.has(request.tabId)) {
        const port = this.contentPorts.get(request.tabId);
        port.postMessage({ id: request.messageId, error: 'User rejected transaction' });
      }
    }

    this.pendingRequests.delete(requestId);
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' }); // Clear badge
  }

  async approveTransfer(requestId, approved) {
    // Try to get from in-memory first
    let request = this.pendingRequests.get(requestId);

    // If not in memory (service worker restarted), get from storage
    if (!request) {
      const stored = await chrome.storage.local.get(['pendingApproval']);
      if (stored.pendingApproval && stored.pendingApproval.requestId === requestId) {
        request = stored.pendingApproval;
      }
    }

    if (!request) {
      throw new Error('Request not found');
    }

    // Clear timeout if exists
    if (request.timeout) {
      clearTimeout(request.timeout);
    }

    if (approved) {
      try {
        const { to, amount, asset, memo } = request.params;
        // Map core asset symbols (BTS on mainnet, TEST on testnet) to the universal asset ID
        const assetId = (asset === 'BTS' || asset === 'TEST') ? '1.3.0' : asset;

        // Ensure wallet is unlocked (restore from session if needed)
        await this.walletManager.ensureUnlocked();

        // Use the currently active wallet account as the sender.
        // Using conn.accountId (first connected account) here caused the same
        // "Missing Active Authority" bug as in approveTransaction when the user
        // switched to a different account after the initial connection.
        const result = await this.walletManager.sendTransfer(
          to,
          amount,
          assetId,
          memo,
          false,
          null   // null → sendTransfer falls back to getCurrentAccount()
        );

        // If we have resolve callback in memory, use it
        if (request.resolve) {
          request.resolve(result);
        }
        // Otherwise try to respond via stored port
        else if (request.tabId && this.contentPorts.has(request.tabId)) {
          const port = this.contentPorts.get(request.tabId);
          port.postMessage({ id: request.messageId, ...result });
        }

        this.pendingRequests.delete(requestId);
        await chrome.storage.local.remove(['pendingApproval']);
        await chrome.action.setBadgeText({ text: '' });
        return result; // propagate success/failure back to popup
      } catch (error) {
        if (request.reject) {
          request.reject(error);
        } else if (request.tabId && this.contentPorts.has(request.tabId)) {
          const port = this.contentPorts.get(request.tabId);
          port.postMessage({ id: request.messageId, error: error.message });
        }
        this.pendingRequests.delete(requestId);
        await chrome.storage.local.remove(['pendingApproval']);
        await chrome.action.setBadgeText({ text: '' });
        return { success: false, error: error.message };
      }
    } else {
      if (request.reject) {
        request.reject(new Error('User rejected transfer'));
      } else if (request.tabId && this.contentPorts.has(request.tabId)) {
        const port = this.contentPorts.get(request.tabId);
        port.postMessage({ id: request.messageId, error: 'User rejected transfer' });
      }
    }

    this.pendingRequests.delete(requestId);
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' }); // Clear badge
  }

  /**
   * Broadcast a message to all connected content scripts
   */
  broadcastToConnectedSites(message) {
    for (const [tabId, port] of this.contentPorts) {
      try {
        port.postMessage(message);
      } catch (e) {
        console.warn(`Failed to send message to tab ${tabId}:`, e);
        // Clean up dead ports
        this.contentPorts.delete(tabId);
      }
    }
  }

  setupAutoLock() {
    // Use Chrome alarms for reliable background timing
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'auto-lock') {
        this.walletManager.lock();
        this.notifyLocked();
      }
    });
  }

  resetAutoLock() {
    // Clear existing alarm
    chrome.alarms.clear('auto-lock');
    
    // Set new alarm
    if (this.autoLockMinutes > 0) {
      chrome.alarms.create('auto-lock', {
        delayInMinutes: this.autoLockMinutes
      });
    }
  }

  notifyLocked() {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/assets/icons/icon128.png'),
      title: 'BitShares Wallet',
      message: 'Your wallet has been automatically locked.'
    });
  }

  async updateSettings(settings) {
    this.autoLockMinutes = settings.autoLockMinutes || 5;
    
    await new Promise((resolve) => {
      chrome.storage.local.set({ settings }, resolve);
    });

    // Reset auto-lock timer with new duration
    if (await this.walletManager.isUnlocked()) {
      this.resetAutoLock();
    }
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {
          autoLockMinutes: 5,
          network: 'mainnet',
          customNodes: []
        });
      });
    });
  }
}

// Initialize background service
const backgroundService = new BackgroundService();

// Export for testing
self.backgroundService = backgroundService;
