/**
 * Customer Wallet Profile Page — POS 201.3
 * Dark sci-fi theme with full KYC/identity panel for transaction verification.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';
import {
  getCustomers,
  getCustomerProfile,
  getCustomerWalletBalances,
  getWalletBalance,
  getWalletTransactions,
  getCryptoWallets,
  updateCustomerKYC,
  deleteCustomer,
  type Customer,
  type WalletBalance,
  type WalletTransaction,
  type CryptoWallet,
} from '../lib/api';
import { getErrorMessage } from '../utils/errorMessage';

const PAGES = ['WALLET', 'TRANSACTIONS', 'CRYPTO', 'PROFILE'] as const;
type Page = typeof PAGES[number];

// Abstract tech/finance backgrounds — no face photos
const PAGE_IMAGES: Record<Page, string> = {
  WALLET:       'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&q=80&fit=crop',
  TRANSACTIONS: 'https://images.unsplash.com/photo-1642790551116-18e4f857e4c4?w=400&q=80&fit=crop',
  CRYPTO:       'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=400&q=80&fit=crop',
  PROFILE:      'https://images.unsplash.com/photo-1639322537228-f710d846310a?w=400&q=80&fit=crop',
};

const PAGE_HERO: Record<Page, string> = {
  WALLET:       'https://images.unsplash.com/photo-1560472355-536de3962603?w=600&q=80&fit=crop',
  TRANSACTIONS: 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=600&q=80&fit=crop',
  CRYPTO:       'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=600&q=80&fit=crop',
  PROFILE:      'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=600&q=80&fit=crop',
};

const ID_TYPES = ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', 'RESIDENT_ID', 'OTHER'];
const KYC_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

function sourceLabel(src: string): string {
  const map: Record<string, string> = {
    merchant_credit: 'Merchant Credit', merchant_to_customer: 'Merchant Transfer',
    wallet_transfer: 'Wallet Transfer', bank_payout: 'Bank Payout',
    crypto_purchase: 'Crypto Purchase', topup_card: 'Card Top-Up',
    admin_credit: 'Admin Credit', hot_wallet_sweep: 'Hot Wallet Sweep',
    pos_offline_sale: 'POS Sale', card_capture: 'Card Capture',
  };
  return map[src] || src?.replace(/_/g, ' ')?.replace(/\b\w/g, c => c.toUpperCase()) || 'Activity';
}

const kycStatusColor: Record<string, string> = {
  VERIFIED: 'var(--acid)',
  PENDING:  'var(--green2)',
  REJECTED: '#e05a5a',
};
const riskColor: Record<string, string> = {
  LOW:    'var(--acid)',
  MEDIUM: '#e0c84a',
  HIGH:   '#e05a5a',
};

export default function CustomerWalletProfilePage() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer]         = useState<Customer | null>(null);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [balance, setBalance]           = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [cryptos, setCryptos]           = useState<CryptoWallet[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [activePage, setActivePage]     = useState<Page>('WALLET');
  const [sideImg, setSideImg]           = useState(PAGE_IMAGES.WALLET);
  const [lightPos, setLightPos]         = useState({ x: '50%', y: '50%' });
  const wrapRef = useRef<HTMLDivElement>(null);

  // KYC edit state
  const [kycEdit, setKycEdit]   = useState(false);
  const [kycBusy, setKycBusy]   = useState(false);
  const [kycMsg,  setKycMsg]    = useState<{ ok: boolean; text: string } | null>(null);
  const [kycForm, setKycForm]   = useState<Partial<Customer>>({});
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      const results = await Promise.allSettled([
        getCustomers(),
        getCustomerProfile(customerId),
        getCustomerWalletBalances(customerId),
        getWalletBalance(customerId),
        getWalletTransactions(customerId),
        getCryptoWallets(customerId),
      ]);

      const [customersResult, profileResult, walletsResult, balanceResult, transactionsResult, cryptoResult] = results;
      const customers = customersResult.status === 'fulfilled' ? customersResult.value : [];
      const profile = profileResult.status === 'fulfilled'
        ? profileResult.value
        : customers.find((candidate) => candidate.id === customerId) || null;

      setAllCustomers(customers);
      setCustomer(profile);
      if (profile) setKycForm(profile);
      const customerWallets = walletsResult.status === 'fulfilled' ? walletsResult.value : [];
      const selectedWallet = customerWallets.find((wallet) => Number(wallet.balance) !== 0) || customerWallets[0];
      if (selectedWallet) {
        setBalance({
          balance: Number(selectedWallet.balance),
          currency: selectedWallet.currency,
        });
      } else if (balanceResult.status === 'fulfilled') {
        setBalance(balanceResult.value);
      }
      if (transactionsResult.status === 'fulfilled') setTransactions(transactionsResult.value);
      if (cryptoResult.status === 'fulfilled') setCryptos(cryptoResult.value);

      const failedResult = results.find((result) => result.status === 'rejected');
      if (failedResult && !profile) {
        setLoadError(failedResult.reason instanceof Error ? failedResult.reason.message : 'Customer profile could not be loaded');
      } else if (failedResult) {
        setLoadError('Some wallet details could not be loaded. The customer profile is still available.');
      }
      setLoading(false);
    })();
  }, [customerId]);

  function changePage(p: Page) {
    setActivePage(p);
    setSideImg(PAGE_IMAGES[p]);
    if (p !== 'PROFILE') { setKycEdit(false); setKycMsg(null); }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setLightPos({ x: e.clientX - rect.left + 'px', y: e.clientY - rect.top + 'px' });
  }

  async function saveKYC() {
    if (!customerId) return;
    setKycBusy(true);
    setKycMsg(null);
    try {
      const result = await updateCustomerKYC(customerId, kycForm);
      setCustomer(result.customer);
      setKycForm(result.customer);
      setKycEdit(false);
      setKycMsg({ ok: true, text: 'KYC saved successfully' });
    } catch (e: unknown) {
      setKycMsg({ ok: false, text: getErrorMessage(e, 'Save failed') });
    } finally {
      setKycBusy(false);
    }

  }

  async function removeCustomer() {
    if (!customerId || !customer) return;
    const confirmation = window.prompt(
      `Type the exact customer name to permanently delete "${customer.name}". Customers with funds or financial history cannot be deleted.`
    );
    if (confirmation === null) return;
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      await deleteCustomer(customerId, confirmation);
      navigate('/wallets');
    } catch (e: unknown) {
      setDeleteMsg(getErrorMessage(e, 'Customer deletion failed'));
    } finally {
      setDeleteBusy(false);
    }
  }

  // Filter to active wallet currency so EUR/USD amounts don't mix
  const activeCurrency = balance?.currency || 'USD';
  const sameCcyTxns = transactions.filter(t => !t.currency || t.currency === activeCurrency);
  const credits  = sameCcyTxns.filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.amount), 0);
  const debits   = sameCcyTxns.filter(t => t.type === 'debit').reduce((s, t)  => s + Number(t.amount), 0);
  const creditPct   = credits + debits > 0 ? Math.round(credits / (credits + debits) * 100) : 0;
  const debitPct    = 100 - creditPct;
  const activityPct = Math.min(100, transactions.length * 8);

  if (loading) return (
    <div style={{ background: '#050705', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#c7d988', fontSize: 13 }}>
      LOADING WALLET...
    </div>
  );
  if (!customer) return (
    <div style={{ background: '#050705', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', color: '#c7d988', fontSize: 13 }}>
      <div style={{ textAlign: 'center' }}>
        <div>CUSTOMER PROFILE COULD NOT BE LOADED</div>
        {loadError && <div style={{ marginTop: 10, color: '#e05a5a', fontSize: 12 }}>{loadError}</div>}
        <button type="button" onClick={() => navigate('/wallets')} style={{ marginTop: 18, border: '1px solid #5f6f38', padding: '8px 14px', color: '#d9ff85' }}>
          BACK TO CUSTOMERS
        </button>
      </div>
    </div>
  );

  const initials = customer.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const kycStatus = customer.kyc_status || 'PENDING';
  const riskLevel = customer.risk_level || 'LOW';

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&family=Unbounded:wght@400;600;700&display=swap" rel="stylesheet" />

      <style>{`
        :root{
          --bg:transparent;--black:#050705;--black2:#0a0d08;--panel:#10150e;--panel2:#182012;
          --paper:#d7dcc5;--paper2:#aeb899;--text:#e9eddc;--textDark:#11140f;
          --muted:#aab497;--faint:rgba(233,237,220,.58);--green:#c7d988;--green2:#9faf62;
          --green3:#5f6f38;--acid:#d9ff85;--line:rgba(199,217,136,.35);
          --lineSoft:rgba(233,237,220,.14);--darkLine:rgba(17,20,15,.28);
          --glass:rgba(5,7,5,.78);--glass2:rgba(199,217,136,.08);--light:rgba(199,217,136,.22);
          --glow:rgba(199,217,136,.42);--deepGlow:rgba(157,190,91,.28);--radius:34px;--ease:.35s ease;
        }
        .cwp-body{background:#121212;padding:30px;min-height:100vh;}
        .cwp-wrap{width:900px;height:720px;margin:0 auto;position:relative;overflow:hidden;background:var(--bg);color:var(--text);font-family:'Rajdhani',Arial,sans-serif;}
        .cwp-grain{position:absolute;inset:0;z-index:20;pointer-events:none;opacity:.16;background-image:url("https://www.transparenttextures.com/patterns/asfalt-dark.png");mix-blend-mode:screen;}
        .cwp-light{width:220px;height:220px;position:absolute;z-index:19;pointer-events:none;border-radius:50%;background:radial-gradient(circle,var(--light),transparent 70%);transform:translate(-50%,-50%);transition:.06s linear;}
        .cwp-content{position:absolute;left:0;top:0;width:560px;height:520px;overflow:hidden;border:1px solid var(--line);border-radius:34px 34px 4px 4px;background:radial-gradient(circle at 75% 25%,rgba(199,217,136,.16),transparent 35%),var(--glass);}
        .cwp-controls{position:absolute;left:0;bottom:0;width:560px;height:175px;overflow:hidden;border:1px solid var(--darkLine);border-top:0;border-radius:4px 4px 72px 34px;background:var(--paper);color:var(--textDark);}
        .cwp-side{position:absolute;right:0;top:0;width:320px;height:720px;overflow:hidden;border:1px solid var(--line);border-radius:36px;color:var(--textDark);background:radial-gradient(circle at 50% 12%,rgba(215,220,197,.48),transparent 26%),radial-gradient(circle at 50% 56%,rgba(199,217,136,.18),transparent 34%),linear-gradient(180deg,var(--paper2),var(--black) 39%);}
        .cwp-content:before,.cwp-controls:before,.cwp-side:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,transparent 49%,var(--lineSoft) 50%,transparent 51%),linear-gradient(0deg,transparent 49%,var(--lineSoft) 50%,transparent 51%);background-size:42px 42px;opacity:.25;}
        .cwp-page{display:none;height:100%;padding:18px;position:relative;z-index:2;animation:cwpFade .45s ease;}
        .cwp-page.active{display:block;}
        @keyframes cwpFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .cwp-head{display:flex;justify-content:space-between;margin-bottom:10px;font:11px 'Share Tech Mono',monospace;letter-spacing:1px;color:var(--muted);}
        .cwp-head b{color:var(--green);}
        .cwp-h1{margin:0;font-family:'Unbounded',sans-serif;font-size:26px;line-height:1;color:var(--green);}
        .cwp-h2{margin:0 0 9px;font:13px 'Share Tech Mono',monospace;color:var(--green);text-transform:uppercase;}
        .cwp-em{display:block;font:11px 'Share Tech Mono',monospace;color:var(--faint);font-style:normal;}
        .cwp-p{margin:0 0 6px;font-size:12px;line-height:1.42;color:var(--muted);}
        .cwp-main-layout{display:grid;grid-template-columns:195px 1fr;gap:12px;height:360px;}
        .cwp-main-stack{display:grid;grid-template-rows:190px 1fr;gap:10px;min-height:0;}
        .cwp-hero{height:360px;position:relative;overflow:hidden;border:1px solid var(--line);border-radius:24px 24px 90px 24px;background:var(--black);}
        .cwp-hero:after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 50% 40%,transparent 0 34%,rgba(5,7,5,.45) 72%),linear-gradient(180deg,transparent,rgba(199,217,136,.16)),repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 7px),repeating-linear-gradient(90deg,transparent 0 18px,rgba(199,217,136,.08) 19px);mix-blend-mode:screen;}
        .cwp-hero img{width:100%;height:100%;display:block;object-fit:cover;filter:grayscale(.18) contrast(1.3) saturate(.72) brightness(.82);transition:var(--ease);}
        .cwp-scan{position:absolute;left:0;right:0;top:-40px;height:38px;z-index:4;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(199,217,136,.28),transparent);animation:cwpScan 4s infinite linear;}
        @keyframes cwpScan{from{top:-40px}to{top:100%}}
        .cwp-box,.cwp-tbox{min-height:0;padding:10px 12px;border:1px solid var(--line);border-radius:22px;background:rgba(0,0,0,.34);}
        .cwp-box{overflow:auto;}
        .cwp-tbox{overflow:auto;}
        .cwp-form{display:grid;grid-template-columns:1fr 1fr;gap:5px 8px;font:10px 'Share Tech Mono',monospace;}
        .cwp-form b{color:var(--muted);align-self:center;}
        .cwp-form span{color:var(--green);}
        .cwp-mrow{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;}
        .cwp-meter{margin-bottom:6px;}
        .cwp-meter label{display:flex;justify-content:space-between;margin-bottom:4px;font:10px 'Share Tech Mono',monospace;color:var(--muted);}
        .cwp-meter i{display:block;height:8px;border:1px solid var(--line);background:rgba(255,255,255,.04);}
        .cwp-meter i:before{content:"";display:block;width:var(--value);height:100%;background:var(--green);}
        .cwp-txlist{height:430px;overflow:auto;}
        .cwp-tx{display:grid;grid-template-columns:72px 1fr;gap:12px;margin-bottom:10px;padding:10px;border:1px solid var(--lineSoft);border-radius:18px;}
        .cwp-tx-icon{width:100%;height:56px;border:1px solid var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;background:var(--panel);font:18px 'Share Tech Mono',monospace;color:var(--green);}
        .cwp-tx:hover{border-color:var(--green);background:rgba(199,217,136,.08);transition:var(--ease);}
        .cwp-cryptogrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;height:420px;overflow:auto;}
        .cwp-coin{padding:14px;border:1px solid var(--line);border-radius:20px;background:rgba(0,0,0,.34);}
        .cwp-coin:hover{border-color:var(--green);background:rgba(199,217,136,.08);}
        .cwp-coin b{display:block;font:14px 'Unbounded',sans-serif;color:var(--green);margin-bottom:4px;}
        .cwp-coin span{font:10px 'Share Tech Mono',monospace;color:var(--muted);}
        .cwp-coin big{display:block;font:20px 'Share Tech Mono',monospace;color:var(--text);margin-top:8px;}
        nav.cwp-nav{position:absolute;left:24px;top:18px;z-index:2;width:408px;height:44px;display:grid;grid-template-columns:repeat(4,1fr);overflow:hidden;border:1px solid var(--darkLine);border-radius:999px;}
        nav.cwp-nav button{border:0;border-right:1px solid var(--darkLine);background:transparent;color:var(--textDark);font:700 9px 'Unbounded',sans-serif;cursor:pointer;transition:var(--ease);}
        nav.cwp-nav button:last-child{border-right:0;}
        nav.cwp-nav button:hover,nav.cwp-nav button.active{background:var(--black);color:var(--green);}
        .cwp-signal{position:absolute;right:24px;top:78px;z-index:2;width:130px;height:76px;display:grid;place-items:center;padding:8px;border:1px solid var(--darkLine);border-radius:25px 25px 58px 25px;}
        .cwp-signal span{font:8px 'Share Tech Mono',monospace;letter-spacing:.8px;}
        .cwp-waves{height:34px;display:flex;align-items:end;gap:4px;}
        .cwp-waves i{width:4px;background:var(--black);animation:cwpBars 1s infinite ease-in-out;}
        .cwp-waves i:nth-child(1){height:14px}.cwp-waves i:nth-child(2){height:24px;animation-delay:.1s}.cwp-waves i:nth-child(3){height:32px;animation-delay:.2s}.cwp-waves i:nth-child(4){height:22px;animation-delay:.3s}.cwp-waves i:nth-child(5){height:28px;animation-delay:.4s}
        @keyframes cwpBars{0%,100%{transform:scaleY(.55)}50%{transform:scaleY(1)}}
        .cwp-back{position:absolute;left:450px;top:78px;z-index:2;width:90px;height:38px;border:1px solid var(--darkLine);border-radius:999px;background:transparent;color:var(--textDark);font:700 9px 'Unbounded',sans-serif;cursor:pointer;transition:var(--ease);}
        .cwp-back:hover{background:var(--black);color:var(--green);}
        .cwp-side-top{position:absolute;top:38px;left:24px;right:24px;z-index:5;text-align:center;}
        .cwp-character strong{display:block;margin:5px 0 5px;font-family:'Unbounded',sans-serif;font-size:32px;line-height:.95;color:var(--textDark);letter-spacing:-2px;text-transform:uppercase;}
        .cwp-character small,.cwp-character span{display:block;font:9px 'Share Tech Mono',monospace;letter-spacing:1.6px;text-transform:uppercase;color:rgba(17,20,15,.62);}
        .cwp-capsule{position:absolute;left:24px;right:24px;bottom:24px;height:510px;overflow:hidden;border:8px solid var(--black);border-radius:150px 150px 34px 34px;background:var(--black);box-shadow:inset 0 0 0 1px rgba(199,217,136,.18),inset 0 0 42px rgba(199,217,136,.08);}
        .cwp-capsule>img{width:100%;height:100%;display:block;object-fit:cover;position:relative;z-index:0;filter:grayscale(.2) contrast(1.42) saturate(.55) brightness(.62);animation:cwpPulse 5.8s infinite ease-in-out;transition:var(--ease);}
        .cwp-capsule:before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(circle at 50% 50%,transparent 0 24%,rgba(5,7,5,.08) 30%,rgba(5,7,5,.76) 72%),linear-gradient(180deg,rgba(5,7,5,.08),rgba(199,217,136,.18) 48%,rgba(5,7,5,.72)),repeating-linear-gradient(0deg,rgba(255,255,255,.055) 0 1px,transparent 1px 7px),repeating-linear-gradient(90deg,rgba(199,217,136,.04) 0 1px,transparent 1px 19px);mix-blend-mode:multiply;}
        .cwp-capsule:after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 50% 52%,rgba(199,217,136,.24),transparent 29%),linear-gradient(90deg,transparent 0 48%,rgba(215,255,160,.16) 50%,transparent 52%),linear-gradient(180deg,transparent 0 35%,rgba(217,255,133,.08) 48%,transparent 60%);}
        .cwp-side-scan{position:absolute;left:0;right:0;top:-80px;height:80px;z-index:3;pointer-events:none;background:linear-gradient(180deg,transparent,rgba(217,255,133,.28),rgba(199,217,136,.06),transparent);mix-blend-mode:screen;animation:cwpSideScan 4.6s infinite linear;}
        @keyframes cwpSideScan{from{top:-90px}to{top:105%}}
        @keyframes cwpPulse{0%,100%{filter:grayscale(.2) contrast(1.42) saturate(.55) brightness(.58);transform:scale(1);}42%{filter:grayscale(.08) contrast(1.55) saturate(.72) brightness(.78);}70%{filter:grayscale(.24) contrast(1.32) saturate(.46) brightness(.5);}}
        .cwp-target{position:absolute;left:50%;top:51%;z-index:4;width:150px;height:150px;overflow:visible;border-radius:50%;background:var(--black);transform:translate(-50%,-50%);}
        .cwp-target:before{content:"";position:absolute;inset:-11px;border-radius:50%;opacity:.82;filter:blur(.5px);background:conic-gradient(from 20deg,transparent 0 12%,var(--green) 13% 22%,transparent 23% 38%,var(--green3) 39% 47%,transparent 48% 70%,var(--acid) 71% 77%,transparent 78% 100%);animation:cwpSpin 7s linear infinite;}
        .cwp-target:after{content:"";position:absolute;inset:-20px;border:1px solid rgba(199,217,136,.46);border-radius:50%;pointer-events:none;box-shadow:0 0 18px var(--glow),0 0 42px var(--deepGlow),inset 0 0 18px rgba(199,217,136,.22);}
        .cwp-avatar-fallback{position:relative;z-index:3;width:100%;height:100%;border:2px solid rgba(233,237,220,.48);border-radius:50%;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-family:'Unbounded',sans-serif;font-size:36px;color:var(--green);}
        @keyframes cwpSpin{to{transform:rotate(360deg)}}
        .cwp-scroll{overflow:auto;scrollbar-width:thin;scrollbar-color:var(--green3) rgba(5,7,5,.32);}
        .cwp-custlist{position:absolute;left:24px;top:168px;z-index:2;width:310px;max-height:120px;overflow:auto;display:flex;flex-wrap:wrap;gap:6px;}
        .cwp-custbtn{padding:5px 12px;border:1px solid var(--darkLine);border-radius:999px;background:transparent;color:var(--textDark);font:700 8px 'Unbounded',sans-serif;cursor:pointer;transition:var(--ease);white-space:nowrap;}
        .cwp-custbtn:hover,.cwp-custbtn.active{background:var(--black);color:var(--green);border-color:var(--green);}

        /* KYC Profile styles */
        .cwp-kyc-wrap{height:460px;overflow:auto;padding-right:4px;}
        .cwp-kyc-section{margin-bottom:14px;border:1px solid var(--line);border-radius:18px;padding:12px;}
        .cwp-kyc-title{font:700 9px 'Unbounded',sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:var(--green);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
        .cwp-kyc-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
        .cwp-kyc-field{display:flex;flex-direction:column;gap:3px;}
        .cwp-kyc-label{font:9px 'Share Tech Mono',monospace;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);}
        .cwp-kyc-val{font:12px 'Rajdhani',sans-serif;font-weight:600;color:var(--text);}
        .cwp-kyc-val.empty{color:var(--green3);font-style:italic;font-size:10px;}
        .cwp-kyc-badge{display:inline-block;padding:2px 10px;border-radius:999px;font:700 9px 'Unbounded',sans-serif;border:1px solid;}
        .cwp-kyc-input{background:rgba(0,0,0,.55);border:1px solid var(--line);border-radius:10px;padding:5px 8px;font:12px 'Share Tech Mono',monospace;color:var(--text);outline:none;width:100%;transition:var(--ease);}
        .cwp-kyc-input:focus{border-color:var(--green);background:rgba(199,217,136,.06);}
        .cwp-kyc-select{background:rgba(0,0,0,.55);border:1px solid var(--line);border-radius:10px;padding:5px 8px;font:11px 'Share Tech Mono',monospace;color:var(--text);outline:none;width:100%;cursor:pointer;}
        .cwp-kyc-select:focus{border-color:var(--green);}
        .cwp-kyc-btn{padding:7px 18px;border-radius:999px;font:700 9px 'Unbounded',sans-serif;cursor:pointer;transition:var(--ease);border:1px solid;}
        .cwp-kyc-btn.save{background:var(--green);color:var(--black);border-color:var(--green);}
        .cwp-kyc-btn.save:hover{background:var(--acid);}
        .cwp-kyc-btn.save:disabled{opacity:.5;cursor:not-allowed;}
        .cwp-kyc-btn.edit{background:transparent;color:var(--green);border-color:var(--green);}
        .cwp-kyc-btn.edit:hover{background:var(--glass2);}
        .cwp-kyc-btn.cancel{background:transparent;color:var(--muted);border-color:var(--line);}
        .cwp-kyc-btn.cancel:hover{border-color:var(--muted);}
        .cwp-kyc-msg{padding:6px 12px;border-radius:10px;font:11px 'Share Tech Mono',monospace;margin-bottom:8px;}
        .cwp-kyc-msg.ok{background:rgba(199,217,136,.12);border:1px solid var(--green);color:var(--green);}
        .cwp-kyc-msg.err{background:rgba(224,90,90,.12);border:1px solid #e05a5a;color:#e05a5a;}
      `}</style>
      {loadError && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 30, maxWidth: 420, border: '1px solid #5f6f38', background: '#10150e', color: '#d7dcc5', padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>
          {loadError}
        </div>
      )}

      <div className="cwp-body">
        <div className="cwp-wrap" ref={wrapRef} onMouseMove={handleMouseMove}>
          <div className="cwp-light" style={{ left: lightPos.x, top: lightPos.y }} />
          <div className="cwp-grain" />

          {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
          <section className="cwp-content">

            {/* ── WALLET PAGE ─────────────────────────────────────────── */}
            <div className={`cwp-page${activePage === 'WALLET' ? ' active' : ''}`}>
              <div className="cwp-head"><span>CUSTOMER WALLET</span><b>LIVE BALANCE</b></div>
              <div style={{ marginBottom: 10 }}>
                <h1 className="cwp-h1">{customer.name}</h1>
                <em className="cwp-em">{customer.email || 'no email on record'}</em>
              </div>
              <div className="cwp-main-layout">
                <div className="cwp-hero">
                  <img src={PAGE_HERO.WALLET} alt="wallet" />
                  <span className="cwp-scan" />
                </div>
                <div className="cwp-main-stack">
                  <div className="cwp-box">
                    <h2 className="cwp-h2">// Wallet Data</h2>
                    <div className="cwp-form">
                      <b>Balance</b>
                      <span>{balance?.currency} {Number(balance?.balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      <b>Currency</b><span>{balance?.currency || 'USD'}</span>
                      <b>Wallet Code</b><span>{customer.wallet_code || 'N/A'}</span>
                      <b>Wallet ID</b><span style={{ fontSize: 9 }}>{customer.wallet_id?.slice(0, 14)}…</span>
                      <b>Transactions</b><span>{transactions.length}</span>
                      <b>Crypto</b><span>{cryptos.filter(c => Number(c.balance) > 0).length} assets</span>
                      <b>Credits</b><span style={{ color: '#c7d988' }}>{activeCurrency} {credits.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      <b>Debits</b><span style={{ color: '#aab497' }}>{activeCurrency} {debits.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <div className="cwp-tbox cwp-scroll">
                    <h2 className="cwp-h2">// Account Info</h2>
                    <p className="cwp-p">ID: <span style={{ color: 'var(--green)', fontFamily: 'monospace', fontSize: 10 }}>{customer.id}</span></p>
                    <p className="cwp-p">Phone: <span style={{ color: 'var(--green)' }}>{customer.phone || 'N/A'}</span></p>
                    <p className="cwp-p">KYC: <span style={{ color: kycStatusColor[kycStatus] || 'var(--muted)' }}>{kycStatus}</span></p>
                    <p className="cwp-p">Risk: <span style={{ color: riskColor[riskLevel] || 'var(--muted)' }}>{riskLevel}</span></p>
                    <p className="cwp-p">Registered: <span style={{ color: 'var(--green)' }}>{customer.created_at ? new Date(customer.created_at).toLocaleDateString() : 'N/A'}</span></p>
                  </div>
                </div>
              </div>
              <div className="cwp-mrow">
                <div className="cwp-meter"><label>CREDITS <span>{creditPct}%</span></label><i style={{ '--value': creditPct + '%' } as CSSProperties} /></div>
                <div className="cwp-meter"><label>DEBITS <span>{debitPct}%</span></label><i style={{ '--value': debitPct + '%' } as CSSProperties} /></div>
                <div className="cwp-meter"><label>ACTIVITY <span>{activityPct}%</span></label><i style={{ '--value': activityPct + '%' } as CSSProperties} /></div>
              </div>
            </div>

            {/* ── TRANSACTIONS PAGE ────────────────────────────────────── */}
            <div className={`cwp-page${activePage === 'TRANSACTIONS' ? ' active' : ''}`}>
              <div className="cwp-head"><span>TRANSACTIONS</span><b>{transactions.length} RECORDS</b></div>
              <div className="cwp-txlist cwp-scroll">
                {transactions.length === 0 ? (
                  <div style={{ padding: 30, textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>NO TRANSACTIONS ON RECORD</div>
                ) : transactions.slice(0, 20).map((tx, i) => (
                  <div className="cwp-tx" key={tx.id || i}>
                    <div>
                      <div className="cwp-tx-icon">{tx.type === 'credit' ? '▲' : '▼'}</div>
                    </div>
                    <div>
                      <h2 className="cwp-h2" style={{ marginBottom: 2 }}>{sourceLabel(tx.source)}</h2>
                      <em className="cwp-em">{tx.reference || 'no reference'}</em>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                        <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 13, color: tx.type === 'credit' ? 'var(--green)' : 'var(--muted)' }}>
                          {tx.type === 'credit' ? '+' : '-'}{tx.currency || 'USD'} {Number(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </span>
                        <span style={{ fontFamily: 'Share Tech Mono,monospace', fontSize: 9, color: 'var(--faint)' }}>
                          {tx.created_at ? new Date(tx.created_at).toLocaleDateString() : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── CRYPTO PAGE ──────────────────────────────────────────── */}
            <div className={`cwp-page${activePage === 'CRYPTO' ? ' active' : ''}`}>
              <div className="cwp-head"><span>CRYPTO PORTFOLIO</span><b>{cryptos.filter(c => Number(c.balance) > 0).length} ASSETS</b></div>
              <div className="cwp-cryptogrid cwp-scroll">
                {cryptos.filter(c => Number(c.balance) > 0).length === 0 ? (
                  <div style={{ gridColumn: 'span 2', padding: 30, textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)' }}>NO CRYPTO HOLDINGS</div>
                ) : cryptos.filter(c => Number(c.balance) > 0).map((c, i) => (
                  <div className="cwp-coin" key={c.id || i}>
                    <b>{c.crypto_coin}</b>
                    <span>DIGITAL ASSET</span>
                    <big>{Number(c.balance).toFixed(6)}</big>
                  </div>
                ))}
              </div>
            </div>

            {/* ── PROFILE / KYC PAGE ───────────────────────────────────── */}
            <div className={`cwp-page${activePage === 'PROFILE' ? ' active' : ''}`}>
              <div className="cwp-head">
                <span>IDENTITY &amp; KYC</span>
                <b>{kycStatus}</b>
              </div>

              {/* action bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {!kycEdit ? (
                  <button className="cwp-kyc-btn edit" onClick={() => { setKycEdit(true); setKycMsg(null); }}>✎ EDIT KYC</button>
                ) : (
                  <>
                    <button className="cwp-kyc-btn save" disabled={kycBusy} onClick={saveKYC}>
                      {kycBusy ? '…' : '✓ SAVE'}
                    </button>
                    <button className="cwp-kyc-btn cancel" onClick={() => { setKycEdit(false); setKycForm(customer); setKycMsg(null); }}>CANCEL</button>
                  </>
                )}
                {kycMsg && <span className={`cwp-kyc-msg ${kycMsg.ok ? 'ok' : 'err'}`}>{kycMsg.text}</span>}
                <button
                  className="cwp-kyc-btn cancel"
                  disabled={deleteBusy}
                  onClick={removeCustomer}
                  style={{ marginLeft: 'auto', borderColor: '#ef4444', color: '#ef4444' }}
                >
                  {deleteBusy ? '…' : 'DELETE CUSTOMER'}
                </button>
                {deleteMsg && <span className="cwp-kyc-msg err">{deleteMsg}</span>}
              </div>

              <div className="cwp-kyc-wrap cwp-scroll">

                {/* ─ Status badges ─ */}
                <div className="cwp-kyc-section">
                  <div className="cwp-kyc-title">▸ STATUS</div>
                  <div className="cwp-kyc-grid">
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">KYC Status</span>
                      {kycEdit ? (
                        <select className="cwp-kyc-select" value={kycForm.kyc_status || 'PENDING'}
                          onChange={e => setKycForm(p => ({ ...p, kyc_status: e.target.value }))}>
                          {KYC_STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className="cwp-kyc-badge" style={{ color: kycStatusColor[kycStatus], borderColor: kycStatusColor[kycStatus] }}>
                          {kycStatus}
                        </span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Risk Level</span>
                      {kycEdit ? (
                        <select className="cwp-kyc-select" value={kycForm.risk_level || 'LOW'}
                          onChange={e => setKycForm(p => ({ ...p, risk_level: e.target.value }))}>
                          {RISK_LEVELS.map(r => <option key={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className="cwp-kyc-badge" style={{ color: riskColor[riskLevel], borderColor: riskColor[riskLevel] }}>
                          {riskLevel}
                        </span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Verified At</span>
                      <span className={`cwp-kyc-val${!customer.kyc_verified_at ? ' empty' : ''}`}>
                        {customer.kyc_verified_at ? new Date(customer.kyc_verified_at).toLocaleDateString() : 'not verified'}
                      </span>
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Occupation</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="e.g. Business Owner"
                          value={kycForm.occupation || ''}
                          onChange={e => setKycForm(p => ({ ...p, occupation: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.occupation ? ' empty' : ''}`}>{customer.occupation || 'not provided'}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ─ Identity document ─ */}
                <div className="cwp-kyc-section">
                  <div className="cwp-kyc-title">▸ IDENTITY DOCUMENT</div>
                  <div className="cwp-kyc-grid">
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Document Type</span>
                      {kycEdit ? (
                        <select className="cwp-kyc-select" value={kycForm.id_type || ''}
                          onChange={e => setKycForm(p => ({ ...p, id_type: e.target.value }))}>
                          <option value="">— select —</option>
                          {ID_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                      ) : (
                        <span className={`cwp-kyc-val${!customer.id_type ? ' empty' : ''}`}>{customer.id_type || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Document Number</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="e.g. A12345678"
                          value={kycForm.id_number || ''}
                          onChange={e => setKycForm(p => ({ ...p, id_number: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.id_number ? ' empty' : ''}`}>{customer.id_number || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Expiry Date</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" type="date"
                          value={kycForm.id_expiry || ''}
                          onChange={e => setKycForm(p => ({ ...p, id_expiry: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.id_expiry ? ' empty' : ''}`}>{customer.id_expiry || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Issuing Country</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="e.g. ZA, AE, PH"
                          value={kycForm.id_country || ''}
                          onChange={e => setKycForm(p => ({ ...p, id_country: e.target.value.toUpperCase().slice(0, 2) }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.id_country ? ' empty' : ''}`}>{customer.id_country || 'not provided'}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ─ Personal details ─ */}
                <div className="cwp-kyc-section">
                  <div className="cwp-kyc-title">▸ PERSONAL DETAILS</div>
                  <div className="cwp-kyc-grid">
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Date of Birth</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" type="date"
                          value={kycForm.date_of_birth || ''}
                          onChange={e => setKycForm(p => ({ ...p, date_of_birth: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.date_of_birth ? ' empty' : ''}`}>{customer.date_of_birth || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Nationality</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="e.g. ZA, PH, AE"
                          value={kycForm.nationality || ''}
                          onChange={e => setKycForm(p => ({ ...p, nationality: e.target.value.toUpperCase().slice(0, 2) }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.nationality ? ' empty' : ''}`}>{customer.nationality || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Phone</span>
                      <span className="cwp-kyc-val">{customer.phone || 'not provided'}</span>
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Email</span>
                      <span className="cwp-kyc-val" style={{ fontSize: 10 }}>{customer.email || 'not provided'}</span>
                    </div>
                  </div>
                </div>

                {/* ─ Address ─ */}
                <div className="cwp-kyc-section">
                  <div className="cwp-kyc-title">▸ ADDRESS</div>
                  <div className="cwp-kyc-grid">
                    <div className="cwp-kyc-field" style={{ gridColumn: 'span 2' }}>
                      <span className="cwp-kyc-label">Address Line 1</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="Street / Unit"
                          value={kycForm.address_line1 || ''}
                          onChange={e => setKycForm(p => ({ ...p, address_line1: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.address_line1 ? ' empty' : ''}`}>{customer.address_line1 || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field" style={{ gridColumn: 'span 2' }}>
                      <span className="cwp-kyc-label">Address Line 2</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="Suburb / District"
                          value={kycForm.address_line2 || ''}
                          onChange={e => setKycForm(p => ({ ...p, address_line2: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.address_line2 ? ' empty' : ''}`}>{customer.address_line2 || ''}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">City</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="City"
                          value={kycForm.city || ''}
                          onChange={e => setKycForm(p => ({ ...p, city: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.city ? ' empty' : ''}`}>{customer.city || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field">
                      <span className="cwp-kyc-label">Postal Code</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="e.g. 8450"
                          value={kycForm.postal_code || ''}
                          onChange={e => setKycForm(p => ({ ...p, postal_code: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.postal_code ? ' empty' : ''}`}>{customer.postal_code || 'not provided'}</span>
                      )}
                    </div>
                    <div className="cwp-kyc-field" style={{ gridColumn: 'span 2' }}>
                      <span className="cwp-kyc-label">Country</span>
                      {kycEdit ? (
                        <input className="cwp-kyc-input" placeholder="e.g. South Africa"
                          value={kycForm.country || ''}
                          onChange={e => setKycForm(p => ({ ...p, country: e.target.value }))} />
                      ) : (
                        <span className={`cwp-kyc-val${!customer.country ? ' empty' : ''}`}>{customer.country || 'not provided'}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ─ Notes ─ */}
                <div className="cwp-kyc-section">
                  <div className="cwp-kyc-title">▸ NOTES</div>
                  {kycEdit ? (
                    <textarea className="cwp-kyc-input" rows={3} placeholder="Internal notes for this customer..."
                      style={{ resize: 'vertical' }}
                      value={kycForm.notes || ''}
                      onChange={e => setKycForm(p => ({ ...p, notes: e.target.value }))} />
                  ) : (
                    <span className={`cwp-kyc-val${!customer.notes ? ' empty' : ''}`} style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {customer.notes || 'no notes'}
                    </span>
                  )}
                </div>

              </div>
            </div>

          </section>

          {/* ── CONTROLS ─────────────────────────────────────────────── */}
          <section className="cwp-controls">
            <nav className="cwp-nav">
              {PAGES.map(p => (
                <button key={p} className={activePage === p ? 'active' : ''} onClick={() => changePage(p)}>{p}</button>
              ))}
            </nav>
            <button className="cwp-back" onClick={() => navigate('/wallets')}>← BACK</button>
            <div className="cwp-signal">
              <div className="cwp-waves"><i /><i /><i /><i /><i /></div>
              <span>SIGNAL: <b>LIVE</b></span>
            </div>
            <div className="cwp-custlist">
              {allCustomers.slice(0, 8).map(c => (
                <button key={c.id}
                  className={`cwp-custbtn${c.id === customerId ? ' active' : ''}`}
                  onClick={() => navigate(`/customer-wallet-profile/${c.id}`)}>
                  {c.name.split(' ')[0].toUpperCase()}
                </button>
              ))}
            </div>
          </section>

          {/* ── SIDE PANEL ───────────────────────────────────────────── */}
          <aside className="cwp-side">
            <div className="cwp-side-top">
              <div className="cwp-character">
                <small>POS 201.3 // WALLET</small>
                <strong>{customer.name.split(' ')[0]}</strong>
                <span>{customer.wallet_code || 'PSW-0000-0000'}</span>
              </div>
            </div>
            <div className="cwp-capsule">
              <img src={sideImg} alt="side" />
              <span className="cwp-side-scan" />
              <div className="cwp-target">
                <div className="cwp-avatar-fallback">{initials}</div>
              </div>
            </div>
          </aside>

        </div>

        <div style={{ width: 900, maxWidth: '100%', margin: '10px auto 20px', textAlign: 'center', fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', fontFamily: 'Rajdhani,Arial,sans-serif', color: 'var(--muted)' }}>
          POS 201.3 · CUSTOMER WALLET PROFILE · PROTOCOL 201.3
        </div>
      </div>
    </>
  );
}