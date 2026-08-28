using Pos2013.Api.Models.FundCatcher;

namespace Pos2013.Api.Services.FundCatcher;

/// <summary>
/// Classifies transaction snapshots to detect mismatch types.
/// </summary>
public interface IMismatchClassifier
{
    MismatchType? ClassifyMismatch(TransactionSnapshot snapshot, out string reason);
}

public class MismatchClassifier : IMismatchClassifier
{
    private readonly ILogger<MismatchClassifier> _logger;

    public MismatchClassifier(ILogger<MismatchClassifier> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Classifies a transaction snapshot to detect mismatches.
    /// Returns null if no mismatch is detected.
    /// </summary>
    public MismatchType? ClassifyMismatch(TransactionSnapshot snapshot, out string reason)
    {
        reason = string.Empty;

        try
        {
            // Type A: Bank APPROVED, Ledger NONE (Missing Credit)
            if (IsBankApproved(snapshot.BankStatus) && IsLedgerMissing(snapshot.LedgerStatus))
            {
                reason = $"Bank approved ({snapshot.BankStatus}) but ledger has no credit record";
                _logger.LogInformation("Mismatch Type A detected for RRN {Rrn}: {Reason}", snapshot.RRN, reason);
                return MismatchType.MissingCredit;
            }

            // Type B: Ledger DEBITED, Bank DECLINED (Wrong Debit)
            if (IsLedgerDebited(snapshot.LedgerStatus) && IsBankDeclined(snapshot.BankStatus))
            {
                reason = $"Ledger shows debit ({snapshot.LedgerStatus}) but bank declined ({snapshot.BankStatus})";
                _logger.LogInformation("Mismatch Type B detected for RRN {Rrn}: {Reason}", snapshot.RRN, reason);
                return MismatchType.WrongDebit;
            }

            // Type C: POS APPROVED, Gateway/Bank UNKNOWN (Phantom POS)
            if (IsPosApproved(snapshot.PosStatus) && IsGatewayUnknown(snapshot.GatewayStatus) && IsBankUnknown(snapshot.BankStatus))
            {
                reason = $"POS approved ({snapshot.PosStatus}) but no gateway/bank record found";
                _logger.LogInformation("Mismatch Type C detected for RRN {Rrn}: {Reason}", snapshot.RRN, reason);
                return MismatchType.PhantomPOS;
            }

            // Type D: Settlement SENT, Payout MISSING
            if (IsSettlementSent(snapshot.BankStatus) && IsPayoutMissing(snapshot.PayoutStatus))
            {
                reason = $"Settlement sent ({snapshot.BankStatus}) but payout missing ({snapshot.PayoutStatus})";
                _logger.LogInformation("Mismatch Type D detected for RRN {Rrn}: {Reason}", snapshot.RRN, reason);
                return MismatchType.MissingPayout;
            }

            _logger.LogDebug("No mismatch detected for RRN {Rrn}", snapshot.RRN);
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error classifying mismatch for RRN {Rrn}", snapshot.RRN);
            throw;
        }
    }

    #region Helper Methods

    private bool IsBankApproved(string? status) => 
        !string.IsNullOrEmpty(status) && 
        (status.Equals("APPROVED", StringComparison.OrdinalIgnoreCase) ||
         status.Equals("SETTLED", StringComparison.OrdinalIgnoreCase));

    private bool IsBankDeclined(string? status) => 
        !string.IsNullOrEmpty(status) && 
        (status.Equals("DECLINED", StringComparison.OrdinalIgnoreCase) ||
         status.Equals("REJECTED", StringComparison.OrdinalIgnoreCase) ||
         status.Equals("FAILED", StringComparison.OrdinalIgnoreCase));

    private bool IsLedgerMissing(string? status) => 
        string.IsNullOrEmpty(status) || status.Equals("NONE", StringComparison.OrdinalIgnoreCase);

    private bool IsLedgerDebited(string? status) => 
        !string.IsNullOrEmpty(status) && 
        (status.Equals("DEBIT", StringComparison.OrdinalIgnoreCase) ||
         status.Equals("DEBITED", StringComparison.OrdinalIgnoreCase));

    private bool IsPosApproved(string? status) => 
        !string.IsNullOrEmpty(status) && status.Equals("APPROVED", StringComparison.OrdinalIgnoreCase);

    private bool IsGatewayUnknown(string? status) => 
        string.IsNullOrEmpty(status) || 
        status.Equals("UNKNOWN", StringComparison.OrdinalIgnoreCase) ||
        status.Equals("NOT_FOUND", StringComparison.OrdinalIgnoreCase) ||
        status.Equals("PENDING", StringComparison.OrdinalIgnoreCase);

    private bool IsBankUnknown(string? status) => 
        string.IsNullOrEmpty(status) || 
        status.Equals("UNKNOWN", StringComparison.OrdinalIgnoreCase) ||
        status.Equals("NOT_FOUND", StringComparison.OrdinalIgnoreCase) ||
        status.Equals("PENDING", StringComparison.OrdinalIgnoreCase);

    private bool IsSettlementSent(string? status) => 
        !string.IsNullOrEmpty(status) && 
        (status.Equals("SETTLED", StringComparison.OrdinalIgnoreCase) ||
         status.Equals("SENT", StringComparison.OrdinalIgnoreCase));

    private bool IsPayoutMissing(string? status) => 
        string.IsNullOrEmpty(status) || 
        status.Equals("MISSING", StringComparison.OrdinalIgnoreCase) ||
        status.Equals("NOT_FOUND", StringComparison.OrdinalIgnoreCase) ||
        status.Equals("PENDING", StringComparison.OrdinalIgnoreCase);

    #endregion
}
