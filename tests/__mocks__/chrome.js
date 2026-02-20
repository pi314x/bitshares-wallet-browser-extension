/**
 * Chrome extension API mock for Jest tests
 * Provides in-memory implementations of chrome.storage.local,
 * chrome.runtime, and related APIs.
 */

// In-memory store for chrome.storage.local
let localStore = {};
// In-memory store for chrome.storage.session (falls back to local in the mock)
let sessionStore = {};

const createStorageMock = (store) => ({
  get: jest.fn((keys, callback) => {
    let result = {};
    if (keys === null || keys === undefined) {
      result = { ...store };
    } else if (typeof keys === 'string') {
      result[keys] = store[keys];
    } else if (Array.isArray(keys)) {
      for (const key of keys) {
        result[key] = store[key];
      }
    } else if (typeof keys === 'object') {
      // keys is an object with defaults
      for (const key of Object.keys(keys)) {
        result[key] = store[key] !== undefined ? store[key] : keys[key];
      }
    }
    if (callback) callback(result);
    return Promise.resolve(result);
  }),

  set: jest.fn((items, callback) => {
    Object.assign(store, items);
    if (callback) callback();
    return Promise.resolve();
  }),

  remove: jest.fn((keys, callback) => {
    if (typeof keys === 'string') {
      delete store[keys];
    } else if (Array.isArray(keys)) {
      for (const key of keys) {
        delete store[key];
      }
    }
    if (callback) callback();
    return Promise.resolve();
  }),

  clear: jest.fn((callback) => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    if (callback) callback();
    return Promise.resolve();
  }),
});

const localStorageMock = createStorageMock(localStore);
const sessionStorageMock = createStorageMock(sessionStore);

// Message listeners list
const messageListeners = [];

const chromeMock = {
  storage: {
    local: localStorageMock,
    session: sessionStorageMock,
  },
  runtime: {
    lastError: null,
    sendMessage: jest.fn((message, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
    onMessage: {
      addListener: jest.fn((listener) => {
        messageListeners.push(listener);
      }),
      removeListener: jest.fn((listener) => {
        const idx = messageListeners.indexOf(listener);
        if (idx > -1) messageListeners.splice(idx, 1);
      }),
      hasListener: jest.fn((listener) => messageListeners.includes(listener)),
    },
  },
};

// Expose reset helper for use in beforeEach blocks
chromeMock.__resetStorage = () => {
  // Clear local store
  for (const key of Object.keys(localStore)) {
    delete localStore[key];
  }
  // Clear session store
  for (const key of Object.keys(sessionStore)) {
    delete sessionStore[key];
  }
  // Reset mock call history
  localStorageMock.get.mockClear();
  localStorageMock.set.mockClear();
  localStorageMock.remove.mockClear();
  localStorageMock.clear.mockClear();
  sessionStorageMock.get.mockClear();
  sessionStorageMock.set.mockClear();
  sessionStorageMock.remove.mockClear();
  sessionStorageMock.clear.mockClear();
  chromeMock.runtime.sendMessage.mockClear();
};

// Set as a global so all modules can access it without importing
global.chrome = chromeMock;
