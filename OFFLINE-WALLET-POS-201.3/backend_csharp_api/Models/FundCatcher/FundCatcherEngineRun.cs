namespace Pos2013.Api.Models.FundCatcher;

/// <summary>
/// Tracks the execution status and statistics of Fund Catcher Engine runs.
/// </summary>
public class FundCatcherEngineRun
{
    public Guid Id { get; set; }
    
    // Run Information
    public string RunId { get; set; } = Guid.NewGuid().ToString();
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    
    // Statistics
    public int TransactionsScanned { get; set; }
    public int MismatchesDetected { get; set; }
    public int RecoveriesAttempted { get; set; }
    public int RecoveriesSucceeded { get; set; }
    public int RecoveriesFailed { get; set; }
    public int RecoveriesPartial { get; set; }
    
    // Financial Impact
    public decimal TotalRecoveredAmount { get; set; }
    public string Currency { get; set; } = "AED";
    
    // Breakdown by Mismatch Type
    public int TypeACount { get; set; } // Missing Credits
    public int TypeBCount { get; set; } // Wrong Debits
    public int TypeCCount { get; set; } // Phantom POS
    public int TypeDCount { get; set; } // Missing Payouts
    
    // Status
    public bool IsSuccess { get; set; }
    public string? ErrorMessage { get; set; }
    
    // Execution Details
    public long ExecutionTimeMs { get; set; }
    public string? Details { get; set; } // JSON with detailed execution log
}

/// <summary>
/// Detailed audit log for Fund Catcher Engine operations.
/// </summary>
public class FundCatcherAuditLog
{
    public Guid Id { get; set; }
    
    // Reference Information
    public Guid? EngineRunId { get; set; }
    public Guid? TransactionSnapshotId { get; set; }
    public Guid? FundRecoveryId { get; set; }
    
    // Event Information
    public string EventType { get; set; } = string.Empty; // MISMATCH_DETECTED, RECOVERY_APPLIED, RECOVERY_SUCCESS, RECOVERY_FAILED, etc.
    public string Message { get; set; } = string.Empty;
    public string? Details { get; set; } // JSON with additional context
    
    // Affected Systems
    public string? AffectedSystem { get; set; } // "Ledger", "Wallet", "Payout", "POS", etc.
    public string? AffectedEntityId { get; set; } // Customer ID, Merchant ID, Transaction ID, etc.
    
    // Timestamp
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Severity Level
    public string SeverityLevel { get; set; } = "INFO"; // INFO, WARNING, ERROR, CRITICAL
}
