/**
 * asset-logos.js — Asset logo resolution for the BitShares wallet.
 *
 * Resolution order (see getAssetLogo):
 *   1. Bundled file inside the extension  (src/assets/logos/<SYMBOL>.png)
 *   2. Local cache (data URL stored by logo-cache.js after bulk download)
 *   3. Own-repo CDN fallback              (CORE_CDN_BASE/<SYMBOL>.png)
 *      — only for symbols listed in CDN_KNOWN, avoids 404 noise
 *   4. null → caller renders letter-circle immediately
 *
 * To add a logo:
 *   a) Drop a PNG into src/assets/logos/
 *   b) Add the symbol to CDN_KNOWN below
 *   c) Add the symbol to logos-manifest.json and bump "version"
 *   d) Push to master
 *
 * Naming convention: uppercase symbol, e.g. BTS.png, USDT.png, XBTSX.STH.png
 */

import { getCachedLogo } from './logo-cache.js';

/**
 * Raw CDN base URL pointing to the logos folder in this repository.
 * Images are served directly from GitHub — update to a custom domain or
 * GitHub Pages URL if preferred.
 */
export const CORE_CDN_BASE =
  'https://raw.githubusercontent.com/pi314x/bitshares-wallet-browser-extension/master/src/assets/logos';

/**
 * Symbols whose logos are bundled inside the extension package.
 * These load instantly without any network request.
 * Add a symbol here after placing the file in src/assets/logos/.
 */
const BUNDLED = new Set([
  'BTS',
]);

/**
 * Symbols that have a logo file committed to src/assets/logos/ in the repo.
 * Only symbols listed here (or in BUNDLED) will trigger a network request.
 * Unknown symbols return null immediately → letter-circle, no 404 noise.
 *
 * Add a symbol here after pushing its PNG to src/assets/logos/.
 * Example: after adding src/assets/logos/USDT.png → add 'USDT' below.
 */
const CDN_KNOWN = new Set([
  // IOB gateway
  'IOB.XLM',
  'IOB.XRP',
  // XBTSX gateway — full list from api.xbts.io/coins/assets
  'XBTSX.42',
  'XBTSX.AUR',
  'XBTSX.AXAI',
  'XBTSX.BAT',
  'XBTSX.BCH',
  'XBTSX.BNB',
  'XBTSX.BSV',
  'XBTSX.BTC',
  'XBTSX.BTG',
  'XBTSX.DASH',
  'XBTSX.DOGE',
  'XBTSX.EGC',
  'XBTSX.EMC',
  'XBTSX.EOS',
  'XBTSX.ETC',
  'XBTSX.ETH',
  'XBTSX.EUR',
  'XBTSX.EXR',
  'XBTSX.FLUX',
  'XBTSX.GODS',
  'XBTSX.GRS',
  'XBTSX.HBD',
  'XBTSX.HIVE',
  'XBTSX.LTC',
  'XBTSX.MDL',
  'XBTSX.NCH',
  'XBTSX.NESS',
  'XBTSX.NMC',
  'XBTSX.NVC',
  'XBTSX.ONION',
  'XBTSX.PEPE',
  'XBTSX.PIVX',
  'XBTSX.POST',
  'XBTSX.PPC',
  'XBTSX.RDD',
  'XBTSX.RTM',
  'XBTSX.RUB',
  'XBTSX.RVN',
  'XBTSX.SCH',
  'XBTSX.SKY',
  'XBTSX.STH',
  'XBTSX.TCG',
  'XBTSX.TON',
  'XBTSX.TRD',
  'XBTSX.TRX',
  'XBTSX.USDC',
  'XBTSX.USDT',
  'XBTSX.VITE',
  'XBTSX.VTC',
  'XBTSX.WAVES',
  'XBTSX.WRAM',
  'XBTSX.XAUT',
  'XBTSX.XCCX',
  'XBTSX.XCH',
  'XBTSX.XRP',
  'XBTSX.ZEC',
  // Add more symbols here after pushing their PNGs to src/assets/logos/
]);

/**
 * Known BitShares gateway prefixes.
 * Exported for use by other modules that need gateway detection.
 */
export const GATEWAY_PREFIXES = new Set([
  'XBTSX', 'GDEX', 'RUDEX', 'HONEST', 'BINANCE',
  'OPEN', 'BRIDGE', 'DEEX', 'COSS', 'SPARKDEX',
  'BLOCKTRADES', 'BTWTY', 'TRADE', 'TWENTIX', 'BRDG',
]);

/**
 * Returns the logo URL for the given symbol, or null if no logo exists.
 *
 * Resolution order:
 *   1. Bundled extension file — zero network, instant
 *      src/assets/logos/<SYMBOL>.png  (e.g. BTS.png)
 *   2. Own-repo CDN — only for symbols listed in CDN_KNOWN
 *      Fetched on first display, then cached by the browser
 *   3. null — letter-circle fallback rendered by caller; no network request
 *
 * @param {string} symbol  e.g. 'BTS', 'USDT', 'XBTSX.STH'
 * @returns {string|null}
 */
export function getAssetLogo(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();

  // 1. Bundled (extension-local, no network)
  if (BUNDLED.has(upper)) {
    return chrome.runtime.getURL(`src/assets/logos/${upper}.png`);
  }

  // 2. Local cache — data URL stored by logo-cache.js after bulk download
  const cached = getCachedLogo(upper);
  if (cached) return cached;

  // 3. Own-repo CDN fallback — only for symbols known to have a file.
  //    Used before the local cache is populated (first run / cold start).
  //    Prevents 404 noise for unlisted symbols.
  if (CDN_KNOWN.has(upper)) {
    return `${CORE_CDN_BASE}/${upper}.png`;
  }

  // 4. No logo — caller renders letter-circle immediately
  return null;
}
