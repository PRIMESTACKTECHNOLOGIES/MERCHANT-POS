/**
 * CustomerEntryPage.tsx
 * ─────────────────────
 * Full-screen page that the cashier shows to the customer.
 * Customer can:
 *   A) Enter their card details manually (offline EMV flow)
 *   B) Enter a 6-digit payment code (redemption flow)
 *
 * Route: /customer-entry?amount=150.00&currency=AED&stan=000123&merchantId=MRC-1001
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { redeemPaymentCode } from '../lib/api';
import { processEMVOffline } from '../lib/emv/emv-pos-bridge';
import { getErrorMessage } from '../utils/errorMessage';

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = 'select' | 'card' | 'code' | 'processing' | 'approved' | 'declined';

interface ResultState {
  success: boolean;
  title: string;
  subtitle: string;
  detail: string;
  code?: string;
  authCode?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + '/' + digits.slice(2);
}

function formatPAN(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 19)
    .replace(/(.{4})/g, '$1 ').trim();
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CustomerEntryPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const amount     = parseFloat(params.get('amount') || '0');
  const currency   = params.get('currency') || 'AED';
  const merchantId = params.get('merchantId') || 'MRC-1001';
  const terminalId = params.get('terminalId') || 'WEB-POS-001';

  const [mode, setMode]       = useState<Mode>('select');
  const [result, setResult]   = useState<ResultState | null>(null);

  // Card form state
  const [pan, setPan]         = useState('');
  const [expiry, setExpiry]   = useState('');
  const [cvv, setCvv]         = useState('');
  const [pin, setPin]         = useState('');
  const [showPin, setShowPin] = useState(false);

  // 6-digit code state
  const [code, setCode]       = useState('');
  const codeRefs              = useRef<Array<HTMLInputElement | null>>([]);

  // Auto-reset to cashier after 30s on result screen
  useEffect(() => {
    if (mode === 'approved' || mode === 'declined') {
      const t = setTimeout(() => navigate(-1), 30000);
      return () => clearTimeout(t);
    }
  }, [mode, navigate]);

  // ── Card submit ─────────────────────────────────────────────────────────────
  async function handleCardSubmit() {
    if (!pan.replace(/\s/g, '') || !expiry || !cvv) return;
    setMode('processing');
    try {
      const result = await processEMVOffline(
        { pan: pan.replace(/\s/g, ''), expiry, cvv, pin: pin || undefined },
        amount,
        currency,
        terminalId
      );

      if (result.approved) {
        setResult({
          success: true,
          title: 'Payment Approved',
          subtitle: `${currency} ${amount.toFixed(2)}`,
          detail: `STAN: ${result.stan}`,
          authCode: result.authCode,
          code: result.cryptogram.slice(0, 6).toUpperCase()
        });
        setMode('approved');
      } else if (result.requiresOnline) {
        setResult({
          success: false,
          title: 'Online Required',
          subtitle: 'Please connect to internet and retry',
          detail: result.reason
        });
        setMode('declined');
      } else {
        setResult({
          success: false,
          title: 'Payment Declined',
          subtitle: result.reason,
          detail: `STAN: ${result.stan}`
        });
        setMode('declined');
      }
    } catch (e: unknown) {
      setResult({
        success: false,
        title: 'Processing Error',
        subtitle: getErrorMessage(e, 'Unknown error'),
        detail: 'Please try again'
      });
      setMode('declined');
    }
  }

  // ── Code submit ─────────────────────────────────────────────────────────────
  async function handleCodeSubmit() {
    if (code.length !== 6) return;
    setMode('processing');
    try {
      const res = await redeemPaymentCode({ code, amount, merchantId });
      if (res.success) {
        setResult({
          success: true,
          title: 'Payment Approved',
          subtitle: `${currency} ${amount.toFixed(2)}`,
          detail: `Ref: ${res.reference || '—'}`,
          code
        });
        setMode('approved');
      } else {
        setResult({
          success: false,
          title: 'Code Rejected',
          subtitle: res.message || 'Invalid code',
          detail: 'Please check the code and try again'
        });
        setMode('declined');
      }
    } catch (e: unknown) {
      setResult({
        success: false,
        title: 'Redemption Failed',
        subtitle: getErrorMessage(e, 'Network error'),
        detail: 'Please try again'
      });
      setMode('declined');
    }
  }

  // ── 6-digit code input ───────────────────────────────────────────────────────
  function handleCodeDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const arr = code.split('');
    arr[index] = digit;
    const next = arr.join('').slice(0, 6);
    setCode(next.padEnd(6, '').trim().padEnd(next.length));

    const filled = next.replace(/ /g, '');
    setCode(filled.padEnd(6, ' ').slice(0, 6).trimEnd());

    // Actually just set the clean string
    const clean = (code.slice(0, index) + digit + code.slice(index + 1)).slice(0, 6);
    setCode(clean);

    if (digit && index < 5) codeRefs.current[index + 1]?.focus();
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={styles.fullscreen}>

      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>POS 201.3</span>
        <span style={styles.headerAmount}>
          {currency} {amount > 0 ? amount.toFixed(2) : '—'}
        </span>
      </div>

      {/* ══ SELECT MODE ══ */}
      {mode === 'select' && (
        <div style={styles.center}>
          <p style={styles.prompt}>Choose payment method</p>

          <button style={{ ...styles.bigBtn, background: '#1E3A5F' }}
            onClick={() => setMode('card')}>
            💳  Pay with Card
          </button>

          <div style={styles.divider}>— OR —</div>

          <button style={{ ...styles.bigBtn, background: '#16A34A' }}
            onClick={() => setMode('code')}>
            ⌨  Enter 6-Digit Code
          </button>

          <button style={styles.backBtn} onClick={() => navigate(-1)}>
            ← Back to Cashier
          </button>
        </div>
      )}

      {/* ══ CARD ENTRY ══ */}
      {mode === 'card' && (
        <div style={styles.form}>
          <p style={styles.prompt}>Enter your card details</p>

          <label style={styles.label}>Card Number</label>
          <input
            style={styles.input}
            type="text"
            inputMode="numeric"
            placeholder="1234 5678 9012 3456"
            value={pan}
            maxLength={23}
            onChange={e => setPan(formatPAN(e.target.value))}
          />

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Expiry (MM/YY)</label>
              <input
                style={styles.input}
                type="text"
                inputMode="numeric"
                placeholder="MM/YY"
                value={expiry}
                maxLength={5}
                onChange={e => setExpiry(formatExpiry(e.target.value))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>CVV</label>
              <input
                style={styles.input}
                type="password"
                inputMode="numeric"
                placeholder="•••"
                value={cvv}
                maxLength={4}
                onChange={e => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
          </div>

          {showPin ? (
            <>
              <label style={styles.label}>PIN (optional)</label>
              <input
                style={styles.input}
                type="password"
                inputMode="numeric"
                placeholder="4-digit PIN"
                value={pin}
                maxLength={6}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </>
          ) : (
            <button style={styles.linkBtn} onClick={() => setShowPin(true)}>
              + Enter PIN (optional)
            </button>
          )}

          <button
            style={{
              ...styles.bigBtn,
              background: pan.replace(/\s/g,'').length >= 13 ? '#1E3A5F' : '#9CA3AF',
              marginTop: 24
            }}
            disabled={pan.replace(/\s/g,'').length < 13 || !expiry || !cvv}
            onClick={handleCardSubmit}
          >
            ✓  Pay {currency} {amount.toFixed(2)}
          </button>

          <button style={styles.backBtn} onClick={() => setMode('select')}>← Back</button>
        </div>
      )}

      {/* ══ 6-DIGIT CODE ENTRY ══ */}
      {mode === 'code' && (
        <div style={styles.center}>
          <p style={styles.prompt}>Enter your 6-digit payment code</p>

          {/* Individual digit boxes */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', margin: '24px 0' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <input
                key={i}
                ref={element => { codeRefs.current[i] = element; }}
                style={styles.digitBox}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={code[i] || ''}
                onChange={e => handleCodeDigit(i, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Backspace' && !code[i] && i > 0) {
                    codeRefs.current[i - 1]?.focus();
                    const c = code.slice(0, i - 1) + ' ' + code.slice(i);
                    setCode(c.trimEnd());
                  }
                }}
              />
            ))}
          </div>

          <p style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center' }}>
            Code was given to you after payment authorization
          </p>

          <button
            style={{
              ...styles.bigBtn,
              background: code.replace(/\s/g,'').length === 6 ? '#16A34A' : '#9CA3AF',
              marginTop: 16
            }}
            disabled={code.replace(/\s/g,'').length !== 6}
            onClick={handleCodeSubmit}
          >
            ✓  Redeem Code
          </button>

          <button style={styles.backBtn} onClick={() => { setCode(''); setMode('select'); }}>← Back</button>
        </div>
      )}

      {/* ══ PROCESSING ══ */}
      {mode === 'processing' && (
        <div style={styles.center}>
          <div style={styles.spinner} />
          <p style={{ color: '#fff', fontSize: 20, marginTop: 24 }}>Processing...</p>
          <p style={{ color: '#9CA3AF', fontSize: 14 }}>Please wait</p>
        </div>
      )}

      {/* ══ APPROVED ══ */}
      {mode === 'approved' && result && (
        <div style={styles.resultBox}>
          <div style={{ fontSize: 72 }}>✅</div>
          <h1 style={{ color: '#22C55E', fontSize: 32, margin: '12px 0 4px' }}>{result.title}</h1>
          <p style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>{result.subtitle}</p>
          <p style={{ color: '#9CA3AF', fontSize: 15, marginTop: 8 }}>{result.detail}</p>

          {result.authCode && (
            <div style={styles.codeBox}>
              <span style={{ color: '#9CA3AF', fontSize: 12 }}>Auth Code</span>
              <span style={{ color: '#1E3A5F', fontSize: 28, fontWeight: 700, letterSpacing: 6 }}>
                {result.authCode}
              </span>
            </div>
          )}

          <p style={{ color: '#6B7280', fontSize: 12, marginTop: 20 }}>
            Screen clears in 30 seconds...
          </p>
          <button style={{ ...styles.bigBtn, background: '#1E3A5F', marginTop: 16, maxWidth: 300 }}
            onClick={() => navigate(-1)}>
            Done
          </button>
        </div>
      )}

      {/* ══ DECLINED ══ */}
      {mode === 'declined' && result && (
        <div style={styles.resultBox}>
          <div style={{ fontSize: 72 }}>❌</div>
          <h1 style={{ color: '#EF4444', fontSize: 32, margin: '12px 0 4px' }}>{result.title}</h1>
          <p style={{ color: '#fff', fontSize: 18 }}>{result.subtitle}</p>
          <p style={{ color: '#9CA3AF', fontSize: 14, marginTop: 6 }}>{result.detail}</p>

          <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button style={{ ...styles.bigBtn, background: '#F59E0B', maxWidth: 200 }}
              onClick={() => { setMode('select'); setResult(null); setPan(''); setExpiry(''); setCvv(''); setCode(''); }}>
              Try Again
            </button>
            <button style={{ ...styles.bigBtn, background: '#374151', maxWidth: 200 }}
              onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  fullscreen: {
    minHeight: '100vh',
    background: '#0F172A',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, sans-serif',
  },
  header: {
    background: '#1E3A5F',
    padding: '14px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 700,
  },
  headerAmount: {
    color: '#93C5FD',
    fontSize: 22,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
  },
  center: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
  },
  form: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '32px 24px',
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  prompt: {
    color: '#E2E8F0',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 28,
    fontWeight: 500,
  },
  label: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 4,
    marginTop: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    fontSize: 18,
    borderRadius: 8,
    border: '1px solid #374151',
    background: '#1E293B',
    color: '#F1F5F9',
    outline: 'none',
    boxSizing: 'border-box' as const,
    letterSpacing: 2,
  },
  bigBtn: {
    width: '100%',
    padding: '18px 0',
    fontSize: 17,
    fontWeight: 700,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    marginBottom: 12,
    transition: 'opacity 0.2s',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6B7280',
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 8,
    padding: '8px 0',
    textAlign: 'center' as const,
    width: '100%',
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: '#60A5FA',
    fontSize: 13,
    cursor: 'pointer',
    padding: '8px 0',
    textAlign: 'left' as const,
  },
  divider: {
    color: '#4B5563',
    fontSize: 13,
    margin: '16px 0',
    textAlign: 'center' as const,
  },
  digitBox: {
    width: 52,
    height: 64,
    textAlign: 'center' as const,
    fontSize: 28,
    fontWeight: 700,
    border: '2px solid #374151',
    borderRadius: 8,
    background: '#1E293B',
    color: '#F1F5F9',
    outline: 'none',
    caretColor: '#60A5FA',
  },
  resultBox: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    textAlign: 'center' as const,
  },
  codeBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    background: '#EFF6FF',
    borderRadius: 12,
    padding: '16px 32px',
    marginTop: 16,
    gap: 4,
  },
  spinner: {
    width: 56,
    height: 56,
    border: '5px solid #1E293B',
    borderTop: '5px solid #60A5FA',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite',
  },
};
