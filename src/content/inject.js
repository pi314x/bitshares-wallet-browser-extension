/**
 * BitShares Wallet - Content Script (Injector)
 * Injects the inpage script and establishes communication bridge
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__BITSHARES_WALLET_INJECTED__) {
    return;
  }
  window.__BITSHARES_WALLET_INJECTED__ = true;

  // Inject inpage script
  function injectScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/content/inpage.js');
      script.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      console.error('BitShares Wallet: Failed to inject script', error);
    }
  }

  // Inject immediately
  injectScript();

  // Communication channel with background script
  let port = null;
  let messageId = 0;
  const pendingResponses = new Map();

  function connectToBackground() {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        console.log('BitShares Wallet: Extension context invalidated');
        return;
      }

      port = chrome.runtime.connect({ name: 'bitshares-wallet-content' });

      port.onMessage.addListener((message) => {
        if (message.id && pendingResponses.has(message.id)) {
          const { resolve, reject } = pendingResponses.get(message.id);
          pendingResponses.delete(message.id);

          if (message.error) {
            reject(new Error(message.error));
          } else {
            resolve(message);
          }
        } else if (message.type === 'ACCOUNT_CHANGED') {
          // Forward account change event to page
          window.postMessage({
            type: 'BITSHARES_WALLET_EVENT',
            event: 'accountChanged',
            data: message.data
          }, window.location.origin);
        } else if (message.type === 'WALLET_LOCKED') {
          // Forward lock event to page
          window.postMessage({
            type: 'BITSHARES_WALLET_EVENT',
            event: 'locked'
          }, window.location.origin);
        } else if (message.type === 'WALLET_UNLOCKED') {
          // Forward unlock event to page, including network/chainId data
          window.postMessage({
            type: 'BITSHARES_WALLET_EVENT',
            event: 'unlocked',
            data: message.data
          }, window.location.origin);
        } else if (message.type === 'NETWORK_CHANGED') {
          // Forward network change event to page
          window.postMessage({
            type: 'BITSHARES_WALLET_EVENT',
            event: 'networkChanged',
            data: message.data
          }, window.location.origin);
        } else {
          // Forward other responses to page
          window.postMessage({
            type: 'BITSHARES_WALLET_RESPONSE',
            data: message
          }, window.location.origin);
        }
      });

      port.onDisconnect.addListener(() => {
        const lastError = chrome.runtime.lastError;
        console.log('BitShares Wallet: Background connection lost', lastError?.message || '');
        port = null;

        // Reject all pending responses
        pendingResponses.forEach(({ reject }) => {
          reject(new Error('Extension disconnected'));
        });
        pendingResponses.clear();

        // Try to reconnect after delay (service worker may be restarting)
        setTimeout(() => {
          if (chrome.runtime?.id) {
            connectToBackground();
          }
        }, 1000);
      });

      console.log('BitShares Wallet: Connected to background');
    } catch (error) {
      console.error('BitShares Wallet: Failed to connect to background', error);
      // Retry after delay
      setTimeout(() => {
        if (chrome.runtime?.id) {
          connectToBackground();
        }
      }, 2000);
    }
  }

  connectToBackground();

  // Keep the MV3 service worker alive by sending a ping every 15 seconds.
  // 15 s gives a comfortable margin below Chrome's ~30 s idle cutoff.
  // Without this the service worker terminates after ~30 s of inactivity and
  // every subsequent port open triggers the "Background connection lost" cycle.
  setInterval(() => {
    if (port && chrome.runtime?.id) {
      try {
        port.postMessage({ method: 'keepalive', params: {}, id: ++messageId });
      } catch (_) {
        // Port may have just disconnected; acknowledge lastError so Chrome
        // does not log "Unchecked runtime.lastError" in the console.
        void chrome.runtime.lastError;
        // The onDisconnect handler will reconnect automatically.
      }
    }
  }, 15000);

  // Listen for messages from page script
  window.addEventListener('message', async (event) => {
    // Only accept messages from same window
    if (event.source !== window) return;
    
    // Only handle our messages
    if (event.data?.type !== 'BITSHARES_WALLET_REQUEST') return;

    const { method, params, id } = event.data;

    try {
      // Send to background and wait for response
      const response = await sendToBackground(method, params);
      
      // Send response back to page
      window.postMessage({
        type: 'BITSHARES_WALLET_RESPONSE',
        id,
        data: response
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        type: 'BITSHARES_WALLET_RESPONSE',
        id,
        error: error.message
      }, window.location.origin);
    }
  });

  function sendToBackground(method, params) {
    return new Promise((resolve, reject) => {
      if (!port) {
        reject(new Error('Not connected to extension'));
        return;
      }

      const id = ++messageId;
      pendingResponses.set(id, { resolve, reject });

      // Set timeout for response
      setTimeout(() => {
        if (pendingResponses.has(id)) {
          pendingResponses.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000); // 60 second timeout

      port.postMessage({ method, params, id });
    });
  }

  // Listen for extension events
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'WALLET_LOCKED') {
      window.postMessage({
        type: 'BITSHARES_WALLET_EVENT',
        event: 'locked'
      }, window.location.origin);
    } else if (message.type === 'WALLET_UNLOCKED') {
      window.postMessage({
        type: 'BITSHARES_WALLET_EVENT',
        event: 'unlocked',
        data: message.data
      }, window.location.origin);
    } else if (message.type === 'ACCOUNT_CHANGED') {
      window.postMessage({
        type: 'BITSHARES_WALLET_EVENT',
        event: 'accountChanged',
        data: message.data
      }, window.location.origin);
    } else if (message.type === 'NETWORK_CHANGED') {
      window.postMessage({
        type: 'BITSHARES_WALLET_EVENT',
        event: 'networkChanged',
        data: message.data
      }, window.location.origin);
    }
    return true;
  });

})();
