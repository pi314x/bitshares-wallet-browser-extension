/**
 * BitShares API
 * Handles all blockchain communication via WebSocket
 */

import { CryptoUtils, sha256, hexToBytes, bytesToHex } from './crypto-utils.js';

export class BitSharesAPI {
  constructor(nodes = null) {
    // Updated list of reliable BitShares nodes (January 2026)
    this.nodes = nodes || [
      'wss://node.xbts.io/ws',       // xbtsio-wallet, Germany/Falkenstein, 142.6ms
      'wss://cloud.xbts.io/ws',      // xbtsio-wallet, USA/Ashburn, 209.8ms
      'wss://public.xbts.io/ws',     // xbtsio-wallet, Germany/Nuremberg, 245.7ms
      'wss://btsws.roelandp.nl/ws',  // roelandp, Finland/Helsinki, 284.1ms
      'wss://dex.iobanker.com/ws',   // iobanker-core, Germany/Frankfurt, 427.1ms
      'wss://api.bitshares.dev/ws'        // in.abit, USA/Virginia, 543.5ms
    ];
    this.currentNodeIndex = 0;
    this.ws = null;
    this.callId = 0;
    this.pendingCalls = new Map();
    this.isConnected = false;
    this.apiIds = {};
    this.chainId = null;
    this.dynamicGlobalProperties = null;
    this.currentNode = null;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = this.nodes.length * 2;
    
    // Cache for frequently accessed data
    this.cache = {
      accounts: new Map(),
      assets: new Map(),
      objects: new Map()
    };
  }

  /**
   * Connect to BitShares node
   */
  async connect() {
    return new Promise((resolve, reject) => {
      if (this.connectionAttempts >= this.maxConnectionAttempts) {
        reject(new Error('Failed to connect to any BitShares node after multiple attempts'));
        return;
      }

      const node = this.nodes[this.currentNodeIndex];
      if (!node) {
        this.currentNodeIndex = 0;
        this.connectionAttempts++;
        this.connect().then(resolve).catch(reject);
        return;
      }

      console.log('Connecting to:', node);
      this.currentNode = node;

      try {
        // Close existing connection if any
        if (this.ws) {
          try { this.ws.close(); } catch (e) {}
        }

        this.ws = new WebSocket(node);
        let connectionTimeout;

        this.ws.onopen = async () => {
          clearTimeout(connectionTimeout);

          try {
            await this.login();
            await this.getApiIds();
            await this.initChainProperties();
            this.isConnected = true;
            this.connectionAttempts = 0;
            console.log('Connected to BitShares via:', node);
            resolve(true);
          } catch (error) {
            console.warn('Connection error on', node, ':', error.message);
            this.tryNextNode(resolve, reject);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.warn('WebSocket error on', node);
          clearTimeout(connectionTimeout);
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.isConnected = false;
          // Don't auto-reconnect here, let the error handler do it
        };

        // Connection timeout - try next node after 8 seconds
        connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            console.warn('Connection timeout for:', node);
            try { this.ws.close(); } catch (e) {}
            this.tryNextNode(resolve, reject);
          }
        }, 8000);

      } catch (error) {
        console.warn('Connection error:', error.message);
        this.tryNextNode(resolve, reject);
      }
    });
  }

  /**
   * Try connecting to the next available node
   */
  tryNextNode(resolve, reject) {
    this.currentNodeIndex++;
    this.connectionAttempts++;
    
    if (this.connectionAttempts >= this.maxConnectionAttempts) {
      reject(new Error('Failed to connect to any BitShares node'));
      return;
    }
    
    if (this.currentNodeIndex >= this.nodes.length) {
      this.currentNodeIndex = 0;
    }
    
    // Small delay before trying next node
    setTimeout(() => {
      this.connect().then(resolve).catch(reject);
    }, 500);
  }

  /**
   * Disconnect from node
   */
  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(data) {
    try {
      const response = JSON.parse(data);

      if (response.id !== undefined && this.pendingCalls.has(response.id)) {
        const { resolve, reject } = this.pendingCalls.get(response.id);
        this.pendingCalls.delete(response.id);

        if (response.error) {
          // Handle different error formats from BitShares API
          let errorMsg = 'API Error';
          if (typeof response.error === 'string') {
            errorMsg = response.error;
          } else if (response.error.message) {
            errorMsg = response.error.message;
          } else if (response.error.data && response.error.data.message) {
            errorMsg = response.error.data.message;
          } else {
            errorMsg = JSON.stringify(response.error);
          }
          reject(new Error(errorMsg));
        } else {
          resolve(response.result);
        }
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  /**
   * Make an API call
   */
  call(apiId, method, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = ++this.callId;
      const request = {
        id,
        method: 'call',
        params: [apiId, method, params]
      };

      this.pendingCalls.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));

      setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id);
          reject(new Error(`API call timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Login to the API
   */
  async login() {
    return this.call(1, 'login', ['', '']);
  }

  /**
   * Get API IDs for different APIs
   */
  async getApiIds() {
    this.apiIds.database = await this.call(1, 'database', []);
    this.apiIds.network = await this.call(1, 'network_broadcast', []);
    this.apiIds.history = await this.call(1, 'history', []);
    // Crypto API is optional - most public nodes don't expose it
    try {
      this.apiIds.crypto = await this.call(1, 'crypto', []);
    } catch (e) {
      console.log('Crypto API not available (optional)');
      this.apiIds.crypto = null;
    }
  }

  /**
   * Initialize chain properties
   */
  async initChainProperties() {
    const [chainProps, dynamicProps] = await Promise.all([
      this.call(this.apiIds.database, 'get_chain_properties', []),
      this.call(this.apiIds.database, 'get_dynamic_global_properties', [])
    ]);

    this.chainId = chainProps.chain_id;
    this.dynamicGlobalProperties = dynamicProps;
  }

  /**
   * Get chain ID
   */
  async getChainId() {
    if (!this.chainId) {
      await this.initChainProperties();
    }
    return this.chainId;
  }

  // === Account Methods ===

  /**
   * Get account by name or ID
   */
  async getAccount(nameOrId) {
    // Check cache first
    if (this.cache.accounts.has(nameOrId)) {
      return this.cache.accounts.get(nameOrId);
    }

    try {
      let accounts;
      if (nameOrId.startsWith('1.2.')) {
        accounts = await this.call(this.apiIds.database, 'get_accounts', [[nameOrId]]);
      } else {
        accounts = await this.call(this.apiIds.database, 'get_account_by_name', [nameOrId]);
        if (accounts) accounts = [accounts];
      }

      if (accounts && accounts.length > 0 && accounts[0]) {
        this.cache.accounts.set(nameOrId, accounts[0]);
        this.cache.accounts.set(accounts[0].name, accounts[0]);
        this.cache.accounts.set(accounts[0].id, accounts[0]);
        return accounts[0];
      }
      return null;
    } catch (error) {
      console.error('Get account error:', error);
      throw error;
    }
  }

  /**
   * Get accounts by public key
   */
  async getAccountsByKey(publicKey) {
    // Validate public key format before making API call
    if (!publicKey || typeof publicKey !== 'string' || !publicKey.startsWith('BTS') || publicKey.length < 50) {
      console.warn('Invalid public key format:', publicKey);
      return [];
    }

    try {
      const accounts = await this.call(this.apiIds.database, 'get_key_references', [[publicKey]]);
      return accounts[0] || [];
    } catch (error) {
      console.error('Get accounts by key error:', error);
      return [];
    }
  }

  /**
   * Get account balances
   */
  async getAccountBalances(accountId) {
    try {
      const balances = await this.call(
        this.apiIds.database, 
        'get_account_balances', 
        [accountId, []]
      );
      return balances || [];
    } catch (error) {
      console.error('Get balances error:', error);
      return [];
    }
  }

  /**
   * Get account history
   */
  async getAccountHistory(accountId, limit = 100) {
    try {
      const history = await this.call(
        this.apiIds.history,
        'get_account_history',
        [accountId, '1.11.0', limit, '1.11.0']
      );
      return history || [];
    } catch (error) {
      console.error('Get history error:', error);
      return [];
    }
  }

  // === Asset Methods ===

  /**
   * Get asset by ID or symbol
   */
  async getAsset(idOrSymbol) {
    // Check cache
    if (this.cache.assets.has(idOrSymbol)) {
      return this.cache.assets.get(idOrSymbol);
    }

    try {
      let assets;
      if (idOrSymbol.startsWith('1.3.')) {
        assets = await this.call(this.apiIds.database, 'get_assets', [[idOrSymbol]]);
      } else {
        assets = await this.call(this.apiIds.database, 'lookup_asset_symbols', [[idOrSymbol]]);
      }

      if (assets && assets.length > 0 && assets[0]) {
        this.cache.assets.set(idOrSymbol, assets[0]);
        this.cache.assets.set(assets[0].symbol, assets[0]);
        this.cache.assets.set(assets[0].id, assets[0]);
        return assets[0];
      }
      return null;
    } catch (error) {
      console.error('Get asset error:', error);
      throw error;
    }
  }

  /**
   * Get BTS price in USD (from DEX market using XBTSX.USDT)
   * Returns { price: number, source: string }
   */
  async getBTSPrice() {
    try {
      // First get the XBTSX.USDT asset to ensure it exists and get its ID
      const usdtAsset = await this.getAsset('XBTSX.USDT');
      const btsAsset = await this.getAsset('BTS');

      if (usdtAsset && btsAsset) {
        // Use asset IDs for the ticker call
        const ticker = await this.call(
          this.apiIds.database,
          'get_ticker',
          [usdtAsset.id, btsAsset.id]
        );

        // ticker.latest gives XBTSX.USDT per BTS
        const price = parseFloat(ticker.latest) || 0;

        if (price > 0) {
          return { price, source: 'XBTSX.USDT' };
        }
      }

      // Fallback: try CNY market and convert (approximate)
      try {
        const cnyAsset = await this.getAsset('CNY');
        if (cnyAsset) {
          const cnyTicker = await this.call(
            this.apiIds.database,
            'get_ticker',
            [cnyAsset.id, '1.3.0']
          );
          const cnyPrice = parseFloat(cnyTicker.latest) || 0;
          // Approximate CNY to USD conversion (1 USD ≈ 7.2 CNY)
          if (cnyPrice > 0) {
            return { price: cnyPrice / 7.2, source: 'CNY' };
          }
        }
      } catch (e) {
        // CNY fallback failed
      }

      // Fallback: try bitUSD
      try {
        const bitUsdAsset = await this.getAsset('USD');
        if (bitUsdAsset) {
          const usdTicker = await this.call(
            this.apiIds.database,
            'get_ticker',
            [bitUsdAsset.id, '1.3.0']
          );
          const usdPrice = parseFloat(usdTicker.latest) || 0;
          if (usdPrice > 0) {
            return { price: usdPrice, source: 'bitUSD' };
          }
        }
      } catch (e) {
        // bitUSD fallback failed
      }

      return { price: 0, source: null };
    } catch (error) {
      console.error('Get BTS price error:', error);
      return { price: 0, source: null };
    }
  }

  // === Object Methods ===

  /**
   * Get objects by IDs
   */
  async getObjects(ids) {
    try {
      const uncached = ids.filter(id => !this.cache.objects.has(id));
      
      if (uncached.length > 0) {
        const objects = await this.call(this.apiIds.database, 'get_objects', [uncached]);
        objects.forEach((obj, i) => {
          if (obj) {
            this.cache.objects.set(uncached[i], obj);
          }
        });
      }

      return ids.map(id => this.cache.objects.get(id));
    } catch (error) {
      console.error('Get objects error:', error);
      return [];
    }
  }

  // === Fee Methods ===

  /**
   * Get global fee schedule from the network
   * Returns fee information for all operation types
   */
  async getFeeSchedule() {
    try {
      // Get the global properties which contain the fee schedule
      const globalProps = await this.call(
        this.apiIds.database,
        'get_global_properties',
        []
      );

      if (globalProps && globalProps.parameters && globalProps.parameters.current_fees) {
        return globalProps.parameters.current_fees;
      }

      return null;
    } catch (error) {
      console.error('Get fee schedule error:', error);
      throw error;
    }
  }

  /**
   * Get fee for a specific operation type
   * @param {string} operationType - The operation type name (e.g., 'transfer', 'limit_order_create')
   * @param {string} feeAssetId - Asset to pay fee in (default: '1.3.0' for BTS)
   * @returns {object} Fee information { amount, asset_id, formatted }
   */
  async getOperationFee(operationType, feeAssetId = '1.3.0') {
    try {
      const opId = this.getOperationId(operationType);
      const feeSchedule = await this.getFeeSchedule();

      if (!feeSchedule || !feeSchedule.parameters) {
        throw new Error('Unable to fetch fee schedule');
      }

      // Find the fee for this operation type
      const opFee = feeSchedule.parameters.find(([id]) => id === opId);

      if (!opFee) {
        throw new Error(`Fee not found for operation: ${operationType}`);
      }

      const feeParams = opFee[1];
      let feeAmount = 0;

      // Different operations have different fee structures
      if (typeof feeParams === 'object') {
        // Most operations have a 'fee' field
        feeAmount = feeParams.fee || feeParams.basic_fee || 0;
      } else {
        feeAmount = feeParams;
      }

      // Get asset info for formatting
      const asset = await this.getAsset(feeAssetId);
      const precision = Math.pow(10, asset.precision);
      const formattedFee = (feeAmount / precision).toFixed(asset.precision);

      return {
        amount: feeAmount,
        asset_id: feeAssetId,
        formatted: `${formattedFee} ${asset.symbol}`,
        symbol: asset.symbol,
        precision: asset.precision
      };
    } catch (error) {
      console.error('Get operation fee error:', error);
      throw error;
    }
  }

  /**
   * Get fees for multiple common operations
   * @returns {object} Object with fees for common operations
   */
  async getCommonFees() {
    try {
      const operations = [
        'transfer',
        'limit_order_create',
        'limit_order_cancel',
        'account_update',
        'account_upgrade',
        'asset_create',
        'liquidity_pool_exchange'
      ];

      const fees = {};
      const feeSchedule = await this.getFeeSchedule();
      const btsAsset = await this.getAsset('1.3.0');
      const precision = Math.pow(10, btsAsset.precision);

      if (feeSchedule && feeSchedule.parameters) {
        for (const opType of operations) {
          const opId = this.getOperationId(opType);
          const opFee = feeSchedule.parameters.find(([id]) => id === opId);

          if (opFee) {
            const feeParams = opFee[1];
            let feeAmount = 0;

            if (typeof feeParams === 'object') {
              feeAmount = feeParams.fee || feeParams.basic_fee || 0;
              // Also capture price_per_kbyte for operations like transfer
              if (feeParams.price_per_kbyte) {
                fees[opType + '_per_kb'] = {
                  amount: feeParams.price_per_kbyte,
                  formatted: `${(feeParams.price_per_kbyte / precision).toFixed(btsAsset.precision)} BTS/KB`
                };
              }
            } else {
              feeAmount = feeParams;
            }

            fees[opType] = {
              amount: feeAmount,
              formatted: `${(feeAmount / precision).toFixed(btsAsset.precision)} BTS`
            };
          }
        }
      }

      return fees;
    } catch (error) {
      console.error('Get common fees error:', error);
      return {};
    }
  }

  /**
   * Get required fee for a specific operation with data
   * This calculates the exact fee including variable costs (like memo size)
   */
  async getRequiredFee(operationType, operationData, feeAssetId = '1.3.0') {
    try {
      const opId = this.getOperationId(operationType);
      const requiredFees = await this.call(
        this.apiIds.database,
        'get_required_fees',
        [[[opId, operationData]], feeAssetId]
      );

      if (requiredFees && requiredFees[0]) {
        const fee = requiredFees[0];
        const asset = await this.getAsset(fee.asset_id);
        const precision = Math.pow(10, asset.precision);

        return {
          amount: fee.amount,
          asset_id: fee.asset_id,
          formatted: `${(fee.amount / precision).toFixed(asset.precision)} ${asset.symbol}`,
          symbol: asset.symbol
        };
      }

      return null;
    } catch (error) {
      console.error('Get required fee error:', error);
      throw error;
    }
  }

  // === Transaction Methods ===

  /**
   * Build and broadcast a transaction
   */
  async broadcastTransaction(operationType, operationData, privateKey) {
    try {
      // Get required fee
      const feeAsset = await this.getAsset('1.3.0');
      const requiredFees = await this.call(
        this.apiIds.database,
        'get_required_fees',
        [[[this.getOperationId(operationType), operationData]], feeAsset.id]
      );

      operationData.fee = requiredFees[0];

      // --- DEBUG: Verify public key matches account's active authority ---
      console.log('--- AUTHORITY DEBUG ---');
      const localPubKey = await CryptoUtils.wifToKeys(privateKey);
      console.log('Local public key (from WIF):', localPubKey.publicKey);

      // Get the account from the operation (works for transfer, could be different for other ops)
      const accountId = operationData.from || operationData.account;
      if (accountId) {
        const accountInfo = await this.getAccount(accountId);
        if (accountInfo) {
          console.log('Account name:', accountInfo.name);
          console.log('Account ID:', accountInfo.id);
          console.log('Account active authority:', JSON.stringify(accountInfo.active, null, 2));

          // Extract the public keys from the active authority
          const activeKeys = accountInfo.active.key_auths;
          console.log('Active key_auths:', activeKeys);

          // Check if our local key matches any of the active keys
          let keyFound = false;
          for (const [pubKey, weight] of activeKeys) {
            console.log(`  Checking key: ${pubKey} (weight: ${weight})`);
            if (pubKey === localPubKey.publicKey) {
              console.log('  ✓ KEY MATCH FOUND!');
              keyFound = true;
            } else {
              console.log('  ✗ No match');
              console.log('    Our key:    ', localPubKey.publicKey);
              console.log('    Account key:', pubKey);
            }
          }
          if (!keyFound) {
            console.log('  ========================================');
            console.log('  ✗ NO KEY MATCH - Local key is not in account active authority!');
            console.log('  This means the key derived from your password/brainkey');
            console.log('  does not match what is registered on the blockchain.');
            console.log('  ========================================');
          }
        }
      }
      console.log('--- END AUTHORITY DEBUG ---');

      // Build transaction
      const transaction = await this.buildTransaction(operationType, operationData);

      // Sign transaction
      const signedTx = await this.signTransaction(transaction, privateKey);

      // Broadcast
      const result = await this.call(
        this.apiIds.network,
        'broadcast_transaction_with_callback',
        [this.callId, signedTx]
      );

      return result;
    } catch (error) {
      console.error('Broadcast transaction error:', error);
      throw error;
    }
  }

  /**
   * Build a transaction
   */
  async buildTransaction(operationType, operationData) {
    // Refresh dynamic properties
    this.dynamicGlobalProperties = await this.call(
      this.apiIds.database,
      'get_dynamic_global_properties',
      []
    );

    const refBlockNum = this.dynamicGlobalProperties.head_block_number & 0xFFFF;

    // Parse ref_block_prefix from head_block_id without using Buffer (browser compatible)
    const headBlockId = this.dynamicGlobalProperties.head_block_id;
    // The ref_block_prefix is bytes 4-7 of the block id, read as little-endian uint32
    // headBlockId is a hex string, so bytes 4-7 are characters 8-15
    const hexBytes = headBlockId.substring(8, 16);
    // Convert from hex and reverse for little-endian
    const byte0 = parseInt(hexBytes.substring(0, 2), 16);
    const byte1 = parseInt(hexBytes.substring(2, 4), 16);
    const byte2 = parseInt(hexBytes.substring(4, 6), 16);
    const byte3 = parseInt(hexBytes.substring(6, 8), 16);
    // Use >>> 0 to ensure unsigned 32-bit integer (JS bitwise ops return signed 32-bit)
    const refBlockPrefix = ((byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0);

    // Transaction expires in 30 seconds
    const expiration = new Date(
      new Date(this.dynamicGlobalProperties.time + 'Z').getTime() + 30000
    ).toISOString().slice(0, -5);

    return {
      ref_block_num: refBlockNum,
      ref_block_prefix: refBlockPrefix,
      expiration: expiration,
      operations: [[this.getOperationId(operationType), operationData]],
      extensions: []
    };
  }

  /**
   * Return true when a string already looks like a BitShares object ID (X.Y.Z).
   */
  _isObjectId(str) {
    return typeof str === 'string' && str.includes('.');
  }

  /**
   * Resolve account names and asset symbols inside operation data to proper
   * numeric object IDs (X.Y.Z) in-place.  Only fields that are already strings
   * without dots are touched; numeric IDs are left as-is.
   *
   * Coverage: transfer (0), limit_order_create (1), liquidity_pool_exchange (63),
   * plus any operation that has a top-level `account` field.  All operations share
   * `fee.asset_id` handling.
   */
  async _resolveOperationIds(operations) {
    for (const op of operations) {
      const opType = Array.isArray(op) ? op[0] : op.type;
      const d = Array.isArray(op) ? op[1] : (op.data || op.op || op);
      if (!d || typeof d !== 'object') continue;

      // Helper: resolve a single account name → "1.2.N" ID in-place on obj[key]
      const resolveAccount = async (obj, key) => {
        const v = obj[key];
        if (typeof v === 'string' && !this._isObjectId(v)) {
          try {
            const acc = await this.getAccount(v);
            if (acc?.id) obj[key] = acc.id;
          } catch (_) { /* leave as-is */ }
        }
      };

      // Helper: resolve an asset symbol → "1.3.N" ID in-place on assetObj.asset_id
      const resolveAssetId = async (assetObj) => {
        if (!assetObj || typeof assetObj !== 'object') return;
        const v = assetObj.asset_id;
        if (typeof v === 'string' && !this._isObjectId(v)) {
          try {
            const [asset] = await this.call(this.apiIds.database, 'get_assets', [[v]]);
            if (asset?.id) assetObj.asset_id = asset.id;
          } catch (_) { /* leave as-is */ }
        }
      };

      // All operations: normalise fee asset_id
      await resolveAssetId(d.fee);

      switch (opType) {
        case 0: // transfer
          await resolveAccount(d, 'from');
          await resolveAccount(d, 'to');
          await resolveAssetId(d.amount);
          // Ensure memo.message is hex — dApps may send base64 or plain text.
          // The node always expects lowercase hex for the `bytes` type.
          if (d.memo && typeof d.memo.message === 'string') {
            if (!/^[0-9a-fA-F]*$/.test(d.memo.message)) {
              let converted = false;
              try {
                const raw = Uint8Array.from(atob(d.memo.message), c => c.charCodeAt(0));
                d.memo.message = bytesToHex(raw);
                converted = true;
              } catch (_) { /* not valid base64 */ }
              if (!converted) {
                // Plain text — encode as UTF-8 hex
                const enc = new TextEncoder();
                d.memo.message = Array.from(enc.encode(d.memo.message))
                  .map(b => b.toString(16).padStart(2, '0')).join('');
              }
            } else {
              // Normalise to lowercase hex
              d.memo.message = d.memo.message.toLowerCase();
            }
          }
          break;
        case 1: // limit_order_create
          await resolveAccount(d, 'seller');
          await resolveAssetId(d.amount_to_sell);
          await resolveAssetId(d.min_to_receive);
          break;
        case 2: // limit_order_cancel
          await resolveAccount(d, 'fee_paying_account');
          break;
        case 63: // liquidity_pool_exchange
          await resolveAccount(d, 'account');
          await resolveAssetId(d.amount_to_sell);
          await resolveAssetId(d.min_to_receive);
          break;
        default:
          // For any unknown op: resolve a top-level "account" field if present
          if (d.account) await resolveAccount(d, 'account');
          break;
      }
    }
  }

  /**
   * Sign a complete transaction (with operations already set) and broadcast it.
   * - Fills in required fees via get_required_fees
   * - Refreshes block reference headers so the tx doesn't expire
   * - Signs with the given private key
   * - Broadcasts via broadcast_transaction_with_callback
   */
  async signAndBroadcast(tx, privateKeyWIF) {
    // 0. Resolve any account names / asset symbols to proper object IDs.
    //    Some dApps send names like "alice" or symbols like "BTS" instead of
    //    numeric IDs like "1.2.xxx" / "1.3.0".  The BitShares node always
    //    rejects non-dotted strings with "Missing the first dot".
    await this._resolveOperationIds(tx.operations);

    // 1. Fill required fees for every operation
    try {
      const feeAsset = await this.getAsset('1.3.0');
      const requiredFees = await this.call(
        this.apiIds.database,
        'get_required_fees',
        [tx.operations, feeAsset.id]
      );
      if (requiredFees && requiredFees.length === tx.operations.length) {
        for (let i = 0; i < tx.operations.length; i++) {
          tx.operations[i][1].fee = requiredFees[i];
        }
      }
    } catch (feeErr) {
      console.warn('get_required_fees failed, proceeding with existing fees:', feeErr);
    }

    // 2. Refresh block reference headers (avoids stale ref / expiry issues)
    this.dynamicGlobalProperties = await this.call(
      this.apiIds.database,
      'get_dynamic_global_properties',
      []
    );
    const refBlockNum = this.dynamicGlobalProperties.head_block_number & 0xFFFF;
    const headBlockId = this.dynamicGlobalProperties.head_block_id;
    const hexBytes = headBlockId.substring(8, 16);
    const byte0 = parseInt(hexBytes.substring(0, 2), 16);
    const byte1 = parseInt(hexBytes.substring(2, 4), 16);
    const byte2 = parseInt(hexBytes.substring(4, 6), 16);
    const byte3 = parseInt(hexBytes.substring(6, 8), 16);
    const refBlockPrefix = ((byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0);
    const expiration = new Date(
      new Date(this.dynamicGlobalProperties.time + 'Z').getTime() + 30000
    ).toISOString().slice(0, -5);

    const freshTx = {
      ref_block_num: refBlockNum,
      ref_block_prefix: refBlockPrefix,
      expiration,
      operations: tx.operations,
      extensions: tx.extensions || [],
      signatures: []
    };

    // 3. Sign
    const signedTx = await this.signTransaction(freshTx, privateKeyWIF);

    // 4. Broadcast
    const result = await this.call(
      this.apiIds.network,
      'broadcast_transaction_with_callback',
      [this.callId, signedTx]
    );
    return result;
  }

  /**
   * Sign a transaction using ECDSA with secp256k1
   */
  async signTransaction(transaction, privateKeyWIF) {
    try {
      console.log('--- TRANSACTION DEBUG ---');
      console.log('Chain ID:', this.chainId);
      console.log('Transaction JSON:', JSON.stringify(transaction, null, 2));

      // 1. Serialize the transaction
      const serializedTx = this.serializeTransaction(transaction);
      console.log('Serialized TX length:', serializedTx.length, 'bytes');
      console.log('Serialized TX (Hex):', bytesToHex(serializedTx));

      // 2. Prepare message: ChainID + SerializedTx
      const chainIdBytes = hexToBytes(this.chainId);
      const messageBytes = new Uint8Array(chainIdBytes.length + serializedTx.length);
      messageBytes.set(chainIdBytes);
      messageBytes.set(serializedTx, chainIdBytes.length);

      console.log('ChainID bytes length:', chainIdBytes.length);
      console.log('Full message length:', messageBytes.length, 'bytes');

      // 3. Hash the message (SHA256)
      const msgHash = await sha256(messageBytes);
      console.log('Final Msg Hash (Hex):', bytesToHex(msgHash));

      // 4. Sign the hash using our CryptoUtils
      const signature = await CryptoUtils.signHash(msgHash, privateKeyWIF);
      transaction.signatures = [bytesToHex(signature)];

      console.log('--- FINAL SIGNED TRANSACTION ---');
      console.log(JSON.stringify(transaction, null, 2));

      return transaction;
    } catch (error) {
      console.error('Transaction signing error:', error);
      throw error;
    }
  }

  /**
   * Concatenate multiple Uint8Arrays
   */
  concatBytes(arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  /**
   * Write uint16 little-endian
   */
  writeUint16LE(value) {
    const buf = new Uint8Array(2);
    buf[0] = value & 0xff;
    buf[1] = (value >> 8) & 0xff;
    return buf;
  }

  /**
   * Write uint32 little-endian
   */
  writeUint32LE(value) {
    // Ensure value is treated as unsigned 32-bit
    const v = value >>> 0;
    const buf = new Uint8Array(4);
    buf[0] = v & 0xff;
    buf[1] = (v >>> 8) & 0xff;
    buf[2] = (v >>> 16) & 0xff;
    buf[3] = (v >>> 24) & 0xff;
    return buf;
  }

  /**
   * Write int64 little-endian
   */
  writeInt64LE(value) {
    const buf = new Uint8Array(8);
    const bigVal = BigInt(value);
    for (let i = 0; i < 8; i++) {
      buf[i] = Number((bigVal >> BigInt(i * 8)) & 0xffn);
    }
    return buf;
  }

  /**
   * Extracts the instance ID from a Graphene object ID (e.g., "1.2.1075306" -> 1075306)
   */
  extractId(idString) {
      if (typeof idString === 'number') return idString;
      const parts = idString.split('.');
      return parseInt(parts[parts.length - 1], 10);
  }

  /**
   * Encodes a number as a Base-128 Varint
   */
  writeVarint(value) {
      let v = BigInt(value);
      const buf = [];
      while (v >= 0x80n) {
          buf.push(Number((v & 0x7fn) | 0x80n));
          v >>= 7n;
      }
      buf.push(Number(v));
      return new Uint8Array(buf);
  }

/**
 * Serialize operation data based on operation type
 * Note: The operation type varint is serialized in serializeTransaction,
 * this function only serializes the operation data itself
 */
serializeOperationData(opType, opData) {
    switch (opType) {
      case 0: // transfer
        return this.serializeTransferOp(opData);
      case 1: // limit_order_create
        return this.serializeLimitOrderCreateOp(opData);
      case 2: // limit_order_cancel
        return this.serializeLimitOrderCancelOp(opData);
      case 3: // call_order_update
        return this.serializeCallOrderUpdateOp(opData);
      case 4: // fill_order (virtual)
        return this.serializeFillOrderOp(opData);
      case 5: // account_create
        return this.serializeAccountCreateOp(opData);
      case 6: // account_update
        return this.serializeAccountUpdateOp(opData);
      case 7: // account_whitelist
        return this.serializeAccountWhitelistOp(opData);
      case 8: // account_upgrade
        return this.serializeAccountUpgradeOp(opData);
      case 9: // account_transfer
        return this.serializeAccountTransferOp(opData);
      case 10: // asset_create
        return this.serializeAssetCreateOp(opData);
      case 11: // asset_update
        return this.serializeAssetUpdateOp(opData);
      case 12: // asset_update_bitasset
        return this.serializeAssetUpdateBitassetOp(opData);
      case 13: // asset_update_feed_producers
        return this.serializeAssetUpdateFeedProducersOp(opData);
      case 14: // asset_issue
        return this.serializeAssetIssueOp(opData);
      case 15: // asset_reserve
        return this.serializeAssetReserveOp(opData);
      case 16: // asset_fund_fee_pool
        return this.serializeAssetFundFeePoolOp(opData);
      case 17: // asset_settle
        return this.serializeAssetSettleOp(opData);
      case 18: // asset_global_settle
        return this.serializeAssetGlobalSettleOp(opData);
      case 19: // asset_publish_feed
        return this.serializeAssetPublishFeedOp(opData);
      case 20: // witness_create
        return this.serializeWitnessCreateOp(opData);
      case 21: // witness_update
        return this.serializeWitnessUpdateOp(opData);
      case 22: // proposal_create
        return this.serializeProposalCreateOp(opData);
      case 23: // proposal_update
        return this.serializeProposalUpdateOp(opData);
      case 24: // proposal_delete
        return this.serializeProposalDeleteOp(opData);
      case 25: // withdraw_permission_create
        return this.serializeWithdrawPermissionCreateOp(opData);
      case 26: // withdraw_permission_update
        return this.serializeWithdrawPermissionUpdateOp(opData);
      case 27: // withdraw_permission_claim
        return this.serializeWithdrawPermissionClaimOp(opData);
      case 28: // withdraw_permission_delete
        return this.serializeWithdrawPermissionDeleteOp(opData);
      case 29: // committee_member_create
        return this.serializeCommitteeMemberCreateOp(opData);
      case 30: // committee_member_update
        return this.serializeCommitteeMemberUpdateOp(opData);
      case 31: // committee_member_update_global_parameters
        return this.serializeCommitteeMemberUpdateGlobalParametersOp(opData);
      case 32: // vesting_balance_create
        return this.serializeVestingBalanceCreateOp(opData);
      case 33: // vesting_balance_withdraw
        return this.serializeVestingBalanceWithdrawOp(opData);
      case 34: // worker_create
        return this.serializeWorkerCreateOp(opData);
      case 35: // custom
        return this.serializeCustomOp(opData);
      case 36: // assert
        return this.serializeAssertOp(opData);
      case 37: // balance_claim
        return this.serializeBalanceClaimOp(opData);
      case 38: // override_transfer
        return this.serializeOverrideTransferOp(opData);
      case 39: // transfer_to_blind
        return this.serializeTransferToBlindOp(opData);
      case 40: // blind_transfer
        return this.serializeBlindTransferOp(opData);
      case 41: // transfer_from_blind
        return this.serializeTransferFromBlindOp(opData);
      case 42: // asset_settle_cancel
        return this.serializeAssetSettleCancelOp(opData);
      case 43: // asset_claim_fees
        return this.serializeAssetClaimFeesOp(opData);
      case 44: // fba_distribute
        return this.serializeFbaDistributeOp(opData);
      case 45: // bid_collateral
        return this.serializeBidCollateralOp(opData);
      case 46: // execute_bid
        return this.serializeExecuteBidOp(opData);
      case 47: // asset_claim_pool
        return this.serializeAssetClaimPoolOp(opData);
      case 48: // asset_update_issuer
        return this.serializeAssetUpdateIssuerOp(opData);
      case 49: // htlc_create
        return this.serializeHtlcCreateOp(opData);
      case 50: // htlc_redeem
        return this.serializeHtlcRedeemOp(opData);
      case 51: // htlc_redeemed (virtual)
        return this.serializeHtlcRedeemedOp(opData);
      case 52: // htlc_extend
        return this.serializeHtlcExtendOp(opData);
      case 53: // htlc_refund (virtual)
        return this.serializeHtlcRefundOp(opData);
      case 54: // custom_authority_create
        return this.serializeCustomAuthorityCreateOp(opData);
      case 55: // custom_authority_update
        return this.serializeCustomAuthorityUpdateOp(opData);
      case 56: // custom_authority_delete
        return this.serializeCustomAuthorityDeleteOp(opData);
      case 57: // ticket_create
        return this.serializeTicketCreateOp(opData);
      case 58: // ticket_update
        return this.serializeTicketUpdateOp(opData);
      case 59: // liquidity_pool_create
        return this.serializeLiquidityPoolCreateOp(opData);
      case 60: // liquidity_pool_delete
        return this.serializeLiquidityPoolDeleteOp(opData);
      case 61: // liquidity_pool_deposit
        return this.serializeLiquidityPoolDepositOp(opData);
      case 62: // liquidity_pool_withdraw
        return this.serializeLiquidityPoolWithdrawOp(opData);
      case 63: // liquidity_pool_exchange
        return this.serializeLiquidityPoolExchangeOp(opData);
      case 64: // samet_fund_create
        return this.serializeSametFundCreateOp(opData);
      case 65: // samet_fund_delete
        return this.serializeSametFundDeleteOp(opData);
      case 66: // samet_fund_update
        return this.serializeSametFundUpdateOp(opData);
      case 67: // samet_fund_borrow
        return this.serializeSametFundBorrowOp(opData);
      case 68: // samet_fund_repay
        return this.serializeSametFundRepayOp(opData);
      case 69: // credit_offer_create
        return this.serializeCreditOfferCreateOp(opData);
      case 70: // credit_offer_delete
        return this.serializeCreditOfferDeleteOp(opData);
      case 71: // credit_offer_update
        return this.serializeCreditOfferUpdateOp(opData);
      case 72: // credit_offer_accept
        return this.serializeCreditOfferAcceptOp(opData);
      case 73: // credit_deal_repay
        return this.serializeCreditDealRepayOp(opData);
      case 74: // credit_deal_expired (virtual)
        return this.serializeCreditDealExpiredOp(opData);
      default:
        console.warn(`Unknown operation type ${opType}, using generic serialization`);
        return this.serializeGenericOp(opData);
    }
}

  /**
   * Serialize a transaction to bytes for signing
   * BitShares uses a specific binary format
   */
  serializeTransaction(transaction) {
    const buffers = [];

    // ref_block_num (uint16)
    const refBlockNumBytes = this.writeUint16LE(transaction.ref_block_num);
    buffers.push(refBlockNumBytes);
    console.log('  ref_block_num:', transaction.ref_block_num, '-> bytes:', bytesToHex(refBlockNumBytes));

    // ref_block_prefix (uint32)
    const refBlockPrefixBytes = this.writeUint32LE(transaction.ref_block_prefix);
    buffers.push(refBlockPrefixBytes);
    console.log('  ref_block_prefix:', transaction.ref_block_prefix, '-> bytes:', bytesToHex(refBlockPrefixBytes));

    // expiration (uint32 - seconds since epoch)
    const expiration = Math.floor(new Date(transaction.expiration + 'Z').getTime() / 1000);
    const expirationBytes = this.writeUint32LE(expiration);
    buffers.push(expirationBytes);
    console.log('  expiration:', expiration, '-> bytes:', bytesToHex(expirationBytes));

    // operations (varint length + serialized operations)
    const opsLengthBytes = this.encodeVarint(transaction.operations.length);
    buffers.push(opsLengthBytes);
    console.log('  operations count:', transaction.operations.length, '-> bytes:', bytesToHex(opsLengthBytes));

    for (const [opType, opData] of transaction.operations) {
      // Operation type (varint)
      const opTypeBytes = this.encodeVarint(opType);
      buffers.push(opTypeBytes);
      console.log('  op type:', opType, '-> bytes:', bytesToHex(opTypeBytes));

      // Operation data (without the type - that's already added above)
      const opDataBytes = this.serializeOperationData(opType, opData);
      buffers.push(opDataBytes);
      console.log('  op data length:', opDataBytes.length, 'bytes');
      console.log('  op data hex:', bytesToHex(opDataBytes));
    }

    // extensions (varint length, typically 0)
    const extBytes = this.encodeVarint(transaction.extensions?.length || 0);
    buffers.push(extBytes);
    console.log('  extensions:', transaction.extensions?.length || 0, '-> bytes:', bytesToHex(extBytes));

    return this.concatBytes(buffers);
  }

  /**
   * Serialize transfer operation
   */
  serializeTransferOp(op) {
    const buffers = [];
    console.log('    --- Transfer Op Serialization ---');

    // fee
    const feeBytes = this.serializeAssetAmount(op.fee);
    buffers.push(feeBytes);
    console.log('    fee:', JSON.stringify(op.fee), '-> bytes:', bytesToHex(feeBytes));

    // from (account id)
    const fromBytes = this.serializeObjectId(op.from);
    buffers.push(fromBytes);
    console.log('    from:', op.from, '-> bytes:', bytesToHex(fromBytes));

    // to (account id)
    const toBytes = this.serializeObjectId(op.to);
    buffers.push(toBytes);
    console.log('    to:', op.to, '-> bytes:', bytesToHex(toBytes));

    // amount
    const amountBytes = this.serializeAssetAmount(op.amount);
    buffers.push(amountBytes);
    console.log('    amount:', JSON.stringify(op.amount), '-> bytes:', bytesToHex(amountBytes));

    // memo (optional)
    if (op.memo) {
      buffers.push(new Uint8Array([1])); // present flag
      const memoBytes = this.serializeMemo(op.memo);
      buffers.push(memoBytes);
      console.log('    memo: present, bytes:', bytesToHex(memoBytes));
    } else {
      buffers.push(new Uint8Array([0])); // not present
      console.log('    memo: not present -> 00');
    }

    // extensions
    buffers.push(this.encodeVarint(0));
    console.log('    extensions: 0 -> 00');

    return this.concatBytes(buffers);
  }

  /**
   * Serialize liquidity pool exchange operation
   */
  serializeLiquidityPoolExchangeOp(op) {
    const buffers = [];

    // fee
    buffers.push(this.serializeAssetAmount(op.fee));

    // account
    buffers.push(this.serializeObjectId(op.account));

    // pool
    buffers.push(this.serializeObjectId(op.pool));

    // amount_to_sell
    buffers.push(this.serializeAssetAmount(op.amount_to_sell));

    // min_to_receive
    buffers.push(this.serializeAssetAmount(op.min_to_receive));

    // extensions
    buffers.push(this.encodeVarint(0));

    return this.concatBytes(buffers);
  }

  /**
   * Serialize limit order create operation
   */
  serializeLimitOrderCreateOp(op) {
    const buffers = [];
    console.log('    --- Limit Order Create Op Serialization ---');

    // fee
    const feeBytes = this.serializeAssetAmount(op.fee);
    buffers.push(feeBytes);
    console.log('    fee:', JSON.stringify(op.fee), '-> bytes:', bytesToHex(feeBytes));

    // seller (account id)
    const sellerBytes = this.serializeObjectId(op.seller);
    buffers.push(sellerBytes);
    console.log('    seller:', op.seller, '-> bytes:', bytesToHex(sellerBytes));

    // amount_to_sell
    const sellBytes = this.serializeAssetAmount(op.amount_to_sell);
    buffers.push(sellBytes);
    console.log('    amount_to_sell:', JSON.stringify(op.amount_to_sell), '-> bytes:', bytesToHex(sellBytes));

    // min_to_receive
    const receiveBytes = this.serializeAssetAmount(op.min_to_receive);
    buffers.push(receiveBytes);
    console.log('    min_to_receive:', JSON.stringify(op.min_to_receive), '-> bytes:', bytesToHex(receiveBytes));

    // expiration (uint32 - seconds since epoch)
    const expiration = Math.floor(new Date(op.expiration + 'Z').getTime() / 1000);
    const expirationBytes = this.writeUint32LE(expiration);
    buffers.push(expirationBytes);
    console.log('    expiration:', expiration, '-> bytes:', bytesToHex(expirationBytes));

    // fill_or_kill (bool - 1 byte)
    buffers.push(new Uint8Array([op.fill_or_kill ? 1 : 0]));
    console.log('    fill_or_kill:', op.fill_or_kill ? 1 : 0);

    // extensions
    buffers.push(this.encodeVarint(0));
    console.log('    extensions: 0');

    return this.concatBytes(buffers);
  }

  /**
   * Serialize limit order cancel operation
   */
  serializeLimitOrderCancelOp(op) {
    const buffers = [];

    // fee
    buffers.push(this.serializeAssetAmount(op.fee));

    // fee_paying_account
    buffers.push(this.serializeObjectId(op.fee_paying_account));

    // order (limit order id to cancel)
    buffers.push(this.serializeObjectId(op.order));

    // extensions
    buffers.push(this.encodeVarint(0));

    return this.concatBytes(buffers);
  }

  /**
   * Generic operation serialization (fallback)
   */
  serializeGenericOp(op) {
    // This is a simplified fallback - complex operations may need specific handling
    const json = JSON.stringify(op);
    const data = new TextEncoder().encode(json);
    return this.concatBytes([this.encodeVarint(data.length), data]);
  }

  // ==========================================
  // Helper serialization methods for sub-types
  // ==========================================

  /**
   * Write a uint8 value (1 byte)
   */
  writeUint8(value) {
    return new Uint8Array([value & 0xff]);
  }

  /**
   * Write a uint64 value as little-endian (same as writeInt64LE but treated unsigned)
   */
  writeUint64LE(value) {
    const buf = new Uint8Array(8);
    const bigVal = BigInt(value);
    for (let i = 0; i < 8; i++) {
      buf[i] = Number((bigVal >> BigInt(i * 8)) & 0xffn);
    }
    return buf;
  }

  /**
   * Serialize a string with varint length prefix
   */
  serializeString(str) {
    const encoded = new TextEncoder().encode(str || '');
    return this.concatBytes([this.encodeVarint(encoded.length), encoded]);
  }

  /**
   * Serialize a time_point_sec (uint32 Unix timestamp)
   * Accepts ISO string or Unix timestamp number
   */
  serializeTimestamp(ts) {
    let secs;
    if (typeof ts === 'number') {
      secs = ts;
    } else if (typeof ts === 'string') {
      // Handle ISO string with or without trailing Z
      const isoStr = ts.endsWith('Z') ? ts : ts + 'Z';
      secs = Math.floor(new Date(isoStr).getTime() / 1000);
    } else {
      secs = 0;
    }
    return this.writeUint32LE(secs >>> 0);
  }

  /**
   * Serialize an optional field: 0x00 if absent, 0x01 + data if present
   */
  serializeOptional(value, serializeFn) {
    if (value === null || value === undefined) {
      return new Uint8Array([0]);
    }
    return this.concatBytes([new Uint8Array([1]), serializeFn(value)]);
  }

  /**
   * Serialize an array: varint count + serialized items
   */
  serializeArray(arr, serializeFn) {
    const items = arr || [];
    const buffers = [this.encodeVarint(items.length)];
    for (const item of items) {
      buffers.push(serializeFn(item));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize a set (same as array in binary format): varint count + serialized items
   */
  serializeSet(arr, serializeFn) {
    return this.serializeArray(arr, serializeFn);
  }

  /**
   * Serialize a map: varint count + (key, value) pairs
   */
  serializeMap(obj, keyFn, valueFn) {
    const entries = obj ? Object.entries(obj) : [];
    const buffers = [this.encodeVarint(entries.length)];
    for (const [k, v] of entries) {
      buffers.push(keyFn(k));
      buffers.push(valueFn(v));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize a map from an array of [key, value] pairs
   */
  serializeMapFromArray(arr, keyFn, valueFn) {
    const items = arr || [];
    const buffers = [this.encodeVarint(items.length)];
    for (const [k, v] of items) {
      buffers.push(keyFn(k));
      buffers.push(valueFn(v));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize raw bytes with varint length prefix
   */
  serializeBytes(data) {
    if (!data) return this.encodeVarint(0);
    let bytes;
    if (typeof data === 'string') {
      // Hex string
      bytes = this.hexToUint8Array(data);
    } else {
      bytes = data;
    }
    return this.concatBytes([this.encodeVarint(bytes.length), bytes]);
  }

  /**
   * Serialize fixed-size bytes (no length prefix)
   */
  serializeFixedBytes(data, size) {
    if (!data) return new Uint8Array(size);
    let bytes;
    if (typeof data === 'string') {
      bytes = this.hexToUint8Array(data);
    } else {
      bytes = data;
    }
    const result = new Uint8Array(size);
    result.set(bytes.slice(0, size));
    return result;
  }

  /**
   * Convert hex string to Uint8Array
   */
  hexToUint8Array(hex) {
    if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
    const result = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < result.length; i++) {
      result[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return result;
  }

  /**
   * Serialize authority structure
   * { weight_threshold: uint32, account_auths: map(account_id, uint16),
   *   key_auths: map(public_key, uint16), address_auths: map(address, uint16) }
   */
  serializeAuthority(auth) {
    if (!auth) {
      // Empty authority
      return this.concatBytes([
        this.writeUint32LE(0), // weight_threshold
        this.encodeVarint(0),  // account_auths (empty)
        this.encodeVarint(0),  // key_auths (empty)
        this.encodeVarint(0)   // address_auths (empty)
      ]);
    }
    const buffers = [];
    buffers.push(this.writeUint32LE(auth.weight_threshold || 0));
    // account_auths: array of [account_id, uint16]
    const accountAuths = auth.account_auths || [];
    buffers.push(this.encodeVarint(accountAuths.length));
    for (const [accountId, weight] of accountAuths) {
      buffers.push(this.serializeObjectId(accountId));
      buffers.push(this.writeUint16LE(weight));
    }
    // key_auths: array of [public_key, uint16]
    const keyAuths = auth.key_auths || [];
    buffers.push(this.encodeVarint(keyAuths.length));
    for (const [pubKey, weight] of keyAuths) {
      buffers.push(this.serializePublicKey(pubKey));
      buffers.push(this.writeUint16LE(weight));
    }
    // address_auths: array of [address, uint16]
    const addrAuths = auth.address_auths || [];
    buffers.push(this.encodeVarint(addrAuths.length));
    for (const [addr, weight] of addrAuths) {
      buffers.push(this.serializePublicKey(addr)); // address serialized same as public key
      buffers.push(this.writeUint16LE(weight));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize account_options structure
   * { memo_key, voting_account, num_witness, num_committee, votes, extensions }
   */
  serializeAccountOptions(opts) {
    const buffers = [];
    buffers.push(this.serializePublicKey(opts.memo_key));
    buffers.push(this.serializeObjectId(opts.voting_account || '1.2.5'));
    buffers.push(this.writeUint16LE(opts.num_witness || 0));
    buffers.push(this.writeUint16LE(opts.num_committee || 0));
    // votes: set of vote_id (each is a uint32 encoded as varint in the bitshares serializer)
    const votes = opts.votes || [];
    buffers.push(this.encodeVarint(votes.length));
    for (const vote of votes) {
      // vote_id is "type:instance" string, serialized as uint32
      // type = lower 8 bits, instance = upper 24 bits (per graphene vote_id_type)
      let voteInt;
      if (typeof vote === 'string' && vote.includes(':')) {
        const [type, instance] = vote.split(':').map(Number);
        voteInt = (type & 0xff) | ((instance & 0xffffff) << 8);
      } else {
        voteInt = Number(vote) || 0;
      }
      buffers.push(this.writeUint32LE(voteInt >>> 0));
    }
    // extensions (empty set)
    buffers.push(this.encodeVarint(0));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize price structure { base: asset, quote: asset }
   */
  serializePrice(price) {
    return this.concatBytes([
      this.serializeAssetAmount(price.base),
      this.serializeAssetAmount(price.quote)
    ]);
  }

  /**
   * Serialize asset_options structure
   */
  serializeAssetOptions(opts) {
    const buffers = [];
    buffers.push(this.writeInt64LE(opts.max_supply || 0));
    buffers.push(this.writeUint16LE(opts.market_fee_percent || 0));
    buffers.push(this.writeInt64LE(opts.max_market_fee || 0));
    buffers.push(this.writeUint16LE(opts.issuer_permissions || 0));
    buffers.push(this.writeUint16LE(opts.flags || 0));
    buffers.push(this.serializePrice(opts.core_exchange_rate));
    // whitelist_authorities: set of account_id
    buffers.push(this.serializeSet(opts.whitelist_authorities || [], id => this.serializeObjectId(id)));
    // blacklist_authorities: set of account_id
    buffers.push(this.serializeSet(opts.blacklist_authorities || [], id => this.serializeObjectId(id)));
    // whitelist_markets: set of asset_id
    buffers.push(this.serializeSet(opts.whitelist_markets || [], id => this.serializeObjectId(id)));
    // blacklist_markets: set of asset_id
    buffers.push(this.serializeSet(opts.blacklist_markets || [], id => this.serializeObjectId(id)));
    // description: string
    buffers.push(this.serializeString(opts.description || ''));
    // extensions (empty)
    buffers.push(this.encodeVarint(0));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize bitasset_options structure
   */
  serializeBitassetOptions(opts) {
    const buffers = [];
    buffers.push(this.writeUint32LE(opts.feed_lifetime_sec || 0));
    buffers.push(this.writeUint8(opts.minimum_feeds || 0));
    buffers.push(this.writeUint32LE(opts.force_settlement_delay_sec || 0));
    buffers.push(this.writeUint16LE(opts.force_settlement_offset_percent || 0));
    buffers.push(this.writeUint16LE(opts.maximum_force_settlement_volume || 0));
    buffers.push(this.serializeObjectId(opts.short_backing_asset || '1.3.0'));
    // extensions (empty)
    buffers.push(this.encodeVarint(0));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize price_feed structure
   */
  serializePriceFeed(feed) {
    return this.concatBytes([
      this.serializePrice(feed.settlement_price),
      this.writeUint16LE(feed.maintenance_collateral_ratio || 1750),
      this.writeUint16LE(feed.maximum_short_squeeze_ratio || 1500),
      this.serializePrice(feed.core_exchange_rate)
    ]);
  }

  /**
   * Serialize a vesting policy initializer (static_variant)
   * [0] = linear_vesting_policy_initializer
   * [1] = cdd_vesting_policy_initializer
   */
  serializeVestingPolicyInitializer(policy) {
    if (!policy) return new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const type = policy.type || 0;
    const buffers = [this.encodeVarint(type)];
    if (type === 0) {
      // linear: begin_timestamp, vesting_cliff_seconds, vesting_duration_seconds
      buffers.push(this.serializeTimestamp(policy.begin_timestamp || 0));
      buffers.push(this.writeUint32LE(policy.vesting_cliff_seconds || 0));
      buffers.push(this.writeUint32LE(policy.vesting_duration_seconds || 0));
    } else {
      // cdd: start_claim, vesting_seconds
      buffers.push(this.serializeTimestamp(policy.start_claim || 0));
      buffers.push(this.writeUint32LE(policy.vesting_seconds || 0));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize a worker initializer (static_variant)
   * [0] = refund_worker_initializer
   * [1] = vesting_balance_worker_initializer
   * [2] = burn_worker_initializer
   */
  serializeWorkerInitializer(init) {
    if (!init) return new Uint8Array([0]);
    const type = init.type || 0;
    const buffers = [this.encodeVarint(type)];
    if (type === 1) {
      // vesting_balance_worker_initializer: pay_vesting_period_days (uint16)
      buffers.push(this.writeUint16LE(init.pay_vesting_period_days || 0));
    }
    // type 0 (refund) and type 2 (burn) have no fields
    return this.concatBytes(buffers);
  }

  /**
   * Serialize a blind_output structure
   */
  serializeBlindOutput(output) {
    const buffers = [];
    buffers.push(this.serializeFixedBytes(output.commitment, 33));
    buffers.push(this.serializeBytes(output.range_proof));
    buffers.push(this.serializeAuthority(output.owner));
    // stealth_memo (optional)
    if (output.stealth_memo) {
      buffers.push(new Uint8Array([1]));
      buffers.push(this.serializeStealthConfirmation(output.stealth_memo));
    } else {
      buffers.push(new Uint8Array([0]));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize a stealth_confirmation structure
   */
  serializeStealthConfirmation(conf) {
    const buffers = [];
    buffers.push(this.serializePublicKey(conf.one_time_key));
    // to: optional(public_key)
    if (conf.to) {
      buffers.push(new Uint8Array([1]));
      buffers.push(this.serializePublicKey(conf.to));
    } else {
      buffers.push(new Uint8Array([0]));
    }
    buffers.push(this.serializeBytes(conf.encrypted_memo));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize a blind_input structure
   */
  serializeBlindInput(input) {
    return this.concatBytes([
      this.serializeFixedBytes(input.commitment, 33),
      this.serializeAuthority(input.owner)
    ]);
  }

  /**
   * Serialize a restriction structure (for custom_authority)
   * This is a complex recursive type.
   */
  serializeRestriction(restriction) {
    const buffers = [];
    buffers.push(this.encodeVarint(restriction.member_index || 0));
    buffers.push(this.encodeVarint(restriction.restriction_type || 0));
    // argument is a static_variant - encode as type index + data
    const arg = restriction.argument;
    const argType = restriction.argument_type || 0;
    buffers.push(this.encodeVarint(argType));
    // For simplicity, serialize the argument as bytes if it's a complex type
    // The most common case is simple types
    if (argType === 0) {
      // void - no data
    } else if (argType === 1) {
      buffers.push(new Uint8Array([arg ? 1 : 0]));
    } else if (argType === 2) {
      buffers.push(this.writeInt64LE(arg || 0));
    } else if (argType === 3) {
      buffers.push(this.serializeString(arg || ''));
    } else if (argType === 4) {
      buffers.push(this.serializeTimestamp(arg || 0));
    } else if (argType === 5) {
      buffers.push(this.serializePublicKey(arg));
    } else if (argType === 6) {
      buffers.push(this.serializeFixedBytes(arg, 32));
    } else if (argType >= 7 && argType <= 19) {
      buffers.push(this.serializeObjectId(arg));
    } else {
      // For complex types, serialize as empty
      buffers.push(this.encodeVarint(0));
    }
    // extensions
    buffers.push(this.encodeVarint(0));
    return this.concatBytes(buffers);
  }

  // ==========================================
  // Operation serializers (ops 3-74)
  // ==========================================

  /**
   * Serialize call_order_update operation (op 3)
   * { fee, funding_account, delta_collateral, delta_debt, extensions }
   */
  serializeCallOrderUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.funding_account));
    buffers.push(this.serializeAssetAmount(op.delta_collateral));
    buffers.push(this.serializeAssetAmount(op.delta_debt));
    // extensions: extension type with optional target_collateral_ratio
    // Serialized as a set/array of typed extensions
    const ext = op.extensions || {};
    if (ext.target_collateral_ratio !== undefined) {
      buffers.push(this.encodeVarint(1)); // 1 extension
      buffers.push(this.encodeVarint(0)); // index 0 = target_collateral_ratio
      buffers.push(this.writeUint16LE(ext.target_collateral_ratio));
    } else {
      buffers.push(this.encodeVarint(0));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize fill_order operation (op 4) - virtual operation
   * { fee, order_id, account_id, pays, receives }
   */
  serializeFillOrderOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.order_id));
    buffers.push(this.serializeObjectId(op.account_id));
    buffers.push(this.serializeAssetAmount(op.pays));
    buffers.push(this.serializeAssetAmount(op.receives));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize account_create operation (op 5)
   * { fee, registrar, referrer, referrer_percent, name, owner, active, options, extensions }
   */
  serializeAccountCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.registrar));
    buffers.push(this.serializeObjectId(op.referrer));
    buffers.push(this.writeUint16LE(op.referrer_percent || 0));
    buffers.push(this.serializeString(op.name));
    buffers.push(this.serializeAuthority(op.owner));
    buffers.push(this.serializeAuthority(op.active));
    buffers.push(this.serializeAccountOptions(op.options));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize account_update operation (op 6)
   * { fee, account, owner?, active?, new_options?, extensions }
   */
  serializeAccountUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeOptional(op.owner, v => this.serializeAuthority(v)));
    buffers.push(this.serializeOptional(op.active, v => this.serializeAuthority(v)));
    buffers.push(this.serializeOptional(op.new_options, v => this.serializeAccountOptions(v)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize account_whitelist operation (op 7)
   * { fee, authorizing_account, account_to_list, new_listing, extensions }
   */
  serializeAccountWhitelistOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.authorizing_account));
    buffers.push(this.serializeObjectId(op.account_to_list));
    buffers.push(this.writeUint8(op.new_listing || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize account_upgrade operation (op 8)
   * { fee, account_to_upgrade, upgrade_to_lifetime_member, extensions }
   */
  serializeAccountUpgradeOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account_to_upgrade));
    buffers.push(new Uint8Array([op.upgrade_to_lifetime_member ? 1 : 0]));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize account_transfer operation (op 9)
   * { fee, account_id, new_owner, extensions }
   */
  serializeAccountTransferOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account_id));
    buffers.push(this.serializeObjectId(op.new_owner));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_create operation (op 10)
   * { fee, issuer, symbol, precision, common_options, bitasset_opts?, is_prediction_market, extensions }
   */
  serializeAssetCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeString(op.symbol));
    buffers.push(this.writeUint8(op.precision || 5));
    buffers.push(this.serializeAssetOptions(op.common_options));
    buffers.push(this.serializeOptional(op.bitasset_opts, v => this.serializeBitassetOptions(v)));
    buffers.push(new Uint8Array([op.is_prediction_market ? 1 : 0]));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_update operation (op 11)
   * { fee, issuer, asset_to_update, new_issuer?, new_options, extensions }
   */
  serializeAssetUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.asset_to_update));
    buffers.push(this.serializeOptional(op.new_issuer, v => this.serializeObjectId(v)));
    buffers.push(this.serializeAssetOptions(op.new_options));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_update_bitasset operation (op 12)
   * { fee, issuer, asset_to_update, new_options, extensions }
   */
  serializeAssetUpdateBitassetOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.asset_to_update));
    buffers.push(this.serializeBitassetOptions(op.new_options));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_update_feed_producers operation (op 13)
   * { fee, issuer, asset_to_update, new_feed_producers, extensions }
   */
  serializeAssetUpdateFeedProducersOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.asset_to_update));
    buffers.push(this.serializeSet(op.new_feed_producers || [], id => this.serializeObjectId(id)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_issue operation (op 14)
   * { fee, issuer, asset_to_issue, issue_to_account, memo?, extensions }
   */
  serializeAssetIssueOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeAssetAmount(op.asset_to_issue));
    buffers.push(this.serializeObjectId(op.issue_to_account));
    // memo (optional)
    if (op.memo) {
      buffers.push(new Uint8Array([1]));
      buffers.push(this.serializeMemo(op.memo));
    } else {
      buffers.push(new Uint8Array([0]));
    }
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_reserve operation (op 15)
   * { fee, payer, amount_to_reserve, extensions }
   */
  serializeAssetReserveOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.payer));
    buffers.push(this.serializeAssetAmount(op.amount_to_reserve));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_fund_fee_pool operation (op 16)
   * { fee, from_account, asset_id, amount, extensions }
   */
  serializeAssetFundFeePoolOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.from_account));
    buffers.push(this.serializeObjectId(op.asset_id));
    buffers.push(this.writeInt64LE(op.amount || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_settle operation (op 17)
   * { fee, account, amount, extensions }
   */
  serializeAssetSettleOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeAssetAmount(op.amount));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_global_settle operation (op 18)
   * { fee, issuer, asset_to_settle, settle_price, extensions }
   */
  serializeAssetGlobalSettleOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.asset_to_settle));
    buffers.push(this.serializePrice(op.settle_price));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_publish_feed operation (op 19)
   * { fee, publisher, asset_id, feed, extensions }
   */
  serializeAssetPublishFeedOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.publisher));
    buffers.push(this.serializeObjectId(op.asset_id));
    buffers.push(this.serializePriceFeed(op.feed));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize witness_create operation (op 20)
   * { fee, witness_account, url, block_signing_key }
   */
  serializeWitnessCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.witness_account));
    buffers.push(this.serializeString(op.url || ''));
    buffers.push(this.serializePublicKey(op.block_signing_key));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize witness_update operation (op 21)
   * { fee, witness, witness_account, new_url?, new_signing_key? }
   */
  serializeWitnessUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.witness));
    buffers.push(this.serializeObjectId(op.witness_account));
    buffers.push(this.serializeOptional(op.new_url, v => this.serializeString(v)));
    buffers.push(this.serializeOptional(op.new_signing_key, v => this.serializePublicKey(v)));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize proposal_create operation (op 22)
   * { fee, fee_paying_account, expiration_time, proposed_ops, review_period_seconds?, extensions }
   */
  serializeProposalCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.fee_paying_account));
    buffers.push(this.serializeTimestamp(op.expiration_time));
    // proposed_ops: array of op_wrapper { op: [type, data] }
    const proposedOps = op.proposed_ops || [];
    buffers.push(this.encodeVarint(proposedOps.length));
    for (const wrapper of proposedOps) {
      const [opType, opData] = wrapper.op;
      buffers.push(this.encodeVarint(opType));
      buffers.push(this.serializeOperationData(opType, opData));
    }
    buffers.push(this.serializeOptional(op.review_period_seconds,
      v => this.writeUint32LE(v)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize proposal_update operation (op 23)
   * { fee, fee_paying_account, proposal, active_approvals_to_add, active_approvals_to_remove,
   *   owner_approvals_to_add, owner_approvals_to_remove, key_approvals_to_add,
   *   key_approvals_to_remove, extensions }
   */
  serializeProposalUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.fee_paying_account));
    buffers.push(this.serializeObjectId(op.proposal));
    buffers.push(this.serializeSet(op.active_approvals_to_add || [], id => this.serializeObjectId(id)));
    buffers.push(this.serializeSet(op.active_approvals_to_remove || [], id => this.serializeObjectId(id)));
    buffers.push(this.serializeSet(op.owner_approvals_to_add || [], id => this.serializeObjectId(id)));
    buffers.push(this.serializeSet(op.owner_approvals_to_remove || [], id => this.serializeObjectId(id)));
    buffers.push(this.serializeSet(op.key_approvals_to_add || [], k => this.serializePublicKey(k)));
    buffers.push(this.serializeSet(op.key_approvals_to_remove || [], k => this.serializePublicKey(k)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize proposal_delete operation (op 24)
   * { fee, fee_paying_account, using_owner_authority, proposal, extensions }
   */
  serializeProposalDeleteOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.fee_paying_account));
    buffers.push(new Uint8Array([op.using_owner_authority ? 1 : 0]));
    buffers.push(this.serializeObjectId(op.proposal));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize withdraw_permission_create operation (op 25)
   * { fee, withdraw_from_account, authorized_account, withdrawal_limit, withdrawal_period_sec,
   *   periods_until_expiration, period_start_time }
   */
  serializeWithdrawPermissionCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.withdraw_from_account));
    buffers.push(this.serializeObjectId(op.authorized_account));
    buffers.push(this.serializeAssetAmount(op.withdrawal_limit));
    buffers.push(this.writeUint32LE(op.withdrawal_period_sec || 0));
    buffers.push(this.writeUint32LE(op.periods_until_expiration || 0));
    buffers.push(this.serializeTimestamp(op.period_start_time));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize withdraw_permission_update operation (op 26)
   * { fee, withdraw_from_account, authorized_account, permission_to_update, withdrawal_limit,
   *   withdrawal_period_sec, period_start_time, periods_until_expiration }
   */
  serializeWithdrawPermissionUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.withdraw_from_account));
    buffers.push(this.serializeObjectId(op.authorized_account));
    buffers.push(this.serializeObjectId(op.permission_to_update));
    buffers.push(this.serializeAssetAmount(op.withdrawal_limit));
    buffers.push(this.writeUint32LE(op.withdrawal_period_sec || 0));
    buffers.push(this.serializeTimestamp(op.period_start_time));
    buffers.push(this.writeUint32LE(op.periods_until_expiration || 0));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize withdraw_permission_claim operation (op 27)
   * { fee, withdraw_permission, withdraw_from_account, withdraw_to_account, amount_to_withdraw, memo? }
   */
  serializeWithdrawPermissionClaimOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.withdraw_permission));
    buffers.push(this.serializeObjectId(op.withdraw_from_account));
    buffers.push(this.serializeObjectId(op.withdraw_to_account));
    buffers.push(this.serializeAssetAmount(op.amount_to_withdraw));
    if (op.memo) {
      buffers.push(new Uint8Array([1]));
      buffers.push(this.serializeMemo(op.memo));
    } else {
      buffers.push(new Uint8Array([0]));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize withdraw_permission_delete operation (op 28)
   * { fee, withdraw_from_account, authorized_account, withdrawal_permission }
   */
  serializeWithdrawPermissionDeleteOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.withdraw_from_account));
    buffers.push(this.serializeObjectId(op.authorized_account));
    buffers.push(this.serializeObjectId(op.withdrawal_permission));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize committee_member_create operation (op 29)
   * { fee, committee_member_account, url }
   */
  serializeCommitteeMemberCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.committee_member_account));
    buffers.push(this.serializeString(op.url || ''));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize committee_member_update operation (op 30)
   * { fee, committee_member, committee_member_account, new_url? }
   */
  serializeCommitteeMemberUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.committee_member));
    buffers.push(this.serializeObjectId(op.committee_member_account));
    buffers.push(this.serializeOptional(op.new_url, v => this.serializeString(v)));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize committee_member_update_global_parameters operation (op 31)
   * { fee, new_parameters }
   * Note: chain_parameters is complex; we serialize what we can
   */
  serializeCommitteeMemberUpdateGlobalParametersOp(op) {
    // This is an extremely complex operation used only by committee members.
    // Provide best-effort serialization.
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    // new_parameters is serialized as a raw JSON blob here as it's rarely
    // used via wallet extensions; a full implementation would need to match
    // the chain_parameters serializer exactly.
    const params = op.new_parameters || {};
    const encoded = new TextEncoder().encode(JSON.stringify(params));
    buffers.push(this.encodeVarint(encoded.length));
    buffers.push(encoded);
    return this.concatBytes(buffers);
  }

  /**
   * Serialize vesting_balance_create operation (op 32)
   * { fee, creator, owner, amount, policy }
   */
  serializeVestingBalanceCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.creator));
    buffers.push(this.serializeObjectId(op.owner));
    buffers.push(this.serializeAssetAmount(op.amount));
    buffers.push(this.serializeVestingPolicyInitializer(op.policy));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize vesting_balance_withdraw operation (op 33)
   * { fee, vesting_balance, owner, amount }
   */
  serializeVestingBalanceWithdrawOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.vesting_balance));
    buffers.push(this.serializeObjectId(op.owner));
    buffers.push(this.serializeAssetAmount(op.amount));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize worker_create operation (op 34)
   * { fee, owner, work_begin_date, work_end_date, daily_pay, name, url, initializer }
   */
  serializeWorkerCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner));
    buffers.push(this.serializeTimestamp(op.work_begin_date));
    buffers.push(this.serializeTimestamp(op.work_end_date));
    buffers.push(this.writeInt64LE(op.daily_pay || 0));
    buffers.push(this.serializeString(op.name || ''));
    buffers.push(this.serializeString(op.url || ''));
    buffers.push(this.serializeWorkerInitializer(op.initializer));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize custom operation (op 35)
   * { fee, payer, required_auths, id, data }
   */
  serializeCustomOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.payer));
    buffers.push(this.serializeSet(op.required_auths || [], id => this.serializeObjectId(id)));
    buffers.push(this.writeUint16LE(op.id || 0));
    buffers.push(this.serializeBytes(op.data));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize assert operation (op 36)
   * { fee, fee_paying_account, predicates, required_auths, extensions }
   */
  serializeAssertOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.fee_paying_account));
    // predicates: array of static_variant
    const predicates = op.predicates || [];
    buffers.push(this.encodeVarint(predicates.length));
    for (const pred of predicates) {
      const predType = pred.type || 0;
      buffers.push(this.encodeVarint(predType));
      if (predType === 0) {
        // account_name_eq_lit_predicate: account_id, name
        buffers.push(this.serializeObjectId(pred.account_id));
        buffers.push(this.serializeString(pred.name || ''));
      } else if (predType === 1) {
        // asset_symbol_eq_lit_predicate: asset_id, symbol
        buffers.push(this.serializeObjectId(pred.asset_id));
        buffers.push(this.serializeString(pred.symbol || ''));
      } else if (predType === 2) {
        // block_id_predicate: id (20 bytes)
        buffers.push(this.serializeFixedBytes(pred.id, 20));
      }
    }
    buffers.push(this.serializeSet(op.required_auths || [], id => this.serializeObjectId(id)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize balance_claim operation (op 37)
   * { fee, deposit_to_account, balance_to_claim, balance_owner_key, total_claimed }
   */
  serializeBalanceClaimOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.deposit_to_account));
    buffers.push(this.serializeObjectId(op.balance_to_claim));
    buffers.push(this.serializePublicKey(op.balance_owner_key));
    buffers.push(this.serializeAssetAmount(op.total_claimed));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize override_transfer operation (op 38)
   * { fee, issuer, from, to, amount, memo?, extensions }
   */
  serializeOverrideTransferOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.from));
    buffers.push(this.serializeObjectId(op.to));
    buffers.push(this.serializeAssetAmount(op.amount));
    if (op.memo) {
      buffers.push(new Uint8Array([1]));
      buffers.push(this.serializeMemo(op.memo));
    } else {
      buffers.push(new Uint8Array([0]));
    }
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize transfer_to_blind operation (op 39)
   * { fee, amount, from, blinding_factor, outputs }
   */
  serializeTransferToBlindOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeAssetAmount(op.amount));
    buffers.push(this.serializeObjectId(op.from));
    buffers.push(this.serializeFixedBytes(op.blinding_factor, 32));
    buffers.push(this.serializeArray(op.outputs || [], o => this.serializeBlindOutput(o)));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize blind_transfer operation (op 40)
   * { fee, inputs, outputs }
   */
  serializeBlindTransferOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeArray(op.inputs || [], i => this.serializeBlindInput(i)));
    buffers.push(this.serializeArray(op.outputs || [], o => this.serializeBlindOutput(o)));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize transfer_from_blind operation (op 41)
   * { fee, amount, to, blinding_factor, inputs }
   */
  serializeTransferFromBlindOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeAssetAmount(op.amount));
    buffers.push(this.serializeObjectId(op.to));
    buffers.push(this.serializeFixedBytes(op.blinding_factor, 32));
    buffers.push(this.serializeArray(op.inputs || [], i => this.serializeBlindInput(i)));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_settle_cancel operation (op 42) - virtual
   * { fee, settlement, account, amount, extensions }
   */
  serializeAssetSettleCancelOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.settlement));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeAssetAmount(op.amount));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_claim_fees operation (op 43)
   * { fee, issuer, amount_to_claim, extensions }
   */
  serializeAssetClaimFeesOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeAssetAmount(op.amount_to_claim));
    // extensions: optional claim_from_asset_id
    const ext = op.extensions || {};
    if (ext.claim_from_asset_id !== undefined) {
      buffers.push(this.encodeVarint(1));
      buffers.push(this.encodeVarint(0)); // index 0
      buffers.push(this.serializeObjectId(ext.claim_from_asset_id));
    } else {
      buffers.push(this.encodeVarint(0));
    }
    return this.concatBytes(buffers);
  }

  /**
   * Serialize fba_distribute operation (op 44) - virtual
   * { fee, account_id, fba_id, amount }
   */
  serializeFbaDistributeOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account_id));
    buffers.push(this.serializeObjectId(op.fba_id));
    buffers.push(this.writeInt64LE(op.amount || 0));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize bid_collateral operation (op 45)
   * { fee, bidder, additional_collateral, debt_covered, extensions }
   */
  serializeBidCollateralOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.bidder));
    buffers.push(this.serializeAssetAmount(op.additional_collateral));
    buffers.push(this.serializeAssetAmount(op.debt_covered));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize execute_bid operation (op 46) - virtual
   * { fee, bidder, debt, collateral }
   */
  serializeExecuteBidOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.bidder));
    buffers.push(this.serializeAssetAmount(op.debt));
    buffers.push(this.serializeAssetAmount(op.collateral));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_claim_pool operation (op 47)
   * { fee, issuer, asset_id, amount_to_claim, extensions }
   */
  serializeAssetClaimPoolOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.asset_id));
    buffers.push(this.serializeAssetAmount(op.amount_to_claim));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset_update_issuer operation (op 48)
   * { fee, issuer, asset_to_update, new_issuer, extensions }
   */
  serializeAssetUpdateIssuerOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.issuer));
    buffers.push(this.serializeObjectId(op.asset_to_update));
    buffers.push(this.serializeObjectId(op.new_issuer));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize htlc_create operation (op 49)
   * { fee, from, to, amount, preimage_hash, preimage_size, claim_period_seconds, extensions }
   */
  serializeHtlcCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.from));
    buffers.push(this.serializeObjectId(op.to));
    buffers.push(this.serializeAssetAmount(op.amount));
    // preimage_hash: static_variant [bytes(20), bytes(20), bytes(32)]
    // Usually represented as [hash_type, hash_hex_string]
    const preimageHash = op.preimage_hash;
    if (Array.isArray(preimageHash)) {
      const [hashType, hashData] = preimageHash;
      buffers.push(this.encodeVarint(hashType || 0));
      const hashSize = hashType === 2 ? 32 : 20;
      buffers.push(this.serializeFixedBytes(hashData, hashSize));
    } else if (typeof preimageHash === 'object' && preimageHash !== null) {
      const hashType = preimageHash.type || 0;
      buffers.push(this.encodeVarint(hashType));
      const hashSize = hashType === 2 ? 32 : 20;
      buffers.push(this.serializeFixedBytes(preimageHash.hash || preimageHash.data, hashSize));
    } else {
      buffers.push(this.encodeVarint(0));
      buffers.push(new Uint8Array(20));
    }
    buffers.push(this.writeUint16LE(op.preimage_size || 0));
    buffers.push(this.writeUint32LE(op.claim_period_seconds || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize htlc_redeem operation (op 50)
   * { fee, htlc_id, redeemer, preimage, extensions }
   */
  serializeHtlcRedeemOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.htlc_id));
    buffers.push(this.serializeObjectId(op.redeemer));
    buffers.push(this.serializeBytes(op.preimage));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize htlc_redeemed operation (op 51) - virtual
   * { fee, htlc_id, from, to, amount }
   */
  serializeHtlcRedeemedOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.htlc_id));
    buffers.push(this.serializeObjectId(op.from));
    buffers.push(this.serializeObjectId(op.to));
    buffers.push(this.serializeAssetAmount(op.amount));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize htlc_extend operation (op 52)
   * { fee, htlc_id, update_issuer, seconds_to_add, extensions }
   */
  serializeHtlcExtendOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.htlc_id));
    buffers.push(this.serializeObjectId(op.update_issuer));
    buffers.push(this.writeUint32LE(op.seconds_to_add || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize htlc_refund operation (op 53) - virtual
   * { fee, htlc_id, to }
   */
  serializeHtlcRefundOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.htlc_id));
    buffers.push(this.serializeObjectId(op.to));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize custom_authority_create operation (op 54)
   * { fee, account, enabled, valid_from, valid_to, operation_type, auth, restrictions, extensions }
   */
  serializeCustomAuthorityCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(new Uint8Array([op.enabled ? 1 : 0]));
    buffers.push(this.serializeTimestamp(op.valid_from));
    buffers.push(this.serializeTimestamp(op.valid_to));
    buffers.push(this.encodeVarint(op.operation_type || 0));
    buffers.push(this.serializeAuthority(op.auth));
    buffers.push(this.serializeArray(op.restrictions || [], r => this.serializeRestriction(r)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize custom_authority_update operation (op 55)
   * { fee, account, authority_to_update, new_enabled?, new_valid_from?, new_valid_to?,
   *   new_auth?, restrictions_to_remove, restrictions_to_add, extensions }
   */
  serializeCustomAuthorityUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.authority_to_update));
    buffers.push(this.serializeOptional(op.new_enabled, v => new Uint8Array([v ? 1 : 0])));
    buffers.push(this.serializeOptional(op.new_valid_from, v => this.serializeTimestamp(v)));
    buffers.push(this.serializeOptional(op.new_valid_to, v => this.serializeTimestamp(v)));
    buffers.push(this.serializeOptional(op.new_auth, v => this.serializeAuthority(v)));
    buffers.push(this.serializeSet(op.restrictions_to_remove || [], v => this.writeUint16LE(v)));
    buffers.push(this.serializeArray(op.restrictions_to_add || [], r => this.serializeRestriction(r)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize custom_authority_delete operation (op 56)
   * { fee, account, authority_to_delete, extensions }
   */
  serializeCustomAuthorityDeleteOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.authority_to_delete));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize ticket_create operation (op 57)
   * { fee, account, target_type, amount, extensions }
   */
  serializeTicketCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.encodeVarint(op.target_type || 0));
    buffers.push(this.serializeAssetAmount(op.amount));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize ticket_update operation (op 58)
   * { fee, ticket, account, target_type, amount_for_new_target?, extensions }
   */
  serializeTicketUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.ticket));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.encodeVarint(op.target_type || 0));
    buffers.push(this.serializeOptional(op.amount_for_new_target, v => this.serializeAssetAmount(v)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize liquidity_pool_create operation (op 59)
   * { fee, account, asset_a, asset_b, share_asset, taker_fee_percent, withdrawal_fee_percent, extensions }
   */
  serializeLiquidityPoolCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.asset_a));
    buffers.push(this.serializeObjectId(op.asset_b));
    buffers.push(this.serializeObjectId(op.share_asset));
    buffers.push(this.writeUint16LE(op.taker_fee_percent || 0));
    buffers.push(this.writeUint16LE(op.withdrawal_fee_percent || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize liquidity_pool_delete operation (op 60)
   * { fee, account, pool, extensions }
   */
  serializeLiquidityPoolDeleteOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.pool));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize liquidity_pool_deposit operation (op 61)
   * { fee, account, pool, amount_a, amount_b, extensions }
   */
  serializeLiquidityPoolDepositOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.pool));
    buffers.push(this.serializeAssetAmount(op.amount_a));
    buffers.push(this.serializeAssetAmount(op.amount_b));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize liquidity_pool_withdraw operation (op 62)
   * { fee, account, pool, share_amount, extensions }
   */
  serializeLiquidityPoolWithdrawOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.pool));
    buffers.push(this.serializeAssetAmount(op.share_amount));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize samet_fund_create operation (op 64)
   * { fee, owner_account, asset_type, balance, fee_rate, extensions }
   */
  serializeSametFundCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner_account));
    buffers.push(this.serializeObjectId(op.asset_type));
    buffers.push(this.writeInt64LE(op.balance || 0));
    buffers.push(this.writeUint32LE(op.fee_rate || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize samet_fund_delete operation (op 65)
   * { fee, owner_account, fund_id, extensions }
   */
  serializeSametFundDeleteOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner_account));
    buffers.push(this.serializeObjectId(op.fund_id));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize samet_fund_update operation (op 66)
   * { fee, owner_account, fund_id, delta_amount?, new_fee_rate?, extensions }
   */
  serializeSametFundUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner_account));
    buffers.push(this.serializeObjectId(op.fund_id));
    buffers.push(this.serializeOptional(op.delta_amount, v => this.serializeAssetAmount(v)));
    buffers.push(this.serializeOptional(op.new_fee_rate, v => this.writeUint32LE(v)));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize samet_fund_borrow operation (op 67)
   * { fee, borrower, fund_id, borrow_amount, extensions }
   */
  serializeSametFundBorrowOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.borrower));
    buffers.push(this.serializeObjectId(op.fund_id));
    buffers.push(this.serializeAssetAmount(op.borrow_amount));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize samet_fund_repay operation (op 68)
   * { fee, account, fund_id, repay_amount, fund_fee, extensions }
   */
  serializeSametFundRepayOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.fund_id));
    buffers.push(this.serializeAssetAmount(op.repay_amount));
    buffers.push(this.serializeAssetAmount(op.fund_fee));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize credit_offer_create operation (op 69)
   * { fee, owner_account, asset_type, balance, fee_rate, max_duration_seconds,
   *   min_deal_amount, enabled, auto_disable_time, acceptable_collateral,
   *   acceptable_borrowers, extensions }
   */
  serializeCreditOfferCreateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner_account));
    buffers.push(this.serializeObjectId(op.asset_type));
    buffers.push(this.writeInt64LE(op.balance || 0));
    buffers.push(this.writeUint32LE(op.fee_rate || 0));
    buffers.push(this.writeUint32LE(op.max_duration_seconds || 0));
    buffers.push(this.writeInt64LE(op.min_deal_amount || 0));
    buffers.push(new Uint8Array([op.enabled ? 1 : 0]));
    buffers.push(this.serializeTimestamp(op.auto_disable_time));
    // acceptable_collateral: map(asset_id, price)
    const collateral = op.acceptable_collateral || {};
    const collateralEntries = Array.isArray(collateral) ? collateral : Object.entries(collateral);
    buffers.push(this.encodeVarint(collateralEntries.length));
    for (const [assetId, price] of collateralEntries) {
      buffers.push(this.serializeObjectId(assetId));
      buffers.push(this.serializePrice(price));
    }
    // acceptable_borrowers: map(account_id, int64)
    const borrowers = op.acceptable_borrowers || {};
    const borrowerEntries = Array.isArray(borrowers) ? borrowers : Object.entries(borrowers);
    buffers.push(this.encodeVarint(borrowerEntries.length));
    for (const [accountId, minBalance] of borrowerEntries) {
      buffers.push(this.serializeObjectId(accountId));
      buffers.push(this.writeInt64LE(minBalance || 0));
    }
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize credit_offer_delete operation (op 70)
   * { fee, owner_account, offer_id, extensions }
   */
  serializeCreditOfferDeleteOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner_account));
    buffers.push(this.serializeObjectId(op.offer_id));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize credit_offer_update operation (op 71)
   * { fee, owner_account, offer_id, delta_amount?, fee_rate?, max_duration_seconds?,
   *   min_deal_amount?, enabled?, auto_disable_time?, acceptable_collateral?,
   *   acceptable_borrowers?, extensions }
   */
  serializeCreditOfferUpdateOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.owner_account));
    buffers.push(this.serializeObjectId(op.offer_id));
    buffers.push(this.serializeOptional(op.delta_amount, v => this.serializeAssetAmount(v)));
    buffers.push(this.serializeOptional(op.fee_rate, v => this.writeUint32LE(v)));
    buffers.push(this.serializeOptional(op.max_duration_seconds, v => this.writeUint32LE(v)));
    buffers.push(this.serializeOptional(op.min_deal_amount, v => this.writeInt64LE(v)));
    buffers.push(this.serializeOptional(op.enabled, v => new Uint8Array([v ? 1 : 0])));
    buffers.push(this.serializeOptional(op.auto_disable_time, v => this.serializeTimestamp(v)));
    // optional map(asset_id, price)
    if (op.acceptable_collateral !== undefined && op.acceptable_collateral !== null) {
      buffers.push(new Uint8Array([1]));
      const entries = Array.isArray(op.acceptable_collateral)
        ? op.acceptable_collateral
        : Object.entries(op.acceptable_collateral);
      buffers.push(this.encodeVarint(entries.length));
      for (const [assetId, price] of entries) {
        buffers.push(this.serializeObjectId(assetId));
        buffers.push(this.serializePrice(price));
      }
    } else {
      buffers.push(new Uint8Array([0]));
    }
    // optional map(account_id, int64)
    if (op.acceptable_borrowers !== undefined && op.acceptable_borrowers !== null) {
      buffers.push(new Uint8Array([1]));
      const entries = Array.isArray(op.acceptable_borrowers)
        ? op.acceptable_borrowers
        : Object.entries(op.acceptable_borrowers);
      buffers.push(this.encodeVarint(entries.length));
      for (const [accountId, minBalance] of entries) {
        buffers.push(this.serializeObjectId(accountId));
        buffers.push(this.writeInt64LE(minBalance || 0));
      }
    } else {
      buffers.push(new Uint8Array([0]));
    }
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize credit_offer_accept operation (op 72)
   * { fee, borrower, offer_id, borrow_amount, collateral, max_fee_rate, min_duration_seconds, extensions }
   */
  serializeCreditOfferAcceptOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.borrower));
    buffers.push(this.serializeObjectId(op.offer_id));
    buffers.push(this.serializeAssetAmount(op.borrow_amount));
    buffers.push(this.serializeAssetAmount(op.collateral));
    buffers.push(this.writeUint32LE(op.max_fee_rate || 0));
    buffers.push(this.writeUint32LE(op.min_duration_seconds || 0));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize credit_deal_repay operation (op 73)
   * { fee, account, deal_id, repay_amount, credit_fee, extensions }
   */
  serializeCreditDealRepayOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.account));
    buffers.push(this.serializeObjectId(op.deal_id));
    buffers.push(this.serializeAssetAmount(op.repay_amount));
    buffers.push(this.serializeAssetAmount(op.credit_fee));
    buffers.push(this.encodeVarint(0)); // extensions
    return this.concatBytes(buffers);
  }

  /**
   * Serialize credit_deal_expired operation (op 74) - virtual
   * { fee, deal_id, offer_id, offer_owner, borrower, unpaid_amount, collateral, fee_rate }
   */
  serializeCreditDealExpiredOp(op) {
    const buffers = [];
    buffers.push(this.serializeAssetAmount(op.fee));
    buffers.push(this.serializeObjectId(op.deal_id));
    buffers.push(this.serializeObjectId(op.offer_id));
    buffers.push(this.serializeObjectId(op.offer_owner));
    buffers.push(this.serializeObjectId(op.borrower));
    buffers.push(this.serializeAssetAmount(op.unpaid_amount));
    buffers.push(this.serializeAssetAmount(op.collateral));
    buffers.push(this.writeUint32LE(op.fee_rate || 0));
    return this.concatBytes(buffers);
  }

  /**
   * Serialize asset amount {amount, asset_id}
   */
  serializeAssetAmount(assetAmount) {
    const buffers = [];

    // amount (int64)
    buffers.push(this.writeInt64LE(assetAmount.amount));

    // asset_id
    buffers.push(this.serializeObjectId(assetAmount.asset_id));

    return this.concatBytes(buffers);
  }

  /**
   * Serialize object ID (e.g., "1.2.123" -> varint)
   */
  serializeObjectId(objectId) {
    // Object ID format: "type.space.instance"
    const parts = objectId.split('.');
    const instance = parseInt(parts[2], 10);
    return this.encodeVarint(instance);
  }

  /**
   * Serialize memo object
   */
  serializeMemo(memo) {
    const buffers = [];

    // Always serialize the full memo_data structure (from, to, nonce, message).
    // The node's FC deserializer fills missing JSON fields with defaults
    // (null pubkey / zero nonce), so our serializer must match.

    // from public key (33 bytes — null key if absent)
    if (memo.from) {
      buffers.push(this.serializePublicKey(memo.from));
    } else {
      buffers.push(new Uint8Array(33));
    }

    // to public key (33 bytes — null key if absent)
    if (memo.to) {
      buffers.push(this.serializePublicKey(memo.to));
    } else {
      buffers.push(new Uint8Array(33));
    }

    // nonce (uint64 LE — 0 if absent)
    buffers.push(this.writeInt64LE(memo.nonce || '0'));

    // message (hex-encoded bytes with varint length prefix)
    // After _resolveOperationIds, memo.message is always lowercase hex.
    if (memo.message) {
      const msgBytes = hexToBytes(memo.message);
      buffers.push(this.encodeVarint(msgBytes.length));
      buffers.push(msgBytes);
    } else {
      buffers.push(this.encodeVarint(0));
    }

    return this.concatBytes(buffers);
  }

  /**
   * Serialize public key
   */
  serializePublicKey(publicKey) {
    // Remove 'BTS' prefix and decode
    if (publicKey.startsWith('BTS')) {
      publicKey = publicKey.substring(3);
    }
    // Base58 decode and return 33 bytes
    const decoded = this.base58Decode(publicKey);
    // Remove checksum (last 4 bytes)
    return decoded.slice(0, 33);
  }

  /**
   * Base58 decode
   */
  base58Decode(str) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    if (str.length === 0) return new Uint8Array(0);

    const bytes = [0];

    for (let i = 0; i < str.length; i++) {
      const value = ALPHABET.indexOf(str[i]);
      if (value === -1) throw new Error('Invalid Base58 character');

      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }

      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    for (let i = 0; i < str.length && str[i] === ALPHABET[0]; i++) {
      bytes.push(0);
    }

    return new Uint8Array(bytes.reverse());
  }

  /**
   * Encode integer as varint
   */
  encodeVarint(value) {
    const bytes = [];
    while (value > 127) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(value);
    return new Uint8Array(bytes);
  }

  /**
   * Get operation ID from type name
   */
  getOperationId(operationType) {
    const operations = {
      'transfer': 0,
      'limit_order_create': 1,
      'limit_order_cancel': 2,
      'call_order_update': 3,
      'fill_order': 4,
      'account_create': 5,
      'account_update': 6,
      'account_whitelist': 7,
      'account_upgrade': 8,
      'account_transfer': 9,
      'asset_create': 10,
      'asset_update': 11,
      'asset_update_bitasset': 12,
      'asset_update_feed_producers': 13,
      'asset_issue': 14,
      'asset_reserve': 15,
      'asset_fund_fee_pool': 16,
      'asset_settle': 17,
      'asset_global_settle': 18,
      'asset_publish_feed': 19,
      'witness_create': 20,
      'witness_update': 21,
      'proposal_create': 22,
      'proposal_update': 23,
      'proposal_delete': 24,
      'withdraw_permission_create': 25,
      'withdraw_permission_update': 26,
      'withdraw_permission_claim': 27,
      'withdraw_permission_delete': 28,
      'committee_member_create': 29,
      'committee_member_update': 30,
      'committee_member_update_global_parameters': 31,
      'vesting_balance_create': 32,
      'vesting_balance_withdraw': 33,
      'worker_create': 34,
      'custom': 35,
      'assert': 36,
      'balance_claim': 37,
      'override_transfer': 38,
      'transfer_to_blind': 39,
      'blind_transfer': 40,
      'transfer_from_blind': 41,
      'asset_settle_cancel': 42,
      'asset_claim_fees': 43,
      'fba_distribute': 44,
      'bid_collateral': 45,
      'execute_bid': 46,
      'asset_claim_pool': 47,
      'asset_update_issuer': 48,
      'htlc_create': 49,
      'htlc_redeem': 50,
      'htlc_redeemed': 51,
      'htlc_extend': 52,
      'htlc_refund': 53,
      'custom_authority_create': 54,
      'custom_authority_update': 55,
      'custom_authority_delete': 56,
      'ticket_create': 57,
      'ticket_update': 58,
      'liquidity_pool_create': 59,
      'liquidity_pool_delete': 60,
      'liquidity_pool_deposit': 61,
      'liquidity_pool_withdraw': 62,
      'liquidity_pool_exchange': 63,
      'samet_fund_create': 64,
      'samet_fund_delete': 65,
      'samet_fund_update': 66,
      'samet_fund_borrow': 67,
      'samet_fund_repay': 68,
      'credit_offer_create': 69,
      'credit_offer_delete': 70,
      'credit_offer_update': 71,
      'credit_offer_accept': 72,
      'credit_deal_repay': 73,
      'credit_deal_expired': 74
    };

    return operations[operationType] ?? 0;
  }

  // === Market Methods ===

  /**
   * Get order book
   */
  async getOrderBook(baseAsset, quoteAsset, limit = 50) {
    try {
      const orderBook = await this.call(
        this.apiIds.database,
        'get_order_book',
        [baseAsset, quoteAsset, limit]
      );
      return orderBook;
    } catch (error) {
      console.error('Get order book error:', error);
      return { bids: [], asks: [] };
    }
  }

  /**
   * Get market ticker
   */
  async getTicker(baseAsset, quoteAsset) {
    try {
      const ticker = await this.call(
        this.apiIds.database,
        'get_ticker',
        [baseAsset, quoteAsset]
      );
      return ticker;
    } catch (error) {
      console.error('Get ticker error:', error);
      throw error;
    }
  }

  /**
   * Get 24h market volume
   */
  async get24Volume(baseAsset, quoteAsset) {
    try {
      const volume = await this.call(
        this.apiIds.database,
        'get_24_volume',
        [baseAsset, quoteAsset]
      );
      return volume;
    } catch (error) {
      console.error('Get 24h volume error:', error);
      throw error;
    }
  }

  // === Subscription Methods ===

  /**
   * Subscribe to account changes
   */
  async subscribeToAccount(accountId, callback) {
    try {
      await this.call(
        this.apiIds.database,
        'set_subscribe_callback',
        [this.callId, false]
      );
      
      // Register callback for this subscription
      this.subscriptionCallbacks = this.subscriptionCallbacks || new Map();
      this.subscriptionCallbacks.set(accountId, callback);
      
      return true;
    } catch (error) {
      console.error('Subscribe to account error:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from all
   */
  async unsubscribeAll() {
    try {
      await this.call(
        this.apiIds.database,
        'cancel_all_subscriptions',
        []
      );
      this.subscriptionCallbacks?.clear();
      return true;
    } catch (error) {
      console.error('Unsubscribe error:', error);
      return false;
    }
  }
}
