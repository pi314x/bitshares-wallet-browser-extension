/**
 * asset-logos.js — Maintainable map of asset symbols → logo image URLs.
 *
 * Add or update entries here when you need a logo for a new asset.
 * Use absolute URLs (https://…) or relative paths inside the extension
 * (e.g. '../assets/logos/mytoken.svg').
 *
 * Assets not listed here are resolved automatically via CDN (see getAssetLogo).
 * If a CDN URL 404s the caller's onerror handler renders a letter-circle fallback.
 */

export const ASSET_LOGOS = {
  // ── Core / wrapped majors ──────────────────────────────────────────────
  'BTS':          'https://cryptologos.cc/logos/bitshares-bts-logo.svg?v=040',
  'BTC':          'https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=040',
  'ETH':          'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=040',
  'USDT':         'https://cryptologos.cc/logos/tether-usdt-logo.svg?v=040',
  'USDC':         'https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=040',
  'BNB':          'https://cryptologos.cc/logos/bnb-bnb-logo.svg?v=040',
  'XRP':          'https://cryptologos.cc/logos/xrp-xrp-logo.svg?v=040',
  'SOL':          'https://cryptologos.cc/logos/solana-sol-logo.svg?v=040',
  'ADA':          'https://cryptologos.cc/logos/cardano-ada-logo.svg?v=040',
  'DOGE':         'https://cryptologos.cc/logos/dogecoin-doge-logo.svg?v=040',
  'LTC':          'https://cryptologos.cc/logos/litecoin-ltc-logo.svg?v=040',
  'DOT':          'https://cryptologos.cc/logos/polkadot-new-dot-logo.svg?v=040',
  'MATIC':        'https://cryptologos.cc/logos/polygon-matic-logo.svg?v=040',
  'AVAX':         'https://cryptologos.cc/logos/avalanche-avax-logo.svg?v=040',
  'ATOM':         'https://cryptologos.cc/logos/cosmos-atom-logo.svg?v=040',
  'XLM':          'https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=040',
  'TRX':          'https://cryptologos.cc/logos/tron-trx-logo.svg?v=040',
  'EOS':          'https://cryptologos.cc/logos/eos-eos-logo.svg?v=040',
  'XMR':          'https://cryptologos.cc/logos/monero-xmr-logo.svg?v=040',

  // ── Additional assets ─────────────────────────────────────────────────
  // Add any token that needs a specific override here, e.g.:
  // 'HONEST.USD': '<url>',
  // 'STH':        'https://…',
};

/**
 * CDN sources used for automatic logo resolution.
 *
 * XBTSX_CDN  — XBTS DEX hosts logos for every XBTSX-prefixed asset at a
 *              predictable URL, including niche tokens not listed anywhere else
 *              (e.g. XBTSX.STH → https://ex.xbts.io/asset-symbols/xbtsx.sth.png).
 *
 * BTS_UI_CDN — The BitShares UI GitHub repo has PNGs for most assets traded on
 *              the BitShares DEX (covers GDEX, RUDEX, OPEN, … base symbols).
 */
const XBTSX_CDN  = (base) => `https://ex.xbts.io/asset-symbols/xbtsx.${base.toLowerCase()}.png`;
const BTS_UI_CDN = (base) => `https://raw.githubusercontent.com/bitshares/bitshares-ui/staging/app/assets/asset-symbols/${base.toLowerCase()}.png`;

/**
 * Known BitShares gateway prefixes, mapped to the CDN best suited for them.
 * XBTSX assets are served by the XBTS DEX itself; all other gateways fall
 * back to the BitShares UI asset-symbols repository.
 */
const GATEWAY_CDN = {
  'XBTSX':       XBTSX_CDN,
  'GDEX':        BTS_UI_CDN,
  'RUDEX':       BTS_UI_CDN,
  'HONEST':      BTS_UI_CDN,
  'BINANCE':     BTS_UI_CDN,
  'OPEN':        BTS_UI_CDN,
  'BRIDGE':      BTS_UI_CDN,
  'DEEX':        BTS_UI_CDN,
  'COSS':        BTS_UI_CDN,
  'SPARKDEX':    BTS_UI_CDN,
  'BLOCKTRADES': BTS_UI_CDN,
  'BTWTY':       BTS_UI_CDN,
  'TRADE':       BTS_UI_CDN,
  'TWENTIX':     BTS_UI_CDN,
  'BRDG':        BTS_UI_CDN,
};

/**
 * Returns the logo URL for the given symbol, or null if none is configured.
 *
 * Resolution order:
 *   1. Direct match in ASSET_LOGOS           (e.g. 'BTS', 'USDT')
 *   2. XBTSX prefix  → XBTS DEX CDN          (e.g. 'XBTSX.STH' → ex.xbts.io/…/xbtsx.sth.png)
 *   3. Other gateway → BitShares UI CDN      (e.g. 'GDEX.ETH'   → raw.githubusercontent.com/…/eth.png)
 *   4. null — caller renders the letter-circle fallback
 *
 * If a CDN image 404s, the <img> onerror handler in popup.js replaces it with
 * the letter-circle div automatically — no special handling needed here.
 *
 * @param {string} symbol  e.g. 'BTS', 'XBTSX.BTC', 'XBTSX.STH'
 * @returns {string|null}
 */
export function getAssetLogo(symbol) {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();

  // 1. Direct match (highest priority — use for overrides)
  if (ASSET_LOGOS[upper]) return ASSET_LOGOS[upper];

  // 2 & 3. Gateway-prefix → CDN
  const dot = upper.indexOf('.');
  if (dot !== -1) {
    const prefix = upper.slice(0, dot);
    const base   = upper.slice(dot + 1);
    const cdn    = GATEWAY_CDN[prefix];
    if (cdn) return cdn(base);
  }

  return null;
}
