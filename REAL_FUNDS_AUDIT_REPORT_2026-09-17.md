# Real Funds Audit Report

**Audit date:** 2026-09-17  
**Scope:** Local Protocol 201.3 project database and payout/crypto transaction records  
**Mode:** Read-only; no database or balance changes were made

## Executive summary

The audit separates current internal balances from unsupported historical, manual, or unverified records.

| Asset | Amount counted as currently available | Basis |
|---|---:|---|
| Merchant USD (`MRC-1001`) | **7,280.00 USD** | Current `merchant_wallets.balance` |
| Customer USD (`cc6f0711-831e-4e36-afe7-8eb1dc7277b1`) | **2,000.00 USD** | Current `customer_wallets.balance`; sourced from internal merchant credit |
| Customer USDT (`cc6f0711-831e-4e36-afe7-8eb1dc7277b1`) | **250 USDT** | 1,000 USDT provider-backed purchase less 750 USDT sweep |
| Merchant EUR (`MRC-1001`) | **0.00 EUR** | Current `merchant_wallets.balance` |
| Merchant USDT balance table | **0 USDT** | Current `merchant_crypto_balances.amount` |

## Merchant fiat wallet

Merchant: `MRC-1001`

| Currency | Wallet balance |
|---|---:|
| USD | **7,280.00** |
| EUR | **0.00** |

### Merchant wallet transaction totals

| Currency | Source | Type | Count | Total |
|---|---|---|---:|---:|
| USD | `pos_voice_auth` | credit | 12 | 9,181.00 USD |
| USD | `offline_batch` | credit | 1 | 99.00 USD |
| USD | `merchant_to_customer` | debit | 1 | 2,000.00 USD |

The current USD balance is consistent with the normal wallet ledger:

```text
9,181.00 USD POS credits - 2,000.00 USD merchant-to-customer debit
= 7,181.00 USD
```

The database also contains a separate **99.00 USD offline batch credit**. The dashboard's pending figure includes that transaction, but it is not represented as a normal current merchant wallet credit in the same way as the POS credits.

## Dashboard pending figure reconciliation

The dashboard query reports transactions whose batch is not marked `PROCESSED`.

| Currency | Transactions | Dashboard amount |
|---|---:|---:|
| USD | 13 | **9,280.00 USD** |

The 13 USD transactions consist of:

- 12 POS transactions totaling **9,181.00 USD** that already have wallet-credit records.
- 1 pending transaction totaling **99.00 USD** with no matching wallet-credit record.

Pending transaction:

```text
ID:      6d2e1c16-25ea-44b4-8b5c-43aec80b8a1c
Amount:  99.00 USD
Status:  PENDING
Batch:   BATCH-000002
```

Therefore, the amount that is actually missing from the normal merchant wallet credit trail is **99.00 USD**, not 9,280.00 USD.

## Customer wallet

| Customer | Currency | Balance | Evidence |
|---|---|---:|---|
| `cc6f0711-831e-4e36-afe7-8eb1dc7277b1` | USD | **2,000.00** | `merchant_credit`, reference `MCT-479B432C` |
| Other customer USD wallets | USD | **0.00 each** | No current balance |

The 2,000.00 USD customer balance is an internal wallet credit. It is not independently confirmed as an external bank or processor settlement.

## Crypto purchase records

### Provider-backed completed purchase

| Field | Value |
|---|---|
| Asset | USDT |
| Fiat currency | USD |
| Fiat amount | **1,000.00 USD** |
| Crypto amount | **1,000 USDT** |
| Provider mode | `tron` |
| Source | `wallet_balance` |
| Status | `completed` |
| Mock flag | `0` |
| Transaction ID | `094365de-ce4d-446a-a810-15e6ec94eae8` |
| Transaction date | 2026-09-16 16:31:21 |

### Completed sweep

| Field | Value |
|---|---|
| Asset | USDT |
| Amount | **750 USDT** |
| Transaction type | `hot_wallet_sweep` |
| Status | `COMPLETED` |
| Mock flag | `0` |
| Transaction ID | `5001c23f-e8d8-4ab5-9769-6e076a915774` |
| Transaction date | 2026-09-16 16:34:39 |

### Current supported crypto amount

```text
1,000 USDT provider-backed purchase
- 750 USDT completed sweep
= 250 USDT remaining
```

The current customer crypto wallet balance is **250 USDT**, matching the supported transaction history.

## Unsupported or unverified crypto records

### Merchant customer-crypto record: 25,500 USDT

The database contains:

```text
Owner:   MRC-1001
Asset:   USDT
Balance: 25,500 USDT
```

This amount has no matching crypto purchase history in `crypto_transactions`. It should not be counted as verified available crypto without a provider statement, wallet ownership proof, or on-chain transaction evidence.

### Historical merchant crypto balance: 1,555 USDT

The merchant crypto balance was changed to zero using a manual adjustment with:

```text
source:          manual_vault_adjustment
onChainTransfer: false
reason:          User-authorized removal of full unwanted internal merchant USDT balance
previousAmount:  1555
```

Because `onChainTransfer` was false, the record does not prove that the 1,555 USDT was transferred externally. It is treated as removed/unverified historical accounting, not current funds.

## Currency availability conclusion

### Verified or internally supported for crypto activity

- **USD:** Available in the merchant wallet: **7,280.00 USD**.
- **USDT:** Available in the customer crypto wallet with matching provider-backed history: **250 USDT**.

### Not currently available or not verified

- **EUR:** Merchant wallet balance is **0.00 EUR**.
- **Merchant USDT:** Current `merchant_crypto_balances` amount is **0 USDT**.
- **25,500 USDT record:** Unsupported by matching purchase history; do not count.
- **1,555 USDT historical record:** Manually removed and marked `onChainTransfer=false`; do not count.

## Limitations

This report verifies internal records and provider-mode flags only. It does not independently prove custody at a bank, Wise, TRON, Binance, or another external provider.

External verification still required for a custody-grade statement:

1. Confirm the TRON wallet balance for the relevant wallet address.
2. Confirm the transaction hash for the 1,000 USDT purchase.
3. Confirm the provider account balance and order status.
4. Confirm bank or payment-provider custody of the USD balance.

## Audit status

**No funds were deleted, corrected, or moved by this audit.**
