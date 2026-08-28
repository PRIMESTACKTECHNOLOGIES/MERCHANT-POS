using Microsoft.EntityFrameworkCore;
using Pos2013.Api.Data;
using Pos2013.Api.Models.FundCatcher;
using System.Text.Json;

namespace Pos2013.Api.Services.FundCatcher;

/// <summary>
/// Main Fund Catcher Engine - orchestrates the entire reconciliation and recovery process.
/// </summary>
public interface IFundCatcherEngine
{
    Task<FundCatcherEngineRun> RunAsync(DateTime? startDate = null, DateTime? endDate = null, CancellationToken cancellationToken = default);
    Task<FundCatcherEngineRun> GetRunStatusAsync(Guid runId, CancellationToken cancellationToken = default);
    Task<List<FundRecovery>> GetRecoveriesByStatusAsync(RecoveryStatus status, int pageSize = 100, int pageNumber = 1, CancellationToken cancellationToken = default);
    Task<List<FundCatcherAuditLog>> GetAuditLogsAsync(string? eventType = null, int pageSize = 100, int pageNumber = 1, CancellationToken cancellationToken = default);
}

public class FundCatcherEngine : IFundCatcherEngine
{
    private readonly AppDbContext _context;
    private readonly ITransactionSnapshotBuilder _snapshotBuilder;
    private readonly IMismatchClassifier _classifier;
    private readonly IRecoveryStrategyExecutor _strategyExecutor;
    private readonly ILogger<FundCatcherEngine> _logger;

    public FundCatcherEngine(
        AppDbContext context,
        ITransactionSnapshotBuilder snapshotBuilder,
        IMismatchClassifier classifier,
        IRecoveryStrategyExecutor strategyExecutor,
        ILogger<FundCatcherEngine> logger)
    {
        _context = context;
        _snapshotBuilder = snapshotBuilder;
        _classifier = classifier;
        _strategyExecutor = strategyExecutor;
        _logger = logger;
    }

    /// <summary>
    /// Main entry point: Runs the complete Fund Catcher Engine flow.
    /// </summary>
    public async Task<FundCatcherEngineRun> RunAsync(DateTime? startDate = null, DateTime? endDate = null, CancellationToken cancellationToken = default)
    {
        var engineRun = new FundCatcherEngineRun
        {
            Id = Guid.NewGuid(),
            RunId = Guid.NewGuid().ToString(),
            StartedAt = DateTime.UtcNow
        };

        try
        {
            _logger.LogInformation("Fund Catcher Engine started. Run ID: {RunId}", engineRun.RunId);

            // Adjust date range
            startDate ??= DateTime.UtcNow.AddDays(-1);
            endDate ??= DateTime.UtcNow;

            // Step 1: Scan Transactions & Build Snapshots
            _logger.LogInformation("Step 1: Scanning transactions from {StartDate} to {EndDate}", startDate, endDate);
            await LogAuditAsync($"Engine run started for date range: {startDate} to {endDate}", "ENGINE_START", engineRun.RunId);

            var snapshots = await _snapshotBuilder.BuildSnapshotsForDateRangeAsync(startDate.Value, endDate.Value, cancellationToken);
            engineRun.TransactionsScanned = snapshots.Count;

            _logger.LogInformation("Step 1 Complete: Scanned {Count} transactions", snapshots.Count);

            // Step 2: Detect & Classify Mismatches
            _logger.LogInformation("Step 2: Detecting and classifying mismatches");
            var mismatches = new List<(TransactionSnapshot Snapshot, MismatchType? Type, string Reason)>();

            foreach (var snapshot in snapshots)
            {
                var mismatchType = _classifier.ClassifyMismatch(snapshot, out var reason);
                if (mismatchType.HasValue)
                {
                    mismatches.Add((snapshot, mismatchType, reason));
                    engineRun.MismatchesDetected++;

                    // Count by type
                    switch (mismatchType)
                    {
                        case MismatchType.MissingCredit:
                            engineRun.TypeACount++;
                            break;
                        case MismatchType.WrongDebit:
                            engineRun.TypeBCount++;
                            break;
                        case MismatchType.PhantomPOS:
                            engineRun.TypeCCount++;
                            break;
                        case MismatchType.MissingPayout:
                            engineRun.TypeDCount++;
                            break;
                    }

                    // Update snapshot status
                    snapshot.Status = TransactionStatus.MISMATCH_DETECTED;
                    snapshot.DetectedMismatchType = mismatchType;
                    snapshot.MismatchReason = reason;

                    await LogAuditAsync(reason, "MISMATCH_DETECTED", engineRun.RunId, snapshot.Id, mismatchType.Value.ToString());
                }
                else
                {
                    snapshot.Status = TransactionStatus.CHECKED_NO_MISMATCH;
                }
            }

            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Step 2 Complete: Detected {Count} mismatches", mismatches.Count);

            // Step 3: Apply Recovery Strategies
            _logger.LogInformation("Step 3: Applying recovery strategies");
            foreach (var (snapshot, mismatchType, reason) in mismatches)
            {
                if (!mismatchType.HasValue) continue;

                try
                {
                    engineRun.RecoveriesAttempted++;
                    snapshot.Status = TransactionStatus.RECOVERY_APPLIED;

                    // Execute recovery
                    var recovery = await _strategyExecutor.ExecuteRecoveryAsync(snapshot, mismatchType.Value, cancellationToken);

                    // Update statistics
                    if (recovery.Status == RecoveryStatus.SUCCESS)
                    {
                        engineRun.RecoveriesSucceeded++;
                        snapshot.Status = TransactionStatus.RECOVERY_SUCCESS;
                        engineRun.TotalRecoveredAmount += recovery.RecoveredAmount ?? 0;

                        await LogAuditAsync(
                            $"Recovery succeeded. Reference: {recovery.RecoveryReference}",
                            "RECOVERY_SUCCESS",
                            engineRun.RunId,
                            snapshot.Id);
                    }
                    else if (recovery.Status == RecoveryStatus.FAILED)
                    {
                        engineRun.RecoveriesFailed++;
                        snapshot.Status = TransactionStatus.RECOVERY_FAILED;

                        await LogAuditAsync(
                            $"Recovery failed: {recovery.ErrorMessage}",
                            "RECOVERY_FAILED",
                            engineRun.RunId,
                            snapshot.Id,
                            "ERROR");
                    }
                    else if (recovery.Status == RecoveryStatus.PARTIAL)
                    {
                        engineRun.RecoveriesPartial++;
                        engineRun.TotalRecoveredAmount += recovery.RecoveredAmount ?? 0;

                        await LogAuditAsync(
                            "Recovery partially completed",
                            "RECOVERY_PARTIAL",
                            engineRun.RunId,
                            snapshot.Id);
                    }

                    // Save recovery record
                    _context.FundRecoveries.Add(recovery);
                }
                catch (Exception ex)
                {
                    engineRun.RecoveriesFailed++;
                    _logger.LogError(ex, "Recovery execution failed for RRN: {Rrn}", snapshot.RRN);

                    await LogAuditAsync(
                        $"Recovery execution error: {ex.Message}",
                        "RECOVERY_ERROR",
                        engineRun.RunId,
                        snapshot.Id,
                        "ERROR");
                }
            }

            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Step 3 Complete: {Succeeded} succeeded, {Failed} failed, {Partial} partial",
                engineRun.RecoveriesSucceeded, engineRun.RecoveriesFailed, engineRun.RecoveriesPartial);

            // Step 4: Complete and Log
            engineRun.CompletedAt = DateTime.UtcNow;
            engineRun.ExecutionTimeMs = (long)(engineRun.CompletedAt.Value - engineRun.StartedAt).TotalMilliseconds;
            engineRun.IsSuccess = true;

            var summary = new
            {
                RunId = engineRun.RunId,
                TransactionsScanned = engineRun.TransactionsScanned,
                MismatchesDetected = engineRun.MismatchesDetected,
                RecoveriesAttempted = engineRun.RecoveriesAttempted,
                RecoveriesSucceeded = engineRun.RecoveriesSucceeded,
                RecoveriesFailed = engineRun.RecoveriesFailed,
                TotalRecoveredAmount = engineRun.TotalRecoveredAmount,
                ExecutionTimeMs = engineRun.ExecutionTimeMs
            };

            engineRun.Details = JsonSerializer.Serialize(summary);

            _context.EngineRuns.Add(engineRun);
            await _context.SaveChangesAsync(cancellationToken);

            await LogAuditAsync(
                $"Engine run completed. Summary: {JsonSerializer.Serialize(summary)}",
                "ENGINE_COMPLETE",
                engineRun.RunId);

            _logger.LogInformation("Fund Catcher Engine completed successfully. Run ID: {RunId}", engineRun.RunId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fund Catcher Engine failed");
            engineRun.IsSuccess = false;
            engineRun.ErrorMessage = ex.Message;
            engineRun.CompletedAt = DateTime.UtcNow;
            engineRun.ExecutionTimeMs = (long)(engineRun.CompletedAt.Value - engineRun.StartedAt).TotalMilliseconds;

            _context.EngineRuns.Add(engineRun);
            await _context.SaveChangesAsync(cancellationToken);

            await LogAuditAsync($"Engine error: {ex.Message}", "ENGINE_ERROR", engineRun.RunId, null, "ERROR");

            throw;
        }

        return engineRun;
    }

    public async Task<FundCatcherEngineRun> GetRunStatusAsync(Guid runId, CancellationToken cancellationToken = default)
    {
        return await _context.EngineRuns.FirstOrDefaultAsync(r => r.Id == runId, cancellationToken)
            ?? throw new KeyNotFoundException($"Engine run not found: {runId}");
    }

    public async Task<List<FundRecovery>> GetRecoveriesByStatusAsync(RecoveryStatus status, int pageSize = 100, int pageNumber = 1, CancellationToken cancellationToken = default)
    {
        return await _context.FundRecoveries
            .Where(r => r.Status == status)
            .OrderByDescending(r => r.CreatedAt)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<FundCatcherAuditLog>> GetAuditLogsAsync(string? eventType = null, int pageSize = 100, int pageNumber = 1, CancellationToken cancellationToken = default)
    {
        var query = _context.AuditLogs.AsQueryable();

        if (!string.IsNullOrEmpty(eventType))
        {
            query = query.Where(a => a.EventType == eventType);
        }

        return await query
            .OrderByDescending(a => a.CreatedAt)
            .Skip((pageNumber - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);
    }

    private async Task LogAuditAsync(
        string message,
        string eventType,
        string? runId = null,
        Guid? transactionSnapshotId = null,
        string? severity = null)
    {
        var auditLog = new FundCatcherAuditLog
        {
            Id = Guid.NewGuid(),
            EventType = eventType,
            Message = message,
            TransactionSnapshotId = transactionSnapshotId,
            SeverityLevel = severity ?? "INFO",
            CreatedAt = DateTime.UtcNow
        };

        if (!string.IsNullOrEmpty(runId))
        {
            var run = await _context.EngineRuns.FirstOrDefaultAsync(r => r.RunId == runId);
            if (run != null)
            {
                auditLog.EngineRunId = run.Id;
            }
        }

        _context.AuditLogs.Add(auditLog);
        await _context.SaveChangesAsync();
    }
}
