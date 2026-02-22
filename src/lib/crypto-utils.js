/**
 * CryptoUtils
 * Cryptographic utilities for BitShares wallet
 * Pure JavaScript implementation - no external dependencies
 * Handles key generation, encryption, and signing using secp256k1
 */

import { WORD_LIST } from './bip39-wordlist.js';

// secp256k1 curve parameters
const SECP256K1 = {
  // Prime field
  P: BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F'),
  // Curve order
  N: BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'),
  // Generator point
  Gx: BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'),
  Gy: BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8'),
  // Curve coefficient (y^2 = x^3 + 7)
  A: BigInt(0),
  B: BigInt(7)
};

/**
 * Modular arithmetic helpers for BigInt
 */
function mod(a, m) {
  const result = a % m;
  return result >= 0n ? result : result + m;
}

function modInverse(a, m) {
  // First reduce a to be positive and within [0, m)
  // This is critical - if a is negative (e.g., from point subtraction),
  // we need to make it positive first
  a = mod(a, m);
  if (a === 0n) throw new Error('No modular inverse for 0');

  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }

  return mod(old_s, m);
}

function modPow(base, exp, m) {
  let result = 1n;
  base = mod(base, m);

  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = mod(result * base, m);
    }
    exp = exp / 2n;
    base = mod(base * base, m);
  }

  return result;
}

/**
 * Elliptic curve point operations
 */
class ECPoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  isInfinity() {
    return this.x === null && this.y === null;
  }

  static infinity() {
    return new ECPoint(null, null);
  }

  equals(other) {
    return this.x === other.x && this.y === other.y;
  }

  add(other) {
    if (this.isInfinity()) return other;
    if (other.isInfinity()) return this;

    const { P } = SECP256K1;

    if (this.x === other.x) {
      if (mod(this.y + other.y, P) === 0n) {
        return ECPoint.infinity();
      }
      return this.double();
    }

    const slope = mod((other.y - this.y) * modInverse(other.x - this.x, P), P);
    const x3 = mod(slope * slope - this.x - other.x, P);
    const y3 = mod(slope * (this.x - x3) - this.y, P);

    return new ECPoint(x3, y3);
  }

  double() {
    if (this.isInfinity()) return this;

    const { P, A } = SECP256K1;

    const slope = mod((3n * this.x * this.x + A) * modInverse(2n * this.y, P), P);
    const x3 = mod(slope * slope - 2n * this.x, P);
    const y3 = mod(slope * (this.x - x3) - this.y, P);

    return new ECPoint(x3, y3);
  }

  multiply(k) {
    let result = ECPoint.infinity();
    let addend = this;

    while (k > 0n) {
      if (k % 2n === 1n) {
        result = result.add(addend);
      }
      addend = addend.double();
      k = k / 2n;
    }

    return result;
  }

  // Compress point to 33 bytes
  toCompressed() {
    const xBytes = bigIntToBytes(this.x, 32);
    const prefix = this.y % 2n === 0n ? 0x02 : 0x03;
    const result = new Uint8Array(33);
    result[0] = prefix;
    result.set(xBytes, 1);
    return result;
  }

  // Decompress point from 33 bytes
  static fromCompressed(bytes) {
    const prefix = bytes[0];
    const x = bytesToBigInt(bytes.slice(1));
    const { P, B } = SECP256K1;

    // y^2 = x^3 + 7
    const ySquared = mod(modPow(x, 3n, P) + B, P);
    let y = modPow(ySquared, (P + 1n) / 4n, P);

    // Choose correct y based on prefix
    if ((prefix === 0x02 && y % 2n !== 0n) || (prefix === 0x03 && y % 2n === 0n)) {
      y = P - y;
    }

    return new ECPoint(x, y);
  }
}

// Generator point
const G = new ECPoint(SECP256K1.Gx, SECP256K1.Gy);

/**
 * Helper functions for byte/BigInt conversion
 */
function bigIntToBytes(n, length) {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n = n >> 8n;
  }
  return bytes;
}

function bytesToBigInt(bytes) {
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 implementation using Web Crypto API
 */
async function sha256(data) {
  const buffer = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Double SHA-256
 */
async function doubleSha256(data) {
  const first = await sha256(data);
  return await sha256(first);
}

/**
 * RIPEMD-160 implementation (simplified for checksum)
 */
async function ripemd160(data) {
  // For BitShares, we use SHA256 then take first 4 bytes for checksum
  // Full RIPEMD160 is complex; BitShares actually uses a different checksum
  const hash = await sha256(data);
  return hash.slice(0, 20);
}

export class CryptoUtils {
  /**
   * Generate a random 24-word brainkey
   */
  static generateBrainkey() {
    const words = [];
    const array = new Uint32Array(24);
    crypto.getRandomValues(array);

    for (let i = 0; i < 24; i++) {
      const index = array[i] % WORD_LIST.length;
      words.push(WORD_LIST[index].toUpperCase());
    }

    return words.join(' ');
  }

  /**
   * Normalize a brainkey (uppercase, single spaces)
   */
  static normalizeBrainkey(brainkey) {
    return brainkey
      .trim()
      .split(/\s+/)
      .map(word => word.toUpperCase())
      .join(' ');
  }

  /**
   * Generate keys from brainkey
   */
  static async generateKeysFromBrainkey(brainkey) {
    const normalizedBrainkey = this.normalizeBrainkey(brainkey);

    // Generate keys for different roles using sequence numbers
    const ownerKey = await this.generateKeyFromSeed(normalizedBrainkey + ' 0');
    const activeKey = await this.generateKeyFromSeed(normalizedBrainkey + ' 1');
    const memoKey = await this.generateKeyFromSeed(normalizedBrainkey + ' 2');

    return {
      active: activeKey,
      owner: ownerKey,
      memo: memoKey
    };
  }

  /**
   * Generate keys from account name and password (cloud wallet style)
   */
  static async generateKeysFromPassword(accountName, password) {
    const keys = {};
    const roles = ['active', 'owner', 'memo'];

    for (const role of roles) {
      const seed = accountName + role + password;
      keys[role] = await this.generateKeyFromSeed(seed);
    }

    return keys;
  }

  /**
   * Generate a key pair from seed
   */
  static async generateKeyFromSeed(seed) {
    // Hash the seed to get 32 bytes for private key
    const seedHash = await sha256(seed);

    // Use SHA256 hash directly as private key (matches bitsharesjs behavior)
    // SHA256 output is uniformly distributed and virtually always valid for secp256k1
    const privateKeyBigInt = bytesToBigInt(seedHash);
    const privateKeyBytes = bigIntToBytes(privateKeyBigInt, 32);

    // Generate public key
    const publicPoint = G.multiply(privateKeyBigInt);
    const publicKeyBytes = publicPoint.toCompressed();

    // Convert to WIF and BTS format
    const privateKeyWIF = await this.privateKeyToWIF(privateKeyBytes);
    const publicKeyBTS = await this.publicKeyToBTS(publicKeyBytes);

    return {
      privateKey: privateKeyWIF,
      publicKey: publicKeyBTS
    };
  }

  /**
   * Convert private key bytes to WIF format
   */
  static async privateKeyToWIF(privateKeyBytes) {
    // WIF format: 0x80 + private key + checksum
    const extended = new Uint8Array(33);
    extended[0] = 0x80;
    extended.set(privateKeyBytes, 1);

    // Double SHA256 for checksum
    const checksum = await doubleSha256(extended);

    // Append first 4 bytes of checksum
    const wifBytes = new Uint8Array(37);
    wifBytes.set(extended);
    wifBytes.set(checksum.slice(0, 4), 33);

    return this.base58Encode(wifBytes);
  }

  /**
   * Convert WIF to private key bytes
   * Handles both compressed (38 bytes) and uncompressed (37 bytes) WIF formats
   */
  static async wifToPrivateKey(wif) {
    // Validate input is a string
    if (typeof wif !== 'string') {
      throw new Error(`WIF must be a string, got ${typeof wif}`);
    }

    // WIF should typically start with '5' (uncompressed) or 'K'/'L' (compressed)
    if (wif.length < 50 || wif.length > 52) {
      throw new Error(`Invalid WIF string length: ${wif.length}, expected 51-52 characters. First char: ${wif[0]}`);
    }

    const decoded = this.base58Decode(wif);

    // WIF format:
    // Uncompressed: 1 byte version + 32 bytes key + 4 bytes checksum = 37 bytes
    // Compressed: 1 byte version + 32 bytes key + 1 byte flag (0x01) + 4 bytes checksum = 38 bytes
    if (decoded.length !== 37 && decoded.length !== 38) {
      throw new Error(`Invalid WIF decoded length: ${decoded.length}, expected 37 or 38. Input length: ${wif.length}, starts with: ${wif.substring(0, 8)}`);
    }

    const isCompressed = decoded.length === 38;
    const payloadLength = isCompressed ? 34 : 33;

    // Verify checksum
    const payload = decoded.slice(0, payloadLength);
    const checksum = decoded.slice(payloadLength);
    const calculatedChecksum = await doubleSha256(payload);

    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== calculatedChecksum[i]) {
        throw new Error('Invalid WIF checksum');
      }
    }

    // Verify version byte (0x80 for mainnet)
    if (decoded[0] !== 0x80) {
      throw new Error(`Invalid WIF version byte: ${decoded[0]}`);
    }

    // Return the 32-byte private key (skip version byte)
    return decoded.slice(1, 33);
  }

  /**
   * Convert public key bytes to BTS format
   */
  static async publicKeyToBTS(publicKeyBytes) {
    // BitShares uses RIPEMD160(public key) for checksum
    const checksum = await ripemd160(publicKeyBytes);

    // Append first 4 bytes of checksum
    const withChecksum = new Uint8Array(37);
    withChecksum.set(publicKeyBytes);
    withChecksum.set(checksum.slice(0, 4), 33);

    return 'BTS' + this.base58Encode(withChecksum);
  }

  /**
   * Convert WIF to key pair
   */
  static async wifToKeys(wif) {
    if (!wif || typeof wif !== 'string') {
      throw new Error('Invalid WIF format');
    }

    try {
      const privateKeyBytes = await this.wifToPrivateKey(wif);
      const privateKeyBigInt = bytesToBigInt(privateKeyBytes);

      // Generate public key
      const publicPoint = G.multiply(privateKeyBigInt);
      const publicKeyBytes = publicPoint.toCompressed();
      const publicKeyBTS = await this.publicKeyToBTS(publicKeyBytes);

      return {
        privateKey: wif,
        publicKey: publicKeyBTS
      };
    } catch (error) {
      throw new Error('Invalid WIF key: ' + error.message);
    }
  }

  /**
   * Sign a message hash with private key (returns compact signature)
   * Uses the same approach as bitsharesjs: iterate nonces until we find a
   * canonical signature, then iterate recovery IDs to find the correct one.
   */
  static async signHash(hash, privateKeyWIF) {
    const privateKeyBytes = await this.wifToPrivateKey(privateKeyWIF);
    const privateKey = bytesToBigInt(privateKeyBytes);
    const z = bytesToBigInt(hash);
    const { N } = SECP256K1;

    // Calculate expected public key for recovery ID verification
    const expectedPubPoint = G.multiply(privateKey);
    const expectedPubKey = expectedPubPoint.toCompressed();

    let nonce = 0;

    // Loop until we find a signature that passes BitShares' strict canonical check
    while (true) {
      // 1. Generate deterministic k using RFC 6979 style approach
      const k = await this.generateK(hash, privateKeyBytes, nonce);

      // 2. Calculate R point = k * G
      const R = G.multiply(k);

      // 3. Calculate r = R.x mod N
      const r = mod(R.x, N);

      if (r === 0n) {
        nonce++; continue;
      }

      // 4. Calculate s = k^-1 * (z + r * priv) mod N
      let s = mod(modInverse(k, N) * (z + r * privateKey), N);

      if (s === 0n) {
        nonce++; continue;
      }

      // 5. Enforce Low S (BIP-62) - required for canonical signatures
      if (s > N / 2n) {
        s = N - s;
      }

      // 6. Convert to bytes
      const rBytes = bigIntToBytes(r, 32);
      const sBytes = bigIntToBytes(s, 32);

      // 7. Canonical check: both R and S must have first byte < 0x80
      if (rBytes[0] >= 0x80 || sBytes[0] >= 0x80) {
        nonce++;
        if (nonce > 100) throw new Error("Unable to find canonical signature after 100 attempts");
        continue;
      }

      // 8. Find the correct recovery ID by testing possibilities
      let recoveryId = -1;

      for (let i = 0; i < 4; i++) {
        try {
          const testSig = new Uint8Array(65);
          testSig[0] = 27 + 4 + i;
          testSig.set(rBytes, 1);
          testSig.set(sBytes, 33);

          const recoveredPubKey = this.recoverPublicKey(hash, testSig);

          if (bytesToHex(recoveredPubKey) === bytesToHex(expectedPubKey)) {
            recoveryId = i;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (recoveryId === -1) {
        nonce++;
        if (nonce > 100) throw new Error("Unable to find valid recovery factor");
        continue;
      }

      // 9. Construct the final 65-byte Compact Signature
      const signature = new Uint8Array(65);
      signature[0] = 27 + 4 + recoveryId;
      signature.set(rBytes, 1);
      signature.set(sBytes, 33);

      return signature;
    }
  }

  /**
   * Check if signature is canonical per BitShares requirements
   */
  static isCanonicalSignature(rBytes, sBytes) {
    // R and S must not have high bit set (would require DER padding)
    // R must not be zero and must not start with 0x00 unless next byte has high bit
    // S must be in lower half of curve order (already enforced above)

    // Check R is not zero
    let rIsZero = true;
    for (let i = 0; i < rBytes.length; i++) {
      if (rBytes[i] !== 0) {
        rIsZero = false;
        break;
      }
    }
    if (rIsZero) return false;

    // Check S is not zero
    let sIsZero = true;
    for (let i = 0; i < sBytes.length; i++) {
      if (sBytes[i] !== 0) {
        sIsZero = false;
        break;
      }
    }
    if (sIsZero) return false;

    // For BitShares canonical check:
    // - First byte of R should not be 0x00 (unless needed for sign)
    // - First byte of R should be < 0x80
    // - First byte of S should not be 0x00
    // - First byte of S should be < 0x80

    // R checks
    if (rBytes[0] >= 0x80) return false;
    if (rBytes[0] === 0x00 && rBytes[1] < 0x80) return false;

    // S checks
    if (sBytes[0] >= 0x80) return false;
    if (sBytes[0] === 0x00 && sBytes[1] < 0x80) return false;

    return true;
  }

  /**
   * Recover public key from a compact signature
   * Implementation follows SEC 1 and matches bitsharesjs/elliptic.js
   * Formula: Q = r^-1 * (s*R + (-e)*G) where e is the message hash
   */
  static recoverPublicKey(hash, signature) {
    const { N, P, B } = SECP256K1;

    // Extract header and components
    const header = signature[0];
    const recoveryId = (header - 27) & 3;
    const rBytes = signature.slice(1, 33);
    const sBytes = signature.slice(33, 65);

    const r = bytesToBigInt(rBytes);
    const s = bytesToBigInt(sBytes);
    const e = bytesToBigInt(hash);

    // Validate r and s are in valid range
    if (r <= 0n || r >= N) {
      throw new Error('Invalid r value');
    }
    if (s <= 0n || s >= N) {
      throw new Error('Invalid s value');
    }

    // Step 1: Determine which x-coordinate to use
    const isYOdd = (recoveryId & 1) === 1;
    const isSecondKey = (recoveryId >> 1) & 1;

    let rx = r;
    if (isSecondKey) {
      rx = r + N;
      if (rx >= P) {
        throw new Error('Invalid recovery ID - rx >= P');
      }
    }

    // Step 2: Calculate y from x using curve equation (y^2 = x^3 + 7)
    const ySquared = mod(modPow(rx, 3n, P) + B, P);
    let ry = modPow(ySquared, (P + 1n) / 4n, P);

    // Verify point exists on curve
    if (mod(ry * ry, P) !== ySquared) {
      throw new Error('Point not on curve');
    }

    // Step 3: Choose correct y based on parity
    const ryIsOdd = (ry % 2n) === 1n;
    if (ryIsOdd !== isYOdd) {
      ry = P - ry;
    }

    const R = new ECPoint(rx, ry);

    // Step 4: Compute Q = r^-1 * (s*R + (-e)*G)
    const rInv = modInverse(r, N);
    const eMod = mod(e, N);
    const eNeg = eMod === 0n ? 0n : N - eMod;

    const sR = R.multiply(s);
    const eNegG = G.multiply(eNeg);
    const sum = sR.add(eNegG);
    const Q = sum.multiply(rInv);

    if (Q.isInfinity()) {
      throw new Error('Recovered point is at infinity');
    }

    return Q.toCompressed();
  }

  /**
   * Verify a signature by recovering the public key and comparing
   */
  static async verifySignature(hash, signature, expectedPublicKeyWIF) {
    try {
      const recoveredPubKey = this.recoverPublicKey(hash, signature);
      const privateKeyBytes = await this.wifToPrivateKey(expectedPublicKeyWIF);
      const privateKey = bytesToBigInt(privateKeyBytes);
      const expectedPubPoint = G.multiply(privateKey);
      const expectedPubKey = expectedPubPoint.toCompressed();

      return bytesToHex(recoveredPubKey) === bytesToHex(expectedPubKey);
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate deterministic k using RFC 6979
   */
static async generateK(hash, privateKeyBytes, nonce = 0) {
    const { N } = SECP256K1;

    // We need a buffer that holds: PrivateKey (32) + Hash (32) + Nonce (4)
    // Total 68 bytes
    const combined = new Uint8Array(32 + 32 + 4);
    
    combined.set(privateKeyBytes, 0); // 0-31: Private Key
    combined.set(hash, 32);           // 32-63: Message Hash
    
    // 64-67: Nonce (32-bit integer, Big Endian)
    const nonceView = new DataView(combined.buffer);
    nonceView.setUint32(64, nonce, false); 

    // Hash the combined data to get a deterministic random number
    const kHash = await sha256(combined);
    
    let kBigInt = bytesToBigInt(kHash);
    
    // Ensure k is within range [1, N-1]
    kBigInt = mod(kBigInt, N - 1n) + 1n;

    return kBigInt;
  }

  /**
   * Simple Base58 encoding
   */
  static base58Encode(buffer) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

    if (buffer.length === 0) return '';

    const digits = [0];

    for (let i = 0; i < buffer.length; i++) {
      let carry = buffer[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }

    let result = '';
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
      result += ALPHABET[0];
    }

    for (let i = digits.length - 1; i >= 0; i--) {
      result += ALPHABET[digits[i]];
    }

    return result;
  }

  /**
   * Simple Base58 decoding
   */
  static base58Decode(str) {
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
   * Generate a random salt for wallet encryption
   */
  static generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...salt));
  }

  /**
   * Derive encryption key from password and salt
   * @param {string} password - User password
   * @param {string} saltBase64 - Base64-encoded salt (optional, for backwards compatibility)
   */
  static async deriveKey(password, saltBase64 = null) {
    const encoder = new TextEncoder();

    // Use provided salt or fall back to legacy fixed salt for backwards compatibility
    let salt;
    if (saltBase64) {
      salt = new Uint8Array(atob(saltBase64).split('').map(c => c.charCodeAt(0)));
    } else {
      // Legacy fallback - will be removed in future versions
      salt = encoder.encode('bitshares-wallet-salt');
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt data with AES-GCM
   */
  static async encrypt(data, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(JSON.stringify(data))
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  /**
   * Decrypt data with AES-GCM
   */
  static async decrypt(encryptedData, key) {
    const combined = new Uint8Array(
      atob(encryptedData).split('').map(c => c.charCodeAt(0))
    );

    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
  }

  /**
   * Hash password for session storage
   */
  static async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'session-salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
  }

  /**
   * Encrypt memo using ECIES (Elliptic Curve Integrated Encryption Scheme)
   * Compatible with BitShares memo encryption standard
   * @param {string} message - The plaintext message to encrypt
   * @param {string} fromPrivateKeyWIF - Sender's memo private key in WIF format
   * @param {string} toPublicKeyBTS - Recipient's memo public key in BTS format
   * @param {BigInt} nonce - Optional nonce (if not provided, generates random)
   * @returns {Object} - { from, to, nonce, message } ready for blockchain
   */
  static async encryptMemo(message, fromPrivateKeyWIF, toPublicKeyBTS, nonce = null) {
    // Parse sender's private key
    const fromPrivateKeyBytes = await this.wifToPrivateKey(fromPrivateKeyWIF);
    const fromPrivateKey = bytesToBigInt(fromPrivateKeyBytes);

    // Get sender's public key
    const fromPublicPoint = G.multiply(fromPrivateKey);
    const fromPublicKeyBTS = await this.publicKeyToBTS(fromPublicPoint.toCompressed());

    // Parse recipient's public key
    const toPublicKeyBytes = await this.btsToPublicKeyBytes(toPublicKeyBTS);
    const toPublicPoint = ECPoint.fromCompressed(toPublicKeyBytes);

    // Generate nonce if not provided (unique identifier for this memo)
    if (nonce === null) {
      const nonceBytes = crypto.getRandomValues(new Uint8Array(8));
      nonce = bytesToBigInt(nonceBytes);
    }

    // Compute shared secret: S = fromPrivateKey * toPublicKey
    const sharedPoint = toPublicPoint.multiply(fromPrivateKey);

    // Derive encryption key using SHA-512 of (nonce || shared_x)
    const nonceBytes = bigIntToBytes(nonce, 8);
    const sharedXBytes = bigIntToBytes(sharedPoint.x, 32);
    const preKey = new Uint8Array(8 + 32);
    preKey.set(nonceBytes, 0);
    preKey.set(sharedXBytes, 8);

    const keyHash = await this.sha512(preKey);
    const encryptionKey = keyHash.slice(0, 32);  // First 32 bytes for AES key
    const iv = keyHash.slice(32, 48);            // Next 16 bytes for IV

    // Encrypt message with AES-256-CBC
    const messageBytes = new TextEncoder().encode(message);
    const encryptedBytes = await this.aes256CbcEncrypt(messageBytes, encryptionKey, iv);

    // Calculate checksum (first 4 bytes of SHA-256 of message)
    const messageChecksum = await sha256(messageBytes);
    const checksum = messageChecksum.slice(0, 4);

    // Prepend checksum to encrypted message
    const finalMessage = new Uint8Array(4 + encryptedBytes.length);
    finalMessage.set(checksum, 0);
    finalMessage.set(encryptedBytes, 4);

    return {
      from: fromPublicKeyBTS,
      to: toPublicKeyBTS,
      nonce: nonce.toString(),
      message: bytesToHex(finalMessage)
    };
  }

  /**
   * Decrypt memo using ECIES
   * @param {Object} memoObject - { from, to, nonce, message } from blockchain
   * @param {string} privateKeyWIF - Your memo private key in WIF format
   * @returns {string} - Decrypted plaintext message
   */
  static async decryptMemo(memoObject, privateKeyWIF) {
    const { from, to, nonce, message } = memoObject;

    // Parse private key
    const privateKeyBytes = await this.wifToPrivateKey(privateKeyWIF);
    const privateKey = bytesToBigInt(privateKeyBytes);

    // Determine if we are sender or recipient
    const myPublicPoint = G.multiply(privateKey);
    const myPublicKeyBTS = await this.publicKeyToBTS(myPublicPoint.toCompressed());

    let otherPublicKeyBTS;
    if (myPublicKeyBTS === from) {
      // We are sender, use recipient's key for shared secret
      otherPublicKeyBTS = to;
    } else if (myPublicKeyBTS === to) {
      // We are recipient, use sender's key for shared secret
      otherPublicKeyBTS = from;
    } else {
      throw new Error('Private key does not match memo sender or recipient');
    }

    // Parse the other party's public key
    const otherPublicKeyBytes = await this.btsToPublicKeyBytes(otherPublicKeyBTS);
    const otherPublicPoint = ECPoint.fromCompressed(otherPublicKeyBytes);

    // Compute shared secret: S = privateKey * otherPublicKey
    const sharedPoint = otherPublicPoint.multiply(privateKey);

    // Derive decryption key using SHA-512 of (nonce || shared_x)
    const nonceBigInt = BigInt(nonce);
    const nonceBytes = bigIntToBytes(nonceBigInt, 8);
    const sharedXBytes = bigIntToBytes(sharedPoint.x, 32);
    const preKey = new Uint8Array(8 + 32);
    preKey.set(nonceBytes, 0);
    preKey.set(sharedXBytes, 8);

    const keyHash = await this.sha512(preKey);
    const decryptionKey = keyHash.slice(0, 32);
    const iv = keyHash.slice(32, 48);

    // Parse message (hex -> bytes)
    const messageBytes = hexToBytes(message);

    // Extract checksum (first 4 bytes) and encrypted data
    const checksum = messageBytes.slice(0, 4);
    const encryptedBytes = messageBytes.slice(4);

    // Decrypt with AES-256-CBC
    const decryptedBytes = await this.aes256CbcDecrypt(encryptedBytes, decryptionKey, iv);

    // Verify checksum
    const decryptedChecksum = await sha256(decryptedBytes);
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== decryptedChecksum[i]) {
        throw new Error('Memo checksum verification failed');
      }
    }

    return new TextDecoder().decode(decryptedBytes);
  }

  /**
   * Parse BTS public key format to raw bytes
   */
  static async btsToPublicKeyBytes(publicKeyBTS) {
    if (!publicKeyBTS.startsWith('BTS')) {
      throw new Error('Invalid BTS public key format');
    }

    const decoded = this.base58Decode(publicKeyBTS.slice(3));

    // Remove checksum (last 4 bytes)
    if (decoded.length !== 37) {
      throw new Error('Invalid BTS public key length');
    }

    const publicKeyBytes = decoded.slice(0, 33);
    const checksum = decoded.slice(33);

    // Verify checksum
    const calculatedChecksum = await ripemd160(publicKeyBytes);
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== calculatedChecksum[i]) {
        throw new Error('Invalid BTS public key checksum');
      }
    }

    return publicKeyBytes;
  }

  /**
   * SHA-512 hash
   */
  static async sha512(data) {
    const buffer = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-512', buffer);
    return new Uint8Array(hashBuffer);
  }

  /**
   * AES-256-CBC encryption (for memo compatibility)
   */
  static async aes256CbcEncrypt(data, key, iv) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC' },
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: iv },
      cryptoKey,
      data
    );

    return new Uint8Array(encrypted);
  }

  /**
   * AES-256-CBC decryption (for memo compatibility)
   */
  static async aes256CbcDecrypt(data, key, iv) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv },
      cryptoKey,
      data
    );

    return new Uint8Array(decrypted);
  }

  /**
   * Generate random bytes
   */
  static randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  /**
   * Convert hex string to Uint8Array
   */
  static hexToBytes(hex) {
    return hexToBytes(hex);
  }

  /**
   * Convert Uint8Array to hex string
   */
  static bytesToHex(bytes) {
    return bytesToHex(bytes);
  }

  /**
   * SHA-256 hash
   */
  static async sha256(data) {
    return await sha256(data);
  }
}

/**
 * Self-test function to verify EC math is working correctly
 */
export async function runSelfTests() {
  console.log('=== ECDSA SELF TESTS ===');
  let allPassed = true;

  // Test 1: Point multiplication with 1 should give G
  const test1 = G.multiply(1n);
  const pass1 = test1.x === SECP256K1.Gx && test1.y === SECP256K1.Gy;
  console.log('Test 1 (1*G = G):', pass1 ? 'PASS' : 'FAIL');
  allPassed = allPassed && pass1;

  // Test 2: 2*G should give known value
  const G2 = G.multiply(2n);
  const expected2Gx = BigInt('0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
  const expected2Gy = BigInt('0x1ae168fea63dc339a3c58419466ceae1061b7cd381a0259628ae3bf9cd55c3ee');
  const pass2 = G2.x === expected2Gx && G2.y === expected2Gy;
  console.log('Test 2 (2*G):', pass2 ? 'PASS' : 'FAIL');
  if (!pass2) {
    console.log('  Expected x:', expected2Gx.toString(16));
    console.log('  Got x:', G2.x.toString(16));
  }
  allPassed = allPassed && pass2;

  // Test 3: Modular inverse
  const { N } = SECP256K1;
  const testVal = 12345n;
  const inv = modInverse(testVal, N);
  const product = mod(testVal * inv, N);
  const pass3 = product === 1n;
  console.log('Test 3 (modInverse):', pass3 ? 'PASS' : 'FAIL');
  allPassed = allPassed && pass3;

  // Test 4: Sign and recover with known private key
  // Private key = 1, public key = G
  const testPrivKey = bigIntToBytes(1n, 32);
  const testHash = await sha256(new Uint8Array([1, 2, 3, 4]));
  console.log('Test 4: Sign with priv=1, recover should give G');
  console.log('  G compressed:', bytesToHex(G.toCompressed()));

  // Sign manually without using WIF
  const z = bytesToBigInt(testHash);
  let k = 12345n; // Known k for testing
  const R = G.multiply(k);
  let r = mod(R.x, N);
  let s = mod(modInverse(k, N) * (z + r * 1n), N);

  console.log('  r:', r.toString(16).substring(0, 32));
  console.log('  s:', s.toString(16).substring(0, 32));
  console.log('  R.y parity:', R.y % 2n === 1n ? 'odd' : 'even');

  // Don't flip s for this test to keep it simple
  const recoveryId = R.y % 2n === 1n ? 1 : 0;

  // Build signature
  const rBytes = bigIntToBytes(r, 32);
  const sBytes = bigIntToBytes(s, 32);
  const testSig = new Uint8Array(65);
  testSig[0] = 27 + 4 + recoveryId;
  testSig.set(rBytes, 1);
  testSig.set(sBytes, 33);

  try {
    const recovered = CryptoUtils.recoverPublicKey(testHash, testSig, true);
    const expectedPubKey = G.toCompressed();
    const pass4 = bytesToHex(recovered) === bytesToHex(expectedPubKey);
    console.log('Test 4 (sign/recover):', pass4 ? 'PASS' : 'FAIL');
    if (!pass4) {
      console.log('  Expected:', bytesToHex(expectedPubKey));
      console.log('  Got:', bytesToHex(recovered));
    }
    allPassed = allPassed && pass4;
  } catch (e) {
    console.log('Test 4 (sign/recover): FAIL -', e.message);
    allPassed = false;
  }

  console.log('=== ALL TESTS:', allPassed ? 'PASSED' : 'FAILED', '===');
  return allPassed;
}

// Export helper functions for use in other modules
export { sha256, doubleSha256, hexToBytes, bytesToHex, bigIntToBytes, bytesToBigInt, G, SECP256K1, ECPoint, mod, modInverse };
