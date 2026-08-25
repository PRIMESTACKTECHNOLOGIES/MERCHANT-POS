# Hot Wallet Menu - Complete Guide

## 🎯 Overview

A new **Hot Wallet** menu has been added to the sidebar, providing a dedicated management interface for all hot wallet operations including balance monitoring, transfers, withdrawals, transaction history, and settings.

---

## ✅ What's New

### 1. **New Sidebar Menu Item** 🔥

Added "Hot Wallet" to the sidebar navigation:
- **Location**: Between "Customer Wallets" and Settings separator
- **Icon**: Fire icon (🔥) representing hot wallet
- **Route**: `/hot-wallet`

### 2. **Comprehensive Hot Wallet Page**

A full-featured page with 5 tabs:

#### 📊 **Overview Tab**
- Balance cards for all assets (USDT, TRX, BNB, MATIC)
- Hot wallet status information
- Recent transaction list
- Quick stats (status, network, last activity, daily transactions)

#### 🔄 **Transfer Tab**
- Transfer crypto between wallets
- Options:
  - From: Hot Wallet / Treasury
  - To: Merchant Wallet / Customer Wallet / External Address
  - Asset selection (USDT, TRX, BNB, MATIC)
  - Amount input
  - Network selection
  - Reason/notes field

#### 💸 **Withdraw Tab**
- Withdraw crypto to external addresses
- Asset and amount selection
- Network selection
- Destination address input
- Reason/notes field

#### 📜 **History Tab**
- Complete transaction history
- Transaction types (deposit, withdraw, transfer)
- Status indicators (completed, pending, failed)
- Timestamps and destinations

#### ⚙️ **Settings Tab**
- Auto Transfer toggle
- Notifications toggle
- Two-Factor Authentication toggle
- Minimum balance alerts
- Maximum transfer amount limits

### 3. **Business Information Auto-Fill** 💾

Your business information is now automatically saved and pre-filled:

**Saved Information**:
```json
{
  "authorizedPerson": {
    "name": "Jukruti Jacob Dumba",
    "role": "Account Signatory",
    "email": "Jukrutidumba@gmail.com",
    "phone": "0607289532"
  },
  "businessInfo": {
    "businessName": "Jukruti Logistics (Pty) Ltd",
    "businessRegNumber": "2014/215965/07",
    "businessAddress": "9 Houtkapper Str, Olifantshoek, Northern Cape, 8450, South Africa",
    "businessPhone": "0607289532",
    "taxId": "9205076330089"
  }
}
```

---

## 🚀 **How to Use**

### Accessing Hot Wallet Page

1. **Click "Hot Wallet"** in the sidebar (🔥 icon)
2. You'll see the Overview tab by default

### Managing Hot Wallet

#### **View Balances**
- Balance cards show current amounts for each asset
- Gradient colors: USDT (green), TRX (red), BNB (yellow), MATIC (purple)
- Each card displays asset icon and balance

#### **Transfer Crypto**
1. Click **"🔄 Transfer"** tab or button
2. Select **From** wallet (Hot Wallet / Treasury)
3. Select **To** destination (Merchant / Customer / External)
4. Choose **Asset** (USDT, TRX, BNB, MATIC)
5. Enter **Amount**
6. Select **Network** (Tron, BSC, Polygon, Ethereum)
7. Add **Reason** (optional but recommended)
8. Click **"🔄 Execute Transfer"**

#### **Withdraw Crypto**
1. Click **"💸 Withdraw"** tab or button
2. Select **Asset**
3. Enter **Amount**
4. Select **Network**
5. Enter **Destination Address**
6. Add **Reason** (optional)
7. Click **"💸 Execute Withdrawal"**

#### **View History**
1. Click **"📜 History"** tab
2. See all transactions with:
   - Type (deposit ↓, withdraw ↑, transfer ⇄)
   - Amount and asset
   - Destination
   - Timestamp
   - Status (completed 🟢, pending 🟡, failed 🔴)

#### **Configure Settings**
1. Click **"⚙️ Settings"** tab
2. Toggle features:
   - **Auto Transfer**: Automatically move excess funds to treasury
   - **Notifications**: Receive alerts for transactions
   - **Two-Factor Auth**: Require 2FA for operations
3. Set thresholds:
   - **Min Balance Alert**: Get notified when balance is low
   - **Max Transfer Amount**: Limit per transaction
4. Click **"💾 Save Settings"**

---

## 💼 **Business Information Features**

### Auto-Fill on Payout

When you click **"Hot Wallet Payout"** from the Merchant Crypto Balance section:
1. Your business information is **automatically pre-filled**
2. All fields populate with saved data
3. You can edit if needed
4. Just add payout details and submit

### Saving Business Information

In the payout modal, there's a checkbox:
```
☑️ 💾 Save business information for future payouts
```

**How it works**:
1. Check the box **after filling in** your information
2. Data is saved to browser localStorage
3. Next time you open payout, fields auto-fill
4. Update and re-save anytime

### What Gets Saved

**Authorized Person**:
- Name
- Role/Title
- Email
- Phone

**Business Details**:
- Legal Name
- Registration Number
- Full Address
- Phone
- Tax ID

---

## 🎨 **UI/UX Features**

### Color-Coded Balance Cards
- **USDT**: Green gradient (emerald to teal)
- **TRX**: Red gradient (red to rose)
- **BNB**: Yellow gradient (yellow to amber)
- **MATIC**: Purple gradient (purple to indigo)

### Tab Navigation
- Clear tab labels with icons
- Active tab highlighted in blue gradient
- Smooth transitions

### Status Indicators
- **🟢 Completed**: Green background
- **🟡 Pending**: Amber/yellow background
- **🔴 Failed**: Rose/red background

### Transaction Type Icons
- **↓ Deposit**: Green
- **↑ Withdraw**: Red/rose
- **⇄ Transfer**: Blue

---

## 📊 **Hot Wallet Dashboard**

### Overview Stats

```
┌─────────────────────────────────────────┐
│ Status: 🟢 Online                       │
│ Network: Tron / BSC                     │
│ Last Activity: 2 mins ago               │
│ Total Txns Today: 12                    │
└─────────────────────────────────────────┘
```

### Balance Display

```
┌──────────────────┬──────────────────┐
│ ₮ USDT Balance   │ ⬡ TRX Balance    │
│ 15,000.50 USDT   │ 1,250.75 TRX     │
└──────────────────┴──────────────────┘
┌──────────────────┬──────────────────┐
│ 🟡 BNB Balance   │ 🟣 MATIC Balance │
│ 5.25 BNB         │ 850.00 MATIC     │
└──────────────────┴──────────────────┘
```

---

## 🔐 **Security Features**

### Built-in Safeguards
1. **Two-Factor Authentication** (when enabled)
2. **Maximum transfer limits**
3. **Transaction confirmations**
4. **Reason/notes tracking** for audit trail

### Best Practices
- ✅ Enable 2FA for withdrawals
- ✅ Set reasonable max transfer amounts
- ✅ Always add reason/notes
- ✅ Review transaction history regularly
- ✅ Keep min balance alerts active

---

## 🎯 **Common Use Cases**

### Use Case 1: Daily Balance Check
```
1. Open Hot Wallet page (sidebar)
2. View Overview tab
3. Check balance cards
4. Review recent transactions
```

### Use Case 2: Transfer to Merchant Wallet
```
1. Click Transfer tab
2. From: Hot Wallet
3. To: Merchant Wallet
4. Asset: USDT
5. Amount: 1000
6. Network: tron
7. Reason: "Daily settlement"
8. Execute Transfer
```

### Use Case 3: Withdraw to External Wallet
```
1. Click Withdraw tab
2. Asset: USDT
3. Amount: 500
4. Network: tron
5. Address: T123...abc
6. Reason: "Supplier payment"
7. Execute Withdrawal
```

### Use Case 4: Monthly Payout with Auto-Fill
```
1. Go to Merchant Crypto Balance section
2. Click "Hot Wallet Payout"
3. ✅ Business info automatically filled!
4. Enter destination address
5. Enter amount
6. Check "Save for future use"
7. Submit
```

---

## 💡 **Pro Tips**

### Tip 1: Use Keyboard Navigation
- Tab between fields
- Enter to submit forms
- Escape to close modals

### Tip 2: Monitor Balance Alerts
Set minimum balance alerts to avoid:
- Failed transactions due to insufficient funds
- Missed opportunities for transfers
- Gas fee issues

### Tip 3: Always Add Reasons
Even though optional, adding reasons helps:
- Audit trails
- Accounting
- Compliance
- Future reference

### Tip 4: Check Settings Regularly
Review settings monthly:
- Adjust transfer limits
- Update alert thresholds
- Enable/disable features as needed

### Tip 5: Use Transaction History
Filter and search history to:
- Track specific transactions
- Generate reports
- Verify completions
- Debug issues

---

## 🆕 **What's Different from Customer Wallets**

| Feature | Customer Wallets | Hot Wallet |
|---------|-----------------|------------|
| **Purpose** | Manage customer funds | Manage system funds |
| **Balances** | Per customer | System-wide |
| **Transfers** | Customer to customer | System transfers |
| **Withdrawals** | To customer external wallet | System withdrawals |
| **Access** | Customer-specific | Admin/operator |

---

## 🔄 **Integration with Existing Features**

### Merchant Crypto Balance
- **"Hot Wallet Payout"** button auto-fills business info
- Uses same validation and security
- Records stored in same database

### Customer Wallets
- Transfer from Hot Wallet to customer wallet
- Consistent UI/UX
- Shared transaction history

### Transaction Tracking
- All operations logged
- Audit trail maintained
- Status updates in real-time

---

## 📱 **Responsive Design**

The Hot Wallet page is fully responsive:

### Desktop View
- 4-column balance cards
- Side-by-side layouts
- Full-width forms

### Tablet View
- 2-column balance cards
- Stacked forms
- Touch-friendly buttons

### Mobile View
- 1-column balance cards
- Vertical layouts
- Hamburger menu for sidebar

---

## 🚨 **Troubleshooting**

### Hot Wallet Menu Not Visible
**Solution**: Refresh the page or clear browser cache

### Business Info Not Auto-Filling
**Solution**: 
1. Check the "Save for future use" checkbox
2. localStorage might be disabled - check browser settings
3. Try saving again

### Transfer/Withdraw Buttons Not Working
**Solution**:
1. Check all required fields are filled
2. Verify network connection
3. Check console for errors (F12)

### Balance Not Updating
**Solution**:
1. Refresh the page
2. Check recent transactions
3. Wait for blockchain confirmation

---

## 📞 **Support**

### For Issues
- Check browser console (F12)
- Review transaction history
- Contact system administrator

### For Questions
- Review this guide
- Check transaction logs
- Consult with finance team

---

## 🎓 **Training Checklist**

Before using Hot Wallet in production:

- [ ] Understand all 5 tabs and their purposes
- [ ] Know how to view balances
- [ ] Practice transfer operations (test environment)
- [ ] Practice withdrawal operations (test environment)
- [ ] Configure settings appropriately
- [ ] Test business info auto-fill
- [ ] Review security features
- [ ] Understand status indicators
- [ ] Know how to read transaction history
- [ ] Familiar with troubleshooting steps

---

## 📝 **Quick Reference**

### Keyboard Shortcuts
- **Tab**: Navigate between fields
- **Enter**: Submit current form
- **Escape**: Close modals

### Status Colors
- 🟢 **Green**: Completed, Success, Online
- 🟡 **Yellow/Amber**: Pending, Warning
- 🔴 **Red/Rose**: Failed, Error, Offline

### Transaction Types
- **↓**: Deposit (incoming)
- **↑**: Withdraw (outgoing)
- **⇄**: Transfer (internal)

---

**Last Updated**: August 24, 2026  
**Version**: 1.0  
**Status**: ✅ Live and Ready to Use

---

## 🎉 Summary

The new **Hot Wallet** menu provides a centralized, user-friendly interface for managing all hot wallet operations. Combined with automatic business information fill, it streamlines your workflow and reduces repetitive data entry.

**Key Benefits**:
- ✅ All hot wallet features in one place
- ✅ Clear, intuitive interface
- ✅ Auto-fill business information
- ✅ Complete transaction history
- ✅ Customizable settings
- ✅ Mobile responsive

**Your Business Info** is now saved and will auto-fill for **Jukruti Logistics (Pty) Ltd** payouts! 🚀
