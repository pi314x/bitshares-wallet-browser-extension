# BitShares Wallet Browser Extension

A secure browser extension for the BitShares blockchain - similar to MetaMask but for BitShares DEX. Supports Chrome, Brave, and Firefox.

![BitShares Wallet](./src/assets/icons/icon.svg)

## Features

### Wallet Management
- Create new wallet with password-protected brainkey
- Import existing wallets via:
  - Account name + password
  - Brainkey phrase
  - WIF private keys
- Secure AES-256-GCM encryption
- Auto-lock functionality (configurable timer or disabled)
- Backup brainkey for recovery

### Asset Management
- View BTS and all BitShares assets
- Real-time balance updates
- USD value display with market prices
- Full transaction history with filtering
- QR code generation for receiving

### Transactions
- Send BTS and other assets
- Recipient account validation
- Optional encrypted memos
- Transaction fee calculation
- Confirmation modal for all transactions

### Full Operation Signing (All 75 BitShares Operations)

The wallet supports signing all 75 BitShares blockchain operation types, not just transfers. Every operation shows a human-readable confirmation dialog before signing.

#### Supported Operation Categories

| Category | Operations |
|----------|-----------|
| Account | account_create, account_update, account_upgrade, account_whitelist, account_transfer |
| Assets | asset_create, asset_update, asset_update_bitasset, asset_update_feed_producers, asset_issue, asset_reserve, asset_fund_fee_pool, asset_settle, asset_global_settle, asset_publish_feed, asset_claim_fees, asset_update_issuer, asset_claim_pool |
| Trading (DEX) | limit_order_create, limit_order_cancel, call_order_update, fill_order, bid_collateral, execute_bid |
| Transfers | transfer, transfer_to_blind, transfer_from_blind, blind_transfer, override_transfer, balance_claim, asset_settle_cancel |
| Proposals | proposal_create, proposal_update, proposal_delete |
| Witnesses | witness_create, witness_update |
| Committee | committee_member_create, committee_member_update, committee_member_update_global_parameters |
| Workers | worker_create |
| Vesting | vesting_balance_create, vesting_balance_withdraw |
| Withdraw Permissions | withdraw_permission_create, withdraw_permission_update, withdraw_permission_claim, withdraw_permission_delete |
| Custom / Misc | custom, assert, fba_distribute |
| Liquidity Pools | liquidity_pool_create, liquidity_pool_delete, liquidity_pool_deposit, liquidity_pool_withdraw, liquidity_pool_exchange |
| Tickets | ticket_create, ticket_update |
| HTLC | htlc_create, htlc_redeem, htlc_redeemed, htlc_extend, htlc_refund |
| Custom Authority | custom_authority_create, custom_authority_update, custom_authority_delete |
| Credit | credit_offer_create, credit_offer_delete, credit_offer_update, credit_offer_accept, credit_deal_repay, credit_deal_expired |
| Samet Fund | samet_fund_create, samet_fund_delete, samet_fund_update, samet_fund_borrow, samet_fund_repay |

#### Human-Readable Operation Display

The signing confirmation dialog renders each operation in a readable format with clearly labeled fields. For example:

- **Transfer**: Shows From / To / Amount / Memo
- **Limit Order Create**: Shows Account / Sell Amount / Buy Amount / Expiration
- **Account Create**: Shows Name / Registrar / Referrer / Keys
- **Asset Create**: Shows Symbol / Precision / Max Supply / Issuer

Unknown or future operations gracefully fall back to a formatted JSON display.

### dApp Integration
- Connect to BitShares dApps
- Sign transactions for connected sites
- Manage site permissions
- BeetEOS/Scatter API compatibility
- Event-based communication

### Settings
- Auto-lock timer configuration
- Network selection (Mainnet/Testnet)
- Custom node configuration
- Connected sites management
- Change wallet password

## Testing

The extension includes a Jest test suite (73 tests) covering the core cryptographic and wallet management logic.

### Running Tests

```bash
npm test
```

### Test Coverage

#### `tests/crypto-utils.test.js`
Tests for `src/lib/crypto-utils.js`:

| Function | Tests |
|----------|-------|
| `generateBrainkey()` | Returns string, 16 words, uppercase, non-deterministic |
| `normalizeBrainkey()` | Trims whitespace, normalizes case, handles edge cases |
| `generateKeysFromBrainkey()` | Returns active/owner/memo keys |
| `generateKeysFromPassword()` | Returns keys from account + password |
| `deriveKey()` | PBKDF2 derivation produces correct-length key |
| `encrypt()` + `decrypt()` | Round-trip encryption/decryption |
| `generateSalt()` | Produces non-empty, unique salts |
| Edge cases | Null/empty inputs, malformed data |

#### `tests/wallet-manager.test.js`
Tests for `src/lib/wallet-manager.js`:

| Function | Tests |
|----------|-------|
| `hasWallet()` | False when empty, true after save, false after clear |
| `createWallet()` | Resolves true, stores wallet, correct structure, unlocked on creation, brainkey encrypted |
| `unlock()` | True with correct password, false with wrong, state changes, decryptedKeys populated |
| `lock()` | Clears state, clears keys, idempotent, re-unlock works, sends WALLET_LOCKED message |
| `isUnlocked()` | Reflects locked/unlocked state accurately |

#### Test Infrastructure

- **Mocks**: `tests/__mocks__/chrome.js` — in-memory `chrome.storage.local` mock with `__resetStorage()` helper
- **Mocks**: `tests/__mocks__/bitshares-api.js` — stub for BitShares API calls
- **Timer cleanup**: `afterAll()` calls `jest.clearAllTimers()` to prevent open handle warnings from auto-lock timers
- **State isolation**: Each test resets storage via `resetStorage()` and tears down manager state via `silentLock()`

## Browser Support

| Browser | Status | Manifest |
|---------|--------|----------|
| Chrome  | Supported | MV3 |
| Brave   | Supported | MV3 (same as Chrome) |
| Firefox | Supported | MV2 |

## Installation

### From Release

1. Download the latest release zip for your browser from [Releases](https://github.com/pi314x/bitshares-wallet-extension/releases)
2. Follow the browser-specific instructions below

### Chrome / Brave

1. Open `chrome://extensions/` (or `brave://extensions/`)
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the extracted `dist` folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file inside the extracted `dist-firefox` folder

### Build from Source

```bash
git clone https://github.com/pi314x/bitshares-wallet-extension.git
cd bitshares-wallet-extension
```

```bash
# Chrome / Brave
npm run build

# Firefox
npm run build:firefox

# Both
npm run build:all
```

Output goes to `dist/` (Chrome/Brave) and `dist-firefox/` (Firefox).

## Project Structure

```
bitshares-wallet-extension/
├── manifest.json              # Chrome/Brave manifest (MV3)
├── manifest.firefox.json      # Firefox manifest (MV2)
├── package.json
├── scripts/
│   └── build.js               # Build script (chrome/firefox/all)
├── docs/
│   └── index.html             # GitHub Pages website
├── .github/
│   └── workflows/
│       └── release.yml        # Auto-build & release on tag push
├── src/
│   ├── assets/
│   │   └── icons/             # Extension icons (16, 32, 48, 128px)
│   ├── background/
│   │   ├── service-worker.js  # Background service worker
│   │   └── background-firefox.html  # Firefox background page
│   ├── content/
│   │   ├── inject.js          # Content script injector
│   │   └── inpage.js          # Page-context provider API
│   ├── lib/
│   │   ├── bitshares-api.js   # BitShares blockchain API
│   │   ├── crypto-utils.js    # Cryptographic utilities
│   │   ├── identicon.js       # Account identicon generator
│   │   ├── qr-generator.js    # QR code generator
│   │   └── wallet-manager.js  # Wallet state management
│   └── popup/
│       ├── popup.html         # Main popup UI
│       ├── popup.css          # Styling
│       └── popup.js           # Popup logic (operation signing + display)
├── tests/
│   ├── __mocks__/
│   │   ├── chrome.js          # chrome.storage.local / runtime mock
│   │   └── bitshares-api.js   # BitShares API stub
│   ├── crypto-utils.test.js   # Tests for CryptoUtils
│   └── wallet-manager.test.js # Tests for WalletManager
├── dist/                      # Chrome/Brave build output
└── dist-firefox/              # Firefox build output
```

## API for dApp Developers

### Detecting the Wallet

```javascript
// Wait for wallet to be ready
window.addEventListener('bitsharesWalletReady', (event) => {
  const provider = event.detail.provider;
  console.log('BitShares Wallet detected!');
});

// Or check directly
if (window.bitsharesWallet) {
  console.log('BitShares Wallet is available');
}
```

### Connecting to the Wallet

```javascript
// Connect and get account
const account = await window.bitsharesWallet.connect();
console.log('Connected:', account.name, account.id);

// Check connection status
if (window.bitsharesWallet.isConnected) {
  // Already connected
}
```

### Getting Account Information

```javascript
const account = await window.bitsharesWallet.getAccount();
console.log('Account name:', account.name);
console.log('Account ID:', account.id);
```

### Signing Transactions

The wallet supports signing any of the 75 BitShares operation types. Each operation triggers a human-readable confirmation dialog in the extension popup. The user has **90 seconds** to approve or reject before the request times out.

```javascript
// Transfer (operation type 0)
const transferTx = {
  operations: [
    [0, {
      fee: { amount: 0, asset_id: '1.3.0' },
      from: '1.2.xxxxx',
      to: '1.2.yyyyy',
      amount: { amount: 100000, asset_id: '1.3.0' }
    }]
  ]
};
const result = await window.bitsharesWallet.signTransaction(transferTx);
// result: { success: true, signedTx: { ...signed transaction object } }
// or on rejection/error: { success: false, error: 'User rejected transaction' }

// Limit Order (operation type 1)
const limitOrderTx = {
  operations: [
    [1, {
      fee: { amount: 0, asset_id: '1.3.0' },
      seller: '1.2.xxxxx',
      amount_to_sell: { amount: 500000, asset_id: '1.3.0' },
      min_to_receive: { amount: 1000, asset_id: '1.3.861' },
      expiration: '2026-12-31T00:00:00'
    }]
  ]
};
const orderResult = await window.bitsharesWallet.signTransaction(limitOrderTx);
```

Multi-operation transactions are supported — each operation is shown as a separate labeled section in the confirmation dialog.

### Event Listeners

```javascript
// Listen for account changes
window.bitsharesWallet.on('accountChanged', (account) => {
  console.log('Account changed to:', account.name);
});

// Listen for lock events
window.bitsharesWallet.on('locked', () => {
  console.log('Wallet was locked');
});

// Listen for unlock events
window.bitsharesWallet.on('unlocked', () => {
  console.log('Wallet was unlocked');
});
```

### BeetEOS Compatibility

The wallet also provides BeetEOS-compatible API:

```javascript
// Using Beet-style API
const identity = await window.beet.requestIdentity();
console.log('Account:', identity.accounts[0].name);

// Sign transaction
const result = await window.beet.requestSignature({
  transaction: myTransaction
});
```

## Security

- **Private keys** are encrypted using AES-256-GCM with PBKDF2-derived keys
- **Brainkey** is never stored unencrypted
- **Session storage** is used for temporary unlock state (cleared when browser closes)
- **Auto-lock** prevents unauthorized access after inactivity
- **dApp connections** require explicit user approval
- **All transactions** must be confirmed in the popup with human-readable operation details

### Best Practices

1. Always backup your brainkey in a secure location
2. Use a strong wallet password
3. Enable auto-lock with a short timer
4. Review transaction details before confirming
5. Only connect to trusted dApps
6. Disconnect from sites when not in use

## BitShares Network

### Mainnet Nodes
- `wss://eu.nodes.bitshares.ws`
- `wss://us.nodes.bitshares.ws`
- `wss://api.bitshares.dev`
- `wss://node.xbts.io/ws`

### Testnet Nodes
- `wss://testnet.bitshares.eu/ws`
- `wss://testnet.dex.trading/`

## Building for Distribution

```bash
npm run build:all
```

On tag push (`git tag v1.0.0 && git push origin v1.0.0`), GitHub Actions automatically builds and creates a release with both browser zips attached.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [BeetEOS](https://github.com/beetapp/beeteos)
- Based on [MetaMask](https://metamask.io/) UX patterns
- BitShares community and developers

## Website

The project website is hosted on GitHub Pages from the `docs/` folder:

**[https://pi314x.github.io/bitshares-wallet-extension](https://pi314x.github.io/bitshares-wallet-extension)**

To deploy changes, push to the `main` branch. GitHub Pages serves from `Settings > Pages > Source: main branch, /docs folder`.

## Support

- **Website**: [pi314x.github.io/bitshares-wallet-extension](https://pi314x.github.io/bitshares-wallet-extension)
- **Telegram**: [BitShares DEV](https://t.me/BitSharesDEV)
- **GitHub Issues**: [Report bugs](https://github.com/pi314x/bitshares-wallet-extension/issues)
- **BitShares Forum**: [bitsharestalk.org](https://bitsharestalk.org)

---

**Security Notice**: Never share your brainkey or private keys. This wallet stores keys locally on your device only. Always verify you're using the official extension.
