/**
 * asset-logos.js — Asset logo resolution for the BitShares wallet.
 *
 * Resolution order (see getAssetLogo):
 *   1. Bundled file inside the extension  (src/assets/logos/<SYMBOL>.png)
 *   2. Own-repo CDN                       (CORE_CDN_BASE/<SYMBOL>.png)
 *   3. null → caller renders letter-circle fallback
 *
 * To add a logo: drop a PNG/SVG into src/assets/logos/ and push to master.
 * The CDN URL updates automatically — no code change needed.
 *
 * Naming convention: uppercase symbol, e.g. BTS.png, USDT.png, XBTSX.STH.png
 */

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
 * Known BitShares gateway prefixes.
 * Used to normalise gateway-prefixed symbols so both the bundled set and
 * the CDN are checked with the full original symbol (e.g. XBTSX.STH.png)
 * as well as just the base (STH.png).
 */
export const GATEWAY_PREFIXES = new Set([
  'XBTSX', 'GDEX', 'RUDEX', 'HONEST', 'BINANCE',
  'OPEN', 'BRIDGE', 'DEEX', 'COSS', 'SPARKDEX',
  'BLOCKTRADES', 'BTWTY', 'TRADE', 'TWENTIX', 'BRDG',
]);

/**
 * Returns the logo URL for the given symbol, or null if unavailable.
 *
 * Resolution order:
 *   1. Bundled extension file — zero network, instant
 *      src/assets/logos/<SYMBOL>.png  (e.g. BTS.png)
 *   2. Own-repo CDN — fetched on first display, cached by browser
 *      Tries full symbol first (XBTSX.STH.png), then base only (STH.png)
 *   3. null — letter-circle fallback rendered by caller
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

  // 2. Own-repo CDN — full symbol first (covers XBTSX.STH.png etc.)
  //    Caller's onerror handler will degrade to letter-circle on 404.
  return `${CORE_CDN_BASE}/${upper}.png`;
}
