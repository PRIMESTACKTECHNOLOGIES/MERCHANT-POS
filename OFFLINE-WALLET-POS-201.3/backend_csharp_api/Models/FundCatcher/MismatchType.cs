namespace Pos2013.Api.Models.FundCatcher;

/// <summary>
/// Enumeration of mismatch types detected by the Fund Catcher Engine.
/// </summary>
public enum MismatchType
{
    /// <summary>
    /// Type A: Bank APPROVED but Ledger NONE (funds stuck outside wallet)
    /// </summary>
    MissingCredit = 1,

    /// <summary>
    /// Type B: Ledger DEBITED but Bank DECLINED (funds stuck inside wallet)
    /// </summary>
    WrongDebit = 2,

    /// <summary>
    /// Type C: POS APPROVED but no network/bank record (phantom transaction)
    /// </summary>
    PhantomPOS = 3,

    /// <summary>
    /// Type D: Settlement SENT but Payout MISSING
    /// </summary>
    MissingPayout = 4
}

public enum TransactionStatus
{
    NEW_TRANSACTION = 0,
    CHECKED_NO_MISMATCH = 1,
    MISMATCH_DETECTED = 2,
    RECOVERY_APPLIED = 3,
    RECOVERY_SUCCESS = 4,
    RECOVERY_FAILED = 5
}

public enum RecoveryStatus
{
    PENDING = 0,
    IN_PROGRESS = 1,
    SUCCESS = 2,
    FAILED = 3,
    PARTIAL = 4
}
