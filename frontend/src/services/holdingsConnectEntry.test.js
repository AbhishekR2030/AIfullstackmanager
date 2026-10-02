import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureHoldingsConnectEntry, clearEntrySecrets, consumeCallbackToken,
  HDFC_FLOW_INTENT_KEY, markHdfcFlowIntent,
  validHdfcLoginUrl, validateHoldingsSnapshot,
} from './holdingsConnectEntry.js';

const PAIR = 'ABCDEF0123456789ABCDEF0123456789';
const NOW = 1000000;

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function capture(url, historyOverrides = {}, storage = memoryStorage(), now = NOW) {
  const location = new URL(url, 'https://example.test');
  const calls = [];
  const history = {
    state: { harmless: true },
    replaceState(...args) { calls.push(args); },
    ...historyOverrides,
  };
  return { entry: captureHoldingsConnectEntry(location, history, storage, now), calls };
}

test('captures each token alias from the query and clears the whole address suffix', () => {
  for (const alias of ['request_token', 'requestToken', 'code']) {
    const { entry, calls } = capture(`/portfolio?${alias}=offline-token&tracking=x#anything`);
    assert.deepEqual(entry, { kind: 'callback', requestToken: 'offline-token', error: null });
    assert.deepEqual(calls, [[{ harmless: true }, '', '/portfolio']]);
  }
});

test('captures token-bearing fragments, including query-style and hash-router forms', () => {
  for (const hash of ['#request_token=offline-token', '#?code=offline-token', '#/auth?requestToken=offline-token']) {
    const { entry, calls } = capture(`/portfolio?tracking=x${hash}`);
    assert.equal(entry.requestToken, 'offline-token');
    assert.equal(entry.kind, 'callback');
    assert.deepEqual(calls[0], [{ harmless: true }, '', '/portfolio']);
  }
});

test('encoded callback key and token are decoded in memory', () => {
  const { entry } = capture('/?request%5Ftoken=offline%2Btoken');
  assert.deepEqual(entry, { kind: 'callback', requestToken: 'offline+token', error: null });
});

test('a question mark inside a fragment token does not bypass callback capture', () => {
  const { entry, calls } = capture('/portfolio#request_token=offline?value');
  assert.deepEqual(entry, { kind: 'callback', requestToken: 'offline?value', error: null });
  assert.equal(calls[0][2], '/portfolio');
});

test('rejects duplicated aliases across either query or fragment, even identical values', () => {
  for (const suffix of [
    '?request_token=a&request_token=a', '?request_token=a&code=b',
    '?request_token=a#code=a', '#code=a&requestToken=b',
  ]) {
    const { entry, calls } = capture(`/portfolio${suffix}`);
    assert.deepEqual(entry, { kind: 'callback', requestToken: null, error: 'invalid_callback' });
    assert.equal(calls.length, 1);
  }
});

test('malformed, empty, whitespace, control, excessive, and error callbacks fail closed', () => {
  for (const suffix of [
    '?request_token', '?code=', '?code=%20', '?code=one+two', '?code=%00',
    '?code=%', '?code=%C3%28', '?code=a&unrelated=%', '?hdfc_status=connected',
    '?error=denied', '?code=a&error=', `?code=${'a'.repeat(4097)}`,
  ]) {
    const { entry, calls } = capture(`/portfolio${suffix}`);
    assert.deepEqual(entry, { kind: 'callback', requestToken: null, error: 'invalid_callback' });
    assert.equal(calls[0][2], '/portfolio');
  }
});

test('accepts a token at the documented bound', () => {
  assert.equal(capture(`/?code=${'a'.repeat(4096)}`).entry.requestToken.length, 4096);
});

test('callback takes precedence over phone, Mac, and normal routes, including invalid callbacks', () => {
  for (const path of ['/holdings-connect', '/holdings-connect/mac', '/other']) {
    assert.equal(capture(`${path}?code=offline-token`).entry.kind, 'callback');
    assert.deepEqual(capture(`${path}?error=failed`).entry, {
      kind: 'callback', requestToken: null, error: 'invalid_callback',
    });
  }
});

test('scrubbing failure never releases a token or pairing code', () => {
  const brokenHistory = { replaceState() { throw new Error('offline simulated failure'); } };
  assert.deepEqual(capture('/?code=offline-token', brokenHistory).entry, {
    kind: 'callback', requestToken: null, error: 'invalid_callback',
  });
  assert.deepEqual(capture('/holdings-connect#unknown-fragment', brokenHistory).entry, {
    kind: 'phone', error: 'invalid_entry',
  });
  assert.equal(capture('/?code=offline-token', { replaceState: undefined }).entry.error, 'invalid_callback');
});





test('Mac dispatch and ordinary URLs do not mutate history', () => {
  for (const path of ['/holdings-connect/mac', '/holdings-connect/mac/']) {
    assert.deepEqual(capture(path), { entry: { kind: 'mac' }, calls: [] });
  }
  for (const path of ['/portfolio?filter=owned#section', '/', '/holdings-connect/mac-extra', '/holdings-connect-other']) {
    assert.deepEqual(capture(path), { entry: { kind: 'normal' }, calls: [] });
  }
});



test('accepts only the exact official HTTPS login URL with one nonempty api_key', () => {
  assert.equal(validHdfcLoginUrl('https://developer.hdfcsec.com/oapi/v1/login?api_key=mock-api-key'), true);
  assert.equal(validHdfcLoginUrl('https://developer.hdfcsec.com:443/oapi/v1/login?api_key=offline%2Bkey'), true);
  for (const value of [
    null, 42, '', '/oapi/v1/login?api_key=x', 'http://developer.hdfcsec.com/oapi/v1/login?api_key=x',
    'https://developer.hdfcsec.com.evil.test/oapi/v1/login?api_key=x',
    'https://developer.hdfcsec.com:8443/oapi/v1/login?api_key=x',
    'https://user@developer.hdfcsec.com/oapi/v1/login?api_key=x',
    'https://developer.hdfcsec.com/oapi/v1/login/?api_key=x',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=x#',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=x#fragment',
    'https://developer.hdfcsec.com/oapi/v1/login',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=x&api_key=x',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=x&redirect=https://evil.test',
    'https://developer.hdfcsec.com/oapi/v1/login?key=x',
    'https://developer.hdfcsec.com/oapi/v1/login?other=x',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=%',
    'https://developer.hdfcsec.com/oapi/v1/login?api_key=x y',
    ' https://developer.hdfcsec.com/oapi/v1/login?api_key=x',
    'https://developer.hdfcsec.com\\/oapi/v1/login?api_key=x',
  ]) assert.equal(validHdfcLoginUrl(value), false, `rejected input index ${typeof value}`);
});

test('an active explicit legacy intent passes a valid query callback to the normal app once', () => {
  const storage = memoryStorage();
  assert.equal(markHdfcFlowIntent('legacy', storage, NOW), true);
  assert.deepEqual(capture('/portfolio?request_token=offline-token', {}, storage), {
    entry: { kind: 'normal' }, calls: [],
  });
  assert.equal(storage.getItem(HDFC_FLOW_INTENT_KEY), null);
  assert.equal(capture('/portfolio?request_token=offline-token', {}, storage).entry.kind, 'callback');
});

test('active standalone intent cannot be overwritten by a legacy flow mark', () => {
  const storage = memoryStorage();
  assert.equal(markHdfcFlowIntent('legacy', storage, NOW), true);
  assert.equal(markHdfcFlowIntent('standalone', storage, NOW), true);
  const marker = storage.getItem(HDFC_FLOW_INTENT_KEY);
  assert.equal(markHdfcFlowIntent('legacy', storage, NOW + 1), false);
  assert.equal(storage.getItem(HDFC_FLOW_INTENT_KEY), marker);
  assert.equal(capture('/portfolio?request_token=offline-token', {}, storage).entry.kind, 'callback');
  assert.equal(storage.getItem(HDFC_FLOW_INTENT_KEY), null);
});

test('explicit phone and Mac routes immediately mark standalone intent using only metadata', () => {
  for (const route of ['/holdings-connect', '/holdings-connect/mac']) {
    const storage = memoryStorage();
    assert.equal(markHdfcFlowIntent('legacy', storage, NOW), true);
    capture(`${route}#unknown-fragment`, {}, storage);
    const marker = JSON.parse(storage.getItem(HDFC_FLOW_INTENT_KEY));
    assert.deepEqual(marker, { kind: 'standalone', expiresAt: NOW + 600000 });
    assert.equal(storage.values.size, 1);
    assert.equal(JSON.stringify(marker).includes(PAIR), false);
  }
});

test('explicit standalone callback routes never pass to legacy, and consume the marker', () => {
  const storage = memoryStorage();
  assert.equal(markHdfcFlowIntent('legacy', storage, NOW), true);
  assert.equal(capture('/holdings-connect?code=offline-token', {}, storage).entry.kind, 'callback');
  assert.equal(storage.getItem(HDFC_FLOW_INTENT_KEY), null);
});

test('expired standalone and legacy intents, absent intents, and malformed intents stay isolated', () => {
  for (const marker of [
    null, 'not-json', '{}', 'null', '[]',
    JSON.stringify({ kind: 'standalone', expiresAt: NOW }),
    JSON.stringify({ kind: 'legacy', expiresAt: NOW }),
    JSON.stringify({ kind: 'legacy', expiresAt: NOW + 600001 }),
    JSON.stringify({ kind: 'legacy', expiresAt: NOW + 1, token: 'offline-forbidden-field' }),
    JSON.stringify({ kind: 'legacy', expiresAt: String(NOW + 1) }),
  ]) {
    const storage = memoryStorage();
    if (marker !== null) storage.setItem(HDFC_FLOW_INTENT_KEY, marker);
    const { entry, calls } = capture('/portfolio?request_token=offline-token', {}, storage);
    assert.equal(entry.kind, 'callback');
    assert.equal(calls.length, 1);
    assert.equal(storage.getItem(HDFC_FLOW_INTENT_KEY), null);
  }
});

test('fragment and invalid callbacks never enter legacy and always consume legacy intent', () => {
  for (const suffix of [
    '#request_token=offline-token', '?code=offline-token#hdfc_status=connected',
    '?code=a&code=a', '?code=%', '?error=denied', '?hdfc_status=connected',
  ]) {
    const storage = memoryStorage();
    assert.equal(markHdfcFlowIntent('legacy', storage, NOW), true);
    const { entry, calls } = capture(`/portfolio${suffix}`, {}, storage);
    assert.equal(entry.kind, 'callback');
    assert.equal(calls.length, 1);
    assert.equal(storage.getItem(HDFC_FLOW_INTENT_KEY), null);
  }
});

test('blocked storage, including failed consume, cannot route callbacks to legacy', () => {
  for (const storage of [
    null, {},
    { getItem() { throw new Error('offline blocked read'); }, setItem() {} },
    { getItem() { return null; }, setItem() { throw new Error('offline blocked write'); } },
    {
      getItem() { return JSON.stringify({ kind: 'legacy', expiresAt: NOW + 1 }); },
      setItem() {}, removeItem() { throw new Error('offline blocked removal'); },
    },
  ]) {
    const { entry, calls } = capture('/portfolio?code=offline-token', {}, storage);
    assert.equal(entry.kind, 'callback');
    assert.equal(calls.length, 1);
  }
  assert.equal(markHdfcFlowIntent('legacy', null, NOW), false);
  assert.equal(markHdfcFlowIntent('standalone', { getItem() { return null; }, setItem() { throw new Error('offline'); } }, NOW), false);
});

test('flow marker rejects invalid kinds and clock values and contains no token or pairing code', () => {
  const storage = memoryStorage();
  for (const kind of ['normal', '', null, {}]) assert.equal(markHdfcFlowIntent(kind, storage, NOW), false);
  for (const now of [NaN, Infinity, -1, NOW + 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(markHdfcFlowIntent('legacy', storage, now), false);
  }
  assert.equal(markHdfcFlowIntent('legacy', storage, NOW), true);
  assert.deepEqual([...storage.values], [[HDFC_FLOW_INTENT_KEY, JSON.stringify({ kind: 'legacy', expiresAt: NOW + 600000 })]]);
});

test('callback tokens are consumed only once and invalid entries do not release a token', () => {
  const { entry } = capture('/portfolio?code=offline-token');
  assert.equal(consumeCallbackToken(entry), 'offline-token');
  assert.equal(entry.requestToken, null);
  assert.equal(consumeCallbackToken(entry), null);
  const invalidEntry = { kind: 'callback', requestToken: 'offline-token', error: 'invalid_callback' };
  assert.equal(consumeCallbackToken(invalidEntry), null);
  assert.equal(invalidEntry.requestToken, null);
  assert.equal(consumeCallbackToken(null), null);
});

test('clearEntrySecrets resets callback and pairing values without adding fields to normal entries', () => {
  const entry = { kind: 'callback', requestToken: 'offline-token', pairingCode: PAIR, error: null };
  clearEntrySecrets(entry);
  assert.deepEqual(entry, { kind: 'callback', requestToken: null, pairingCode: null, error: null });
  assert.equal(consumeCallbackToken(entry), null);
  const normal = { kind: 'normal' };
  clearEntrySecrets(normal);
  assert.deepEqual(normal, { kind: 'normal' });
  clearEntrySecrets(null);
});

test('default sessionStorage lookup is guarded when its getter is blocked', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new Error('offline blocked storage getter'); },
  });
  try {
    assert.equal(markHdfcFlowIntent('legacy', undefined, NOW), false);
    const location = new URL('https://example.test/portfolio?code=offline-token');
    const calls = [];
    const entry = captureHoldingsConnectEntry(location, { replaceState(...args) { calls.push(args); } }, undefined, NOW);
    assert.equal(entry.kind, 'callback');
    assert.equal(calls.length, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else delete globalThis.sessionStorage;
  }
});


test('same-phone and instruction-only Mac entries clear query and fragment without pairing', () => {
  for (const [route, kind] of [['/holdings-connect', 'phone'], ['/holdings-connect/mac', 'mac']]) {
    const { entry, calls } = capture(`${route}?unrelated=x#old-fragment`);
    assert.deepEqual(entry, { kind });
    assert.equal(calls[0][2], route);
    assert.deepEqual(capture(route).entry, { kind });
  }
});

function snapshotFixture() {
  return {
    snapshot_version: 1, source: 'HDFC InvestRight',
    as_of_utc: '2026-10-02T12:34:56.123456+00:00', account_verified: true,
    holdings_count: 1,
    holdings: [{ isin: 'INE000TEST001', company_name: 'Offline Example Ltd', security_id: '123',
      exchange: 'NSE', quantity: 3, average_price: 100, investment_value: 300, close_price: null }],
  };
}

test('validates the backend snapshot fixture and copies only whitelist fields', () => {
  const input = snapshotFixture();
  input.account_id = 'offline-account-field';
  input.access_token = 'offline-token-field';
  input.provider_payload = { secret: 'offline-value' };
  input.holdings[0].api_key = 'offline-key-field';
  const expected = snapshotFixture();
  const clone = validateHoldingsSnapshot(input);
  assert.deepEqual(clone, expected);
  assert.notEqual(clone, input);
  assert.notEqual(clone.holdings, input.holdings);
  assert.notEqual(clone.holdings[0], input.holdings[0]);
  assert.equal(JSON.stringify(clone).includes('offline-token-field'), false);
  const empty = snapshotFixture();
  empty.holdings = [];
  empty.holdings_count = 0;
  empty.as_of_utc = '2026-10-02T12:34:56Z';
  assert.deepEqual(validateHoldingsSnapshot(empty), empty);
});

test('snapshot rejects malformed and unverified envelopes with generic errors', () => {
  for (const overrides of [
    { snapshot_version: 2 }, { source: 'other' }, { account_verified: false },
    { account_verified: 'true' }, { as_of_utc: '2026-02-30T12:34:56Z' },
    { as_of_utc: '2026-10-02T25:34:56Z' }, { as_of_utc: 'not-a-date' },
    { as_of_utc: '2026-10-02' }, { as_of_utc: '2026-10-02T12:34:56+05:30' },
    { holdings_count: 2 }, { holdings_count: 1.5 }, { holdings_count: '1' },
    { holdings: null }, { holdings: Array(1) }, { holdings: Array(5001).fill({}) },
  ]) assert.throws(() => validateHoldingsSnapshot({ ...snapshotFixture(), ...overrides }), { message: 'Invalid holdings snapshot.' });
  for (const value of [null, [], {}, 'offline-secret-input']) {
    assert.throws(() => validateHoldingsSnapshot(value), { message: 'Invalid holdings snapshot.' });
  }
});

test('snapshot rejects invalid row text, quantity and optional numeric values', () => {
  for (const override of [
    { isin: 123 }, { company_name: 'x'.repeat(241) }, { security_id: null },
    { exchange: 'NSE\u0000' }, { quantity: -1 }, { quantity: NaN }, { quantity: Infinity },
    { quantity: '3' }, { quantity: true }, { quantity: undefined },
    { average_price: Infinity }, { investment_value: NaN }, { close_price: '100' },
    { close_price: undefined },
  ]) {
    const value = snapshotFixture();
    Object.assign(value.holdings[0], override);
    assert.throws(() => validateHoldingsSnapshot(value), { message: 'Invalid holdings snapshot.' });
  }
});
