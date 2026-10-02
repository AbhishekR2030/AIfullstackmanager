const STAGES = new Set(['request', 'session', 'token_exchange', 'profile', 'holdings']);
const REASONS = new Set([
  'invalid', 'origin', 'configuration', 'session', 'expired', 'owner_mismatch',
  'http_status', 'transport', 'timeout', 'response_size', 'json', 'response_shape',
  'identity_shape', 'snapshot_shape', 'token_missing',
]);
const MESSAGES = Object.freeze({
  not_configured: 'This holdings page needs owner setup before it can be used.',
  invalid_request: 'This sign-in response could not be verified. Start a new sign-in.',
  origin_not_allowed: 'Open the production holdings page and start a new sign-in.',
  session_invalid: 'Start a new sign-in and complete it in the same browser and tab on this phone.',
  session_expired: 'This sign-in has expired. Start a new sign-in in the same browser and tab.',
  account_mismatch: 'HDFC could not verify the expected account. Start again with the correct HDFC client ID.',
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
      if (code === 'provider_failed') {
        if (stage === 'token_exchange') message = 'HDFC sign-in could not be completed. Share the reference below for help.';
        if (stage === 'profile') message = 'HDFC account verification could not be completed. Share the reference below for help.';
        if (stage === 'holdings') message = 'HDFC holdings could not be loaded. Share the reference below for help.';
      }
      if (code === 'unavailable' && reason === 'transport') {
        message = 'The holdings service could not be reached. Check your connection and try again.';
      }
    }
    return { code, message, reference };
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
