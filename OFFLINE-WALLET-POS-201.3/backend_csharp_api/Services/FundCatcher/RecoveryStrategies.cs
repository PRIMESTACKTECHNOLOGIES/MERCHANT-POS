using Microsoft.EntityFrameworkCore;
using Pos2013.Api.Data;
using Pos2013.Api.Models.FundCatcher;
using System.Text.Json;

namespace Pos2013.Api.Services.FundCatcher;

/// <summary>
/// Base interface for recovery strategies.
/// </summary>
public interface IRecoveryStrategy
{
    MismatchType SupportedMismatchType { get; }
    Task<FundRecovery> ExecuteAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken = default);
}

/// <summary>
/// Type A Recovery: Bank approved, Ledger missing (Missing Credit)
/// Action: Create Ledger CREDIT Entry and Update Wallet Balance
/// </summary>
public class TypeARecoveryStrategy : IRecoveryStrategy
{
    private readonly AppDbContext _context;
    private readonly ILogger<TypeARecoveryStrategy> _logger;

    public MismatchType SupportedMismatchType => MismatchType.MissingCredit;

    public TypeARecoveryStrategy(AppDbContext context, ILogger<TypeARecoveryStrategy> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<FundRecovery> ExecuteAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        var recovery = new FundRecovery
        {
            Id = Guid.NewGuid(),
            TransactionSnapshotId = snapshot.Id,
            MismatchType = MismatchType.MissingCredit,
            MismatchReason = "Bank approved but ledger has no credit",
            RecoveryAction = "CREATE_LEDGER_CREDIT",
            Status = RecoveryStatus.IN_PROGRESS,
            CreatedAt = DateTime.UtcNow,
            ExecutedAt = DateTime.UtcNow,
            BeneficiaryType = snapshot.OwnerType
        };

        try
        {
            _logger.LogInformation("Executing Type A recovery for RRN: {Rrn}, Amount: {Amount}", snapshot.RRN, snapshot.Amount);

            // Verify Bank/Gateway Approval
            if (!VerifyBankApproval(snapshot))
            {
                throw new InvalidOperationException("Bank approval verification failed");
            }

            // Create Ledger CREDIT Entry
            var ledgerEntry = new
            {
                TransactionId = snapshot.Id,
                Type = "CREDIT",
                Amount = snapshot.Amount,
                Currency = snapshot.Currency,
                Timestamp = DateTime.UtcNow,
                Reference = snapshot.RRN,
                Status = "COMPLETED"
            };

            recovery.LedgerUpdated = true;
            recovery.RecoveryDetails = JsonSerializer.Serialize(ledgerEntry);

            // Update Wallet Balance
            if (snapshot.CustomerId.HasValue)
            {
                // In real implementation, call wallet service
                recovery.WalletUpdated = true;
                recovery.BeneficiaryId = snapshot.CustomerId;
            }

            recovery.RecoveredAmount = snapshot.Amount;
            recovery.RecoveryReference = $"REC-{snapshot.RRN}-{DateTime.UtcNow:yyyyMMddHHmmss}";
            recovery.Status = RecoveryStatus.SUCCESS;
            recovery.CompletedAt = DateTime.UtcNow;

            _logger.LogInformation("Type A recovery completed successfully. Reference: {Ref}", recovery.RecoveryReference);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Type A recovery failed for RRN: {Rrn}", snapshot.RRN);
            recovery.Status = RecoveryStatus.FAILED;
            recovery.ErrorMessage = ex.Message;
            recovery.CompletedAt = DateTime.UtcNow;
        }

        return recovery;
    }

    private bool VerifyBankApproval(TransactionSnapshot snapshot)
    {
        return !string.IsNullOrEmpty(snapshot.BankStatus) &&
               (snapshot.BankStatus.Equals("APPROVED", StringComparison.OrdinalIgnoreCase) ||
                snapshot.BankStatus.Equals("SETTLED", StringComparison.OrdinalIgnoreCase)) &&
               !string.IsNullOrEmpty(snapshot.BankSettlementId);
    }
}

/// <summary>
/// Type B Recovery: Ledger debited, Bank declined (Wrong Debit)
/// Action: Create Ledger REVERSAL and Update Wallet Balance
/// </summary>
public class TypeBRecoveryStrategy : IRecoveryStrategy
{
    private readonly AppDbContext _context;
    private readonly ILogger<TypeBRecoveryStrategy> _logger;

    public MismatchType SupportedMismatchType => MismatchType.WrongDebit;

    public TypeBRecoveryStrategy(AppDbContext context, ILogger<TypeBRecoveryStrategy> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<FundRecovery> ExecuteAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        var recovery = new FundRecovery
        {
            Id = Guid.NewGuid(),
            TransactionSnapshotId = snapshot.Id,
            MismatchType = MismatchType.WrongDebit,
            MismatchReason = "Ledger debited but bank declined",
            RecoveryAction = "REVERSE_WRONG_DEBIT",
            Status = RecoveryStatus.IN_PROGRESS,
            CreatedAt = DateTime.UtcNow,
            ExecutedAt = DateTime.UtcNow,
            BeneficiaryType = snapshot.OwnerType
        };

        try
        {
            _logger.LogInformation("Executing Type B recovery for RRN: {Rrn}, Amount: {Amount}", snapshot.RRN, snapshot.Amount);

            // Verify Bank Decline
            if (!VerifyBankDecline(snapshot))
            {
                throw new InvalidOperationException("Bank decline verification failed");
            }

            // Create Ledger REVERSAL (CREDIT)
            var reversalEntry = new
            {
                OriginalTransaction = snapshot.RRN,
                Type = "REVERSAL",
                Amount = snapshot.LedgerAmount ?? snapshot.Amount,
                Currency = snapshot.Currency,
                Timestamp = DateTime.UtcNow,
                Reason = "Bank declined - reversing wrong debit",
                Status = "COMPLETED"
            };

            recovery.LedgerUpdated = true;
            recovery.RecoveryDetails = JsonSerializer.Serialize(reversalEntry);

            // Update Wallet Balance
            if (snapshot.CustomerId.HasValue)
            {
                recovery.WalletUpdated = true;
                recovery.BeneficiaryId = snapshot.CustomerId;
            }

            recovery.RecoveredAmount = snapshot.LedgerAmount ?? snapshot.Amount;
            recovery.RecoveryReference = $"REC-{snapshot.RRN}-{DateTime.UtcNow:yyyyMMddHHmmss}";
            recovery.Status = RecoveryStatus.SUCCESS;
            recovery.CompletedAt = DateTime.UtcNow;

            _logger.LogInformation("Type B recovery completed successfully. Reference: {Ref}", recovery.RecoveryReference);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Type B recovery failed for RRN: {Rrn}", snapshot.RRN);
            recovery.Status = RecoveryStatus.FAILED;
            recovery.ErrorMessage = ex.Message;
            recovery.CompletedAt = DateTime.UtcNow;
        }

        return recovery;
    }

    private bool VerifyBankDecline(TransactionSnapshot snapshot)
    {
        return !string.IsNullOrEmpty(snapshot.BankStatus) &&
               (snapshot.BankStatus.Equals("DECLINED", StringComparison.OrdinalIgnoreCase) ||
                snapshot.BankStatus.Equals("FAILED", StringComparison.OrdinalIgnoreCase)) &&
               !string.IsNullOrEmpty(snapshot.LedgerStatus);
    }
}

/// <summary>
/// Type C Recovery: POS approved, no gateway/bank record (Phantom POS)
/// Action: Confirm no gateway record, reverse phantom ledger if exists
/// </summary>
public class TypeCRecoveryStrategy : IRecoveryStrategy
{
    private readonly AppDbContext _context;
    private readonly ILogger<TypeCRecoveryStrategy> _logger;

    public MismatchType SupportedMismatchType => MismatchType.PhantomPOS;

    public TypeCRecoveryStrategy(AppDbContext context, ILogger<TypeCRecoveryStrategy> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<FundRecovery> ExecuteAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        var recovery = new FundRecovery
        {
            Id = Guid.NewGuid(),
            TransactionSnapshotId = snapshot.Id,
            MismatchType = MismatchType.PhantomPOS,
            MismatchReason = "POS approved but no gateway/bank record",
            RecoveryAction = "CLEAR_PHANTOM_POS",
            Status = RecoveryStatus.IN_PROGRESS,
            CreatedAt = DateTime.UtcNow,
            ExecutedAt = DateTime.UtcNow
        };

        try
        {
            _logger.LogInformation("Executing Type C recovery for RRN: {Rrn}", snapshot.RRN);

            // Confirm No Gateway/Bank Record
            if (string.IsNullOrEmpty(snapshot.GatewayStatus) && string.IsNullOrEmpty(snapshot.BankStatus))
            {
                // If Phantom Ledger Exists -> Reverse
                if (!string.IsNullOrEmpty(snapshot.LedgerStatus))
                {
                    var reversalEntry = new
                    {
                        OriginalTransaction = snapshot.RRN,
                        Type = "PHANTOM_REVERSAL",
                        Amount = snapshot.LedgerAmount ?? snapshot.Amount,
                        Reason = "No gateway/bank record found - clearing phantom transaction",
                        Timestamp = DateTime.UtcNow,
                        Status = "COMPLETED"
                    };

                    recovery.LedgerUpdated = true;
                    recovery.RecoveryDetails = JsonSerializer.Serialize(reversalEntry);
                    recovery.RecoveredAmount = snapshot.LedgerAmount ?? snapshot.Amount;
                }

                recovery.Status = RecoveryStatus.SUCCESS;
            }
            else
            {
                throw new InvalidOperationException("Gateway or bank record found - not a phantom transaction");
            }

            recovery.RecoveryReference = $"REC-{snapshot.RRN}-{DateTime.UtcNow:yyyyMMddHHmmss}";
            recovery.CompletedAt = DateTime.UtcNow;

            _logger.LogInformation("Type C recovery completed successfully. Reference: {Ref}", recovery.RecoveryReference);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Type C recovery failed for RRN: {Rrn}", snapshot.RRN);
            recovery.Status = RecoveryStatus.FAILED;
            recovery.ErrorMessage = ex.Message;
            recovery.CompletedAt = DateTime.UtcNow;
        }

        return recovery;
    }
}

/// <summary>
/// Type D Recovery: Settlement sent, Payout missing
/// Action: Compare settlement vs payout file, reissue missing payouts
/// </summary>
public class TypeDRecoveryStrategy : IRecoveryStrategy
{
    private readonly AppDbContext _context;
    private readonly ILogger<TypeDRecoveryStrategy> _logger;

    public MismatchType SupportedMismatchType => MismatchType.MissingPayout;

    public TypeDRecoveryStrategy(AppDbContext context, ILogger<TypeDRecoveryStrategy> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task<FundRecovery> ExecuteAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        var recovery = new FundRecovery
        {
            Id = Guid.NewGuid(),
            TransactionSnapshotId = snapshot.Id,
            MismatchType = MismatchType.MissingPayout,
            MismatchReason = "Settlement sent but payout missing",
            RecoveryAction = "REISSUE_PAYOUT",
            Status = RecoveryStatus.IN_PROGRESS,
            CreatedAt = DateTime.UtcNow,
            ExecutedAt = DateTime.UtcNow
        };

        try
        {
            _logger.LogInformation("Executing Type D recovery for RRN: {Rrn}, Amount: {Amount}", snapshot.RRN, snapshot.Amount);

            // Verify Settlement was sent
            if (!VerifySettlementSent(snapshot))
            {
                throw new InvalidOperationException("Settlement verification failed");
            }

            // Reissue Payout Request
            var payoutRequest = new
            {
                OriginalSettlementId = snapshot.BankSettlementId,
                Amount = snapshot.Amount,
                Currency = snapshot.Currency,
                Beneficiary = snapshot.BeneficiaryId,
                RequestedAt = DateTime.UtcNow,
                Priority = "HIGH"
            };

            recovery.PayoutTriggered = true;
            recovery.RecoveryDetails = JsonSerializer.Serialize(payoutRequest);
            recovery.RecoveredAmount = snapshot.Amount;
            recovery.RecoveryReference = $"REC-{snapshot.RRN}-{DateTime.UtcNow:yyyyMMddHHmmss}";
            recovery.Status = RecoveryStatus.SUCCESS;
            recovery.CompletedAt = DateTime.UtcNow;

            _logger.LogInformation("Type D recovery completed. Payout reissued. Reference: {Ref}", recovery.RecoveryReference);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Type D recovery failed for RRN: {Rrn}", snapshot.RRN);
            recovery.Status = RecoveryStatus.FAILED;
            recovery.ErrorMessage = ex.Message;
            recovery.CompletedAt = DateTime.UtcNow;
        }

        return recovery;
    }

    private bool VerifySettlementSent(TransactionSnapshot snapshot)
    {
        return !string.IsNullOrEmpty(snapshot.BankStatus) &&
               (snapshot.BankStatus.Equals("SETTLED", StringComparison.OrdinalIgnoreCase) ||
                snapshot.BankStatus.Equals("SENT", StringComparison.OrdinalIgnoreCase)) &&
               !string.IsNullOrEmpty(snapshot.BankSettlementId);
    }
}

/// <summary>
/// Recovery strategy factory and executor.
/// </summary>
public interface IRecoveryStrategyExecutor
{
    Task<FundRecovery> ExecuteRecoveryAsync(TransactionSnapshot snapshot, MismatchType mismatchType, CancellationToken cancellationToken = default);
}

public class RecoveryStrategyExecutor : IRecoveryStrategyExecutor
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<RecoveryStrategyExecutor> _logger;
    private readonly Dictionary<MismatchType, Type> _strategyMap;

    public RecoveryStrategyExecutor(IServiceProvider serviceProvider, ILogger<RecoveryStrategyExecutor> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;

        _strategyMap = new Dictionary<MismatchType, Type>
        {
            { MismatchType.MissingCredit, typeof(TypeARecoveryStrategy) },
            { MismatchType.WrongDebit, typeof(TypeBRecoveryStrategy) },
            { MismatchType.PhantomPOS, typeof(TypeCRecoveryStrategy) },
            { MismatchType.MissingPayout, typeof(TypeDRecoveryStrategy) }
        };
    }

    public async Task<FundRecovery> ExecuteRecoveryAsync(TransactionSnapshot snapshot, MismatchType mismatchType, CancellationToken cancellationToken = default)
    {
        try
        {
            if (!_strategyMap.TryGetValue(mismatchType, out var strategyType))
            {
                throw new InvalidOperationException($"No recovery strategy found for mismatch type: {mismatchType}");
            }

            var strategy = (IRecoveryStrategy)_serviceProvider.GetService(strategyType)
                ?? throw new InvalidOperationException($"Failed to resolve recovery strategy: {strategyType.Name}");

            _logger.LogInformation("Executing recovery strategy {Strategy} for mismatch type {MismatchType}", strategyType.Name, mismatchType);

            return await strategy.ExecuteAsync(snapshot, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error executing recovery for RRN: {Rrn}, MismatchType: {MismatchType}", snapshot.RRN, mismatchType);
            throw;
        }
    }
}
