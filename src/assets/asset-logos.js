/**
 * asset-logos.js — Maintainable map of asset symbols → logo image URLs.
 *
 * Add or update entries here when you need a logo for a new asset.
 * Use absolute URLs (https://…) or relative paths inside the extension
 * (e.g. '../assets/logos/mytoken.svg').
 *
 * Assets not listed here fall back to the coloured symbol-letter circle.
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

  // ── BitShares Honest / bridge assets ──────────────────────────────────
  // Add bridged / gateway prefixed variants here, e.g.:
  // 'GDEX.BTC':  'https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=040',
  // 'HONEST.USD': '<url>',
};

/**
 * Returns the logo URL for the given symbol, or null if none is configured.
 * @param {string} symbol  e.g. 'BTS', 'USDT'
 * @returns {string|null}
 */
export function getAssetLogo(symbol) {
  return ASSET_LOGOS[symbol?.toUpperCase()] ?? null;
}
