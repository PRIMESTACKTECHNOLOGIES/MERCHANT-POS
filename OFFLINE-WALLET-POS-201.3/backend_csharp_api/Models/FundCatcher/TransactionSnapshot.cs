namespace Pos2013.Api.Models.FundCatcher;

/// <summary>
/// Represents a unified snapshot of a transaction across all systems:
/// POS, Ledger, Gateway, and Bank records.
/// </summary>
public class TransactionSnapshot
{
    public Guid Id { get; set; }

    // Transaction identifiers
    public string RRN { get; set; } = string.Empty; // Retrieval Reference Number
    public string STAN { get; set; } = string.Empty; // System Trace Audit Number
    
    // Amount & Currency
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "AED";
    
    // POS Record Status
    public string? PosStatus { get; set; } // APPROVED, DECLINED, PENDING, etc.
    public string? PosAuthCode { get; set; }
    public DateTime? PosTimestamp { get; set; }
    
    // Ledger Record Status
    public string? LedgerStatus { get; set; } // CREDIT, DEBIT, NONE, REVERSED
    public decimal? LedgerAmount { get; set; }
    public DateTime? LedgerTimestamp { get; set; }
    
    // Gateway/Processor Status
    public string? GatewayStatus { get; set; } // APPROVED, DECLINED, PENDING
    public string? GatewayTransactionId { get; set; }
    public DateTime? GatewayTimestamp { get; set; }
    
    // Bank Settlement Status
    public string? BankStatus { get; set; } // APPROVED, DECLINED, PENDING, SETTLED
    public string? BankSettlementId { get; set; }
    public DateTime? BankTimestamp { get; set; }
    
    // Payout Status
    public string? PayoutStatus { get; set; } // SENT, RECEIVED, FAILED, MISSING
    public string? PayoutReference { get; set; }
    public DateTime? PayoutTimestamp { get; set; }
    
    // Owner Information
    public Guid? CustomerId { get; set; }
    public Guid? MerchantId { get; set; }
    public string? OwnerType { get; set; } // "Customer", "Merchant", "Bank"
    
    // Detected Mismatch
    public MismatchType? DetectedMismatchType { get; set; }
    public string? MismatchReason { get; set; }
    
    // Recovery Status
    public TransactionStatus Status { get; set; } = TransactionStatus.NEW_TRANSACTION;
    
    // Audit Trail
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
}
