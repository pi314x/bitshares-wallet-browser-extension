/**
 * BitShares Wallet Extension - Popup Main Script
 * Handles all UI interactions and communicates with the background service worker
 */

// Import modules (would be bundled by webpack in production)
import { WalletManager } from '../lib/wallet-manager.js';
import { BitSharesAPI } from '../lib/bitshares-api.js';
import { CryptoUtils } from '../lib/crypto-utils.js';
import { generateQRCode } from '../lib/qr-generator.js';
import { renderIdenticonToCanvas } from '../lib/identicon.js';

// Global state
let walletManager = null;
let btsAPI = null;
let currentScreen = 'loading-screen';
let isLocked = true;

// DOM Elements Cache
const elements = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  setupEventListeners();
  await initializeApp();
});

// Cache frequently used DOM elements
function cacheElements() {
  elements.screens = document.querySelectorAll('.screen');
  elements.loadingScreen = document.getElementById('loading-screen');
  elements.welcomeScreen = document.getElementById('welcome-screen');
  elements.createWalletScreen = document.getElementById('create-wallet-screen');
  elements.backupBrainkeyScreen = document.getElementById('backup-brainkey-screen');
  elements.importWalletScreen = document.getElementById('import-wallet-screen');
  elements.unlockScreen = document.getElementById('unlock-screen');
  elements.dashboardScreen = document.getElementById('dashboard-screen');
  elements.sendScreen = document.getElementById('send-screen');
  elements.receiveScreen = document.getElementById('receive-screen');
  elements.historyScreen = document.getElementById('history-screen');
  elements.settingsScreen = document.getElementById('settings-screen');
  elements.toastContainer = document.getElementById('toast-container');
  
  // Modals
  elements.txConfirmModal = document.getElementById('tx-confirm-modal');
  elements.dappConnectModal = document.getElementById('dapp-connect-modal');
}

// Setup all event listeners
function setupEventListeners() {
  // Welcome screen buttons
  document.getElementById('btn-create-wallet')?.addEventListener('click', () => showScreen('create-wallet-screen'));
  document.getElementById('btn-import-wallet')?.addEventListener('click', () => showScreen('import-wallet-screen'));
  
  // Create wallet flow
  document.getElementById('btn-generate-wallet')?.addEventListener('click', handleGenerateWallet);
  document.getElementById('wallet-account-name')?.addEventListener('input', handleAccountNameInput);
  document.getElementById('wallet-password')?.addEventListener('input', handlePasswordInput);
  document.getElementById('wallet-password-confirm')?.addEventListener('input', validatePasswordMatch);
  document.getElementById('agree-terms')?.addEventListener('change', updateGenerateButtonState);
  document.getElementById('btn-copy-bts-password')?.addEventListener('click', handleCopyBtsPassword);
  document.getElementById('btn-regen-bts-password')?.addEventListener('click', () => {
    populateBtsPassword();
    // Clear confirm field when a new password is generated
    const confirmEl = document.getElementById('wallet-bts-password-confirm');
    if (confirmEl) confirmEl.value = '';
    updateGenerateButtonState();
  });
  document.getElementById('wallet-bts-password-confirm')?.addEventListener('input', updateGenerateButtonState);
  
  // Backup brainkey
  document.getElementById('btn-copy-brainkey')?.addEventListener('click', handleCopyBrainkey);
  document.getElementById('btn-verify-brainkey')?.addEventListener('click', handleVerifyBrainkey);
  
  // Import wallet
  setupImportTabs();
  document.getElementById('btn-import-submit')?.addEventListener('click', handleImportWallet);
  
  // Unlock screen
  document.getElementById('btn-unlock')?.addEventListener('click', handleUnlock);
  document.getElementById('unlock-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleUnlock();
  });
  document.getElementById('btn-reset-wallet-unlock')?.addEventListener('click', handleResetWallet);
  
  // Dashboard actions
  document.getElementById('btn-lock')?.addEventListener('click', handleLock);
  document.getElementById('btn-settings')?.addEventListener('click', handleShowSettings);
  document.getElementById('btn-send')?.addEventListener('click', handleShowSend);
  document.getElementById('btn-receive')?.addEventListener('click', handleShowReceive);
  document.getElementById('receive-account-selector')?.addEventListener('change', handleReceiveAccountChange);
  document.getElementById('btn-copy-receive-account')?.addEventListener('click', handleCopyReceiveAccount);
  document.getElementById('btn-history')?.addEventListener('click', handleShowHistory);
  document.getElementById('history-filter-select')?.addEventListener('change', handleHistoryFilter);
  document.getElementById('btn-swap')?.addEventListener('click', handleShowSwap);
  document.getElementById('network-select')?.addEventListener('change', handleNetworkChange);
  document.getElementById('account-selector')?.addEventListener('change', handleAccountChange);
  document.getElementById('btn-add-account-submit')?.addEventListener('click', handleAddAccount);

  // Send screen
  document.getElementById('send-to')?.addEventListener('input', handleRecipientInput);
  document.getElementById('send-asset')?.addEventListener('change', updateSendAvailableBalance);
  document.getElementById('btn-max-amount')?.addEventListener('click', handleMaxAmount);
  document.getElementById('btn-send-confirm')?.addEventListener('click', handleSendReview);
  
  // Transaction confirmation modal
  document.getElementById('btn-tx-cancel')?.addEventListener('click', () => hideModal('tx-confirm-modal'));
  document.getElementById('btn-tx-confirm')?.addEventListener('click', handleConfirmTransaction);
  
  // dApp connection modal
  document.getElementById('btn-dapp-reject')?.addEventListener('click', handleDappRejectUpdated);
  document.getElementById('btn-dapp-connect')?.addEventListener('click', handleDappConnectUpdated);
  document.getElementById('btn-transfer-reject')?.addEventListener('click', handleTransferReject);
  document.getElementById('btn-transfer-approve')?.addEventListener('click', handleTransferApprove);
  document.getElementById('btn-tx-sign-reject')?.addEventListener('click', handleTransactionSignReject);
  document.getElementById('btn-tx-sign-approve')?.addEventListener('click', handleTransactionSignApprove);
  
  // Settings
  document.getElementById('setting-backup')?.addEventListener('click', handleShowBackup);
  document.getElementById('btn-reset-wallet')?.addEventListener('click', handleResetWallet);
  document.getElementById('autolock-timer')?.addEventListener('change', handleAutolockChange);
  document.getElementById('setting-nodes')?.addEventListener('click', handleShowNodes);
  document.getElementById('setting-connections')?.addEventListener('click', handleShowConnections);
  document.getElementById('setting-accounts')?.addEventListener('click', handleShowAccounts);
  document.getElementById('btn-add-account-settings')?.addEventListener('click', () => showScreen('add-account-screen'));
  document.getElementById('add-account-watch-only')?.addEventListener('change', handleWatchOnlyToggle);
  document.getElementById('setting-fees')?.addEventListener('click', handleShowFees);
  document.getElementById('btn-refresh-fees')?.addEventListener('click', loadNetworkFees);
  document.getElementById('btn-show-dev-docs')?.addEventListener('click', () => showScreen('dev-docs-screen'));

  // Code block copy buttons
  document.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const codeBlock = btn.closest('.code-wrapper').querySelector('.code-block');
      copyCodeBlock(codeBlock, btn);
    });
  });

  // Click on code block to copy
  document.querySelectorAll('.code-block.copyable').forEach(block => {
    block.addEventListener('click', () => {
      const btn = block.closest('.code-wrapper').querySelector('.code-copy-btn');
      copyCodeBlock(block, btn);
    });
  });

  // Node management
  document.getElementById('btn-add-node')?.addEventListener('click', handleAddNode);
  document.getElementById('btn-test-nodes')?.addEventListener('click', handleTestAllNodes);
  document.getElementById('btn-reset-nodes')?.addEventListener('click', handleResetNodes);

  // Back buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      showScreen(target);
    });
  });
  
  // Modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.remove('active');
    });
  });

  // Password visibility toggles
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        eyeOpen.style.display = 'none';
        eyeClosed.style.display = 'block';
      } else {
        input.type = 'password';
        eyeOpen.style.display = 'block';
        eyeClosed.style.display = 'none';
      }
    });
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}

// Initialize the application
async function initializeApp() {
  try {
    // Initialize wallet manager
    walletManager = new WalletManager();

    // Check if wallet exists
    const hasWallet = await walletManager.hasWallet();

    // Simulate loading time for UX
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (hasWallet) {
      // Check if wallet is unlocked
      const isUnlocked = await walletManager.isUnlocked();
      if (isUnlocked) {
        await initializeAPI();
        await loadDashboard();
        showScreen('dashboard-screen');
        isLocked = false;
        // Check for pending dApp approval requests
        await checkPendingApproval();
      } else {
        showScreen('unlock-screen');
        // Check if there's a pending approval and show indicator
        await showPendingApprovalIndicator();
      }
    } else {
      showScreen('welcome-screen');
    }

    // Test all nodes in background (don't await - runs asynchronously)
    testAllNodesInBackground();
  } catch (error) {
    console.error('Initialization error:', error);
    showToast('Failed to initialize wallet', 'error');
    showScreen('welcome-screen');
  }
}

/**
 * Test all nodes in background without showing UI notifications
 * Called on startup to populate node status for the nodes screen
 * Automatically connects to the fastest available node
 */
async function testAllNodesInBackground() {
  try {
    const savedNodes = await getSavedNodes();
    const allNodes = [...new Set([...DEFAULT_NODES, ...savedNodes])];

    // Test all nodes in parallel
    await Promise.all(allNodes.map(node => testNode(node)));
    console.log('Background node testing complete');

    // Find fastest online node
    let fastestNode = null;
    let fastestLatency = Infinity;

    for (const [node, status] of nodeStatuses) {
      if (status.online && status.latency < fastestLatency) {
        fastestLatency = status.latency;
        fastestNode = node;
      }
    }

    // Connect to fastest node if found and not already connected
    if (fastestNode && (!btsAPI || !btsAPI.isConnected || btsAPI.currentNode !== fastestNode)) {
      console.log(`Connecting to fastest node: ${fastestNode} (${fastestLatency}ms)`);
      try {
        if (btsAPI) {
          await btsAPI.disconnect();
        }
        btsAPI = new BitSharesAPI([fastestNode]);
        await btsAPI.connect();
        console.log('Connected to fastest node');
      } catch (e) {
        console.warn('Failed to connect to fastest node, falling back to default:', e);
      }
    }
  } catch (error) {
    console.error('Background node testing failed:', error);
  }
}

// Initialize BitShares API connection
async function initializeAPI() {
  // Disconnect existing connection if any
  if (btsAPI && btsAPI.isConnected) {
    try {
      await btsAPI.disconnect();
    } catch (e) {
      console.warn('Error disconnecting existing API:', e);
    }
  }

  const network = document.getElementById('network-select')?.value || 'mainnet';
  const nodes = getNetworkNodes(network);

  btsAPI = new BitSharesAPI(nodes);
  await btsAPI.connect();
}

// Get network nodes based on selected network
function getNetworkNodes(network) {
  // Use centralized reliable node list (January 2026)
  const nodes = {
    mainnet: [
      'wss://node.xbts.io/ws',       // xbtsio-wallet, Germany/Falkenstein, 142.6ms
      'wss://cloud.xbts.io/ws',      // xbtsio-wallet, USA/Ashburn, 209.8ms
      'wss://public.xbts.io/ws',     // xbtsio-wallet, Germany/Nuremberg, 245.7ms
      'wss://btsws.roelandp.nl/ws',  // roelandp, Finland/Helsinki, 284.1ms
      'wss://dex.iobanker.com/ws',   // iobanker-core, Germany/Frankfurt, 427.1ms
      'wss://api.bitshares.dev/ws'   // in.abit, USA/Virginia, 543.5ms
    ],
    testnet: [
      'wss://testnet.dex.trading/'
    ]
  };
  return nodes[network] || nodes.mainnet;
}

// Screen navigation
function showScreen(screenId) {
  elements.screens.forEach(screen => {
    screen.classList.remove('active');
  });

  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.add('active');
    currentScreen = screenId;
  }

  // Re-enable unlock inputs when showing unlock screen
  if (screenId === 'unlock-screen') {
    const passwordField = document.getElementById('unlock-password');
    const unlockBtn = document.getElementById('btn-unlock');
    const eyeToggle = document.querySelector('.password-toggle[data-target="unlock-password"]');
    if (passwordField) passwordField.disabled = false;
    if (unlockBtn) unlockBtn.disabled = false;
    if (eyeToggle) eyeToggle.disabled = false;
  }

  // Clear sensitive forms when navigating to welcome screen
  if (screenId === 'welcome-screen') {
    clearCreateWalletForm();
    clearImportWalletForm();
  }

  // Auto-generate a fresh BitShares password each time the create screen is shown
  if (screenId === 'create-wallet-screen') {
    populateBtsPassword();
  }
}

// Show modal
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

// Hide modal
function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

// Toast notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  elements.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'toastSlide 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// === Create Wallet Flow ===

// Validate BitShares account name format
function validateAccountNameFormat(name) {
  if (!name) return null; // empty, not an error yet
  if (name.length < 3) return 'Too short (min 3 characters)';
  if (name.length > 41) return 'Too long (max 41 characters)';
  if (!/^[a-z]/.test(name)) return 'Must start with a lowercase letter';
  if (/[^a-z0-9-]/.test(name)) return 'Only lowercase letters, digits and hyphens allowed';
  if (/--/.test(name)) return 'No consecutive hyphens allowed';
  if (/-$/.test(name)) return 'Cannot end with a hyphen';
  // Free (faucet) registration requires a hyphen, a digit, or no vowels.
  // Pure letter names with vowels are "premium" names that require a paid fee.
  const hasHyphen = name.includes('-');
  const hasDigit = /[0-9]/.test(name);
  const hasVowel = /[aeiou]/.test(name);
  if (!hasHyphen && !hasDigit && hasVowel) {
    return 'Premium name — must contain a hyphen or digit (e.g., my-name or name1) for free registration';
  }
  return null; // valid
}

let accountNameCheckTimeout;

function handleAccountNameInput(e) {
  const name = e.target.value.trim();
  const statusEl = document.getElementById('wallet-account-name-status');

  clearTimeout(accountNameCheckTimeout);

  if (!name) {
    statusEl.textContent = '';
    updateGenerateButtonState();
    return;
  }

  const formatError = validateAccountNameFormat(name);
  if (formatError) {
    statusEl.textContent = '✗ ' + formatError;
    statusEl.className = 'input-status invalid';
    updateGenerateButtonState();
    return;
  }

  statusEl.textContent = 'Checking...';
  statusEl.className = 'input-status';

  accountNameCheckTimeout = setTimeout(async () => {
    try {
      if (btsAPI && btsAPI.isConnected) {
        const account = await btsAPI.getAccount(name);
        if (account) {
          statusEl.textContent = '✗ Name already taken';
          statusEl.className = 'input-status invalid';
        } else {
          statusEl.textContent = '✓ Name available';
          statusEl.className = 'input-status valid';
        }
      } else {
        statusEl.textContent = '✓ Valid format';
        statusEl.className = 'input-status valid';
      }
    } catch (error) {
      statusEl.textContent = '✓ Valid format';
      statusEl.className = 'input-status valid';
    }
    updateGenerateButtonState();
  }, 500);
}

// Generate a strong random password using the base58 alphabet (no 0/O/I/l confusion).
// Produces a 45-char string: "P5" prefix + 43 random base58 characters.
function generateStrongPassword() {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const len = alphabet.length; // 58
  // Rejection sampling to eliminate modulo bias
  const limit = 256 - (256 % len); // 232 — largest multiple of 58 ≤ 256
  const result = [];
  while (result.length < 43) {
    const bytes = new Uint8Array(64); // over-sample to reduce loops
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && result.length < 43; i++) {
      if (bytes[i] < limit) {
        result.push(alphabet[bytes[i] % len]);
      }
    }
  }
  return 'P5' + result.join('');
}

function populateBtsPassword() {
  const el = document.getElementById('wallet-bts-password');
  if (el) el.value = generateStrongPassword();
}

async function handleCopyBtsPassword() {
  const password = document.getElementById('wallet-bts-password')?.value;
  if (!password) return;
  try {
    await navigator.clipboard.writeText(password);
    showToast('BitShares password copied!', 'success');
  } catch {
    showToast('Failed to copy password', 'error');
  }
}

function handlePasswordInput(e) {
  const password = e.target.value;
  const strengthIndicator = document.getElementById('password-strength');

  if (strengthIndicator) {
    const strength = calculatePasswordStrength(password);
    strengthIndicator.className = 'password-strength ' + strength;
  }

  validatePasswordMatch();
}

function calculatePasswordStrength(password) {
  if (password.length < 8) return 'weak';

  let score = 0;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score < 3) return 'weak';
  if (score < 4) return 'medium';
  return 'strong';
}

function validatePasswordMatch() {
  const password = document.getElementById('wallet-password')?.value;
  const confirm = document.getElementById('wallet-password-confirm')?.value;

  if (confirm && password !== confirm) {
    document.getElementById('wallet-password-confirm')?.classList.add('error');
  } else {
    document.getElementById('wallet-password-confirm')?.classList.remove('error');
  }

  updateGenerateButtonState();
}

function updateGenerateButtonState() {
  const accountName = document.getElementById('wallet-account-name')?.value?.trim();
  const btsPassword = document.getElementById('wallet-bts-password')?.value;
  const btsConfirm = document.getElementById('wallet-bts-password-confirm')?.value;
  const password = document.getElementById('wallet-password')?.value;
  const confirm = document.getElementById('wallet-password-confirm')?.value;
  const agreed = document.getElementById('agree-terms')?.checked;
  const btn = document.getElementById('btn-generate-wallet');

  const accountNameFormatOk = accountName && !validateAccountNameFormat(accountName);
  const accountNameStatusInvalid = document.getElementById('wallet-account-name-status')?.classList.contains('invalid');
  const btsPasswordsMatch = btsPassword?.length > 0 && btsPassword === btsConfirm;
  const localPasswordsMatch = password?.length >= 8 && password === confirm;

  // Update BTS confirm status indicator
  const btsConfirmStatus = document.getElementById('wallet-bts-confirm-status');
  if (btsConfirmStatus) {
    if (!btsConfirm) {
      btsConfirmStatus.textContent = '';
      btsConfirmStatus.className = 'input-status';
    } else if (btsPassword === btsConfirm) {
      btsConfirmStatus.textContent = '✓ Matches';
      btsConfirmStatus.className = 'input-status valid';
    } else {
      btsConfirmStatus.textContent = '✗ Does not match';
      btsConfirmStatus.className = 'input-status invalid';
    }
  }

  const isValid = accountNameFormatOk && !accountNameStatusInvalid && btsPasswordsMatch && localPasswordsMatch && agreed;
  btn.disabled = !isValid;
}

function clearCreateWalletForm() {
  ['wallet-account-name', 'wallet-fee-account', 'wallet-bts-password-confirm',
   'wallet-password', 'wallet-password-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const agreeTerms = document.getElementById('agree-terms');
  if (agreeTerms) agreeTerms.checked = false;
  const statusEl = document.getElementById('wallet-account-name-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'input-status'; }
  const btsConfirmStatus = document.getElementById('wallet-bts-confirm-status');
  if (btsConfirmStatus) { btsConfirmStatus.textContent = ''; btsConfirmStatus.className = 'input-status'; }
  // Regenerate a fresh BTS password
  populateBtsPassword();
  const btn = document.getElementById('btn-generate-wallet');
  if (btn) btn.disabled = true;
}

async function handleGenerateWallet() {
  const btsAccountName = document.getElementById('wallet-account-name')?.value?.trim();
  const btsPassword = document.getElementById('wallet-bts-password')?.value;
  const password = document.getElementById('wallet-password')?.value;
  const feeAccount = document.getElementById('wallet-fee-account')?.value?.trim();

  if (!btsAccountName) {
    showToast('Please enter a BitShares account name', 'error');
    return;
  }
  const nameError = validateAccountNameFormat(btsAccountName);
  if (nameError) {
    showToast('Account name: ' + nameError, 'error');
    return;
  }
  if (!btsPassword) {
    showToast('BitShares password is missing — please regenerate', 'error');
    return;
  }

  const btn = document.getElementById('btn-generate-wallet');
  const originalText = btn.textContent;

  try {
    // Derive the keys that will control the on-chain account
    const keys = await CryptoUtils.generateKeysFromPassword(btsAccountName, btsPassword);

    // Register account on-chain — via a wallet account if provided, otherwise faucet
    btn.disabled = true;
    btn.textContent = 'Registering account…';

    if (feeAccount) {
      showToast(`Registering account via "${feeAccount}"…`, 'info');
      await walletManager.createAccountOnChain(btsAccountName, keys, feeAccount);
    } else {
      showToast('Registering account via faucet…', 'info');
      await walletManager.registerAccountViaFaucet(btsAccountName, keys);
    }

    // Generate brainkey for backup, then store the wallet locally
    btn.textContent = 'Creating wallet…';
    const brainkey = CryptoUtils.generateBrainkey();
    await walletManager.createWallet('BitShares Wallet', password, brainkey, btsAccountName, btsPassword);

    // Clear the form (also regenerates the displayed BTS password)
    clearCreateWalletForm();

    displayBrainkey(brainkey);
    showScreen('backup-brainkey-screen');
    showToast('Account registered! Save your brainkey and BitShares password.', 'success');
  } catch (error) {
    console.error('Failed to create wallet:', error);
    showToast(error.message, 'error');
    btn.disabled = false;
    btn.textContent = originalText;
    updateGenerateButtonState();
  }
}

function displayBrainkey(brainkey) {
  const container = document.getElementById('brainkey-display');
  container.innerHTML = '';
  
  const words = brainkey.split(' ');
  words.forEach((word, index) => {
    const wordEl = document.createElement('div');
    wordEl.className = 'brainkey-word';
    wordEl.setAttribute('data-index', index + 1);
    wordEl.textContent = word;
    container.appendChild(wordEl);
  });
}

async function handleCopyBrainkey() {
  const words = document.querySelectorAll('.brainkey-word');
  const brainkey = Array.from(words).map(w => w.textContent).join(' ');

  try {
    await navigator.clipboard.writeText(brainkey);
    showToast('Brainkey copied to clipboard!', 'success');
  } catch (error) {
    showToast('Failed to copy brainkey', 'error');
  }
}

async function copyCodeBlock(codeBlock, copyBtn) {
  const code = codeBlock?.textContent || '';
  try {
    await navigator.clipboard.writeText(code);
    showToast('Code copied!', 'success');
    if (copyBtn) {
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1500);
    }
  } catch (error) {
    showToast('Failed to copy code', 'error');
  }
}

async function handleVerifyBrainkey() {
  await initializeAPI();
  await loadDashboard();
  showScreen('dashboard-screen');
  isLocked = false;
}

// === Import Wallet Flow ===

function setupImportTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.import-tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');

      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(tabId)?.classList.add('active');
    });
  });
}

function clearImportWalletForm() {
  const fields = [
    'import-account-name', 'import-account-password',
    'import-brainkey-input',
    'import-wallet-password', 'import-wallet-password-confirm'
  ];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const statusEl = document.getElementById('import-account-name-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'input-status'; }
  // Reset tabs to default (account tab)
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.import-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="import-account"]')?.classList.add('active');
  document.getElementById('import-account')?.classList.add('active');
}

async function handleImportWallet() {
  const activeTab = document.querySelector('.import-tab-content.active');
  const tabId = activeTab?.id;
  const walletPassword = document.getElementById('import-wallet-password')?.value;
  const walletPasswordConfirm = document.getElementById('import-wallet-password-confirm')?.value;

  if (!walletPassword || walletPassword.length < 8) {
    showToast('Please enter a wallet password (min 8 characters)', 'error');
    return;
  }

  if (walletPassword !== walletPasswordConfirm) {
    showToast('Wallet passwords do not match', 'error');
    return;
  }

  try {
    let importData = {};

    switch (tabId) {
      case 'import-account': {
        const accountName = document.getElementById('import-account-name')?.value?.trim();
        const accountPassword = document.getElementById('import-account-password')?.value;
        if (!accountName) {
          showToast('Please enter the BitShares account name', 'error');
          return;
        }
        const nameError = validateAccountNameFormat(accountName);
        if (nameError) {
          showToast('Account name: ' + nameError, 'error');
          return;
        }
        if (!accountPassword) {
          showToast('Please enter the BitShares password', 'error');
          return;
        }
        importData = { type: 'account', accountName, password: accountPassword };
        break;
      }

      case 'import-brainkey': {
        const brainkey = document.getElementById('import-brainkey-input')?.value?.trim();
        if (!brainkey) {
          showToast('Please enter your brainkey', 'error');
          return;
        }
        importData = { type: 'brainkey', brainkey };
        break;
      }
    }

    await walletManager.importWallet(importData, walletPassword);
    await initializeAPI();
    await loadDashboard();

    // Clear form immediately after successful import
    clearImportWalletForm();

    showScreen('dashboard-screen');
    isLocked = false;
    showToast('Wallet imported successfully!', 'success');
  } catch (error) {
    console.error('Import error:', error);
    showToast('Failed to import wallet: ' + error.message, 'error');
  }
}

// === Unlock Flow ===

async function handleUnlock() {
  const passwordField = document.getElementById('unlock-password');
  const unlockBtn = document.getElementById('btn-unlock');
  const eyeToggle = document.querySelector('.password-toggle[data-target="unlock-password"]');
  const password = passwordField?.value;

  if (!password) {
    showToast('Please enter your password', 'error');
    return;
  }

  // Disable inputs while unlocking
  if (passwordField) passwordField.disabled = true;
  if (unlockBtn) unlockBtn.disabled = true;
  if (eyeToggle) eyeToggle.disabled = true;

  try {
    const success = await walletManager.unlock(password);

    if (success) {
      // Show dots immediately (hide visible password)
      passwordField.type = 'password';
      if (eyeToggle) {
        eyeToggle.querySelector('.eye-open').style.display = '';
        eyeToggle.querySelector('.eye-closed').style.display = 'none';
      }

      await initializeAPI();
      await loadDashboard();
      showScreen('dashboard-screen');
      isLocked = false;
      // Clear password after transition
      passwordField.value = '';

      // Check for pending dApp approval requests after unlock
      await checkPendingApproval();
    } else {
      showToast('Invalid password', 'error');
      // Re-enable on failure
      if (passwordField) passwordField.disabled = false;
      if (unlockBtn) unlockBtn.disabled = false;
      if (eyeToggle) eyeToggle.disabled = false;
    }
  } catch (error) {
    console.error('Unlock error:', error);
    showToast('Failed to unlock wallet', 'error');
    // Re-enable on error
    if (passwordField) passwordField.disabled = false;
    if (unlockBtn) unlockBtn.disabled = false;
    if (eyeToggle) eyeToggle.disabled = false;
  }
}

async function handleLock() {
  await walletManager.lock();
  isLocked = true;
  showScreen('unlock-screen');
  showToast('Wallet locked', 'info');
}

// === Dashboard ===

async function loadDashboard(forceReconnect = false) {
  try {
    // Ensure API is connected before loading data
    if (!btsAPI || !btsAPI.isConnected || forceReconnect) {
      await initializeAPI();
    }

    const account = await walletManager.getCurrentAccount();
    const allAccounts = await walletManager.getAllAccounts();

    console.log('loadDashboard - current account:', account);
    console.log('loadDashboard - all accounts:', allAccounts);

    // Populate account selector
    const accountSelector = document.getElementById('account-selector');
    if (accountSelector) {
      accountSelector.innerHTML = '';
      allAccounts.forEach(acc => {
        const option = document.createElement('option');
        option.value = acc.id;
        option.textContent = acc.watchOnly ? `${acc.name} (Watch Only)` : acc.name;
        option.selected = acc.id === account.id;
        accountSelector.appendChild(option);
      });
    }

    // Update account info - check if watch-only
    const isWatchOnly = await walletManager.isWatchOnlyAccount(account.id);
    const accountIdEl = document.getElementById('account-id');
    accountIdEl.textContent = isWatchOnly ? `${account.id} (Watch Only)` : account.id;
    accountIdEl.dataset.accountId = account.id; // Store raw ID for comparisons

    // Update avatar with identicon
    const avatarCanvas = document.getElementById('account-avatar');
    if (avatarCanvas) {
      await renderIdenticonToCanvas(avatarCanvas, account.name);
    }

    // Load balances
    await loadBalances(account.id);

    // Load transaction history
    await loadHistory(account.id);
  } catch (error) {
    console.error('Failed to load dashboard:', error);
    // If first attempt failed and we haven't tried reconnecting yet, try once more
    if (!forceReconnect) {
      console.log('Retrying with fresh connection...');
      try {
        await loadDashboard(true);
        return;
      } catch (retryError) {
        console.error('Retry also failed:', retryError);
      }
    }
    showToast('Failed to load account data', 'error');
  }
}

async function loadBalances(accountId) {
  try {
    // Check if account exists on chain
    if (!accountId || accountId === '1.2.0') {
      document.getElementById('balance-bts').textContent = '0 BTS';
      document.getElementById('balance-usd').textContent = '≈ $0.00 USD';
      const assetsList = document.getElementById('assets-list');
      assetsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>No account on chain yet</p><p class="hint">Import an existing account to see balances</p></div>';
      return;
    }

    // Ensure API is connected
    if (!btsAPI || !btsAPI.isConnected) {
      await initializeAPI();
    }

    const balances = await btsAPI.getAccountBalances(accountId);

    // Update BTS balance using asset precision
    const btsAsset = await btsAPI.getAsset('1.3.0');
    const btsPrecision = btsAsset?.precision || 5;
    const btsBalance = balances.find(b => b.asset_id === '1.3.0') || { amount: 0 };
    const btsDivisor = Math.pow(10, btsPrecision);
    const btsAmount = (parseInt(btsBalance.amount) / btsDivisor).toFixed(btsPrecision);
    document.getElementById('balance-bts').textContent = `${btsAmount} BTS`;

    // Get BTS price and calculate USD value
    const btsPriceData = await btsAPI.getBTSPrice();
    const btsPrice = btsPriceData.price || 0;
    const usdValue = (parseFloat(btsAmount) * btsPrice).toFixed(2);
    document.getElementById('balance-usd').textContent = `≈ $${usdValue} USD`;

    // Update BTS price display if element exists
    const priceDisplay = document.getElementById('bts-price-display');
    if (priceDisplay && btsPrice > 0) {
      priceDisplay.textContent = `1 BTS = $${btsPrice.toFixed(6)} (${btsPriceData.source || 'N/A'})`;
    } else if (priceDisplay) {
      priceDisplay.textContent = 'Price unavailable';
    }

    // Update assets list
    await updateAssetsList(balances);
  } catch (error) {
    console.error('Failed to load balances:', error);
    document.getElementById('balance-bts').textContent = '0 BTS';
    document.getElementById('balance-usd').textContent = '≈ $0.00 USD';
    const assetsList = document.getElementById('assets-list');
    if (assetsList) {
      assetsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>Failed to load balances</p></div>';
    }
  }
}

async function updateAssetsList(balances) {
  const assetsList = document.getElementById('assets-list');
  assetsList.innerHTML = '';

  for (const balance of balances) {
    if (parseInt(balance.amount) === 0) continue;

    const asset = await btsAPI.getAsset(balance.asset_id);
    const precision = Math.pow(10, asset.precision);
    const amount = (parseInt(balance.amount) / precision).toFixed(asset.precision);

    const assetItem = document.createElement('div');
    assetItem.className = 'asset-item';
    assetItem.style.cursor = 'pointer';
    assetItem.innerHTML = `
      <div class="asset-icon">${asset.symbol.substring(0, 3)}</div>
      <div class="asset-info">
        <div class="asset-name">${asset.symbol}</div>
        <div class="asset-symbol">${asset.id}</div>
      </div>
      <div class="asset-balance">
        <div class="asset-amount">${amount}</div>
      </div>
    `;

    // Click to open send with this asset pre-selected
    assetItem.addEventListener('click', () => {
      handleShowSend(asset.id);
    });

    assetsList.appendChild(assetItem);
  }
  
  if (assetsList.children.length === 0) {
    assetsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">💰</div><p>No assets yet</p></div>';
  }
}

async function loadHistory(accountId) {
  try {
    // Ensure API is connected
    if (!btsAPI || !btsAPI.isConnected) {
      await initializeAPI();
    }

    const history = await btsAPI.getAccountHistory(accountId, 100);
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '';
    
    for (const op of history) {
      const historyItem = await createHistoryItem(op);
      if (historyItem) {
        historyList.appendChild(historyItem);
      }
    }
    
    if (historyList.children.length === 0) {
      historyList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📜</div><p>No transactions yet</p></div>';
    }

    // Reset filter to 'all' when history loads
    const filterSelect = document.getElementById('history-filter-select');
    if (filterSelect) {
      filterSelect.value = 'all';
    }
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}

function handleHistoryFilter() {
  const filterSelect = document.getElementById('history-filter-select');
  const historyList = document.getElementById('history-list');
  const selectedFilter = filterSelect?.value || 'all';

  const items = historyList?.querySelectorAll('.history-item');
  if (!items) return;

  let visibleCount = 0;
  items.forEach(item => {
    const opType = item.dataset.opType;
    if (selectedFilter === 'all' || opType === selectedFilter) {
      item.style.display = '';
      visibleCount++;
    } else {
      item.style.display = 'none';
    }
  });

  // Show empty state if no items match filter
  let emptyState = historyList.querySelector('.empty-state-filter');
  if (visibleCount === 0 && items.length > 0) {
    if (!emptyState) {
      emptyState = document.createElement('div');
      emptyState.className = 'empty-state empty-state-filter';
      emptyState.innerHTML = '<div class="empty-state-icon">🔍</div><p>No matching transactions</p>';
      historyList.appendChild(emptyState);
    }
    emptyState.style.display = '';
  } else if (emptyState) {
    emptyState.style.display = 'none';
  }
}

async function createHistoryItem(operation) {
  const op = operation.op;
  const opType = op[0];
  const opData = op[1];
  const txId = operation.id || ''; // Transaction ID like 1.11.xxx

  // Use data attribute for raw account ID (avoids "(Watch Only)" suffix issue)
  const currentAccount = document.getElementById('account-id')?.dataset?.accountId || document.getElementById('account-id')?.textContent;

  const item = document.createElement('div');
  item.className = 'history-item';

  // Map operation type to filter category
  const opTypeMap = {
    0: 'transfer',
    1: 'limit_order_create',
    2: 'limit_order_cancel',
    4: 'fill_order',
    14: 'asset_issue',
    63: 'liquidity_pool'
  };
  item.dataset.opType = opTypeMap[opType] || 'other';

  // Operation type mapping:
  // 0 = transfer
  // 1 = limit_order_create
  // 2 = limit_order_cancel
  // 4 = fill_order (virtual)
  // 14 = asset_issue
  // 63 = liquidity_pool_exchange

  switch (opType) {
    case 0: // Transfer
      const isSend = opData.from === currentAccount;
      const transferAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon ${isSend ? 'send' : 'receive'}">${isSend ? '↑' : '↓'}</div>
        <div class="history-info">
          <div class="history-type">${isSend ? 'Sent' : 'Received'}</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount ${isSend ? 'negative' : 'positive'}">
          ${isSend ? '-' : '+'}${transferAmount}
        </div>
      `;
      break;

    case 1: // Limit Order Create
      const sellAmount = await formatAmountWithSymbol(opData.amount_to_sell);
      const buyAmount = await formatAmountWithSymbol(opData.min_to_receive);
      const orderDisplay = (sellAmount && buyAmount)
        ? `${sellAmount} → ${buyAmount}`
        : (sellAmount || '-');
      item.innerHTML = `
        <div class="history-icon trade">⇄</div>
        <div class="history-info">
          <div class="history-type">Order Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">
          ${orderDisplay}
        </div>
      `;
      break;

    case 2: // Limit Order Cancel
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Order Cancelled</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;

    case 4: // Fill Order (trade executed)
      const paysAmount = await formatAmountWithSymbol(opData.pays);
      const receivesAmount = await formatAmountWithSymbol(opData.receives);
      const fillDisplay = (paysAmount && receivesAmount)
        ? `${paysAmount} → ${receivesAmount}`
        : (receivesAmount || paysAmount || '-');
      item.innerHTML = `
        <div class="history-icon trade">⇄</div>
        <div class="history-info">
          <div class="history-type">Trade Filled</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">
          ${fillDisplay}
        </div>
      `;
      break;

    case 14: // Asset Issue (Minting/Issuing supply)
      const isIssuer = opData.issuer === currentAccount;
      const isRecipient = opData.issue_to_account === currentAccount;
      const issueAmount = await formatAmountWithSymbol(opData.asset_to_issue) || '-';
      
      // Determine the context for the UI
      let issueType = 'Asset Issued';
      let issueIcon = '⊕'; // Or use a 'plus' style icon
      let issueClass = 'mint'; // Ensure you have a CSS class for 'mint' or use 'positive'

      if (isRecipient && !isIssuer) {
        issueType = 'Asset Issued';
        issueIcon = '↓';
        issueClass = 'receive';
      }

      item.innerHTML = `
        <div class="history-icon ${issueClass}">${issueIcon}</div>
        <div class="history-info">
          <div class="history-type">${issueType}</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">
          +${issueAmount}
        </div>
      `;
      break;

    case 63: // Liquidity Pool Exchange (swap)
      const swapSellAmount = await formatAmountWithSymbol(opData.amount_to_sell);
      // Try different fields for receive amount: amount_to_receive, min_to_receive, or result
      const swapReceiveData = opData.amount_to_receive || opData.min_to_receive || operation.result?.[1];
      const swapReceiveAmount = await formatAmountWithSymbol(swapReceiveData);
      let swapDisplay = '-';
      if (swapSellAmount && swapReceiveAmount) {
        swapDisplay = `${swapSellAmount} → ${swapReceiveAmount}`;
      } else if (swapSellAmount) {
        swapDisplay = swapSellAmount;
      }
      item.innerHTML = `
        <div class="history-icon swap">⇅</div>
        <div class="history-info">
          <div class="history-type">Swap</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">
          ${swapDisplay}
        </div>
      `;
      break;

    case 3: { // call_order_update
      const collateralAmount = await formatAmountWithSymbol(opData.delta_collateral) || '-';
      item.innerHTML = `
        <div class="history-icon trade">△</div>
        <div class="history-info">
          <div class="history-type">Call Order Update</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${collateralAmount}</div>
      `;
      break;
    }

    case 5: { // account_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Account Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.name || '-')}</div>
      `;
      break;
    }

    case 6: { // account_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Account Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 7: { // account_whitelist
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Account Whitelist</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 8: { // account_upgrade
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Account Upgrade</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 9: { // account_transfer
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Account Transfer</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 10: { // asset_create
      item.innerHTML = `
        <div class="history-icon mint">⊕</div>
        <div class="history-info">
          <div class="history-type">Asset Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.symbol || '-')}</div>
      `;
      break;
    }

    case 11: { // asset_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Asset Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_to_update || '-')}</div>
      `;
      break;
    }

    case 12: { // asset_update_bitasset
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">BitAsset Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_to_update || '-')}</div>
      `;
      break;
    }

    case 13: { // asset_update_feed_producers
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Feed Producers Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_to_update || '-')}</div>
      `;
      break;
    }

    case 15: { // asset_reserve
      const reserveAmount = await formatAmountWithSymbol(opData.amount_to_reserve) || '-';
      item.innerHTML = `
        <div class="history-icon cancel">⊗</div>
        <div class="history-info">
          <div class="history-type">Asset Reserved</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount negative">-${reserveAmount}</div>
      `;
      break;
    }

    case 16: { // asset_fund_fee_pool
      item.innerHTML = `
        <div class="history-icon other">◈</div>
        <div class="history-info">
          <div class="history-type">Fund Fee Pool</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_id || '-')}</div>
      `;
      break;
    }

    case 17: { // asset_settle
      const settleAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon trade">⇄</div>
        <div class="history-info">
          <div class="history-type">Asset Settle</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${settleAmount}</div>
      `;
      break;
    }

    case 18: { // asset_global_settle
      item.innerHTML = `
        <div class="history-icon other">⊗</div>
        <div class="history-info">
          <div class="history-type">Global Settle</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_to_settle || '-')}</div>
      `;
      break;
    }

    case 19: { // asset_publish_feed
      item.innerHTML = `
        <div class="history-icon other">◉</div>
        <div class="history-info">
          <div class="history-type">Publish Feed</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_id || '-')}</div>
      `;
      break;
    }

    case 20: { // witness_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Witness Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 21: { // witness_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Witness Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 22: { // proposal_create
      item.innerHTML = `
        <div class="history-icon other">☐</div>
        <div class="history-info">
          <div class="history-type">Proposal Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 23: { // proposal_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Proposal Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.proposal || '-')}</div>
      `;
      break;
    }

    case 24: { // proposal_delete
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Proposal Deleted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.proposal || '-')}</div>
      `;
      break;
    }

    case 25: { // withdraw_permission_create
      const withdrawLimitAmount = await formatAmountWithSymbol(opData.withdrawal_limit) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Withdraw Permission Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${withdrawLimitAmount}</div>
      `;
      break;
    }

    case 26: { // withdraw_permission_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Withdraw Permission Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 27: { // withdraw_permission_claim
      const withdrawClaimAmount = await formatAmountWithSymbol(opData.amount_to_withdraw) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Withdraw Permission Claim</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${withdrawClaimAmount}</div>
      `;
      break;
    }

    case 28: { // withdraw_permission_delete
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Withdraw Permission Deleted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 29: { // committee_member_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Committee Member Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 30: { // committee_member_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Committee Member Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 31: { // committee_member_update_global_parameters
      item.innerHTML = `
        <div class="history-icon other">⚙</div>
        <div class="history-info">
          <div class="history-type">Global Params Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 32: { // vesting_balance_create
      const vestingCreateAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Vesting Balance Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${vestingCreateAmount}</div>
      `;
      break;
    }

    case 33: { // vesting_balance_withdraw
      const vestingWithdrawAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Vesting Balance Withdraw</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${vestingWithdrawAmount}</div>
      `;
      break;
    }

    case 34: { // worker_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Worker Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.name || '-')}</div>
      `;
      break;
    }

    case 35: { // custom
      item.innerHTML = `
        <div class="history-icon other">◈</div>
        <div class="history-info">
          <div class="history-type">Custom Operation</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 36: { // assert
      item.innerHTML = `
        <div class="history-icon other">◈</div>
        <div class="history-info">
          <div class="history-type">Assert</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 37: { // balance_claim
      const balanceClaimAmount = await formatAmountWithSymbol(opData.total_claimed) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Balance Claimed</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${balanceClaimAmount}</div>
      `;
      break;
    }

    case 38: { // override_transfer
      const overrideTransferAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon send">↑</div>
        <div class="history-info">
          <div class="history-type">Override Transfer</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount negative">-${overrideTransferAmount}</div>
      `;
      break;
    }

    case 39: { // transfer_to_blind
      const toBlindAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon send">↑</div>
        <div class="history-info">
          <div class="history-type">Transfer to Blind</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount negative">-${toBlindAmount}</div>
      `;
      break;
    }

    case 40: { // blind_transfer
      item.innerHTML = `
        <div class="history-icon other">◉</div>
        <div class="history-info">
          <div class="history-type">Blind Transfer</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 41: { // transfer_from_blind
      const fromBlindAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Transfer from Blind</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${fromBlindAmount}</div>
      `;
      break;
    }

    case 42: { // asset_settle_cancel
      const settleCancelAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Settle Cancelled</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${settleCancelAmount}</div>
      `;
      break;
    }

    case 43: { // asset_claim_fees
      const claimFeesAmount = await formatAmountWithSymbol(opData.amount_to_claim) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Fees Claimed</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${claimFeesAmount}</div>
      `;
      break;
    }

    case 44: { // fba_distribute
      item.innerHTML = `
        <div class="history-icon other">◈</div>
        <div class="history-info">
          <div class="history-type">FBA Distribute</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 45: { // bid_collateral
      const bidCollateralAmount = await formatAmountWithSymbol(opData.additional_collateral) || '-';
      item.innerHTML = `
        <div class="history-icon trade">△</div>
        <div class="history-info">
          <div class="history-type">Bid Collateral</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${bidCollateralAmount}</div>
      `;
      break;
    }

    case 46: { // execute_bid
      const executeBidAmount = await formatAmountWithSymbol(opData.debt) || '-';
      item.innerHTML = `
        <div class="history-icon trade">△</div>
        <div class="history-info">
          <div class="history-type">Execute Bid</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${executeBidAmount}</div>
      `;
      break;
    }

    case 47: { // asset_claim_pool
      const claimPoolAmount = await formatAmountWithSymbol(opData.amount_to_claim) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Claim Pool</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${claimPoolAmount}</div>
      `;
      break;
    }

    case 48: { // asset_update_issuer
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Asset Issuer Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.asset_to_update || '-')}</div>
      `;
      break;
    }

    case 49: { // htlc_create
      const htlcCreateAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon send">↑</div>
        <div class="history-info">
          <div class="history-type">HTLC Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount negative">-${htlcCreateAmount}</div>
      `;
      break;
    }

    case 50: { // htlc_redeem
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">HTLC Redeemed</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 51: { // htlc_redeemed (virtual)
      const htlcRedeemedAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">HTLC Redeemed (Virtual)</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${htlcRedeemedAmount}</div>
      `;
      break;
    }

    case 52: { // htlc_extend
      item.innerHTML = `
        <div class="history-icon other">⏱</div>
        <div class="history-info">
          <div class="history-type">HTLC Extended</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 53: { // htlc_refund (virtual)
      item.innerHTML = `
        <div class="history-icon receive">↩</div>
        <div class="history-info">
          <div class="history-type">HTLC Refunded</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 54: { // custom_authority_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Custom Authority Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 55: { // custom_authority_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Custom Authority Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 56: { // custom_authority_delete
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Custom Authority Deleted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 57: { // ticket_create
      const ticketCreateAmount = await formatAmountWithSymbol(opData.amount) || '-';
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Ticket Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${ticketCreateAmount}</div>
      `;
      break;
    }

    case 58: { // ticket_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Ticket Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.ticket || '-')}</div>
      `;
      break;
    }

    case 59: { // liquidity_pool_create
      item.innerHTML = `
        <div class="history-icon mint">⊕</div>
        <div class="history-info">
          <div class="history-type">Pool Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 60: { // liquidity_pool_delete
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Pool Deleted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.pool || '-')}</div>
      `;
      break;
    }

    case 61: { // liquidity_pool_deposit
      const poolDepositAmountA = await formatAmountWithSymbol(opData.amount_a) || '-';
      const poolDepositAmountB = await formatAmountWithSymbol(opData.amount_b) || '-';
      const poolDepositDisplay = (poolDepositAmountA !== '-' && poolDepositAmountB !== '-')
        ? `${poolDepositAmountA} + ${poolDepositAmountB}`
        : (poolDepositAmountA !== '-' ? poolDepositAmountA : poolDepositAmountB);
      item.innerHTML = `
        <div class="history-icon swap">⇅</div>
        <div class="history-info">
          <div class="history-type">Pool Deposit</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${poolDepositDisplay}</div>
      `;
      break;
    }

    case 62: { // liquidity_pool_withdraw
      const poolWithdrawAmount = await formatAmountWithSymbol(opData.share_amount) || '-';
      item.innerHTML = `
        <div class="history-icon swap">⇅</div>
        <div class="history-info">
          <div class="history-type">Pool Withdraw</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${poolWithdrawAmount}</div>
      `;
      break;
    }

    case 64: { // samet_fund_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">SameT Fund Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 65: { // samet_fund_delete
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">SameT Fund Deleted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.fund_id || '-')}</div>
      `;
      break;
    }

    case 66: { // samet_fund_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">SameT Fund Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.fund_id || '-')}</div>
      `;
      break;
    }

    case 67: { // samet_fund_borrow
      const sametBorrowAmount = await formatAmountWithSymbol(opData.borrow_amount) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">SameT Fund Borrow</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${sametBorrowAmount}</div>
      `;
      break;
    }

    case 68: { // samet_fund_repay
      const sametRepayAmount = await formatAmountWithSymbol(opData.repay_amount) || '-';
      item.innerHTML = `
        <div class="history-icon send">↑</div>
        <div class="history-info">
          <div class="history-type">SameT Fund Repay</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount negative">-${sametRepayAmount}</div>
      `;
      break;
    }

    case 69: { // credit_offer_create
      item.innerHTML = `
        <div class="history-icon other">⊕</div>
        <div class="history-info">
          <div class="history-type">Credit Offer Created</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    case 70: { // credit_offer_delete
      item.innerHTML = `
        <div class="history-icon cancel">✕</div>
        <div class="history-info">
          <div class="history-type">Credit Offer Deleted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.offer_id || '-')}</div>
      `;
      break;
    }

    case 71: { // credit_offer_update
      item.innerHTML = `
        <div class="history-icon other">✎</div>
        <div class="history-info">
          <div class="history-type">Credit Offer Updated</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">${escapeHtml(opData.offer_to_update || opData.offer_id || '-')}</div>
      `;
      break;
    }

    case 72: { // credit_offer_accept
      const creditAcceptAmount = await formatAmountWithSymbol(opData.borrow_amount) || '-';
      item.innerHTML = `
        <div class="history-icon receive">↓</div>
        <div class="history-info">
          <div class="history-type">Credit Offer Accepted</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount positive">+${creditAcceptAmount}</div>
      `;
      break;
    }

    case 73: { // credit_deal_repay
      const creditRepayAmount = await formatAmountWithSymbol(opData.repay_amount) || '-';
      item.innerHTML = `
        <div class="history-icon send">↑</div>
        <div class="history-info">
          <div class="history-type">Credit Deal Repay</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount negative">-${creditRepayAmount}</div>
      `;
      break;
    }

    case 74: { // credit_deal_expired (virtual)
      item.innerHTML = `
        <div class="history-icon cancel">⊗</div>
        <div class="history-info">
          <div class="history-type">Credit Deal Expired</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }

    default: {
      const opLabel = OPERATION_NAMES[opType] || `Operation ${opType}`;
      item.innerHTML = `
        <div class="history-icon other">◈</div>
        <div class="history-info">
          <div class="history-type">${escapeHtml(opLabel)}</div>
          <div class="history-date">${formatDate(operation.block_time)}</div>
          <div class="history-txid">${escapeHtml(txId)}</div>
        </div>
        <div class="history-amount">-</div>
      `;
      break;
    }
  }

  // Add click handler to entire item to copy txId to clipboard
  if (txId) {
    item.style.cursor = 'pointer';
    item.title = 'Click to copy transaction ID';
    item.addEventListener('click', () => {
      navigator.clipboard.writeText(txId).then(() => {
        showToast('Transaction ID copied!', 'success');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    });
  }

  return item;
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Format amount with asset symbol, trimming unnecessary trailing zeros
async function formatAmountWithSymbol(amountObj) {
  if (!amountObj || !amountObj.asset_id) return null;

  try {
    const asset = await btsAPI.getAsset(amountObj.asset_id);
    const precision = asset.precision || 5;
    const amount = parseInt(amountObj.amount) / Math.pow(10, precision);
    // Format with full precision, then trim trailing zeros
    let formatted = amount.toFixed(precision);
    // Remove trailing zeros after decimal, keep at least 2 decimals for readability
    formatted = formatted.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return `${formatted} ${asset.symbol}`;
  } catch (e) {
    // Fallback if asset lookup fails
    return null;
  }
}

// === Account Management ===

let addAccountCheckTimeout;
let importAccountCheckTimeout;

// Helper: check if an account exists on chain and update a status element
async function checkAccountExists(accountName, statusEl) {
  if (!btsAPI || !btsAPI.isConnected) {
    statusEl.textContent = 'Not connected';
    statusEl.className = 'input-status';
    return;
  }
  try {
    const account = await btsAPI.getAccount(accountName);
    if (account) {
      statusEl.textContent = '✓ Account found';
      statusEl.className = 'input-status valid';
    } else {
      statusEl.textContent = '✗ Account not found';
      statusEl.className = 'input-status invalid';
    }
  } catch (error) {
    statusEl.textContent = '✗ Account not found';
    statusEl.className = 'input-status invalid';
  }
}

// Validate account name when typing in add account form
document.getElementById('add-account-name')?.addEventListener('input', (e) => {
  const accountName = e.target.value.trim();
  const statusEl = document.getElementById('add-account-status');

  clearTimeout(addAccountCheckTimeout);

  if (!accountName) {
    statusEl.textContent = '';
    return;
  }

  addAccountCheckTimeout = setTimeout(() => checkAccountExists(accountName, statusEl), 500);
});

// Validate account name when typing in import wallet form (account tab)
document.getElementById('import-account-name')?.addEventListener('input', (e) => {
  const accountName = e.target.value.trim();
  const statusEl = document.getElementById('import-account-name-status');

  clearTimeout(importAccountCheckTimeout);

  if (!accountName) {
    statusEl.textContent = '';
    return;
  }

  const formatError = validateAccountNameFormat(accountName);
  if (formatError) {
    statusEl.textContent = '✗ ' + formatError;
    statusEl.className = 'input-status invalid';
    return;
  }

  statusEl.textContent = 'Checking...';
  statusEl.className = 'input-status';
  importAccountCheckTimeout = setTimeout(() => checkAccountExists(accountName, statusEl), 500);
});

async function handleAccountChange(e) {
  const accountId = e.target.value;
  console.log('handleAccountChange - switching to accountId:', accountId);
  if (!accountId) return;

  try {
    await walletManager.setActiveAccount(accountId);
    console.log('handleAccountChange - setActiveAccount completed');
    await loadDashboard();
    showToast('Account switched', 'success');

    // Check if the current tab's site needs connection approval for this account
    await checkSiteConnectionForCurrentTab(accountId);
  } catch (error) {
    console.error('Failed to switch account:', error);
    showToast('Failed to switch account', 'error');
  }
}

/**
 * Check if the current tab's site is connected to the specified account.
 * If the site was previously connected (to any account) but not to this account,
 * automatically show the connection approval modal.
 */
async function checkSiteConnectionForCurrentTab(accountId) {
  try {
    // Skip connection check for watch-only accounts (they can't sign)
    if (await walletManager.isWatchOnlyAccount(accountId)) {
      return;
    }

    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    // Skip chrome:// and other non-http URLs
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return;

    const origin = new URL(tab.url).origin;

    // Check if this site has any connection (to any account)
    const sites = await walletManager.getConnectedSites();
    const siteHasAnyConnection = sites.some(s => s.origin === origin);

    // If site has no connections at all, don't prompt (user hasn't tried to connect)
    if (!siteHasAnyConnection) return;

    // Check if THIS account is connected to the site
    const isConnected = await walletManager.isSiteConnected(origin, accountId);

    // If not connected, show connection approval modal
    if (!isConnected) {
      const hostname = new URL(origin).hostname;

      // Populate the connection approval modal
      document.getElementById('dapp-name').textContent = hostname;
      document.getElementById('dapp-origin').textContent = origin;

      // Set default dapp icon
      const dappIcon = document.getElementById('dapp-icon');
      if (dappIcon) {
        dappIcon.src = '../assets/icons/dapp-default.svg';
        dappIcon.alt = hostname;
      }

      // Populate account selector with current account pre-selected (exclude watch-only)
      const accounts = await walletManager.getAllAccounts();
      const signableAccounts = accounts.filter(acc => !acc.watchOnly);
      const selector = document.getElementById('dapp-connect-account');
      if (selector && signableAccounts.length > 0) {
        selector.innerHTML = signableAccounts.map(acc =>
          `<option value="${acc.id}" data-name="${acc.name}" ${acc.id === accountId ? 'selected' : ''}>${acc.name}</option>`
        ).join('');
      }

      // Create a pending request ID for the approval
      const requestId = crypto.randomUUID();
      pendingDappRequest = { id: requestId, type: 'connection', origin, isLocalRequest: true };

      // Store in chrome.storage so it persists
      await chrome.storage.local.set({
        pendingApproval: {
          requestId,
          type: 'connection',
          origin,
          params: {},
          isLocalRequest: true // Flag to indicate this was triggered from popup, not from dapp
        }
      });

      showModal('dapp-connect-modal');
    }
  } catch (error) {
    console.error('Error checking site connection:', error);
  }
}

async function handleAddAccount() {
  const accountName = document.getElementById('add-account-name')?.value?.trim();
  const watchOnly = document.getElementById('add-account-watch-only')?.checked || false;
  const btsPassword = document.getElementById('add-account-password')?.value;
  const walletPassword = document.getElementById('add-account-wallet-password')?.value;
  const skipVerify = document.getElementById('add-account-skip-verify')?.checked || false;

  if (!accountName) {
    showToast('Please enter an account name', 'error');
    return;
  }

  // Watch-only accounts don't need passwords
  if (!watchOnly) {
    if (!btsPassword) {
      showToast('Please enter the BitShares password', 'error');
      return;
    }

    if (!walletPassword) {
      showToast('Please enter your wallet password', 'error');
      return;
    }
  }

  try {
    showToast('Verifying account...', 'info');

    if (watchOnly) {
      await walletManager.addWatchOnlyAccount(accountName);
    } else {
      await walletManager.addAccountByCredentials(accountName, btsPassword, walletPassword, skipVerify);
    }

    // Clear form
    document.getElementById('add-account-name').value = '';
    document.getElementById('add-account-password').value = '';
    document.getElementById('add-account-wallet-password').value = '';
    document.getElementById('add-account-status').textContent = '';
    document.getElementById('add-account-skip-verify').checked = false;
    document.getElementById('add-account-watch-only').checked = false;
    document.getElementById('add-account-keys-section').style.display = 'block';

    showToast(watchOnly ? 'Watch-only account added!' : 'Account added successfully!', 'success');
    await loadDashboard();
    showScreen('dashboard-screen');
  } catch (error) {
    console.error('Add account error:', error);
    // Show more helpful error message
    let errorMsg = error.message;
    if (errorMsg.includes('Password does not match')) {
      errorMsg = 'Wrong BitShares password for this account. Check "Skip key verification" if your account uses custom keys.';
    } else if (errorMsg.includes('Invalid wallet password')) {
      errorMsg = 'Wrong wallet password. This is the password you use to unlock the extension.';
    }
    showToast(errorMsg, 'error');
  }
}

// === Account Management Settings ===

async function handleShowAccounts() {
  showScreen('accounts-screen');
  await loadAccountsList();
}

async function loadAccountsList() {
  const accountsList = document.getElementById('accounts-list');
  const accounts = await walletManager.getAllAccounts();

  if (accounts.length === 0) {
    accountsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div><p>No accounts</p></div>';
    return;
  }

  accountsList.innerHTML = '';

  for (const account of accounts) {
    const item = document.createElement('div');
    item.className = `account-item${account.isActive ? ' active' : ''}${account.watchOnly ? ' watch-only' : ''}`;
    item.innerHTML = `
      <div class="account-item-info">
        <div class="account-item-name">${account.name}</div>
        <div class="account-item-id">${account.id}</div>
        ${account.isActive ? '<span class="account-badge">Active</span>' : ''}
        ${account.watchOnly ? '<span class="account-badge watch-only">Watch Only</span>' : ''}
      </div>
      <div class="account-item-actions">
        ${!account.isActive ? `<button class="account-btn set-active" data-id="${account.id}" title="Set as active">✓</button>` : ''}
        ${!account.isActive && accounts.length > 1 ? `<button class="account-btn remove" data-id="${account.id}" title="Remove account">✕</button>` : ''}
      </div>
    `;
    accountsList.appendChild(item);
  }

  // Add event listeners for set active
  accountsList.querySelectorAll('.account-btn.set-active').forEach(btn => {
    btn.addEventListener('click', async () => {
      await walletManager.setActiveAccount(btn.dataset.id);
      await loadAccountsList();
      // Also refresh dashboard to update account selector dropdown
      await loadDashboard();
      showToast('Account set as active', 'success');
    });
  });

  // Add event listeners for remove
  accountsList.querySelectorAll('.account-btn.remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to remove this account from the wallet?')) {
        try {
          await walletManager.removeAccount(btn.dataset.id);
          await loadAccountsList();
          // Also refresh dashboard to update account selector dropdown
          await loadDashboard();
          showToast('Account removed', 'info');
        } catch (error) {
          showToast('Failed to remove: ' + error.message, 'error');
        }
      }
    });
  });
}

// === Watch-Only Accounts ===

function handleWatchOnlyToggle(e) {
  const keysSection = document.getElementById('add-account-keys-section');
  if (e.target.checked) {
    keysSection.style.display = 'none';
  } else {
    keysSection.style.display = 'block';
  }
}

// === Send Flow ===

let recipientCheckTimeout;

async function handleRecipientInput(e) {
  const recipient = e.target.value;
  const statusEl = document.getElementById('send-to-status');
  
  clearTimeout(recipientCheckTimeout);
  
  if (!recipient) {
    statusEl.textContent = '';
    return;
  }
  
  recipientCheckTimeout = setTimeout(async () => {
    try {
      const account = await btsAPI.getAccount(recipient);
      if (account) {
        statusEl.textContent = '✓ Valid account';
        statusEl.className = 'input-status valid';
      } else {
        statusEl.textContent = '✗ Account not found';
        statusEl.className = 'input-status invalid';
      }
    } catch (error) {
      statusEl.textContent = '✗ Account not found';
      statusEl.className = 'input-status invalid';
    }
  }, 500);
}

async function handleMaxAmount() {
  const availableBalance = document.getElementById('available-balance')?.textContent || '0';
  let amount = parseFloat(availableBalance) || 0;
  if (amount <= 0) {
    document.getElementById('send-amount').value = '';
    return;
  }

  // When the send asset is the same as the fee asset (BTS), subtract the fee
  const assetId = document.getElementById('send-asset')?.value || '1.3.0';
  if (assetId === '1.3.0') {
    try {
      const fee = btsAPI && btsAPI.isConnected
        ? await btsAPI.getOperationFee('transfer')
        : null;
      const feeAmount = fee ? fee.amount / Math.pow(10, fee.precision) : 0.01;
      amount = Math.max(0, amount - feeAmount);
      if (amount <= 0) {
        document.getElementById('send-amount').value = '';
        showToast('Balance too low to cover the network fee', 'error');
        return;
      }
      showToast(`Network fee (${feeAmount} BTS) reserved from max amount`, 'info');
    } catch (_) {
      // If fee lookup fails, deduct a safe default
      amount = Math.max(0, amount - 0.01);
    }
  }

  // Use up to 5 decimal places, trim trailing zeros
  document.getElementById('send-amount').value = parseFloat(amount.toFixed(5));
}

async function handleSendReview() {
  const to = document.getElementById('send-to')?.value;
  const amount = document.getElementById('send-amount')?.value;
  const memo = document.getElementById('send-memo')?.value;
  const assetSelect = document.getElementById('send-asset');

  if (!to || !amount) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  // Get asset symbol from selected option
  const selectedOption = assetSelect.options[assetSelect.selectedIndex];
  const assetText = selectedOption?.textContent || 'BTS';
  const assetSymbol = assetText.split(' ')[0]; // Extract symbol from "BTS (0.12345)"

  // Update confirmation modal
  document.getElementById('confirm-to').textContent = to;
  document.getElementById('confirm-amount').textContent = `${amount} ${assetSymbol}`;

  // Get actual fee
  const feeDisplay = document.getElementById('tx-fee')?.textContent || '~0.01000 BTS';
  document.getElementById('confirm-fee').textContent = feeDisplay;

  if (memo) {
    document.getElementById('confirm-memo').textContent = memo;
    document.getElementById('confirm-memo-row').style.display = 'flex';
  } else {
    document.getElementById('confirm-memo-row').style.display = 'none';
  }

  showModal('tx-confirm-modal');
}

async function handleConfirmTransaction() {
  const to = document.getElementById('send-to')?.value;
  const amount = document.getElementById('send-amount')?.value;
  const memo = document.getElementById('send-memo')?.value;
  const assetId = document.getElementById('send-asset')?.value || '1.3.0';

  try {
    hideModal('tx-confirm-modal');
    showToast('Signing transaction...', 'info');

    const result = await walletManager.sendTransfer(to, amount, assetId, memo);

    if (result.success) {
      showToast('Transaction sent successfully!', 'success');

      // Clear form
      document.getElementById('send-to').value = '';
      document.getElementById('send-amount').value = '';
      document.getElementById('send-memo').value = '';

      // Reload dashboard
      await loadDashboard();
      showScreen('dashboard-screen');
    } else {
      showToast('Transaction failed: ' + result.error, 'error');
    }
  } catch (error) {
    console.error('Transaction error:', error);
    showToast('Transaction failed: ' + error.message, 'error');
  }
}

// === Send Screen ===

// Store user balances for send screen
let sendScreenBalances = [];

async function handleShowSend(preselectedAssetId = null) {
  // Check if current account is watch-only
  const account = await walletManager.getCurrentAccount();
  if (account && await walletManager.isWatchOnlyAccount(account.id)) {
    showToast('Cannot send from watch-only account', 'error');
    return;
  }

  showScreen('send-screen');

  // Clear recipient field and status
  const sendToInput = document.getElementById('send-to');
  if (sendToInput) {
    sendToInput.value = '';
  }
  const sendToStatus = document.getElementById('send-to-status');
  if (sendToStatus) {
    sendToStatus.textContent = '';
    sendToStatus.className = 'input-status';
  }

  // Clear amount field
  const sendAmountInput = document.getElementById('send-amount');
  if (sendAmountInput) {
    sendAmountInput.value = '';
  }

  // Clear memo field
  const sendMemoInput = document.getElementById('send-memo');
  if (sendMemoInput) {
    sendMemoInput.value = '';
  }

  // Load user's asset balances and populate dropdown
  await loadSendAssets();

  // Pre-select asset if specified
  if (preselectedAssetId) {
    const assetSelect = document.getElementById('send-asset');
    if (assetSelect) {
      assetSelect.value = preselectedAssetId;
      updateSendAvailableBalance();
    }
  }

  // Load and display the transfer fee
  await loadTransferFee();
}

async function loadSendAssets() {
  try {
    const account = await walletManager.getCurrentAccount();
    if (!account || !account.id) return;

    const balances = await btsAPI.getAccountBalances(account.id);
    sendScreenBalances = balances;

    const assetSelect = document.getElementById('send-asset');
    assetSelect.innerHTML = '';

    // Always add BTS first even if balance is 0
    const btsBalance = balances.find(b => b.asset_id === '1.3.0') || { amount: 0, asset_id: '1.3.0' };
    const btsAsset = await btsAPI.getAsset('1.3.0');
    const btsPrecision = Math.pow(10, btsAsset.precision);
    const btsAmount = (parseInt(btsBalance.amount) / btsPrecision).toFixed(btsAsset.precision);
    assetSelect.innerHTML += `<option value="1.3.0" data-precision="${btsAsset.precision}" data-amount="${btsBalance.amount}">BTS (${btsAmount})</option>`;

    // Add other assets with balance > 0
    for (const balance of balances) {
      if (balance.asset_id === '1.3.0') continue; // Already added
      if (parseInt(balance.amount) <= 0) continue;

      const asset = await btsAPI.getAsset(balance.asset_id);
      if (asset) {
        const precision = Math.pow(10, asset.precision);
        const amount = (parseInt(balance.amount) / precision).toFixed(asset.precision);
        assetSelect.innerHTML += `<option value="${asset.id}" data-precision="${asset.precision}" data-amount="${balance.amount}">${asset.symbol} (${amount})</option>`;
      }
    }

    // Update available balance for default selection (BTS)
    updateSendAvailableBalance();
  } catch (error) {
    console.error('Failed to load send assets:', error);
  }
}

function updateSendAvailableBalance() {
  const assetSelect = document.getElementById('send-asset');
  const selectedOption = assetSelect.options[assetSelect.selectedIndex];
  const availableEl = document.getElementById('available-balance');

  // Clear amount field when asset changes
  const amountInput = document.getElementById('send-amount');
  if (amountInput) {
    amountInput.value = '';
  }

  if (selectedOption) {
    const precision = parseInt(selectedOption.dataset.precision) || 5;
    const amount = parseInt(selectedOption.dataset.amount) || 0;
    const divisor = Math.pow(10, precision);
    availableEl.textContent = (amount / divisor).toFixed(precision);
  } else {
    availableEl.textContent = '0';
  }
}

async function loadTransferFee() {
  const feeDisplay = document.getElementById('tx-fee');
  if (!feeDisplay) return;

  feeDisplay.textContent = 'Loading...';

  try {
    if (!btsAPI || !btsAPI.isConnected) {
      feeDisplay.textContent = '~0.01000 BTS';
      return;
    }

    const fee = await btsAPI.getOperationFee('transfer');
    if (fee) {
      feeDisplay.textContent = fee.formatted;
    } else {
      feeDisplay.textContent = '~0.01000 BTS';
    }
  } catch (error) {
    console.error('Failed to load transfer fee:', error);
    feeDisplay.textContent = '~0.01000 BTS';
  }
}

async function handleShowHistory() {
  showScreen('history-screen');
  // Refresh history when opening the screen
  try {
    const account = await walletManager.getCurrentAccount();
    if (account && account.id) {
      await loadHistory(account.id);
    }
  } catch (error) {
    console.error('Failed to refresh history:', error);
  }
}

async function handleShowReceive() {
  // Populate account selector
  const accounts = await walletManager.getAllAccounts();
  const activeAccount = await walletManager.getCurrentAccount();
  const selector = document.getElementById('receive-account-selector');

  if (selector && accounts.length > 0) {
    selector.innerHTML = accounts.map(acc =>
      `<option value="${acc.id}" ${acc.id === activeAccount?.id ? 'selected' : ''}>${acc.watchOnly ? `${acc.name} (Watch Only)` : acc.name}</option>`
    ).join('');
  }

  // Update display with current account
  await updateReceiveScreenDisplay();

  showScreen('receive-screen');
}

async function updateReceiveScreenDisplay() {
  const selector = document.getElementById('receive-account-selector');
  const selectedId = selector?.value;
  const accounts = await walletManager.getAllAccounts();
  const activeAccount = await walletManager.getCurrentAccount();
  const account = accounts.find(a => a.id === selectedId) || activeAccount;

  if (!account) return;

  // Update account ID
  const accountIdEl = document.getElementById('receive-account-id');
  if (accountIdEl) {
    accountIdEl.textContent = account.id || 'Loading...';
  }

  // Render avatar
  const avatarCanvas = document.getElementById('receive-avatar');
  if (avatarCanvas) {
    await renderIdenticonToCanvas(avatarCanvas, account.name);
  }

  // Render large identicon
  const identiconCanvas = document.getElementById('receive-identicon');
  if (identiconCanvas) {
    await renderIdenticonToCanvas(identiconCanvas, account.name);
  }
}

async function handleReceiveAccountChange() {
  await updateReceiveScreenDisplay();
}

// === Network ===

async function handleNetworkChange(e) {
  const network = e.target.value;
  
  try {
    showToast(`Switching to ${network}...`, 'info');
    
    // Disconnect current connection
    if (btsAPI) {
      await btsAPI.disconnect();
    }
    
    // Connect to new network
    await initializeAPI();
    await loadDashboard();
    
    showToast(`Connected to ${network}`, 'success');
  } catch (error) {
    console.error('Network switch error:', error);
    showToast('Failed to switch network', 'error');
  }
}

// === Settings ===

async function handleShowBackup() {
  try {
    const brainkey = await walletManager.getBrainkey();
    if (brainkey) {
      displayBrainkey(brainkey);
      showScreen('backup-brainkey-screen');
    } else {
      showToast('No brainkey stored for this wallet (imported via private key?)', 'error');
    }
  } catch (error) {
    console.error('Brainkey backup error:', error);
    showToast('Unable to retrieve brainkey: ' + error.message, 'error');
  }
}

async function handleResetWallet() {
  if (confirm('Are you sure you want to reset your wallet? This action cannot be undone. Make sure you have backed up your brainkey!')) {
    await walletManager.resetWallet();
    clearCreateWalletForm();
    clearImportWalletForm();
    showScreen('welcome-screen');
    showToast('Wallet has been reset', 'info');
  }
}

async function handleShowSettings() {
  showScreen('settings-screen');
  await loadAutolockSetting();
}

async function loadAutolockSetting() {
  // Load from WalletManager's setting (in milliseconds)
  const durationMs = await walletManager.getAutoLockDuration();
  const minutes = Math.round(durationMs / (60 * 1000));
  const autolockTimer = document.getElementById('autolock-timer');
  if (autolockTimer) {
    autolockTimer.value = minutes.toString();
  }
}

async function handleAutolockChange(e) {
  const minutes = parseInt(e.target.value);
  const durationMs = minutes * 60 * 1000; // Convert to milliseconds
  await walletManager.setAutoLockDuration(durationMs);
  if (minutes === 0) {
    showToast('Auto-lock disabled', 'info');
  } else {
    showToast(`Auto-lock set to ${minutes} minutes`, 'info');
  }
}

// === Node Management ===

// Default nodes list
const DEFAULT_NODES = [
  'wss://node.xbts.io/ws',
  'wss://cloud.xbts.io/ws',
  'wss://public.xbts.io/ws',
  'wss://btsws.roelandp.nl/ws',
  'wss://dex.iobanker.com/ws',
  'wss://api.bitshares.dev/ws'
];

// Node status cache
let nodeStatuses = new Map();

async function handleShowNodes() {
  showScreen('nodes-screen');
  await loadNodesList();
  updateCurrentNodeDisplay();
}

function updateCurrentNodeDisplay() {
  const currentNodeEl = document.getElementById('current-node-display');
  const latencyEl = document.getElementById('node-latency');

  if (btsAPI && btsAPI.currentNode) {
    currentNodeEl.textContent = btsAPI.currentNode;
    const status = nodeStatuses.get(btsAPI.currentNode);
    if (status && status.latency) {
      latencyEl.textContent = `Latency: ${status.latency}ms`;
    } else {
      latencyEl.textContent = 'Connected';
    }
  } else {
    currentNodeEl.textContent = 'Not connected';
    latencyEl.textContent = '';
  }
}

async function loadNodesList() {
  const nodesList = document.getElementById('nodes-list');
  nodesList.innerHTML = '';

  // Get saved custom nodes
  const savedNodes = await getSavedNodes();
  const allNodes = [...new Set([...DEFAULT_NODES, ...savedNodes])];

  for (const node of allNodes) {
    const isCustom = !DEFAULT_NODES.includes(node);
    const isActive = btsAPI && btsAPI.currentNode === node;
    const status = nodeStatuses.get(node);

    const nodeItem = document.createElement('div');
    nodeItem.className = `node-item${isActive ? ' active' : ''}`;
    nodeItem.dataset.node = node;

    let statusClass = 'unknown';
    let statusText = 'Not tested';
    if (status) {
      if (status.testing) {
        statusClass = 'testing';
        statusText = 'Testing...';
      } else if (status.online) {
        statusClass = 'online';
        statusText = `Online (${status.latency}ms)`;
      } else {
        statusClass = 'offline';
        statusText = 'Offline';
      }
    }

    nodeItem.innerHTML = `
      <div class="node-info">
        <div class="node-url">${node}</div>
        <div class="node-status ${statusClass}">${statusText}</div>
      </div>
      <div class="node-actions-inline">
        <button class="node-btn connect" title="Connect to this node" data-node="${node}">⚡</button>
        ${isCustom ? `<button class="node-btn remove" title="Remove node" data-node="${node}">✕</button>` : ''}
      </div>
    `;

    nodesList.appendChild(nodeItem);
  }

  // Add event listeners
  nodesList.querySelectorAll('.node-btn.connect').forEach(btn => {
    btn.addEventListener('click', () => handleConnectToNode(btn.dataset.node));
  });

  nodesList.querySelectorAll('.node-btn.remove').forEach(btn => {
    btn.addEventListener('click', () => handleRemoveNode(btn.dataset.node));
  });
}

async function getSavedNodes() {
  return new Promise(resolve => {
    chrome.storage.local.get(['customNodes'], result => {
      resolve(result.customNodes || []);
    });
  });
}

async function saveCustomNodes(nodes) {
  return new Promise(resolve => {
    chrome.storage.local.set({ customNodes: nodes }, resolve);
  });
}

async function handleAddNode() {
  const input = document.getElementById('custom-node-input');
  const nodeUrl = input.value.trim();

  if (!nodeUrl) {
    showToast('Please enter a node URL', 'error');
    return;
  }

  if (!nodeUrl.startsWith('wss://')) {
    showToast('Node URL must start with wss://', 'error');
    return;
  }

  const savedNodes = await getSavedNodes();
  if (savedNodes.includes(nodeUrl) || DEFAULT_NODES.includes(nodeUrl)) {
    showToast('Node already exists', 'error');
    return;
  }

  savedNodes.push(nodeUrl);
  await saveCustomNodes(savedNodes);

  input.value = '';
  await loadNodesList();
  showToast('Node added', 'success');

  // Test the new node
  await testNode(nodeUrl);
  await loadNodesList();
}

async function handleRemoveNode(nodeUrl) {
  const savedNodes = await getSavedNodes();
  const index = savedNodes.indexOf(nodeUrl);
  if (index > -1) {
    savedNodes.splice(index, 1);
    await saveCustomNodes(savedNodes);
    await loadNodesList();
    showToast('Node removed', 'info');
  }
}

async function handleConnectToNode(nodeUrl) {
  showToast('Connecting...', 'info');

  try {
    if (btsAPI) {
      await btsAPI.disconnect();
    }

    btsAPI = new BitSharesAPI([nodeUrl]);
    await btsAPI.connect();

    updateCurrentNodeDisplay();
    await loadNodesList();
    showToast('Connected to ' + nodeUrl, 'success');
  } catch (error) {
    console.error('Connection error:', error);
    showToast('Failed to connect: ' + error.message, 'error');
  }
}

async function testNode(nodeUrl) {
  nodeStatuses.set(nodeUrl, { testing: true });

  try {
    const startTime = Date.now();
    const ws = new WebSocket(nodeUrl);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout'));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        const latency = Date.now() - startTime;
        nodeStatuses.set(nodeUrl, { online: true, latency });
        ws.close();
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        nodeStatuses.set(nodeUrl, { online: false });
        reject(new Error('Connection failed'));
      };
    });
  } catch (error) {
    nodeStatuses.set(nodeUrl, { online: false });
  }
}

async function handleTestAllNodes() {
  showToast('Testing all nodes...', 'info');

  const savedNodes = await getSavedNodes();
  const allNodes = [...new Set([...DEFAULT_NODES, ...savedNodes])];

  // Mark all as testing
  for (const node of allNodes) {
    nodeStatuses.set(node, { testing: true });
  }
  await loadNodesList();

  // Test all nodes in parallel
  await Promise.all(allNodes.map(node => testNode(node)));

  await loadNodesList();
  showToast('Node testing complete', 'success');
}

async function handleResetNodes() {
  if (confirm('Reset to default nodes? Custom nodes will be removed.')) {
    await saveCustomNodes([]);
    nodeStatuses.clear();
    await loadNodesList();
    showToast('Nodes reset to defaults', 'info');
  }
}

// === Connected Sites Management ===

async function handleShowConnections() {
  showScreen('connections-screen');
  await loadConnectionsList();
}

async function loadConnectionsList() {
  const connectionsList = document.getElementById('connections-list');
  const sites = await walletManager.getConnectedSites();

  if (sites.length === 0) {
    connectionsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔗</div><p>No connected sites</p></div>';
    return;
  }

  connectionsList.innerHTML = '';

  for (const site of sites) {
    const item = document.createElement('div');
    item.className = 'connection-item';

    const date = new Date(site.lastConnected || site.connectedAt);
    const dateStr = date.toLocaleDateString();
    const accountDisplay = site.accountName || 'All accounts';

    item.innerHTML = `
      <div class="connection-info">
        <div class="connection-origin">${site.origin}</div>
        <div class="connection-account">Account: ${accountDisplay}</div>
        <div class="connection-date">Connected: ${dateStr}</div>
      </div>
      <button class="connection-btn-remove" data-origin="${site.origin}" data-account="${site.accountId || ''}" title="Disconnect">✕</button>
    `;

    connectionsList.appendChild(item);
  }

  connectionsList.querySelectorAll('.connection-btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const accountId = btn.dataset.account || null;
      await walletManager.removeConnectedSite(btn.dataset.origin, accountId);
      await loadConnectionsList();
      showToast('Site disconnected', 'info');
    });
  });
}

// === Network Fees Display ===

async function handleShowFees() {
  showScreen('fees-screen');
  await loadNetworkFees();
}

async function loadNetworkFees() {
  const feesList = document.getElementById('fees-list');

  if (!btsAPI || !btsAPI.isConnected) {
    feesList.innerHTML = '<div class="fee-item error"><span class="fee-name">Not connected to network</span></div>';
    return;
  }

  feesList.innerHTML = '<div class="fee-item loading"><span class="fee-name">Loading fees...</span></div>';

  try {
    const fees = await btsAPI.getCommonFees();

    if (!fees || Object.keys(fees).length === 0) {
      feesList.innerHTML = '<div class="fee-item error"><span class="fee-name">Unable to fetch fees</span></div>';
      return;
    }

    feesList.innerHTML = '';

    const feeLabels = {
      transfer: 'Transfer',
      limit_order_create: 'Create Order',
      limit_order_cancel: 'Cancel Order',
      account_update: 'Update Account',
      account_upgrade: 'Upgrade Account',
      asset_create: 'Create Asset',
      asset_issue: 'Issue Asset',
      proposal_create: 'Create Proposal',
      witness_create: 'Create Witness',
      worker_create: 'Create Worker'
    };

    for (const [opType, feeData] of Object.entries(fees)) {
      const label = feeLabels[opType] || opType.replace(/_/g, ' ');
      const feeItem = document.createElement('div');
      feeItem.className = 'fee-item';
      feeItem.innerHTML = `
        <span class="fee-name">${label}</span>
        <span class="fee-amount">${feeData.formatted || feeData.amount + ' ' + feeData.symbol}</span>
      `;
      feesList.appendChild(feeItem);
    }
  } catch (error) {
    console.error('Error loading fees:', error);
    feesList.innerHTML = '<div class="fee-item error"><span class="fee-name">Error loading fees</span></div>';
  }
}

// === Copy Functions ===

async function handleCopyReceiveAccount() {
  const selector = document.getElementById('receive-account-selector');
  let accountName = selector?.options[selector.selectedIndex]?.text;
  // Strip "(Watch Only)" suffix if present
  accountName = accountName?.replace(/ \(Watch Only\)$/, '') || '';
  try {
    await navigator.clipboard.writeText(accountName);
    showToast('Account name copied!', 'success');
  } catch (error) {
    showToast('Failed to copy', 'error');
  }
}

// === dApp Connection ===

let pendingDappRequest = null;

function handleDappReject() {
  if (pendingDappRequest) {
    chrome.runtime.sendMessage({
      type: 'DAPP_RESPONSE',
      requestId: pendingDappRequest.id,
      approved: false
    });
  }
  pendingDappRequest = null;
  hideModal('dapp-connect-modal');
}

async function handleDappConnect() {
  if (pendingDappRequest) {
    const account = await walletManager.getCurrentAccount();
    chrome.runtime.sendMessage({
      type: 'DAPP_RESPONSE',
      requestId: pendingDappRequest.id,
      approved: true,
      account: {
        name: account.name,
        id: account.id
      }
    });
  }
  pendingDappRequest = null;
  hideModal('dapp-connect-modal');
  showToast('Site connected!', 'success');
}

// === Background Message Handler ===

function handleBackgroundMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'DAPP_CONNECTION_REQUEST':
      pendingDappRequest = message;
      document.getElementById('dapp-name').textContent = message.origin;
      document.getElementById('dapp-origin').textContent = message.origin;
      showModal('dapp-connect-modal');
      break;
      
    case 'SIGN_TRANSACTION_REQUEST':
      handleSignTransactionRequest(message);
      break;
      
    case 'LOCK_WALLET':
      handleLock();
      break;
  }
}

async function handleSignTransactionRequest(message) {
  if (isLocked) {
    showScreen('unlock-screen');
    return;
  }

  // Show transaction confirmation UI
  // This would parse the transaction and display it for user approval
  showToast('Transaction signing request received', 'info');
}

// Show indicator on unlock screen when there's a pending approval
async function showPendingApprovalIndicator() {
  try {
    const result = await chrome.storage.local.get(['pendingApproval']);
    const unlockScreen = document.getElementById('unlock-screen');
    let indicator = document.getElementById('pending-approval-indicator');

    // If no pending approval, remove indicator if it exists
    if (!result.pendingApproval) {
      if (indicator) {
        indicator.remove();
      }
      return;
    }

    const { origin, type } = result.pendingApproval;

    // Note: We don't check if site is already connected here because the wallet is locked
    // and we don't know which account will be active after unlock.
    // The actual check happens in checkPendingApproval() after unlock.

    const hostname = new URL(origin).hostname;

    // Add indicator below the unlock form
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pending-approval-indicator';
      indicator.className = 'pending-approval-indicator';
      unlockScreen.appendChild(indicator);
    }

    let message, hint;
    if (type === 'connection') {
      message = `<strong>${hostname}</strong> wants to connect`;
      hint = 'Unlock your wallet to approve the connection';
    } else if (type === 'transfer') {
      message = `<strong>${hostname}</strong> requests a transfer`;
      hint = 'Unlock your wallet to review and sign';
    } else {
      message = `<strong>${hostname}</strong> requests a transaction`;
      hint = 'Unlock your wallet to review and sign';
    }
    indicator.innerHTML = `
      <div class="pending-icon">🔔</div>
      <p>${message}</p>
      <p class="pending-hint">${hint}</p>
    `;
  } catch (error) {
    console.error('Error showing pending approval indicator:', error);
  }
}

// Check for pending dApp approval requests (opened from background script)
async function checkPendingApproval() {
  try {
    const result = await chrome.storage.local.get(['pendingApproval']);
    if (!result.pendingApproval) return;

    const { requestId, type, origin, params } = result.pendingApproval;

    // For connection requests, check if CURRENT account is already connected (stale request)
    // For transfer/transaction requests, site MUST be connected, so don't clear those
    if (type === 'connection') {
      const currentAccount = await walletManager.getCurrentAccount();
      const isConnected = currentAccount?.id
        ? await walletManager.isSiteConnected(origin, currentAccount.id)
        : false;
      if (isConnected) {
        // Current account is already connected, clear stale connection approval
        await chrome.storage.local.remove(['pendingApproval']);
        await chrome.action.setBadgeText({ text: '' });
        return;
      }
      // Show connection approval modal
      const hostname = new URL(origin).hostname;
      document.getElementById('dapp-name').textContent = hostname;
      document.getElementById('dapp-origin').textContent = origin;

      // Set default dapp icon
      const dappIcon = document.getElementById('dapp-icon');
      if (dappIcon) {
        dappIcon.src = '../assets/icons/dapp-default.svg';
        dappIcon.alt = hostname;
      }

      // Populate account selector (exclude watch-only accounts)
      const accounts = await walletManager.getAllAccounts();
      const signableAccounts = accounts.filter(acc => !acc.watchOnly);
      const activeAccount = await walletManager.getCurrentAccount();
      const selector = document.getElementById('dapp-connect-account');
      if (selector && signableAccounts.length > 0) {
        selector.innerHTML = signableAccounts.map(acc =>
          `<option value="${acc.id}" data-name="${acc.name}" ${acc.id === activeAccount?.id ? 'selected' : ''}>${acc.name}</option>`
        ).join('');
      }

      pendingDappRequest = { id: requestId, type, origin };
      showModal('dapp-connect-modal');
    } else if (type === 'transfer') {
      // Show transfer approval modal
      await showTransferApprovalModal(requestId, origin, params);
    } else if (type === 'transaction') {
      // Show generic transaction signing modal with operation details
      const operations = params?.operations || params?.ops || (params?.transaction?.operations) || [];
      await showTransactionSigningModal(requestId, origin, operations);
    }
  } catch (error) {
    console.error('Error checking pending approval:', error);
  }
}

async function showTransferApprovalModal(requestId, origin, params) {
  // Get transfer params from storage
  const result = await chrome.storage.local.get(['pendingApproval']);
  const transferParams = params || result.pendingApproval?.params || {};

  // Populate transfer details
  document.getElementById('transfer-origin').textContent = origin;
  document.getElementById('transfer-to').textContent = transferParams.to || 'Unknown';
  document.getElementById('transfer-amount').textContent =
    `${transferParams.amount || '0'} ${transferParams.asset || 'BTS'}`;

  // Show memo if present
  const memoRow = document.getElementById('transfer-memo-row');
  const memoEl = document.getElementById('transfer-memo');
  if (transferParams.memo) {
    memoEl.textContent = transferParams.memo;
    memoRow.style.display = 'flex';
  } else {
    memoRow.style.display = 'none';
  }

  // Fetch and display the real transfer fee from the on-chain fee schedule.
  // Using get_required_fees with placeholder operation data returns 0 because the
  // node cannot serialise placeholder public keys. Reading the fee schedule directly
  // and adding price_per_kbyte × memo_size is both reliable and accurate.
  const feeEl = document.getElementById('transfer-fee');
  if (feeEl) {
    feeEl.textContent = 'Loading...';
    try {
      if (btsAPI && btsAPI.isConnected) {
        const feeSchedule = await btsAPI.getFeeSchedule();
        const opId = btsAPI.getOperationId('transfer');
        const opFeeEntry = feeSchedule?.parameters?.find(([id]) => id === opId);

        if (opFeeEntry) {
          const fp = opFeeEntry[1];
          let totalFee = fp.fee ?? fp.basic_fee ?? 0;

          // Add memo fee when a memo is present.
          // BitShares charges: floor(serialised_memo_bytes * price_per_kbyte / 1024)
          // Serialised memo = 33B (from key) + 33B (to key) + 8B (nonce) + AES-padded text.
          if (transferParams.memo && fp.price_per_kbyte) {
            const textBytes = new TextEncoder().encode(transferParams.memo).length;
            const encryptedBytes = Math.ceil((textBytes + 16) / 16) * 16; // AES-CBC block padding
            const memoSerialised = 33 + 33 + 8 + encryptedBytes;
            totalFee += Math.floor(memoSerialised * fp.price_per_kbyte / 1024);
          }

          const btsAsset = await btsAPI.getAsset('1.3.0');
          const precision = Math.pow(10, btsAsset.precision);
          feeEl.textContent = `${(totalFee / precision).toFixed(btsAsset.precision)} ${btsAsset.symbol}`;
        } else {
          feeEl.textContent = '?';
        }
      } else {
        feeEl.textContent = 'Not connected';
      }
    } catch (e) {
      console.error('Fee estimation error:', e);
      feeEl.textContent = '?';
    }
  }

  pendingDappRequest = { id: requestId, type: 'transfer', origin };
  showModal('dapp-transfer-modal');
}

// Update dApp handlers to use correct message types
async function handleDappRejectUpdated() {
  if (pendingDappRequest) {
    // For local requests (account switch), we don't need to notify service worker
    if (!pendingDappRequest.isLocalRequest) {
      try {
        await chrome.runtime.sendMessage({
          type: 'DAPP_APPROVE_CONNECTION',
          data: { requestId: pendingDappRequest.id, approved: false }
        });
      } catch (e) {
        console.error('Failed to reject connection:', e);
      }
    }
    // Clear pending approval from storage
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' });
  }
  pendingDappRequest = null;
  hideModal('dapp-connect-modal');
}

async function handleDappConnectUpdated() {
  if (pendingDappRequest) {
    try {
      // Get selected account from the connection modal
      const selector = document.getElementById('dapp-connect-account');
      const accountId = selector?.value;
      const accountName = selector?.options[selector.selectedIndex]?.dataset.name ||
                         selector?.options[selector.selectedIndex]?.text;

      if (pendingDappRequest.isLocalRequest) {
        // Local request (from account switch) - add connection directly
        await walletManager.addConnectedSite(
          pendingDappRequest.origin,
          accountId,
          accountName,
          ['getAccount', 'signTransaction', 'transfer']
        );
        showToast(`Site connected with ${accountName}!`, 'success');

        // Notify the content script about the new connection
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'CONNECTION_APPROVED',
              account: { name: accountName, id: accountId }
            }).catch(() => {}); // Ignore if content script not ready
          }
        } catch (e) {
          // Ignore tab messaging errors
        }
      } else {
        // dApp request - send through service worker
        await chrome.runtime.sendMessage({
          type: 'DAPP_APPROVE_CONNECTION',
          data: {
            requestId: pendingDappRequest.id,
            approved: true,
            accountId,
            accountName
          }
        });
        showToast(`Site connected with ${accountName}!`, 'success');
      }
    } catch (e) {
      console.error('Failed to approve connection:', e);
      showToast('Failed to connect: ' + e.message, 'error');
    }
    // Clear pending approval from storage
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' });
  }
  pendingDappRequest = null;
  hideModal('dapp-connect-modal');
}

// Transfer approval handlers
async function handleTransferReject() {
  if (pendingDappRequest) {
    try {
      await chrome.runtime.sendMessage({
        type: 'DAPP_APPROVE_TRANSFER',
        data: { requestId: pendingDappRequest.id, approved: false }
      });
    } catch (e) {
      console.error('Failed to reject transfer:', e);
    }
    await chrome.storage.local.remove(['pendingApproval']);
  }
  pendingDappRequest = null;
  hideModal('dapp-transfer-modal');
}

async function handleTransferApprove() {
  if (pendingDappRequest) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'DAPP_APPROVE_TRANSFER',
        data: { requestId: pendingDappRequest.id, approved: true }
      });
      if (result?.success === false) {
        showToast('Transfer failed: ' + (result.error || 'Unknown error'), 'error');
      } else {
        showToast('Transfer sent!', 'success');
        // Refresh balances after successful transfer
        await loadDashboard();
      }
    } catch (e) {
      console.error('Failed to approve transfer:', e);
      showToast('Transfer failed: ' + e.message, 'error');
    }
    await chrome.storage.local.remove(['pendingApproval']);
  }
  pendingDappRequest = null;
  hideModal('dapp-transfer-modal');
}

// === Generic Transaction Signing Modal ===

// Map of operation type index to human-readable name
const OPERATION_NAMES = {
  0:  'Transfer',
  1:  'Limit Order Create',
  2:  'Limit Order Cancel',
  3:  'Call Order Update',
  4:  'Fill Order',
  5:  'Account Create',
  6:  'Account Update',
  7:  'Account Whitelist',
  8:  'Account Upgrade',
  9:  'Account Transfer',
  10: 'Asset Create',
  11: 'Asset Update',
  12: 'Asset Update BitAsset',
  13: 'Asset Update Feed Producers',
  14: 'Asset Issue',
  15: 'Asset Reserve',
  16: 'Asset Fund Fee Pool',
  17: 'Asset Settle',
  18: 'Asset Global Settle',
  19: 'Asset Publish Feed',
  20: 'Witness Create',
  21: 'Witness Update',
  22: 'Proposal Create',
  23: 'Proposal Update',
  24: 'Proposal Delete',
  25: 'Withdraw Permission Create',
  26: 'Withdraw Permission Update',
  27: 'Withdraw Permission Claim',
  28: 'Withdraw Permission Delete',
  29: 'Committee Member Create',
  30: 'Committee Member Update',
  31: 'Committee Member Update Global Parameters',
  32: 'Vesting Balance Create',
  33: 'Vesting Balance Withdraw',
  34: 'Worker Create',
  35: 'Custom',
  36: 'Assert',
  37: 'Balance Claim',
  38: 'Override Transfer',
  39: 'Transfer To Blind',
  40: 'Blind Transfer',
  41: 'Transfer From Blind',
  42: 'Asset Settle Cancel',
  43: 'Asset Claim Fees',
  44: 'FBA Distribute',
  45: 'Bid Collateral',
  46: 'Execute Bid',
  47: 'Asset Claim Pool',
  48: 'Asset Update Issuer',
  49: 'HTLC Create',
  50: 'HTLC Redeem',
  51: 'HTLC Redeemed',
  52: 'HTLC Extend',
  53: 'HTLC Refund',
  54: 'Custom Authority Create',
  55: 'Custom Authority Update',
  56: 'Custom Authority Delete',
  57: 'Ticket Create',
  58: 'Ticket Update',
  59: 'Liquidity Pool Create',
  60: 'Liquidity Pool Delete',
  61: 'Liquidity Pool Deposit',
  62: 'Liquidity Pool Withdraw',
  63: 'Liquidity Pool Exchange',
  64: 'SameT Fund Create',
  65: 'SameT Fund Delete',
  66: 'SameT Fund Update',
  67: 'SameT Fund Borrow',
  68: 'SameT Fund Repay',
  69: 'Credit Offer Create',
  70: 'Credit Offer Delete',
  71: 'Credit Offer Update',
  72: 'Credit Offer Accept',
  73: 'Credit Deal Repay',
  74: 'Credit Deal Expired'
};

/**
 * Escape a string for safe HTML insertion.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build an HTML row for the operation details table.
 */
function opRow(label, value) {
  return `<div class="op-detail-row">
    <span class="op-detail-label">${escapeHtml(label)}</span>
    <span class="op-detail-value">${escapeHtml(String(value ?? ''))}</span>
  </div>`;
}

/**
 * Format a BitShares asset amount object: { amount, asset_id }
 */
function formatAsset(assetObj) {
  if (!assetObj) return 'N/A';
  if (typeof assetObj === 'string') return assetObj;
  const { amount, asset_id } = assetObj;
  if (amount !== undefined && asset_id !== undefined) {
    return `${amount} (asset ${asset_id})`;
  }
  return JSON.stringify(assetObj);
}

/**
 * Format a price object: { base: {amount,asset_id}, quote: {amount,asset_id} }
 */
function formatPrice(priceObj) {
  if (!priceObj) return 'N/A';
  const base = formatAsset(priceObj.base);
  const quote = formatAsset(priceObj.quote);
  return `${base} / ${quote}`;
}

/**
 * Render a JSON block for complex/unknown data.
 */
function jsonBlock(data) {
  return `<pre class="op-detail-json">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

/**
 * Resolve a BitShares account ID (1.2.x) to its name, falling back to the raw ID.
 */
async function resolveAccountName(accountId) {
  if (!accountId || typeof accountId !== 'string') return accountId ?? '';
  if (!accountId.startsWith('1.2.')) return accountId;
  try {
    if (btsAPI && btsAPI.isConnected) {
      const account = await btsAPI.getAccount(accountId);
      return account?.name || accountId;
    }
  } catch { /* fall through */ }
  return accountId;
}

/**
 * Format an asset amount object { amount, asset_id } with resolved symbol and decimals.
 * Falls back to the raw "amount (asset id)" string if the API call fails.
 */
async function formatAssetAsync(assetObj) {
  const fallback = formatAsset(assetObj);
  if (!assetObj || !assetObj.asset_id) return fallback;
  try {
    return await formatAmountWithSymbol(assetObj) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Returns an HTML string with human-readable fields for the given operation type.
 * opType: integer operation index (0-74)
 * opData: the operation data object
 */
async function renderOperationDetails(opType, opData) {
  if (!opData) return '<p class="op-detail-empty">No operation data available.</p>';

  const rows = [];

  switch (opType) {
    // 0: transfer
    case 0:
      rows.push(opRow('From', await resolveAccountName(opData.from)));
      rows.push(opRow('To', await resolveAccountName(opData.to)));
      rows.push(opRow('Amount', await formatAssetAsync(opData.amount)));
      if (opData.memo) rows.push(opRow('Memo', typeof opData.memo === 'object' ? '[encrypted]' : opData.memo));
      break;

    // 1: limit_order_create
    case 1:
      rows.push(opRow('Seller', await resolveAccountName(opData.seller)));
      rows.push(opRow('Sell (Amount to Sell)', await formatAssetAsync(opData.amount_to_sell)));
      rows.push(opRow('Buy (Min to Receive)', await formatAssetAsync(opData.min_to_receive)));
      rows.push(opRow('Expiration', opData.expiration));
      rows.push(opRow('Fill or Kill', opData.fill_or_kill ? 'Yes' : 'No'));
      break;

    // 2: limit_order_cancel
    case 2:
      rows.push(opRow('Fee Paying Account', opData.fee_paying_account));
      rows.push(opRow('Order ID', opData.order));
      break;

    // 3: call_order_update
    case 3:
      rows.push(opRow('Funding Account', opData.funding_account));
      rows.push(opRow('Delta Collateral', formatAsset(opData.delta_collateral)));
      rows.push(opRow('Delta Debt', formatAsset(opData.delta_debt)));
      break;

    // 4: fill_order (virtual)
    case 4:
      rows.push(opRow('Account', await resolveAccountName(opData.account_id)));
      rows.push(opRow('Order ID', opData.order_id));
      rows.push(opRow('Pays', await formatAssetAsync(opData.pays)));
      rows.push(opRow('Receives', await formatAssetAsync(opData.receives)));
      break;

    // 5: account_create
    case 5:
      rows.push(opRow('Name', opData.name));
      rows.push(opRow('Registrar', await resolveAccountName(opData.registrar)));
      rows.push(opRow('Referrer', await resolveAccountName(opData.referrer)));
      rows.push(opRow('Referrer Percent', opData.referrer_percent !== undefined ? `${opData.referrer_percent / 100}%` : 'N/A'));
      if (opData.owner)  rows.push(opRow('Owner Authority',  JSON.stringify(opData.owner)));
      if (opData.active) rows.push(opRow('Active Authority', JSON.stringify(opData.active)));
      break;

    // 6: account_update
    case 6:
      rows.push(opRow('Account', opData.account));
      if (opData.owner) rows.push(opRow('New Owner Key', JSON.stringify(opData.owner)));
      if (opData.active) rows.push(opRow('New Active Key', JSON.stringify(opData.active)));
      if (opData.new_options) rows.push(opRow('New Options', JSON.stringify(opData.new_options)));
      break;

    // 7: account_whitelist
    case 7:
      rows.push(opRow('Authorizing Account', opData.authorizing_account));
      rows.push(opRow('Account to List', opData.account_to_list));
      rows.push(opRow('New Listing', opData.new_listing !== undefined ? `0x${opData.new_listing.toString(16)}` : 'N/A'));
      break;

    // 8: account_upgrade
    case 8:
      rows.push(opRow('Account', opData.account_to_upgrade));
      rows.push(opRow('Upgrade to Lifetime Member', opData.upgrade_to_lifetime_member ? 'Yes' : 'No'));
      break;

    // 9: account_transfer
    case 9:
      rows.push(opRow('Account', opData.account_id));
      rows.push(opRow('New Owner', opData.new_owner));
      break;

    // 10: asset_create
    case 10:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Symbol', opData.symbol));
      rows.push(opRow('Precision', opData.precision));
      rows.push(opRow('Max Supply', opData.common_options?.max_supply));
      rows.push(opRow('Description', opData.common_options?.description || ''));
      break;

    // 11: asset_update
    case 11:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset to Update', opData.asset_to_update));
      if (opData.new_issuer) rows.push(opRow('New Issuer', opData.new_issuer));
      if (opData.new_options) rows.push(opRow('New Options', JSON.stringify(opData.new_options)));
      break;

    // 12: asset_update_bitasset
    case 12:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset to Update', opData.asset_to_update));
      rows.push(opRow('New Options', JSON.stringify(opData.new_options || {})));
      break;

    // 13: asset_update_feed_producers
    case 13:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset', opData.asset_to_update));
      rows.push(opRow('New Feed Producers', (opData.new_feed_producers || []).join(', ') || 'None'));
      break;

    // 14: asset_issue
    case 14:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset to Issue', formatAsset(opData.asset_to_issue)));
      rows.push(opRow('Issue to Account', opData.issue_to_account));
      if (opData.memo) rows.push(opRow('Memo', typeof opData.memo === 'object' ? '[encrypted]' : opData.memo));
      break;

    // 15: asset_reserve
    case 15:
      rows.push(opRow('Payer', opData.payer));
      rows.push(opRow('Amount to Reserve', formatAsset(opData.amount_to_reserve)));
      break;

    // 16: asset_fund_fee_pool
    case 16:
      rows.push(opRow('From Account', opData.from_account));
      rows.push(opRow('Asset', opData.asset_id));
      rows.push(opRow('Amount', (opData.amount ?? '').toLocaleString()));
      break;

    // 17: asset_settle
    case 17:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Amount to Settle', formatAsset(opData.amount)));
      break;

    // 18: asset_global_settle
    case 18:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset to Settle', opData.asset_to_settle));
      rows.push(opRow('Settle Price', formatPrice(opData.settle_price)));
      break;

    // 19: asset_publish_feed
    case 19:
      rows.push(opRow('Publisher', opData.publisher));
      rows.push(opRow('Asset', opData.asset_id));
      rows.push(opRow('Feed', JSON.stringify(opData.feed || {})));
      break;

    // 20: witness_create
    case 20:
      rows.push(opRow('Witness Account', opData.witness_account));
      rows.push(opRow('URL', opData.url));
      rows.push(opRow('Block Signing Key', opData.block_signing_key));
      break;

    // 21: witness_update
    case 21:
      rows.push(opRow('Witness', opData.witness));
      rows.push(opRow('Witness Account', opData.witness_account));
      if (opData.new_url) rows.push(opRow('New URL', opData.new_url));
      if (opData.new_signing_key) rows.push(opRow('New Signing Key', opData.new_signing_key));
      break;

    // 22: proposal_create
    case 22:
      rows.push(opRow('Fee Paying Account', opData.fee_paying_account));
      rows.push(opRow('Expiration', opData.expiration_time));
      rows.push(opRow('Num Proposed Ops', (opData.proposed_ops || []).length));
      if (opData.review_period_seconds !== undefined) rows.push(opRow('Review Period (s)', opData.review_period_seconds));
      break;

    // 23: proposal_update
    case 23:
      rows.push(opRow('Fee Paying Account', opData.fee_paying_account));
      rows.push(opRow('Proposal', opData.proposal));
      rows.push(opRow('Active Approvals to Add', (opData.active_approvals_to_add || []).join(', ') || 'None'));
      rows.push(opRow('Active Approvals to Remove', (opData.active_approvals_to_remove || []).join(', ') || 'None'));
      break;

    // 24: proposal_delete
    case 24:
      rows.push(opRow('Fee Paying Account', opData.fee_paying_account));
      rows.push(opRow('Proposal', opData.proposal));
      rows.push(opRow('Using Owner Authority', opData.using_owner_authority ? 'Yes' : 'No'));
      break;

    // 25: withdraw_permission_create
    case 25:
      rows.push(opRow('Withdraw From Account', opData.withdraw_from_account));
      rows.push(opRow('Authorized Account', opData.authorized_account));
      rows.push(opRow('Withdrawal Limit', formatAsset(opData.withdrawal_limit)));
      rows.push(opRow('Withdrawal Period (s)', opData.withdrawal_period_sec));
      rows.push(opRow('Periods Until Expiration', opData.periods_until_expiration));
      rows.push(opRow('Period Start', opData.period_start_time));
      break;

    // 26: withdraw_permission_update
    case 26:
      rows.push(opRow('Withdraw From Account', opData.withdraw_from_account));
      rows.push(opRow('Authorized Account', opData.authorized_account));
      rows.push(opRow('Permission to Update', opData.permission_to_update));
      rows.push(opRow('New Withdrawal Limit', formatAsset(opData.new_withdrawal_limit)));
      rows.push(opRow('New Period (s)', opData.new_withdrawal_period_sec));
      rows.push(opRow('New Period Start', opData.new_period_start_time));
      rows.push(opRow('New Periods Until Expiration', opData.new_periods_until_expiration));
      break;

    // 27: withdraw_permission_claim
    case 27:
      rows.push(opRow('Withdraw Permission', opData.withdraw_permission));
      rows.push(opRow('Withdraw From Account', opData.withdraw_from_account));
      rows.push(opRow('Withdraw To Account', opData.withdraw_to_account));
      rows.push(opRow('Amount to Withdraw', formatAsset(opData.amount_to_withdraw)));
      if (opData.memo) rows.push(opRow('Memo', typeof opData.memo === 'object' ? '[encrypted]' : opData.memo));
      break;

    // 28: withdraw_permission_delete
    case 28:
      rows.push(opRow('Withdraw From Account', opData.withdraw_from_account));
      rows.push(opRow('Authorized Account', opData.authorized_account));
      rows.push(opRow('Withdrawal Permission', opData.withdrawal_permission));
      break;

    // 29: committee_member_create
    case 29:
      rows.push(opRow('Committee Member Account', opData.committee_member_account));
      rows.push(opRow('URL', opData.url));
      break;

    // 30: committee_member_update
    case 30:
      rows.push(opRow('Committee Member', opData.committee_member));
      rows.push(opRow('Committee Member Account', opData.committee_member_account));
      if (opData.new_url) rows.push(opRow('New URL', opData.new_url));
      break;

    // 31: committee_member_update_global_parameters
    case 31:
      rows.push(opRow('New Parameters', JSON.stringify(opData.new_parameters || {})));
      break;

    // 32: vesting_balance_create
    case 32:
      rows.push(opRow('Creator', opData.creator));
      rows.push(opRow('Owner', opData.owner));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      rows.push(opRow('Policy', JSON.stringify(opData.policy || {})));
      break;

    // 33: vesting_balance_withdraw
    case 33:
      rows.push(opRow('Vesting Balance', opData.vesting_balance));
      rows.push(opRow('Owner', opData.owner));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      break;

    // 34: worker_create
    case 34:
      rows.push(opRow('Owner', opData.owner));
      rows.push(opRow('Name', opData.name));
      rows.push(opRow('Work Begin Date', opData.work_begin_date));
      rows.push(opRow('Work End Date', opData.work_end_date));
      rows.push(opRow('Daily Pay', (opData.daily_pay ?? '').toLocaleString()));
      rows.push(opRow('URL', opData.url));
      break;

    // 35: custom
    case 35:
      rows.push(opRow('Payer', opData.payer));
      rows.push(opRow('Required Auths', (opData.required_auths || []).join(', ') || 'None'));
      rows.push(opRow('ID', opData.id));
      rows.push(opRow('Data (hex)', opData.data));
      break;

    // 36: assert
    case 36:
      rows.push(opRow('Fee Paying Account', opData.fee_paying_account));
      rows.push(opRow('Predicates', JSON.stringify(opData.predicates || [])));
      rows.push(opRow('Required Auths', (opData.required_auths || []).join(', ')));
      break;

    // 37: balance_claim
    case 37:
      rows.push(opRow('Deposit to Account', opData.deposit_to_account));
      rows.push(opRow('Balance to Claim', opData.balance_to_claim));
      rows.push(opRow('Balance Owner Key', opData.balance_owner_key));
      rows.push(opRow('Total Claimed', formatAsset(opData.total_claimed)));
      break;

    // 38: override_transfer
    case 38:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('From', opData.from));
      rows.push(opRow('To', opData.to));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      if (opData.memo) rows.push(opRow('Memo', typeof opData.memo === 'object' ? '[encrypted]' : opData.memo));
      break;

    // 39: transfer_to_blind
    case 39:
      rows.push(opRow('From', opData.from));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      rows.push(opRow('Outputs', (opData.outputs || []).length + ' output(s)'));
      break;

    // 40: blind_transfer
    case 40:
      rows.push(opRow('Inputs', (opData.inputs || []).length + ' input(s)'));
      rows.push(opRow('Outputs', (opData.outputs || []).length + ' output(s)'));
      break;

    // 41: transfer_from_blind
    case 41:
      rows.push(opRow('To', opData.to));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      rows.push(opRow('Inputs', (opData.inputs || []).length + ' input(s)'));
      break;

    // 42: asset_settle_cancel (virtual)
    case 42:
      rows.push(opRow('Settlement', opData.settlement));
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      break;

    // 43: asset_claim_fees
    case 43:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Amount to Claim', formatAsset(opData.amount_to_claim)));
      break;

    // 44: fba_distribute (virtual)
    case 44:
      rows.push(opRow('Account', opData.account_id));
      rows.push(opRow('FBA ID', opData.fba_id));
      rows.push(opRow('Amount', (opData.amount ?? '').toLocaleString()));
      break;

    // 45: bid_collateral
    case 45:
      rows.push(opRow('Bidder', opData.bidder));
      rows.push(opRow('Additional Collateral', formatAsset(opData.additional_collateral)));
      rows.push(opRow('Debt Covered', formatAsset(opData.debt_covered)));
      break;

    // 46: execute_bid (virtual)
    case 46:
      rows.push(opRow('Bidder', opData.bidder));
      rows.push(opRow('Debt', formatAsset(opData.debt)));
      rows.push(opRow('Collateral', formatAsset(opData.collateral)));
      break;

    // 47: asset_claim_pool
    case 47:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset', opData.asset_id));
      rows.push(opRow('Amount to Claim', formatAsset(opData.amount_to_claim)));
      break;

    // 48: asset_update_issuer
    case 48:
      rows.push(opRow('Issuer', opData.issuer));
      rows.push(opRow('Asset to Update', opData.asset_to_update));
      rows.push(opRow('New Issuer', opData.new_issuer));
      break;

    // 49: htlc_create
    case 49:
      rows.push(opRow('From', opData.from));
      rows.push(opRow('To', opData.to));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      rows.push(opRow('Preimage Hash', JSON.stringify(opData.preimage_hash)));
      rows.push(opRow('Preimage Size', opData.preimage_size));
      rows.push(opRow('Claim Period (s)', opData.claim_period_seconds));
      break;

    // 50: htlc_redeem
    case 50:
      rows.push(opRow('HTLC ID', opData.htlc_id));
      rows.push(opRow('Redeemer', opData.redeemer));
      rows.push(opRow('Preimage', opData.preimage));
      break;

    // 51: htlc_redeemed (virtual)
    case 51:
      rows.push(opRow('HTLC ID', opData.htlc_id));
      rows.push(opRow('From', opData.from));
      rows.push(opRow('To', opData.to));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      rows.push(opRow('Preimage', opData.preimage));
      break;

    // 52: htlc_extend
    case 52:
      rows.push(opRow('HTLC ID', opData.htlc_id));
      rows.push(opRow('Update Issuer', opData.update_issuer));
      rows.push(opRow('Seconds to Add', opData.seconds_to_add));
      break;

    // 53: htlc_refund (virtual)
    case 53:
      rows.push(opRow('HTLC ID', opData.htlc_id));
      rows.push(opRow('To', opData.to));
      break;

    // 54: custom_authority_create
    case 54:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Enabled', opData.enabled ? 'Yes' : 'No'));
      rows.push(opRow('Valid From', opData.valid_from));
      rows.push(opRow('Valid To', opData.valid_to));
      rows.push(opRow('Operation Type', opData.operation_type));
      break;

    // 55: custom_authority_update
    case 55:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Authority to Update', opData.authority_to_update));
      if (opData.new_enabled !== undefined) rows.push(opRow('New Enabled', opData.new_enabled ? 'Yes' : 'No'));
      if (opData.new_valid_from) rows.push(opRow('New Valid From', opData.new_valid_from));
      if (opData.new_valid_to) rows.push(opRow('New Valid To', opData.new_valid_to));
      break;

    // 56: custom_authority_delete
    case 56:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Authority to Delete', opData.authority_to_delete));
      break;

    // 57: ticket_create
    case 57:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Target Type', opData.target_type));
      rows.push(opRow('Amount', formatAsset(opData.amount)));
      break;

    // 58: ticket_update
    case 58:
      rows.push(opRow('Ticket', opData.ticket));
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Target Type', opData.target_type));
      rows.push(opRow('Amount for New Ticket', formatAsset(opData.amount_for_new_ticket)));
      break;

    // 59: liquidity_pool_create
    case 59:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Asset A', opData.asset_a));
      rows.push(opRow('Asset B', opData.asset_b));
      rows.push(opRow('Share Asset', opData.share_asset));
      rows.push(opRow('Taker Fee Percent', opData.taker_fee_percent !== undefined ? `${opData.taker_fee_percent / 100}%` : 'N/A'));
      rows.push(opRow('Withdrawal Fee Percent', opData.withdrawal_fee_percent !== undefined ? `${opData.withdrawal_fee_percent / 100}%` : 'N/A'));
      break;

    // 60: liquidity_pool_delete
    case 60:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Pool', opData.pool));
      break;

    // 61: liquidity_pool_deposit
    case 61:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Pool', opData.pool));
      rows.push(opRow('Amount A', formatAsset(opData.amount_a)));
      rows.push(opRow('Amount B', formatAsset(opData.amount_b)));
      break;

    // 62: liquidity_pool_withdraw
    case 62:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Pool', opData.pool));
      rows.push(opRow('Share Amount', formatAsset(opData.share_amount)));
      break;

    // 63: liquidity_pool_exchange
    case 63:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Pool', opData.pool));
      rows.push(opRow('Amount to Sell', formatAsset(opData.amount_to_sell)));
      rows.push(opRow('Min to Receive', formatAsset(opData.min_to_receive)));
      break;

    // 64: samet_fund_create
    case 64:
      rows.push(opRow('Owner Account', opData.owner_account));
      rows.push(opRow('Asset Type', opData.asset_type));
      rows.push(opRow('Balance', (opData.balance ?? '').toLocaleString()));
      rows.push(opRow('Fee Rate', opData.fee_rate));
      break;

    // 65: samet_fund_delete
    case 65:
      rows.push(opRow('Owner Account', opData.owner_account));
      rows.push(opRow('Fund', opData.fund_id));
      break;

    // 66: samet_fund_update
    case 66:
      rows.push(opRow('Owner Account', opData.owner_account));
      rows.push(opRow('Fund', opData.fund_id));
      if (opData.delta_amount) rows.push(opRow('Delta Amount', formatAsset(opData.delta_amount)));
      if (opData.new_fee_rate !== undefined) rows.push(opRow('New Fee Rate', opData.new_fee_rate));
      break;

    // 67: samet_fund_borrow
    case 67:
      rows.push(opRow('Borrower', opData.borrower));
      rows.push(opRow('Fund', opData.fund_id));
      rows.push(opRow('Borrow Amount', formatAsset(opData.borrow_amount)));
      break;

    // 68: samet_fund_repay
    case 68:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Fund', opData.fund_id));
      rows.push(opRow('Repay Amount', formatAsset(opData.repay_amount)));
      rows.push(opRow('Fee', formatAsset(opData.fund_fee)));
      break;

    // 69: credit_offer_create
    case 69:
      rows.push(opRow('Owner Account', opData.owner_account));
      rows.push(opRow('Asset Type', opData.asset_type));
      rows.push(opRow('Balance', opData.balance));
      rows.push(opRow('Fee Rate', opData.fee_rate));
      rows.push(opRow('Max Duration (s)', opData.max_duration_seconds));
      rows.push(opRow('Min Deal Amount', formatAsset(opData.min_deal_amount)));
      rows.push(opRow('Enabled', opData.enabled ? 'Yes' : 'No'));
      rows.push(opRow('Offer Expiry', opData.offer_expiry_time));
      break;

    // 70: credit_offer_delete
    case 70:
      rows.push(opRow('Owner Account', opData.owner_account));
      rows.push(opRow('Offer', opData.offer_id));
      break;

    // 71: credit_offer_update
    case 71:
      rows.push(opRow('Owner Account', opData.owner_account));
      rows.push(opRow('Offer', opData.offer_to_update));
      if (opData.delta_amount) rows.push(opRow('Delta Amount', formatAsset(opData.delta_amount)));
      if (opData.new_fee_rate !== undefined) rows.push(opRow('New Fee Rate', opData.new_fee_rate));
      if (opData.new_max_duration_seconds !== undefined) rows.push(opRow('New Max Duration (s)', opData.new_max_duration_seconds));
      if (opData.new_min_deal_amount) rows.push(opRow('New Min Deal Amount', formatAsset(opData.new_min_deal_amount)));
      if (opData.new_enabled !== undefined) rows.push(opRow('New Enabled', opData.new_enabled ? 'Yes' : 'No'));
      if (opData.new_offer_expiry_time) rows.push(opRow('New Offer Expiry', opData.new_offer_expiry_time));
      break;

    // 72: credit_offer_accept
    case 72:
      rows.push(opRow('Borrower', opData.borrower));
      rows.push(opRow('Offer', opData.offer_id));
      rows.push(opRow('Borrow Amount', formatAsset(opData.borrow_amount)));
      rows.push(opRow('Collateral', formatAsset(opData.collateral)));
      rows.push(opRow('Max Fee Rate', opData.max_fee_rate));
      rows.push(opRow('Repay Period (s)', opData.repay_period_seconds));
      break;

    // 73: credit_deal_repay
    case 73:
      rows.push(opRow('Account', opData.account));
      rows.push(opRow('Deal', opData.deal_id));
      rows.push(opRow('Repay Amount', formatAsset(opData.repay_amount)));
      rows.push(opRow('Credit Fee', formatAsset(opData.credit_fee)));
      break;

    // 74: credit_deal_expired (virtual)
    case 74:
      rows.push(opRow('Deal', opData.deal_id));
      rows.push(opRow('Offer', opData.offer_id));
      rows.push(opRow('Offer Owner', opData.offer_owner));
      rows.push(opRow('Borrower', opData.borrower));
      rows.push(opRow('Unpaid Amount', formatAsset(opData.unpaid_amount)));
      rows.push(opRow('Collateral', formatAsset(opData.collateral)));
      break;

    default: {
      // Unknown operation: show raw JSON
      return `<div class="op-detail-unknown">
        <p class="op-detail-label">Raw Parameters:</p>
        ${jsonBlock(opData)}
      </div>`;
    }
  }

  if (rows.length === 0) {
    return `<div class="op-detail-unknown">
      <p class="op-detail-label">Raw Parameters:</p>
      ${jsonBlock(opData)}
    </div>`;
  }

  // Append fee row using the on-chain fee schedule instead of the placeholder
  // opData.fee (which is always {amount:0, asset_id:'1.3.0'} before broadcast).
  {
    let feeStr = null;
    try {
      if (btsAPI && btsAPI.isConnected) {
        const feeSchedule = await btsAPI.getFeeSchedule();
        // feeSchedule.parameters is an array of [opId, feeParams] pairs
        const opFeeEntry = feeSchedule?.parameters?.find(([id]) => id === opType);
        if (opFeeEntry) {
          const fp = opFeeEntry[1];
          let totalFee = fp.fee ?? fp.basic_fee ?? 0;
          // For transfer ops with an encrypted memo, add the per-kbyte component.
          // The encrypted memo is stored as a hex string in opData.memo.message;
          // its length / 2 gives the ciphertext byte count.
          if (opType === 0 && opData.memo && fp.price_per_kbyte) {
            const cipherBytes = typeof opData.memo.message === 'string'
              ? opData.memo.message.length / 2
              : 0;
            const memoSerialised = 33 + 33 + 8 + cipherBytes; // from-key + to-key + nonce + ciphertext
            totalFee += Math.floor(memoSerialised * fp.price_per_kbyte / 1024);
          }
          const feeAssetId = opData.fee?.asset_id || '1.3.0';
          const feeAsset = await btsAPI.getAsset(feeAssetId);
          const precision = Math.pow(10, feeAsset.precision);
          feeStr = `${(totalFee / precision).toFixed(feeAsset.precision)} ${feeAsset.symbol}`;
        }
      }
    } catch (e) {
      console.error('Fee schedule lookup error in renderOperationDetails:', e);
    }
    if (!feeStr) {
      // Fall back to whatever is in opData.fee (may still show 0, but is better than crashing)
      feeStr = opData.fee ? await formatAssetAsync(opData.fee) : '?';
    }
    rows.push(opRow('Fee', feeStr));
  }

  return `<div class="op-detail-rows">${rows.join('')}</div>`;
}

/**
 * Show the generic transaction signing modal.
 * operations is an array of [opType, opData] pairs (BitShares transaction format).
 */
async function showTransactionSigningModal(requestId, origin, operations) {
  const originEl = document.getElementById('tx-sign-origin');
  const badgeEl = document.getElementById('tx-sign-op-badge');
  const detailsEl = document.getElementById('tx-sign-details');

  if (originEl) originEl.textContent = origin;

  if (!operations || operations.length === 0) {
    if (badgeEl) badgeEl.textContent = 'Unknown Operation';
    if (detailsEl) detailsEl.innerHTML = '<p class="op-detail-empty">No operation data available.</p>';
    pendingDappRequest = { id: requestId, type: 'transaction', origin };
    showModal('dapp-transaction-modal');
    return;
  }

  // Render all operations in the transaction
  let allDetailsHtml = '';
  let badgeText = '';

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    // BitShares ops are encoded as [opType, opData]
    const opType = Array.isArray(op) ? op[0] : (op.type !== undefined ? op.type : op.op_type);
    const opData = Array.isArray(op) ? op[1] : (op.data || op.op || op);

    const opName = OPERATION_NAMES[opType] || `Operation ${opType}`;

    if (i === 0) {
      badgeText = opName;
    }

    if (operations.length > 1) {
      allDetailsHtml += `<div class="op-section-header">Operation ${i + 1}: ${escapeHtml(opName)}</div>`;
    }

    allDetailsHtml += await renderOperationDetails(opType, opData);
  }

  if (operations.length > 1) {
    badgeText = `${operations.length} Operations`;
  }

  if (badgeEl) badgeEl.textContent = badgeText;
  if (detailsEl) detailsEl.innerHTML = allDetailsHtml;

  pendingDappRequest = { id: requestId, type: 'transaction', origin };
  showModal('dapp-transaction-modal');
}

async function handleTransactionSignReject() {
  if (pendingDappRequest) {
    try {
      await chrome.runtime.sendMessage({
        type: 'DAPP_APPROVE_TRANSACTION',
        data: { requestId: pendingDappRequest.id, approved: false }
      });
    } catch (e) {
      console.error('Failed to reject transaction signing:', e);
    }
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' });
  }
  pendingDappRequest = null;
  hideModal('dapp-transaction-modal');
}

async function handleTransactionSignApprove() {
  if (pendingDappRequest) {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'DAPP_APPROVE_TRANSACTION',
        data: { requestId: pendingDappRequest.id, approved: true }
      });
      if (result?.success === false) {
        showToast('Transaction failed: ' + (result.error || 'Unknown error'), 'error');
      } else {
        showToast('Transaction signed!', 'success');
        await loadDashboard();
      }
    } catch (e) {
      console.error('Failed to approve transaction signing:', e);
      showToast('Transaction failed: ' + e.message, 'error');
    }
    await chrome.storage.local.remove(['pendingApproval']);
    await chrome.action.setBadgeText({ text: '' });
  }
  pendingDappRequest = null;
  hideModal('dapp-transaction-modal');
}

// === Timestamp-based Auto-lock (works when extension is inactive) ===

async function updateLastActivityTimestamp() {
  const timestamp = Date.now();
  await chrome.storage.local.set({ lastActivityTimestamp: timestamp });
}

async function checkAutoLock() {
  if (isLocked) return;

  const result = await chrome.storage.local.get(['autolockMinutes', 'lastActivityTimestamp']);
  const minutes = result.autolockMinutes ?? 15; // Default to 15 minutes

  if (minutes <= 0) return; // Never auto-lock

  const lastActivity = result.lastActivityTimestamp || Date.now();
  const elapsed = Date.now() - lastActivity;
  const timeout = minutes * 60 * 1000;

  if (elapsed >= timeout) {
    handleLock();
  }
}

// Update timestamp on user activity
document.addEventListener('click', updateLastActivityTimestamp);
document.addEventListener('keypress', updateLastActivityTimestamp);

// Check auto-lock on startup
checkAutoLock();

// Also set initial timestamp
updateLastActivityTimestamp();

// === Change Password ===

document.getElementById('setting-change-password')?.addEventListener('click', () => {
  showScreen('change-password-screen');
});

document.getElementById('new-password')?.addEventListener('input', (e) => {
  const password = e.target.value;
  const strengthIndicator = document.getElementById('new-password-strength');
  const strength = calculatePasswordStrength(password);
  strengthIndicator.className = 'password-strength ' + strength;
});

document.getElementById('btn-change-password')?.addEventListener('click', handleChangePassword);

async function handleChangePassword() {
  const currentPassword = document.getElementById('current-password')?.value;
  const newPassword = document.getElementById('new-password')?.value;
  const confirmPassword = document.getElementById('new-password-confirm')?.value;

  if (!currentPassword) {
    showToast('Please enter your current password', 'error');
    return;
  }

  if (!newPassword || newPassword.length < 12) {
    showToast('New password must be at least 12 characters', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }

  try {
    const success = await walletManager.changePassword(currentPassword, newPassword);
    if (success) {
      showToast('Password changed successfully!', 'success');
      // Clear form
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('new-password-confirm').value = '';
      document.getElementById('new-password-strength').className = 'password-strength';
      showScreen('settings-screen');
    } else {
      showToast('Current password is incorrect', 'error');
    }
  } catch (error) {
    console.error('Change password error:', error);
    showToast('Failed to change password: ' + error.message, 'error');
  }
}

// === Retrieve Private Key ===

document.getElementById('setting-retrieve-key')?.addEventListener('click', async () => {
  // Clear previous state
  document.getElementById('retrieve-key-password').value = '';
  document.getElementById('private-key-display').style.display = 'none';

  // Populate account selector
  const accounts = await walletManager.getAllAccounts();
  const activeAccount = await walletManager.getCurrentAccount();
  const selector = document.getElementById('retrieve-key-account');

  if (selector && accounts.length > 0) {
    selector.innerHTML = accounts.map(acc =>
      `<option value="${acc.id}" ${acc.id === activeAccount?.id ? 'selected' : ''}>${acc.name}</option>`
    ).join('');
  }

  showScreen('retrieve-key-screen');
});

document.getElementById('btn-reveal-key')?.addEventListener('click', handleRevealKey);
document.getElementById('btn-copy-private-key')?.addEventListener('click', handleCopyPrivateKey);

async function handleRevealKey() {
  const password = document.getElementById('retrieve-key-password')?.value;
  const keyType = document.getElementById('key-type-select')?.value;
  const accountId = document.getElementById('retrieve-key-account')?.value;

  if (!password) {
    showToast('Please enter your password', 'error');
    return;
  }

  try {
    if (keyType === 'bitsharesPassword') {
      // Handle BitShares password reveal
      const btsCredentials = await walletManager.getBitsharesPassword(password, accountId);
      if (btsCredentials) {
        document.getElementById('revealed-private-key').textContent = btsCredentials.password;
        document.getElementById('revealed-public-key').textContent = `Account: ${btsCredentials.accountName}`;
        document.getElementById('private-key-display').style.display = 'block';
      } else {
        showToast('BitShares password not available (wallet was not imported via account+password)', 'error');
      }
    } else {
      // Handle regular key reveal
      const keys = await walletManager.getPrivateKey(password, keyType, accountId);
      if (keys) {
        document.getElementById('revealed-private-key').textContent = keys.privateKey;
        document.getElementById('revealed-public-key').textContent = keys.publicKey;
        document.getElementById('private-key-display').style.display = 'block';
      } else {
        showToast('Invalid password or key not available', 'error');
      }
    }
  } catch (error) {
    console.error('Reveal key error:', error);
    showToast('Failed to retrieve key: ' + error.message, 'error');
  }
}

async function handleCopyPrivateKey() {
  const privateKey = document.getElementById('revealed-private-key')?.textContent;
  try {
    await navigator.clipboard.writeText(privateKey);
    showToast('Private key copied!', 'success');
  } catch (error) {
    showToast('Failed to copy', 'error');
  }
}

// === Address Book ===

document.getElementById('setting-address-book')?.addEventListener('click', () => {
  showScreen('address-book-screen');
  loadAddressBook();
});

document.getElementById('btn-add-contact')?.addEventListener('click', handleAddContact);
document.getElementById('btn-open-address-book')?.addEventListener('click', showAddressBookForSend);

let contactCheckTimeout;
document.getElementById('contact-account')?.addEventListener('input', (e) => {
  const account = e.target.value;
  const statusEl = document.getElementById('contact-account-status');

  clearTimeout(contactCheckTimeout);

  if (!account) {
    statusEl.textContent = '';
    return;
  }

  contactCheckTimeout = setTimeout(async () => {
    try {
      const accountData = await btsAPI.getAccount(account);
      if (accountData) {
        statusEl.textContent = '✓ Valid account';
        statusEl.className = 'input-status valid';
      } else {
        statusEl.textContent = '✗ Account not found';
        statusEl.className = 'input-status invalid';
      }
    } catch (error) {
      statusEl.textContent = '✗ Account not found';
      statusEl.className = 'input-status invalid';
    }
  }, 500);
});

async function getAddressBook() {
  return new Promise(resolve => {
    chrome.storage.local.get(['addressBook'], result => {
      resolve(result.addressBook || []);
    });
  });
}

async function saveAddressBook(contacts) {
  return new Promise(resolve => {
    chrome.storage.local.set({ addressBook: contacts }, resolve);
  });
}

async function loadAddressBook() {
  const contactsList = document.getElementById('contacts-list');
  const contacts = await getAddressBook();
  const walletAccounts = await walletManager.getAllAccounts();

  contactsList.innerHTML = '';

  // Show wallet accounts first (if any), excluding watch-only accounts
  if (walletAccounts && walletAccounts.length > 0) {
    // Filter out watch-only accounts
    const nonWatchOnlyAccounts = [];
    for (const account of walletAccounts) {
      const isWatchOnly = await walletManager.isWatchOnlyAccount(account.id || account.accountId);
      if (!isWatchOnly) {
        nonWatchOnlyAccounts.push(account);
      }
    }

    if (nonWatchOnlyAccounts.length > 0) {
      const walletHeader = document.createElement('div');
      walletHeader.className = 'address-book-section-header';
      walletHeader.textContent = 'My Accounts';
      contactsList.appendChild(walletHeader);

      for (const account of nonWatchOnlyAccounts) {
        const item = document.createElement('div');
        item.className = 'contact-item wallet-account';
        item.innerHTML = `
          <div class="contact-info">
            <div class="contact-name">${account.name}</div>
            <div class="contact-account">${account.accountId || account.id}</div>
          </div>
          <div class="contact-badge">Wallet</div>
        `;
        contactsList.appendChild(item);
      }
    }
  }

  // Show saved contacts
  if (contacts.length > 0) {
    const contactsHeader = document.createElement('div');
    contactsHeader.className = 'address-book-section-header';
    contactsHeader.textContent = 'Contacts';
    contactsList.appendChild(contactsHeader);

    for (const contact of contacts) {
      const item = document.createElement('div');
      item.className = 'contact-item';
      item.innerHTML = `
        <div class="contact-info">
          <div class="contact-name">${contact.name}</div>
          <div class="contact-account">${contact.account}</div>
        </div>
        <div class="contact-actions">
          <button class="contact-btn delete" data-account="${contact.account}" title="Delete">✕</button>
        </div>
      `;
      contactsList.appendChild(item);
    }

    // Add delete event listeners
    contactsList.querySelectorAll('.contact-btn.delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await handleDeleteContact(btn.dataset.account);
      });
    });
  }

  // Show empty state only if nothing was added to the list
  if (contactsList.children.length === 0) {
    contactsList.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📇</div><p>No contacts yet</p></div>';
  }
}

async function handleAddContact() {
  const nameInput = document.getElementById('contact-name');
  const accountInput = document.getElementById('contact-account');
  const name = nameInput?.value.trim();
  const account = accountInput?.value.trim();

  if (!name) {
    showToast('Please enter a contact name', 'error');
    return;
  }

  if (!account) {
    showToast('Please enter an account name', 'error');
    return;
  }

  // Verify account exists
  try {
    const accountData = await btsAPI.getAccount(account);
    if (!accountData) {
      showToast('Account not found on chain', 'error');
      return;
    }
  } catch (error) {
    showToast('Failed to verify account', 'error');
    return;
  }

  const contacts = await getAddressBook();

  // Check for duplicate
  if (contacts.find(c => c.account.toLowerCase() === account.toLowerCase())) {
    showToast('Contact already exists', 'error');
    return;
  }

  contacts.push({ name, account, addedAt: Date.now() });
  await saveAddressBook(contacts);

  // Clear inputs
  nameInput.value = '';
  accountInput.value = '';
  document.getElementById('contact-account-status').textContent = '';

  await loadAddressBook();
  showToast('Contact added!', 'success');
}

async function handleDeleteContact(account) {
  const contacts = await getAddressBook();
  const index = contacts.findIndex(c => c.account === account);
  if (index > -1) {
    contacts.splice(index, 1);
    await saveAddressBook(contacts);
    await loadAddressBook();
    showToast('Contact deleted', 'info');
  }
}

// Show address book modal for send screen
async function showAddressBookForSend() {
  const contacts = await getAddressBook();
  const walletAccounts = await walletManager.getAllAccounts();
  const currentAccount = await walletManager.getCurrentAccount();

  // Filter out the current account and watch-only accounts from wallet accounts
  const otherWalletAccounts = [];
  if (walletAccounts) {
    for (const acc of walletAccounts) {
      if (acc.name === currentAccount?.name) continue;
      const isWatchOnly = await walletManager.isWatchOnlyAccount(acc.id || acc.accountId);
      if (!isWatchOnly) {
        otherWalletAccounts.push(acc);
      }
    }
  }

  // Check if there's anything to show
  if (contacts.length === 0 && otherWalletAccounts.length === 0) {
    showToast('No contacts in address book', 'info');
    return;
  }

  // Build modal content
  let modalContent = '';

  // Add wallet accounts section (excluding current account)
  if (otherWalletAccounts.length > 0) {
    modalContent += '<div class="address-book-section-header">My Accounts</div>';
    modalContent += otherWalletAccounts.map(acc => `
      <div class="address-book-modal-item wallet-account" data-account="${acc.name}">
        <div class="contact-name">${acc.name}</div>
        <div class="contact-account">${acc.accountId || acc.id}</div>
      </div>
    `).join('');
  }

  // Add contacts section
  if (contacts.length > 0) {
    modalContent += '<div class="address-book-section-header">Contacts</div>';
    modalContent += contacts.map(c => `
      <div class="address-book-modal-item" data-account="${c.account}">
        <div class="contact-name">${c.name}</div>
        <div class="contact-account">${c.account}</div>
      </div>
    `).join('');
  }

  // Create a modal to show contacts
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'address-book-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Select Recipient</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body address-book-modal-content">
        ${modalContent}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Add event listeners
  modal.querySelector('.modal-close').addEventListener('click', () => {
    modal.remove();
  });

  modal.querySelectorAll('.address-book-modal-item').forEach(item => {
    item.addEventListener('click', () => {
      document.getElementById('send-to').value = item.dataset.account;
      // Trigger validation
      handleRecipientInput({ target: document.getElementById('send-to') });
      modal.remove();
    });
  });

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// === Swap Feature ===

let swapState = {
  fromAsset: null,
  toAsset: null,
  pools: [],
  selectedPool: null,
  userBalances: []
};

document.getElementById('swap-from-asset')?.addEventListener('change', handleSwapFromAssetChange);
document.getElementById('swap-to-asset')?.addEventListener('change', handleSwapToAssetChange);
document.getElementById('swap-from-amount')?.addEventListener('input', handleSwapFromAmountChange);
document.getElementById('swap-to-amount')?.addEventListener('input', handleSwapToAmountChange);
document.getElementById('btn-swap-direction')?.addEventListener('click', handleSwapDirection);
document.getElementById('btn-execute-swap')?.addEventListener('click', handleShowSwapConfirmation);
document.getElementById('btn-swap-max')?.addEventListener('click', handleSwapMax);
document.getElementById('btn-swap-cancel')?.addEventListener('click', () => hideModal('swap-confirm-modal'));
document.getElementById('btn-swap-confirm')?.addEventListener('click', handleExecuteSwap);

async function handleShowSwap() {
  // Check if current account is watch-only
  const account = await walletManager.getCurrentAccount();
  if (account && await walletManager.isWatchOnlyAccount(account.id)) {
    showToast('Cannot swap from watch-only account', 'error');
    return;
  }

  showScreen('swap-screen');
  await initializeSwap();
}

async function initializeSwap() {
  try {
    const account = await walletManager.getCurrentAccount();
    if (!account || !account.id || account.id === '1.2.0') {
      showToast('Please import an account first', 'error');
      return;
    }

    // Get user balances
    const balances = await btsAPI.getAccountBalances(account.id);
    swapState.userBalances = balances;

    // Populate from asset dropdown with user's assets
    const fromSelect = document.getElementById('swap-from-asset');
    fromSelect.innerHTML = '<option value="">Select asset</option>';

    for (const balance of balances) {
      if (parseInt(balance.amount) > 0) {
        const asset = await btsAPI.getAsset(balance.asset_id);
        const precision = Math.pow(10, asset.precision);
        const amount = (parseInt(balance.amount) / precision).toFixed(asset.precision);
        fromSelect.innerHTML += `<option value="${asset.id}" data-symbol="${asset.symbol}" data-precision="${asset.precision}">${asset.symbol} (${amount})</option>`;
      }
    }

    // Clear to asset dropdown
    document.getElementById('swap-to-asset').innerHTML = '<option value="">Select asset</option>';

    // Reset state
    swapState.fromAsset = null;
    swapState.toAsset = null;
    swapState.pools = [];
    swapState.selectedPool = null;

    // Clear amount fields
    document.getElementById('swap-from-amount').value = '';
    document.getElementById('swap-to-amount').value = '';
    document.getElementById('swap-from-balance').textContent = '0';
    document.getElementById('swap-min-received').textContent = '-';

    // Hide details
    document.getElementById('swap-pools-section').style.display = 'none';
    document.getElementById('swap-details').style.display = 'none';
    document.getElementById('btn-execute-swap').disabled = true;
    document.getElementById('btn-execute-swap').textContent = 'Select assets to swap';
  } catch (error) {
    console.error('Initialize swap error:', error);
    showToast('Failed to initialize swap', 'error');
  }
}

// Refresh swap balances without resetting asset selection
async function refreshSwapBalances() {
  try {
    const account = await walletManager.getCurrentAccount();
    if (!account || !account.id) return;

    // Fetch fresh balances
    const balances = await btsAPI.getAccountBalances(account.id);
    swapState.userBalances = balances;

    // Update the from asset dropdown options with new balances
    const fromSelect = document.getElementById('swap-from-asset');
    const currentFromAsset = swapState.fromAsset;

    // Update options with new balances
    for (const option of fromSelect.options) {
      if (option.value) {
        const balance = balances.find(b => b.asset_id === option.value);
        if (balance) {
          const asset = await btsAPI.getAsset(option.value);
          const precision = Math.pow(10, asset.precision);
          const amount = (parseInt(balance.amount) / precision).toFixed(asset.precision);
          option.textContent = `${asset.symbol} (${amount})`;
        }
      }
    }

    // Update the from balance display if an asset is selected
    if (currentFromAsset) {
      const balance = balances.find(b => b.asset_id === currentFromAsset);
      const asset = await btsAPI.getAsset(currentFromAsset);
      if (balance && asset) {
        const precision = Math.pow(10, asset.precision);
        const amount = (parseInt(balance.amount) / precision).toFixed(asset.precision);
        document.getElementById('swap-from-balance').textContent = amount;
      }
    }

    // Clear input amounts
    document.getElementById('swap-from-amount').value = '';
    document.getElementById('swap-to-amount').value = '';
  } catch (error) {
    console.error('Refresh swap balances error:', error);
  }
}

async function handleSwapFromAssetChange(e) {
  const assetId = e.target.value;
  if (!assetId) {
    document.getElementById('swap-to-asset').innerHTML = '<option value="">Select asset</option>';
    document.getElementById('swap-pools-section').style.display = 'none';
    return;
  }

  swapState.fromAsset = assetId;

  // Clear amount fields when asset changes
  document.getElementById('swap-from-amount').value = '';
  document.getElementById('swap-to-amount').value = '';
  document.getElementById('swap-min-received').textContent = '-';

  // Update balance display
  const balance = swapState.userBalances.find(b => b.asset_id === assetId);
  const asset = await btsAPI.getAsset(assetId);
  if (balance && asset) {
    const precision = Math.pow(10, asset.precision);
    const amount = (parseInt(balance.amount) / precision).toFixed(asset.precision);
    document.getElementById('swap-from-balance').textContent = amount;
  }

  // Find pools that include this asset
  await findSwapPools(assetId);
}

async function findSwapPools(assetId) {
  try {
    showToast('Finding liquidity pools...', 'info');

    // Get all liquidity pools for this asset
    const pools = await btsAPI.call(
      btsAPI.apiIds.database,
      'get_liquidity_pools_by_asset_a',
      [assetId, 100]
    );

    const poolsB = await btsAPI.call(
      btsAPI.apiIds.database,
      'get_liquidity_pools_by_asset_b',
      [assetId, 100]
    );

    // Combine and dedupe
    const allPools = [...(pools || []), ...(poolsB || [])];
    const uniquePools = allPools.filter((pool, index, self) =>
      index === self.findIndex(p => p.id === pool.id)
    );

    swapState.pools = uniquePools;

    // Get counter assets for the to dropdown
    const counterAssets = new Set();
    for (const pool of uniquePools) {
      if (pool.asset_a === assetId) {
        counterAssets.add(pool.asset_b);
      } else {
        counterAssets.add(pool.asset_a);
      }
    }

    // Populate to asset dropdown
    const toSelect = document.getElementById('swap-to-asset');
    toSelect.innerHTML = '<option value="">Select asset</option>';

    for (const counterAssetId of counterAssets) {
      const asset = await btsAPI.getAsset(counterAssetId);
      if (asset) {
        toSelect.innerHTML += `<option value="${asset.id}" data-symbol="${asset.symbol}" data-precision="${asset.precision}">${asset.symbol}</option>`;
      }
    }

    if (counterAssets.size === 0) {
      showToast('No liquidity pools found for this asset', 'info');
    }
  } catch (error) {
    console.error('Find pools error:', error);
    showToast('Failed to find liquidity pools', 'error');
  }
}

async function handleSwapToAssetChange(e) {
  const toAssetId = e.target.value;
  if (!toAssetId || !swapState.fromAsset) return;

  swapState.toAsset = toAssetId;

  // Clear only the output field; keep the amount the user already typed
  document.getElementById('swap-to-amount').value = '';
  document.getElementById('swap-min-received').textContent = '-';

  // Find matching pools
  const matchingPools = swapState.pools.filter(pool =>
    (pool.asset_a === swapState.fromAsset && pool.asset_b === toAssetId) ||
    (pool.asset_b === swapState.fromAsset && pool.asset_a === toAssetId)
  );

  if (matchingPools.length === 0) {
    showToast('No pools found for this pair', 'error');
    return;
  }

  // Calculate rates and sort by best rate
  const poolsWithRates = await calculatePoolRates(matchingPools);

  // Display pools
  displaySwapPools(poolsWithRates);
}

async function calculatePoolRates(pools) {
  const fromAsset = await btsAPI.getAsset(swapState.fromAsset);
  const toAsset = await btsAPI.getAsset(swapState.toAsset);

  const poolsWithRates = [];

  for (const pool of pools) {
    const isAssetAFrom = pool.asset_a === swapState.fromAsset;

    const balanceA = parseInt(pool.balance_a);
    const balanceB = parseInt(pool.balance_b);

    // Calculate rate using constant product formula
    let rate;
    if (isAssetAFrom) {
      // Swapping A for B
      rate = balanceB / balanceA;
    } else {
      // Swapping B for A
      rate = balanceA / balanceB;
    }

    // Adjust for precision
    const fromPrecision = Math.pow(10, fromAsset.precision);
    const toPrecision = Math.pow(10, toAsset.precision);
    rate = rate * (fromPrecision / toPrecision);

    poolsWithRates.push({
      ...pool,
      rate,
      feePercent: parseInt(pool.taker_fee_percent) / 100,
      isAssetAFrom
    });
  }

  // Sort by best rate (highest rate for the user)
  poolsWithRates.sort((a, b) => b.rate - a.rate);

  return poolsWithRates;
}

function displaySwapPools(pools) {
  const poolsList = document.getElementById('swap-pools-list');
  const poolsSection = document.getElementById('swap-pools-section');

  poolsList.innerHTML = '';

  pools.forEach((pool, index) => {
    const item = document.createElement('div');
    item.className = `pool-item${index === 0 ? ' selected' : ''}`;
    item.dataset.poolId = pool.id;

    item.innerHTML = `
      <div class="pool-info">
        <div class="pool-name">Pool ${pool.id}${index === 0 ? '<span class="pool-badge">Best</span>' : ''}</div>
        <div class="pool-liquidity">Fee: ${pool.feePercent.toFixed(2)}%</div>
      </div>
      <div class="pool-rate">${pool.rate.toFixed(6)}</div>
    `;

    poolsList.appendChild(item);
  });

  poolsSection.style.display = 'block';

  // Select first pool (best rate)
  swapState.selectedPool = pools[0];
  updateSwapDetails();
  handleSwapFromAmountChange(); // recalculate output from any existing input amount

  // Add click handlers
  poolsList.querySelectorAll('.pool-item').forEach(item => {
    item.addEventListener('click', () => {
      poolsList.querySelectorAll('.pool-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      swapState.selectedPool = pools.find(p => p.id === item.dataset.poolId);
      updateSwapDetails();
      handleSwapFromAmountChange();
    });
  });

  // Enable swap button
  document.getElementById('btn-execute-swap').disabled = false;
  document.getElementById('btn-execute-swap').textContent = 'Swap';
}

async function updateSwapDetails() {
  const pool = swapState.selectedPool;
  if (!pool) return;

  document.getElementById('swap-rate').textContent = `1 = ${pool.rate.toFixed(6)}`;
  document.getElementById('swap-pool-fee').textContent = `${pool.feePercent.toFixed(2)}%`;
  document.getElementById('swap-details').style.display = 'block';

  // Fetch and display transaction fee
  const txFeeEl = document.getElementById('swap-tx-fee');
  if (txFeeEl) {
    try {
      if (btsAPI && btsAPI.isConnected) {
        const fee = await btsAPI.getOperationFee('liquidity_pool_exchange');
        txFeeEl.textContent = fee?.formatted || '~0.01 BTS';
      }
    } catch (e) {
      txFeeEl.textContent = '~0.01 BTS';
    }
  }
}

// Calculate TO amount based on FROM amount
async function handleSwapFromAmountChange() {
  const amount = parseFloat(document.getElementById('swap-from-amount').value) || 0;
  const pool = swapState.selectedPool;

  if (!pool || amount <= 0) {
    document.getElementById('swap-to-amount').value = '';
    document.getElementById('swap-min-received').textContent = '-';
    return;
  }

  // Get TO asset precision
  const toAsset = await btsAPI.getAsset(swapState.toAsset);
  const toPrecision = toAsset?.precision || 5;

  // Calculate output amount considering fee
  const feeMultiplier = 1 - (pool.feePercent / 100);
  const outputAmount = amount * pool.rate * feeMultiplier;

  document.getElementById('swap-to-amount').value = outputAmount.toFixed(toPrecision);

  // Minimum received (with 1% slippage)
  const minReceived = outputAmount * 0.99;
  const toSymbolLabel = toAsset?.symbol || '';
  document.getElementById('swap-min-received').textContent =
    `${minReceived.toFixed(toPrecision)}${toSymbolLabel ? ' ' + toSymbolLabel : ''}`;
}

// Calculate FROM amount based on TO amount (reverse calculation)
async function handleSwapToAmountChange() {
  const outputAmount = parseFloat(document.getElementById('swap-to-amount').value) || 0;
  const pool = swapState.selectedPool;

  if (!pool || outputAmount <= 0) {
    document.getElementById('swap-from-amount').value = '';
    document.getElementById('swap-min-received').textContent = '-';
    return;
  }

  // Get asset precisions
  const fromAsset = await btsAPI.getAsset(swapState.fromAsset);
  const toAsset = await btsAPI.getAsset(swapState.toAsset);
  const fromPrecision = fromAsset?.precision || 5;
  const toPrecision = toAsset?.precision || 5;

  // Reverse calculation: inputAmount = outputAmount / (rate * feeMultiplier)
  const feeMultiplier = 1 - (pool.feePercent / 100);
  const inputAmount = outputAmount / (pool.rate * feeMultiplier);

  document.getElementById('swap-from-amount').value = inputAmount.toFixed(fromPrecision);

  // Minimum received (with 1% slippage) - based on the entered TO amount
  const minReceived = outputAmount * 0.99;
  const toSymbolLabel = toAsset?.symbol || '';
  document.getElementById('swap-min-received').textContent =
    `${minReceived.toFixed(toPrecision)}${toSymbolLabel ? ' ' + toSymbolLabel : ''}`;
}

function handleSwapMax() {
  const balance = document.getElementById('swap-from-balance')?.textContent || '0';
  const amount = parseFloat(balance) || 0;
  if (amount > 0) {
    document.getElementById('swap-from-amount').value = balance;
    // Trigger amount change to update output
    handleSwapFromAmountChange();
  }
}

function handleSwapDirection() {
  const fromSelect = document.getElementById('swap-from-asset');
  const toSelect = document.getElementById('swap-to-asset');

  const fromValue = fromSelect.value;
  const toValue = toSelect.value;

  if (fromValue && toValue) {
    // Swap the values
    fromSelect.value = toValue;
    toSelect.value = fromValue;

    // Trigger change events
    handleSwapFromAssetChange({ target: fromSelect });
  }
}

async function handleShowSwapConfirmation() {
  const pool = swapState.selectedPool;
  const amount = parseFloat(document.getElementById('swap-from-amount').value);

  if (!pool || !amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

  // Get asset symbols
  const fromSelect = document.getElementById('swap-from-asset');
  const toSelect = document.getElementById('swap-to-asset');
  const fromSymbol = fromSelect.options[fromSelect.selectedIndex]?.dataset?.symbol || 'BTS';
  const toSymbol = toSelect.options[toSelect.selectedIndex]?.dataset?.symbol || '';

  const outputAmount = document.getElementById('swap-to-amount').value;
  // swap-min-received already includes the symbol; strip it for re-use below
  const minReceivedRaw = document.getElementById('swap-min-received').textContent.split(' ')[0];

  // Populate confirmation modal
  document.getElementById('swap-confirm-from').textContent = `${amount} ${fromSymbol}`;
  document.getElementById('swap-confirm-to').textContent = `${outputAmount} ${toSymbol}`;
  document.getElementById('swap-confirm-rate').textContent = `1 ${fromSymbol} = ${pool.rate.toFixed(6)} ${toSymbol}`;
  document.getElementById('swap-confirm-pool-fee').textContent = `${pool.feePercent.toFixed(2)}%`;
  document.getElementById('swap-confirm-min').textContent = `${minReceivedRaw} ${toSymbol}`;

  // Fetch network fee
  const networkFeeEl = document.getElementById('swap-confirm-network-fee');
  networkFeeEl.textContent = 'Loading...';
  try {
    if (btsAPI && btsAPI.isConnected) {
      // liquidity_pool_exchange fee
      const fee = await btsAPI.getOperationFee('liquidity_pool_exchange');
      networkFeeEl.textContent = fee?.formatted || '~0.01 BTS';
    } else {
      networkFeeEl.textContent = '~0.01 BTS';
    }
  } catch (e) {
    networkFeeEl.textContent = '~0.01 BTS';
  }

  showModal('swap-confirm-modal');
}

async function handleExecuteSwap() {
  hideModal('swap-confirm-modal');

  const pool = swapState.selectedPool;
  const amount = parseFloat(document.getElementById('swap-from-amount').value);

  if (!pool || !amount || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

  try {
    showToast('Preparing swap transaction...', 'info');

    const account = await walletManager.getCurrentAccount();
    const fromAsset = await btsAPI.getAsset(swapState.fromAsset);
    const toAsset = await btsAPI.getAsset(swapState.toAsset);

    const fromPrecision = Math.pow(10, fromAsset.precision);
    const toPrecision = Math.pow(10, toAsset.precision);

    const amountToSell = Math.floor(amount * fromPrecision);
    const expectedOutput = parseFloat(document.getElementById('swap-to-amount').value);
    const minToReceive = Math.floor(expectedOutput * 0.99 * toPrecision); // 1% slippage

    // Build liquidity pool exchange operation
    const opData = {
      account: account.id,
      pool: pool.id,
      amount_to_sell: {
        amount: amountToSell,
        asset_id: swapState.fromAsset
      },
      min_to_receive: {
        amount: minToReceive,
        asset_id: swapState.toAsset
      },
      extensions: []
    };

    const result = await walletManager.broadcastOperation('liquidity_pool_exchange', opData);

    if (result) {
      showToast('Swap successful!', 'success');
      // Refresh balances without resetting asset selection
      await refreshSwapBalances();
      // Also refresh dashboard balances
      await loadDashboard();
    }
  } catch (error) {
    console.error('Swap error:', error);
    showToast('Swap failed: ' + error.message, 'error');
  }
}

