# Changelog

All notable changes to the BitShares Wallet Extension are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-02-19

### Added
- **Full operation signing — all 75 BitShares operation types** covered with
  human-readable confirmation dialogs. Every operation shows clearly labeled
  fields before you approve; no raw hex, no guessing.
  - Transfers & Payments: `transfer`, `balance_claim`, `override_transfer`
  - Trading / DEX: `limit_order_create`, `limit_order_cancel`,
    `call_order_update`, `fill_order`
  - Account Management: `account_create`, `account_update`,
    `account_whitelist`, `account_upgrade`, `account_transfer`
  - Asset Management: `asset_create`, `asset_update`, `asset_update_bitasset`,
    `asset_update_feed_producers`, `asset_issue`, `asset_reserve`,
    `asset_fund_fee_pool`, `asset_settle`, `asset_global_settle`,
    `asset_publish_feed`
  - Asset Fees & Collateral: `asset_settle_cancel`, `asset_claim_fees`,
    `fba_distribute`, `bid_collateral`, `execute_bid`, `asset_claim_pool`,
    `asset_update_issuer`
  - Governance: `witness_create`, `witness_update`, `proposal_create`,
    `proposal_update`, `proposal_delete`, `withdraw_permission_create/update/
    claim/delete`, `committee_member_create/update`,
    `committee_member_update_global_parameters`
  - Vesting & Workers: `vesting_balance_create`, `vesting_balance_withdraw`,
    `worker_create`
  - Stealth Transfers: `transfer_to_blind`, `blind_transfer`,
    `transfer_from_blind`
  - HTLC: `htlc_create`, `htlc_redeem`, `htlc_redeemed`, `htlc_extend`,
    `htlc_refund`
  - Custom Authority: `custom_authority_create/update/delete`
  - Tickets: `ticket_create`, `ticket_update`
  - Liquidity Pools: `liquidity_pool_create/delete/deposit/withdraw/exchange`
  - SameT Funds: `samet_fund_create/delete/update/borrow/repay`
  - Credit Offers: `credit_offer_create/delete/update/accept`,
    `credit_deal_repay`, `credit_deal_expired`
  - Utilities: `custom`, `assert`
- 90-second approval timeout on all signing popups
- `{ success, signedTx }` response shape from `signTransaction()`
- 73 passing unit tests covering operation serialization

### Changed
- Landing page (`docs/index.html`):
  - Hero stats bar: 75 operations · 73 tests · MIT · v0.2.0
  - Install guide section (Chrome/Brave load-unpacked + Firefox steps)
  - All-operations reference: collapsible grid of all 75 ops in 15 categories
  - FAQ accordion (6 questions covering install, security, compatibility)
  - Twitter card meta tags, JSON-LD SoftwareApplication schema, canonical URL
  - Fixed `grid-column: span 2` overflow on mobile for feature card
  - Full API reference link in developer section
- `CHANGELOG.md` added

---

## [0.1.0] — 2026-02-01

Initial public release.

### Added
- Wallet creation and import (brainkey, WIF private key, account credentials)
- AES-256-GCM key encryption with PBKDF2 derivation — keys never leave device
- Asset dashboard with real-time BTS balances and USD values
- Send / receive transfers with account validation, fee preview, and encrypted
  memos
- QR code receive screen
- Liquidity-pool swap (BTS ↔ any pool asset)
- Full transaction history with operation-type filter
- BeetEOS-compatible `window.bitsharesWallet` dApp API
- `connect()` / `signTransaction()` / event emitter
- Chrome / Brave (Manifest V3) and Firefox (Manifest V2) builds
- Configurable auto-lock timer and node management
- Open-source MIT licence
