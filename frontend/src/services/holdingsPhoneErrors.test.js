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

test('provider failures give distinct sign-in, request and holdings guidance', () => {
  const messages = ['token_exchange', 'profile', 'holdings'].map((stage) => {
    const result = safeHoldingsError({ code: 'provider_failed', diagnostic: { stage, reason: 'transport' } });
    assertSafeShape(result);
    assert.match(result.message, /HDFC/iu);
    return result.message;
  });
  assert.match(messages[0], /sign.?in/iu);
  assert.match(messages[1], /request/iu);
  assert.match(messages[2], /holdings/iu);
  assert.equal(new Set(messages).size, 3);
});

test('setup and legacy identity errors do not request a client ID or claim account verification', () => {
  for (const value of [
    { code: 'not_configured' },
    { code: 'account_mismatch' },
    { code: 'provider_failed', diagnostic: { stage: 'profile', reason: 'http_status', http_status: 422 } },
  ]) {
    const result = safeHoldingsError(value);
    assertSafeShape(result);
    assert.doesNotMatch(result.message, /client.?id|expected account|owner|account verification/iu);
  }
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

const VALIDATION_LOCATIONS = ['header', 'query', 'body', 'path'];
const VALIDATION_FIELDS = [
  'api_key', 'authorization', 'user_agent', 'content_type', 'access_token',
  'client_id', 'client_code', 'user_id', 'request_token', 'api_secret', 'token', 'other',
];
const VALIDATION_KINDS = ['missing', 'invalid'];
const PROFILE_422_REFERENCE = 'profile.http_status.HTTP422';

function validationError(validation, overrides = {}) {
  return safeHoldingsError({
    code: 'provider_failed',
    diagnostic: { stage: 'profile', reason: 'http_status', http_status: 422, validation, ...overrides },
  });
}

function issue(location = 'header', field = 'api_key', kind = 'missing') {
  return { location, field, kind };
}

function issueSuffix(value) {
  return `.V.${value.location}.${value.field}.${value.kind}`;
}

test('profile HTTP 422 validation accepts every allowlisted location, field and kind', () => {
  for (const location of VALIDATION_LOCATIONS) {
    for (const field of VALIDATION_FIELDS) {
      for (const kind of VALIDATION_KINDS) {
        const value = issue(location, field, kind);
        const result = validationError([value]);
        assert.equal(result.reference, PROFILE_422_REFERENCE + issueSuffix(value));
        assertSafeShape(result);
      }
    }
  }
});

test('validation issue references preserve order and deduplicate canonical issues', () => {
  const first = issue('body', 'client_id', 'invalid');
  const second = issue('header', 'authorization', 'missing');
  const third = issue('query', 'token', 'invalid');
  const result = validationError([first, second, { ...first, message: RAW }, third, second]);
  assert.equal(result.reference, PROFILE_422_REFERENCE + [first, second, third].map(issueSuffix).join(''));
  assertSafeShape(result);
});

test('only the first eight input positions are inspected and the ninth cannot fill skipped slots', () => {
  const firstEight = VALIDATION_FIELDS.slice(0, 8).map((field) => issue('header', field, 'missing'));
  const ninth = issue('body', 'request_token', 'invalid');
  const result = validationError([...firstEight, ninth]);
  assert.equal(result.reference, PROFILE_422_REFERENCE + firstEight.map(issueSuffix).join(''));
  assert.equal(validationError([...Array(8).fill(null), ninth]).reference, PROFILE_422_REFERENCE);
  const repeated = issue();
  assert.equal(validationError([...Array(8).fill(repeated), ninth]).reference, PROFILE_422_REFERENCE + issueSuffix(repeated));
  let ninthReads = 0;
  const values = [...firstEight];
  Object.defineProperty(values, '8', { get() { ninthReads += 1; throw new Error(RAW); } });
  assert.equal(validationError(values).reference, PROFILE_422_REFERENCE + firstEight.map(issueSuffix).join(''));
  assert.equal(ninthReads, 0);
});

test('validation requires the exact profile HTTP-status context and a numeric 422', () => {
  const values = [issue()];
  for (const stage of STAGES.filter((value) => value !== 'profile')) {
    assert.equal(validationError(values, { stage }).reference, `${stage}.http_status.HTTP422`);
  }
  for (const reason of REASONS.filter((value) => value !== 'http_status')) {
    assert.equal(validationError(values, { reason }).reference, `profile.${reason}.HTTP422`);
  }
  for (const http_status of [100, 421, 423, 599]) {
    assert.equal(validationError(values, { http_status }).reference, `profile.http_status.HTTP${http_status}`);
  }
  for (const http_status of ['422', Object(422), null, 422.5, NaN, undefined]) {
    assert.equal(validationError(values, { http_status }).reference, 'profile.http_status');
  }
  assert.equal(validationError(values, { stage: RAW }).reference, null);
  assert.equal(validationError(values, { reason: RAW }).reference, null);
});

test('unknown validation blocks and nonstandard array prototypes preserve the base reference', () => {
  class IssueArray extends Array {}
  const inheritedArray = [issue()];
  Object.setPrototypeOf(inheritedArray, Object.create(Array.prototype));
  const proxyArray = new Proxy([issue()], { getPrototypeOf() { throw new Error(RAW); } });
  for (const validation of [
    undefined, null, false, RAW, {}, { 0: issue(), length: 1 }, new Date(),
    new IssueArray(issue()), inheritedArray, proxyArray,
  ]) {
    const result = validationError(validation);
    assert.equal(result.reference, PROFILE_422_REFERENCE);
    assertSafeShape(result);
  }
  assert.equal(validationError([]).reference, PROFILE_422_REFERENCE);
});

test('null-prototype arrays and own-data issue records remain supported', () => {
  const value = Object.assign(Object.create(null), issue('path', 'other', 'invalid'));
  const values = [value];
  Object.setPrototypeOf(values, null);
  const result = validationError(values);
  assert.equal(result.reference, PROFILE_422_REFERENCE + '.V.path.other.invalid');
  assertSafeShape(result);
});

test('invalid issue shapes, inherited fields and wrapped strings are skipped without coercion', () => {
  let coercions = 0;
  const poison = { [Symbol.toPrimitive]() { coercions += 1; throw new Error(RAW); } };
  class IssueRecord { constructor() { Object.assign(this, issue()); } }
  const invalid = [
    null, undefined, RAW, [], new IssueRecord(), Object.assign(new Date(), issue()),
    Object.create(issue()), {}, { location: 'header', field: 'api_key' },
    issue('HEADER'), issue('header', 'unknown'), issue('header', 'api_key', 'MISSING'),
    issue(Object('header')), issue('header', Object('api_key')), issue('header', 'api_key', Object('missing')),
    issue(poison), issue('header', poison), issue('header', 'api_key', poison),
  ];
  const valid = issue('query', 'client_code', 'missing');
  for (const value of invalid) {
    const result = validationError([value, valid]);
    assert.equal(result.reference, PROFILE_422_REFERENCE + issueSuffix(valid));
    assertSafeShape(result);
  }
  assert.equal(coercions, 0);
});

test('issue and array index getters are not executed and valid later positions survive', () => {
  let reads = 0;
  const getter = { get() { reads += 1; throw new Error(RAW); } };
  const valid = issue('body', 'user_id', 'invalid');
  for (const field of ['location', 'field', 'kind']) {
    const value = issue();
    Object.defineProperty(value, field, getter);
    assert.equal(validationError([value, valid]).reference, PROFILE_422_REFERENCE + issueSuffix(valid));
  }
  const values = [null, valid];
  Object.defineProperty(values, '0', getter);
  assert.equal(validationError(values).reference, PROFILE_422_REFERENCE + issueSuffix(valid));
  assert.equal(reads, 0);
});

test('proxy failures are isolated per issue and per array index', () => {
  const first = issue('header', 'api_secret', 'missing');
  const last = issue('path', 'access_token', 'invalid');
  for (const value of [
    new Proxy(issue(), { getPrototypeOf() { throw new Error(RAW); } }),
    new Proxy(issue(), { getOwnPropertyDescriptor() { throw new Error(RAW); } }),
  ]) {
    const result = validationError([first, value, last]);
    assert.equal(result.reference, PROFILE_422_REFERENCE + issueSuffix(first) + issueSuffix(last));
    assertSafeShape(result);
  }
  const values = new Proxy([first, null, last], {
    getOwnPropertyDescriptor(target, key) {
      if (key === '1') throw new Error(RAW);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.equal(validationError(values).reference, PROFILE_422_REFERENCE + issueSuffix(first) + issueSuffix(last));
});

test('validation property inspection failures preserve the existing profile HTTP 422 reference', () => {
  let reads = 0;
  const diagnostic = { stage: 'profile', reason: 'http_status', http_status: 422 };
  Object.defineProperty(diagnostic, 'validation', { get() { reads += 1; throw new Error(RAW); } });
  assert.equal(safeHoldingsError({ code: 'provider_failed', diagnostic }).reference, PROFILE_422_REFERENCE);
  const descriptorProxy = new Proxy({ stage: 'profile', reason: 'http_status', http_status: 422 }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'validation') throw new Error(RAW);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.equal(safeHoldingsError({ code: 'provider_failed', diagnostic: descriptorProxy }).reference, PROFILE_422_REFERENCE);
  assert.equal(reads, 0);
});

test('raw validation messages, values, IDs, URLs and extra fields never appear in the result', () => {
  const value = issue('header', 'api_key', 'missing');
  const poisoned = {
    ...value, message: RAW, input: RAW, value: RAW, request_id: RAW, user_id: RAW,
    url: `https://offline.example/${RAW}`, headers: { Authorization: RAW },
    context: { api_secret: RAW }, loc: ['header', RAW], type: RAW,
  };
  let reads = 0;
  Object.defineProperty(poisoned, 'ignored', { get() { reads += 1; throw new Error(RAW); } });
  const result = validationError([poisoned, issue(RAW), issue('body', RAW), issue('body', 'token', RAW)]);
  assert.deepEqual(result, validationError([value]));
  assertSafeShape(result);
  assert.equal(reads, 0);
});
