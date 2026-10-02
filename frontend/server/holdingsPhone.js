import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export const ORIGIN = 'https://alphaseeker.vercel.app';
export const COOKIE_NAME = '__Host-hdfc_holdings_phone_v1';
export const VERSION = 'holdings-phone-v1';
export const TTL_SECONDS = 600;
export const MAX_INPUT_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const ENDPOINTS = Object.freeze({
  login: 'https://developer.hdfcsec.com/oapi/v1/login',
  auth: 'https://developer.hdfcsec.com/oapi/v1/access-token',
  profile: 'https://developer.hdfcsec.com/oapi/v3/user/profile',
  holdings: 'https://developer.hdfcsec.com/oapi/v1/portfolio/holdings',
});
const USER_AGENT = 'AlphaSeeker-Holdings-Phone/1.0';
const AAD = Buffer.from(`${COOKIE_NAME}|v1|${ORIGIN}`, 'utf8');
const MESSAGES = Object.freeze({
  invalid_request: 'The request is invalid. Start again.',
  method_not_allowed: 'This request method is not supported.',
  origin_not_allowed: 'The request origin is not permitted.',
  not_configured: 'Holdings sign-in is not configured yet.',
  account_mismatch: 'The HDFC account does not match the configured owner.',
  session_invalid: 'No valid sign-in session. Start again in this browser.',
  session_expired: 'The sign-in session expired. Start again.',
  provider_failed: 'HDFC could not complete a verified holdings snapshot. Start again later.',
});
const DIAGNOSTIC_STAGES = new Set(['request', 'session', 'token_exchange', 'profile', 'holdings']);
const DIAGNOSTIC_REASONS = new Set(['invalid', 'origin', 'configuration', 'session', 'expired', 'owner_mismatch', 'http_status', 'transport', 'timeout', 'response_size', 'json', 'response_shape', 'token_missing', 'identity_shape', 'snapshot_shape']);
const DEFAULT_DIAGNOSTICS = Object.freeze({
  invalid_request: { stage: 'request', reason: 'invalid' },
  method_not_allowed: { stage: 'request', reason: 'invalid' },
  origin_not_allowed: { stage: 'request', reason: 'origin' },
  not_configured: { stage: 'request', reason: 'configuration' },
  account_mismatch: { stage: 'profile', reason: 'owner_mismatch' },
  session_invalid: { stage: 'session', reason: 'session' },
  session_expired: { stage: 'session', reason: 'expired' },
});

export class FlowError extends Error {
  constructor(code, status = 400, diagnostic = DEFAULT_DIAGNOSTICS[code]) {
    super(MESSAGES[code] || MESSAGES.provider_failed);
    this.code = code;
    this.status = status;
    this.diagnostic = {
      stage: DIAGNOSTIC_STAGES.has(diagnostic?.stage) ? diagnostic.stage : 'request',
      reason: DIAGNOSTIC_REASONS.has(diagnostic?.reason) ? diagnostic.reason : 'invalid',
    };
    if (this.diagnostic.reason === 'http_status' && Number.isInteger(diagnostic?.http_status)
      && diagnostic.http_status >= 100 && diagnostic.http_status <= 599) this.diagnostic.http_status = diagnostic.http_status;
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

function normalizeIdentity(value) {
  if (!validText(value, 80) || !value.trim()) throw new FlowError('invalid_request');
  return value.trim().toUpperCase();
}

function configFrom(env) {
  const key = env.HDFC_API_KEY;
  const secret = env.HDFC_API_SECRET;
  const owner = env.HDFC_ALLOWED_USER_ID;
  if (!validText(key, 8192) || !key.trim() || !validText(secret, 8192) || !secret.trim() || !validText(owner, 80) || !owner.trim()) return null;
  return { key, secret, owner: normalizeIdentity(owner) };
}

function deriveKey(secret, label) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(ORIGIN, 'utf8'), Buffer.from(`hdfc-holdings-phone-v1:${label}`, 'utf8'), 32));
}

function identityDigest(value, config) {
  return createHmac('sha256', deriveKey(config.secret, 'account-identity')).update(normalizeIdentity(value), 'utf8').digest();
}

function matchesOwner(value, config) {
  return timingSafeEqual(identityDigest(value, config), identityDigest(config.owner, config));
}

export function sealSession(config, nowMilliseconds) {
  const issued = Math.floor(nowMilliseconds / 1000);
  const payload = { v: 1, owner: identityDigest(config.owner, config).toString('hex'), nonce: randomBytes(16).toString('hex'), iat: issued, exp: issued + TTL_SECONDS };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(config.secret, 'session-cookie'), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { cookie: `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function openSession(value, config, nowMilliseconds) {
  if (!validText(value, 1024) || !/^v1\.[A-Za-z0-9_-]+$/u.test(value)) throw new FlowError('session_invalid', 401);
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
    || payload.v !== 1 || !/^[a-f0-9]{64}$/u.test(payload.owner || '') || !/^[a-f0-9]{32}$/u.test(payload.nonce || '')
    || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
    || payload.iat < 0 || payload.iat > now || payload.exp - payload.iat !== TTL_SECONDS) throw new FlowError('session_invalid', 401);
  if (payload.exp <= now) throw new FlowError('session_expired', 410);
  if (!timingSafeEqual(Buffer.from(payload.owner, 'hex'), identityDigest(config.owner, config))) throw new FlowError('session_invalid', 401);
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
  const snapshot = { snapshot_version: 1, source: 'HDFC InvestRight', as_of_utc: new Date(nowMilliseconds).toISOString(), account_verified: true, holdings_count: holdings.length, holdings };
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

async function providerJson(fetchImpl, method, endpoint, config, { accessToken, requestToken, overallSignal, requestTimeoutMs }) {
  const stage = endpoint === ENDPOINTS.auth ? 'token_exchange' : endpoint === ENDPOINTS.profile ? 'profile' : 'holdings';
  const allowed = (method === 'POST' && endpoint === ENDPOINTS.auth) || (method === 'GET' && [ENDPOINTS.profile, ENDPOINTS.holdings].includes(endpoint));
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
    if (response.status !== 200) throw new FlowError('provider_failed', 502, { stage, reason: 'http_status', http_status: response.status });
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
        send(res, 200, { version: VERSION, configured: config !== null, diagnostics_version: 1, profile_method: 'GET' });
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new FlowError('method_not_allowed', 405);
      }
      if (query.length !== 0) throw new FlowError('invalid_request');
      if (req.headers?.origin !== ORIGIN) throw new FlowError('origin_not_allowed', 403);
      const body = await readBody(req);
      const actions = { start: ['action', 'expected_user_id'], callback: ['action', 'request_token'], clear: ['action'] };
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
        if (!matchesOwner(body.expected_user_id, config)) throw new FlowError('account_mismatch', 403, { stage: 'request', reason: 'owner_mismatch' });
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
        if (!validText(accessToken, 8192)) throw new FlowError('provider_failed', 502, { stage: 'token_exchange', reason: 'response_shape' });
        if (session.exp <= Math.floor(now() / 1000)) throw new FlowError('session_expired', 410);
        const profile = await providerJson(fetchImpl, 'GET', ENDPOINTS.profile, config, { accessToken, overallSignal, requestTimeoutMs });
        if (profile.status !== 'success' || !Array.isArray(profile.data) || profile.data.length !== 1 || !profile.data[0] || typeof profile.data[0] !== 'object') throw new FlowError('provider_failed', 502, { stage: 'profile', reason: 'response_shape' });
        const userId = profile.data[0].user_id;
        if (!(typeof userId === 'string' || (typeof userId === 'number' && Number.isSafeInteger(userId)))
          || !validText(String(userId), 80) || !String(userId).trim()) throw new FlowError('provider_failed', 502, { stage: 'profile', reason: 'identity_shape' });
        if (!matchesOwner(String(userId), config)) throw new FlowError('account_mismatch', 403);
        if (session.exp <= Math.floor(now() / 1000)) throw new FlowError('session_expired', 410);
        const holdings = await providerJson(fetchImpl, 'GET', ENDPOINTS.holdings, config, { accessToken, overallSignal, requestTimeoutMs });
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
