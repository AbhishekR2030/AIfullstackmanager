import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoldingsPhoneHandler, ORIGIN, COOKIE_NAME } from '../server/holdingsPhone.js';
import { validHdfcLoginUrl, validateHoldingsSnapshot } from '../src/services/holdingsConnectEntry.js';
import { safeHoldingsError } from '../src/services/holdingsPhoneErrors.js';

test('server login and verified snapshot satisfy actual phone validators', async () => {
  const calls = [];
  const responses = [
    { accessToken: 'synthetic-broker-token' },
    { status: 'success', data: [{ user_id: 'SYNTHETIC_OWNER', bank_account: 'never-return-this' }] },
    { status: 'success', data: [{ isin: 'DEMO00000001', company_name: 'Synthetic Company', security_id: 42, exchange: 'NSE', quantity: '3', average_price: '10.5', investment_value: '', close_price: '12', unrelated_field: 'never-return-this' }] },
  ];
  const handler = createHoldingsPhoneHandler({
    env: { HDFC_API_KEY: 'synthetic-app-key', HDFC_API_SECRET: 'synthetic-provider-secret', HDFC_ALLOWED_USER_ID: 'SYNTHETIC_OWNER' },
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });
  async function invoke(body, cookie) {
    const response = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(data) { this.body = JSON.parse(data); } };
    await handler({ method: 'POST', url: '/api/holdings-phone', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body }, response);
    return response;
  }
  const start = await invoke({ action: 'start', expected_user_id: 'synthetic_owner' });
  assert.equal(start.statusCode, 200);
  assert.equal(validHdfcLoginUrl(start.body.login_url), true);
  assert.match(start.headers['set-cookie'], /; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
  const cookie = start.headers['set-cookie'].split(';')[0];
  assert.ok(cookie.startsWith(COOKIE_NAME + '='));
  const read = await invoke({ action: 'callback', request_token: 'synthetic-request-token' }, cookie);
  assert.equal(read.statusCode, 200);
  const snapshot = validateHoldingsSnapshot(read.body);
  assert.equal(snapshot.holdings_count, 1);
  assert.equal(snapshot.holdings[0].investment_value, null);
  assert.equal(snapshot.holdings[0].security_id, '42');
  assert.deepEqual(calls.map(({ url, options }) => [options.method, url.pathname]), [
    ['POST', '/oapi/v1/access-token'], ['GET', '/oapi/v3/user/profile'], ['GET', '/oapi/v1/portfolio/holdings'],
  ]);
  assert.equal(calls[1].options.headers.Authorization, 'synthetic-broker-token');
  assert.equal(calls[2].options.headers.Authorization, 'synthetic-broker-token');
  assert.ok(!JSON.stringify(snapshot).includes('synthetic-broker-token'));
  assert.ok(!JSON.stringify(snapshot).includes('never-return-this'));
  assert.match(read.headers['set-cookie'], /Max-Age=0/);
});

test('profile validation failure produces a safe phone reference and never reads holdings', async () => {
  const calls = [];
  const handler = createHoldingsPhoneHandler({
    env: { HDFC_API_KEY: 'synthetic-app-key', HDFC_API_SECRET: 'synthetic-provider-secret', HDFC_ALLOWED_USER_ID: 'SYNTHETIC_OWNER' },
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (calls.length === 1) return new Response(JSON.stringify({ accessToken: 'synthetic-broker-token' }));
      return new Response(JSON.stringify({ detail: [{
        loc: ['header', 'Authorization'], type: 'missing',
        msg: 'private-provider-message', input: 'synthetic-broker-token',
        ctx: { api_key: 'synthetic-app-key', account: 'SYNTHETIC_OWNER' },
      }] }), { status: 422 });
    },
  });
  async function invoke(body, cookie) {
    const response = { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(data) { this.body = JSON.parse(data); } };
    await handler({ method: 'POST', url: '/api/holdings-phone', headers: { origin: ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body }, response);
    return response;
  }
  const start = await invoke({ action: 'start', expected_user_id: 'SYNTHETIC_OWNER' });
  const failure = await invoke({ action: 'callback', request_token: 'synthetic-request-token' }, start.headers['set-cookie'].split(';')[0]);
  assert.equal(failure.statusCode, 502);
  assert.equal(safeHoldingsError(failure.body.error).reference, 'profile.http_status.HTTP422.V.header.authorization.missing');
  assert.deepEqual(calls.map(({ url, options }) => [options.method, url.pathname]), [
    ['POST', '/oapi/v1/access-token'], ['GET', '/oapi/v3/user/profile'],
  ]);
  const serialized = JSON.stringify(failure.body);
  for (const value of ['private-provider-message', 'synthetic-broker-token', 'synthetic-app-key', 'SYNTHETIC_OWNER', 'synthetic-request-token']) assert.equal(serialized.includes(value), false);
  assert.match(failure.headers['set-cookie'], /Max-Age=0/);
});
