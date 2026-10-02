import assert from 'node:assert/strict';
import test from 'node:test';
import { localHoldingsError, safeHoldingsError } from './holdingsPhoneErrors.js';

const CODES = [
  'not_configured', 'invalid_request', 'origin_not_allowed', 'session_invalid',
  'session_expired', 'account_mismatch', 'provider_failed', 'unavailable', 'failed',
];
const STAGES = ['request', 'session', 'token_exchange', 'profile', 'holdings'];
const REASONS = [
  'invalid', 'origin', 'configuration', 'session', 'expired', 'owner_mismatch',
  'http_status', 'transport', 'timeout', 'response_size', 'json', 'response_shape',
  'identity_shape', 'snapshot_shape',
];
const RAW = 'OFFLINE_SECRET_SENTINEL';

function assertSafeShape(value) {
  assert.deepEqual(Object.keys(value).sort(), ['code', 'message', 'reference']);
  assert.equal(CODES.includes(value.code), true);
  assert.equal(typeof value.message, 'string');
  assert.equal(value.message.length > 0, true);
  assert.equal(value.reference === null || typeof value.reference === 'string', true);
  assert.equal(JSON.stringify(value).includes(RAW), false);
}

test('all recognized backend codes produce safe canonical output', () => {
  for (const code of CODES) {
    const result = safeHoldingsError({ code, message: RAW, extra: RAW });
    assertSafeShape(result);
    assert.equal(result.code, code);
    assert.equal(result.reference, null);
  }
});

test('every allowlisted stage and reason produces only the canonical reference', () => {
  for (const stage of STAGES) {
    for (const reason of REASONS) {
      const result = safeHoldingsError({ code: 'provider_failed', diagnostic: { stage, reason } });
      assertSafeShape(result);
      assert.equal(result.reference, `${stage}.${reason}`);
    }
  }
});

test('integer HTTP status boundaries are allowed without provider text', () => {
  for (const http_status of [100, 101, 200, 401, 500, 599]) {
    const result = safeHoldingsError({
      code: 'provider_failed', diagnostic: { stage: 'holdings', reason: 'http_status', http_status },
    });
    assert.equal(result.reference, `holdings.http_status.HTTP${http_status}`);
    assertSafeShape(result);
  }
});

test('token_missing is allowed only for token exchange diagnostics', () => {
  const valid = safeHoldingsError({
    code: 'provider_failed', diagnostic: { stage: 'token_exchange', reason: 'token_missing' },
  });
  assert.equal(valid.reference, 'token_exchange.token_missing');
  assertSafeShape(valid);
  for (const stage of STAGES.filter((value) => value !== 'token_exchange')) {
    const result = safeHoldingsError({ code: 'provider_failed', diagnostic: { stage, reason: 'token_missing' } });
    assert.equal(result.reference, null);
    assertSafeShape(result);
  }
});

test('invalid HTTP status types and values are ignored without coercion', () => {
  let coercions = 0;
  const poison = {
    toString() { coercions += 1; throw new Error(RAW); },
    valueOf() { coercions += 1; throw new Error(RAW); },
    [Symbol.toPrimitive]() { coercions += 1; throw new Error(RAW); },
  };
  for (const http_status of [
    undefined, null, false, true, '200', '599', '', 99, 600, 200.5, NaN, Infinity,
    -Infinity, -1, poison, Object(200), Object('200'), [], [200], Symbol(RAW),
  ]) {
    const result = safeHoldingsError({
      code: 'provider_failed', diagnostic: { stage: 'profile', reason: 'http_status', http_status },
    });
    assert.equal(result.reference, 'profile.http_status');
    assertSafeShape(result);
  }
  assert.equal(coercions, 0);
});

test('unknown or malformed stages and reasons drop the entire reference', () => {
  const invalid = [undefined, null, '', RAW, 'HOLDINGS', 'request.transport', 1, {}, [], Object('request')];
  for (const value of invalid) {
    for (const diagnostic of [
      { stage: value, reason: 'transport', http_status: 503 },
      { stage: 'holdings', reason: value, http_status: 503 },
    ]) {
      const result = safeHoldingsError({ code: 'provider_failed', diagnostic });
      assert.equal(result.reference, null);
      assertSafeShape(result);
    }
  }
  for (const diagnostic of [null, false, 'request.transport', [], new Date(), { stage: 'request' }, { reason: 'invalid' }]) {
    assert.equal(safeHoldingsError({ code: 'failed', diagnostic }).reference, null);
  }
});

test('unrecognized codes and non-plain inputs return a generic error without input', () => {
  const generic = safeHoldingsError(undefined);
  assertSafeShape(generic);
  assert.equal(generic.code, 'failed');
  assert.equal(generic.reference, null);
  class NonPlainError { constructor() { this.code = 'provider_failed'; this.message = RAW; } }
  for (const input of [
    null, false, true, 503, RAW, [], ['provider_failed'], new Error(RAW), new Date(),
    new NonPlainError(), new Map([['code', 'provider_failed']]), Object('provider_failed'),
    { code: RAW, message: RAW }, { code: 'PROVIDER_FAILED' }, { code: {} },
    Object.create({ code: 'provider_failed', message: RAW }),
  ]) assert.deepEqual(safeHoldingsError(input), generic);
});

test('raw provider messages, identifiers, URLs, headers and arbitrary fields never escape', () => {
  const baseline = safeHoldingsError({
    code: 'provider_failed', diagnostic: { stage: 'holdings', reason: 'transport', http_status: 503 },
  });
  const result = safeHoldingsError({
    code: 'provider_failed', message: `${RAW}<script>alert('offline')</script>`,
    user_id: `${RAW}-account`, account: { id: RAW }, api_key: RAW, access_token: RAW,
    url: `https://offline.example/${RAW}?request_token=${RAW}`,
    headers: { Authorization: `Bearer ${RAW}`, Cookie: RAW },
    diagnostic: {
      stage: 'holdings', reason: 'transport', http_status: 503,
      message: RAW, request_id: RAW, response: RAW, token: RAW, url: RAW,
    },
  });
  assert.deepEqual(result, baseline);
  assertSafeShape(result);
});

test('input and diagnostic descriptor getters are never evaluated', () => {
  let reads = 0;
  const getter = { enumerable: true, get() { reads += 1; throw new Error(RAW); } };
  const input = { code: 'provider_failed', diagnostic: { stage: 'request', reason: 'invalid' } };
  Object.defineProperty(input, 'message', getter);
  Object.defineProperty(input.diagnostic, 'http_status', getter);
  const result = safeHoldingsError(input);
  assert.equal(result.code, 'provider_failed');
  assert.equal(result.reference, 'request.invalid');
  const poisonedCode = {};
  Object.defineProperty(poisonedCode, 'code', getter);
  assert.deepEqual(safeHoldingsError(poisonedCode), safeHoldingsError(undefined));
  const poisonedDiagnostic = { code: 'failed' };
  Object.defineProperty(poisonedDiagnostic, 'diagnostic', getter);
  assert.equal(safeHoldingsError(poisonedDiagnostic).reference, null);
  assert.equal(reads, 0);
});

test('own fields are required and proxy inspection failures become generic errors', () => {
  const diagnostic = Object.create({ stage: 'request', reason: 'transport', http_status: 503 });
  assert.equal(safeHoldingsError({ code: 'failed', diagnostic }).reference, null);
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error(RAW); } });
  assert.deepEqual(safeHoldingsError(proxy), safeHoldingsError(undefined));
  const descriptorProxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(RAW); } });
  assert.deepEqual(safeHoldingsError(descriptorProxy), safeHoldingsError(undefined));
});

test('session-invalid guidance asks for the same browser and tab and a fresh sign-in', () => {
  const { message } = safeHoldingsError({ code: 'session_invalid', message: RAW });
  assert.match(message, /same.*browser.*tab|same.*tab.*browser/iu);
  assert.match(message, /new.*sign.?in|sign.?in.*again|start.*sign.?in/iu);
});

test('provider failures give distinct sign-in, account and holdings guidance', () => {
  const messages = ['token_exchange', 'profile', 'holdings'].map((stage) => {
    const result = safeHoldingsError({ code: 'provider_failed', diagnostic: { stage, reason: 'transport' } });
    assertSafeShape(result);
    assert.match(result.message, /HDFC/iu);
    return result.message;
  });
  assert.match(messages[0], /sign.?in/iu);
  assert.match(messages[1], /account/iu);
  assert.match(messages[2], /holdings/iu);
  assert.equal(new Set(messages).size, 3);
});

test('all local error categories produce only allowlisted references', () => {
  const categories = {
    callback: 'callback.invalid', snapshot: 'snapshot.invalid', transport: 'request.transport',
    json: 'request.json', shape: 'request.response_shape', configuration: 'request.configuration',
  };
  for (const [kind, reference] of Object.entries(categories)) {
    const result = localHoldingsError(kind);
    assertSafeShape(result);
    assert.equal(result.reference, reference);
  }
});

test('unknown local categories produce a generic error and never echo or coerce input', () => {
  const generic = localHoldingsError(undefined);
  assertSafeShape(generic);
  assert.equal(generic.reference, null);
  let coercions = 0;
  const poison = { toString() { coercions += 1; throw new Error(RAW); } };
  for (const kind of [null, false, 503, RAW, '<script>offline</script>', 'CALLBACK', {}, [], poison, Object('callback')]) {
    assert.deepEqual(localHoldingsError(kind), generic);
  }
  assert.equal(coercions, 0);
});
