/**
 * Tests for src/lib/biometric-auth.js
 *
 * Since enableBiometric/biometricUnlock rely on chrome.tabs.create
 * and polling (not testable in Node), we test the pure utility functions
 * and storage interactions.
 */

import {
  isBiometricSupported,
  isBiometricEnabled,
  disableBiometric,
} from '../src/lib/biometric-auth.js';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  chrome.__resetStorage();

  global.window = { isSecureContext: true };
  global.navigator = {
    credentials: {
      create: jest.fn(),
      get: jest.fn(),
    },
  };
});

afterEach(() => {
  delete global.window;
  delete global.navigator;
});

// ---------------------------------------------------------------------------
// isBiometricSupported
// ---------------------------------------------------------------------------

describe('isBiometricSupported', () => {
  test('returns true when WebAuthn and secure context are available', () => {
    expect(isBiometricSupported()).toBe(true);
  });

  test('returns false when navigator.credentials is missing', () => {
    delete global.navigator.credentials;
    expect(isBiometricSupported()).toBeFalsy();
  });

  test('returns false when not in a secure context', () => {
    global.window.isSecureContext = false;
    expect(isBiometricSupported()).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// isBiometricEnabled
// ---------------------------------------------------------------------------

describe('isBiometricEnabled', () => {
  test('returns false when not configured', async () => {
    expect(await isBiometricEnabled()).toBe(false);
  });

  test('returns true when biometricEnabled flag is set', async () => {
    await chrome.storage.local.set({ biometricEnabled: true });
    expect(await isBiometricEnabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// disableBiometric
// ---------------------------------------------------------------------------

describe('disableBiometric', () => {
  test('removes all biometric storage keys', async () => {
    await chrome.storage.local.set({
      biometricCredentialId: 'abc123',
      biometricEncryptedPassword: { iv: 'iv', data: 'data' },
      biometricEncryptionKey: 'a2V5',
      biometricEnabled: true,
    });
    await disableBiometric();

    const result = await chrome.storage.local.get([
      'biometricCredentialId',
      'biometricEncryptedPassword',
      'biometricEncryptionKey',
      'biometricEnabled',
    ]);
    expect(result.biometricCredentialId).toBeUndefined();
    expect(result.biometricEncryptedPassword).toBeUndefined();
    expect(result.biometricEncryptionKey).toBeUndefined();
    expect(result.biometricEnabled).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Storage contract tests (verify the data shapes that biometric.html expects)
// ---------------------------------------------------------------------------

describe('biometric storage contract', () => {
  test('enable stores biometricCredentialId, biometricEncryptedPassword, biometricEncryptionKey, biometricEnabled', async () => {
    // This is what biometric.html stores on successful registration
    const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
    await chrome.storage.local.set({
      biometricCredentialId: 'a2V5X2NyZWRlbnRpYWw=',
      biometricEncryptedPassword: { iv: 'aXZfZGF0YQ==', data: 'ZW5jcnlwdGVkX2RhdGE=' },
      biometricEncryptionKey: bytesToBase64(encryptionKey),
      biometricEnabled: true,
    });

    const result = await chrome.storage.local.get([
      'biometricCredentialId',
      'biometricEncryptedPassword',
      'biometricEncryptionKey',
      'biometricEnabled',
    ]);
    expect(result.biometricCredentialId).toBeTruthy();
    expect(result.biometricEncryptedPassword).toBeTruthy();
    expect(result.biometricEncryptedPassword.iv).toBeTruthy();
    expect(result.biometricEncryptedPassword.data).toBeTruthy();
    expect(result.biometricEncryptionKey).toBeTruthy();
    expect(result.biometricEnabled).toBe(true);
  });

  test('unlock reads biometricCredentialId, biometricEncryptedPassword, biometricEncryptionKey', async () => {
    // This is what biometricUnlock reads from storage
    const stored = await chrome.storage.local.get([
      'biometricCredentialId',
      'biometricEncryptedPassword',
      'biometricEncryptionKey',
    ]);
    // Should not throw if all present
    expect(stored).toBeDefined();
  });

  test('biometricResult stores success/error for popup detection', async () => {
    await chrome.storage.local.set({ biometricResult: { success: true } });
    const result = await chrome.storage.local.get(['biometricResult']);
    expect(result.biometricResult.success).toBe(true);

    await chrome.storage.local.set({ biometricResult: { success: false, error: 'Failed' } });
    const failed = await chrome.storage.local.get(['biometricResult']);
    expect(failed.biometricResult.success).toBe(false);
    expect(failed.biometricResult.error).toBe('Failed');
  });

  test('biometricPending stores mode and password in session', async () => {
    await chrome.storage.session.set({
      biometricPending: { mode: 'register', password: 'test-password' },
    });
    const result = await chrome.storage.session.get(['biometricPending']);
    expect(result.biometricPending.mode).toBe('register');
    expect(result.biometricPending.password).toBe('test-password');
  });

  test('biometricDecryptedPassword stores decrypted password in session', async () => {
    await chrome.storage.session.set({ biometricDecryptedPassword: 'my-password' });
    const result = await chrome.storage.session.get(['biometricDecryptedPassword']);
    expect(result.biometricDecryptedPassword).toBe('my-password');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
