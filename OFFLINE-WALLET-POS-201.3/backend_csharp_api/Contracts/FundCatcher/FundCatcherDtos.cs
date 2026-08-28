namespace Pos2013.Api.Contracts.FundCatcher;

/// <summary>
/// DTO for triggering Fund Catcher Engine runs.
/// </summary>
public class TriggerFundCatcherRequest
{
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
}

/// <summary>
/// DTO for Fund Catcher Engine run response.
/// </summary>
public class FundCatcherEngineRunDto
{
    public Guid Id { get; set; }
    public string RunId { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    
    public int TransactionsScanned { get; set; }
    public int MismatchesDetected { get; set; }
    public int RecoveriesAttempted { get; set; }
    public int RecoveriesSucceeded { get; set; }
    public int RecoveriesFailed { get; set; }
    public int RecoveriesPartial { get; set; }
    
    public decimal TotalRecoveredAmount { get; set; }
    public string Currency { get; set; } = "AED";
    
    public int TypeACount { get; set; }
    public int TypeBCount { get; set; }
    public int TypeCCount { get; set; }
    public int TypeDCount { get; set; }
    
    public bool IsSuccess { get; set; }
    public string? ErrorMessage { get; set; }
    
    public long ExecutionTimeMs { get; set; }
}

/// <summary>
/// DTO for Fund Recovery record.
/// </summary>
public class FundRecoveryDto
{
    public Guid Id { get; set; }
    public Guid TransactionSnapshotId { get; set; }
    
    public string MismatchType { get; set; } = string.Empty;
    public string? MismatchReason { get; set; }
    
    public string RecoveryAction { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal? RecoveredAmount { get; set; }
    public string? RecoveryReference { get; set; }
    
    public bool LedgerUpdated { get; set; }
    public bool WalletUpdated { get; set; }
    public bool PayoutTriggered { get; set; }
    
    public DateTime CreatedAt { get; set; }
    public DateTime ExecutedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    
    public string? ErrorMessage { get; set; }
    public int? RetryCount { get; set; }
}

/// <summary>
/// DTO for Audit Log.
/// </summary>
public class FundCatcherAuditLogDto
{
    public Guid Id { get; set; }
    public Guid? EngineRunId { get; set; }
    public Guid? TransactionSnapshotId { get; set; }
    
    public string EventType { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? AffectedSystem { get; set; }
    
    public DateTime CreatedAt { get; set; }
    public string SeverityLevel { get; set; } = "INFO";
}

/// <summary>
/// DTO for Transaction Snapshot.
/// </summary>
public class TransactionSnapshotDto
{
    public Guid Id { get; set; }
    
    public string RRN { get; set; } = string.Empty;
    public string STAN { get; set; } = string.Empty;
    
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "AED";
    
    public string? PosStatus { get; set; }
    public string? LedgerStatus { get; set; }
    public string? GatewayStatus { get; set; }
    public string? BankStatus { get; set; }
    public string? PayoutStatus { get; set; }
    
    public string? DetectedMismatchType { get; set; }
    public string? MismatchReason { get; set; }
    
    public string Status { get; set; } = string.Empty;
    
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
