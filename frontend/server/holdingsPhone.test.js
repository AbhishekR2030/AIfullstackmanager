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
  assert.deepEqual(result.body, { version: 'holdings-phone-v2', configured: true, diagnostics_version: 1, holdings_diagnostics_version: 1, auth_method: 'token_exchange', holdings_method: 'GET', profile_verification: false });
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
    assert.equal(result.body.error.diagnostic.stage, 'holdings');
    assert.equal(result.body.error.diagnostic.reason, 'http_status');
    assert.equal(result.body.error.diagnostic.http_status, status);
    if (status !== 422) assert.deepEqual(result.body.error.diagnostic, { stage: 'holdings', reason: 'http_status', http_status: status });
    assert.equal(fake.calls.length, 2);
    assert.equal(fake.calls[1].options.headers.Authorization, 'Bearer synthetic-access-token');
    for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  }
});

const EMPTY_FLAGS = Object.freeze({ api_key_has_outer_whitespace: false, token_has_whitespace: false, token_has_bearer_prefix: false, top_level_token_fields_conflict: false });
const HTTP422 = Object.freeze({ stage: 'holdings', reason: 'http_status', http_status: 422 });

function errorResponse(payload, { contentType = 'application/json', raw = false } = {}) {
  const body = raw ? payload : JSON.stringify(payload);
  const headers = contentType === null ? {} : { 'Content-Type': contentType };
  return new Response(typeof body === 'string' ? new TextEncoder().encode(body) : body, { status: 422, headers });
}

async function callback422(response, { auth = { accessToken: 'synthetic-access-token' }, ...options } = {}) {
  const fake = fakeProvider({ responseOverrides: [new Response(JSON.stringify(auth)), response] });
  const handler = create(fake.fetchImpl, options);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'provider_failed');
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  assert.equal(result.body.error.diagnostic.stage, 'holdings');
  assert.equal(result.body.error.diagnostic.reason, 'http_status');
  assert.equal(result.body.error.diagnostic.http_status, 422);
  assert.deepEqual(fake.calls.map(({ url, options: request }) => [request.method, new URL(url).origin + new URL(url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.holdings]]);
  for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  return { ...result, calls: fake.calls };
}

test('whole callback classifies published static authentication messages without exposing provider fields', async () => {
  for (const payload of [
    { error: 'authorization not provided', user_id: 'SYNTHETIC-PRIVATE-ID' },
    { displayMessage: 'Full authentication is required to access this resource', api_key: ENV.HDFC_API_KEY },
  ]) {
    const result = await callback422(errorResponse(payload));
    assert.deepEqual(result.body.error.diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'classified', error_category: 'authentication_required' });
    assert.equal(result.calls[1].options.headers.Authorization, 'Bearer synthetic-access-token');
    assert.equal(result.calls[1].options.headers['x-api-key'], ENV.HDFC_API_KEY);
    assert.deepEqual([...new URL(result.calls[1].url).searchParams], [['api_key', ENV.HDFC_API_KEY]]);
    assert.equal(result.calls[1].options.body, undefined);
  }
});

test('whole callback maps bounded exact messages to fixed categories only', async () => {
  for (const [message, category] of [
    ['INVALID  API KEY. ', 'api_key_rejected'], ['Invalid or expired access token', 'access_token_rejected'],
    ['Missing required parameters', 'missing_parameter'], ['Bad request', 'invalid_request'],
    ['Invalid request', 'invalid_request'], ['Malformed request', 'invalid_request'], ['Access denied', 'access_denied'],
    ['IP address is not whitelisted', 'ip_restricted'], ['Rate limit exceeded', 'rate_limited'],
    ['Your Portfolio Holding is Null', 'portfolio_unavailable'], ['Unprocessable entity', 'unprocessable_request'],
  ]) {
    const result = await callback422(errorResponse({ message, input: unsafeBody }));
    assert.deepEqual(result.body.error.diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'classified', error_category: category });
    assert.equal(result.body.holdings, undefined);
  }
});

test('unknown, negated, dynamic and oversized messages never acquire a specific category', async () => {
  for (const message of ['Invalid token for SYNTHETIC-PRIVATE-ID', 'Do not use Invalid API key', 'API key is not invalid', 'Invalid access token: synthetic-access-token', 'invalid', 'token', 'key', 'Unauthorized' + ' '.repeat(1024)]) {
    const result = await callback422(errorResponse({ message, description: unsafeBody }));
    assert.deepEqual(result.body.error.diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'unknown', error_category: 'unknown', format_flags: EMPTY_FLAGS });
  }
});

test('compatibility envelopes use bounded own message/code fields without recursive traversal', async () => {
  for (const [payload, category, code] of [
    [{ error: { errorMessage: 'Invalid token', raw: unsafeBody } }, 'access_token_rejected'],
    [{ data: { error_message: 'Invalid API key' } }, 'api_key_rejected'],
    [{ errors: [{ description: 'Permission denied' }] }, 'access_denied'],
    [{ data: [{ message: 'Too many requests' }] }, 'rate_limited'],
    [[{ displayMessage: 'Unauthorized' }], 'authentication_required'],
    [{ code: 60014, message: 'sensitive-provider-response' }, 'unknown', '60014'],
    [{ error: { errorCode: '60014' } }, 'unknown', '60014'],
    [{ data: [{ error_code: 60014 }] }, 'unknown', '60014'],
  ]) {
    const result = await callback422(errorResponse(payload));
    const diagnostic = { ...HTTP422, response_format: 'json', error_outcome: 'classified', error_category: category };
    if (code) diagnostic.provider_code = code;
    assert.deepEqual(result.body.error.diagnostic, diagnostic);
    assert.equal(result.body.holdings_count, undefined);
  }
  for (const payload of [
    { code: '60014 ' }, { code: '060014' }, { code: { valueOf: 60014 } }, { code: 60015 },
    { status: 60014, account: { code: 60014 } }, { data: { error: { code: 60014, message: 'Invalid token' } } },
    { errors: [...Array.from({ length: 8 }, () => ({})), { code: 60014 }] },
  ]) {
    const result = await callback422(errorResponse(payload));
    assert.equal(result.body.error.diagnostic.provider_code, undefined);
    assert.equal(result.body.error.diagnostic.error_outcome, 'unknown');
    assert.deepEqual(result.body.error.diagnostic.format_flags, EMPTY_FLAGS);
  }
});

test('conflicting recognized categories become unknown without leaking message text', async () => {
  const result = await callback422(errorResponse({ message: 'Invalid API key', error: { message: 'Invalid token' }, code: 60014, input: unsafeBody }));
  assert.deepEqual(result.body.error.diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'classified', error_category: 'unknown', provider_code: '60014' });
  const withoutCode = await callback422(errorResponse({ message: 'Invalid API key', error: { message: 'Invalid token' } }));
  assert.deepEqual(withoutCode.body.error.diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'unknown', error_category: 'unknown', format_flags: EMPTY_FLAGS });
});

test('whole callback validation preserves only finite location/field/kind labels', async () => {
  const detail = [
    { loc: ['header', 'X-API-KEY'], type: 'missing', msg: unsafeBody, input: unsafeBody, ctx: unsafeBody },
    { loc: ['header', 'Authorization'], type: 'value_error.missing' },
    { loc: ['header', 'User-Agent'], type: 'string_type' },
    { loc: ['header', 'Content-Type'], type: 'value_error' },
    { loc: ['query', 'api_key'], type: 'missing' },
    { loc: ['body', 'SYNTHETIC-PRIVATE-ID'], type: 'int_parsing' },
    { loc: ['body', 'access_token', 0], type: 'string_type' },
    { loc: ['header', 'api-secret'], type: 'missing' },
    { loc: ['query', 'API_KEY'], type: 'missing' },
    { loc: ['header', 'authorization'], type: 'missing' },
    { loc: ['private_profile', 'api_key'], type: 'missing' },
    { loc: ['query', 'token'], type: 'sensitive-provider-response' },
    { loc: ['body', { api_key: ENV.HDFC_API_KEY }], type: 'missing' },
  ];
  const result = await callback422(errorResponse({ detail, user_id: 'SYNTHETIC-PRIVATE-ID' }));
  assert.deepEqual(result.body.error.diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'classified', error_category: 'unknown', validation: [
    { location: 'header', field: 'x_api_key', kind: 'missing' },
    { location: 'header', field: 'authorization', kind: 'missing' },
    { location: 'header', field: 'user_agent', kind: 'invalid' },
    { location: 'header', field: 'content_type', kind: 'invalid' },
    { location: 'query', field: 'api_key', kind: 'missing' },
    { location: 'body', field: 'other', kind: 'invalid' },
    { location: 'header', field: 'other', kind: 'missing' },
    { location: 'query', field: 'other', kind: 'missing' },
  ] });
});

test('validation first32 limit is global across root and supported child records', async () => {
  const issue = { loc: ['query', 'api_key'], type: 'missing' };
  const unsupported = { loc: ['body', ['private']], type: 'missing' };
  const ignored = await callback422(errorResponse({ detail: Array.from({ length: 32 }, () => unsupported), error: { detail: [issue] } }));
  assert.equal(ignored.body.error.diagnostic.error_outcome, 'unknown');
  assert.equal(ignored.body.error.diagnostic.validation, undefined);
  const included = await callback422(errorResponse({ detail: Array.from({ length: 31 }, () => unsupported), error: { detail: [issue, { loc: ['query', 'request_token'], type: 'missing' }] } }));
  assert.deepEqual(included.body.error.diagnostic.validation, [{ location: 'query', field: 'api_key', kind: 'missing' }]);
  assert.equal(included.body.error.diagnostic.format_flags, undefined);
});

test('error MIME and read/parse outcomes are explicit while base422 survives', async () => {
  for (const [response, format, outcome] of [
    [errorResponse({ private_profile: unsafeBody }), 'json', 'unknown'],
    [errorResponse([], { contentType: 'application/problem+json; charset=utf-8' }), 'json', 'unknown'],
    [errorResponse('<html>sensitive-provider-response</html>', { contentType: 'Text/HTML; charset=utf-8', raw: true }), 'html', 'non_json'],
    [errorResponse('sensitive-provider-response', { contentType: 'text/plain', raw: true }), 'text', 'non_json'],
    [errorResponse('{', { raw: true }), 'json', 'invalid_json'],
    [errorResponse(new Uint8Array([0xc3, 0x28]), { raw: true }), 'json', 'invalid_utf8'],
    [errorResponse('', { contentType: null, raw: true }), 'absent', 'empty'],
    [errorResponse('  ', { contentType: 'application/octet-stream', raw: true }), 'other', 'empty'],
    [errorResponse('{}', { contentType: null, raw: true }), 'absent', 'unknown'],
    [errorResponse('{}', { contentType: 'text/html', raw: true }), 'html', 'unknown'],
    [errorResponse('x'.repeat(16385), { raw: true }), 'json', 'size'],
    [new Response(null, { status: 422 }), 'absent', 'read_error'],
  ]) {
    const result = await callback422(response);
    assert.deepEqual(result.body.error.diagnostic, { ...HTTP422, response_format: format, error_outcome: outcome, error_category: 'unknown', format_flags: EMPTY_FLAGS });
  }
});

test('plain and JSON scalar exact messages classify even with missing or mislabeled MIME', async () => {
  for (const response of [
    errorResponse('Unauthorized', { raw: true, contentType: null }),
    errorResponse('  Authentication\n required! ', { raw: true, contentType: 'text/plain' }),
    errorResponse('Invalid token', { contentType: 'text/html' }),
  ]) {
    const result = await callback422(response);
    assert.equal(result.body.error.diagnostic.error_outcome, 'classified');
    assert.equal(result.body.error.diagnostic.format_flags, undefined);
  }
});

test('exact16KiB complete error body is accepted but stream crossing limit is size', async () => {
  const exact = await callback422(errorResponse('{}' + ' '.repeat(16382), { raw: true }));
  assert.equal(exact.body.error.diagnostic.error_outcome, 'unknown');
  let cancelled = 0;
  const response = { status: 422, headers: new Headers({ 'Content-Type': 'application/json' }), body: { getReader() {
    let reads = 0;
    return { async read() { reads += 1; return { done: false, value: new Uint8Array(reads === 1 ? 10000 : 6385) }; }, cancel() { cancelled += 1; return Promise.resolve(); } };
  } } };
  const oversized = await callback422(response);
  assert.equal(oversized.body.error.diagnostic.error_outcome, 'size');
  assert.equal(cancelled, 1);
});

test('optional reader failures and hung/rejecting cancellation preserve base422', async () => {
  for (const cancellation of [() => new Promise(() => {}), () => Promise.reject(new Error(unsafeBody)), () => { throw new Error(unsafeBody); }]) {
    const response = { status: 422, headers: new Headers(), body: { getReader() { return { read() { throw new Error(unsafeBody); }, cancel: cancellation }; } } };
    const result = await callback422(response);
    assert.equal(result.body.error.diagnostic.error_outcome, 'read_error');
  }
  const getReaderFailure = await callback422({ status: 422, headers: new Headers(), body: { getReader() { throw new Error(unsafeBody); } } });
  assert.equal(getReaderFailure.body.error.diagnostic.error_outcome, 'read_error');
});

test('zero-length error chunks cannot starve deadline or grow unbounded', async () => {
  let reads = 0;
  const response = { status: 422, headers: new Headers(), body: { getReader() { return { async read() { reads += 1; return { done: false, value: new Uint8Array() }; }, cancel() { return Promise.resolve(); } }; } } };
  const result = await callback422(response);
  assert.equal(result.body.error.diagnostic.error_outcome, 'read_error');
  assert.equal(reads, 33);
});

test('earlier request/callback deadlines preserve422 and cancel optional reader', async () => {
  for (const options of [{ requestTimeoutMs: 5, callbackTimeoutMs: 500 }, { requestTimeoutMs: 500, callbackTimeoutMs: 5 }]) {
    let cancelled = 0;
    const response = { status: 422, headers: new Headers(), body: { getReader() { return { read() { return new Promise(() => {}); }, cancel() { cancelled += 1; return new Promise(() => {}); } }; } } };
    const result = await callback422(response, options);
    assert.equal(result.body.error.diagnostic.error_outcome, 'timeout');
    assert.equal(cancelled, 1);
  }
});

test('optional error reader enforces actual two-second local budget', async () => {
  const response = { status: 422, headers: new Headers(), body: { getReader() { return { read() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }; } } };
  const begin = performance.now();
  const result = await callback422(response, { requestTimeoutMs: 10000, callbackTimeoutMs: 10000 });
  assert.equal(result.body.error.diagnostic.error_outcome, 'timeout');
  assert.ok(performance.now() - begin >= 1900);
  assert.ok(performance.now() - begin < 4000);
});

test('auth422 and other holdings failures never read optional provider error body', async () => {
  let bodyReads = 0;
  const response = status => ({ status, body: { getReader() { bodyReads += 1; throw new Error(unsafeBody); } } });
  const authFake = fakeProvider({ responseOverrides: [response(422)] });
  const authHandler = create(authFake.fetchImpl);
  const cookie = await started(authHandler);
  const authResult = await invoke(authHandler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.deepEqual(authResult.body.error.diagnostic, { stage: 'token_exchange', reason: 'http_status', http_status: 422 });
  assert.equal(authFake.calls.length, 1);
  for (const status of [401, 403, 404, 500]) {
    const fake = fakeProvider({ responseOverrides: [undefined, response(status)] });
    const handler = create(fake.fetchImpl);
    const activeCookie = await started(handler);
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie: activeCookie } });
    assert.deepEqual(result.body.error.diagnostic, { stage: 'holdings', reason: 'http_status', http_status: status });
  }
  assert.equal(bodyReads, 0);
});

test('uninformative422 reports only exact gated format booleans and preserves token precedence/bytes', async () => {
  const auth = { accessToken: 'Bearer synthetic-access-token', access_token: 'different-synthetic-access-token' };
  const env = { ...ENV, HDFC_API_KEY: ' synthetic-api-key ' };
  const result = await callback422(errorResponse({ private_profile: unsafeBody }), { auth, env });
  assert.deepEqual(result.body.error.diagnostic.format_flags, { api_key_has_outer_whitespace: true, token_has_whitespace: true, token_has_bearer_prefix: true, top_level_token_fields_conflict: true });
  assert.equal(result.calls[1].options.headers.Authorization, 'Bearer Bearer synthetic-access-token');
  assert.equal(result.calls[1].options.headers['x-api-key'], env.HDFC_API_KEY);
  assert.equal(new URL(result.calls[1].url).searchParams.get('api_key'), env.HDFC_API_KEY);
  for (const snakeToken of [undefined, '', ' ', 123, { value: 'private' }, 'synthetic-access-token']) {
    const fixture = await callback422(errorResponse({}), { auth: { accessToken: 'synthetic-access-token', access_token: snakeToken } });
    assert.deepEqual(fixture.body.error.diagnostic.format_flags, EMPTY_FLAGS);
  }
  const informative = await callback422(errorResponse({ message: 'Invalid token' }), { auth, env });
  assert.equal(informative.body.error.diagnostic.format_flags, undefined);
});

test('FlowError reconstructs own fixed optional data without executing getters or forwarding extras', () => {
  let getterCalls = 0;
  const diagnostic = { ...HTTP422, response_format: 'json', error_outcome: 'unknown', error_category: 'unknown', raw: unsafeBody,
    get provider_code() { getterCalls += 1; return '60014'; },
    format_flags: { token_has_bearer_prefix: true, api_key_has_outer_whitespace: 'true', token_has_whitespace: 1, get top_level_token_fields_conflict() { getterCalls += 1; return true; }, raw: unsafeBody },
  };
  assert.deepEqual(new FlowError('provider_failed', 502, diagnostic).diagnostic, { ...HTTP422, response_format: 'json', error_outcome: 'unknown', error_category: 'unknown', format_flags: { token_has_bearer_prefix: true } });
  const item = { location: 'query', field: 'api_key', kind: 'missing', msg: unsafeBody, get raw() { getterCalls += 1; return unsafeBody; } };
  const validation = [item, { get location() { getterCalls += 1; return 'header'; }, field: 'authorization', kind: 'missing' }];
  Object.defineProperty(validation, '2', { get() { getterCalls += 1; return item; }, configurable: true });
  const cleaned = new FlowError('provider_failed', 502, { ...HTTP422, response_format: 'json', error_outcome: 'classified', error_category: 'unknown', validation, format_flags: EMPTY_FLAGS }).diagnostic;
  assert.deepEqual(cleaned.validation, [{ location: 'query', field: 'api_key', kind: 'missing' }]);
  assert.equal(cleaned.format_flags, undefined);
  assert.equal(getterCalls, 0);
  assert.equal(new FlowError('provider_failed', 502, { ...HTTP422, provider_code: 60014 }).diagnostic.provider_code, undefined);
  assert.deepEqual(new FlowError('provider_failed', 502, { stage: 'token_exchange', reason: 'http_status', http_status: 422, response_format: 'json', error_outcome: 'classified', error_category: 'access_denied' }).diagnostic, { stage: 'token_exchange', reason: 'http_status', http_status: 422 });
});

test('concurrent callbacks keep optional diagnostics isolated and make no logs', async () => {
  let logs = 0;
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => { logs += 1; };
  console.error = () => { logs += 1; };
  try {
    const [first, second] = await Promise.all([
      callback422(errorResponse({ message: 'Invalid API key', private_profile: unsafeBody })),
      callback422(errorResponse({ code: 60014, private_profile: unsafeBody }), { auth: { accessToken: 'Bearer synthetic-access-token', access_token: 'different-synthetic-access-token' } }),
    ]);
    assert.equal(first.body.error.diagnostic.error_category, 'api_key_rejected');
    assert.equal(first.body.error.diagnostic.provider_code, undefined);
    assert.equal(second.body.error.diagnostic.error_category, 'unknown');
    assert.equal(second.body.error.diagnostic.provider_code, '60014');
    assert.equal(first.body.error.diagnostic.format_flags, undefined);
    assert.equal(second.body.error.diagnostic.format_flags, undefined);
    assert.equal(logs, 0);
  } finally { console.log = originalLog; console.error = originalError; }
});
