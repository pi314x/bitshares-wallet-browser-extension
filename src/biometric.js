import { bytesToBase64, base64ToBytes } from './lib/crypto-utils.js';

const WEBAUTHN_TIMEOUT = 60000;

async function main() {
  try {
    const result = await chrome.storage.session.get(['biometricPending']);

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
    await chrome.storage.session.remove(['biometricPending']);
    await chrome.storage.local.set({ biometricResult: { success: false, error: error.message } });
  }
}

async function handleRegister(password) {
  const challenge = crypto.getRandomValues(new Uint8Array(64));

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
        { alg: -7, type: 'public-key' }
      ],
      authenticatorSelection: {
        userVerification: 'preferred'
      },
      timeout: WEBAUTHN_TIMEOUT
    }
  });

  if (!credential) throw new Error('Biometric registration was cancelled');

  const credentialId = bytesToBase64(new Uint8Array(credential.rawId));
  const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
  const encryptedPassword = await encryptPassword(password, encryptionKey);

  await chrome.storage.local.set({
    biometricCredentialId: credentialId,
    biometricEncryptedPassword: encryptedPassword,
    biometricEncryptionKey: bytesToBase64(encryptionKey),
    biometricEnabled: true,
    biometricResult: { success: true }
  });

  await chrome.storage.session.remove(['biometricPending']);

  document.getElementById('spinner').style.display = 'none';
  document.getElementById('title').textContent = 'Success!';
  document.getElementById('status').textContent = 'Biometric unlock has been enabled. You can close this tab.';

  setTimeout(() => window.close(), 2000);
}

async function handleAuth() {
  const stored = await chrome.storage.local.get([
    'biometricCredentialId',
    'biometricEncryptedPassword',
    'biometricEncryptionKey'
  ]);

  if (!stored.biometricCredentialId || !stored.biometricEncryptedPassword || !stored.biometricEncryptionKey) {
    throw new Error('Biometric authentication is not configured');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(64));

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: chrome.runtime.id,
      allowCredentials: [{
        id: base64ToArrayBuffer(stored.biometricCredentialId),
        type: 'public-key'
      }],
      userVerification: 'preferred',
      timeout: WEBAUTHN_TIMEOUT
    }
  });

  if (!assertion) throw new Error('Biometric authentication was cancelled');

  const encryptionKey = base64ToBytes(stored.biometricEncryptionKey);
  const password = await decryptPassword(stored.biometricEncryptedPassword, new Uint8Array(encryptionKey));

  await chrome.storage.session.set({ biometricDecryptedPassword: password });
  await chrome.storage.session.remove(['biometricPending']);
  await chrome.storage.local.set({ biometricResult: { success: true } });

  document.getElementById('spinner').style.display = 'none';
  document.getElementById('title').textContent = 'Success!';
  document.getElementById('status').textContent = 'Authentication successful. You can close this tab.';

  setTimeout(() => window.close(), 2000);
}

async function encryptPassword(password, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encoded = new TextEncoder().encode(password);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
  return { iv: bytesToBase64(iv), data: bytesToBase64(encrypted) };
}

async function decryptPassword(encryptedData, key) {
  const iv = base64ToArrayBuffer(encryptedData.iv);
  const data = base64ToArrayBuffer(encryptedData.data);
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  return new TextDecoder().decode(decrypted);
}

function base64ToArrayBuffer(base64) {
  return new Uint8Array(base64ToBytes(base64)).buffer;
}

document.addEventListener('DOMContentLoaded', () => {
  main().catch(console.error);
});
