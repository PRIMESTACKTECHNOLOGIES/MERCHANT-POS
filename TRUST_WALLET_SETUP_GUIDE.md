# Trust Wallet Setup Guide for POS System

## Overview
This guide explains how to set up your Trust Wallet to receive crypto payments from your POS system through Transak.

## What is Trust Wallet?
Trust Wallet is a secure, decentralized cryptocurrency wallet that allows you to receive, store, and manage various cryptocurrencies. When customers pay with fiat currency through your POS system, Transak automatically converts it to crypto and sends it directly to your Trust Wallet address.

## Setup Steps

### 1. Install Trust Wallet
- **iOS**: Download from the App Store
- **Android**: Download from Google Play Store
- **Always download from official sources only**

### 2. Create or Import Your Wallet
- Open Trust Wallet
- Create a new wallet or import an existing one
- **IMPORTANT**: Save your recovery phrase (12-24 words) in a secure location
- Never share your recovery phrase with anyone

### 3. Get Your Wallet Address

#### For USDT on Tron Network (Most Common):
1. Open Trust Wallet
2. Tap on "Tron (TRX)" in your wallet
3. Tap "Receive"
4. You'll see your Tron address (starts with "T", e.g., `TXyz1234...`)
5. Copy this address

#### For Other Cryptocurrencies:
- **USDT on Ethereum**: Tap on "Ethereum", then "Receive"
- **Bitcoin**: Tap on "Bitcoin", then "Receive"
- **USDC**: Tap on the specific network (Ethereum, Polygon, etc.)

### 4. Configure in POS System

1. Log into your POS Wallet interface
2. Navigate to the "Merchant Virtual Account" section
3. Click "+ New Virtual Account"
4. Fill in the form:
   - **Merchant Transak Email**: Your registered email with Transak
   - **Fiat Currency**: Choose GBP, EUR, or USD
   - **Payment Method**: Select appropriate bank transfer method
   - **Crypto Asset**: Choose USDT, USDC, BTC, or ETH
   - **Network**: 
     - For USDT, typically use "tron" (TRC20) - lower fees
     - For Ethereum-based tokens, use "ethereum"
   - **Trust Wallet Address**: Paste your copied address here
5. Click "Verify" to ensure Transak accepts your address
6. Once verified (✓), click "Create Live Account"

## Important Notes

### Network Compatibility
⚠️ **CRITICAL**: The network you select MUST match the network of your Trust Wallet address:
- USDT-TRC20 (Tron) → Use "tron" network
- USDT-ERC20 (Ethereum) → Use "ethereum" network
- Sending to the wrong network will result in lost funds!

### Verification
- Always verify your wallet address before creating the account
- The green checkmark (✓) confirms Transak can send to this address
- If you see a red X (✗), check:
  - The address is copied correctly
  - The network matches your wallet
  - The crypto asset is supported

### Security Best Practices
1. ✅ Keep your Trust Wallet recovery phrase offline and secure
2. ✅ Enable biometric authentication in Trust Wallet
3. ✅ Keep your Trust Wallet app updated
4. ✅ Double-check addresses before submitting
5. ❌ Never share your private keys or recovery phrase
6. ❌ Never send your wallet address via unsecured channels

## Receiving Payments

### How It Works:
1. Customer initiates payment through your POS system
2. Customer sends fiat currency (GBP/EUR/USD) via bank transfer to the Transak virtual account
3. Transak receives the fiat payment
4. Transak automatically converts fiat to crypto at current rates
5. Crypto is sent directly to your Trust Wallet address
6. You receive a notification in Trust Wallet

### Transaction Times:
- Bank transfer processing: 1-3 business days (depending on payment method)
- Crypto conversion and sending: Usually within minutes after fiat is received
- Total time: Typically 1-3 business days

## Troubleshooting

### Page Closes When Creating Virtual Account
**Fixed**: The system now keeps the modal open if there's an error, showing you the error message so you can fix it and retry.

### "Wallet address was not accepted by Transak"
- Verify you're using the correct network
- Ensure the address is copied correctly (no extra spaces)
- Check that Transak supports the crypto/network combination you selected

### Not Receiving Payments
1. Check the transaction status in your POS system
2. Verify the bank transfer was completed by the customer
3. Confirm your Trust Wallet address is correct in the virtual account
4. Check Trust Wallet on the correct network

### Need to Change Wallet Address
If you need to update your destination wallet address:
1. You may need to create a new virtual account with the new address
2. Contact Transak support if you need to modify an existing account

## Support

### Trust Wallet Support
- Website: https://trustwallet.com
- Help Center: https://community.trustwallet.com

### Transak Support
- Dashboard: Login to your Transak merchant account
- Contact: support@transak.com

### POS System Support
- Check the backend logs if virtual account creation fails
- Ensure you have a stable internet connection
- Verify your Transak API credentials are configured correctly

## Test Before Going Live

Before accepting real payments:
1. Create a test virtual account
2. Send a small test transaction
3. Verify you receive it in Trust Wallet
4. Confirm the amount and network are correct

## Recommended Networks by Use Case

| Use Case | Recommended Crypto | Network | Why |
|----------|-------------------|---------|-----|
| Low fees, fast | USDT | Tron (TRC20) | Lowest fees (~$1), fast |
| Most compatible | USDT | Ethereum (ERC20) | Widely supported, higher fees (~$5-50) |
| Stablecoin alternative | USDC | Ethereum or Polygon | Similar to USDT, regulated |
| Investment holding | BTC | Bitcoin | Store of value, higher fees |
| DeFi/dApps | ETH | Ethereum | Native Ethereum, for smart contracts |

---

**Last Updated**: August 2026

For the latest information, always check Trust Wallet's official documentation and Transak's merchant guidelines.
