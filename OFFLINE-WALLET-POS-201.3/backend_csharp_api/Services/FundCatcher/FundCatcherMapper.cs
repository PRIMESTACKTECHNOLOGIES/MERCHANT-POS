using Pos2013.Api.Contracts.FundCatcher;
using Pos2013.Api.Models.FundCatcher;

namespace Pos2013.Api.Services.FundCatcher;

/// <summary>
/// Mapper for Fund Catcher DTOs.
/// </summary>
public class FundCatcherMapper
{
    public static FundCatcherEngineRunDto ToDto(FundCatcherEngineRun run)
    {
        return new FundCatcherEngineRunDto
        {
            Id = run.Id,
            RunId = run.RunId,
            StartedAt = run.StartedAt,
            CompletedAt = run.CompletedAt,
            TransactionsScanned = run.TransactionsScanned,
            MismatchesDetected = run.MismatchesDetected,
            RecoveriesAttempted = run.RecoveriesAttempted,
            RecoveriesSucceeded = run.RecoveriesSucceeded,
            RecoveriesFailed = run.RecoveriesFailed,
            RecoveriesPartial = run.RecoveriesPartial,
            TotalRecoveredAmount = run.TotalRecoveredAmount,
            Currency = run.Currency,
            TypeACount = run.TypeACount,
            TypeBCount = run.TypeBCount,
            TypeCCount = run.TypeCCount,
            TypeDCount = run.TypeDCount,
            IsSuccess = run.IsSuccess,
            ErrorMessage = run.ErrorMessage,
            ExecutionTimeMs = run.ExecutionTimeMs
        };
    }

    public static FundRecoveryDto ToDto(FundRecovery recovery)
    {
        return new FundRecoveryDto
        {
            Id = recovery.Id,
            TransactionSnapshotId = recovery.TransactionSnapshotId,
            MismatchType = recovery.MismatchType.ToString(),
            MismatchReason = recovery.MismatchReason,
            RecoveryAction = recovery.RecoveryAction,
            Status = recovery.Status.ToString(),
            RecoveredAmount = recovery.RecoveredAmount,
            RecoveryReference = recovery.RecoveryReference,
            LedgerUpdated = recovery.LedgerUpdated,
            WalletUpdated = recovery.WalletUpdated,
            PayoutTriggered = recovery.PayoutTriggered,
            CreatedAt = recovery.CreatedAt,
            ExecutedAt = recovery.ExecutedAt,
            CompletedAt = recovery.CompletedAt,
            ErrorMessage = recovery.ErrorMessage,
            RetryCount = recovery.RetryCount
        };
    }

    public static FundCatcherAuditLogDto ToDto(FundCatcherAuditLog log)
    {
        return new FundCatcherAuditLogDto
        {
            Id = log.Id,
            EngineRunId = log.EngineRunId,
            TransactionSnapshotId = log.TransactionSnapshotId,
            EventType = log.EventType,
            Message = log.Message,
            AffectedSystem = log.AffectedSystem,
            CreatedAt = log.CreatedAt,
            SeverityLevel = log.SeverityLevel
        };
    }

    public static TransactionSnapshotDto ToDto(TransactionSnapshot snapshot)
    {
        return new TransactionSnapshotDto
        {
            Id = snapshot.Id,
            RRN = snapshot.RRN,
            STAN = snapshot.STAN,
            Amount = snapshot.Amount,
            Currency = snapshot.Currency,
            PosStatus = snapshot.PosStatus,
            LedgerStatus = snapshot.LedgerStatus,
            GatewayStatus = snapshot.GatewayStatus,
            BankStatus = snapshot.BankStatus,
            PayoutStatus = snapshot.PayoutStatus,
            DetectedMismatchType = snapshot.DetectedMismatchType?.ToString(),
            MismatchReason = snapshot.MismatchReason,
            Status = snapshot.Status.ToString(),
            CreatedAt = snapshot.CreatedAt,
            UpdatedAt = snapshot.UpdatedAt
        };
    }
}
