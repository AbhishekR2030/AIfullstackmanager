import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { COOKIE_NAME, ENDPOINTS, FlowError, MAX_INPUT_BYTES, MAX_RESPONSE_BYTES, ORIGIN, TTL_SECONDS, createHoldingsPhoneHandler, normalizeHoldings, openSession, sealSession } from './holdingsPhone.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ENV = Object.freeze({ HDFC_API_KEY: 'synthetic-api-key', HDFC_API_SECRET: 'synthetic-api-secret' });
const CONFIG = { key: ENV.HDFC_API_KEY, secret: ENV.HDFC_API_SECRET };
const noFetch = () => { throw new Error('Unexpected synthetic transport call'); };

function create(fetchImpl = noFetch, options = {}) {
  return createHoldingsPhoneHandler({ env: ENV, now: () => NOW, fetchImpl, ...options });
}

async function invoke(handler, { method = 'POST', body, url = '/api/holdings-phone', headers = {}, chunks } = {}) {
  const req = { method, url, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers } };
  if (body !== undefined) req.body = typeof body === 'object' && !Buffer.isBuffer(body) ? structuredClone(body) : body;
  if (chunks) req[Symbol.asyncIterator] = async function* stream() { yield* chunks; };
  const responseHeaders = {};
  let serialized;
  const res = { statusCode: 200, setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; }, end(value) { serialized = value; } };
  await handler(req, res);
  return { status: res.statusCode, headers: responseHeaders, body: JSON.parse(serialized), raw: serialized };
}

async function started(handler) {
  const start = await invoke(handler, { body: { action: 'start' } });
  assert.equal(start.status, 200);
  return start.headers['set-cookie'].split(';')[0];
}

function fakeProvider({ holdings, responseOverrides = [] } = {}) {
  const rows = holdings || [{ isin: 'DEMO00000001', company_name: 'Synthetic Company', security_id: 123, exchange: 'NSE', quantity: '3', average_price: '10.5', investment_value: '', close_price: 12, raw_private_field: 'unused' }];
  const payloads = [{ accessToken: 'synthetic-access-token' }, { status: 'success', data: rows }];
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const index = calls.length - 1;
    if (responseOverrides[index] instanceof Error) throw responseOverrides[index];
    return responseOverrides[index] || new Response(JSON.stringify(payloads[index]), { status: 200 });
  };
  return { calls, fetchImpl };
}

test('health reports configured boolean and never exposes server values', async () => {
  const result = await invoke(create(), { method: 'GET' });
  assert.deepEqual(result.body, { version: 'holdings-phone-v2', configured: true, diagnostics_version: 1, auth_method: 'token_exchange', holdings_method: 'GET', profile_verification: false });
  assert.equal(result.headers['cache-control'], 'no-store, private');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  for (const value of Object.values(ENV)) assert.ok(!result.raw.includes(value));
  for (const name of Object.keys(ENV)) {
    const env = { ...ENV };
    delete env[name];
    const unconfigured = await invoke(create(noFetch, { env }), { method: 'GET', url: '/api/holdings-phone?action=health' });
    assert.equal(unconfigured.body.configured, false);
    assert.equal((await invoke(create(noFetch, { env }), { body: { action: 'start' } })).status, 503);
    env[name] = ' ';
    assert.equal((await invoke(create(noFetch, { env }), { method: 'GET' })).body.configured, false);
  }
});

test('health rejects unexpected or repeated query actions and unsupported methods', async () => {
  for (const query of ['?action=start', '?action=health&action=health', '?extra=health']) {
    assert.equal((await invoke(create(), { method: 'GET', url: '/api/holdings-phone' + query })).status, 400);
  }
  const result = await invoke(create(), { method: 'PUT', body: {} });
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, 'GET, POST');
});

test('start creates an encrypted host-only application-bound cookie', async () => {
  const result = await invoke(create(), { body: { action: 'start' } });
  assert.equal(result.status, 200);
  const login = new URL(result.body.login_url);
  assert.equal(login.origin + login.pathname, ENDPOINTS.login);
  assert.deepEqual([...login.searchParams], [['api_key', ENV.HDFC_API_KEY]]);
  assert.equal(result.body.expires_at, '2026-10-02T12:10:00.000Z');
  const cookie = result.headers['set-cookie'];
  assert.ok(cookie.startsWith(COOKIE_NAME + '=v2.'));
  for (const flag of ['Path=/', 'Max-Age=600', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  for (const value of Object.values(ENV)) assert.ok(!cookie.includes(value));
  const payload = openSession(cookie.split(';')[0].slice(COOKIE_NAME.length + 1), CONFIG, NOW);
  assert.equal(payload.exp - payload.iat, TTL_SECONDS);
  assert.ok(!JSON.stringify(payload).includes('DEMOUSER'));
});

test('start rejects obsolete identity fields', async () => {
  const result = await invoke(create(), { body: { action: 'start', expected_user_id: 'OTHERUSER' } });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'invalid_request');
  assert.equal(result.headers['set-cookie'], undefined);
});

test('every POST requires exact origin and JSON with a single recognized action', async () => {
  for (const origin of [undefined, 'https://evil.invalid', ORIGIN + '/']) {
    const result = await invoke(create(), { body: { action: 'clear' }, headers: { origin } });
    assert.equal(result.status, 403);
  }
  assert.equal((await invoke(create(), { body: { action: 'clear' }, headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const body of [[], { action: 'unknown' }, { action: 'clear', request_token: 'synthetic-request-token' }]) {
    assert.equal((await invoke(create(), { body })).status, 400);
  }
  assert.equal((await invoke(create(), { body: { action: 'clear' }, url: '/api/holdings-phone?action=clear' })).status, 400);
});

test('array and prototype-name actions cannot enter callback dispatch', async () => {
  let calls = 0;
  const handler = create(async () => { calls += 1; throw new Error('Unexpected synthetic transport'); });
  const cookie = await started(handler);
  for (const action of [['callback'], ['start'], 'constructor', '__proto__', 'toString', null]) {
    const result = await invoke(handler, { body: { action, request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'invalid_request');
  }
  assert.equal(calls, 0);
  for (const expected_user_id of [null, [], '', ' ']) {
    const result = await invoke(handler, { body: { action: 'start', expected_user_id } });
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'invalid_request');
  }
});

test('bounded body accepts Vercel parsed JSON, strings, buffers and streams', async () => {
  const raw = JSON.stringify({ action: 'clear' });
  for (const body of [JSON.parse(raw), raw, Buffer.from(raw)]) assert.equal((await invoke(create(), { body })).status, 200);
  const streamed = await invoke(create(), { chunks: [Buffer.from(raw.slice(0, 8)), Buffer.from(raw.slice(8))] });
  assert.equal(streamed.status, 200);
  assert.equal((await invoke(create(), { body: '{"action":"callback","request_token":"synthetic-secret"' })).status, 400);
  const oversized = await invoke(create(), { body: { action: 'callback', request_token: 'x'.repeat(MAX_INPUT_BYTES) } });
  assert.equal(oversized.status, 413);
  assert.ok(!oversized.raw.includes('xxx'));
  assert.equal((await invoke(create(), { chunks: [Buffer.alloc(MAX_INPUT_BYTES + 1)] })).status, 413);
});

test('clear deletes only browser cookie and makes no broker request', async () => {
  const result = await invoke(create(), { body: { action: 'clear' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { cleared: true });
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
});

test('authenticated snapshot calls only auth POST and holdings GET', async () => {
  const fake = fakeProvider();
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 200);
  assert.equal(result.body.snapshot_version, 2);
  assert.equal(result.body.source, 'HDFC InvestRight');
  assert.equal(result.body.as_of_utc, '2026-10-02T12:00:00.000Z');
  assert.equal(result.body.account_authenticated, true);
  assert.equal(result.body.identity_verification, 'broker_authentication');
  assert.equal(result.body.account_verified, undefined);
  assert.equal(result.body.holdings_count, 1);
  assert.deepEqual(result.body.holdings[0], { isin: 'DEMO00000001', quantity: 3, company_name: 'Synthetic Company', security_id: '123', exchange: 'NSE', average_price: 10.5, investment_value: null, close_price: 12 });
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  assert.deepEqual(fake.calls.map(({ url, options }) => [options.method, new URL(url).origin + new URL(url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.holdings]]);
  for (const { options } of fake.calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.ok(options.headers['User-Agent']);
  }
  assert.equal(new URL(fake.calls[0].url).searchParams.get('request_token'), 'synthetic-request-token');
  assert.deepEqual(JSON.parse(fake.calls[0].options.body), { apiSecret: 'synthetic-api-secret' });
  assert.equal(fake.calls[1].options.headers.Authorization, 'Bearer synthetic-access-token');
  for (const value of ['synthetic-access-token', 'synthetic-request-token', 'synthetic-api-secret', 'DEMOUSER', 'private_profile', 'raw_private_field']) assert.ok(!result.raw.includes(value));
});

test('missing, duplicate and tampered cookie never contact broker', async () => {
  const handler = create();
  const cookie = await started(handler);
  for (const value of [undefined, cookie + '; ' + cookie, cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A'), COOKIE_NAME + '=invalid']) {
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie: value } });
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, 'session_invalid');
    assert.deepEqual(result.body.error.diagnostic, { stage: 'session', reason: 'session' });
    assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  }
});

test('expired and future-issued cookie fail closed without provider access', async () => {
  const sealed = sealSession(CONFIG, NOW);
  const cookie = COOKIE_NAME + '=' + sealed.cookie;
  const expired = await invoke(create(noFetch, { now: () => NOW + (TTL_SECONDS + 1) * 1000 }), { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error.code, 'session_expired');
  assert.deepEqual(expired.body.error.diagnostic, { stage: 'session', reason: 'expired' });
  const future = COOKIE_NAME + '=' + sealSession(CONFIG, NOW + 1000).cookie;
  assert.equal((await invoke(create(), { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie: future } })).status, 401);
});

test('changing configured application key or API secret invalidates old cookie', async () => {
  const cookie = await started(create());
  for (const env of [{ ...ENV, HDFC_API_KEY: 'another-synthetic-key' }, { ...ENV, HDFC_API_SECRET: 'another-synthetic-secret' }]) {
    const result = await invoke(create(noFetch, { env }), { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.equal(result.status, 401);
  }
});

test('provider errors are redacted and cookie is cleared', async () => {
  const fake = fakeProvider({ responseOverrides: [new Error('synthetic-api-secret synthetic-request-token sensitive-provider-response')] });
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'provider_failed');
  assert.deepEqual(result.body.error.diagnostic, { stage: 'token_exchange', reason: 'transport' });
  for (const value of ['synthetic-api-secret', 'synthetic-request-token', 'sensitive-provider-response']) assert.ok(!result.raw.includes(value));
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
});

for (const [label, response] of [
  ['redirect', () => new Response('unused', { status: 302, headers: { Location: 'https://evil.invalid' } })],
  ['non-JSON', () => new Response('sensitive-provider-response', { status: 200 })],
  ['oversize', () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1), { status: 200 })],
  ['non-finite JSON', () => new Response('{"accessToken":NaN}', { status: 200 })],
]) {
  test(`provider ${label} fails without any follow-on request`, async () => {
    const fake = fakeProvider({ responseOverrides: [response()] });
    const handler = create(fake.fetchImpl);
    const cookie = await started(handler);
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.equal(result.status, 502);
    assert.equal(fake.calls.length, 1);
  });
}

test('session expiry after token exchange prevents holdings call', async () => {
  let current = NOW;
  const fake = fakeProvider();
  const handler = create(async (...args) => {
    const response = await fake.fetchImpl(...args);
    if (fake.calls.length === 1) current = NOW + (TTL_SECONDS + 1) * 1000;
    return response;
  }, { now: () => current });
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 410);
  assert.equal(fake.calls.length, 1);
});

test('request timeout includes stalled response body and returns a redacted failure', async () => {
  let timer;
  const fetchImpl = async () => new Response(new ReadableStream({
    start(controller) { timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); }, 100); },
    cancel() { clearTimeout(timer); },
  }));
  const handler = create(fetchImpl, { requestTimeoutMs: 5, callbackTimeoutMs: 30 });
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'provider_failed');
  assert.deepEqual(result.body.error.diagnostic, { stage: 'token_exchange', reason: 'timeout' });
});

test('hung stream cancellation cannot extend the bounded error response', async () => {
  const fetchImpl = async () => ({ status: 200, body: { getReader() { return {
    async read() { return { done: false, value: new Uint8Array(MAX_RESPONSE_BYTES + 1) }; },
    cancel() { return new Promise(() => {}); },
  }; } } });
  const handler = create(fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
});

test('holdings normalize blank optional amounts and reject invalid quantities', () => {
  const blank = normalizeHoldings({ status: 'success', data: [{ isin: 'DEMO00000001', quantity: 0, average_price: ' ', investment_value: '', close_price: null }] }, NOW);
  assert.equal(blank.holdings[0].average_price, null);
  assert.equal(blank.holdings[0].investment_value, null);
  for (const quantity of [true, -1, 'NaN', Infinity, '0xff', null, '']) {
    assert.throws(() => normalizeHoldings({ status: 'success', data: [{ isin: 'DEMO00000001', quantity }] }, NOW));
  }
});

test('empty successful holdings is an authenticated zero-row snapshot', () => {
  const empty = normalizeHoldings({ status: 'success', data: [] }, NOW);
  assert.equal(empty.account_authenticated, true);
  assert.equal(empty.holdings_count, 0);
});

test('snapshot bounds match the phone consumer before the login cookie is consumed', () => {
  assert.throws(() => normalizeHoldings({ status: 'success', data: [{ isin: '  ', quantity: 1 }] }, NOW));
  assert.throws(() => normalizeHoldings({ status: 'success', data: [{ isin: 'DEMO00000001', quantity: 1, company_name: 'x'.repeat(241) }] }, NOW));
  assert.throws(() => normalizeHoldings({ status: 'success', data: Array.from({ length: 5001 }, () => ({ isin: 'DEMO00000001', quantity: 1 })) }, NOW));
});

const PRIVATE_SENTINELS = [ENV.HDFC_API_KEY, ENV.HDFC_API_SECRET, 'SYNTHETIC-PRIVATE-ID', 'synthetic-request-token', 'synthetic-access-token', 'sensitive-provider-response', 'private_profile', 'raw_private_field'];
const unsafeBody = JSON.stringify({ api_key: ENV.HDFC_API_KEY, apiSecret: ENV.HDFC_API_SECRET, user_id: 'SYNTHETIC-PRIVATE-ID', accessToken: 'synthetic-access-token', request_token: 'synthetic-request-token', private_profile: 'sensitive-provider-response' });
const diagnosticCases = [
  { stage: 'token_exchange', reason: 'http_status', index: 0, response: () => new Response(unsafeBody, { status: 401 }), http_status: 401 },
  { stage: 'token_exchange', reason: 'transport', index: 0, response: () => new Error(unsafeBody) },
  { stage: 'token_exchange', reason: 'json', index: 0, response: () => new Response('sensitive-provider-response') },
  { stage: 'token_exchange', reason: 'response_shape', index: 0, response: () => new Response(JSON.stringify({ status: 'error', accessToken: 'synthetic-access-token' })) },
  { stage: 'token_exchange', reason: 'token_missing', index: 0, response: () => new Response(JSON.stringify({ status: 'success', data: { accessToken: 'synthetic-access-token' } })) },
  { stage: 'holdings', reason: 'http_status', index: 1, response: () => new Response(unsafeBody, { status: 403 }), http_status: 403 },
  { stage: 'holdings', reason: 'transport', index: 1, response: () => new Error(unsafeBody) },
  { stage: 'holdings', reason: 'json', index: 1, response: () => new Response('sensitive-provider-response') },
  { stage: 'holdings', reason: 'response_shape', index: 1, response: () => new Response(JSON.stringify({ status: 'success', data: null, private_profile: unsafeBody })) },
  { stage: 'holdings', reason: 'snapshot_shape', index: 1, response: () => new Response(JSON.stringify({ status: 'success', data: [{ isin: 'DEMO00000001', quantity: null, raw_private_field: unsafeBody }] })) },
  { stage: 'holdings', reason: 'response_size', index: 1, response: () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)) },
];

for (const fixture of diagnosticCases) {
  test(`sanitized ${fixture.stage}.${fixture.reason} identifies the failed stage and stops`, async () => {
    const responses = [];
    responses[fixture.index] = fixture.response();
    const fake = fakeProvider({ responseOverrides: responses });
    const handler = create(fake.fetchImpl);
    const cookie = await started(handler);
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.equal(result.status, 502);
    assert.equal(result.body.error.code, 'provider_failed');
    const expected = { stage: fixture.stage, reason: fixture.reason };
    if (fixture.http_status) expected.http_status = fixture.http_status;
    assert.deepEqual(result.body.error.diagnostic, expected);
    assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
    assert.deepEqual(fake.calls.map(call => [call.options.method, new URL(call.url).origin + new URL(call.url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.holdings]].slice(0, fixture.index + 1));
    for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  });
}

test('diagnostic serialization cannot forward extra data or invalid HTTP statuses', () => {
  const diagnostic = { stage: 'holdings', reason: 'http_status', http_status: 405, user_id: 'DEMOUSER', url: unsafeBody, headers: unsafeBody, body: unsafeBody };
  assert.deepEqual(new FlowError('provider_failed', 502, diagnostic).diagnostic, { stage: 'holdings', reason: 'http_status', http_status: 405 });
  for (const http_status of [99, 600, '401', Infinity, NaN]) {
    assert.deepEqual(new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'http_status', http_status }).diagnostic, { stage: 'holdings', reason: 'http_status' });
  }
  assert.deepEqual(new FlowError('provider_failed', 502, { stage: unsafeBody, reason: unsafeBody }).diagnostic, { stage: 'request', reason: 'invalid' });
});

test('request denial diagnostics do not imply broker access', async () => {
  const origin = await invoke(create(), { body: { action: 'clear' }, headers: { origin: 'https://evil.invalid' } });
  assert.deepEqual(origin.body.error.diagnostic, { stage: 'request', reason: 'origin' });

});

test('configuration never reads obsolete broker-owner values', async () => {
  let ownerReads = 0;
  const env = { ...ENV, get HDFC_ALLOWED_USER_ID() { ownerReads += 1; throw new Error('Unexpected private owner read'); } };
  const handler = create(noFetch, { env });
  const health = await invoke(handler, { method: 'GET' });
  assert.equal(health.body.configured, true);
  assert.equal(health.body.profile_verification, false);
  const cookie = await started(handler);
  const payload = openSession(cookie.split(';')[0].slice(COOKIE_NAME.length + 1), CONFIG, NOW);
  assert.deepEqual(Object.keys(payload).sort(), ['app', 'exp', 'iat', 'nonce', 'v']);
  assert.equal(payload.v, 2);
  assert.equal(ownerReads, 0);
});

test('v2 rejects legacy cookie version before token exchange', async () => {
  const handler = create();
  const cookie = await started(handler);
  for (const legacy of [cookie.replace('=v2.', '=v1.'), cookie.replace(COOKIE_NAME, '__Host-hdfc_holdings_phone_v1')]) {
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie: legacy } });
    assert.equal(result.status, 401);
    assert.deepEqual(result.body.error.diagnostic, { stage: 'session', reason: 'session' });
  }
});

test('ordinary browser retry after callback cookie clearing cannot read again', async () => {
  const fake = fakeProvider();
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const complete = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(complete.status, 200);
  assert.ok(complete.headers['set-cookie'].includes('Max-Age=0'));
  const retry = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' } });
  assert.equal(retry.status, 401);
  assert.deepEqual(retry.body.error.diagnostic, { stage: 'session', reason: 'session' });
  assert.equal(fake.calls.length, 2);
});

test('holdings200 and201 use exact original headers only after successful token exchange', async () => {
  for (const status of [200, 201]) {
    const payload = { status: 'success', data: [{ isin: 'DEMO00000001', quantity: 0, user_id: 'SYNTHETIC-PRIVATE-ID', accessToken: 'synthetic-access-token', private_profile: unsafeBody }] };
    const fake = fakeProvider({ responseOverrides: [undefined, new Response(JSON.stringify(payload), { status })] });
    const handler = create(fake.fetchImpl);
    const cookie = await started(handler);
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.equal(result.status, 200);
    assert.equal(result.body.snapshot_version, 2);
    assert.equal(result.body.account_authenticated, true);
    assert.equal(result.body.identity_verification, 'broker_authentication');
    assert.equal(result.body.account_verified, undefined);
    assert.equal(result.body.user_id, undefined);
    assert.deepEqual(fake.calls.map(call => [call.options.method, new URL(call.url).origin + new URL(call.url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.holdings]]);
    const auth = fake.calls[0];
    assert.equal(auth.options.headers.Authorization, undefined);
    assert.equal(auth.options.headers['x-api-key'], undefined);
    assert.deepEqual(JSON.parse(auth.options.body), { apiSecret: ENV.HDFC_API_SECRET });
    const holdings = fake.calls[1];
    assert.deepEqual([...new URL(holdings.url).searchParams], [['api_key', ENV.HDFC_API_KEY]]);
    assert.deepEqual(holdings.options.headers, { Accept: 'application/json', 'User-Agent': 'AlphaSeeker-Holdings-Phone/1.0', Authorization: 'Bearer synthetic-access-token', 'x-api-key': ENV.HDFC_API_KEY });
    assert.equal(holdings.options.body, undefined);
    for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  }
});

test('token exchange201 never permits a holdings read', async () => {
  const fake = fakeProvider({ responseOverrides: [new Response(JSON.stringify({ accessToken: 'synthetic-access-token' }), { status: 201 })] });
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.deepEqual(result.body.error.diagnostic, { stage: 'token_exchange', reason: 'http_status', http_status: 201 });
  assert.equal(fake.calls.length, 1);
});

test('whitespace-only access token fails before holdings and clears the cookie', async () => {
  const fake = fakeProvider({ responseOverrides: [new Response(JSON.stringify({ accessToken: ' ', private_profile: unsafeBody }))] });
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.deepEqual(result.body.error.diagnostic, { stage: 'token_exchange', reason: 'response_shape' });
  assert.equal(fake.calls.length, 1);
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
});

test('holdings failures never fall back to profile, retry or change authentication', async () => {
  for (const status of [401, 403, 404, 422]) {
    const fake = fakeProvider({ responseOverrides: [undefined, new Response(unsafeBody, { status })] });
    const handler = create(fake.fetchImpl);
    const cookie = await started(handler);
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.equal(result.status, 502);
    assert.deepEqual(result.body.error.diagnostic, { stage: 'holdings', reason: 'http_status', http_status: status });
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].options.headers.Authorization, 'Bearer synthetic-access-token');
    for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  }
});
