import assert from 'node:assert/strict';
import test from 'node:test';
import { localHoldingsError, safeHoldingsError } from './holdingsPhoneErrors.js';

const REPORT_TERMS = [
  'api_key', 'api_secret', 'access_token', 'request_token', 'authorization', 'user',
  'client', 'account', 'application', 'ip', 'static_ip', 'redirect', 'holdings',
  'portfolio', 'subscription', 'plan', 'permission', 'scope', 'signature',
  'checksum', 'timestamp', 'version', 'parameter', 'missing', 'required',
  'invalid', 'expired', 'rejected', 'denied', 'not', 'allowed', 'whitelisted',
  'registered', 'activated', 'mapped', 'matched', 'found', 'disabled', 'enabled',
  'entitled', 'configured', 'empty', 'null', 'success', 'failure',
];

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

function reportFixture(overrides = {}) {
  return {
    version: 1,
    provider_codes: ['60042'],
    error_schema: [{ path: 'root', type: 'object' }, { path: 'root.meta.message', type: 'string' }],
    message_terms: ['api_key', 'client', 'not', 'registered'],
    ...overrides,
  };
}

function reportError(provider_report, overrides = {}) {
  return safeHoldingsError({ code: 'provider_failed', diagnostic: {
    stage: 'holdings', reason: 'http_status', http_status: 422, provider_report, ...overrides,
  } });
}

test('safe provider report retains numeric metadata, canonical types and message concepts', () => {
  const supplied = reportFixture();
  const result = reportError(supplied);
  assert.equal(result.reference, 'holdings.http_status.HTTP422');
  assert.deepEqual(result.providerReport, supplied);
  assert.match(result.providerReportText, /Provider codes: 60042/u);
  assert.match(result.providerReportText, /Provider message mentions: api key, client, not, registered/u);
  assert.match(result.providerReportText, /root\.meta\.message: string/u);
  assert.doesNotMatch(result.providerReportText, /caused|cause is|credentials are invalid/iu);
  supplied.provider_codes[0] = RAW;
  supplied.message_terms[0] = RAW;
  supplied.error_schema[0].path = RAW;
  assert.equal(JSON.stringify(result).includes(RAW), false);
});

test('provider report accepts all fixed terms and types in bounded canonical groups', () => {
  for (let index = 0; index < REPORT_TERMS.length; index += 24) {
    const terms = REPORT_TERMS.slice(index, index + 24);
    assert.deepEqual(reportError(reportFixture({ message_terms: terms })).providerReport.message_terms, terms);
  }
  const types = ['null', 'string', 'number', 'boolean', 'object', 'array'];
  const schema = types.map((type) => ({ path: 'root.data.items.other', type }));
  assert.deepEqual(reportError(reportFixture({ error_schema: schema })).providerReport.error_schema, schema);
  const codes = ['0', '001', '60014', '999999'];
  assert.deepEqual(reportError(reportFixture({ provider_codes: codes })).providerReport.provider_codes, codes);
  assert.deepEqual(reportError(reportFixture({ provider_codes: [], error_schema: [], message_terms: [] })).providerReport,
    { version: 1, provider_codes: [], error_schema: [], message_terms: [] });
});

test('any arbitrary secret, private identifier or field invalidates the optional report', () => {
  const privateValues = [RAW, 'ABCDE1234F', '9876543210', 'DEMO-CLIENT-42', '192.0.2.9',
    'owner@example.invalid', 'INE000DEMO00', '<script>offline</script>', 'ordinary-private-name'];
  const baseline = reportError(undefined);
  for (const value of privateValues) {
    for (const report of [
      reportFixture({ provider_codes: [value] }),
      reportFixture({ message_terms: ['api_key', value] }),
      reportFixture({ error_schema: [{ path: `root.${value}`, type: 'string' }] }),
      reportFixture({ error_schema: [{ path: 'root.message', type: value }] }),
      reportFixture({ error_schema: [{ path: 'root.message', type: 'string', message: value }] }),
      reportFixture({ message: value }),
      reportFixture({ [value]: 'string' }),
    ]) {
      const result = reportError(report);
      assert.deepEqual(result, baseline);
      assert.equal(JSON.stringify(result).includes(value), false);
    }
  }
});

test('malformed report fields, bounds and canonical ordering fail closed', () => {
  const baseline = reportError(undefined);
  const invalid = [
    undefined, null, false, RAW, [], new Date(), Object.create(reportFixture()),
    reportFixture({ version: '1' }), reportFixture({ version: 2 }),
    reportFixture({ provider_codes: ['1234567'] }), reportFixture({ provider_codes: [60042] }),
    reportFixture({ provider_codes: ['1', '1'] }), reportFixture({ provider_codes: ['1', '2', '3', '4', '5'] }),
    reportFixture({ provider_codes: [' 60042'] }), reportFixture({ provider_codes: ['60042\n'] }),
    reportFixture({ provider_codes: [Object('60042')] }), reportFixture({ message_terms: ['not', 'api_key'] }),
    reportFixture({ message_terms: ['api_key', 'api_key'] }), reportFixture({ message_terms: REPORT_TERMS.slice(0, 25) }),
    reportFixture({ message_terms: ['API_KEY'] }), reportFixture({ message_terms: [Object('api_key')] }),
    reportFixture({ error_schema: [{ path: 'meta.message', type: 'string' }] }),
    reportFixture({ error_schema: [{ path: 'root..message', type: 'string' }] }),
    reportFixture({ error_schema: [{ path: 'root.meta.root', type: 'string' }] }),
    reportFixture({ error_schema: [{ path: 'root.error.error.error.error.error.message', type: 'string' }] }),
    reportFixture({ error_schema: [{ path: 'root.message', type: 'STRING' }] }),
    reportFixture({ error_schema: [{ path: 'root', type: 'object' }, { path: 'root', type: 'object' }] }),
    reportFixture({ error_schema: Array.from({ length: 17 }, () => ({ path: 'root', type: 'object' })) }),
    reportFixture({ error_schema: [{ path: 'root.message', type: 'string', extra: RAW }] }),
  ];
  for (const report of invalid) assert.deepEqual(reportError(report), baseline);
});

test('safe report requires dense own-data arrays and never invokes getters or coercion', () => {
  let reads = 0;
  const getter = { enumerable: true, get() { reads += 1; throw new Error(RAW); } };
  const codeGetter = ['60042']; Object.defineProperty(codeGetter, '0', getter);
  const termGetter = ['api_key']; Object.defineProperty(termGetter, '0', getter);
  const fieldGetter = { path: 'root.message', type: 'string' }; Object.defineProperty(fieldGetter, 'type', getter);
  const reportGetter = reportFixture(); Object.defineProperty(reportGetter, 'message_terms', getter);
  const inherited = ['60042']; Object.setPrototypeOf(inherited, Object.create(Array.prototype));
  const extraArrayField = ['60042']; extraArrayField.private = RAW;
  const symbolArrayField = ['60042']; symbolArrayField[Symbol(RAW)] = RAW;
  const sparse = new Array(1);
  const poison = { [Symbol.toPrimitive]() { reads += 1; throw new Error(RAW); } };
  const proxy = new Proxy(reportFixture(), { ownKeys() { throw new Error(RAW); } });
  const baseline = reportError(undefined);
  for (const report of [reportGetter, proxy,
    reportFixture({ provider_codes: codeGetter }), reportFixture({ message_terms: termGetter }),
    reportFixture({ error_schema: [fieldGetter] }), reportFixture({ provider_codes: inherited }),
    reportFixture({ provider_codes: extraArrayField }), reportFixture({ provider_codes: symbolArrayField }),
    reportFixture({ provider_codes: sparse }), reportFixture({ provider_codes: [poison] }),
  ]) assert.deepEqual(reportError(report), baseline);
  assert.equal(reads, 0);
});

test('null-prototype reports remain canonical and reports cannot escape holdings422 gating', () => {
  const source = reportFixture();
  const report = Object.assign(Object.create(null), source);
  Object.setPrototypeOf(report.provider_codes, null);
  Object.setPrototypeOf(report.message_terms, null);
  Object.setPrototypeOf(report.error_schema, null);
  assert.equal(reportError(report).providerReport.version, 1);
  for (const overrides of [
    { stage: 'token_exchange' }, { stage: 'profile' }, { stage: 'request' },
    { reason: 'transport' }, { http_status: 401 }, { http_status: 201 }, { http_status: '422' },
  ]) {
    const result = reportError(report, overrides);
    assert.equal(result.providerReport, undefined);
    assert.equal(result.providerReportText, undefined);
  }
});

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

test('legacy validation retains numeric422 and excludes stages outside profile or holdings', () => {
  const values = [issue()];
  for (const stage of STAGES.filter((value) => value !== 'profile' && value !== 'holdings')) {
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

const HOLDINGS_422_REFERENCE = 'holdings.http_status.HTTP422';
const OUTCOMES = ['classified', 'unknown', 'non_json', 'invalid_json', 'invalid_utf8', 'empty', 'size', 'timeout', 'read_error'];
const FORMATS = ['json', 'html', 'text', 'other', 'absent'];
const CATEGORIES = ['authentication_required', 'api_key_rejected', 'access_token_rejected', 'missing_parameter', 'invalid_request', 'access_denied', 'ip_restricted', 'rate_limited', 'portfolio_unavailable', 'unprocessable_request', 'unknown'];
const FLAGS = {
  api_key_has_outer_whitespace: 'key_space', token_has_whitespace: 'token_space',
  token_has_bearer_prefix: 'bearer_prefix', top_level_token_fields_conflict: 'token_conflict',
};

function holdingsError(optional = {}, context = {}) {
  return safeHoldingsError({ code: 'provider_failed', diagnostic: { stage: 'holdings', reason: 'http_status', http_status: 422, ...optional, ...context } });
}

test('holdings422 observations accept only the fixed outcome, format and category catalogs', () => {
  for (const [field, marker, values] of [['error_outcome', 'R', OUTCOMES], ['response_format', 'M', FORMATS], ['error_category', 'E', CATEGORIES]]) {
    for (const value of values) {
      const result = holdingsError({ [field]: value });
      assert.equal(result.reference, `${HOLDINGS_422_REFERENCE}.${marker}.${value}`);
      assertSafeShape(result);
    }
    for (const value of [RAW, 'constructor', '__proto__', new String(values[0]), null, true, 0, [], {}, values[0].toUpperCase()]) {
      assert.equal(holdingsError({ [field]: value }).reference, HOLDINGS_422_REFERENCE);
    }
  }
});

test('holdings422 suffix order is stable and code60014 does not claim an empty successful snapshot', () => {
  const result = holdingsError({
    response_format: 'json', error_outcome: 'classified', error_category: 'unknown',
    provider_code: '60014', validation: [issue('header', 'x_api_key', 'missing')],
    format_flags: { token_has_whitespace: true }, holdings_count: 0, holdings: [], message: RAW,
  });
  assert.equal(result.reference, `${HOLDINGS_422_REFERENCE}.R.classified.M.json.E.unknown.C.60014.V.header.x_api_key.missing`);
  assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'reference']);
  assert.equal(result.message, holdingsError().message);
  assert.doesNotMatch(result.message, /empty|no holdings|success|portfolio.*null/iu);
});

test('provider code accepts only the canonical60014 string without coercion or partial matching', () => {
  let conversions = 0;
  const wrapped = { toString() { conversions += 1; return '60014'; }, valueOf() { conversions += 1; return 60014; } };
  for (const provider_code of [60014, '060014', '60014.0', ' 60014', '60014 ', '60014' + RAW, new String('60014'), wrapped, [], null, true]) {
    assert.equal(holdingsError({ provider_code }).reference, HOLDINGS_422_REFERENCE);
  }
  assert.equal(holdingsError({ provider_code: '60014' }).reference, HOLDINGS_422_REFERENCE + '.C.60014');
  assert.equal(conversions, 0);
});

test('new observations are gated to holdings numeric422 and preserve legacy profile validation only', () => {
  const optional = { error_outcome: 'unknown', response_format: 'json', error_category: 'unknown', provider_code: '60014', validation: [issue()], format_flags: { token_has_whitespace: true } };
  for (const stage of STAGES.filter(value => value !== 'holdings')) {
    const result = holdingsError(optional, { stage });
    assert.equal(result.reference, `${stage}.http_status.HTTP422${stage === 'profile' ? issueSuffix(issue()) : ''}`);
  }
  for (const reason of REASONS.filter(value => value !== 'http_status')) {
    assert.equal(holdingsError(optional, { reason }).reference, `holdings.${reason}.HTTP422`);
  }
  for (const http_status of [200, 201, 401, 403, 404, 421, 423, 500]) {
    assert.equal(holdingsError(optional, { http_status }).reference, `holdings.http_status.HTTP${http_status}`);
  }
  for (const http_status of ['422', new Number(422), null, NaN]) {
    assert.equal(holdingsError(optional, { http_status }).reference, 'holdings.http_status');
  }
});

test('holdings validation examines first32 positions and emits at most8 unique canonical triples', () => {
  const first = issue('header', 'x_api_key', 'missing');
  assert.equal(holdingsError({ validation: [...Array(31).fill(null), first] }).reference, HOLDINGS_422_REFERENCE + issueSuffix(first));
  assert.equal(holdingsError({ validation: [...Array(32).fill(null), first] }).reference, HOLDINGS_422_REFERENCE);
  const unique = ['api_key', 'authorization', 'user_agent', 'content_type', 'access_token', 'client_id', 'client_code', 'user_id', 'request_token'].map(field => issue('header', field, 'missing'));
  const values = [null, unique[0], unique[0], ...unique.slice(1)];
  assert.equal(holdingsError({ validation: values }).reference, HOLDINGS_422_REFERENCE + unique.slice(0, 8).map(issueSuffix).join(''));
  assert.equal(validationError([...Array(8).fill(null), first]).reference, PROFILE_422_REFERENCE);
  assert.equal(validationError([first]).reference, PROFILE_422_REFERENCE);
});

test('holdings validation skips getters and unfamiliar records without hiding later safe entries', () => {
  let reads = 0;
  const getter = Object.defineProperty({}, 'location', { get() { reads += 1; throw new Error(RAW); } });
  const values = [getter, Object.create(issue()), [RAW], issue('header', RAW), issue('header', 'token', RAW), issue('query', 'token', 'missing')];
  Object.defineProperty(values, 1, { get() { reads += 1; throw new Error(RAW); } });
  assert.equal(holdingsError({ validation: values }).reference, HOLDINGS_422_REFERENCE + '.V.query.token.missing');
  assert.equal(reads, 0);
  const nullIssue = Object.assign(Object.create(null), issue('header', 'x_api_key', 'invalid'));
  const nullArray = [nullIssue]; Object.setPrototypeOf(nullArray, null);
  assert.equal(holdingsError({ validation: nullArray }).reference, HOLDINGS_422_REFERENCE + '.V.header.x_api_key.invalid');
});

test('uninformative holdings422 accepts exact booleans in fixed flag order only', () => {
  const flags = { api_key_has_outer_whitespace: true, token_has_whitespace: false, token_has_bearer_prefix: true, top_level_token_fields_conflict: false, unknown: RAW };
  for (const error_outcome of OUTCOMES.filter(value => value !== 'classified')) {
    const result = holdingsError({ error_outcome, error_category: 'unknown', format_flags: flags });
    assert.equal(result.reference, `${HOLDINGS_422_REFERENCE}.R.${error_outcome}.E.unknown.F.key_space.true.F.token_space.false.F.bearer_prefix.true.F.token_conflict.false`);
    assertSafeShape(result);
  }
  for (const value of ['true', 'false', 1, 0, null, [], {}, new Boolean(true)]) {
    const result = holdingsError({ error_outcome: 'unknown', error_category: 'unknown', format_flags: Object.fromEntries(Object.keys(FLAGS).map(name => [name, value])) });
    assert.equal(result.reference, HOLDINGS_422_REFERENCE + '.R.unknown.E.unknown');
  }
});

test('format flags are suppressed when evidence is classified, informative or lacks canonical unknown metadata', () => {
  const base = { error_outcome: 'unknown', error_category: 'unknown', format_flags: { token_has_whitespace: true } };
  for (const overrides of [
    { error_outcome: 'classified' }, { error_outcome: RAW }, { error_outcome: undefined },
    { error_category: 'invalid_request' }, { error_category: undefined }, { error_category: RAW },
    { provider_code: '60014' }, { validation: [issue()] },
  ]) assert.doesNotMatch(holdingsError({ ...base, ...overrides }).reference, /\.F\./u);
});

test('format flag getters, inherited values and nonplain objects are ignored without executing code', () => {
  let reads = 0;
  const getters = {};
  for (const name of Object.keys(FLAGS)) Object.defineProperty(getters, name, { get() { reads += 1; throw new Error(RAW); } });
  class FlagRecord { constructor() { this.token_has_whitespace = true; } }
  const expected = HOLDINGS_422_REFERENCE + '.R.unknown.E.unknown';
  for (const format_flags of [getters, Object.create({ token_has_whitespace: true }), new FlagRecord(), [true], true]) {
    assert.equal(holdingsError({ error_outcome: 'unknown', error_category: 'unknown', format_flags }).reference, expected);
  }
  const nullFlags = Object.assign(Object.create(null), { token_has_whitespace: false });
  assert.equal(holdingsError({ error_outcome: 'unknown', error_category: 'unknown', format_flags: nullFlags }).reference, expected + '.F.token_space.false');
  assert.equal(reads, 0);
});

test('optional descriptor inspection failures preserve base422 and independent safe metadata', () => {
  const record = { stage: 'holdings', reason: 'http_status', http_status: 422, response_format: 'html', error_outcome: 'unknown', error_category: 'unknown' };
  const diagnostic = new Proxy(record, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'error_outcome' || key === 'validation') throw new Error(RAW);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const result = safeHoldingsError({ code: 'provider_failed', diagnostic });
  assert.equal(result.reference, HOLDINGS_422_REFERENCE + '.M.html.E.unknown');
  assertSafeShape(result);
  let reads = 0;
  for (const name of ['error_outcome', 'response_format', 'error_category', 'provider_code', 'validation', 'format_flags']) {
    const plain = { stage: 'holdings', reason: 'http_status', http_status: 422 };
    Object.defineProperty(plain, name, { get() { reads += 1; throw new Error(RAW); } });
    assert.equal(safeHoldingsError({ code: 'provider_failed', diagnostic: plain }).reference, HOLDINGS_422_REFERENCE);
  }
  assert.equal(reads, 0);
});

test('private provider text and arbitrary metadata cannot become holdings422 references or change fixed copy', () => {
  let conversions = 0;
  const hostile = { toString() { conversions += 1; return RAW; } };
  const result = holdingsError({
    error_outcome: hostile, response_format: RAW.repeat(1024), error_category: RAW,
    provider_code: hostile, validation: [{ ...issue('header', 'api_key', 'missing'), input: RAW, msg: RAW, ctx: { token: RAW } }],
    format_flags: { token_has_whitespace: hostile }, message: RAW, body: RAW, url: RAW,
    token_length: 15, token_hash: RAW, client_id: RAW, claims: { sub: RAW },
  });
  assert.equal(result.reference, HOLDINGS_422_REFERENCE + '.V.header.api_key.missing');
  assert.equal(result.message, holdingsError().message);
  assertSafeShape(result);
  assert.equal(conversions, 0);
});
