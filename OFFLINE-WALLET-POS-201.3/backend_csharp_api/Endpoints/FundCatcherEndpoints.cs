using Pos2013.Api.Contracts.FundCatcher;
using Pos2013.Api.Models.FundCatcher;
using Pos2013.Api.Services.FundCatcher;

namespace Pos2013.Api.Endpoints;

/// <summary>
/// Extension methods for Fund Catcher API endpoints.
/// </summary>
public static class FundCatcherEndpoints
{
    public static void MapFundCatcherEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/fund-catcher")
            .WithName("FundCatcher")
            .WithOpenApi();

        // POST /api/fund-catcher/run - Trigger engine run
        group.MapPost("/run", TriggerEngineRun)
            .WithName("TriggerFundCatcherRun")
            .WithOpenApi()
            .WithDescription("Trigger Fund Catcher Engine to run and reconcile transactions");

        // GET /api/fund-catcher/run/{runId} - Get run status
        group.MapGet("/run/{runId}", GetEngineRunStatus)
            .WithName("GetFundCatcherRunStatus")
            .WithOpenApi()
            .WithDescription("Get status of a Fund Catcher Engine run");

        // GET /api/fund-catcher/recoveries - List recoveries by status
        group.MapGet("/recoveries", ListRecoveries)
            .WithName("ListFundRecoveries")
            .WithOpenApi()
            .WithDescription("List fund recovery records by status");

        // GET /api/fund-catcher/recoveries/{recoveryId} - Get recovery details
        group.MapGet("/recoveries/{recoveryId}", GetRecoveryDetails)
            .WithName("GetFundRecoveryDetails")
            .WithOpenApi()
            .WithDescription("Get details of a specific fund recovery");

        // GET /api/fund-catcher/audit-logs - List audit logs
        group.MapGet("/audit-logs", ListAuditLogs)
            .WithName("ListFundCatcherAuditLogs")
            .WithOpenApi()
            .WithDescription("List Fund Catcher audit logs");

        // GET /api/fund-catcher/stats - Get statistics
        group.MapGet("/stats", GetEngineStatistics)
            .WithName("GetFundCatcherStats")
            .WithOpenApi()
            .WithDescription("Get Fund Catcher Engine statistics");
    }

    private static async Task<IResult> TriggerEngineRun(
        IFundCatcherEngine engine,
        TriggerFundCatcherRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await engine.RunAsync(request.StartDate, request.EndDate, cancellationToken);
            var dto = FundCatcherMapper.ToDto(result);
            return Results.Ok(new { success = true, data = dto });
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { success = false, error = ex.Message });
        }
    }

    private static async Task<IResult> GetEngineRunStatus(
        Guid runId,
        IFundCatcherEngine engine,
        CancellationToken cancellationToken)
    {
        try
        {
            var run = await engine.GetRunStatusAsync(runId, cancellationToken);
            var dto = FundCatcherMapper.ToDto(run);
            return Results.Ok(new { success = true, data = dto });
        }
        catch (KeyNotFoundException ex)
        {
            return Results.NotFound(new { success = false, error = ex.Message });
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { success = false, error = ex.Message });
        }
    }

    private static async Task<IResult> ListRecoveries(
        IFundCatcherEngine engine,
        [FromQuery] string? status = null,
        [FromQuery] int pageSize = 100,
        [FromQuery] int pageNumber = 1,
        CancellationToken cancellationToken = default)
    {
        try
        {
            RecoveryStatus? recoveryStatus = null;
            if (!string.IsNullOrEmpty(status) && Enum.TryParse<RecoveryStatus>(status, out var parsed))
            {
                recoveryStatus = parsed;
            }

            var recoveries = recoveryStatus.HasValue
                ? await engine.GetRecoveriesByStatusAsync(recoveryStatus.Value, pageSize, pageNumber, cancellationToken)
                : new List<FundRecovery>();

            var dtos = recoveries.Select(FundCatcherMapper.ToDto).ToList();
            return Results.Ok(new
            {
                success = true,
                data = dtos,
                pagination = new { pageSize, pageNumber, total = dtos.Count }
            });
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { success = false, error = ex.Message });
        }
    }

    private static async Task<IResult> GetRecoveryDetails(
        Guid recoveryId,
        IFundCatcherEngine engine,
        CancellationToken cancellationToken)
    {
        try
        {
            // Get recovery by ID from audit logs
            var recoveries = await engine.GetRecoveriesByStatusAsync(RecoveryStatus.PENDING, int.MaxValue, 1, cancellationToken);
            var recovery = recoveries.FirstOrDefault(r => r.Id == recoveryId);

            if (recovery == null)
            {
                return Results.NotFound(new { success = false, error = "Recovery not found" });
            }

            var dto = FundCatcherMapper.ToDto(recovery);
            return Results.Ok(new { success = true, data = dto });
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { success = false, error = ex.Message });
        }
    }

    private static async Task<IResult> ListAuditLogs(
        IFundCatcherEngine engine,
        [FromQuery] string? eventType = null,
        [FromQuery] int pageSize = 100,
        [FromQuery] int pageNumber = 1,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var logs = await engine.GetAuditLogsAsync(eventType, pageSize, pageNumber, cancellationToken);
            var dtos = logs.Select(FundCatcherMapper.ToDto).ToList();

            return Results.Ok(new
            {
                success = true,
                data = dtos,
                pagination = new { pageSize, pageNumber, total = dtos.Count }
            });
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { success = false, error = ex.Message });
        }
    }

    private static async Task<IResult> GetEngineStatistics(
        IFundCatcherEngine engine,
        CancellationToken cancellationToken)
    {
        try
        {
            // Get latest runs and aggregate stats
            var successRecoveries = await engine.GetRecoveriesByStatusAsync(RecoveryStatus.SUCCESS, int.MaxValue, 1, cancellationToken);
            var failedRecoveries = await engine.GetRecoveriesByStatusAsync(RecoveryStatus.FAILED, int.MaxValue, 1, cancellationToken);
            var pendingRecoveries = await engine.GetRecoveriesByStatusAsync(RecoveryStatus.PENDING, int.MaxValue, 1, cancellationToken);

            var stats = new
            {
                TotalRecoveriesSucceeded = successRecoveries.Count,
                TotalRecoveriesFailed = failedRecoveries.Count,
                TotalRecoveriesPending = pendingRecoveries.Count,
                TotalRecoveredAmount = successRecoveries.Sum(r => r.RecoveredAmount ?? 0),
                SuccessRate = successRecoveries.Count > 0
                    ? (double)successRecoveries.Count / (successRecoveries.Count + failedRecoveries.Count) * 100
                    : 0
            };

            return Results.Ok(new { success = true, data = stats });
        }
        catch (Exception ex)
        {
            return Results.BadRequest(new { success = false, error = ex.Message });
        }
    }
}
