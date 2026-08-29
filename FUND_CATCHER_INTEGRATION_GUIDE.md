# Fund Catcher Engine - Integration Guide

## Overview
This guide explains how to integrate the Fund Catcher Engine's placeholder API calls with your actual systems.

## 1. Ledger Integration

### Current Placeholder (in `TransactionSnapshotBuilder.cs`)
```csharp
private async Task FetchLedgerRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    // In a real implementation, this would fetch from Ledger database/API
    // Placeholder for now
    await Task.CompletedTask;
    _logger.LogDebug("Ledger record fetch placeholder for STAN: {Stan}", snapshot.STAN);
}
```

### Implementation Steps

1. **Add Ledger Service Interface**
```csharp
public interface ILedgerService
{
    Task<LedgerRecord> GetTransactionAsync(string stan, CancellationToken cancellationToken);
    Task<bool> CreateCreditEntryAsync(LedgerEntry entry, CancellationToken cancellationToken);
    Task<bool> CreateReversalEntryAsync(LedgerEntry entry, CancellationToken cancellationToken);
}
```

2. **Implement Ledger Service**
```csharp
public class LedgerService : ILedgerService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<LedgerService> _logger;
    
    public async Task<LedgerRecord> GetTransactionAsync(string stan, CancellationToken cancellationToken)
    {
        // Call your ledger API
        var response = await _httpClient.GetAsync($"/api/ledger/transactions/{stan}", cancellationToken);
        // Parse and return
    }
    
    public async Task<bool> CreateCreditEntryAsync(LedgerEntry entry, CancellationToken cancellationToken)
    {
        // Call your ledger API to create credit
    }
    
    public async Task<bool> CreateReversalEntryAsync(LedgerEntry entry, CancellationToken cancellationToken)
    {
        // Call your ledger API to create reversal
    }
}
```

3. **Update TransactionSnapshotBuilder**
```csharp
private readonly ILedgerService _ledgerService;

private async Task FetchLedgerRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    var ledgerRecord = await _ledgerService.GetTransactionAsync(snapshot.STAN, cancellationToken);
    
    if (ledgerRecord != null)
    {
        snapshot.LedgerStatus = ledgerRecord.Status;
        snapshot.LedgerAmount = ledgerRecord.Amount;
        snapshot.LedgerTimestamp = ledgerRecord.Timestamp;
    }
}
```

4. **Update Recovery Strategy (TypeA)**
```csharp
// In TypeARecoveryStrategy.ExecuteAsync()
await _ledgerService.CreateCreditEntryAsync(new LedgerEntry
{
    TransactionId = snapshot.Id,
    Type = "CREDIT",
    Amount = snapshot.Amount,
    Reference = snapshot.RRN
}, cancellationToken);
```

5. **Register in Program.cs**
```csharp
builder.Services.AddHttpClient<ILedgerService, LedgerService>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Ledger:ApiUrl"]);
});
```

## 2. Gateway/Processor Integration

### Current Placeholder
```csharp
private async Task FetchGatewayRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    // In a real implementation, this would fetch from Gateway API
    // Placeholder for now
    await Task.CompletedTask;
}
```

### Implementation Steps

1. **Add Gateway Service**
```csharp
public interface IGatewayService
{
    Task<GatewayTransaction> GetTransactionAsync(string rrn, string stan, CancellationToken cancellationToken);
    Task<bool> VerifyAuthorizationAsync(string authCode, decimal amount, CancellationToken cancellationToken);
}
```

2. **Implement Gateway Service**
```csharp
public class GatewayService : IGatewayService
{
    private readonly HttpClient _httpClient;
    
    public async Task<GatewayTransaction> GetTransactionAsync(string rrn, string stan, CancellationToken cancellationToken)
    {
        // Query gateway for transaction status
        var response = await _httpClient.GetAsync($"/api/gateway/transactions?rrn={rrn}&stan={stan}", cancellationToken);
        // Return parsed response
    }
}
```

3. **Update Snapshot Builder**
```csharp
private readonly IGatewayService _gatewayService;

private async Task FetchGatewayRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    var gatewayTx = await _gatewayService.GetTransactionAsync(snapshot.RRN, snapshot.STAN, cancellationToken);
    
    if (gatewayTx != null)
    {
        snapshot.GatewayStatus = gatewayTx.Status;
        snapshot.GatewayTransactionId = gatewayTx.TransactionId;
        snapshot.GatewayTimestamp = gatewayTx.Timestamp;
    }
}
```

## 3. Bank Settlement Integration

### Current Placeholder
```csharp
private async Task FetchBankRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    // In a real implementation, this would fetch from Bank settlement API
    // Placeholder for now
    await Task.CompletedTask;
}
```

### Implementation Steps

1. **Add Bank Service**
```csharp
public interface IBankSettlementService
{
    Task<BankSettlement> GetSettlementByRrnAsync(string rrn, CancellationToken cancellationToken);
    Task<List<SettlementRecord>> GetSettlementFileAsync(DateTime date, CancellationToken cancellationToken);
}
```

2. **Implement Bank Service**
```csharp
public class BankSettlementService : IBankSettlementService
{
    private readonly HttpClient _httpClient;
    
    public async Task<BankSettlement> GetSettlementByRrnAsync(string rrn, CancellationToken cancellationToken)
    {
        // Query bank settlement records
    }
    
    public async Task<List<SettlementRecord>> GetSettlementFileAsync(DateTime date, CancellationToken cancellationToken)
    {
        // Fetch daily settlement file from bank
    }
}
```

3. **Update Snapshot Builder**
```csharp
private async Task FetchBankRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    var bankSettlement = await _bankService.GetSettlementByRrnAsync(snapshot.RRN, cancellationToken);
    
    if (bankSettlement != null)
    {
        snapshot.BankStatus = bankSettlement.Status;
        snapshot.BankSettlementId = bankSettlement.SettlementId;
        snapshot.BankTimestamp = bankSettlement.Timestamp;
    }
}
```

## 4. Payout System Integration

### Current Placeholder
```csharp
private async Task FetchPayoutRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    // In a real implementation, this would fetch from Payout system
    // Placeholder for now
    await Task.CompletedTask;
}
```

### Implementation Steps

1. **Add Payout Service**
```csharp
public interface IPayoutService
{
    Task<PayoutRecord> GetPayoutByRrnAsync(string rrn, CancellationToken cancellationToken);
    Task<PayoutRequest> ReissuePayoutAsync(PayoutRequest request, CancellationToken cancellationToken);
}
```

2. **Implement Payout Service**
```csharp
public class PayoutService : IPayoutService
{
    public async Task<PayoutRecord> GetPayoutByRrnAsync(string rrn, CancellationToken cancellationToken)
    {
        // Query payout records
    }
    
    public async Task<PayoutRequest> ReissuePayoutAsync(PayoutRequest request, CancellationToken cancellationToken)
    {
        // Submit new payout request
    }
}
```

3. **Update Snapshot Builder & Recovery**
```csharp
// In FetchPayoutRecordAsync
private async Task FetchPayoutRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
{
    var payout = await _payoutService.GetPayoutByRrnAsync(snapshot.RRN, cancellationToken);
    
    if (payout != null)
    {
        snapshot.PayoutStatus = payout.Status;
        snapshot.PayoutReference = payout.Reference;
    }
}

// In TypeDRecoveryStrategy.ExecuteAsync
var payoutRequest = new PayoutRequest
{
    Amount = snapshot.Amount,
    Currency = snapshot.Currency,
    Beneficiary = snapshot.BeneficiaryId,
    Reference = snapshot.RRN
};

var result = await _payoutService.ReissuePayoutAsync(payoutRequest, cancellationToken);
recovery.PayoutTriggered = result != null;
```

## 5. Wallet Service Integration

### Current Placeholder (in Recovery Strategies)
```csharp
if (snapshot.CustomerId.HasValue)
{
    // In real implementation, call wallet service
    recovery.WalletUpdated = true;
    recovery.BeneficiaryId = snapshot.CustomerId;
}
```

### Implementation Steps

1. **Add Wallet Service**
```csharp
public interface IWalletService
{
    Task<WalletBalance> GetBalanceAsync(Guid customerId, CancellationToken cancellationToken);
    Task<bool> CreditWalletAsync(Guid customerId, decimal amount, string reference, CancellationToken cancellationToken);
}
```

2. **Update Recovery Strategies**
```csharp
// In TypeARecoveryStrategy
private readonly IWalletService _walletService;

if (snapshot.CustomerId.HasValue)
{
    var creditResult = await _walletService.CreditWalletAsync(
        snapshot.CustomerId.Value,
        snapshot.Amount,
        snapshot.RRN,
        cancellationToken
    );
    recovery.WalletUpdated = creditResult;
}
```

3. **Register all services in Program.cs**
```csharp
builder.Services.AddScoped<ILedgerService, LedgerService>();
builder.Services.AddScoped<IGatewayService, GatewayService>();
builder.Services.AddScoped<IBankSettlementService, BankSettlementService>();
builder.Services.AddScoped<IPayoutService, PayoutService>();
builder.Services.AddScoped<IWalletService, WalletService>();
```

## 6. Configuration

Add to `appsettings.json`:

```json
{
  "Ledger": {
    "ApiUrl": "http://ledger-service:8080",
    "ApiKey": "your-api-key"
  },
  "Gateway": {
    "ApiUrl": "http://gateway-service:8080",
    "ApiKey": "your-api-key"
  },
  "BankSettlement": {
    "ApiUrl": "http://bank-service:8080",
    "ApiKey": "your-api-key"
  },
  "Payout": {
    "ApiUrl": "http://payout-service:8080",
    "ApiKey": "your-api-key"
  },
  "Wallet": {
    "ApiUrl": "http://wallet-service:8080",
    "ApiKey": "your-api-key"
  }
}
```

## Testing Integration

```csharp
[TestClass]
public class FundCatcherIntegrationTests
{
    [TestMethod]
    public async Task TestTypeARecoveryWithLedger()
    {
        // Arrange
        var mockLedgerService = new Mock<ILedgerService>();
        mockLedgerService.Setup(x => x.CreateCreditEntryAsync(It.IsAny<LedgerEntry>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        
        var engine = new FundCatcherEngine(...);
        
        // Act
        var result = await engine.RunAsync();
        
        // Assert
        Assert.IsTrue(result.IsSuccess);
        mockLedgerService.Verify(x => x.CreateCreditEntryAsync(It.IsAny<LedgerEntry>(), It.IsAny<CancellationToken>()), Times.Once);
    }
}
```

## Migration Checklist

- [ ] Create Ledger service implementation
- [ ] Create Gateway service implementation
- [ ] Create Bank Settlement service implementation
- [ ] Create Payout service implementation
- [ ] Create Wallet service implementation
- [ ] Update all snapshot builder methods
- [ ] Update all recovery strategies
- [ ] Add configuration settings
- [ ] Register all services in Program.cs
- [ ] Test in staging environment
- [ ] Deploy to production
- [ ] Monitor first few runs
- [ ] Adjust recovery amounts/strategies based on results

---

**Next Steps:** Start with Ledger integration, then proceed with other systems one at a time to ensure stability.
