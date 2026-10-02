import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export const ORIGIN = 'https://alphaseeker.vercel.app';
export const COOKIE_NAME = '__Host-hdfc_holdings_phone_v2';
export const VERSION = 'holdings-phone-v2';
export const TTL_SECONDS = 600;
export const MAX_INPUT_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const ENDPOINTS = Object.freeze({
  login: 'https://developer.hdfcsec.com/oapi/v1/login',
  auth: 'https://developer.hdfcsec.com/oapi/v1/access-token',
  holdings: 'https://developer.hdfcsec.com/oapi/v1/portfolio/holdings',
});
const USER_AGENT = 'AlphaSeeker-Holdings-Phone/1.0';
const AAD = Buffer.from(`${COOKIE_NAME}|v2|${ORIGIN}`, 'utf8');
const MESSAGES = Object.freeze({
  invalid_request: 'The request is invalid. Start again.',
  method_not_allowed: 'This request method is not supported.',
  origin_not_allowed: 'The request origin is not permitted.',
  not_configured: 'Holdings sign-in is not configured yet.',
  session_invalid: 'No valid sign-in session. Start again in this browser.',
  session_expired: 'The sign-in session expired. Start again.',
  provider_failed: 'HDFC could not complete a holdings snapshot. Start again later.',
});
const DIAGNOSTIC_STAGES = new Set(['request', 'session', 'token_exchange', 'holdings']);
const DIAGNOSTIC_REASONS = new Set(['invalid', 'origin', 'configuration', 'session', 'expired', 'http_status', 'transport', 'timeout', 'response_size', 'json', 'response_shape', 'token_missing', 'snapshot_shape']);
const ERROR_FORMATS = new Set(['json', 'html', 'text', 'other', 'absent']);
const ERROR_OUTCOMES = new Set(['classified', 'unknown', 'non_json', 'invalid_json', 'invalid_utf8', 'empty', 'size', 'timeout', 'read_error']);
const ERROR_CATEGORIES = new Set(['authentication_required', 'api_key_rejected', 'access_token_rejected', 'missing_parameter', 'invalid_request', 'access_denied', 'ip_restricted', 'rate_limited', 'portfolio_unavailable', 'unprocessable_request', 'unknown']);
const VALIDATION_LOCATIONS = new Set(['header', 'query', 'body', 'path']);
const VALIDATION_FIELDS = new Set(['api_key', 'x_api_key', 'authorization', 'user_agent', 'content_type', 'access_token', 'client_id', 'client_code', 'user_id', 'request_token', 'api_secret', 'token', 'other']);
const VALIDATION_MISSING_TYPES = new Set(['missing', 'value_error.missing']);
const VALIDATION_INVALID_TYPES = new Set(['string_type', 'string_unicode', 'string_too_short', 'string_too_long', 'string_pattern_mismatch', 'int_type', 'int_parsing', 'int_from_float', 'float_type', 'float_parsing', 'finite_number', 'bool_type', 'bool_parsing', 'list_type', 'dict_type', 'literal_error', 'enum', 'extra_forbidden', 'value_error', 'type_error.str', 'type_error.integer', 'type_error.float', 'type_error.bool', 'value_error.str.regex', 'value_error.any_str.min_length', 'value_error.any_str.max_length']);
const FORMAT_FLAGS = ['api_key_has_outer_whitespace', 'token_has_whitespace', 'token_has_bearer_prefix', 'top_level_token_fields_conflict'];
const ERROR_MESSAGES = Object.freeze({
  authentication_required: ['Full authentication is required to access this resource', 'Authentication is required to access this resource', 'Authentication required', 'Unauthorized', 'authorization not provided'],
  api_key_rejected: ['Invalid API key', 'API key is invalid', 'API key is not valid', 'API key expired'],
  access_token_rejected: ['Invalid access token', 'Invalid token', 'Access token is invalid', 'Access token expired', 'Token expired', 'Invalid or expired access token', 'Invalid or expired token'],
  missing_parameter: ['Missing required parameter', 'Missing required parameters', 'Required parameter is missing', 'Required parameters are missing'],
  invalid_request: ['Bad request', 'Invalid request', 'Malformed request'],
  access_denied: ['Access denied', 'Permission denied', 'Forbidden', 'Not authorized'],
  ip_restricted: ['IP address is not whitelisted', 'IP address not whitelisted', 'IP not allowed', 'IP address is not allowed', 'IP restricted', 'Unauthorized IP address'],
  rate_limited: ['Too many requests', 'Rate limit exceeded', 'Request limit exceeded'],
  portfolio_unavailable: ['Portfolio holding is null', 'Your Portfolio Holding is Null', 'No portfolio holdings'],
  unprocessable_request: ['Unprocessable entity', 'Unprocessable request'],
});
const MESSAGE_CATEGORIES = new Map(Object.entries(ERROR_MESSAGES).flatMap(([category, messages]) => messages.map(message => [message.toLowerCase(), category])));
const ERROR_MESSAGE_FIELDS = ['message', 'Message', 'MESSAGE', 'msg', 'Msg', 'MSG', 'errorMessage', 'ErrorMessage', 'error_message', 'ERROR_MESSAGE', 'errorMsg', 'error_msg', 'displayMessage', 'DisplayMessage', 'display_message', 'displaymessage', 'status_error', 'statusMsg', 'statusMessage', 'description', 'detail', 'error', 'Error', 'ERROR'];
const ERROR_CODE_FIELDS = ['code', 'Code', 'CODE', 'errorCode', 'ErrorCode', 'error_code', 'ERROR_CODE', 'errorcode', 'statusCode'];
export const PROVIDER_ERROR_PATH_SEGMENTS = Object.freeze(['root', 'meta', 'error', 'errors', 'error_response', 'data', 'detail', 'response', 'message', 'code', 'status', 'other', 'items']);
export const PROVIDER_ERROR_TYPES = Object.freeze(['null', 'string', 'number', 'boolean', 'object', 'array']);
export const PROVIDER_ERROR_TERMS = Object.freeze(['api_key', 'api_secret', 'access_token', 'request_token', 'authorization', 'user', 'client', 'account', 'application', 'ip', 'static_ip', 'redirect', 'holdings', 'portfolio', 'subscription', 'plan', 'permission', 'scope', 'signature', 'checksum', 'timestamp', 'version', 'parameter', 'missing', 'required', 'invalid', 'expired', 'rejected', 'denied', 'not', 'allowed', 'whitelisted', 'registered', 'activated', 'mapped', 'matched', 'found', 'disabled', 'enabled', 'entitled', 'configured', 'empty', 'null', 'success', 'failure']);
const REPORT_CONTAINERS = new Set(['meta', 'error', 'errors', 'error_response', 'data', 'detail', 'response']);
const IDENTIFIER_KEYS = new Set(['isin', 'symbol', 'securityid', 'accountid', 'accountnumber', 'accountno', 'customerid', 'clientid', 'clientcode', 'clientnumber', 'userid', 'client', 'user', 'account', 'pan', 'phone', 'mobile', 'email']);
const GENERIC_CODE_FIELDS = new Set(['code', 'Code', 'CODE']);
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_ERROR_MS = 2000;
const DEFAULT_DIAGNOSTICS = Object.freeze({
  invalid_request: { stage: 'request', reason: 'invalid' },
  method_not_allowed: { stage: 'request', reason: 'invalid' },
  origin_not_allowed: { stage: 'request', reason: 'origin' },
  not_configured: { stage: 'request', reason: 'configuration' },
  session_invalid: { stage: 'session', reason: 'session' },
  session_expired: { stage: 'session', reason: 'expired' },
});

export class FlowError extends Error {
  constructor(code, status = 400, diagnostic = DEFAULT_DIAGNOSTICS[code]) {
    super(MESSAGES[code] || MESSAGES.provider_failed);
    this.code = code;
    this.status = status;
    const stage = dataValue(diagnostic, 'stage');
    const reason = dataValue(diagnostic, 'reason');
    const httpStatus = dataValue(diagnostic, 'http_status');
    this.diagnostic = { stage: DIAGNOSTIC_STAGES.has(stage) ? stage : 'request', reason: DIAGNOSTIC_REASONS.has(reason) ? reason : 'invalid' };
    if (this.diagnostic.reason === 'http_status' && Number.isInteger(httpStatus)
      && httpStatus >= 100 && httpStatus <= 599) this.diagnostic.http_status = httpStatus;
    if (this.diagnostic.stage === 'holdings' && this.diagnostic.reason === 'http_status' && httpStatus === 422) {
      copyErrorDiagnostic(this.diagnostic, diagnostic);
    }
  }
}

// Diagnostics never execute getters, coerce provider values or copy arbitrary keys.
function dataValue(record, key) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch { return undefined; }
}

function arrayValues(value, maximum) {
  try {
    if (!Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype && prototype !== null) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    const values = [];
    for (let index = 0; index < Math.min(length, maximum); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, `${index}`);
      values.push(descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined);
    }
    return { length, values };
  } catch { return null; }
}

function canonicalValidation(value) {
  const issues = arrayValues(value, 8);
  const accepted = [];
  const seen = new Set();
  for (const issue of issues?.values || []) {
    const location = dataValue(issue, 'location');
    const field = dataValue(issue, 'field');
    const kind = dataValue(issue, 'kind');
    if (!VALIDATION_LOCATIONS.has(location) || !VALIDATION_FIELDS.has(field) || !['missing', 'invalid'].includes(kind)) continue;
    const key = `${location}.${field}.${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({ location, field, kind });
  }
  return accepted;
}

function copyErrorDiagnostic(target, source) {
  const format = dataValue(source, 'response_format');
  const outcome = dataValue(source, 'error_outcome');
  const category = dataValue(source, 'error_category');
  if (ERROR_FORMATS.has(format)) target.response_format = format;
  if (ERROR_OUTCOMES.has(outcome)) target.error_outcome = outcome;
  if (ERROR_CATEGORIES.has(category)) target.error_category = category;
  if (dataValue(source, 'provider_code') === '60014') target.provider_code = '60014';
  const validation = canonicalValidation(dataValue(source, 'validation'));
  if (validation.length) target.validation = validation;
  const report = canonicalProviderReport(dataValue(source, 'provider_report'));
  if (report) target.provider_report = report;
  if (category === 'unknown' && !target.provider_code && !validation.length
    && ERROR_OUTCOMES.has(outcome) && outcome !== 'classified') {
    const suppliedFlags = dataValue(source, 'format_flags');
    const flags = {};
    for (const name of FORMAT_FLAGS) {
      const flag = dataValue(suppliedFlags, name);
      if (typeof flag === 'boolean') flags[name] = flag;
    }
    if (Object.keys(flags).length) target.format_flags = flags;
  }
}

function canonicalProviderReport(value) {
  if (dataValue(value, 'version') !== 1) return null;
  const codes = arrayValues(dataValue(value, 'provider_codes'), 4);
  const schema = arrayValues(dataValue(value, 'error_schema'), 16);
  const terms = arrayValues(dataValue(value, 'message_terms'), 24);
  if (!codes || codes.length > 4 || !schema || schema.length > 16 || !terms || terms.length > 24) return null;
  if (codes.values.some(code => typeof code !== 'string' || !/^[0-9]{1,6}$/u.test(code)) || new Set(codes.values).size !== codes.length) return null;
  const cleanSchema = [];
  const seen = new Set();
  for (const item of schema.values) {
    const path = dataValue(item, 'path');
    const type = dataValue(item, 'type');
    if (typeof path !== 'string' || path.length > 95 || !PROVIDER_ERROR_TYPES.includes(type)) return null;
    const segments = path.split('.');
    if (segments.length > 6 || segments[0] !== 'root' || segments.slice(1).includes('root') || segments.some(segment => !PROVIDER_ERROR_PATH_SEGMENTS.includes(segment))) return null;
    const key = `${path}:${type}`;
    if (seen.has(key)) return null;
    seen.add(key);
    cleanSchema.push({ path, type });
  }
  let previous = -1;
  for (const term of terms.values) {
    const index = PROVIDER_ERROR_TERMS.indexOf(term);
    if (index <= previous) return null;
    previous = index;
  }
  return { version: 1, provider_codes: [...codes.values], error_schema: cleanSchema, message_terms: [...terms.values] };
}

function identifierKey(key) { return IDENTIFIER_KEYS.has(key.toLowerCase().replace(/[_-]/gu, '')); }

// The bounded body is parsed privately, then every scalar/key is sanitized before
// classification. This also handles JSON Unicode escapes without corrupting JSON.
function sanitizeProviderPayload(payload, runtimeSecrets) {
  const identifiers = [];
  const pending = [payload];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (identifierKey(key) && (typeof child === 'string' || typeof child === 'number')) identifiers.push(String(child));
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  const privateValues = [...new Set([...runtimeSecrets, ...identifiers].filter(value => typeof value === 'string' && value.length > 0))];
  const forbiddenCodes = new Set(privateValues);
  for (const value of privateValues) if (/^[0-9]+$/u.test(value)) forbiddenCodes.add(String(Number(value)));
  const variants = [...new Set(privateValues.flatMap(value => {
    const form = new URLSearchParams({ value }).toString().slice(6);
    return [value, encodeURIComponent(value), encodeURI(value), form, JSON.stringify(value).slice(1, -1)];
  }))].sort((left, right) => right.length - left.length);
  const scrub = supplied => {
    let text = supplied;
    for (let pass = 0; pass < 3; pass += 1) {
      for (const variant of variants) text = text.replaceAll(variant, '[redacted]');
      text = text.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/giu, '[redacted]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted]')
        .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/gu, '[redacted]')
        .replace(/\b[A-Z]{2}[A-Z0-9]{9}[0-9]\b/giu, '[redacted]')
        .replace(/(?:\+?91[\s-]?)?\b[6-9][0-9]{9}\b/gu, '[redacted]')
        .replace(/\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, '[redacted]');
      if (pass < 2 && /%[0-9a-f]{2}/iu.test(text)) {
        try { text = decodeURIComponent(text.replaceAll('+', ' ')); } catch { /* Keep already sanitized text. */ }
      }
    }
    return text;
  };
  const scalar = value => typeof value === 'string' ? scrub(value)
    : typeof value === 'number' && forbiddenCodes.has(String(value)) ? null : value;
  if (!payload || typeof payload !== 'object') return { payload: scalar(payload), forbiddenCodes };
  const sanitized = Array.isArray(payload) ? [] : Object.create(null);
  const work = [[payload, sanitized]];
  while (work.length) {
    const [original, target] = work.pop();
    for (const key of Object.keys(original)) {
      const safeKey = Array.isArray(original) ? key : scrub(key);
      const child = original[key];
      if (child && typeof child === 'object') {
        const copy = Array.isArray(child) ? [] : Object.create(null);
        target[safeKey] = copy;
        work.push([child, copy]);
      } else target[safeKey] = scalar(child);
    }
  }
  return { payload: sanitized, forbiddenCodes };
}

function providerReport(payload, forbiddenCodes) {
  const codes = new Set();
  const schema = [];
  const schemaKeys = new Set();
  const foundTerms = new Set();
  const queue = [{ value: payload, path: ['root'], depth: 0 }];
  let nodes = 0;
  const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const addSchema = (path, value) => {
    const type = typeOf(value);
    const name = path.join('.');
    const key = `${name}:${type}`;
    if (schema.length < 16 && path.length <= 6 && PROVIDER_ERROR_TYPES.includes(type) && !schemaKeys.has(key)) {
      schemaKeys.add(key); schema.push({ path: name, type });
    }
  };
  const addTerms = value => {
    if (typeof value !== 'string') return;
    const text = value.toLowerCase().replace(/[_-]/gu, ' ');
    for (const term of PROVIDER_ERROR_TERMS) {
      const phrase = term === 'holdings' ? 'holdings?' : term.replaceAll('_', '[\\s_-]+');
      if (new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`, 'u').test(text)) foundTerms.add(term);
    }
  };
  while (queue.length && nodes < 64) {
    const { value, path, depth } = queue.shift();
    nodes += 1;
    addSchema(path, value);
    if (typeof value === 'string') { if (path.length === 1) addTerms(value); continue; }
    if (!value || typeof value !== 'object' || depth >= 4) continue;
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 4)) queue.push({ value: child, path: [...path, 'items'], depth: depth + 1 });
      continue;
    }
    const keys = Object.keys(value);
    const identifying = keys.some(identifierKey);
    const status = dataValue(value, 'status');
    const errorContext = path.some(segment => ['error', 'errors', 'error_response'].includes(segment))
      || (path.length === 1 && typeof status === 'string' && ['error', 'failure'].includes(status.toLowerCase()))
      || ERROR_MESSAGE_FIELDS.some(key => typeof dataValue(value, key) === 'string');
    for (const key of keys) {
      if (nodes >= 64) break;
      nodes += 1;
      const child = dataValue(value, key);
      const segment = REPORT_CONTAINERS.has(key) ? key : ERROR_MESSAGE_FIELDS.includes(key) ? 'message'
        : ERROR_CODE_FIELDS.includes(key) ? 'code' : key === 'status' ? 'status' : 'other';
      const childPath = [...path, segment];
      addSchema(childPath, child);
      if (ERROR_MESSAGE_FIELDS.includes(key)) addTerms(child);
      if (!identifying && ERROR_CODE_FIELDS.includes(key) && (!GENERIC_CODE_FIELDS.has(key) || (errorContext && (child === '60014' || child === 60014)))
        && (typeof child === 'string' || (typeof child === 'number' && Number.isSafeInteger(child)))) {
        const code = String(child);
        if (/^[0-9]{1,6}$/u.test(code) && !forbiddenCodes.has(code) && codes.size < 4) codes.add(code);
      }
      if (REPORT_CONTAINERS.has(key) && child && typeof child === 'object') queue.push({ value: child, path: childPath, depth: depth + 1 });
    }
  }
  return { version: 1, provider_codes: [...codes], error_schema: schema, message_terms: PROVIDER_ERROR_TERMS.filter(term => foundTerms.has(term)).slice(0, 24) };
}

function validationDetails(records) {
  const accepted = [];
  const seen = new Set();
  let remaining = 32;
  for (const record of records) {
    const detail = arrayValues(dataValue(record, 'detail'), remaining);
    remaining -= detail?.values.length || 0;
    for (const issue of detail?.values || []) {
      const loc = arrayValues(dataValue(issue, 'loc'), 8);
      const type = dataValue(issue, 'type');
      const kind = VALIDATION_MISSING_TYPES.has(type) ? 'missing' : VALIDATION_INVALID_TYPES.has(type) ? 'invalid' : null;
      if (!kind || !loc || loc.length < 1 || loc.length > 8 || !VALIDATION_LOCATIONS.has(loc.values[0])
        || loc.values.some(part => !(typeof part === 'string' && validText(part, 128)) && !(Number.isSafeInteger(part) && part >= 0))) continue;
      const location = loc.values[0];
      let field = 'other';
      if (loc.length === 2 && typeof loc.values[1] === 'string') {
        let supplied = location === 'header' ? loc.values[1].toLowerCase() : loc.values[1];
        if (location === 'header') {
          if (supplied === 'user-agent') supplied = 'user_agent';
          if (supplied === 'content-type') supplied = 'content_type';
          if (supplied === 'x-api-key') supplied = 'x_api_key';
        }
        if (VALIDATION_FIELDS.has(supplied)) field = supplied;
      }
      const key = `${location}.${field}.${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      accepted.push({ location, field, kind });
      if (accepted.length === 8) return accepted;
    }
    if (remaining === 0) break;
  }
  return accepted;
}

function messageCategory(value) {
  if (typeof value !== 'string' || value.length > 1024) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ').replace(/[.!?]+$/u, '').trim().toLowerCase();
  return MESSAGE_CATEGORIES.get(normalized) || null;
}

function classifyErrorPayload(payload) {
  const categories = new Set();
  const records = [];
  let providerCode;
  const directCategory = messageCategory(payload);
  if (directCategory) categories.add(directCategory);
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    records.push(payload);
    for (const name of ['error', 'data']) {
      const child = dataValue(payload, name);
      if (child && typeof child === 'object' && !Array.isArray(child)) records.push(child);
    }
    for (const name of ['errors', 'data']) records.push(...(arrayValues(dataValue(payload, name), 8)?.values || []));
  } else if (Array.isArray(payload)) records.push(...(arrayValues(payload, 8)?.values || []));
  for (const record of records) {
    for (const name of ERROR_MESSAGE_FIELDS) {
      const category = messageCategory(dataValue(record, name));
      if (category) categories.add(category);
    }
    for (const name of ERROR_CODE_FIELDS) {
      const code = dataValue(record, name);
      if (code === '60014' || code === 60014) providerCode = '60014';
    }
  }
  const validation = validationDetails(records);
  const category = categories.size === 1 ? [...categories][0] : 'unknown';
  const diagnostic = { error_outcome: providerCode || validation.length || category !== 'unknown' ? 'classified' : 'unknown', error_category: category };
  if (providerCode) diagnostic.provider_code = providerCode;
  if (validation.length) diagnostic.validation = validation;
  return diagnostic;
}

function responseFormat(response) {
  try {
    const type = response.headers?.get('content-type');
    if (typeof type !== 'string' || !type.trim()) return 'absent';
    const essence = type.split(';', 1)[0].trim().toLowerCase();
    if (essence === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(essence)) return 'json';
    if (essence === 'text/html') return 'html';
    if (essence === 'text/plain') return 'text';
    return 'other';
  } catch { return 'absent'; }
}

async function readHoldingsError(response, existingSignal, redactionSecrets) {
  const diagnostic = { response_format: responseFormat(response), error_outcome: 'read_error', error_category: 'unknown', provider_report: { version: 1, provider_codes: [], error_schema: [], message_terms: [] } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAX_ERROR_MS);
  const signal = AbortSignal.any([existingSignal, controller.signal]);
  let reader;
  try {
    if (!response.body) return diagnostic;
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let emptyReads = 0;
    while (true) {
      const chunk = await withSignal(reader.read(), signal, 'holdings');
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) return diagnostic;
      if (chunk.value.byteLength === 0) {
        emptyReads += 1;
        if (emptyReads > 32) return diagnostic;
        continue;
      }
      total += chunk.value.byteLength;
      if (total > MAX_ERROR_BYTES) return { ...diagnostic, error_outcome: 'size' };
      chunks.push(Buffer.from(chunk.value));
    }
    if (signal.aborted) return { ...diagnostic, error_outcome: 'timeout' };
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)); }
    catch { return { ...diagnostic, error_outcome: 'invalid_utf8' }; }
    if (!text.trim()) return { ...diagnostic, error_outcome: 'empty' };
    let payload;
    try { payload = JSON.parse(text); }
    catch {
      const sanitized = sanitizeProviderPayload(text, redactionSecrets);
      const category = messageCategory(sanitized.payload);
      return { ...diagnostic, error_outcome: category ? 'classified' : diagnostic.response_format === 'json' ? 'invalid_json' : 'non_json', error_category: category || 'unknown', provider_report: providerReport(sanitized.payload, sanitized.forbiddenCodes) };
    }
    const sanitized = sanitizeProviderPayload(payload, redactionSecrets);
    return { response_format: diagnostic.response_format, ...classifyErrorPayload(sanitized.payload), provider_report: providerReport(sanitized.payload, sanitized.forbiddenCodes) };
  } catch {
    return { ...diagnostic, error_outcome: signal.aborted ? 'timeout' : 'read_error' };
  } finally {
    clearTimeout(timer);
    if (reader) {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Optional cancellation cannot delay or replace HTTP422. */ }
    }
  }
}

function validText(value, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function configFrom(env) {
  const key = env.HDFC_API_KEY;
  const secret = env.HDFC_API_SECRET;
  if (!validText(key, 8192) || !key.trim() || !validText(secret, 8192) || !secret.trim()) return null;
  return { key, secret };
}

function deriveKey(secret, label) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(ORIGIN, 'utf8'), Buffer.from(`hdfc-holdings-phone-v2:${label}`, 'utf8'), 32));
}

function applicationDigest(config) {
  return createHmac('sha256', deriveKey(config.secret, 'application-binding')).update(config.key, 'utf8').digest();
}

export function sealSession(config, nowMilliseconds) {
  const issued = Math.floor(nowMilliseconds / 1000);
  const payload = { v: 2, app: applicationDigest(config).toString('hex'), nonce: randomBytes(16).toString('hex'), iat: issued, exp: issued + TTL_SECONDS };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(config.secret, 'session-cookie'), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { cookie: `v2.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function openSession(value, config, nowMilliseconds) {
  if (!validText(value, 1024) || !/^v2\.[A-Za-z0-9_-]+$/u.test(value)) throw new FlowError('session_invalid', 401);
  let payload;
  try {
    const packed = Buffer.from(value.slice(3), 'base64url');
    if (packed.length < 29 || packed.toString('base64url') !== value.slice(3)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(config.secret, 'session-cookie'), packed.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(packed.subarray(12, 28));
    payload = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    throw new FlowError('session_invalid', 401);
  }
  const now = Math.floor(nowMilliseconds / 1000);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 5
    || payload.v !== 2 || !/^[a-f0-9]{64}$/u.test(payload.app || '') || !/^[a-f0-9]{32}$/u.test(payload.nonce || '')
    || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
    || payload.iat < 0 || payload.iat > now || payload.exp - payload.iat !== TTL_SECONDS) throw new FlowError('session_invalid', 401);
  if (payload.exp <= now) throw new FlowError('session_expired', 410);
  if (!timingSafeEqual(Buffer.from(payload.app, 'hex'), applicationDigest(config))) throw new FlowError('session_invalid', 401);
  return payload;
}

function cookieHeader(value, maximumAge) {
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maximumAge}; Secure; HttpOnly; SameSite=Lax`;
}

function readCookie(header) {
  if (typeof header !== 'string' || header.length > 8192) throw new FlowError('session_invalid', 401);
  const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) throw new FlowError('session_invalid', 401);
  return values[0].slice(COOKIE_NAME.length + 1);
}

function numeric(value, required = false) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    if (!required) return null;
    throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'snapshot_shape' });
  }
  if (!['number', 'string'].includes(typeof value)
    || (typeof value === 'string' && !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim()))) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'snapshot_shape' });
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'snapshot_shape' });
  return result;
}

export function normalizeHoldings(payload, nowMilliseconds) {
  if (!payload || payload.status !== 'success' || !Array.isArray(payload.data)) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'response_shape' });
  if (payload.data.length > 5000) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'response_size' });
  const holdings = payload.data.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !validText(row.isin, 32) || !row.isin.trim()) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'snapshot_shape' });
    const normalized = { isin: row.isin, quantity: numeric(row.quantity, true) };
    for (const field of ['company_name', 'security_id', 'exchange']) {
      const value = row[field];
      if (value != null && typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'snapshot_shape' });
      const text = value == null ? '' : String(value);
      if (text !== '' && !validText(text, 240)) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'snapshot_shape' });
      normalized[field] = text;
    }
    for (const field of ['average_price', 'investment_value', 'close_price']) normalized[field] = numeric(row[field]);
    return normalized;
  });
  const snapshot = { snapshot_version: 2, source: 'HDFC InvestRight', as_of_utc: new Date(nowMilliseconds).toISOString(), account_authenticated: true, identity_verification: 'broker_authentication', holdings_count: holdings.length, holdings };
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_RESPONSE_BYTES) throw new FlowError('provider_failed', 502, { stage: 'holdings', reason: 'response_size' });
  return snapshot;
}

async function withSignal(promise, signal, stage) {
  if (signal.aborted) throw new FlowError('provider_failed', 502, { stage, reason: 'timeout' });
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(new FlowError('provider_failed', 502, { stage, reason: 'timeout' }));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

async function providerJson(fetchImpl, method, endpoint, config, { accessToken, requestToken, overallSignal, requestTimeoutMs, formatFlags, redactionSecrets }) {
  const stage = endpoint === ENDPOINTS.auth ? 'token_exchange' : 'holdings';
  const allowed = (method === 'POST' && endpoint === ENDPOINTS.auth) || (method === 'GET' && endpoint === ENDPOINTS.holdings);
  if (!allowed) throw new FlowError('provider_failed', 502);
  const url = new URL(endpoint);
  url.searchParams.set('api_key', config.key);
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  const options = { method, headers, redirect: 'error', cache: 'no-store' };
  if (accessToken !== undefined) {
    if (!validText(accessToken, 8192)) throw new FlowError('provider_failed', 502, { stage, reason: 'response_shape' });
    headers.Authorization = accessToken;
  }
  if (endpoint === ENDPOINTS.auth) {
    url.searchParams.set('request_token', requestToken);
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({ apiSecret: config.secret });
  }
  options.signal = AbortSignal.any([overallSignal, AbortSignal.timeout(requestTimeoutMs)]);
  let reader;
  try {
    const response = await withSignal(fetchImpl(url.toString(), options), options.signal, stage);
    if (response.status !== 200 && !(endpoint === ENDPOINTS.holdings && response.status === 201)) {
      const diagnostic = { stage, reason: 'http_status', http_status: response.status };
      if (endpoint === ENDPOINTS.holdings && method === 'GET' && response.status === 422) {
        const details = await readHoldingsError(response, options.signal, redactionSecrets);
        copyErrorDiagnostic(diagnostic, details);
        if (diagnostic.error_category === 'unknown' && !diagnostic.provider_code && !diagnostic.validation
          && diagnostic.error_outcome !== 'classified') diagnostic.format_flags = formatFlags;
      }
      throw new FlowError('provider_failed', 502, diagnostic);
    }
    if (!response.body) throw new FlowError('provider_failed', 502, { stage, reason: 'response_shape' });
    reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = await withSignal(reader.read(), options.signal, stage);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new FlowError('provider_failed', 502, { stage, reason: 'response_size' });
      chunks.push(Buffer.from(chunk.value));
    }
    let payload;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)));
    } catch {
      throw new FlowError('provider_failed', 502, { stage, reason: 'json' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new FlowError('provider_failed', 502, { stage, reason: 'response_shape' });
    return payload;
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError('provider_failed', 502, { stage, reason: options.signal.aborted ? 'timeout' : 'transport' });
  } finally {
    if (reader) {
      try { void reader.cancel().catch(() => {}); } catch { /* Cancellation cannot delay the bounded response. */ }
    }
  }
}

async function readBody(req) {
  const contentType = req.headers?.['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new FlowError('invalid_request', 415);
  let body;
  try {
    if (req.body !== undefined) {
      const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) throw new FlowError('invalid_request', 413);
      body = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(raw);
    } else {
      const parts = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > MAX_INPUT_BYTES) throw new FlowError('invalid_request', 413);
        parts.push(Buffer.from(chunk));
      }
      body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    }
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError('invalid_request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FlowError('invalid_request');
  return body;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function createHoldingsPhoneHandler({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, requestTimeoutMs = 20_000, callbackTimeoutMs = 50_000 } = {}) {
  return async function handler(req, res) {
    for (const [name, value] of Object.entries({ 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })) res.setHeader(name, value);
    try {
      const url = new URL(req.url || '/api/holdings-phone', ORIGIN);
      const query = [...url.searchParams];
      const config = configFrom(env);
      if (req.method === 'GET') {
        if (query.length > 1 || (query.length === 1 && (query[0][0] !== 'action' || query[0][1] !== 'health'))) throw new FlowError('invalid_request');
        send(res, 200, { version: VERSION, configured: config !== null, diagnostics_version: 1, holdings_diagnostics_version: 1, provider_error_report_version: 1, auth_method: 'token_exchange', holdings_method: 'GET', holdings_auth_mode: 'raw_token', profile_verification: false });
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new FlowError('method_not_allowed', 405);
      }
      if (query.length !== 0) throw new FlowError('invalid_request');
      if (req.headers?.origin !== ORIGIN) throw new FlowError('origin_not_allowed', 403);
      const body = await readBody(req);
      const actions = { start: ['action'], callback: ['action', 'request_token'], clear: ['action'] };
      if (typeof body.action !== 'string' || !Object.hasOwn(actions, body.action)) throw new FlowError('invalid_request');
      const fields = actions[body.action];
      if (Object.keys(body).some(key => !fields.includes(key))) throw new FlowError('invalid_request');
      if (body.action === 'clear') {
        res.setHeader('Set-Cookie', cookieHeader('', 0));
        send(res, 200, { cleared: true });
        return;
      }
      if (body.action === 'callback') res.setHeader('Set-Cookie', cookieHeader('', 0));
      if (!config) throw new FlowError('not_configured', 503);
      if (body.action === 'start') {
        const session = sealSession(config, now());
        res.setHeader('Set-Cookie', cookieHeader(session.cookie, TTL_SECONDS));
        const login = new URL(ENDPOINTS.login);
        login.searchParams.set('api_key', config.key);
        send(res, 200, { login_url: login.toString(), expires_at: session.expiresAt });
        return;
      }
      if (body.action !== 'callback') throw new FlowError('invalid_request');
      if (!validText(body.request_token, 8192)) throw new FlowError('invalid_request');
      const session = openSession(readCookie(req.headers?.cookie), config, now());
      const overallSignal = AbortSignal.timeout(callbackTimeoutMs);
      let accessToken;
      try {
        const auth = await providerJson(fetchImpl, 'POST', ENDPOINTS.auth, config, { requestToken: body.request_token, overallSignal, requestTimeoutMs });
        accessToken = auth.accessToken || auth.access_token;
        if (![undefined, 'success'].includes(auth.status)) throw new FlowError('provider_failed', 502, { stage: 'token_exchange', reason: 'response_shape' });
        if (accessToken == null || accessToken === '') throw new FlowError('provider_failed', 502, { stage: 'token_exchange', reason: 'token_missing' });
        if (!validText(accessToken, 8192) || !accessToken.trim()) throw new FlowError('provider_failed', 502, { stage: 'token_exchange', reason: 'response_shape' });
        if (session.exp <= Math.floor(now() / 1000)) throw new FlowError('session_expired', 410);
        const camelToken = dataValue(auth, 'accessToken');
        const snakeToken = dataValue(auth, 'access_token');
        const formatFlags = {
          api_key_has_outer_whitespace: config.key !== config.key.trim(),
          token_has_whitespace: /\s/u.test(accessToken),
          token_has_bearer_prefix: /^Bearer(?:\s|$)/iu.test(accessToken),
          top_level_token_fields_conflict: validText(camelToken, 8192) && !!camelToken.trim()
            && validText(snakeToken, 8192) && !!snakeToken.trim() && camelToken !== snakeToken,
        };
        const redactionSecrets = [config.key, config.secret, body.request_token, camelToken, snakeToken];
        const holdings = await providerJson(fetchImpl, 'GET', ENDPOINTS.holdings, config, { accessToken, overallSignal, requestTimeoutMs, formatFlags, redactionSecrets });
        if (session.exp <= Math.floor(now() / 1000)) throw new FlowError('session_expired', 410);
        send(res, 200, normalizeHoldings(holdings, now()));
      } finally {
        accessToken = undefined;
        delete body.request_token;
      }
    } catch (error) {
      const safe = error instanceof FlowError ? error : new FlowError('provider_failed', 502);
      send(res, safe.status, { error: { code: safe.code, message: safe.message, diagnostic: safe.diagnostic } });
    }
  };
}
