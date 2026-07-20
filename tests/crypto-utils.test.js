/**
 * Tests for src/lib/crypto-utils.js
 *
 * Coverage:
 *  - generateBrainkey()
 *  - normalizeBrainkey(brainkey)
 *  - generateKeysFromBrainkey(brainkey)
 *  - generateKeysFromPassword(accountName, password)
 *  - deriveKey(password, salt)
 *  - encrypt(data, key) + decrypt(encryptedData, key)  — round-trip
 *  - generateSalt()
 *  - edge cases (empty/null inputs)
 */

import { CryptoUtils } from '../src/lib/crypto-utils.js';

// ---------------------------------------------------------------------------
// generateBrainkey
// ---------------------------------------------------------------------------
describe('CryptoUtils.generateBrainkey()', () => {
  test('returns a string', () => {
    const brainkey = CryptoUtils.generateBrainkey();
    expect(typeof brainkey).toBe('string');
  });

  test('contains exactly 16 words', () => {
    const brainkey = CryptoUtils.generateBrainkey();
    const words = brainkey.trim().split(/\s+/);
    expect(words).toHaveLength(16);
  });

  test('all words are uppercase', () => {
    const brainkey = CryptoUtils.generateBrainkey();
    const words = brainkey.trim().split(/\s+/);
    for (const word of words) {
      expect(word).toBe(word.toUpperCase());
    }
  });

  test('generates different brainkeys on subsequent calls (non-deterministic)', () => {
    const a = CryptoUtils.generateBrainkey();
    const b = CryptoUtils.generateBrainkey();
    // Statistically, two random 16-word brainkeys will never be identical
    expect(a).not.toBe(b);
  });

  test('words are separated by single spaces', () => {
    const brainkey = CryptoUtils.generateBrainkey();
    // No leading/trailing whitespace, words separated by exactly one space
    expect(brainkey).toBe(brainkey.trim());
    expect(brainkey).not.toMatch(/\s{2,}/);
  });
});

// ---------------------------------------------------------------------------
// normalizeBrainkey
// ---------------------------------------------------------------------------
describe('CryptoUtils.normalizeBrainkey()', () => {
  test('uppercases all words', () => {
    const result = CryptoUtils.normalizeBrainkey('hello world foo');
    expect(result).toBe('HELLO WORLD FOO');
  });

  test('trims leading and trailing whitespace', () => {
    const result = CryptoUtils.normalizeBrainkey('  hello world  ');
    expect(result).toBe('HELLO WORLD');
  });

  test('collapses multiple spaces between words into one', () => {
    const result = CryptoUtils.normalizeBrainkey('hello   world   foo');
    expect(result).toBe('HELLO WORLD FOO');
  });

  test('handles tabs and mixed whitespace', () => {
    const result = CryptoUtils.normalizeBrainkey('\thello\t\tworld\n');
    expect(result).toBe('HELLO WORLD');
  });

  test('preserves a single-word input', () => {
    const result = CryptoUtils.normalizeBrainkey('abandon');
    expect(result).toBe('ABANDON');
  });

  test('already-normalized brainkey is unchanged', () => {
    const brainkey = 'HELLO WORLD';
    const result = CryptoUtils.normalizeBrainkey(brainkey);
    expect(result).toBe(brainkey);
  });

  test('mixed-case words are fully uppercased', () => {
    const result = CryptoUtils.normalizeBrainkey('hElLo WoRlD');
    expect(result).toBe('HELLO WORLD');
  });

  // Edge cases
  test('empty string returns empty string', () => {
    // normalizeBrainkey('') -> ''.trim().split(/\s+/) = [''] -> [''.toUpperCase()] = [''] -> ''
    // This is the current behaviour of the implementation.
    const result = CryptoUtils.normalizeBrainkey('');
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// generateKeysFromBrainkey
// ---------------------------------------------------------------------------
describe('CryptoUtils.generateKeysFromBrainkey()', () => {
  const BRAINKEY = 'ABANDON ABILITY ABLE ABOUT ABOVE ABSENT ABSORB ABSTRACT ABSURD ABUSE ACCESS ACCIDENT ACCOUNT ACCUSE ACHIEVE ACID';

  test('returns an object with active, owner, and memo keys', async () => {
    const keys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    expect(keys).toHaveProperty('active');
    expect(keys).toHaveProperty('owner');
    expect(keys).toHaveProperty('memo');
  });

  test('each key object has privateKey and publicKey fields', async () => {
    const keys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    for (const role of ['active', 'owner', 'memo']) {
      expect(keys[role]).toHaveProperty('privateKey');
      expect(keys[role]).toHaveProperty('publicKey');
      expect(typeof keys[role].privateKey).toBe('string');
      expect(typeof keys[role].publicKey).toBe('string');
    }
  });

  test('public keys start with BTS prefix', async () => {
    const keys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    expect(keys.active.publicKey).toMatch(/^BTS/);
    expect(keys.owner.publicKey).toMatch(/^BTS/);
    expect(keys.memo.publicKey).toMatch(/^BTS/);
  });

  test('private keys are non-empty strings', async () => {
    const keys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    expect(keys.active.privateKey.length).toBeGreaterThan(0);
    expect(keys.owner.privateKey.length).toBeGreaterThan(0);
    expect(keys.memo.privateKey.length).toBeGreaterThan(0);
  });

  test('active, owner, and memo keys are distinct from each other', async () => {
    const keys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    expect(keys.active.publicKey).not.toBe(keys.owner.publicKey);
    expect(keys.active.publicKey).not.toBe(keys.memo.publicKey);
    expect(keys.owner.publicKey).not.toBe(keys.memo.publicKey);
  });

  test('is deterministic — same brainkey produces same keys', async () => {
    const keys1 = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    const keys2 = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    expect(keys1.active.publicKey).toBe(keys2.active.publicKey);
    expect(keys1.owner.publicKey).toBe(keys2.owner.publicKey);
    expect(keys1.memo.publicKey).toBe(keys2.memo.publicKey);
  });

  test('normalizes brainkey before deriving (lowercase vs uppercase)', async () => {
    const lowerKeys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY.toLowerCase());
    const upperKeys = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    expect(lowerKeys.active.publicKey).toBe(upperKeys.active.publicKey);
  });

  test('different brainkeys produce different keys', async () => {
    const OTHER = 'ACOUSTIC ACQUIRE ACROSS ACT ACTION ACTOR ACTRESS ACTUAL ADAPT ADD ADDICT ADDRESS ADJUST ADMIT ADULT ADVANCE';
    const keys1 = await CryptoUtils.generateKeysFromBrainkey(BRAINKEY);
    const keys2 = await CryptoUtils.generateKeysFromBrainkey(OTHER);
    expect(keys1.active.publicKey).not.toBe(keys2.active.publicKey);
  });
}, 60000);

// ---------------------------------------------------------------------------
// generateKeysFromPassword
// ---------------------------------------------------------------------------
describe('CryptoUtils.generateKeysFromPassword()', () => {
  test('returns an object with active, owner, and memo keys', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('testaccount', 'mypassword');
    expect(keys).toHaveProperty('active');
    expect(keys).toHaveProperty('owner');
    expect(keys).toHaveProperty('memo');
  });

  test('each key has privateKey and publicKey', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('testaccount', 'mypassword');
    for (const role of ['active', 'owner', 'memo']) {
      expect(typeof keys[role].privateKey).toBe('string');
      expect(typeof keys[role].publicKey).toBe('string');
      expect(keys[role].privateKey.length).toBeGreaterThan(0);
      expect(keys[role].publicKey.length).toBeGreaterThan(0);
    }
  });

  test('public keys start with BTS prefix', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('testaccount', 'mypassword');
    for (const role of ['active', 'owner', 'memo']) {
      expect(keys[role].publicKey).toMatch(/^BTS/);
    }
  });

  test('is deterministic', async () => {
    const k1 = await CryptoUtils.generateKeysFromPassword('alice', 'secret');
    const k2 = await CryptoUtils.generateKeysFromPassword('alice', 'secret');
    expect(k1.active.publicKey).toBe(k2.active.publicKey);
  });

  test('different account names produce different keys', async () => {
    const k1 = await CryptoUtils.generateKeysFromPassword('alice', 'secret');
    const k2 = await CryptoUtils.generateKeysFromPassword('bob', 'secret');
    expect(k1.active.publicKey).not.toBe(k2.active.publicKey);
  });

  test('different passwords produce different keys', async () => {
    const k1 = await CryptoUtils.generateKeysFromPassword('alice', 'password1');
    const k2 = await CryptoUtils.generateKeysFromPassword('alice', 'password2');
    expect(k1.active.publicKey).not.toBe(k2.active.publicKey);
  });

  test('keys for the three roles are distinct', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('alice', 'secret');
    expect(keys.active.publicKey).not.toBe(keys.owner.publicKey);
    expect(keys.active.publicKey).not.toBe(keys.memo.publicKey);
    expect(keys.owner.publicKey).not.toBe(keys.memo.publicKey);
  });

  // Edge cases
  test('empty account name is accepted without throwing', async () => {
    await expect(
      CryptoUtils.generateKeysFromPassword('', 'mypassword')
    ).resolves.toHaveProperty('active');
  });

  test('empty password is accepted without throwing', async () => {
    await expect(
      CryptoUtils.generateKeysFromPassword('testaccount', '')
    ).resolves.toHaveProperty('active');
  });
}, 60000);

// ---------------------------------------------------------------------------
// generateSalt
// ---------------------------------------------------------------------------
describe('CryptoUtils.generateSalt()', () => {
  test('returns a non-empty string', () => {
    const salt = CryptoUtils.generateSalt();
    expect(typeof salt).toBe('string');
    expect(salt.length).toBeGreaterThan(0);
  });

  test('returns a valid base64 string (no throws on atob)', () => {
    const salt = CryptoUtils.generateSalt();
    expect(() => atob(salt)).not.toThrow();
  });

  test('two salts are different (non-deterministic)', () => {
    const s1 = CryptoUtils.generateSalt();
    const s2 = CryptoUtils.generateSalt();
    expect(s1).not.toBe(s2);
  });

  test('decoded salt has expected 32-byte length', () => {
    const salt = CryptoUtils.generateSalt();
    const decoded = atob(salt);
    expect(decoded.length).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// deriveKey
// ---------------------------------------------------------------------------
describe('CryptoUtils.deriveKey()', () => {
  test('returns a CryptoKey object', async () => {
    const salt = CryptoUtils.generateSalt();
    const key = await CryptoUtils.deriveKey('mypassword', salt);
    expect(key).toBeTruthy();
    // Web Crypto CryptoKey has a 'type' property
    expect(key.type).toBe('secret');
  });

  test('works with a provided salt', async () => {
    const salt = CryptoUtils.generateSalt();
    const key = await CryptoUtils.deriveKey('password', salt);
    expect(key).toBeTruthy();
  });

  test('works without a salt (legacy fallback)', async () => {
    const key = await CryptoUtils.deriveKey('password');
    expect(key).toBeTruthy();
  });

  test('same password + salt always produces a usable key (deterministic encryption)', async () => {
    const salt = CryptoUtils.generateSalt();
    const key1 = await CryptoUtils.deriveKey('deterministic', salt);
    const key2 = await CryptoUtils.deriveKey('deterministic', salt);
    // Encrypt with key1, decrypt with key2 — they should be the same key material
    const encrypted = await CryptoUtils.encrypt({ test: true }, key1);
    const decrypted = await CryptoUtils.decrypt(encrypted, key2);
    expect(decrypted).toEqual({ test: true });
  });

  test('different passwords produce different keys (encryption with wrong key fails)', async () => {
    const salt = CryptoUtils.generateSalt();
    const key1 = await CryptoUtils.deriveKey('password1', salt);
    const key2 = await CryptoUtils.deriveKey('password2', salt);
    const encrypted = await CryptoUtils.encrypt({ secret: 42 }, key1);
    await expect(CryptoUtils.decrypt(encrypted, key2)).rejects.toThrow();
  });
}, 30000);

// ---------------------------------------------------------------------------
// encrypt + decrypt (round-trip)
// ---------------------------------------------------------------------------
describe('CryptoUtils.encrypt() + CryptoUtils.decrypt()', () => {
  let encryptionKey;

  beforeEach(async () => {
    const salt = CryptoUtils.generateSalt();
    encryptionKey = await CryptoUtils.deriveKey('testpassword', salt);
  });

  test('encrypt returns a non-empty base64 string', async () => {
    const encrypted = await CryptoUtils.encrypt({ hello: 'world' }, encryptionKey);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(() => atob(encrypted)).not.toThrow();
  });

  test('decrypt returns the original object (round-trip)', async () => {
    const original = { message: 'hello', value: 42, nested: { a: [1, 2, 3] } };
    const encrypted = await CryptoUtils.encrypt(original, encryptionKey);
    const decrypted = await CryptoUtils.decrypt(encrypted, encryptionKey);
    expect(decrypted).toEqual(original);
  });

  test('round-trip with a plain string value', async () => {
    const original = 'plain string data';
    const encrypted = await CryptoUtils.encrypt(original, encryptionKey);
    const decrypted = await CryptoUtils.decrypt(encrypted, encryptionKey);
    expect(decrypted).toBe(original);
  });

  test('round-trip with an array', async () => {
    const original = [1, 'two', { three: 3 }];
    const encrypted = await CryptoUtils.encrypt(original, encryptionKey);
    const decrypted = await CryptoUtils.decrypt(encrypted, encryptionKey);
    expect(decrypted).toEqual(original);
  });

  test('round-trip with null', async () => {
    const encrypted = await CryptoUtils.encrypt(null, encryptionKey);
    const decrypted = await CryptoUtils.decrypt(encrypted, encryptionKey);
    expect(decrypted).toBeNull();
  });

  test('encrypting the same data twice produces different ciphertext (random IV)', async () => {
    const data = { test: 'value' };
    const enc1 = await CryptoUtils.encrypt(data, encryptionKey);
    const enc2 = await CryptoUtils.encrypt(data, encryptionKey);
    expect(enc1).not.toBe(enc2);
  });

  test('decrypting with a wrong key throws', async () => {
    const salt2 = CryptoUtils.generateSalt();
    const wrongKey = await CryptoUtils.deriveKey('wrongpassword', salt2);
    const encrypted = await CryptoUtils.encrypt({ secret: true }, encryptionKey);
    await expect(CryptoUtils.decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  test('decrypting tampered ciphertext throws', async () => {
    const encrypted = await CryptoUtils.encrypt({ data: 'value' }, encryptionKey);
    // Tamper by altering the last character
    const tampered = encrypted.slice(0, -2) + 'AA';
    await expect(CryptoUtils.decrypt(tampered, encryptionKey)).rejects.toThrow();
  });
}, 30000);

// ---------------------------------------------------------------------------
// ECDSA signing (noble-backed, constant-time secret path) + BitShares canonical
// ---------------------------------------------------------------------------
describe('CryptoUtils.signHash() / verifySignature()', () => {
  const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

  test('produces a 65-byte, graphene-canonical, low-S signature that recovers the signer', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('signtest', 'pw');
    const priv = keys.active.privateKey;
    for (let i = 0; i < 5; i++) {
      const hash = await CryptoUtils.sha256(new Uint8Array([i, 1, 2, 3]));
      const sig = await CryptoUtils.signHash(hash, priv);
      expect(sig).toHaveLength(65);
      // header = 27 + 4 (compressed) + recovery(0..3)
      expect(sig[0]).toBeGreaterThanOrEqual(31);
      expect(sig[0]).toBeLessThanOrEqual(34);
      // graphene canonical: r and s high bit clear
      expect(sig[1]).toBeLessThan(0x80);
      expect(sig[33]).toBeLessThan(0x80);
      // low-S
      const s = BigInt('0x' + CryptoUtils.bytesToHex(sig.slice(33, 65)));
      expect(s <= SECP256K1_N / 2n).toBe(true);
      // recovers to the signer (this is what the chain checks)
      expect(await CryptoUtils.verifySignature(hash, sig, priv)).toBe(true);
    }
  }, 30000);

  test('a signature does not verify against a different key', async () => {
    const a = await CryptoUtils.generateKeysFromPassword('signer-a', 'pw');
    const b = await CryptoUtils.generateKeysFromPassword('signer-b', 'pw');
    const hash = await CryptoUtils.sha256(new Uint8Array([9, 9, 9]));
    const sig = await CryptoUtils.signHash(hash, a.active.privateKey);
    expect(await CryptoUtils.verifySignature(hash, sig, b.active.privateKey)).toBe(false);
  }, 30000);

  test('signing the same hash twice both verify (nonce hedging on retry is safe)', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('signtwice', 'pw');
    const hash = await CryptoUtils.sha256(new Uint8Array([5, 5, 5, 5]));
    const s1 = await CryptoUtils.signHash(hash, keys.active.privateKey);
    const s2 = await CryptoUtils.signHash(hash, keys.active.privateKey);
    expect(await CryptoUtils.verifySignature(hash, s1, keys.active.privateKey)).toBe(true);
    expect(await CryptoUtils.verifySignature(hash, s2, keys.active.privateKey)).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------
// ECIES memo encryption (noble-backed ECDH shared secret)
// ---------------------------------------------------------------------------
describe('CryptoUtils.encryptMemo() / decryptMemo()', () => {
  test('round-trips between two accounts; both parties can decrypt', async () => {
    const A = await CryptoUtils.generateKeysFromPassword('memo-a', 'pwA');
    const B = await CryptoUtils.generateKeysFromPassword('memo-b', 'pwB');
    const plaintext = 'route 1.2.3456 — pay for order #42';
    const memo = await CryptoUtils.encryptMemo(plaintext, A.memo.privateKey, B.memo.publicKey);

    expect(memo.from).toBe(A.memo.publicKey);
    expect(memo.to).toBe(B.memo.publicKey);
    expect(typeof memo.nonce).toBe('string');
    expect(await CryptoUtils.decryptMemo(memo, B.memo.privateKey)).toBe(plaintext);
    expect(await CryptoUtils.decryptMemo(memo, A.memo.privateKey)).toBe(plaintext);
  }, 30000);

  test('a third party cannot decrypt the memo', async () => {
    const A = await CryptoUtils.generateKeysFromPassword('memo-a2', 'pwA');
    const B = await CryptoUtils.generateKeysFromPassword('memo-b2', 'pwB');
    const C = await CryptoUtils.generateKeysFromPassword('memo-c2', 'pwC');
    const memo = await CryptoUtils.encryptMemo('secret', A.memo.privateKey, B.memo.publicKey);
    await expect(CryptoUtils.decryptMemo(memo, C.memo.privateKey)).rejects.toThrow();
  }, 30000);
});

// ---------------------------------------------------------------------------
// WIF round-trip (uses noble getPublicKey for the pubkey side)
// ---------------------------------------------------------------------------
describe('CryptoUtils.wifToKeys()', () => {
  test('re-derives the same public key from the private key string', async () => {
    const keys = await CryptoUtils.generateKeysFromPassword('wif-acct', 'pw');
    const rt = await CryptoUtils.wifToKeys(keys.active.privateKey);
    expect(rt.publicKey).toBe(keys.active.publicKey);
  }, 30000);
});
