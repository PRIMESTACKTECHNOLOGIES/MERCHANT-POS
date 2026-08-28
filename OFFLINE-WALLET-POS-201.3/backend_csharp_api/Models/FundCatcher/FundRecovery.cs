namespace Pos2013.Api.Models.FundCatcher;

/// <summary>
/// Records recovery actions applied to transactions by the Fund Catcher Engine.
/// </summary>
public class FundRecovery
{
    public Guid Id { get; set; }
    
    // Reference to the transaction snapshot
    public Guid TransactionSnapshotId { get; set; }
    
    // Mismatch Information
    public MismatchType MismatchType { get; set; }
    public string? MismatchReason { get; set; }
    
    // Recovery Action Taken
    public string RecoveryAction { get; set; } = string.Empty;
    public string? RecoveryDetails { get; set; } // JSON with operation details
    
    // Recovery Result
    public RecoveryStatus Status { get; set; } = RecoveryStatus.PENDING;
    public decimal? RecoveredAmount { get; set; }
    public string? RecoveryReference { get; set; }
    
    // Affected Systems
    public bool LedgerUpdated { get; set; }
    public bool WalletUpdated { get; set; }
    public bool PayoutTriggered { get; set; }
    
    // Audit Trail
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExecutedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    
    // Error Tracking (if recovery failed)
    public string? ErrorMessage { get; set; }
    public int? RetryCount { get; set; }
    public int MaxRetries { get; set; } = 3;
    
    // Beneficiary
    public Guid? BeneficiaryId { get; set; } // Customer, Merchant, or Bank account ID
    public string? BeneficiaryType { get; set; } // "Customer", "Merchant", "Bank"
    
    // Notes
    public string? Notes { get; set; }
}
