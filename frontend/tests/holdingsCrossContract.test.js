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

function fixture({ authStatus = 200, auth = { accessToken: TOKEN }, holdingsStatus = 200, holdings = HOLDINGS } = {}) {
  const calls = [];
  const handler = createHoldingsPhoneHandler({
    env: { HDFC_API_KEY: KEY, HDFC_API_SECRET: SECRET },
    now: () => Date.parse('2026-10-02T11:30:00Z'),
    fetchImpl: async (url, options) => {
      const route = new URL(url);
      calls.push({ url: route, options });
      if (route.pathname === '/oapi/v1/access-token') {
        return new Response(JSON.stringify(auth), { status: authStatus });
      }
      assert.equal(route.pathname, '/oapi/v1/portfolio/holdings');
      return new Response(JSON.stringify(holdings), { status: holdingsStatus });
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
  for (const forbidden of [KEY, SECRET, TOKEN, REQUEST_TOKEN, PRIVATE_MARKER, 'user_id', 'account_verified']) {
    assert.equal(serialized.includes(forbidden), false, 'private or obsolete fields must not reach the phone');
  }
}

function assertProviderContract(calls) {
  assert.deepEqual(calls.map(({ url, options }) => [options.method, url.origin, url.pathname]), [
    ['POST', 'https://developer.hdfcsec.com', '/oapi/v1/access-token'],
    ['GET', 'https://developer.hdfcsec.com', '/oapi/v1/portfolio/holdings'],
  ]);
  const [auth, holdings] = calls;
  assert.deepEqual([...auth.url.searchParams], [['api_key', KEY], ['request_token', REQUEST_TOKEN]]);
  assert.deepEqual(JSON.parse(auth.options.body), { apiSecret: SECRET });
  assert.equal(auth.options.headers['Content-Type'], 'application/json');
  assert.deepEqual([...holdings.url.searchParams], [['api_key', KEY]]);
  assert.equal(holdings.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(holdings.options.headers['x-api-key'], KEY);
  assert.ok(holdings.options.headers['User-Agent']);
  assert.equal(holdings.options.body, undefined);
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.cache, 'no-store');
  }
}

for (const holdingsStatus of [200, 201]) {
  test(`holdings HTTP ${holdingsStatus} reaches the actual phone validator through the two-request original flow`, async () => {
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

test('holdings HTTP 422 reports holdings rather than profile and clears the session safely', async () => {
  const flow = fixture({
    holdingsStatus: 422,
    holdings: { detail: [{
      loc: ['header', 'Authorization'], type: 'missing', msg: PRIVATE_MARKER,
      input: TOKEN, ctx: { api_key: KEY, user_id: PRIVATE_MARKER },
    }] },
  });
  const cookie = await begin(flow);
  const failure = await flow.invoke({ action: 'callback', request_token: REQUEST_TOKEN }, cookie);
  assert.equal(failure.statusCode, 502);
  const safe = safeHoldingsError(failure.body.error);
  assert.equal(safe.reference, 'holdings.http_status.HTTP422');
  assert.equal(safe.reference.includes('profile'), false);
  assertProviderContract(flow.calls);
  assert.throws(() => validateHoldingsSnapshot(failure.body), /Invalid holdings snapshot/);
  assertNoPrivateValues(failure.body);
  assertNoPrivateValues(safe);
  assertCleared(failure);
});
