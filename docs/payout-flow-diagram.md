# Payout flow diagram

This document shows the end-to-end money flow for card payments and payouts in this repository.

```mermaid
flowchart TD
    A[Customer pays with card] --> B[Payments controller]
    B --> C[Payments service]
    C --> D[Ledger entry created]
    C --> E[Merchant wallet credited]
    D --> F[Database persistence]
    E --> F
    F --> G[Batch / settlement record]
    G --> H[Settlement available for review]

    H --> I[Admin requests payout]
    I --> J[Bank payout router]
    J --> K[Debit merchant wallet]
    K --> L[Payout helper]
    L --> M[Payout provider service]
    M --> N[External bank provider]
    N --> O[Funds sent to bank destination]

    subgraph Files
        B[backend/src/domain/payments/payments.controller.ts]
        C[backend/src/domain/payments/payments.service.ts]
        D[backend/src/domain/ledger/ledger.service.ts]
        E[backend/src/domain/wallets/wallets.service.ts]
        F[backend/src/config/db.ts]
        G[backend/src/domain/batches/batches.service.ts]
        H[backend/src/domain/settlements/settlements.router.ts]
        J[backend/src/domain/payouts/bank.router.ts]
        L[backend/src/domain/payouts/payoutHelpers.ts]
        M[backend/src/domain/payouts/payoutProvider.service.ts]
    end
```

## Exact files involved

- Payment entry: [backend/src/domain/payments/payments.controller.ts](../backend/src/domain/payments/payments.controller.ts)
- Payment processing: [backend/src/domain/payments/payments.service.ts](../backend/src/domain/payments/payments.service.ts)
- Ledger handling: [backend/src/domain/ledger/ledger.service.ts](../backend/src/domain/ledger/ledger.service.ts)
- Merchant wallet updates: [backend/src/domain/wallets/wallets.service.ts](../backend/src/domain/wallets/wallets.service.ts)
- Database persistence: [backend/src/config/db.ts](../backend/src/config/db.ts)
- Batch / settlement: [backend/src/domain/batches/batches.service.ts](../backend/src/domain/batches/batches.service.ts)
- Settlement API: [backend/src/domain/settlements/settlements.router.ts](../backend/src/domain/settlements/settlements.router.ts)
- Payout route: [backend/src/domain/payouts/bank.router.ts](../backend/src/domain/payouts/bank.router.ts)
- Wallet debit helper: [backend/src/domain/payouts/payoutHelpers.ts](../backend/src/domain/payouts/payoutHelpers.ts)
- Provider integration: [backend/src/domain/payouts/payoutProvider.service.ts](../backend/src/domain/payouts/payoutProvider.service.ts)

## Short explanation

- Card payment is stored and credited to the merchant wallet.
- Payout is a separate later step that debits the wallet and sends money to the bank destination.
- Settlement records are for reconciliation and do not by themselves send funds.
