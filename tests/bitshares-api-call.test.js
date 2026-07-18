/**
 * Tests for BitSharesAPI.call() self-heal + retry-once on a mid-call socket
 * drop (the "WebSocket closed: 1006" class of error that was surfacing as
 * empty balances and a send dialog with nothing preselected).
 */

import { BitSharesAPI } from '../src/lib/bitshares-api.js';

// A minimal fake open socket so call() takes the "already connected" path.
const OPEN_WS = { readyState: 1 /* WebSocket.OPEN */ };

// call() references the global WebSocket.OPEN constant.
beforeAll(() => {
  global.WebSocket = { OPEN: 1 };
});

function makeApi() {
  const api = new BitSharesAPI();
  api.ws = OPEN_WS;
  api.isConnected = true;
  api.apiIds = { database: 2, network: 3, history: 4 };
  // connect() is only invoked on the retry path; make it a no-op that "heals"
  // the socket so the next _callNow attempt runs.
  api.connect = jest.fn(async () => { api.ws = OPEN_WS; api.isConnected = true; });
  return api;
}

test('retries once and succeeds after a mid-call drop', async () => {
  const api = makeApi();
  let calls = 0;
  api._callNow = jest.fn(async () => {
    calls++;
    if (calls === 1) {
      api.ws = { readyState: 3 /* CLOSED */ };      // socket died mid-call
      throw new Error('WebSocket closed: 1006');
    }
    return 'ok';
  });

  await expect(api.call(2, 'get_account_balances', [])).resolves.toBe('ok');
  expect(api._callNow).toHaveBeenCalledTimes(2);
  expect(api.connect).toHaveBeenCalledTimes(1);      // healed before the replay
});

test('gives up after one retry (never loops forever)', async () => {
  const api = makeApi();
  api._callNow = jest.fn(async () => {
    api.ws = { readyState: 3 };
    throw new Error('WebSocket closed: 1006');
  });

  await expect(api.call(2, 'x', [])).rejects.toThrow('WebSocket closed: 1006');
  expect(api._callNow).toHaveBeenCalledTimes(2);      // original + one retry, then stop
});

test('does not retry a non-connection error', async () => {
  const api = makeApi();
  api._callNow = jest.fn(async () => { throw new Error('Assert Exception: insufficient balance'); });

  await expect(api.call(2, 'x', [])).rejects.toThrow('insufficient balance');
  expect(api._callNow).toHaveBeenCalledTimes(1);      // surfaced immediately
  expect(api.connect).not.toHaveBeenCalled();
});

test('retry:false (broadcasts) never resends on a drop', async () => {
  const api = makeApi();
  api._callNow = jest.fn(async () => {
    api.ws = { readyState: 3 };
    throw new Error('WebSocket closed: 1006');
  });

  await expect(
    api.call(3, 'broadcast_transaction_with_callback', [], { retry: false })
  ).rejects.toThrow('WebSocket closed: 1006');
  expect(api._callNow).toHaveBeenCalledTimes(1);      // sent exactly once
});

test('remaps a stale api id to its renegotiated value on reconnect', async () => {
  const api = makeApi();
  api.ws = { readyState: 3 };                          // start disconnected
  api.connect = jest.fn(async () => {
    api.ws = OPEN_WS;
    api.apiIds = { database: 99, network: 3, history: 4 };  // db id renegotiated 2 -> 99
  });
  let seen;
  api._callNow = jest.fn(async (apiId) => { seen = apiId; return 'ok'; });

  await api.call(2 /* stale database id */, 'get_account_balances', []);
  expect(seen).toBe(99);
});
