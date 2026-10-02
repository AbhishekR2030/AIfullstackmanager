import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { COOKIE_NAME, ENDPOINTS, FlowError, MAX_INPUT_BYTES, MAX_RESPONSE_BYTES, ORIGIN, TTL_SECONDS, createHoldingsPhoneHandler, normalizeHoldings, openSession, sealSession } from './holdingsPhone.js';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ENV = Object.freeze({ HDFC_API_KEY: 'synthetic-api-key', HDFC_API_SECRET: 'synthetic-api-secret', HDFC_ALLOWED_USER_ID: 'DEMOUSER' });
const CONFIG = { key: ENV.HDFC_API_KEY, secret: ENV.HDFC_API_SECRET, owner: ENV.HDFC_ALLOWED_USER_ID };
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
  const start = await invoke(handler, { body: { action: 'start', expected_user_id: ' demouser ' } });
  assert.equal(start.status, 200);
  return start.headers['set-cookie'].split(';')[0];
}

function fakeProvider({ user = 'DEMOUSER', holdings, responseOverrides = [] } = {}) {
  const rows = holdings || [{ isin: 'DEMO00000001', company_name: 'Synthetic Company', security_id: 123, exchange: 'NSE', quantity: '3', average_price: '10.5', investment_value: '', close_price: 12, raw_private_field: 'unused' }];
  const payloads = [{ accessToken: 'synthetic-access-token' }, { status: 'success', data: [{ user_id: user, private_profile: 'unused' }] }, { status: 'success', data: rows }];
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
  assert.deepEqual(result.body, { version: 'holdings-phone-v1', configured: true, diagnostics_version: 1, profile_method: 'GET', validation_diagnostics_version: 1 });
  assert.equal(result.headers['cache-control'], 'no-store, private');
  assert.equal(result.headers['referrer-policy'], 'no-referrer');
  for (const value of Object.values(ENV)) assert.ok(!result.raw.includes(value));
  for (const name of Object.keys(ENV)) {
    const env = { ...ENV };
    delete env[name];
    const unconfigured = await invoke(create(noFetch, { env }), { method: 'GET', url: '/api/holdings-phone?action=health' });
    assert.equal(unconfigured.body.configured, false);
    assert.equal((await invoke(create(noFetch, { env }), { body: { action: 'start', expected_user_id: 'DEMOUSER' } })).status, 503);
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

test('start binds configured owner and creates encrypted host-only cookie', async () => {
  const result = await invoke(create(), { body: { action: 'start', expected_user_id: ' demouser ' } });
  assert.equal(result.status, 200);
  const login = new URL(result.body.login_url);
  assert.equal(login.origin + login.pathname, ENDPOINTS.login);
  assert.deepEqual([...login.searchParams], [['api_key', ENV.HDFC_API_KEY]]);
  assert.equal(result.body.expires_at, '2026-10-02T12:10:00.000Z');
  const cookie = result.headers['set-cookie'];
  assert.ok(cookie.startsWith(COOKIE_NAME + '=v1.'));
  for (const flag of ['Path=/', 'Max-Age=600', 'Secure', 'HttpOnly', 'SameSite=Lax']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  for (const value of Object.values(ENV)) assert.ok(!cookie.includes(value));
  const payload = openSession(cookie.split(';')[0].slice(COOKIE_NAME.length + 1), CONFIG, NOW);
  assert.equal(payload.exp - payload.iat, TTL_SECONDS);
  assert.ok(!JSON.stringify(payload).includes('DEMOUSER'));
});

test('public callers cannot start for a different owner', async () => {
  const result = await invoke(create(), { body: { action: 'start', expected_user_id: 'OTHERUSER' } });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'account_mismatch');
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

test('verified snapshot calls only auth POST, profile GET and holdings GET', async () => {
  const fake = fakeProvider();
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 200);
  assert.equal(result.body.snapshot_version, 1);
  assert.equal(result.body.source, 'HDFC InvestRight');
  assert.equal(result.body.as_of_utc, '2026-10-02T12:00:00.000Z');
  assert.equal(result.body.account_verified, true);
  assert.equal(result.body.holdings_count, 1);
  assert.deepEqual(result.body.holdings[0], { isin: 'DEMO00000001', quantity: 3, company_name: 'Synthetic Company', security_id: '123', exchange: 'NSE', average_price: 10.5, investment_value: null, close_price: 12 });
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  assert.deepEqual(fake.calls.map(({ url, options }) => [options.method, new URL(url).origin + new URL(url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.profile], ['GET', ENDPOINTS.holdings]]);
  for (const { options } of fake.calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.signal instanceof AbortSignal, true);
    assert.ok(options.headers['User-Agent']);
  }
  assert.equal(new URL(fake.calls[0].url).searchParams.get('request_token'), 'synthetic-request-token');
  assert.deepEqual(JSON.parse(fake.calls[0].options.body), { apiSecret: 'synthetic-api-secret' });
  assert.equal(fake.calls[1].options.headers.Authorization, 'synthetic-access-token');
  for (const value of ['synthetic-access-token', 'synthetic-request-token', 'synthetic-api-secret', 'DEMOUSER', 'private_profile', 'raw_private_field']) assert.ok(!result.raw.includes(value));
});

test('wrong HDFC account fails before any holdings GET', async () => {
  const fake = fakeProvider({ user: 'OTHERUSER' });
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'account_mismatch');
  assert.equal(fake.calls.length, 2);
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
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

test('changing configured owner or API secret invalidates old cookie', async () => {
  const cookie = await started(create());
  for (const env of [{ ...ENV, HDFC_ALLOWED_USER_ID: 'OTHERUSER' }, { ...ENV, HDFC_API_SECRET: 'another-synthetic-secret' }]) {
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

test('unsupported profile GET fails closed without fallback or holdings', async () => {
  const fake = fakeProvider({ responseOverrides: [undefined, new Response('unused', { status: 405 })] });
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.equal(fake.calls.length, 2);
});

test('profile route regression uses documented GET with identity verified before holdings', async () => {
  const fake = fakeProvider();
  const routeCalls = [];
  const handler = create(async (url, options) => {
    const route = new URL(url);
    routeCalls.push([options.method, route.origin + route.pathname]);
    if (route.origin + route.pathname === ENDPOINTS.profile && options.method === 'POST') return new Response('unused', { status: 404 });
    return fake.fetchImpl(url, options);
  });
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 200);
  assert.equal(result.body.account_verified, true);
  assert.deepEqual(routeCalls, [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.profile], ['GET', ENDPOINTS.holdings]]);
  const profileRequest = fake.calls[1];
  assert.equal(new URL(profileRequest.url).searchParams.get('api_key'), ENV.HDFC_API_KEY);
  assert.equal(profileRequest.options.headers.Authorization, 'synthetic-access-token');
  assert.ok(profileRequest.options.headers['User-Agent']);
  assert.equal(profileRequest.options.body, undefined);
});

test('profile GET HTTP404 retains its reference and never retries or reads holdings', async () => {
  const fake = fakeProvider({ responseOverrides: [undefined, new Response(unsafeBody, { status: 404 })] });
  const handler = create(fake.fetchImpl);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.deepEqual(result.body.error.diagnostic, { stage: 'profile', reason: 'http_status', http_status: 404 });
  assert.deepEqual(fake.calls.map(call => [call.options.method, new URL(call.url).origin + new URL(call.url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.profile]]);
});

test('session expiry while checking profile prevents holdings call', async () => {
  let current = NOW;
  const fake = fakeProvider();
  const handler = create(async (...args) => {
    const response = await fake.fetchImpl(...args);
    if (fake.calls.length === 2) current = NOW + (TTL_SECONDS + 1) * 1000;
    return response;
  }, { now: () => current });
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 410);
  assert.equal(fake.calls.length, 2);
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

test('empty successful holdings is a verified zero-row snapshot', () => {
  const empty = normalizeHoldings({ status: 'success', data: [] }, NOW);
  assert.equal(empty.account_verified, true);
  assert.equal(empty.holdings_count, 0);
});

test('snapshot bounds match the phone consumer before the login cookie is consumed', () => {
  assert.throws(() => normalizeHoldings({ status: 'success', data: [{ isin: '  ', quantity: 1 }] }, NOW));
  assert.throws(() => normalizeHoldings({ status: 'success', data: [{ isin: 'DEMO00000001', quantity: 1, company_name: 'x'.repeat(241) }] }, NOW));
  assert.throws(() => normalizeHoldings({ status: 'success', data: Array.from({ length: 5001 }, () => ({ isin: 'DEMO00000001', quantity: 1 })) }, NOW));
});

const PRIVATE_SENTINELS = [ENV.HDFC_API_KEY, ENV.HDFC_API_SECRET, ENV.HDFC_ALLOWED_USER_ID, 'synthetic-request-token', 'synthetic-access-token', 'sensitive-provider-response', 'private_profile', 'raw_private_field'];
const unsafeBody = JSON.stringify({ api_key: ENV.HDFC_API_KEY, apiSecret: ENV.HDFC_API_SECRET, user_id: ENV.HDFC_ALLOWED_USER_ID, accessToken: 'synthetic-access-token', request_token: 'synthetic-request-token', private_profile: 'sensitive-provider-response' });
const diagnosticCases = [
  { stage: 'token_exchange', reason: 'http_status', index: 0, response: () => new Response(unsafeBody, { status: 401 }), http_status: 401 },
  { stage: 'token_exchange', reason: 'transport', index: 0, response: () => new Error(unsafeBody) },
  { stage: 'token_exchange', reason: 'json', index: 0, response: () => new Response('sensitive-provider-response') },
  { stage: 'token_exchange', reason: 'response_shape', index: 0, response: () => new Response(JSON.stringify({ status: 'error', accessToken: 'synthetic-access-token' })) },
  { stage: 'token_exchange', reason: 'token_missing', index: 0, response: () => new Response(JSON.stringify({ status: 'success', data: { accessToken: 'synthetic-access-token' } })) },
  { stage: 'profile', reason: 'http_status', index: 1, response: () => new Response(unsafeBody, { status: 405 }), http_status: 405 },
  { stage: 'profile', reason: 'transport', index: 1, response: () => new Error(unsafeBody) },
  { stage: 'profile', reason: 'json', index: 1, response: () => new Response('sensitive-provider-response') },
  { stage: 'profile', reason: 'response_shape', index: 1, response: () => new Response(JSON.stringify({ status: 'success', data: { user_id: 'DEMOUSER' } })) },
  { stage: 'profile', reason: 'identity_shape', index: 1, response: () => new Response(JSON.stringify({ status: 'success', data: [{ user_id: null, private_profile: unsafeBody }] })) },
  { stage: 'holdings', reason: 'http_status', index: 2, response: () => new Response(unsafeBody, { status: 403 }), http_status: 403 },
  { stage: 'holdings', reason: 'transport', index: 2, response: () => new Error(unsafeBody) },
  { stage: 'holdings', reason: 'json', index: 2, response: () => new Response('sensitive-provider-response') },
  { stage: 'holdings', reason: 'response_shape', index: 2, response: () => new Response(JSON.stringify({ status: 'success', data: null, private_profile: unsafeBody })) },
  { stage: 'holdings', reason: 'snapshot_shape', index: 2, response: () => new Response(JSON.stringify({ status: 'success', data: [{ isin: 'DEMO00000001', quantity: null, raw_private_field: unsafeBody }] })) },
  { stage: 'holdings', reason: 'response_size', index: 2, response: () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)) },
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
    assert.deepEqual(fake.calls.map(call => [call.options.method, new URL(call.url).origin + new URL(call.url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.profile], ['GET', ENDPOINTS.holdings]].slice(0, fixture.index + 1));
    for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  });
}

test('diagnostic serialization cannot forward extra data or invalid HTTP statuses', () => {
  const diagnostic = { stage: 'profile', reason: 'http_status', http_status: 405, user_id: 'DEMOUSER', url: unsafeBody, headers: unsafeBody, body: unsafeBody };
  assert.deepEqual(new FlowError('provider_failed', 502, diagnostic).diagnostic, { stage: 'profile', reason: 'http_status', http_status: 405 });
  for (const http_status of [99, 600, '401', Infinity, NaN]) {
    assert.deepEqual(new FlowError('provider_failed', 502, { stage: 'profile', reason: 'http_status', http_status }).diagnostic, { stage: 'profile', reason: 'http_status' });
  }
  assert.deepEqual(new FlowError('provider_failed', 502, { stage: unsafeBody, reason: unsafeBody }).diagnostic, { stage: 'request', reason: 'invalid' });
});

test('request and configured-owner denial diagnostics do not imply broker access', async () => {
  const origin = await invoke(create(), { body: { action: 'clear' }, headers: { origin: 'https://evil.invalid' } });
  assert.deepEqual(origin.body.error.diagnostic, { stage: 'request', reason: 'origin' });
  const owner = await invoke(create(), { body: { action: 'start', expected_user_id: 'OTHERUSER' } });
  assert.deepEqual(owner.body.error.diagnostic, { stage: 'request', reason: 'owner_mismatch' });
});

const PROFILE_422 = { stage: 'profile', reason: 'http_status', http_status: 422 };

async function profileValidation(response, options = {}) {
  const fake = fakeProvider({ responseOverrides: [undefined, response] });
  const handler = create(fake.fetchImpl, options);
  const cookie = await started(handler);
  const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'provider_failed');
  assert.ok(result.headers['set-cookie'].includes('Max-Age=0'));
  assert.deepEqual(fake.calls.map(call => [call.options.method, new URL(call.url).origin + new URL(call.url).pathname]), [['POST', ENDPOINTS.auth], ['GET', ENDPOINTS.profile]]);
  for (const sentinel of PRIVATE_SENTINELS) assert.ok(!result.raw.includes(sentinel));
  return { result, calls: fake.calls };
}

function validationResponse(detail) {
  return new Response(JSON.stringify({ detail }), { status: 422 });
}

test('profile422 exposes only enum validation metadata and keeps the documented request intact', async () => {
  const { result, calls } = await profileValidation(validationResponse([{ loc: ['header', 'Authorization'], type: 'missing', msg: unsafeBody, input: unsafeBody, ctx: { private_profile: unsafeBody }, api_key: ENV.HDFC_API_KEY }]));
  assert.deepEqual(result.body.error.diagnostic, { ...PROFILE_422, validation: [{ location: 'header', field: 'authorization', kind: 'missing' }] });
  const profile = calls[1];
  assert.deepEqual([...new URL(profile.url).searchParams], [['api_key', ENV.HDFC_API_KEY]]);
  assert.equal(profile.options.headers.Authorization, 'synthetic-access-token');
  assert.equal(profile.options.headers['User-Agent'], 'AlphaSeeker-Holdings-Phone/1.0');
  assert.equal(profile.options.headers.Accept, 'application/json');
  assert.equal(profile.options.headers['Content-Type'], undefined);
  assert.equal(profile.options.body, undefined);
});

test('validation aliases are exact and nested or unknown fields become other', async () => {
  const { result } = await profileValidation(validationResponse([
    { loc: ['header', 'USER-AGENT'], type: 'value_error.missing' },
    { loc: ['header', 'Content-Type'], type: 'string_type' },
    { loc: ['query', 'api_key'], type: 'missing' },
    { loc: ['query', 'apiKey'], type: 'missing' },
    { loc: ['body'], type: 'missing' },
    { loc: ['body', 'user_id', 0], type: 'value_error' },
    { loc: ['path', 'client_id'], type: 'string_pattern_mismatch' },
    { loc: ['header', '__proto__'], type: 'missing' },
  ]));
  assert.deepEqual(result.body.error.diagnostic.validation, [
    { location: 'header', field: 'user_agent', kind: 'missing' },
    { location: 'header', field: 'content_type', kind: 'invalid' },
    { location: 'query', field: 'api_key', kind: 'missing' },
    { location: 'query', field: 'other', kind: 'missing' },
    { location: 'body', field: 'other', kind: 'missing' },
    { location: 'body', field: 'other', kind: 'invalid' },
    { location: 'path', field: 'client_id', kind: 'invalid' },
    { location: 'header', field: 'other', kind: 'missing' },
  ]);
});

test('unknown validation locations, model types and malformed loc arrays are omitted', async () => {
  const { result } = await profileValidation(validationResponse([
    { loc: ['query', 'api_key'], type: unsafeBody },
    { loc: ['query', 'api_key'], type: 'missing.secret-model' },
    { loc: [unsafeBody, 'api_key'], type: 'missing' },
    { loc: ['header', { private_profile: unsafeBody }], type: 'missing' },
    { loc: ['body', null], type: 'missing' },
    { loc: ['body', -1], type: 'missing' },
    { loc: Array(9).fill('body'), type: 'missing' },
    { loc: [], type: 'missing' },
    { loc: 'header.Authorization', type: 'missing' },
    null,
    { loc: ['query', 'API_KEY'], type: 'type_error.str', msg: unsafeBody },
    { loc: ['header', 'constructor'], type: 'missing' },
  ]));
  assert.deepEqual(result.body.error.diagnostic.validation, [
    { location: 'query', field: 'other', kind: 'invalid' },
    { location: 'header', field: 'other', kind: 'missing' },
  ]);
});

test('validation scans first32 only and caps eight unique fixed triples', async () => {
  const detail = Array.from({ length: 32 }, () => ({ loc: ['query', 'api_key'], type: 'missing' }));
  detail.push({ loc: ['header', 'Authorization'], type: 'missing' });
  const limited = await profileValidation(validationResponse(detail));
  assert.deepEqual(limited.result.body.error.diagnostic.validation, [{ location: 'query', field: 'api_key', kind: 'missing' }]);
  const fields = ['api_key', 'authorization', 'user_agent', 'content_type', 'access_token', 'client_id', 'client_code', 'user_id', 'request_token', 'api_secret', 'token', 'other'];
  const capped = await profileValidation(validationResponse(fields.flatMap(field => Array(2).fill({ loc: ['query', field], type: 'missing' }))));
  assert.deepEqual(capped.result.body.error.diagnostic.validation, fields.slice(0, 8).map(field => ({ location: 'query', field, kind: 'missing' })));
  for (const field of fields.slice(8)) {
    const diagnostic = new FlowError('provider_failed', 502, { ...PROFILE_422, validation: [{ location: 'query', field, kind: 'invalid' }] }).diagnostic;
    assert.deepEqual(diagnostic.validation, [{ location: 'query', field, kind: 'invalid' }]);
  }
});

test('malformed or absent profile422 bodies retain the original HTTP reference', async () => {
  for (const response of [
    new Response('not-json ' + unsafeBody, { status: 422 }),
    new Response(new Uint8Array([0xff]), { status: 422 }),
    new Response(null, { status: 422 }),
    validationResponse(null),
    new Response(JSON.stringify({ detail: { loc: ['body'], type: 'missing', input: unsafeBody } }), { status: 422 }),
  ]) {
    const { result } = await profileValidation(response);
    assert.deepEqual(result.body.error.diagnostic, PROFILE_422);
  }
});

test('optional profile422 body enforces16KiB before decoding and cancels excess data', async () => {
  const json = JSON.stringify({ detail: [{ loc: ['header', 'Authorization'], type: 'missing' }] });
  const exact = await profileValidation(new Response(json.padEnd(16 * 1024, ' '), { status: 422 }));
  assert.equal(exact.result.body.error.diagnostic.validation[0].field, 'authorization');
  let cancelCalls = 0;
  let readCalls = 0;
  const response = { status: 422, body: { getReader() { return {
    async read() { readCalls += 1; return { done: false, value: new Uint8Array(readCalls === 1 ? 16 * 1024 : 1) }; },
    async cancel() { cancelCalls += 1; },
  }; } } };
  const { result } = await profileValidation(response);
  assert.deepEqual(result.body.error.diagnostic, PROFILE_422);
  assert.equal(readCalls, 2);
  assert.equal(cancelCalls, 1);
});

test('optional422 parsing obeys remaining request and callback deadlines without replacing HTTP422', async () => {
  for (const options of [{ requestTimeoutMs: 10 }, { callbackTimeoutMs: 10 }]) {
    let timer;
    const response = new Response(new ReadableStream({
      start(controller) { timer = setTimeout(() => { controller.close(); }, 100); },
      cancel() { clearTimeout(timer); },
    }), { status: 422 });
    const { result } = await profileValidation(response, options);
    assert.deepEqual(result.body.error.diagnostic, PROFILE_422);
  }
});

test('optional422 own two-second deadline bounds a reader that ignores abort and cancellation', async () => {
  let cancelCalls = 0;
  const response = { status: 422, body: { getReader() { return {
    read() { return new Promise(() => {}); },
    cancel() { cancelCalls += 1; return new Promise(() => {}); },
  }; } } };
  const keepAlive = setTimeout(() => {}, 3000);
  const began = performance.now();
  try {
    const { result } = await profileValidation(response);
    assert.deepEqual(result.body.error.diagnostic, PROFILE_422);
    assert.equal(cancelCalls, 1);
    assert.ok(performance.now() - began < 2800);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('optional422 stream failures and synchronous cancellation failures preserve HTTP422', async () => {
  const response = { status: 422, body: { getReader() { return {
    async read() { throw new Error(unsafeBody); },
    cancel() { throw new Error(unsafeBody); },
  }; } } };
  const { result } = await profileValidation(response);
  assert.deepEqual(result.body.error.diagnostic, PROFILE_422);
});

test('other provider endpoints and profile statuses never read validation error bodies', async () => {
  for (const [index, stage, status] of [[0, 'token_exchange', 422], [2, 'holdings', 422], [1, 'profile', 401], [1, 'profile', 404], [1, 'profile', 500]]) {
    let reads = 0;
    const overrides = [];
    overrides[index] = { status, body: { getReader() { reads += 1; throw new Error(unsafeBody); } } };
    const fake = fakeProvider({ responseOverrides: overrides });
    const handler = create(fake.fetchImpl);
    const cookie = await started(handler);
    const result = await invoke(handler, { body: { action: 'callback', request_token: 'synthetic-request-token' }, headers: { cookie } });
    assert.deepEqual(result.body.error.diagnostic, { stage, reason: 'http_status', http_status: status });
    assert.equal(reads, 0);
    assert.equal(fake.calls.length, index + 1);
  }
});

test('FlowError revalidates diagnostic triples, strips extras, and refuses getter or prototype values', () => {
  let getterCalls = 0;
  const getter = { field: 'authorization', kind: 'missing', get location() { getterCalls += 1; return 'header'; } };
  const inherited = Object.create({ location: 'header', field: 'authorization', kind: 'missing' });
  const validation = [getter, inherited, { location: unsafeBody, field: 'authorization', kind: 'missing' }, { location: 'header', field: unsafeBody, kind: 'missing' }, { location: 'header', field: 'authorization', kind: unsafeBody }, { location: 'header', field: 'authorization', kind: 'missing', msg: unsafeBody, input: unsafeBody }, { location: 'header', field: 'authorization', kind: 'missing' }];
  Object.defineProperty(validation, 0, { get() { getterCalls += 1; return getter; } });
  const diagnostic = new FlowError('provider_failed', 502, { ...PROFILE_422, validation }).diagnostic;
  assert.deepEqual(diagnostic, { ...PROFILE_422, validation: [{ location: 'header', field: 'authorization', kind: 'missing' }] });
  assert.equal(getterCalls, 0);
  for (const changed of [{ stage: 'holdings' }, { reason: 'response_shape' }, { http_status: 400 }]) {
    assert.equal(new FlowError('provider_failed', 502, { ...PROFILE_422, ...changed, validation }).diagnostic.validation, undefined);
  }
  const secretGetter = { ...PROFILE_422, get validation() { getterCalls += 1; return validation; } };
  assert.deepEqual(new FlowError('provider_failed', 502, secretGetter).diagnostic, PROFILE_422);
  assert.equal(getterCalls, 0);
});
