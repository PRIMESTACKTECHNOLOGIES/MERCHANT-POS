using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using Pos2013.Api.Contracts;   // BatchDto, RedeemRequest, RedeemResponse
using Pos2013.Api.Data;        // AppDbContext
using Pos2013.Api.Models;      // PaymentCode
using Pos2013.Api.Security;    // HmacHelper, CodeGenerator
using Pos2013.Api.Store;       // PaymentStore
using Pos2013.Api.Utils;       // Protocol2013Helper
using Pos2013.Api.Services.FundCatcher;
using Pos2013.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// SQLite for local testing
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("DefaultConnection")));

// Fund Catcher Engine Services
builder.Services.AddScoped<ITransactionSnapshotBuilder, TransactionSnapshotBuilder>();
builder.Services.AddScoped<IMismatchClassifier, MismatchClassifier>();
builder.Services.AddScoped<IRecoveryStrategyExecutor, RecoveryStrategyExecutor>();

// Recovery Strategies
builder.Services.AddScoped<TypeARecoveryStrategy>();
builder.Services.AddScoped<TypeBRecoveryStrategy>();
builder.Services.AddScoped<TypeCRecoveryStrategy>();
builder.Services.AddScoped<TypeDRecoveryStrategy>();

// Fund Catcher Engine
builder.Services.AddScoped<IFundCatcherEngine, FundCatcherEngine>();

// Background Job
builder.Services.AddHostedService<FundCatcherBackgroundJob>();

bool liveMode = builder.Configuration.GetValue<bool>("LiveMode");
string masterKey = builder.Configuration["Gateway:SecretKey"] ?? "MY_SUPER_SECRET_KEY_12345";
string merchantId = builder.Configuration["Gateway:MerchantId"] ?? "MERCHANT123";
string webhookUrl = builder.Configuration["Gateway:WebhookUrl"] ?? "";

var app = builder.Build();

// Ensure DB is created
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();

    if (!db.Merchants.Any())
    {
        db.Merchants.Add(new Merchant
        {
            Id = Guid.NewGuid(),
            MerchantId = merchantId,
            MerchantName = "AM GLOBAL PAYMENT SOLUTION",
            Email = "info@abdellahmendjoum.com",
            Phone = "+971 52 837 3634",
            Address = "Business Center 1, M Floor, The Meydan Hotel, Nad Al Sheba, Dubai, UAE",
            LiveMode = liveMode,
            WebhookUrl = webhookUrl,
            CreatedAt = DateTime.UtcNow
        });

        db.SaveChanges();
    }

    if (!db.Terminals.Any())
    {
        db.Terminals.Add(new Terminal
        {
            Id = Guid.NewGuid(),
            TerminalId = "TERM001",
            Name = "Counter 1",
            MerchantId = merchantId,
            Active = true,
            Status = "ONLINE",
            CreatedAt = DateTime.UtcNow
        });

        db.SaveChanges();
    }
}

// 1. Live Redemption Endpoint (legacy / direct code redeem)
app.MapPost("/api/payment2013/redeem", (RedeemRequest req) =>
{
    var code = PaymentStore.Codes.FirstOrDefault(c => c.Code == req.Code);

    if (code == null)
    {
        return Results.BadRequest(new RedeemResponse
        {
            Success = false,
            Message = "Invalid code"
        });
    }

    if (code.Amount != req.Amount)
    {
        return Results.BadRequest(new RedeemResponse
        {
            Success = false,
            Message = "Amount mismatch"
        });
    }

    if (code.Used)
    {
        return Results.BadRequest(new RedeemResponse
        {
            Success = false,
            Message = "Code already used"
        });
    }

    code.Used = true;
    code.UsedAt = DateTime.UtcNow;
    code.UsedByMerchant = req.MerchantId;

    Console.WriteLine($"[LIVE] Code {req.Code} redeemed for {req.Amount}");

    return Results.Ok(new RedeemResponse
    {
        Success = true,
        Message = "Payment successful",
        Reference = code.Reference,
        Time = code.UsedAt
    });
});

// 2. Offline Batch Upload Handler (Protocol 201.3)
app.MapPost("/api/payment2013/batch", async (
    HttpRequest request,
    AppDbContext db,
    [FromBody] List<BatchDto> batches) =>
{
    if (!request.Headers.TryGetValue("X-Signature", out var signatureHeader))
    {
        return Results.BadRequest("Missing X-Signature header");
    }

    string receivedSignature = signatureHeader!;
    if (batches == null || batches.Count == 0)
        return Results.BadRequest("Empty batch");

    var batch = batches[0];

    // Format: protocolVersion|merchantId|terminalId|batchId|timestamp|nonce|count
    string data = Protocol2013Helper.BuildSignatureString(
        batch.ProtocolVersion,
        batch.MerchantId,
        batch.TerminalId,
        batch.BatchId,
        batch.Timestamp.ToString(),
        batch.Nonce,
        batch.Transactions.Count
    );

    Console.WriteLine($"[SECURITY] Verifying Batch: {batch.BatchId}, Data: {data}");

    string expectedSignature = HmacHelper.ComputeHmac(masterKey, data);

    if (!CryptographicOperations.FixedTimeEquals(
        Convert.FromBase64String(receivedSignature),
        Convert.FromBase64String(expectedSignature)))
    {
        Console.WriteLine($"[SECURITY] Signature mismatch! Expected: {expectedSignature}, Got: {receivedSignature}");
        return Results.Unauthorized();
    }

    Console.WriteLine($"[OFFLINE] Batch {batch.BatchId} verified successfully!");

    foreach (var tx in batch.Transactions)
    {
        Console.WriteLine($"   - TX: {tx.Stan} AmountMinor: {tx.AmountMinor}");

        db.PaymentCodes.Add(new PaymentCode
        {
            Id = Guid.NewGuid(),
            Stan = tx.Stan,
            Amount = tx.AmountMinor / 100m,
            Currency = tx.Currency,
            PanMasked = tx.PanMasked,
            MerchantId = batch.MerchantId,
            TerminalId = batch.TerminalId,
            CreatedAt = DateTime.UtcNow
        });
    }

    await db.SaveChangesAsync();

    return Results.Ok(new { status = "SYNCED", count = batch.Transactions.Count });
});

// Legacy alias route (optional)
app.MapPost("/merchant/v1/cashout/braintree", async (
    HttpRequest request,
    AppDbContext db,
    [FromBody] List<BatchDto> batches) =>
{
    // Reuse same logic as /api/payment2013/batch
    if (!request.Headers.TryGetValue("X-Signature", out var signatureHeader))
        return Results.BadRequest("Missing X-Signature header");

    string receivedSignature = signatureHeader!;
    if (batches == null || batches.Count == 0)
        return Results.BadRequest("Empty batch");

    var batch = batches[0];

    string data = Protocol2013Helper.BuildSignatureString(
        batch.ProtocolVersion,
        batch.MerchantId,
        batch.TerminalId,
        batch.BatchId,
        batch.Timestamp.ToString(),
        batch.Nonce,
        batch.Transactions.Count
    );

    string expectedSignature = HmacHelper.ComputeHmac(masterKey, data);

    if (!CryptographicOperations.FixedTimeEquals(
        Convert.FromBase64String(receivedSignature),
        Convert.FromBase64String(expectedSignature)))
    {
        Console.WriteLine($"[SECURITY] Signature mismatch! Expected: {expectedSignature}, Got: {receivedSignature}");
        return Results.Unauthorized();
    }

    Console.WriteLine($"[OFFLINE-LEGACY] Batch {batch.BatchId} verified successfully!");

    foreach (var tx in batch.Transactions)
    {
        db.PaymentCodes.Add(new PaymentCode
        {
            Id = Guid.NewGuid(),
            Stan = tx.Stan,
            Amount = tx.AmountMinor / 100m,
            Currency = tx.Currency,
            PanMasked = tx.PanMasked,
            MerchantId = batch.MerchantId,
            TerminalId = batch.TerminalId,
            CreatedAt = DateTime.UtcNow
        });
    }

    await db.SaveChangesAsync();

    return Results.Ok(new { status = "SYNCED", count = batch.Transactions.Count });
});

// 3. Generate Code Endpoint (Admin / Customer app)
app.MapPost("/api/payment2013/generate", () =>
{
    decimal amount = 201.30m; // or bind from body/query if you want

    string code = CodeGenerator.Generate6DigitCode();

    var paymentCode = new PaymentCode
    {
        Id = Guid.NewGuid(),
        Code = code,
        Amount = amount,
        Reference = Guid.NewGuid().ToString(),
        CreatedAt = DateTime.UtcNow,
        Used = false
    };

    PaymentStore.Codes.Add(paymentCode);

    Console.WriteLine($"[ADMIN] Generated Code {code} for {amount}");

    return Results.Ok(new
    {
        code = paymentCode.Code,
        amount = paymentCode.Amount,
        reference = paymentCode.Reference,
        createdAt = paymentCode.CreatedAt
    });
});

// 3. Merchant Settings Endpoint (Dashboard Integration)
app.MapGet("/api/merchant/settings", (AppDbContext db) =>
{
    var merchant = db.Merchants.FirstOrDefault();
    if (merchant == null)
        return Results.NotFound(new { error = "Merchant not found" });

    return Results.Ok(new
    {
        merchantId = merchant.MerchantId,
        merchantName = merchant.MerchantName,
        email = merchant.Email,
        phone = merchant.Phone,
        address = merchant.Address,
        liveMode = merchant.LiveMode,
        webhookUrl = merchant.WebhookUrl,
        createdAt = merchant.CreatedAt
    });
});

// 4. Merchant Terminals Endpoint
app.MapGet("/api/merchant/terminals", (AppDbContext db) =>
{
    var terminals = db.Terminals
        .OrderBy(t => t.CreatedAt)
        .Select(t => new
        {
            terminalId = t.TerminalId,
            name = t.Name,
            merchantId = t.MerchantId,
            status = t.Status,
            createdAt = t.CreatedAt
        })
        .ToList();

    return Results.Ok(terminals);
});

// 5. Merchant Transactions Endpoint
app.MapGet("/api/merchant/transactions", (AppDbContext db) =>
{
    var tx = db.PaymentCodes
        .OrderByDescending(x => x.CreatedAt)
        .Take(200)
        .Select(x => new
        {
            id = x.Id,
            code = x.Code,
            stan = x.Stan,
            amount = x.Amount,
            currency = x.Currency,
            panMasked = x.PanMasked,
            merchantId = x.MerchantId,
            terminalId = x.TerminalId,
            used = x.Used,
            usedAt = x.UsedAt,
            createdAt = x.CreatedAt
        })
        .ToList();

    return Results.Ok(tx);
});

// 6. Merchant Batches Endpoint (Daily Aggregation)
app.MapGet("/api/merchant/batches", (AppDbContext db) =>
{
    var batches = db.PaymentCodes
        .GroupBy(x => x.CreatedAt.Date)
        .Select(g => new
        {
            date = g.Key,
            count = g.Count(),
            total = g.Sum(x => x.Amount),
            currency = g.First().Currency ?? "USD"
        })
        .OrderByDescending(x => x.date)
        .Take(30)
        .ToList();

    return Results.Ok(batches);
});

// 7. Merchant API Keys Endpoint
app.MapGet("/api/merchant/api-keys", () =>
{
    return Results.Ok(new
    {
        publicKey = "PUBLIC_KEY_123456",   // display-only
        secretKeyMasked = "****************", // never send real secret
        liveMode = liveMode
    });
});

// 8. Merchant Settlement Summary Endpoint
app.MapGet("/api/merchant/settlement", (AppDbContext db) =>
{
    var today = DateTime.UtcNow.Date;
    var yesterday = today.AddDays(-1);

    var todayTotal = db.PaymentCodes
        .Where(x => x.CreatedAt.Date == today)
        .Sum(x => x.Amount);

    var yesterdayTotal = db.PaymentCodes
        .Where(x => x.CreatedAt.Date == yesterday)
        .Sum(x => x.Amount);

    return Results.Ok(new
    {
        currency = "USD",
        today = new
        {
            date = today,
            total = todayTotal,
            status = "READY"
        },
        yesterday = new
        {
            date = yesterday,
            total = yesterdayTotal,
            status = "SETTLED"
        }
    });
});

// Fund Catcher Engine Endpoints
app.MapFundCatcherEndpoints();

app.Run();