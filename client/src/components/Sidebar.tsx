import { NavLink, useNavigate } from "react-router-dom";
import { useDarkMode } from "../hooks/useDarkMode";

const Icons = {
  POS: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  Overview: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  Wallet: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M4.5 6.75h15.75m-15.75 3h15.75m-15.75 3h15.75m-15.75 3h15.75M16.5 9.75v-3h-3v3h3z" />
    </svg>
  ),
  Terminals: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25" />
    </svg>
  ),
  Transactions: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Batches: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  Settlements: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  Settings: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 018.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.795 23.91 23.91 0 01-1.014 5.795m-3.8-11.59a23.847 23.847 0 018.835 2.535m0 0l.657-.38c.551-.318 1.26-.117 1.527.461a20.845 20.845 0 011.44 4.282m-3.102-.069a18.03 18.03 0 01.59 4.59c0 1.586-.205 3.124-.59 4.59m0-9.18a23.848 23.848 0 01-8.835-2.535" />
    </svg>
  ),
  ApiKeys: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  ),
  PaymentMethods: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
    </svg>
  ),
  OfflineViewer: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
    </svg>
  ),
  Security: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
    </svg>
  ),
  Printer: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5h15a2.25 2.25 0 012.25 2.25v6a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 18.75v-6a2.25 2.25 0 012.25-2.25z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a2.25 2.25 0 00-2.25-2.25H9.75a2.25 2.25 0 00-2.25 2.25v3.75" />
    </svg>
  ),
  Receipt: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  HotWallet: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
    </svg>
  ),
  Logout: () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  ),
};

export const Sidebar = ({ isOpen = false, onClose }: { isOpen?: boolean; onClose?: () => void }) => {
  const navigate = useNavigate();
  const { dark, toggle } = useDarkMode();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    "nav-link" + (isActive ? " active" : "");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          onClick={onClose}
        />
      )}
      
      <aside className={`sidebar fixed lg:sticky top-0 left-0 h-screen transition-transform duration-300 z-50 ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex justify-between items-center pr-4">
          <div className="sidebar-logo">
            <span style={{ color: 'var(--accent-primary)' }}>POS</span>
            <span style={{ marginLeft: '6px' }}>201.3</span>
          </div>
          {/* Mobile Close Button */}
          <button onClick={onClose} className="lg:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="sidebar-pos-button" style={{ padding: '16px' }}>
          <NavLink 
            to="/payment-processor" 
            className="flex items-center justify-center gap-3 w-full py-4 px-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-2xl font-bold shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 border border-white/10"
            onClick={() => onClose?.()}
          >
            <div className="p-2 bg-white/20 rounded-xl">
              <Icons.POS />
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm leading-tight">PAYMENT PROCESSOR</span>
              <span className="text-[10px] opacity-70 font-medium">101.1 · 101.6 · 201.3 · Normal</span>
            </div>
          </NavLink>
        </div>

        <nav className="sidebar-nav">
          <NavLink to="/overview" className={linkClass} onClick={() => onClose?.()}>
            <Icons.Overview />
            Dashboard
          </NavLink>
        <NavLink to="/terminals" className={linkClass} onClick={() => onClose?.()}>
          <Icons.Terminals />
          Terminals
        </NavLink>
        <NavLink to="/transactions" className={linkClass} onClick={() => onClose?.()}>
          <Icons.Transactions />
          Transactions
        </NavLink>
        <NavLink to="/batches" className={linkClass} onClick={() => onClose?.()}>
          <Icons.Batches />
          Batches
        </NavLink>
        <NavLink to="/settlements" className={linkClass}>
          <Icons.Settlements />
          Settlement Reports
        </NavLink>
        <NavLink to="/wallets" className={linkClass} onClick={() => onClose?.()}>
          <Icons.Wallet />
          Customer Wallets
        </NavLink>
        <NavLink to="/hot-wallet" className={linkClass} onClick={() => onClose?.()}>
          <Icons.HotWallet />
          Hot Wallet
        </NavLink>
        <NavLink to="/vault" className={linkClass} onClick={() => onClose?.()}>
          <Icons.Wallet />
          Processor Vault
        </NavLink>
        <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '8px 16px' }}></div>

        <NavLink to="/settings" className={linkClass}>
          <Icons.Settings />
          Merchant Settings
        </NavLink>
        <NavLink to="/developer" className={linkClass}>
          <Icons.ApiKeys />
          Developer API Keys
        </NavLink>
        <NavLink to="/payment-methods" className={linkClass}>
          <Icons.PaymentMethods />
          Payment Methods
        </NavLink>
        <NavLink to="/offline-transactions" className={linkClass}>
          <Icons.OfflineViewer />
          Offline Transaction Viewer
        </NavLink>
        <NavLink to="/device-security" className={linkClass}>
          <Icons.Security />
          Device Security & Keys
        </NavLink>
        <NavLink to="/receipts" className={linkClass}>
          <Icons.Receipt />
          Receipts
        </NavLink>
      </nav>
      
      <div style={{ marginTop: 'auto', padding: '0 16px 16px' }}>
        {/* Dark / Light Mode Toggle */}
        <button
          onClick={toggle}
          className="nav-link"
          style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', marginBottom: '4px' }}
        >
          <span style={{ fontSize: '18px', lineHeight: 1 }}>{dark ? '☀️' : '🌙'}</span>
          <span style={{ flex: 1, textAlign: 'left' }}>{dark ? 'Light Mode' : 'Dark Mode'}</span>
          {/* Toggle pill */}
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            width: '40px',
            height: '22px',
            borderRadius: '11px',
            background: dark ? '#3B82F6' : '#D1D5DB',
            padding: '2px',
            transition: 'background 0.25s',
            flexShrink: 0,
          }}>
            <span style={{
              display: 'block',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: 'white',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              transform: dark ? 'translateX(18px)' : 'translateX(0)',
              transition: 'transform 0.25s',
            }} />
          </span>
        </button>

        <button 
          onClick={handleLogout}
          className="nav-link" 
          style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}
        >
          <Icons.Logout />
          Logout
        </button>
      </div>
    </aside>
    </>
  );
};
