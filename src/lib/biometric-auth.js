const STORAGE_KEY_CREDENTIAL_ID = 'biometricCredentialId';
const STORAGE_KEY_ENABLED = 'biometricEnabled';
const STORAGE_KEY_ENCRYPTED_PASSWORD = 'biometricEncryptedPassword';
const STORAGE_KEY_PRF_SALT = 'biometricPrfSalt';
// Legacy (pre-PRF) key: the raw AES key used to sit next to the ciphertext in
// local storage, which made the biometric a cosmetic gate. Kept here only so it
// can be purged from upgraded installs.
const STORAGE_KEY_LEGACY_ENCRYPTION_KEY = 'biometricEncryptionKey';
const STORAGE_KEY_RESULT = 'biometricResult';
const SESSION_KEY_PENDING = 'biometricPending';
const SESSION_KEY_DECRYPTED = 'biometricDecryptedPassword';

const BIOMETRIC_URL = 'src/biometric.html';

export let BIOMETRIC_POLL_INTERVAL = 300;
export let BIOMETRIC_POLL_TIMEOUT = 120000;

export function isBiometricSupported() {
  return typeof navigator !== 'undefined' &&
    navigator.credentials &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function' &&
    window.isSecureContext;
}

export async function isBiometricEnabled() {
  const result = await chrome.storage.local.get([STORAGE_KEY_ENABLED]);
  return !!result[STORAGE_KEY_ENABLED];
}

/**
 * One-time upgrade: an install enrolled under the old (pre-PRF) scheme stored a
 * decryptable AES key in local storage and no PRF salt. Such an enrollment can
 * no longer be unlocked (biometric.js requires the PRF salt), and the stored key
 * is a standing at-rest exposure, so wipe it and turn the toggle off. The user
 * re-enables under the secure PRF scheme. No-op for fresh/PRF enrollments.
 *
 * @returns {boolean} true if a legacy enrollment was migrated (cleared).
 */
export async function migrateLegacyBiometric() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_LEGACY_ENCRYPTION_KEY,
    STORAGE_KEY_PRF_SALT
  ]);
  const isLegacy = !!stored[STORAGE_KEY_LEGACY_ENCRYPTION_KEY] && !stored[STORAGE_KEY_PRF_SALT];
  if (!isLegacy) return false;
  await chrome.storage.local.remove([
    STORAGE_KEY_LEGACY_ENCRYPTION_KEY,
    STORAGE_KEY_ENCRYPTED_PASSWORD,
    STORAGE_KEY_ENABLED
  ]);
  return true;
}

function openBiometricTab() {
  const url = chrome.runtime.getURL(BIOMETRIC_URL);
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error('Failed to open biometric page: ' + chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

async function waitForResult() {
  const start = Date.now();
  while (Date.now() - start < BIOMETRIC_POLL_TIMEOUT) {
    const result = await chrome.storage.local.get([STORAGE_KEY_RESULT]);
    if (result[STORAGE_KEY_RESULT]) {
      await chrome.storage.local.remove([STORAGE_KEY_RESULT]);
      return result[STORAGE_KEY_RESULT];
    }
    await new Promise(r => setTimeout(r, BIOMETRIC_POLL_INTERVAL));
  }
  await chrome.storage.session.remove([SESSION_KEY_PENDING]);
  await chrome.storage.local.remove([STORAGE_KEY_RESULT]);
  throw new Error('Biometric authentication timed out');
}

export async function enableBiometric(password) {
  if (!isBiometricSupported()) {
    throw new Error('Biometric authentication is not supported in this browser. Please use Chrome.');
  }

  await chrome.storage.session.set({
    [SESSION_KEY_PENDING]: { mode: 'register', password }
  });

  try {
    await openBiometricTab();
    const result = await waitForResult();
    if (!result.success) {
      throw new Error(result.error || 'Biometric registration failed');
    }
  } catch (error) {
    await chrome.storage.session.remove([SESSION_KEY_PENDING]);
    throw error;
  }
}

export async function disableBiometric() {
  // Keep biometricCredentialId so re-enable reuses it via excludeCredentials
  // (prevents duplicate passkeys on the authenticator). Everything that could
  // decrypt the password — ciphertext, PRF salt, and any legacy plaintext key —
  // is removed.
  await chrome.storage.local.remove([
    STORAGE_KEY_ENCRYPTED_PASSWORD,
    STORAGE_KEY_PRF_SALT,
    STORAGE_KEY_LEGACY_ENCRYPTION_KEY,
    STORAGE_KEY_ENABLED
  ]);
}

export async function biometricUnlock() {
  if (!isBiometricSupported()) {
    throw new Error('Biometric authentication is not supported in this browser.');
  }

  const stored = await chrome.storage.local.get([
    STORAGE_KEY_CREDENTIAL_ID,
    STORAGE_KEY_ENCRYPTED_PASSWORD,
    STORAGE_KEY_PRF_SALT
  ]);

  if (!stored[STORAGE_KEY_CREDENTIAL_ID] ||
      !stored[STORAGE_KEY_ENCRYPTED_PASSWORD] ||
      !stored[STORAGE_KEY_PRF_SALT]) {
    // Missing PRF salt means either not configured or a stale legacy enrollment
    // that migrateLegacyBiometric() should have cleared.
    throw new Error('Biometric authentication is not configured');
  }

  await chrome.storage.session.set({
    [SESSION_KEY_PENDING]: { mode: 'auth' }
  });

  try {
    await openBiometricTab();
    const result = await waitForResult();
    if (!result.success) {
      throw new Error(result.error || 'Biometric authentication failed');
    }

    const session = await chrome.storage.session.get([SESSION_KEY_DECRYPTED]);
    const password = session[SESSION_KEY_DECRYPTED];
    if (!password) {
      throw new Error('Failed to retrieve decrypted password');
    }
    await chrome.storage.session.remove([SESSION_KEY_DECRYPTED]);
    return password;
  } catch (error) {
    await chrome.storage.session.remove([SESSION_KEY_PENDING]);
    throw error;
  }
}
