const CALLBACK_KEYS = new Set([
  'request_token', 'requestToken', 'code', 'hdfc_status', 'error',
]);
const TOKEN_KEYS = new Set(['request_token', 'requestToken', 'code']);
const MAX_TOKEN_LENGTH = 4096;
export const HDFC_FLOW_INTENT_KEY = 'hdfc_holdings_flow_intent_v1';
const FLOW_INTENT_TTL_MS = 10 * 60 * 1000;

function resolveStorage(storage) {
  // Accessing sessionStorage itself can throw when browser storage is blocked.
  return storage === undefined ? globalThis.sessionStorage : storage;
}

function activeFlowIntent(storage, now) {
  const raw = storage.getItem(HDFC_FLOW_INTENT_KEY);
  if (typeof raw !== 'string' || raw.length > 128) return null;
  let intent;
  try {
    intent = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)
    || Object.keys(intent).length !== 2
    || !['standalone', 'legacy'].includes(intent.kind)
    || !Number.isSafeInteger(intent.expiresAt)
    || !Number.isSafeInteger(now) || now < 0
    || intent.expiresAt <= now || intent.expiresAt > now + FLOW_INTENT_TTL_MS) return null;
  return intent.kind;
}

/** Store only an expiring, secret-free per-tab flow intent. */
export function markHdfcFlowIntent(kind, storage, now = Date.now()) {
  if (!['standalone', 'legacy'].includes(kind)
    || !Number.isSafeInteger(now) || now < 0
    || !Number.isSafeInteger(now + FLOW_INTENT_TTL_MS)) return false;
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function' || typeof target.setItem !== 'function') return false;
    if (kind === 'legacy' && activeFlowIntent(target, now) === 'standalone') return false;
    target.setItem(HDFC_FLOW_INTENT_KEY, JSON.stringify({ kind, expiresAt: now + FLOW_INTENT_TTL_MS }));
    return true;
  } catch {
    return false;
  }
}

function consumeFlowIntent(storage, now) {
  try {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== 'function' || typeof target.removeItem !== 'function') return null;
    const kind = activeFlowIntent(target, now);
    // Even malformed or expired markers are consumed. Failure cannot allow legacy.
    target.removeItem(HDFC_FLOW_INTENT_KEY);
    return kind;
  } catch {
    return null;
  }
}

function parseParameters(raw) {
  const source = raw.replace(/^[?#]/u, '');
  const params = new URLSearchParams(source);
  let malformed = false;
  for (const item of source.split('&')) {
    for (const part of item.split('=')) {
      try {
        decodeURIComponent(part.replace(/\+/gu, ' '));
      } catch {
        malformed = true;
      }
    }
  }
  return { params, malformed };
}

function fragmentParameters(hash) {
  const fragment = hash.replace(/^#/u, '');
  // Recognize callback parameters inside a hash-router fragment as well.
  const queryStart = fragment.indexOf('?');
  return parseParameters(fragment.startsWith('/') && queryStart !== -1
    ? fragment.slice(queryStart + 1) : fragment);
}

function clearAddress(location, history) {
  try {
    if (typeof history?.replaceState !== 'function') return false;
    history.replaceState(history.state, '', location.pathname || '/');
    return true;
  } catch {
    return false;
  }
}

function unsafeCharacters(value) {
  if (/\s/u.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function usableToken(value) {
  return value.length > 0
    && value.length <= MAX_TOKEN_LENGTH
    && !unsafeCharacters(value);
}

/** Consume an in-memory callback token once without mutating React props. */
export function consumeCallbackToken(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const token = entry.requestToken;
  if (Object.hasOwn(entry, 'requestToken')) entry.requestToken = null;
  return entry.kind === 'callback' && entry.error === null
    && typeof token === 'string' && usableToken(token) ? token : null;
}

/** Reset existing in-memory secret fields after use or cancellation. */
export function clearEntrySecrets(entry) {
  if (!entry || typeof entry !== 'object') return;
  for (const key of ['requestToken', 'pairingCode']) {
    if (Object.hasOwn(entry, key)) entry[key] = null;
  }
}

/**
 * Call before mounting the normal application. Only an explicitly marked,
 * active legacy flow with a valid query callback may enter the normal app.
 * Callback tokens and pairing codes are never written to browser storage.
 */
export function captureHoldingsConnectEntry(location, history, storage, now = Date.now()) {
  const query = parseParameters(location.search || '');
  const fragment = fragmentParameters(location.hash || '');
  const entries = [...query.params.entries(), ...fragment.params.entries()];
  const callbackEntries = entries.filter(([key]) => CALLBACK_KEYS.has(key));
  const pathname = (location.pathname || '/').replace(/\/+$/u, '') || '/';
  const standalonePath = pathname === '/holdings-connect' || pathname === '/holdings-connect/mac';

  if (callbackEntries.length > 0) {
    const tokens = callbackEntries.filter(([key]) => TOKEN_KEYS.has(key));
    const hasError = callbackEntries.some(([key]) => key === 'error');
    const validCallback = !query.malformed && !fragment.malformed && !hasError
      && tokens.length === 1 && usableToken(tokens[0][1]);
    if (standalonePath) markHdfcFlowIntent('standalone', storage, now);
    const intent = consumeFlowIntent(storage, now);
    const hasFragmentCallback = [...fragment.params].some(([key]) => CALLBACK_KEYS.has(key));
    if (validCallback && !standalonePath && intent === 'legacy' && !hasFragmentCallback) {
      return { kind: 'normal' };
    }
    // Unknown, expired, and invalid callbacks always stay in the safe entry.
    const cleared = clearAddress(location, history);
    const valid = validCallback && cleared;
    return {
      kind: 'callback',
      requestToken: valid ? tokens[0][1] : null,
      error: valid ? null : 'invalid_callback',
    };
  }

  if (standalonePath) markHdfcFlowIntent('standalone', storage, now);
  if (standalonePath) {
    const kind = pathname === '/holdings-connect/mac' ? 'mac' : 'phone';
    if ((location.search || location.hash) && !clearAddress(location, history)) {
      return { kind, error: 'invalid_entry' };
    }
    return { kind };
  }
  return { kind: 'normal' };
}

function validSnapshotDate(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|\+00:00)$/u.exec(value);
  if (!match) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
  return actual.every((number, index) => number === Number(match[index + 1]));
}

/** Validate and copy only the approved snapshot fields; errors contain no input. */
export function validateHoldingsSnapshot(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.snapshot_version !== 2 || value.source !== 'HDFC InvestRight'
      || value.account_authenticated !== true
      || value.identity_verification !== 'broker_authentication'
      || !validSnapshotDate(value.as_of_utc)
      || !Array.isArray(value.holdings) || value.holdings.length > 5000
      || !Number.isSafeInteger(value.holdings_count)
      || value.holdings_count !== value.holdings.length) throw new Error();
    const holdings = Array.from(value.holdings, (row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
      const clone = {};
      for (const field of ['isin', 'company_name', 'security_id', 'exchange']) {
        const text = row[field];
        if (typeof text !== 'string' || text.length > 240) throw new Error();
        for (let index = 0; index < text.length; index += 1) {
          const code = text.charCodeAt(index);
          if (code <= 0x1f || code === 0x7f) throw new Error();
        }
        clone[field] = text;
      }
      if (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0) throw new Error();
      clone.quantity = row.quantity;
      for (const field of ['average_price', 'investment_value', 'close_price']) {
        const number = row[field];
        if (number !== null && (typeof number !== 'number' || !Number.isFinite(number))) throw new Error();
        clone[field] = number;
      }
      return clone;
    });
    return {
      snapshot_version: 2, source: 'HDFC InvestRight', as_of_utc: value.as_of_utc,
      account_authenticated: true, identity_verification: 'broker_authentication',
      holdings_count: holdings.length, holdings,
    };
  } catch {
    throw new Error('Invalid holdings snapshot.');
  }
}

/** Accept only the official HDFC login URL shape returned by the backend. */
export function validHdfcLoginUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const { params, malformed } = parseParameters(url.search);
    const entries = [...params];
    return url.protocol === 'https:'
      && url.hostname === 'developer.hdfcsec.com'
      && url.port === ''
      && url.pathname === '/oapi/v1/login'
      && url.username === '' && url.password === '' && url.hash === ''
      && !value.includes('#')
      && !unsafeCharacters(value) && !value.includes('\\')
      && !malformed && entries.length === 1
      && entries[0][0] === 'api_key' && usableToken(entries[0][1]);
  } catch {
    return false;
  }
}
