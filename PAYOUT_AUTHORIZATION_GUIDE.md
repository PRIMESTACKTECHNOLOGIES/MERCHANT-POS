# Merchant Crypto Payout Authorization Guide

## Overview

The payout engine now requires **authorized merchant information** and **business details** for all crypto payouts. This ensures proper documentation, compliance, and audit trails for all financial transactions.

---

## 🎯 What's New

### Required Information for Payouts

Every crypto payout now requires two categories of information:

#### 1. **Authorized Person Information** (Who is authorizing this payout?)
- Full name of the person authorizing the payout
- Their role/title in the organization
- Contact email
- Contact phone (optional)

#### 2. **Business Information** (What business is making this payout?)
- Business legal name
- Business registration number (optional)
- Full business address
- Business phone (optional)
- Tax ID / VAT number (optional)

#### 3. **Payout Details** (Why is this payout being made?)
- Payout reason/notes (optional but recommended)
- Destination crypto address
- Amount in USD
- Crypto asset (USDT, BTC, ETH, etc.)
- Network (tron, bsc, ethereum, etc.)

---

## 📱 **How to Submit a Payout** (Updated Process)

### Step 1: Access Hot Wallet Payout

1. Navigate to the **Wallets** page
2. Go to the **Merchant Crypto Balance** section
3. Click **"Hot Wallet Payout"** button

### Step 2: Fill in Authorized Person Information

```
┌─────────────────────────────────────────┐
│ 📋 Authorized Merchant Information      │
├─────────────────────────────────────────┤
│ Authorized Person Name *                │
│ [John Smith___________________]         │
│                                         │
│ Authorization Role/Title *              │
│ [CFO___________________________]        │
│                                         │
│ Contact Email *                         │
│ [john.smith@business.com_______]        │
│                                         │
│ Contact Phone                           │
│ [+1234567890___________________]        │
└─────────────────────────────────────────┘
```

**Required Fields:**
- ✅ Authorized Person Name
- ✅ Authorization Role/Title  
- ✅ Contact Email
- ⭕ Contact Phone (optional)

### Step 3: Fill in Business Information

```
┌─────────────────────────────────────────┐
│ 🏢 Business Information                  │
├─────────────────────────────────────────┤
│ Business Legal Name *                   │
│ [Acme Corporation Ltd_________]         │
│                                         │
│ Business Registration Number            │
│ [12345678_____________________]         │
│                                         │
│ Business Address *                      │
│ [123 Main Street              ]         │
│ [Suite 100, New York, NY 10001]         │
│                                         │
│ Business Phone    │ Tax ID/VAT Number   │
│ [+1234567890____] │ [TAX-123456_______] │
└─────────────────────────────────────────┘
```

**Required Fields:**
- ✅ Business Legal Name
- ✅ Business Address
- ⭕ Business Registration Number (optional)
- ⭕ Business Phone (optional)
- ⭕ Tax ID / VAT Number (optional)

### Step 4: Enter Payout Details

```
┌─────────────────────────────────────────┐
│ 💰 Payout Details                        │
├─────────────────────────────────────────┤
│ Asset:    [USDT ▼]                      │
│ Network:  [tron_______________]         │
│ Address:  [T1234567890abcdef...]        │
│ Amount:   [1000.00] USD                 │
│                                         │
│ Payout Reason / Notes                   │
│ [Monthly supplier payment       ]       │
│ [Invoice #12345                 ]       │
└─────────────────────────────────────────┘
```

**Required Fields:**
- ✅ Asset
- ✅ Network
- ✅ Destination Address
- ✅ Amount (USD)
- ⭕ Payout Reason (optional but recommended)

### Step 5: Review and Submit

Click **"Send from Hot Wallet"** to submit the payout.

---

## 🔒 **What Happens in the Backend**

### 1. Validation
The system validates that all required fields are present:
- Authorized person name, role, and email
- Business name and address
- Valid crypto destination address
- Positive amount

### 2. Authorization Logging
The system logs the authorization:
```
[Payout Authorization] 
Merchant: MRC-1001
Amount: 1000.00 USDT
Authorized by: John Smith (CFO) <john.smith@business.com>
Business: Acme Corporation Ltd
```

### 3. Database Storage
All information is stored in the `merchant_crypto_withdrawals` table in the `meta` JSON field:

```json
{
  "ref": "DEL-1234567890",
  "provider": "tronweb",
  "debit_final": true,
  "authorizedPerson": {
    "name": "John Smith",
    "role": "CFO",
    "email": "john.smith@business.com",
    "phone": "+1234567890"
  },
  "businessInfo": {
    "businessName": "Acme Corporation Ltd",
    "businessRegNumber": "12345678",
    "businessAddress": "123 Main Street, Suite 100, New York, NY 10001",
    "businessPhone": "+1234567890",
    "taxId": "TAX-123456"
  },
  "payoutReason": "Monthly supplier payment - Invoice #12345",
  "authorizedAt": "2026-08-24T10:30:00.000Z"
}
```

### 4. Payout Processing
The payout is processed through the hot wallet rail as normal.

---

## 📊 **Benefits of This System**

### 1. Audit Trail
- Every payout has a clear record of who authorized it
- Business information is attached to every transaction
- Timestamp of authorization is recorded

### 2. Compliance
- Meets regulatory requirements for business payouts
- Provides documentation for tax authorities
- Helps with anti-money laundering (AML) compliance

### 3. Accountability
- Clear responsibility for each payout
- Contact information for follow-up questions
- Business context for each transaction

### 4. Fraud Prevention
- Requires explicit authorization for each payout
- Business information must match registered details
- Audit trail deters unauthorized payouts

---

## 🔍 **Audit & Reporting**

### Viewing Payout Records

Payout records can be queried from the database:

```sql
SELECT 
  id,
  merchant_id,
  amount_usd,
  asset,
  address,
  network,
  status,
  created_at,
  json_extract(meta, '$.authorizedPerson.name') as authorized_by,
  json_extract(meta, '$.authorizedPerson.role') as authorized_role,
  json_extract(meta, '$.businessInfo.businessName') as business_name,
  json_extract(meta, '$.payoutReason') as reason,
  json_extract(meta, '$.authorizedAt') as authorized_at
FROM merchant_crypto_withdrawals
ORDER BY created_at DESC;
```

### Sample Output:

| Authorized By | Role | Business | Amount | Asset | Reason | Date |
|---------------|------|----------|--------|-------|--------|------|
| John Smith | CFO | Acme Corp | $1,000 | USDT | Supplier payment | 2026-08-24 |
| Jane Doe | Finance Mgr | Acme Corp | $500 | BTC | Refund | 2026-08-23 |

---

## ⚠️ **Important Notes**

### 1. Required Fields Cannot Be Skipped
All required fields must be filled out. The system will reject payouts that are missing:
- Authorized person name
- Authorization role
- Authorized email
- Business legal name
- Business address

### 2. Information Must Be Accurate
- Use legal business names, not trade names (unless they're the same)
- Provide complete addresses
- Use business email addresses (not personal)
- Ensure contact information is current

### 3. Authorization Role Must Be Appropriate
The person authorizing the payout should have the authority to do so within the organization. Common roles:
- ✅ CFO (Chief Financial Officer)
- ✅ Finance Manager
- ✅ Owner / Director
- ✅ Authorized Signatory
- ❌ Junior staff without authorization

### 4. Privacy & Security
- This information is stored securely in the database
- Access is restricted to authorized personnel
- Information is used for compliance and audit purposes only

---

## 🚨 **Troubleshooting**

### Error: "Authorized person information required"
**Solution**: Fill in all required fields in the "Authorized Merchant Information" section:
- Authorized Person Name
- Authorization Role/Title
- Contact Email

### Error: "Business information required"
**Solution**: Fill in all required fields in the "Business Information" section:
- Business Legal Name
- Business Address

### Error: "Authorized person email is required"
**Solution**: Provide a valid email address for the authorized person.

### Payout Form Is Too Long / Too Much Information
**Why**: This information is required for compliance, audit trails, and fraud prevention. It ensures every payout is properly documented and can be traced back to an authorized individual.

### Can I Save Business Information for Future Payouts?
**Future Enhancement**: Currently, you need to enter this information for each payout. A future version may include:
- Saved business profiles
- Authorized person profiles
- Default information that can be edited per-payout

---

## 📋 **Checklist Before Submitting Payout**

Before clicking "Send from Hot Wallet", verify:

- [ ] Authorized person name is correct
- [ ] Authorization role reflects actual position
- [ ] Contact email is a valid business email
- [ ] Contact phone is provided (optional but recommended)
- [ ] Business legal name matches registered business
- [ ] Business registration number is correct (if applicable)
- [ ] Business address is complete and accurate
- [ ] Tax ID is correct (if applicable)
- [ ] Payout reason is clear and descriptive
- [ ] Crypto address is correct
- [ ] Network matches the destination address
- [ ] Amount is correct
- [ ] I have authority to authorize this payout

---

## 👥 **Who Can Authorize Payouts?**

Typically, the following roles can authorize crypto payouts:

### High Authority (Usually Always Approved)
- **Owner / Proprietor**
- **CEO / Managing Director**
- **CFO / Finance Director**
- **Authorized Board Members**

### Medium Authority (May Need Limits)
- **Finance Manager**
- **Accounting Manager**
- **Authorized Signatories**

### Low Authority (Usually Not Approved for Large Amounts)
- **Accountants** (with explicit authorization)
- **Bookkeepers** (with limits)

**Note**: Your organization should have an internal approval matrix defining who can authorize payouts and at what limits.

---

## 💡 **Best Practices**

### 1. Use Business Email Addresses
Always use official business email addresses, not personal emails like Gmail or Yahoo.

**✅ Good**: john.smith@acmecorp.com  
**❌ Bad**: john.smith123@gmail.com

### 2. Keep Business Information Updated
If your business changes address, registration number, or other details, update it for future payouts.

### 3. Be Descriptive in Payout Reasons
Clear payout reasons help with accounting and auditing.

**✅ Good**: "Monthly supplier payment - Invoice #12345 - ABC Supplies Ltd"  
**❌ Bad**: "Payment"

### 4. Verify Before Submitting
Double-check all information before clicking submit. Blockchain transactions are irreversible.

### 5. Keep Records
Maintain a separate record (Excel, accounting software) of all payouts with:
- Date
- Amount
- Purpose
- Who authorized
- Confirmation details

### 6. Regular Audits
Periodically review payout records to ensure:
- All payouts were legitimate
- Authorized by appropriate personnel
- Business information was correct
- Amounts match invoices/records

---

## 🔧 **Technical Details**

### Frontend Validation
The UI enforces required fields before allowing submission:
- Client-side validation prevents incomplete forms
- Real-time feedback shows missing fields
- Clear error messages guide users

### Backend Validation
The API validates all payouts:
```typescript
// Validate authorized person
if (!authorizedPerson?.name || !authorizedPerson?.role || !authorizedPerson?.email) {
  return res.status(400).json({ error: 'Authorized person information required' });
}

// Validate business information
if (!businessInfo?.businessName || !businessInfo?.businessAddress) {
  return res.status(400).json({ error: 'Business information required' });
}
```

### Database Schema
Authorization data is stored in the `meta` JSON column of `merchant_crypto_withdrawals` table:
- Flexible schema allows for future additions
- Easily queryable with JSON functions
- Maintains full audit history

---

## 📞 **Support & Questions**

### Common Questions

**Q: Why is this information required?**  
A: For compliance, audit trails, fraud prevention, and accountability. Every business payout should be properly documented.

**Q: Is this information secure?**  
A: Yes. Information is stored securely in the database with restricted access. It's used only for compliance and audit purposes.

**Q: Can I automate payouts?**  
A: Not currently. Each payout requires explicit authorization with current business information. This is by design for security.

**Q: What if I make a mistake?**  
A: Contact support immediately if you submitted incorrect information. The payout may be reversible depending on blockchain confirmation status.

**Q: Is this information shared with third parties?**  
A: No. Information is used internally for compliance and may be shared with auditors or regulators if required by law.

---

**Last Updated**: August 24, 2026  
**Version**: 1.0  
**Status**: ✅ Active & Required for All Payouts
