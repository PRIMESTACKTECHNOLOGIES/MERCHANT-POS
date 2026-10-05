const axios = require('axios');
(async () => {
  const base = 'http://127.0.0.1:7000';
  try {
    const r = await axios.post(base + '/auth/login', { username: 'admin', password: 'admin123' });
    const tok = r.data.token;
    const auth = { headers: { Authorization: 'Bearer ' + tok } };

    async function gt(label, url) {
      try { const r = await axios.get(base + url, auth); console.log(label, r.status, JSON.stringify(r.data).slice(0,260)); }
      catch (e) {
        const msg = String(e.message || '').slice(0,120);
        const rs = JSON.stringify(e.response?.data || null).slice(0, 240);
        console.log(label, 'ERR', msg, '\n   resp=', rs);
      }
    }
    async function pt(label, url, body) {
      try { const r = await axios.post(base + url, body, auth); console.log(label, r.status, JSON.stringify(r.data).slice(0,260)); }
      catch (e) {
        const msg = String(e.message || '').slice(0,120);
        const rs = JSON.stringify(e.response?.data || null).slice(0, 240);
        console.log(label, 'ERR', msg, '\n   resp=', rs);
      }
    }

    console.log('\n=== API (POST /api/customers to create one demo customer) ===');
    await pt('/api/customers [CREATE]', '/api/customers', { name: 'POST-RESET-TEST', email: 'reset@example.com', phone: '0500000000' });
    console.log('\n=== /merchant/v1 endpoints (real merchant API) ===');
    await gt('/merchant/v1/terminals', '/merchant/v1/terminals');
    await gt('/merchant/v1/products',   '/merchant/v1/products');
    await gt('/merchant/v1/settings',   '/merchant/v1/settings/merchant/MRC-1001');
    await gt('/merchant/v1/batches',    '/merchant/v1/batches');
    await gt('/merchant/v1/transactions/pos', '/merchant/v1/transactions/pos');
    console.log('\n=== merchant wallet balances ===');
    await gt('/api/wallet/merchant/MRC-1001/balances', '/api/wallet/merchant/MRC-1001/balances');
  } catch (e) {
    console.log('LOGIN FAIL', String(e.message || e), '\n' + JSON.stringify(e.response?.data || null).slice(0, 400));
  }
})();
