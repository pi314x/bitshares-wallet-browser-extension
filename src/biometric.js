import { bytesToBase64, base64ToBytes } from './lib/crypto-utils.js';

const WEBAUTHN_TIMEOUT = 60000;
const STORAGE_KEY_BIO_CREDENTIAL_ID = 'biometricCredentialId';
const STORAGE_KEY_BIO_ENCRYPTED_PASSWORD = 'biometricEncryptedPassword';
const STORAGE_KEY_BIO_PRF_SALT = 'biometricPrfSalt';
const STORAGE_KEY_BIO_ENABLED = 'biometricEnabled';
const STORAGE_KEY_BIO_RESULT = 'biometricResult';
const STORAGE_SESSION_BIO_PENDING = 'biometricPending';
const STORAGE_SESSION_BIO_DECRYPTED = 'biometricDecryptedPassword';

// HKDF domain-separation label. Bump the suffix if the derivation ever changes
// so old ciphertext can be detected rather than silently mis-decrypted.
const PRF_KDF_INFO = 'bitshares-wallet-biometric-v1';

async function main() {
  try {
    const result = await chrome.storage.session.get([STORAGE_SESSION_BIO_PENDING]);

    if (!result.biometricPending) {
      document.getElementById('title').textContent = 'No pending request';
      document.getElementById('status').textContent = 'No biometric request was found. You can close this tab.';
      document.getElementById('spinner').style.display = 'none';
      return;
    }

    const { mode, password } = result.biometricPending;

    if (mode === 'register') {
      await handleRegister(password);
    } else if (mode === 'auth') {
      await handleAuth();
    } else {
      throw new Error('Unknown biometric mode: ' + mode);
    }
  } catch (error) {
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('title').textContent = 'Failed';
    document.getElementById('title').className = 'error';
    document.getElementById('status').textContent = error.message;
    await chrome.storage.session.remove([STORAGE_SESSION_BIO_PENDING]);
    await chrome.storage.local.set({ biometricResult: { success: false, error: error.message } });
  }
}

async function handleRegister(password) {
  const challenge = crypto.getRandomValues(new Uint8Array(64));

  const existing = await chrome.storage.local.get([STORAGE_KEY_BIO_CREDENTIAL_ID]);
  let excludeCredentials = [];
  if (existing.biometricCredentialId && existing.biometricCredentialId.length > 0) {
    excludeCredentials.push({
      id: new Uint8Array(existing.biometricCredentialId),
      type: 'public-key'
    });
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'BitShares Wallet', id: chrome.runtime.id },
      user: {
        id: crypto.getRandomValues(new Uint8Array(64)),
        name: 'bitshares-wallet@extension',
        displayName: 'BitShares Wallet'
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
      ],
      authenticatorSelection: {
        // The authenticator MUST verify the user (biometric / PIN). Without user
        // verification the PRF secret can be produced by mere possession of the
        // device, which is not the protection this feature promises.
        userVerification: 'required',
        residentKey: 'preferred'
      },
      excludeCredentials: excludeCredentials.length > 0 ? excludeCredentials : undefined,
      // Request the PRF extension so the authenticator can derive a stable,
      // high-entropy secret that never leaves it. This secret — not any value in
      // storage — is what encrypts the wallet password.
      extensions: { prf: {} },
      timeout: WEBAUTHN_TIMEOUT
    }
  });

  if (!credential) throw new Error('Biometric registration was cancelled');

  // PRF is mandatory. If the authenticator/browser cannot provide it we refuse
  // to enable biometric unlock rather than fall back to storing a decryptable
  // key on disk (which would make the biometric a cosmetic gate, not real
  // protection). Chrome platform authenticators (Touch ID / Windows Hello)
  // support PRF; older/unsupported ones land here.
  const regExt = credential.getClientExtensionResults?.() || {};
  if (!regExt.prf || regExt.prf.enabled !== true) {
    throw new Error(
      'This device or browser does not support the WebAuthn PRF extension, which is required to protect your wallet password with biometrics. Biometric unlock was NOT enabled.'
    );
  }

  const credentialId = Array.from(new Uint8Array(credential.rawId));

  // Non-secret per-enrollment salt for the PRF evaluation. Stored in the clear;
  // it does not weaken anything because the PRF output also depends on the
  // authenticator-held secret.
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  // Actually evaluate the PRF (a second user-verification prompt during setup).
  // Many authenticators only return PRF results from get(), not create().
  const prfOutput = await evaluatePrf(new Uint8Array(credentialId), prfSalt);
  const encryptionKey = await deriveAesKeyFromPrf(prfOutput);
  prfOutput.fill(0);
  const encryptedPassword = await encryptPassword(password, encryptionKey);

  await chrome.storage.local.set({
    [STORAGE_KEY_BIO_CREDENTIAL_ID]: credentialId,
    [STORAGE_KEY_BIO_ENCRYPTED_PASSWORD]: encryptedPassword,
    [STORAGE_KEY_BIO_PRF_SALT]: bytesToBase64(prfSalt),
    [STORAGE_KEY_BIO_ENABLED]: true,
    [STORAGE_KEY_BIO_RESULT]: { success: true }
  });
  // Purge any legacy plaintext key from the pre-PRF scheme so an upgraded
  // install can never be unlocked via the old, insecure path.
  await chrome.storage.local.remove(['biometricEncryptionKey']);

  await chrome.storage.session.remove([STORAGE_SESSION_BIO_PENDING]);

  document.getElementById('spinner').style.display = 'none';
  document.getElementById('title').textContent = 'Success!';
  document.getElementById('status').textContent = 'Biometric unlock has been enabled. You can close this tab.';

  setTimeout(() => window.close(), 2000);
}

async function handleAuth() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_BIO_CREDENTIAL_ID,
    STORAGE_KEY_BIO_ENCRYPTED_PASSWORD,
    STORAGE_KEY_BIO_PRF_SALT
  ]);

  if (!stored.biometricCredentialId || !stored.biometricEncryptedPassword || !stored.biometricPrfSalt) {
    // A wallet enrolled under the old (pre-PRF) scheme has no PRF salt. Do not
    // attempt the insecure fallback — ask the user to re-enable so the password
    // gets re-protected by the authenticator.
    throw new Error('Biometric authentication needs to be re-enabled in Settings after this security update.');
  }

  const credentialId = new Uint8Array(stored.biometricCredentialId);
  const prfSalt = base64ToBytes(stored.biometricPrfSalt);

  // This get() is the biometric prompt AND the source of the decryption key.
  // Its result is load-bearing: without a successful user-verified assertion the
  // PRF secret is never produced, so the password cannot be decrypted.
  let prfOutput;
  try {
    prfOutput = await evaluatePrf(credentialId, prfSalt);
  } catch (webauthnErr) {
    throw new Error('WebAuthn error: ' + webauthnErr.message);
  }

  const encryptionKey = await deriveAesKeyFromPrf(prfOutput);
  prfOutput.fill(0);

  let password;
  try {
    password = await decryptPassword(stored.biometricEncryptedPassword, encryptionKey);
  } catch (decryptErr) {
    throw new Error('Password decryption failed (stored data may be corrupted): ' + decryptErr.message);
  }

  await chrome.storage.session.set({ biometricDecryptedPassword: password });
  await chrome.storage.session.remove([STORAGE_SESSION_BIO_PENDING]);
  await chrome.storage.local.set({ biometricResult: { success: true } });

  document.getElementById('spinner').style.display = 'none';
  document.getElementById('title').textContent = 'Success!';
  document.getElementById('status').textContent = 'Authentication successful. You can close this tab.';

  setTimeout(() => window.close(), 2000);
}

/**
 * Prompt the authenticator and evaluate the PRF extension for the given
 * credential + salt. Returns the raw PRF output (>=32 bytes of secret that only
 * this authenticator can reproduce). Throws if the user cancels or the
 * authenticator does not return a PRF result.
 */
async function evaluatePrf(credentialId, salt) {
  const challenge = crypto.getRandomValues(new Uint8Array(64));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: chrome.runtime.id,
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt } } },
      timeout: WEBAUTHN_TIMEOUT
    }
  });

  if (!assertion) throw new Error('Biometric authentication was cancelled');

  const ext = assertion.getClientExtensionResults?.() || {};
  const first = ext.prf && ext.prf.results && ext.prf.results.first;
  if (!first) {
    throw new Error('The authenticator did not return a PRF result, so the password cannot be protected with biometrics.');
  }
  return new Uint8Array(first);
}

/**
 * Derive a non-extractable AES-GCM key from the PRF output via HKDF-SHA256.
 * Returns a CryptoKey; the raw PRF bytes are never persisted.
 */
async function deriveAesKeyFromPrf(prfOutput) {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(PRF_KDF_INFO)
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptPassword(password, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(password);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptPassword(encryptedData, cryptoKey) {
  const iv = base64ToArrayBuffer(encryptedData.iv);
  const data = base64ToArrayBuffer(encryptedData.data);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  return new TextDecoder().decode(decrypted);
}

function base64ToArrayBuffer(base64) {
  return new Uint8Array(base64ToBytes(base64)).buffer;
}

document.addEventListener('DOMContentLoaded', () => {
  main().catch(console.error);
});
