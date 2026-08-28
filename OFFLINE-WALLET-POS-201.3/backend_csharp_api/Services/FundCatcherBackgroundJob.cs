using Pos2013.Api.Services.FundCatcher;

namespace Pos2013.Api.Services;

/// <summary>
/// Background scheduled job for running the Fund Catcher Engine periodically.
/// </summary>
public class FundCatcherBackgroundJob : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<FundCatcherBackgroundJob> _logger;
    private readonly TimeSpan _interval;
    private Timer? _timer;

    public FundCatcherBackgroundJob(IServiceProvider serviceProvider, ILogger<FundCatcherBackgroundJob> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
        // Run every 6 hours (86400000 ms = 24 hours, so 6 hours = 21600000 ms)
        _interval = TimeSpan.FromHours(6);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Fund Catcher Background Job started. Will run every {Hours} hours", _interval.TotalHours);

        // Run immediately on startup
        await RunFundCatcherAsync(stoppingToken);

        // Then schedule for periodic execution
        _timer = new Timer(async _ => await RunFundCatcherAsync(stoppingToken), null, _interval, _interval);

        await Task.CompletedTask;
    }

    private async Task RunFundCatcherAsync(CancellationToken stoppingToken)
    {
        try
        {
            using (var scope = _serviceProvider.CreateScope())
            {
                var engine = scope.ServiceProvider.GetRequiredService<IFundCatcherEngine>();
                _logger.LogInformation("Starting Fund Catcher Engine run");

                var result = await engine.RunAsync(cancellationToken: stoppingToken);

                _logger.LogInformation(
                    "Fund Catcher Engine run completed. Run ID: {RunId}, Scanned: {Scanned}, Mismatches: {Mismatches}, Recovered: {Recovered:C}",
                    result.RunId,
                    result.TransactionsScanned,
                    result.MismatchesDetected,
                    result.TotalRecoveredAmount);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fund Catcher Engine run failed");
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Fund Catcher Background Job stopping");
        _timer?.Dispose();
        await base.StopAsync(cancellationToken);
    }
}
