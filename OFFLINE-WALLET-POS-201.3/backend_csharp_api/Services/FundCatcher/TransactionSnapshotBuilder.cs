using Microsoft.EntityFrameworkCore;
using Pos2013.Api.Data;
using Pos2013.Api.Models.FundCatcher;

namespace Pos2013.Api.Services.FundCatcher;

/// <summary>
/// Builds a unified transaction snapshot by merging records from POS, Ledger, Gateway, and Bank systems.
/// </summary>
public interface ITransactionSnapshotBuilder
{
    Task<TransactionSnapshot> BuildSnapshotAsync(string rrn, string stan, CancellationToken cancellationToken = default);
    Task<List<TransactionSnapshot>> BuildSnapshotsForDateRangeAsync(DateTime startDate, DateTime endDate, CancellationToken cancellationToken = default);
}

public class TransactionSnapshotBuilder : ITransactionSnapshotBuilder
{
    private readonly AppDbContext _context;
    private readonly ILogger<TransactionSnapshotBuilder> _logger;

    public TransactionSnapshotBuilder(AppDbContext context, ILogger<TransactionSnapshotBuilder> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <summary>
    /// Builds a transaction snapshot by merging records from all systems.
    /// </summary>
    public async Task<TransactionSnapshot> BuildSnapshotAsync(string rrn, string stan, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Building snapshot for RRN: {Rrn}, STAN: {Stan}", rrn, stan);

        var snapshot = new TransactionSnapshot
        {
            Id = Guid.NewGuid(),
            RRN = rrn,
            STAN = stan,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            // Fetch POS Record
            await FetchPosRecordAsync(snapshot, cancellationToken);

            // Fetch Ledger Record
            await FetchLedgerRecordAsync(snapshot, cancellationToken);

            // Fetch Gateway Record
            await FetchGatewayRecordAsync(snapshot, cancellationToken);

            // Fetch Bank Record
            await FetchBankRecordAsync(snapshot, cancellationToken);

            // Fetch Payout Record
            await FetchPayoutRecordAsync(snapshot, cancellationToken);

            // Save snapshot to database
            _context.TransactionSnapshots.Add(snapshot);
            await _context.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("Snapshot built successfully. ID: {SnapshotId}", snapshot.Id);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error building snapshot for RRN: {Rrn}, STAN: {Stan}", rrn, stan);
            throw;
        }

        return snapshot;
    }

    /// <summary>
    /// Builds snapshots for all transactions in a date range.
    /// </summary>
    public async Task<List<TransactionSnapshot>> BuildSnapshotsForDateRangeAsync(DateTime startDate, DateTime endDate, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Building snapshots for date range: {StartDate} to {EndDate}", startDate, endDate);

        var snapshots = new List<TransactionSnapshot>();

        // Fetch all payment codes (POS records) in the date range
        var posRecords = await _context.PaymentCodes
            .Where(p => p.CreatedAt >= startDate && p.CreatedAt <= endDate)
            .ToListAsync(cancellationToken);

        foreach (var posRecord in posRecords)
        {
            try
            {
                var snapshot = await BuildSnapshotAsync(posRecord.Stan, posRecord.Stan, cancellationToken);
                snapshots.Add(snapshot);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error building snapshot for POS record: {PosId}", posRecord.Id);
                // Continue processing other records
            }
        }

        _logger.LogInformation("Built {Count} snapshots for date range", snapshots.Count);
        return snapshots;
    }

    private async Task FetchPosRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
    {
        // In a real implementation, this would fetch from POS database/API
        // For now, we'll look up PaymentCode records
        var posRecord = await _context.PaymentCodes
            .FirstOrDefaultAsync(p => p.Stan == snapshot.STAN, cancellationToken);

        if (posRecord != null)
        {
            snapshot.PosStatus = posRecord.Status ?? "UNKNOWN";
            snapshot.PosAuthCode = posRecord.AuthCode;
            snapshot.PosTimestamp = posRecord.CreatedAt;
            snapshot.Amount = posRecord.Amount;
            snapshot.Currency = posRecord.Currency;
            snapshot.MerchantId = Guid.TryParse(posRecord.MerchantId, out var merchantId) ? merchantId : null;

            _logger.LogDebug("POS record found for STAN: {Stan}", snapshot.STAN);
        }
        else
        {
            snapshot.PosStatus = "NOT_FOUND";
            _logger.LogDebug("No POS record found for STAN: {Stan}", snapshot.STAN);
        }
    }

    private async Task FetchLedgerRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
    {
        // In a real implementation, this would fetch from Ledger database/API
        // Placeholder for now
        await Task.CompletedTask;

        _logger.LogDebug("Ledger record fetch placeholder for STAN: {Stan}", snapshot.STAN);
    }

    private async Task FetchGatewayRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
    {
        // In a real implementation, this would fetch from Gateway API
        // Placeholder for now
        await Task.CompletedTask;

        _logger.LogDebug("Gateway record fetch placeholder for STAN: {Stan}", snapshot.STAN);
    }

    private async Task FetchBankRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
    {
        // In a real implementation, this would fetch from Bank settlement API
        // Placeholder for now
        await Task.CompletedTask;

        _logger.LogDebug("Bank record fetch placeholder for STAN: {Stan}", snapshot.STAN);
    }

    private async Task FetchPayoutRecordAsync(TransactionSnapshot snapshot, CancellationToken cancellationToken)
    {
        // In a real implementation, this would fetch from Payout system
        // Placeholder for now
        await Task.CompletedTask;

        _logger.LogDebug("Payout record fetch placeholder for STAN: {Stan}", snapshot.STAN);
    }
}
