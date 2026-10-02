import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoldingsPhoneHandler, ORIGIN, COOKIE_NAME, VERSION } from '../server/holdingsPhone.js';
import { validHdfcLoginUrl, validateHoldingsSnapshot } from '../src/services/holdingsConnectEntry.js';
import { safeHoldingsError } from '../src/services/holdingsPhoneErrors.js';

const KEY = 'synthetic-key';
const SECRET = 'synthetic-secret';
const TOKEN = 'synthetic-token';
const REQUEST_TOKEN = 'synthetic-request-token';
const PRIVATE_MARKER = 'private-provider-field-never-return';
const HOLDINGS = {
  status: 'success',
  data: [{
    isin: 'DEMO00000001', company_name: 'Synthetic Company', security_id: 42,
    exchange: 'NSE', quantity: '3', average_price: '10.5', investment_value: '',
    close_price: '12', user_id: PRIVATE_MARKER, unrelated_field: PRIVATE_MARKER,
  }],
};

function fixture({
  authStatus = 200, auth = { accessToken: TOKEN }, holdingsStatus = 200, holdings = HOLDINGS,
  holdingsBody, holdingsContentType = 'application/json', holdingsResponse, requestTimeoutMs = 20_000,
} = {}) {
  const calls = [];
  const handler = createHoldingsPhoneHandler({
    env: { HDFC_API_KEY: KEY, HDFC_API_SECRET: SECRET },
    now: () => Date.parse('2026-10-02T11:30:00Z'),
    requestTimeoutMs,
    fetchImpl: async (url, options) => {
      const route = new URL(url);
      calls.push({ url: route, options });
      if (route.pathname === '/oapi/v1/access-token') {
        return new Response(JSON.stringify(auth), { status: authStatus });
      }
      assert.equal(route.pathname, '/oapi/v1/portfolio/holdings');
      if (holdingsResponse) return holdingsResponse();
      const body = holdingsBody === undefined ? JSON.stringify(holdings) : holdingsBody;
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      return new Response(bytes, {
        status: holdingsStatus,
        headers: holdingsContentType === null ? {} : { 'Content-Type': holdingsContentType },
      });
    },
  });
  async function invoke(body, cookie) {
    const response = {
      statusCode: 0, headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      end(data) { this.body = JSON.parse(data); },
    };
    await handler({
      method: 'POST', url: '/api/holdings-phone',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body,
    }, response);
    return response;
  }
  return { calls, invoke };
}

async function begin(flow) {
  const start = await flow.invoke({ action: 'start' });
  assert.equal(start.statusCode, 200);
  assert.equal(VERSION, 'holdings-phone-v2');
  assert.equal(validHdfcLoginUrl(start.body.login_url), true);
  assert.equal(new URL(start.body.login_url).searchParams.get('api_key'), KEY);
  assert.match(start.headers['set-cookie'], /; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
  const cookie = start.headers['set-cookie'].split(';')[0];
  assert.ok(cookie.startsWith(`${COOKIE_NAME}=v2.`));
  assert.equal(flow.calls.length, 0, 'start must not contact HDFC');
  return cookie;
}

function assertCleared(response) {
  assert.equal(response.headers['set-cookie'], `${COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
}

function assertNoPrivateValues(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [KEY, SECRET, TOKEN, REQUEST_TOKEN, PRIVATE_MARKER, 'account_verified']) {
    assert.equal(serialized.includes(forbidden), false, 'private or obsolete fields must not reach the phone');
  }
  for (const field of ['user_id', 'account_id', 'client_id', 'account_verified']) {
    assert.equal(Object.hasOwn(value, field), false, 'account identifiers must not reach the phone');
  }
}

function assertProviderContract(calls, token = TOKEN) {
  assert.deepEqual(calls.map(({ url, options }) => [options.method, url.origin, url.pathname]), [
    ['POST', 'https://developer.hdfcsec.com', '/oapi/v1/access-token'],
    ['GET', 'https://developer.hdfcsec.com', '/oapi/v1/portfolio/holdings'],
  ]);
  const [auth, holdings] = calls;
  assert.deepEqual([...auth.url.searchParams], [['api_key', KEY], ['request_token', REQUEST_TOKEN]]);
  assert.deepEqual(JSON.parse(auth.options.body), { apiSecret: SECRET });
  assert.equal(auth.options.headers['Content-Type'], 'application/json');
  assert.deepEqual([...holdings.url.searchParams], [['api_key', KEY]]);
  assert.equal(holdings.options.headers.Authorization, token);
  assert.deepEqual(Object.keys(holdings.options.headers).sort(), ['Accept', 'Authorization', 'User-Agent']);
  assert.equal(holdings.options.headers.Accept, 'application/json');
  assert.equal(Object.hasOwn(holdings.options.headers, 'x-api-key'), false);
  assert.ok(holdings.options.headers['User-Agent']);
  assert.equal(holdings.options.body, undefined);
  assert.equal(calls.filter(({ url, options }) => options.method === 'GET'
    && url.pathname === '/oapi/v1/portfolio/holdings').length, 1,
  'holdings uses one GET without retry or a header fallback');
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
  }
}

for (const holdingsStatus of [200, 201]) {
  test(`holdings HTTP ${holdingsStatus} reaches the actual phone validator with raw token Authorization`, async () => {
    const flow = fixture({ holdingsStatus });
    const cookie = await begin(flow);
    const read = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
    assert.equal(read.statusCode, 200);
    const snapshot = validateHoldingsSnapshot(read.body);
    assert.equal(snapshot.snapshot_version, 2);
    assert.equal(snapshot.account_authenticated, true);
    assert.equal(snapshot.identity_verification, 'broker_authentication');
    assert.equal(snapshot.as_of_utc, '2026-10-02T11:30:00.000Z');
    assert.equal(snapshot.holdings_count, 1);
    assert.deepEqual(snapshot.holdings[0], {
      isin: 'DEMO00000001', company_name: 'Synthetic Company', security_id: '42',
      exchange: 'NSE', quantity: 3, average_price: 10.5, investment_value: null, close_price: 12,
    });
    assertProviderContract(flow.calls);
    assertNoPrivateValues(read.body);
    assertNoPrivateValues(snapshot);
    assertCleared(read);
  });
}

test('legitimate empty holdings HTTP 201 remains a validated empty snapshot', async () => {
  const flow = fixture({ holdingsStatus: 201, holdings: { status: 'success', data: [] } });
  const cookie = await begin(flow);
  const read = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
  assert.equal(read.statusCode, 200);
  const snapshot = validateHoldingsSnapshot(read.body);
  assert.equal(snapshot.holdings_count, 0);
  assert.deepEqual(snapshot.holdings, []);
  assert.equal(snapshot.account_authenticated, true);
  assert.equal(snapshot.identity_verification, 'broker_authentication');
  assertProviderContract(flow.calls);
  assertCleared(read);
});

for (const authStatus of [401, 201]) {
  test(`token exchange HTTP ${authStatus} stops before holdings and produces a safe phone reference`, async () => {
    const flow = fixture({ authStatus, auth: { accessToken: TOKEN, detail: PRIVATE_MARKER } });
    const cookie = await begin(flow);
    const failure = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
    assert.equal(failure.statusCode, 502);
    assert.equal(safeHoldingsError(failure.body.error).reference, `token_exchange.http_status.HTTP${authStatus}`);
    assert.deepEqual(flow.calls.map(({ url, options }) => [options.method, url.pathname]), [
      ['POST', '/oapi/v1/access-token'],
    ]);
    assert.throws(() => validateHoldingsSnapshot(failure.body), /Invalid holdings snapshot/);
    assertNoPrivateValues(failure.body);
    assertCleared(failure);
  });
}

test('holdings HTTP 422 validation triples reach the real formatter with fixed labels and redacted private context', async () => {
  const flow = fixture({
    holdingsStatus: 422,
    holdings: { detail: [
      { loc: ['header', 'Authorization'], type: 'missing', msg: PRIVATE_MARKER,
        input: TOKEN, ctx: { api_key: KEY, user_id: PRIVATE_MARKER } },
      { loc: ['header', 'x-api-key'], type: 'string_type', msg: SECRET, input: KEY },
      { loc: ['query', 'user_id'], type: 'value_error.missing', input: PRIVATE_MARKER },
    ] },
  });
  const cookie = await begin(flow);
  const failure = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
  assert.equal(failure.statusCode, 502);
  const safe = safeHoldingsError(failure.body.error);
  assert.equal(safe.reference, 'holdings.http_status.HTTP422.R.classified.M.json.E.unknown'
    + '.V.header.authorization.missing.V.header.x_api_key.invalid.V.query.user_id.missing');
  assert.equal(safe.reference.includes('profile'), false);
  assert.equal(Object.hasOwn(failure.body.error.diagnostic, 'format_flags'), false);
  assertProviderContract(flow.calls);
  assert.throws(() => validateHoldingsSnapshot(failure.body), /Invalid holdings snapshot/);
  assertNoPrivateValues(failure.body);
  assertNoPrivateValues(safe);
  assertCleared(failure);
});

const BASE_422 = 'holdings.http_status.HTTP422';
const FALSE_FLAGS = '.F.key_space.false.F.token_space.false.F.bearer_prefix.false.F.token_conflict.false';

async function verify422(flow, suffix, { token = TOKEN, flags = false } = {}) {
  const cookie = await begin(flow);
  const failure = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
  assert.equal(failure.statusCode, 502);
  assert.equal(failure.body.error.code, 'provider_failed');
  assert.deepEqual(Object.keys(failure.body), ['error']);
  assert.deepEqual(Object.keys(failure.body.error).sort(), ['code', 'diagnostic', 'message']);
  const diagnostic = failure.body.error.diagnostic;
  const permittedFields = new Set([
    'stage', 'reason', 'http_status', 'error_outcome', 'response_format',
    'error_category', 'provider_code', 'validation', 'format_flags', 'provider_report',
  ]);
  assert.ok(Object.keys(diagnostic).every(field => permittedFields.has(field)));
  assert.equal(diagnostic.stage, 'holdings');
  assert.equal(diagnostic.reason, 'http_status');
  assert.equal(diagnostic.http_status, 422);
  const safe = safeHoldingsError(failure.body.error);
  assert.equal(safe.reference, BASE_422 + suffix);
  assert.equal(safe.reference.includes('profile'), false);
  assert.equal(Object.hasOwn(diagnostic, 'format_flags'), flags);
  assertProviderContract(flow.calls, token);
  assert.throws(() => validateHoldingsSnapshot(failure.body), /Invalid holdings snapshot/);
  for (const field of ['holdings', 'holdings_count', 'snapshot_version', 'account_authenticated']) {
    assert.equal(Object.hasOwn(failure.body, field), false, 'an HTTP422 is never a holdings snapshot');
  }
  assertNoPrivateValues(failure.body);
  assertNoPrivateValues(safe);
  assertCleared(failure);
  return { failure, safe };
}

// These two exact shapes are public user reports on the official forum. Their
// original contexts are HTTP401 token exchange/WebSocket, not guaranteed REST422.
for (const [label, body] of [
  ['forum23 authorization message', { error: 'authorization not provided' }],
  ['forum28 displayMessage', { displayMessage: 'Full authentication is required to access this resource' }],
]) {
  test(`${label} is classified without returning the provider message`, async () => {
    const { failure, safe } = await verify422(fixture({ holdingsStatus: 422, holdings: body }),
      '.R.classified.M.json.E.authentication_required');
    const publishedMessage = Object.values(body)[0];
    assert.equal(JSON.stringify(failure.body).includes(publishedMessage), false);
    assert.equal(JSON.stringify(safe).includes(publishedMessage), false);
  });
}

// Code-field envelopes below are synthetic compatibility shapes. Staff discussed
// the literal60014 but did not publish its JSON envelope or establish empty data.
for (const [label, body] of [
  ['numeric code', { code: 60014, message: PRIVATE_MARKER }],
  ['nested string code', { error: { errorCode: '60014', description: PRIVATE_MARKER, input: TOKEN } }],
  ['capitalized code alias', { ErrorCode: 60014, MSG: PRIVATE_MARKER, input: TOKEN }],
]) {
  test(`compatibility ${label} reports literal60014 and never claims an empty portfolio`, async () => {
    const { failure } = await verify422(fixture({ holdingsStatus: 422, holdings: body }),
      '.R.classified.M.json.E.unknown.C.60014');
    assert.equal(failure.body.error.diagnostic.error_category, 'unknown');
  });
}

// Synthetic compatibility recognizers exercise fixed categories and supported
// envelope locations. They are not claims about the current provider payload.
const CATEGORY_CASES = [
  ['API-key error object', { error: { message: 'Invalid API key' } }, 'api_key_rejected'],
  ['token data object', { data: { error_message: 'Token expired' } }, 'access_token_rejected'],
  ['missing-parameter errors array', { errors: [{ description: 'Missing required parameter' }] }, 'missing_parameter'],
  ['invalid request root', { message: 'Bad request' }, 'invalid_request'],
  ['access denied root', { errorMessage: 'Permission denied' }, 'access_denied'],
  ['IP JSON string', 'IP address is not whitelisted', 'ip_restricted'],
  ['rate limit detail string', { detail: 'Too many requests' }, 'rate_limited'],
  ['portfolio data array', { data: [{ displayMessage: 'No portfolio holdings' }] }, 'portfolio_unavailable'],
  ['unprocessable root', { error_message: 'Unprocessable entity' }, 'unprocessable_request'],
];
for (const [label, body, category] of CATEGORY_CASES) {
  test(`synthetic ${label} reaches the fixed ${category} frontend category`, async () => {
    await verify422(fixture({ holdingsStatus: 422, holdings: body }), `.R.classified.M.json.E.${category}`);
  });
}

for (const [field, message, category] of [
  ['msg', 'Invalid token', 'access_token_rejected'],
  ['MSG', 'Invalid API key', 'api_key_rejected'],
  ['status_error', 'Unprocessable entity', 'unprocessable_request'],
  ['DisplayMessage', 'Full authentication is required to access this resource', 'authentication_required'],
  ['ErrorMessage', 'Invalid or expired token', 'access_token_rejected'],
]) {
  test(`static compatibility alias ${field} is classified through the real frontend formatter`, async () => {
    const { failure, safe } = await verify422(fixture({ holdingsStatus: 422, holdings: { [field]: message } }),
      `.R.classified.M.json.E.${category}`);
    assert.equal(JSON.stringify(failure.body).includes(message), false);
    assert.equal(JSON.stringify(safe).includes(message), false);
  });
}

test('unknown messages in the added static aliases are never echoed or guessed', async () => {
  const unknown = `${PRIVATE_MARKER} ${TOKEN} ${KEY}`;
  const { failure } = await verify422(fixture({ holdingsStatus: 422, holdings: {
    msg: unknown, MSG: unknown, status_error: unknown, DisplayMessage: unknown,
    ErrorMessage: unknown, ErrorCode: '60015', user_id: PRIVATE_MARKER,
  } }), `.R.unknown.M.json.E.unknown${FALSE_FLAGS}`, { flags: true });
  assert.deepEqual(failure.body.error.diagnostic.provider_report.provider_codes, [],
    'a code next to an account identifier is withheld');
  assert.equal(safeHoldingsError(failure.body.error).reference.includes('60015'), false);
});

test('meta status aliases produce a useful safe report through the actual frontend formatter', async () => {
  const providerMessage = 'Application is not mapped to API key; subscription permission required';
  const { failure, safe } = await verify422(fixture({ holdingsStatus: 422, holdings: {
    status: 'error',
    meta: { statusCode: 60015, statusMsg: providerMessage, callback: PRIVATE_MARKER },
    arbitrary_private_field: PRIVATE_MARKER,
  } }), `.R.unknown.M.json.E.unknown${FALSE_FLAGS}`, { flags: true });
  const report = failure.body.error.diagnostic.provider_report;
  assert.deepEqual(report, {
    version: 1, provider_codes: ['60015'],
    error_schema: [
      { path: 'root', type: 'object' },
      { path: 'root.status', type: 'string' },
      { path: 'root.meta', type: 'object' },
      { path: 'root.other', type: 'string' },
      { path: 'root.meta.code', type: 'number' },
      { path: 'root.meta.message', type: 'string' },
      { path: 'root.meta.other', type: 'string' },
    ],
    message_terms: ['api_key', 'application', 'subscription', 'permission', 'required', 'not', 'mapped'],
  });
  assert.deepEqual(safe.providerReport, report);
  assert.notEqual(safe.providerReport, report, 'formatter returns its own validated copy');
  assert.match(safe.providerReportText, /^Safe provider error report v1\nReference: holdings\.http_status\.HTTP422\./);
  assert.ok(safe.providerReportText.includes('Provider codes: 60015'));
  assert.ok(safe.providerReportText.includes('root.meta.message: string'));
  for (const value of [providerMessage, 'arbitrary_private_field', 'callback']) {
    assert.equal(JSON.stringify(failure.body).includes(value), false);
    assert.equal(JSON.stringify(safe).includes(value), false);
  }
});

test('runtime tokens and encoded aliases are removed before deriving report concepts or numeric codes', async () => {
  const selected = `${TOKEN}/access+permission`;
  const alternate = `${TOKEN}-alternate/subscription+required`;
  const variants = [KEY, SECRET, REQUEST_TOKEN, selected, alternate].flatMap(value => [
    value, encodeURIComponent(value), encodeURIComponent(encodeURIComponent(value)),
    new URLSearchParams({ value }).toString().slice(6),
  ]);
  const { failure, safe } = await verify422(fixture({
    auth: { accessToken: selected, access_token: alternate }, holdingsStatus: 422,
    holdings: {
      meta: { statusCode: 12345, statusMsg: variants.join(' | ') },
      user_id: '12345', error: { errorCode: '54321', message: PRIVATE_MARKER },
      arbitrary_private_field: PRIVATE_MARKER,
    },
  }), '.R.unknown.M.json.E.unknown.F.key_space.false.F.token_space.false.F.bearer_prefix.false.F.token_conflict.true',
  { token: selected, flags: true });
  assert.deepEqual(safe.providerReport.provider_codes, ['54321']);
  assert.deepEqual(safe.providerReport.message_terms, []);
  assert.deepEqual(safe.providerReport, failure.body.error.diagnostic.provider_report);
  for (const value of [...variants, '12345', 'arbitrary_private_field']) {
    assert.equal(JSON.stringify(failure.body).includes(value), false);
    assert.equal(JSON.stringify(safe).includes(value), false);
  }
});

test('frontend discards a malformed optional report while retaining the handler error reference', async () => {
  const { failure, safe } = await verify422(fixture({ holdingsStatus: 422, holdings: {
    meta: { errorCode: '60015', statusMsg: 'Application not mapped' },
  } }), `.R.unknown.M.json.E.unknown${FALSE_FLAGS}`, { flags: true });
  assert.ok(safe.providerReport);
  for (const corrupt of [
    report => { report.raw_message = PRIVATE_MARKER; },
    report => { report.error_schema[0].path = `root.${PRIVATE_MARKER}`; },
    report => { report.provider_codes = [PRIVATE_MARKER]; },
    report => { report.message_terms = ['mapped', 'application']; },
  ]) {
    const supplied = structuredClone(failure.body.error);
    corrupt(supplied.diagnostic.provider_report);
    const rejected = safeHoldingsError(supplied);
    assert.equal(rejected.reference, safe.reference);
    assert.equal(Object.hasOwn(rejected, 'providerReport'), false);
    assert.equal(Object.hasOwn(rejected, 'providerReportText'), false);
    assertNoPrivateValues(rejected);
  }
});

test('non422 holdings failures make a single raw-token GET with no auth retry or header fallback', async () => {
  for (const status of [401, 403, 404]) {
    const flow = fixture({ holdingsStatus: status, holdings: { ErrorCode: 60014, msg: 'Invalid token' } });
    const cookie = await begin(flow);
    const failure = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
    assert.equal(failure.statusCode, 502);
    assert.equal(safeHoldingsError(failure.body.error).reference, `holdings.http_status.HTTP${status}`);
    assert.deepEqual(failure.body.error.diagnostic, { stage: 'holdings', reason: 'http_status', http_status: status });
    assertProviderContract(flow.calls);
    assert.throws(() => validateHoldingsSnapshot(failure.body), /Invalid holdings snapshot/);
    assertNoPrivateValues(failure.body);
    assertCleared(failure);
  }
});

test('recognized plain-text message is classified while retaining its text MIME category', async () => {
  await verify422(fixture({ holdingsStatus: 422, holdingsBody: 'Invalid or expired token', holdingsContentType: 'text/plain' }),
    '.R.classified.M.text.E.access_token_rejected');
});

test('recognized JSON under absent MIME remains classified without exposing headers', async () => {
  await verify422(fixture({ holdingsStatus: 422, holdings: { message: 'Authentication required' }, holdingsContentType: null }),
    '.R.classified.M.absent.E.authentication_required');
});

test('unknown nested body preserves an already-prefixed raw token and camel-first precedence without adding Bearer', async () => {
  const selectedToken = `Bearer ${TOKEN} `;
  const flow = fixture({
    auth: { accessToken: selectedToken, access_token: `${TOKEN}-alternate` },
    holdingsStatus: 422,
    holdings: { message: PRIVATE_MARKER, data: { user_id: PRIVATE_MARKER }, code: '60015' },
  });
  const { failure } = await verify422(flow,
    '.R.unknown.M.json.E.unknown.F.key_space.false.F.token_space.true.F.bearer_prefix.true.F.token_conflict.true',
    { token: selectedToken, flags: true });
  assert.deepEqual(failure.body.error.diagnostic.format_flags, {
    api_key_has_outer_whitespace: false, token_has_whitespace: true,
    token_has_bearer_prefix: true, top_level_token_fields_conflict: true,
  });
  assert.equal(JSON.stringify(failure.body).includes('60015'), false);
});

test('raw token whitespace is preserved in request options without adding or stripping a prefix', async () => {
  const selectedToken = ` ${TOKEN} `;
  await verify422(fixture({ auth: { accessToken: selectedToken }, holdingsStatus: 422,
    holdings: { msg: PRIVATE_MARKER } }),
  '.R.unknown.M.json.E.unknown.F.key_space.false.F.token_space.true.F.bearer_prefix.false.F.token_conflict.false',
  { token: selectedToken, flags: true });
});

const UNINFORMATIVE_CASES = [
  ['unknown JSON', { holdings: { message: PRIVATE_MARKER, input: TOKEN, ctx: { api_key: KEY } } }, 'unknown', 'json'],
  ['conflicting categories', { holdings: { message: 'Invalid API key', description: 'Token expired' } }, 'unknown', 'json'],
  ['unsupported validation', { holdings: { detail: [{ loc: ['private', PRIVATE_MARKER], type: 'private-type', input: TOKEN }] } }, 'unknown', 'json'],
  ['HTML page', { holdingsBody: `<html>${PRIVATE_MARKER}${TOKEN}</html>`, holdingsContentType: 'text/html' }, 'non_json', 'html'],
  ['unknown plain text', { holdingsBody: `${PRIVATE_MARKER} ${TOKEN}`, holdingsContentType: 'text/plain' }, 'non_json', 'text'],
  ['invalid advertised JSON', { holdingsBody: `{${PRIVATE_MARKER}`, holdingsContentType: 'application/json' }, 'invalid_json', 'json'],
  ['invalid UTF8', { holdingsBody: new Uint8Array([0xff]), holdingsContentType: 'application/json' }, 'invalid_utf8', 'json'],
  ['empty body', { holdingsBody: new Uint8Array(), holdingsContentType: null }, 'empty', 'absent'],
  ['oversized body', { holdingsBody: new Uint8Array(16_385).fill(120), holdingsContentType: 'application/json' }, 'size', 'json'],
  ['missing readable body', { holdingsBody: null, holdingsContentType: 'application/json' }, 'read_error', 'json'],
  ['mislabeled JSON object', { holdings: { detail: [] }, holdingsContentType: 'application/octet-stream' }, 'unknown', 'other'],
];
for (const [label, options, outcome, format] of UNINFORMATIVE_CASES) {
  test(`${label} preserves HTTP422 through the actual formatter and exposes no raw evidence`, async () => {
    await verify422(fixture({ holdingsStatus: 422, ...options }),
      `.R.${outcome}.M.${format}.E.unknown${FALSE_FLAGS}`, { flags: true });
  });
}

test('optional body read error cannot become a transport failure or a snapshot', async () => {
  const flow = fixture({
    holdingsResponse: () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error(`${PRIVATE_MARKER} ${TOKEN}`)); },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
  });
  await verify422(flow, `.R.read_error.M.json.E.unknown${FALSE_FLAGS}`, { flags: true });
});

test('earlier request deadline bounds a hung optional body while preserving the original holdings422', async () => {
  const flow = fixture({
    requestTimeoutMs: 25,
    holdingsResponse: () => new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
  });
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await verify422(flow, `.R.timeout.M.json.E.unknown${FALSE_FLAGS}`, { flags: true });
  } finally {
    clearTimeout(keepAlive);
  }
});
