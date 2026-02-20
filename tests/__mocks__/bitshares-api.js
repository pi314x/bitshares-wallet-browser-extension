/**
 * Mock for BitSharesAPI - used by wallet-manager.js
 * Prevents actual network connections during tests
 */
export class BitSharesAPI {
  constructor() {}

  async connect() {
    return Promise.resolve();
  }

  async getAccountsByKey(publicKey) {
    return [];
  }

  async getAccount(accountName) {
    return null;
  }

  async getAsset(assetId) {
    return { precision: 5 };
  }

  async broadcastTransaction(type, operation, privateKey) {
    return { id: 'mock-tx-id' };
  }

  async signTransaction(transaction, privateKey) {
    return { ...transaction, signatures: ['mock-signature'] };
  }
}
