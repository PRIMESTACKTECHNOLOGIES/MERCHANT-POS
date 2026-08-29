# Fund Catcher Engine - Implementation Guide

## Overview
The Fund Catcher Engine is a production-grade transaction reconciliation and recovery system built into the C# Backend API. It automatically detects financial mismatches across POS, Ledger, Gateway, and Bank systems, then applies appropriate recovery strategies to restore funds.

## Architecture

### System Components

```
[POS Records] [Ledger] [Gateway] [Bank Settlement] [Payout System]
          ↓        ↓        ↓            ↓                ↓
    ┌─────────────────────────────────────────────────────┐
    │   TransactionSnapshotBuilder                         │
    │   (Unified view across all systems)                  │
    └──────────────────┬──────────────────────────────────┘
                       ↓
            ┌─────────────────────────┐
            │  MismatchClassifier     │
            │  (Type A, B, C, D)      │
            └──────────────┬──────────┘
                           ↓
        ┌──────────────────────────────────────┐
        │  RecoveryStrategyExecutor             │
        │  ├─ TypeA: Missing Credit            │
        │  ├─ TypeB: Wrong Debit               │
        │  ├─ TypeC: Phantom POS               │
        │  └─ TypeD: Missing Payout            │
        └──────────────────┬────────────────────┘
                           ↓
                ┌──────────────────────┐
                │  FundCatcherEngine   │
                │  (Orchestrator)      │
                └──────────────────────┘
                    ↓          ↓
            [Database]   [Audit Logs]
```

## Database Schema

### Tables Created

1. **TransactionSnapshots**
   - Unified transaction records across all systems
   - Stores RRN, STAN, amounts, and status from each system
   - Tracks detected mismatches and recovery status

2. **FundRecoveries**
   - Records of recovery actions applied
   - Tracks recovery status, amount, and beneficiary
   - Stores retry count and error messages

3. **EngineRuns**
   - Statistics and metadata for each Fund Catcher run
   - Counts of mismatches by type
   - Total recovered amounts
   - Execution time and success status

4. **AuditLogs**
   - Detailed event log of all operations
   - Event types: MISMATCH_DETECTED, RECOVERY_APPLIED, RECOVERY_SUCCESS, etc.
   - Severity levels: INFO, WARNING, ERROR, CRITICAL

## Mismatch Types & Recovery

### Type A: Missing Credit
**Condition:** Bank APPROVED → Ledger NONE
- **Cause:** Funds approved at bank but not credited to customer wallet
- **Recovery Action:** Create ledger credit entry and update wallet balance
- **Beneficiary:** Customer Wallet

### Type B: Wrong Debit
**Condition:** Ledger DEBITED → Bank DECLINED
- **Cause:** Customer's wallet was debited but bank declined the transaction
- **Recovery Action:** Reverse the debit by creating a credit entry
- **Beneficiary:** Customer Wallet

### Type C: Phantom POS
**Condition:** POS APPROVED → Gateway/Bank UNKNOWN
- **Cause:** Transaction approved at POS but never reached gateway/bank
- **Recovery Action:** Confirm no gateway record, reverse phantom ledger if exists
- **Beneficiary:** Customer Wallet (if phantom debit exists)

### Type D: Missing Payout
**Condition:** Settlement SENT → Payout MISSING
- **Cause:** Settlement file sent to bank but payout to customer was never issued
- **Recovery Action:** Compare settlement vs. payout files, reissue missing payouts
- **Beneficiary:** Bank Payout Queue

## API Endpoints

### 1. Trigger Engine Run
```
POST /api/fund-catcher/run
Content-Type: application/json

{
  "startDate": "2026-08-25T00:00:00Z",
  "endDate": "2026-08-27T23:59:59Z"
}

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "runId": "uuid",
    "startedAt": "2026-08-27T10:30:00Z",
    "completedAt": "2026-08-27T10:35:15Z",
    "transactionsScanned": 1250,
    "mismatchesDetected": 45,
    "recoveriesAttempted": 45,
    "recoveriesSucceeded": 42,
    "recoveriesFailed": 2,
    "recoveriesPartial": 1,
    "totalRecoveredAmount": 12500.50,
    "currency": "AED",
    "typeACount": 15,
    "typeBCount": 12,
    "typeCCount": 10,
    "typeDCount": 8,
    "isSuccess": true,
    "executionTimeMs": 315000
  }
}
```

### 2. Get Engine Run Status
```
GET /api/fund-catcher/run/{runId}

Response:
{
  "success": true,
  "data": { /* same as above */ }
}
```

### 3. List Fund Recoveries
```
GET /api/fund-catcher/recoveries?status=SUCCESS&pageSize=100&pageNumber=1

Query Parameters:
- status: SUCCESS | FAILED | PENDING | PARTIAL (optional)
- pageSize: (default 100)
- pageNumber: (default 1)

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "transactionSnapshotId": "uuid",
      "mismatchType": "MissingCredit",
      "mismatchReason": "Bank approved but ledger has no credit",
      "recoveryAction": "CREATE_LEDGER_CREDIT",
      "status": "SUCCESS",
      "recoveredAmount": 250.50,
      "recoveryReference": "REC-123456789-20260827101530",
      "ledgerUpdated": true,
      "walletUpdated": true,
      "payoutTriggered": false,
      "createdAt": "2026-08-27T10:15:00Z",
      "executedAt": "2026-08-27T10:15:05Z",
      "completedAt": "2026-08-27T10:15:08Z"
    }
  ],
  "pagination": {
    "pageSize": 100,
    "pageNumber": 1,
    "total": 42
  }
}
```

### 4. Get Recovery Details
```
GET /api/fund-catcher/recoveries/{recoveryId}

Response:
{
  "success": true,
  "data": { /* recovery record as above */ }
}
```

### 5. List Audit Logs
```
GET /api/fund-catcher/audit-logs?eventType=RECOVERY_SUCCESS&pageSize=100

Query Parameters:
- eventType: ENGINE_START | MISMATCH_DETECTED | RECOVERY_APPLIED | RECOVERY_SUCCESS | RECOVERY_FAILED | ENGINE_COMPLETE | ENGINE_ERROR (optional)
- pageSize: (default 100)
- pageNumber: (default 1)

Response:
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "engineRunId": "uuid",
      "transactionSnapshotId": "uuid",
      "eventType": "RECOVERY_SUCCESS",
      "message": "Recovery succeeded. Reference: REC-123456789-20260827101530",
      "affectedSystem": "Ledger",
      "createdAt": "2026-08-27T10:15:08Z",
      "severityLevel": "INFO"
    }
  ],
  "pagination": {
    "pageSize": 100,
    "pageNumber": 1,
    "total": 156
  }
}
```

### 6. Get Engine Statistics
```
GET /api/fund-catcher/stats

Response:
{
  "success": true,
  "data": {
    "totalRecoveriesSucceeded": 342,
    "totalRecoveriesFailed": 8,
    "totalRecoveriesPending": 12,
    "totalRecoveredAmount": 125000.75,
    "successRate": 97.72
  }
}
```

## Background Job Execution

The Fund Catcher Engine runs automatically via a background service:
- **Schedule:** Every 6 hours (configurable)
- **Initial Run:** Immediately on application startup
- **Date Range:** Last 24 hours (configurable)
- **Logging:** All runs logged to `EngineRuns` table

### Configuration

To modify the schedule, edit `FundCatcherBackgroundJob.cs`:

```csharp
// Change the interval (currently 6 hours)
_interval = TimeSpan.FromHours(6);
```

To change the date range in `FundCatcherEngine.RunAsync()`:

```csharp
startDate ??= DateTime.UtcNow.AddDays(-1);  // Adjust days here
```

## File Structure

```
backend_csharp_api/
├── Models/
│   └── FundCatcher/
│       ├── MismatchType.cs           (Enums)
│       ├── TransactionSnapshot.cs    (Snapshot entity)
│       ├── FundRecovery.cs           (Recovery entity)
│       └── FundCatcherEngineRun.cs   (Run & audit log entities)
├── Services/
│   └── FundCatcher/
│       ├── TransactionSnapshotBuilder.cs    (Snapshot builder)
│       ├── MismatchClassifier.cs            (Classifier logic)
│       ├── RecoveryStrategies.cs            (Recovery implementations)
│       ├── FundCatcherEngine.cs             (Main orchestrator)
│       └── FundCatcherMapper.cs             (DTO mapper)
├── Services/
│   └── FundCatcherBackgroundJob.cs   (Background job)
├── Contracts/
│   └── FundCatcher/
│       └── FundCatcherDtos.cs        (API DTOs)
├── Endpoints/
│   └── FundCatcherEndpoints.cs       (API routes)
├── Data/
│   └── AppDbContext.cs               (Updated with Fund Catcher DbSets)
└── Program.cs                        (Updated with service registration)
```

## Integration Points

The Fund Catcher Engine integrates with:

1. **POS System**
   - Reads transaction records from `PaymentCodes` table
   - Uses STAN as transaction identifier

2. **Ledger System**
   - Checks ledger status for each transaction
   - Creates credit/reversal entries on recovery
   - *Currently placeholder* - integrate with actual ledger API

3. **Gateway/Processor**
   - Fetches transaction status from gateway
   - Verifies authorization codes
   - *Currently placeholder* - integrate with actual gateway API

4. **Bank Settlement**
   - Checks bank settlement status
   - Verifies bank approval/decline
   - Compares settlement files
   - *Currently placeholder* - integrate with actual bank API

5. **Payout System**
   - Reissues missing payouts
   - Tracks payout status
   - *Currently placeholder* - integrate with actual payout service

6. **Wallet Service**
   - Updates customer wallet balances
   - Updates merchant wallet balances
   - *Currently placeholder* - integrate with actual wallet service

## Implementation Status

✅ **Completed:**
- Database schema and models
- Transaction snapshot builder (with POS integration)
- Mismatch classifier with all 4 types
- Recovery strategies for all mismatch types
- Fund Catcher Engine orchestrator
- Background job scheduler
- API endpoints with DTOs
- Audit logging and tracking
- Error handling and retry logic

⏳ **To Integrate:**
- Real Ledger API calls (replace placeholders)
- Real Gateway/Processor API calls
- Real Bank Settlement API calls
- Real Payout system calls
- Real Wallet service calls
- Database migrations script

## Production Considerations

1. **Database Backup:** Ensure regular backups before running engine
2. **Rate Limiting:** Add rate limiting to API endpoints
3. **Monitoring:** Monitor engine runs via `EngineRuns` table
4. **Alerts:** Set up alerts for failed recoveries
5. **Auditing:** Review audit logs regularly
6. **Testing:** Test recovery strategies in staging first
7. **Performance:** Consider pagination for large transaction volumes
8. **Security:** Validate all external API calls

## Error Handling

The engine implements robust error handling:
- **Transaction-level errors:** Logged and skipped, engine continues
- **Recovery execution errors:** Marked as FAILED, stored for manual review
- **Engine-level errors:** Entire run marked as failed, stored with error message

All errors are logged to the `AuditLogs` table with SEVERITY "ERROR" or "CRITICAL".

## Testing

### Manual Testing Example

```bash
# Trigger a run for the last 24 hours
curl -X POST http://localhost:5000/api/fund-catcher/run \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-08-26T00:00:00Z",
    "endDate": "2026-08-27T23:59:59Z"
  }'

# Get run status
curl http://localhost:5000/api/fund-catcher/run/{runId}

# List successful recoveries
curl "http://localhost:5000/api/fund-catcher/recoveries?status=SUCCESS"

# Get engine statistics
curl http://localhost:5000/api/fund-catcher/stats
```

## Support & Maintenance

For issues or enhancements:
1. Check `FundCatcherAuditLog` table for error details
2. Review failed recovery attempts
3. Verify external API integrations
4. Monitor background job execution logs

---

**Last Updated:** 2026-08-27
**Version:** 1.0
**Production Ready:** Yes (with external API integrations)
