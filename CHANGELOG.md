# Changelog

All notable changes to the BitShares Wallet Extension are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.4.0] — 2026-03-01

### Added
- **Network selector on the welcome screen** — choose Mainnet or Testnet before
  creating or importing a wallet; selection is persisted across sessions and
  syncs to the dashboard selector
- **Testnet key prefix** (`TEST`) — key generation and import now use the
  correct prefix for the selected network (`BTS` for mainnet, `TEST` for
  testnet); wallet-manager `importWallet` passes the prefix through to
  `generateKeysFromPassword`
- **Import key verification** — when importing by account name + password, the
  generated keys are compared against the account's `active.key_auths`,
  `owner.key_auths`, and `options.memo_key` on-chain before the wallet is
  created; wrong password is rejected with a clear error
- **Premium name import** — account-name format validation is no longer applied
  on the import screen; non-standard / premium names (e.g. single-word,
  short, mixed-case) can now be imported
- **Watch-only accounts in Retrieve Key** — selecting a watch-only account now
  shows "This is a watch-only account — no private keys are stored." instead of
  the generic password-not-found message; watch-only accounts are labelled in
  the selector and checked before the password field is even validated
- **Retrieve Key account list sorted by name**
- **`ensureConnected()` in service worker** — before handling any dApp request
  that needs a chain ID, the service worker now checks whether its active API
  is connected to the network the user last selected in storage; reconnects
  automatically if they diverge (handles missed `NETWORK_SWITCH` messages
  when the worker was sleeping)
- **Chain ID re-validation at approval time** — `approveConnection` re-checks
  the site's declared `chain_id` against the live chain before storing the
  connection; prevents approving a cross-chain connection if the user switched
  networks while the approval popup was open
- **Popup-side chain ID guard** — `checkPendingApproval` validates the site's
  `chain_id` against the popup's active API chain before showing the approval
  modal; rejects immediately on mismatch

### Fixed
- **Service worker network drift** — `initializeAPI()` in the popup now sends
  `NETWORK_SWITCH` to the service worker after every reconnect (not only on
  manual dropdown changes); fixes the case where wallet creation or import on
  a non-default network left the service worker on mainnet
- **`bitsharesPassword` not stored for imported accounts** — `importWallet`
  now stores the BitShares password in the encrypted blob so "Retrieve Private
  Key" works for accounts imported by name + password (matches behaviour
  of `addAccountByCredentials`)

### Changed
- `handleNetworkChange` no longer sends a duplicate `NETWORK_SWITCH` message
  (it now delegates to `initializeAPI()` which handles it)

---

## [0.3.1] — 2026-02-24

### Fixed
- **RIPEMD-160**: Replaced SHA-256 stub with correct pure-JS implementation;
  fixes BTS public key checksums for all key derivation paths
- **Faucet registration (status 500)**: Removed non-standard `chain_id` field
  from the faucet POST payload; account creation on mainnet now succeeds
- **Brainkey backup**: Settings → Backup Brainkey now restores the session
  correctly when the popup has been reopened after an auto-lock

### Added
- **Confirm BitShares Password field**: User must re-enter the auto-generated
  password before wallet creation proceeds; live `✓ Matches` / `✗ Does not
  match` indicator with eye-toggle visibility
- **Pay with account**: Optional field in the create-wallet flow — provide a
  lifetime-member account already in the wallet to pay the `account_create` fee
  directly on-chain instead of using the faucet (faucet remains the default)

### Changed
- **Auto-generated password**: Length increased to 45 characters (`P` + 44
  base58 chars) for stronger entropy
- **Transaction details**: Account IDs (e.g. `1.2.1815585`) are resolved to
  human-readable names; asset amounts now display with correct decimals and
  symbol (e.g. `0.50000 BTS`) instead of raw integers; fee amounts reflect
  real on-chain values
- **Swap screen**: "You Receive" and "Min. Received" fields now include the
  asset symbol; confirmation modal no longer duplicates the symbol

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
