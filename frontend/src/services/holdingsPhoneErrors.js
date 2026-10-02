const STAGES = new Set(['request', 'session', 'token_exchange', 'profile', 'holdings']);
const REASONS = new Set([
  'invalid', 'origin', 'configuration', 'session', 'expired', 'owner_mismatch',
  'http_status', 'transport', 'timeout', 'response_size', 'json', 'response_shape',
  'identity_shape', 'snapshot_shape', 'token_missing',
]);
const VALIDATION_LOCATIONS = new Set(['header', 'query', 'body', 'path']);
const VALIDATION_FIELDS = new Set([
  'api_key', 'authorization', 'user_agent', 'content_type', 'access_token',
  'client_id', 'client_code', 'user_id', 'request_token', 'api_secret', 'token', 'other',
]);
const VALIDATION_KINDS = new Set(['missing', 'invalid']);
const RESPONSE_FORMATS = new Set(['json', 'html', 'text', 'other', 'absent']);
const ERROR_OUTCOMES = new Set(['classified', 'unknown', 'non_json', 'invalid_json', 'invalid_utf8', 'empty', 'size', 'timeout', 'read_error']);
const ERROR_CATEGORIES = new Set([
  'authentication_required', 'api_key_rejected', 'access_token_rejected',
  'missing_parameter', 'invalid_request', 'access_denied', 'ip_restricted',
  'rate_limited', 'portfolio_unavailable', 'unprocessable_request', 'unknown',
]);
const FORMAT_FLAGS = Object.freeze([
  ['api_key_has_outer_whitespace', 'key_space'],
  ['token_has_whitespace', 'token_space'],
  ['token_has_bearer_prefix', 'bearer_prefix'],
  ['top_level_token_fields_conflict', 'token_conflict'],
]);
// Independent browser allowlists: a provider report is never trusted merely
// because it came from this app's API. No arbitrary provider text is accepted.
const REPORT_PATH_SEGMENTS = new Set(['root', 'meta', 'error', 'errors', 'error_response', 'data', 'detail', 'response', 'message', 'code', 'status', 'other', 'items']);
const REPORT_TYPES = new Set(['null', 'string', 'number', 'boolean', 'object', 'array']);
const REPORT_TERMS = Object.freeze([
  'api_key', 'api_secret', 'access_token', 'request_token', 'authorization',
  'user', 'client', 'account', 'application', 'ip', 'static_ip', 'redirect',
  'holdings', 'portfolio', 'subscription', 'plan', 'permission', 'scope',
  'signature', 'checksum', 'timestamp', 'version', 'parameter', 'missing',
  'required', 'invalid', 'expired', 'rejected', 'denied', 'not', 'allowed',
  'whitelisted', 'registered', 'activated', 'mapped', 'matched', 'found',
  'disabled', 'enabled', 'entitled', 'configured', 'empty', 'null', 'success', 'failure',
]);
const REPORT_TERM_ORDER = new Map(REPORT_TERMS.map((term, index) => [term, index]));
const MESSAGES = Object.freeze({
  not_configured: 'This holdings page needs setup before it can be used.',
  invalid_request: 'This sign-in response could not be verified. Start a new sign-in.',
  origin_not_allowed: 'Open the production holdings page and start a new sign-in.',
  session_invalid: 'Start a new sign-in and complete it in the same browser and tab on this phone.',
  session_expired: 'This sign-in has expired. Start a new sign-in in the same browser and tab.',
  account_mismatch: 'This sign-in response could not be completed. Start a new HDFC sign-in.',
  provider_failed: 'HDFC could not complete this request. Please ask for help with this error.',
  unavailable: 'The holdings service is unavailable. Please try again later.',
  failed: 'The holdings snapshot could not be verified. Please start again.',
});

// Read only own data fields. Do not execute getters or coerce unknown values.
function dataValue(record, key) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const prototype = Object.getPrototypeOf(record);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

// Optional validation metadata must not invalidate the fixed diagnostic when
// a malformed array/item is rejected. Legacy profile examines eight positions;
// holdings examines thirty-two and emits at most eight unique triples.
function validationReference(diagnostic, maximumExamined = 8, allowXApiKey = false) {
  try {
    const issues = dataValue(diagnostic, 'validation');
    if (!Array.isArray(issues)) return '';
    const prototype = Object.getPrototypeOf(issues);
    if (prototype !== Array.prototype && prototype !== null) return '';
    const lengthDescriptor = Object.getOwnPropertyDescriptor(issues, 'length');
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value') ? lengthDescriptor.value : null;
    if (!Number.isSafeInteger(length) || length < 0) return '';
    const accepted = new Set();
    for (let index = 0; index < Math.min(length, maximumExamined) && accepted.size < 8; index += 1) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(issues, `${index}`);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) continue;
        const issue = descriptor.value;
        const location = dataValue(issue, 'location');
        const field = dataValue(issue, 'field');
        const kind = dataValue(issue, 'kind');
        if (typeof location !== 'string' || location.length > 6 || !VALIDATION_LOCATIONS.has(location)
            || typeof field !== 'string' || field.length > 13 || !(VALIDATION_FIELDS.has(field) || (allowXApiKey && field === 'x_api_key'))
            || typeof kind !== 'string' || kind.length > 7 || !VALIDATION_KINDS.has(kind)) continue;
        accepted.add(`.V.${location}.${field}.${kind}`);
      } catch { /* Reject this optional item without losing the fixed reference. */ }
    }
    return [...accepted].join('');
  } catch {
    return '';
  }
}

function optionalDataValue(record, key) {
  try { return dataValue(record, key); } catch { return undefined; }
}

function exactDataRecord(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some((key) => typeof key !== 'string' || !names.includes(key))) return null;
  const record = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    record[name] = descriptor.value;
  }
  return record;
}

function boundedDataArray(value, maximum) {
  if (!Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Array.prototype && prototype !== null) return null;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => typeof key !== 'string'
    || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) return null;
  const accepted = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, `${index}`);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    accepted.push(descriptor.value);
  }
  return accepted;
}

function safeProviderReport(value) {
  try {
    const supplied = exactDataRecord(value, ['version', 'provider_codes', 'error_schema', 'message_terms']);
    if (!supplied || supplied.version !== 1) return null;
    const codes = boundedDataArray(supplied.provider_codes, 4);
    const schema = boundedDataArray(supplied.error_schema, 16);
    const terms = boundedDataArray(supplied.message_terms, 24);
    if (!codes || !schema || !terms || codes.some((code) => typeof code !== 'string' || !/^[0-9]{1,6}$/u.test(code))
      || new Set(codes).size !== codes.length) return null;
    const acceptedSchema = [];
    const seenSchema = new Set();
    for (const item of schema) {
      const entry = exactDataRecord(item, ['path', 'type']);
      if (!entry || typeof entry.path !== 'string' || entry.path.length > 95
        || typeof entry.type !== 'string' || !REPORT_TYPES.has(entry.type)) return null;
      const segments = entry.path.split('.');
      if (segments.length > 6 || segments[0] !== 'root' || segments.slice(1).includes('root')
        || segments.some((segment) => !REPORT_PATH_SEGMENTS.has(segment))) return null;
      const key = `${entry.path}:${entry.type}`;
      if (seenSchema.has(key)) return null;
      seenSchema.add(key);
      acceptedSchema.push({ path: segments.join('.'), type: entry.type });
    }
    let previousOrder = -1;
    for (const term of terms) {
      const order = typeof term === 'string' ? REPORT_TERM_ORDER.get(term) : undefined;
      if (order === undefined || order <= previousOrder) return null;
      previousOrder = order;
    }
    return { version: 1, provider_codes: [...codes], error_schema: acceptedSchema, message_terms: [...terms] };
  } catch { return null; }
}

function providerReportText(report, reference) {
  return [
    'Safe provider error report v1',
    `Reference: ${reference}`,
    `Provider codes: ${report.provider_codes.length ? report.provider_codes.join(', ') : 'none reported'}`,
    `Provider message mentions: ${report.message_terms.length ? report.message_terms.map((term) => term.replaceAll('_', ' ')).join(', ') : 'no recognized terms'}`,
    'Error field types:',
    ...report.error_schema.map(({ path, type }) => `${path}: ${type}`),
  ].join('\n');
}

// Optional holdings observations never replace the original HTTP422 reference.
function holdings422Reference(diagnostic) {
  const suppliedOutcome = optionalDataValue(diagnostic, 'error_outcome');
  const suppliedFormat = optionalDataValue(diagnostic, 'response_format');
  const suppliedCategory = optionalDataValue(diagnostic, 'error_category');
  const outcome = typeof suppliedOutcome === 'string' && ERROR_OUTCOMES.has(suppliedOutcome) ? suppliedOutcome : null;
  const format = typeof suppliedFormat === 'string' && RESPONSE_FORMATS.has(suppliedFormat) ? suppliedFormat : null;
  const category = typeof suppliedCategory === 'string' && ERROR_CATEGORIES.has(suppliedCategory) ? suppliedCategory : null;
  const providerCode = optionalDataValue(diagnostic, 'provider_code') === '60014' ? '60014' : null;
  const validation = validationReference(diagnostic, 32, true);
  let reference = '';
  if (outcome) reference += `.R.${outcome}`;
  if (format) reference += `.M.${format}`;
  if (category) reference += `.E.${category}`;
  if (providerCode) reference += `.C.${providerCode}`;
  reference += validation;
  if (outcome && outcome !== 'classified' && category === 'unknown' && !providerCode && !validation) {
    const flags = optionalDataValue(diagnostic, 'format_flags');
    for (const [name, shortName] of FORMAT_FLAGS) {
      const value = optionalDataValue(flags, name);
      if (typeof value === 'boolean') reference += `.F.${shortName}.${value ? 'true' : 'false'}`;
    }
  }
  return reference;
}

/** Convert backend errors to fixed UI copy and enum-only diagnostic references. */
export function safeHoldingsError(value) {
  try {
    const suppliedCode = dataValue(value, 'code');
    const code = typeof suppliedCode === 'string' && Object.hasOwn(MESSAGES, suppliedCode) ? suppliedCode : 'failed';
    const diagnostic = dataValue(value, 'diagnostic');
    const stage = dataValue(diagnostic, 'stage');
    const reason = dataValue(diagnostic, 'reason');
    const validDiagnostic = typeof stage === 'string' && STAGES.has(stage)
      && typeof reason === 'string' && REASONS.has(reason)
      && (reason !== 'token_missing' || stage === 'token_exchange');
    let reference = null;
    let message = MESSAGES[code];
    if (validDiagnostic) {
      reference = `${stage}.${reason}`;
      const status = dataValue(diagnostic, 'http_status');
      if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
        reference += `.HTTP${status}`;
      }
      if (stage === 'profile' && reason === 'http_status' && status === 422) {
        reference += validationReference(diagnostic);
      }
      if (stage === 'holdings' && reason === 'http_status' && status === 422) {
        reference += holdings422Reference(diagnostic);
      }
      if (code === 'provider_failed') {
        if (stage === 'token_exchange') message = 'HDFC sign-in could not be completed. Share the reference below for help.';
        if (stage === 'profile') message = 'HDFC could not complete this request. Share the reference below for help.';
        if (stage === 'holdings') message = 'HDFC holdings could not be loaded. Share the reference below for help.';
      }
      if (code === 'unavailable' && reason === 'transport') {
        message = 'The holdings service could not be reached. Check your connection and try again.';
      }
    }
    const presentation = { code, message, reference };
    if (validDiagnostic && stage === 'holdings' && reason === 'http_status'
      && dataValue(diagnostic, 'http_status') === 422) {
      const report = safeProviderReport(optionalDataValue(diagnostic, 'provider_report'));
      if (report) {
        presentation.providerReport = report;
        presentation.providerReportText = providerReportText(report, reference);
      }
    }
    return presentation;
  } catch {
    return { code: 'failed', message: MESSAGES.failed, reference: null };
  }
}

/** Local failures have fixed references; backend input cannot create these. */
export function localHoldingsError(kind) {
  if (kind === 'callback') return { ...safeHoldingsError({ code: 'invalid_request' }), reference: 'callback.invalid' };
  if (kind === 'snapshot') return { code: 'failed', message: 'The returned holdings snapshot could not be verified. Share the reference below for help.', reference: 'snapshot.invalid' };
  if (kind === 'transport') return safeHoldingsError({ code: 'unavailable', diagnostic: { stage: 'request', reason: 'transport' } });
  if (kind === 'json') return { code: 'unavailable', message: 'The holdings service returned an unreadable response. Please try again later.', reference: 'request.json' };
  if (kind === 'shape') return { ...safeHoldingsError({ code: 'failed' }), reference: 'request.response_shape' };
  if (kind === 'configuration') return { ...safeHoldingsError({ code: 'not_configured' }), reference: 'request.configuration' };
  return safeHoldingsError(null);
}
