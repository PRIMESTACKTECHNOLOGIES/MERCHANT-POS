# Trust Wallet Quick Reference Card

## 🎯 Quick Setup (5 Minutes)

### 1️⃣ Get Your Trust Wallet Address
```
Open Trust Wallet → Select Coin → Tap "Receive" → Copy Address
```

### 2️⃣ Common Networks
| Crypto | Recommended Network | Address Starts With | Fee Level |
|--------|---------------------|---------------------|-----------|
| USDT   | Tron (TRC20)       | T...                | 💚 Low ($1) |
| USDT   | Ethereum (ERC20)   | 0x...               | 🔴 High ($5-50) |
| USDC   | Ethereum           | 0x...               | 🟡 Medium |
| BTC    | Bitcoin            | bc1... or 1...      | 🟡 Medium |

### 3️⃣ Create Virtual Account in POS
1. Click **"+ New Virtual Account"**
2. Enter **Merchant Email** → Click **"Send OTP"**
3. Enter **OTP Code** → Click **"Verify"**
4. Select:
   - **Fiat**: GBP, EUR, or USD
   - **Crypto**: USDT (recommended)
   - **Network**: tron (for TRC20)
5. Paste **Trust Wallet Address**
6. Click **"Verify"** (wait for ✓)
7. Click **"Create Live Account"**

## ⚠️ Critical: Network Must Match!

### ✅ CORRECT Examples
- USDT + tron → Trust Wallet Tron address (T...)
- USDT + ethereum → Trust Wallet Ethereum address (0x...)
- BTC + bitcoin → Trust Wallet Bitcoin address

### ❌ WRONG (Will Lose Funds!)
- USDT + tron → Ethereum address (0x...)
- USDT + ethereum → Tron address (T...)

## 🔒 Security Checklist

- ✅ Recovery phrase saved offline
- ✅ Never share recovery phrase
- ✅ Enable biometric lock
- ✅ Keep app updated
- ✅ Double-check address before submit
- ✅ Verify network matches wallet

## 🚨 Troubleshooting

| Problem | Solution |
|---------|----------|
| Modal closes on error | **FIXED** - Now stays open |
| "Address not accepted" | Check network matches your wallet |
| No crypto received | Wait 1-3 days for bank processing |
| Wrong network used | ⚠️ Funds may be lost - contact support |

## 📱 Payment Flow

```
Customer Pays (Fiat) 
    ↓
Bank Transfer to Transak Virtual Account (1-3 days)
    ↓
Transak Converts to Crypto (minutes)
    ↓
Crypto Sent to Your Trust Wallet 
    ↓
You Receive Notification in Trust Wallet ✓
```

## 💡 Best Practices

1. **For Small Amounts**: Use Tron (TRC20) - lowest fees
2. **For Large Amounts**: Consider security over fees
3. **Test First**: Create account with small amount
4. **Keep Records**: Screenshot virtual account details
5. **Regular Checks**: Open Trust Wallet daily to see incoming payments

## 📞 Quick Support

- **Trust Wallet Issues**: https://trustwallet.com/support  
- **Transak Issues**: support@transak.com  
- **POS System**: Check browser console (F12) for errors

## 🎁 Pro Tips

✨ **Save $**: Use Tron for USDT (TRC20) - fees ~$1 vs $5-50 on Ethereum  
✨ **Speed**: Tron confirms in ~3 seconds, Ethereum ~15 seconds  
✨ **Reliability**: Verify address EVERY time - no undo button exists  
✨ **Notification**: Enable push notifications in Trust Wallet

---

**Need Detailed Guide?** See `TRUST_WALLET_SETUP_GUIDE.md`

**Last Updated**: August 2026
