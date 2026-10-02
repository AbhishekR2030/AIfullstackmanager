import { useEffect, useRef, useState } from 'react';
import { clearEntrySecrets, consumeCallbackToken, markHdfcFlowIntent, validHdfcLoginUrl, validateHoldingsSnapshot } from '../services/holdingsConnectEntry';
import { localHoldingsError, safeHoldingsError } from '../services/holdingsPhoneErrors';

const API_URL = '/api/holdings-phone';
const RETENTION_MS = 10 * 60 * 1000;
class FlowFailure extends Error {
  constructor(presentation = localHoldingsError('shape')) {
    super(presentation.message);
    this.presentation = presentation;
  }
}

const presentationFrom = (error) => error instanceof FlowFailure ? error.presentation : localHoldingsError('shape');

async function requestJson(action, payload = {}) {
  let response;
  try {
    response = await fetch(action === 'health' ? `${API_URL}?action=health` : API_URL, {
      method: action === 'health' ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', ...(action !== 'health' ? { 'Content-Type': 'application/json' } : {}) },
      ...(action !== 'health' ? { body: JSON.stringify({ action, ...payload }) } : {}),
    });
  } catch { throw new FlowFailure(localHoldingsError('transport')); }
  let data;
  try { data = await response.json(); } catch { throw new FlowFailure(localHoldingsError('json')); }
  if (!response.ok) throw new FlowFailure(safeHoldingsError(data?.error));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new FlowFailure(localHoldingsError('shape'));
  return data;
}

function SnapshotView({ snapshot, onClear }) {
  const number = (value) => value === null ? '—' : value.toLocaleString('en-IN', { maximumFractionDigits: 4 });
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `hdfc-holdings-${snapshot.as_of_utc.slice(0, 10)}.json`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <p className="hc-eyebrow">HDFC InvestRight · sign-in completed</p><h1>Your holdings snapshot</h1>
    <p>These holdings are for the account returned by your HDFC sign-in.</p>
    <p className="hc-notice" role="status">Loaded {new Date(snapshot.as_of_utc).toLocaleString()}. Sign in again to update this snapshot.</p>
    <p className="hc-small">Holdings remain on this page for up to 10 minutes and clear when you leave. Download JSON saves a dated file on your device; clearing this page does not delete that file.</p>
    <div className="hc-result-header"><button type="button" onClick={download}>Download JSON snapshot</button><button type="button" className="hc-secondary" onClick={onClear}>Clear this page</button></div>
    {snapshot.holdings_count === 0 ? <p>No holdings were returned by HDFC.</p> : <div className="hc-table-wrap" tabIndex={0} aria-label="Holdings table; scroll horizontally for all columns">
      <table><caption className="hc-visually-hidden">HDFC holdings snapshot</caption><thead><tr><th scope="col">Company</th><th scope="col">ISIN</th><th scope="col">Security ID</th><th scope="col">Exchange</th><th scope="col">Quantity</th><th scope="col">Average price (₹)</th><th scope="col">Investment (₹)</th><th scope="col">Close price (₹)</th></tr></thead>
        <tbody>{snapshot.holdings.map((row, index) => <tr key={`${row.isin}-${row.security_id}-${index}`}><td>{row.company_name || '—'}</td><td>{row.isin || '—'}</td><td>{row.security_id || '—'}</td><td>{row.exchange || '—'}</td><td>{number(row.quantity)}</td><td>{number(row.average_price)}</td><td>{number(row.investment_value)}</td><td>{number(row.close_price)}</td></tr>)}</tbody></table>
    </div>}
  </>;
}

function ProviderReportView({ text }) {
  const [copyStatus, setCopyStatus] = useState('');
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyStatus('Select the report text to copy it.');
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopyStatus('Safe report copied.');
    } catch { setCopyStatus('Select the report text to copy it.'); }
  };
  return <details className="hc-provider-report">
    <summary>Safe provider error report</summary>
    <pre className="hc-small">{text}</pre>
    <button type="button" className="hc-secondary" onClick={copy}>Copy safe report</button>
    {copyStatus && <p className="hc-small" role="status">{copyStatus}</p>}
  </details>;
}

function PhonePage({ entry }) {
  const [phase, setPhase] = useState(entry.error || (entry.kind === 'callback' && !entry.requestToken) ? 'invalid_request' : entry.kind === 'callback' ? 'processing' : 'checking');
  const [failure, setFailure] = useState(entry.error || (entry.kind === 'callback' && !entry.requestToken) ? localHoldingsError('callback') : null);
  const [snapshot, setSnapshot] = useState(null);
  const lifecycle = useRef({ submitted: false, mounted: false, deadline: 0, timer: null });

  useEffect(() => {
    const life = lifecycle.current; life.mounted = true;
    if (!life.submitted) {
      life.submitted = true;
      if (entry.kind === 'callback') {
        const token = consumeCallbackToken(entry);
        if (token && !entry.error) {
          const payload = { request_token: token };
          const pending = requestJson('callback', payload);
          payload.request_token = null;
          pending.then((value) => {
            if (!life.mounted) return;
            let clean;
            try { clean = validateHoldingsSnapshot(value); } catch { throw new FlowFailure(localHoldingsError('snapshot')); }
            life.deadline = Date.now() + RETENTION_MS;
            life.timer = setTimeout(() => { life.deadline = 0; setSnapshot(null); setPhase('expired'); }, RETENTION_MS);
            setSnapshot(clean); setFailure(null); setPhase('ready');
          }).catch((error) => {
            if (life.mounted) { const safe = presentationFrom(error); setFailure(safe); setPhase(safe.code); }
          });
        }
        clearEntrySecrets(entry);
      } else if (!entry.error) {
        requestJson('health').then((value) => {
          if (!life.mounted) return;
          if (value.version !== 'holdings-phone-v2' || value.profile_verification !== false
            || value.auth_method !== 'token_exchange' || value.holdings_method !== 'GET') throw new FlowFailure(localHoldingsError('shape'));
          setFailure(value.configured === true ? null : localHoldingsError('configuration'));
          setPhase(value.configured === true ? 'initial' : 'not_configured');
        }).catch((error) => {
          if (life.mounted) { const safe = presentationFrom(error); setFailure(safe); setPhase(safe.code); }
        });
      }
    }
    return () => { life.mounted = false; clearTimeout(life.timer); };
  }, [entry]);

  useEffect(() => {
    const clearLocal = (nextPhase) => {
      lifecycle.current.deadline = 0; clearTimeout(lifecycle.current.timer);
      setSnapshot(null); setPhase(nextPhase);
    };
    const checkDeadline = () => {
      if (lifecycle.current.deadline && Date.now() >= lifecycle.current.deadline) clearLocal('expired');
    };
    const onLeave = () => { if (lifecycle.current.deadline) clearLocal('cleared'); };
    window.addEventListener('pageshow', checkDeadline); window.addEventListener('focus', checkDeadline);
    document.addEventListener('visibilitychange', checkDeadline); window.addEventListener('pagehide', onLeave);
    return () => { window.removeEventListener('pageshow', checkDeadline); window.removeEventListener('focus', checkDeadline); document.removeEventListener('visibilitychange', checkDeadline); window.removeEventListener('pagehide', onLeave); };
  }, []);

  const start = async (event) => {
    event.preventDefault(); if (phase !== 'initial') return;
    setPhase('starting'); setFailure(null);
    try {
      if (!markHdfcFlowIntent('standalone')) throw new FlowFailure(safeHoldingsError({ code: 'session_invalid', diagnostic: { stage: 'session', reason: 'session' } }));
      const result = await requestJson('start');
      let loginUrl = result.login_url; result.login_url = null;
      if (!validHdfcLoginUrl(loginUrl) || !Number.isFinite(Date.parse(result.expires_at)) || Date.parse(result.expires_at) <= Date.now()) throw new FlowFailure(localHoldingsError('shape'));
      window.location.assign(loginUrl); loginUrl = null;
    } catch (error) {
      if (lifecycle.current.mounted) { const safe = presentationFrom(error); setFailure(safe); setPhase(safe.code); }
    }
  };
  const clear = () => {
    requestJson('clear').catch(() => {});
    lifecycle.current.deadline = 0; clearTimeout(lifecycle.current.timer);
    clearEntrySecrets(entry); setSnapshot(null); setFailure(null); setPhase('initial');
  };

  if (phase === 'ready' && snapshot && Date.now() < lifecycle.current.deadline) return <SnapshotView snapshot={snapshot} onClear={clear} />;
  return <>
    <p className="hc-eyebrow">HDFC InvestRight · same phone</p><h1>Load a current holdings snapshot</h1>
    <p>Sign in on this phone and view your holdings here. Sign in again to update the snapshot.</p>
    {['checking', 'processing', 'starting'].includes(phase) && <p role="status">{phase === 'checking' ? 'Checking availability…' : phase === 'starting' ? 'Opening official HDFC sign-in…' : 'Completing HDFC sign-in and loading holdings…'}</p>}
    {phase === 'initial' && <form onSubmit={start}><p className="hc-small">Sign in to the HDFC account whose holdings you want to view. Your client ID, password, OTP, and consent belong only on HDFC’s official page.</p><button type="submit">Continue to HDFC</button></form>}
    {!['checking', 'processing', 'starting', 'initial', 'cleared', 'expired'].includes(phase) && <div className="hc-notice hc-error" role="alert">
      <p>{(failure || safeHoldingsError({ code: phase })).message}</p>
      {failure?.reference && <p className="hc-small hc-reference">Reference: {failure.reference}</p>}
      {failure?.providerReportText && <ProviderReportView text={failure.providerReportText} />}
    </div>}
    {['expired', 'cleared'].includes(phase) && <p className="hc-notice" role="status">The snapshot has been cleared from this page.</p>}
    {!['checking', 'processing', 'starting', 'initial', 'not_configured'].includes(phase) && <a href="/holdings-connect">Start again</a>}
    <p className="hc-small">This page does not save credentials or holdings in browser storage. A downloaded snapshot stays in your files until you delete it.</p>
  </>;
}

const STYLES = `
.hc-shell{min-height:100svh;background:#f4f6fa;color:#17233b;padding:clamp(18px,5vw,64px);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-sizing:border-box}
.hc-card{max-width:960px;margin:0 auto;background:#fff;border:1px solid #dce2eb;border-radius:22px;padding:clamp(22px,4vw,44px);box-shadow:0 12px 40px #1525410a}
.hc-brand{font-weight:750;letter-spacing:-.02em;color:#244be1;margin-bottom:28px}.hc-eyebrow{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:#58708c;font-weight:650;margin:0 0 8px}
.hc-card h1{font-size:clamp(27px,4vw,38px);line-height:1.2;margin:0 0 18px;letter-spacing:-.03em}.hc-card h2{font-size:22px;margin:0 0 16px}.hc-card p{max-width:680px}.hc-small{font-size:14px;color:#59687c}
.hc-reference{overflow-wrap:anywhere}
.hc-provider-report{margin-top:18px}.hc-provider-report summary{cursor:pointer;font-weight:650}.hc-provider-report pre{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;margin:14px 0}.hc-provider-report button{max-width:100%}
.hc-card form{max-width:560px;margin:26px 0}.hc-card label{display:block;font-weight:650;margin-bottom:8px}.hc-card input{box-sizing:border-box;width:100%;font:inherit;color:inherit;background:#fff;border:1px solid #a8b6c9;border-radius:10px;padding:13px 14px;min-height:48px}
.hc-card input:focus,.hc-card button:focus-visible,.hc-table-wrap:focus{outline:3px solid #93b6ff;outline-offset:3px}.hc-code-input{font-family:ui-monospace,monospace!important;font-size:14px!important}
.hc-card button{font:inherit;font-weight:650;color:#fff;background:#244be1;border:1px solid transparent;border-radius:10px;padding:13px 18px;min-height:48px;cursor:pointer}.hc-card button:disabled{opacity:.6;cursor:wait}.hc-card .hc-secondary{color:#244be1;background:#fff;border-color:#b3c1df}
.hc-notice{border:1px solid #b5d4c7;border-radius:12px;padding:15px 18px;background:#f0faf5;color:#184a38}.hc-error{border-color:#e7bec0;background:#fff4f4;color:#8a2d35}.hc-pairing{margin:28px 0;padding:24px;border:1px solid #dce2eb;background:#f8faff;border-radius:16px;max-width:560px}.hc-pairing img{display:block;border-radius:10px;max-width:100%;height:auto;background:white}
.hc-pair-code{display:block;overflow-wrap:anywhere;font:600 16px/1.7 ui-monospace,monospace;letter-spacing:.04em;background:#e9edf6;border-radius:8px;padding:12px}.hc-result-header{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}.hc-table-wrap{overflow:auto;margin-top:24px;border:1px solid #dce2eb;border-radius:12px}.hc-card table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:14px}.hc-card th{background:#f3f6fb;text-align:left;color:#405572}.hc-card td,.hc-card th{padding:12px 14px;border-bottom:1px solid #e3e8f0}.hc-card tr:last-child td{border-bottom:0}.hc-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:520px){.hc-card form>button{width:100%}.hc-pairing{padding:18px}.hc-pair-code{font-size:14px}.hc-brand{margin-bottom:22px}}
`;

export default function HdfcHoldingsConnect({ entry }) {
  return <main className="hc-shell"><style>{STYLES}</style><section className="hc-card" aria-label="HDFC holdings snapshot">
    <div className="hc-brand">α AlphaSeeker</div>
    {entry.kind === 'mac' ? <><p className="hc-eyebrow">Same-phone sign-in</p><h1>Use the phone you sign in on</h1><p>The holdings snapshot appears on the same phone where you complete HDFC sign-in. You can download a dated JSON file and transfer that file to your Mac.</p><a href="/holdings-connect">Open the holdings page</a></> : <PhonePage entry={entry} />}
  </section></main>;
}
