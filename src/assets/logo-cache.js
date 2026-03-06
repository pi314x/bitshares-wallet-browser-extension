/**
 * logo-cache.js — Bulk logo download and local cache for the BitShares wallet.
 *
 * On startup, fetches logos-manifest.json from the repo CDN.
 * If the manifest version has changed since last sync, downloads any new or
 * missing logo PNGs in parallel and stores them as data URLs in
 * chrome.storage.local.  Subsequent wallet opens serve logos from the local
 * cache with zero network requests.
 *
 * Usage:
 *   import { initLogoCache, getCachedLogo } from './logo-cache.js';
 *
 *   // Call once at startup; pass an optional callback invoked after any new
 *   // logos are downloaded so the UI can refresh.
 *   await initLogoCache(() => updateAssetsList());
 *
 *   // Synchronous lookup — returns a data URL or null.
 *   const url = getCachedLogo('XBTSX.BTC');
 */

const CDN_BASE =
  'https://raw.githubusercontent.com/pi314x/bitshares-wallet-browser-extension/master/src/assets/logos';

const MANIFEST_URL = `${CDN_BASE}/logos-manifest.json`;

/** In-memory symbol → data-URL map, populated from storage at startup. */
const logoMap = new Map();

/**
 * Initialise the logo cache.
 *
 * 1. Loads any previously-cached logos from chrome.storage.local into the
 *    in-memory map so getAssetLogo() can serve them synchronously.
 * 2. Kicks off a background manifest check; if the version has changed,
 *    missing logos are downloaded in parallel and the storage is updated.
 *    When the sync completes and new logos were added, `onUpdate` is called.
 *
 * @param {Function} [onUpdate] - Called after new logos are downloaded.
 */
export async function initLogoCache(onUpdate) {
  // 1. Warm the in-memory map from the persisted cache.
  try {
    const stored = await chrome.storage.local.get(['logoCacheVersion', 'logoData']);
    if (stored.logoData) {
      for (const [sym, dataUrl] of Object.entries(stored.logoData)) {
        logoMap.set(sym.toUpperCase(), dataUrl);
      }
    }

    // 2. Check for updates in the background (non-blocking).
    syncLogos(stored.logoCacheVersion || null, onUpdate).catch(() => {});
  } catch {
    // Storage unavailable — silently skip caching.
  }
}

/**
 * Synchronous logo lookup.
 * @param {string} symbol  e.g. 'XBTSX.BTC'
 * @returns {string|null}  data URL or null
 */
export function getCachedLogo(symbol) {
  if (!symbol) return null;
  return logoMap.get(symbol.toUpperCase()) ?? null;
}

// ---------------------------------------------------------------------------

async function syncLogos(cachedVersion, onUpdate) {
  let manifest;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) return;
    manifest = await res.json();
  } catch {
    return; // Network unavailable — skip silently.
  }

  if (manifest.version === cachedVersion) return; // Nothing changed.

  // Load the existing stored logo data so we only fetch what's missing.
  let existing = {};
  try {
    const stored = await chrome.storage.local.get('logoData');
    existing = stored.logoData || {};
    // Populate map from existing data (covers symbols learned after last init).
    for (const [sym, dataUrl] of Object.entries(existing)) {
      logoMap.set(sym.toUpperCase(), dataUrl);
    }
  } catch { /* ignore */ }

  // Download any new / missing logos in parallel.
  const updates = {};
  await Promise.allSettled(
    (manifest.logos || []).map(async (symbol) => {
      const key = symbol.toUpperCase();
      if (existing[key]) return; // Already have it.
      try {
        const r = await fetch(`${CDN_BASE}/${symbol}.png`);
        if (!r.ok) return;
        const blob = await r.blob();
        const dataUrl = await blobToDataUrl(blob);
        updates[key] = dataUrl;
        logoMap.set(key, dataUrl);
      } catch { /* skip individual failures */ }
    })
  );

  // Persist updated cache.
  try {
    await chrome.storage.local.set({
      logoCacheVersion: manifest.version,
      logoData: { ...existing, ...updates },
    });
  } catch { /* quota exceeded — keep in-memory only */ }

  if (Object.keys(updates).length > 0 && typeof onUpdate === 'function') {
    onUpdate();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
