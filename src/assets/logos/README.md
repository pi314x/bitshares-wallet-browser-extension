# Asset Logos

Drop PNG or SVG files here to add logos for wallet assets.

## Naming

Use the **uppercase asset symbol** as the filename:

| Asset | File |
|---|---|
| BTS | `BTS.png` |
| USDT | `USDT.png` |
| XBTSX.STH | `XBTSX.STH.png` |
| XBTSX.BTC | `XBTSX.BTC.png` |

## How it works

`getAssetLogo()` in `asset-logos.js` resolves in this order:

1. **Bundled** — symbol is listed in the `BUNDLED` set → served directly from the extension package (no network request). Add the symbol to `BUNDLED` in `asset-logos.js` after placing the file here.
2. **CDN** — fetched from this folder via `CORE_CDN_BASE` (raw GitHub) on first display, then browser-cached. No code change needed — just push the file.
3. **Fallback** — coloured letter-circle rendered by the wallet UI.

## Recommended format

- **PNG**, 64×64 px or larger, transparent background
- Keep files under 20 KB
