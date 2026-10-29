using System.Net.Http.Json;

namespace Pos2013.Api.Services;

public sealed class ProviderAuthClient
{
    private readonly HttpClient http;
    private readonly string baseUrl;
    private readonly string apiKey;

    public ProviderAuthClient(HttpClient http, IConfiguration configuration)
    {
        this.http = http;
        baseUrl = configuration["ProviderApi:BaseUrl"] ?? "https://provider.example.com";
        apiKey = configuration["ProviderApi:ApiKey"] ?? "TEST_KEY";
    }

    public async Task<ProviderAuthLookupResponse?> LookupAsync(
        string authCode,
        string? merchantId = null,
        CancellationToken cancellationToken = default)
    {
        var query = $"?authCode={Uri.EscapeDataString(authCode)}";
        if (!string.IsNullOrWhiteSpace(merchantId))
            query += $"&merchantId={Uri.EscapeDataString(merchantId)}";

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            BuildUri($"/auth/lookup{query}"));
        request.Headers.Add("X-API-Key", apiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            return null;

        return await response.Content.ReadFromJsonAsync<ProviderAuthLookupResponse>(
            cancellationToken);
    }

    public async Task<ProviderCaptureResponse?> CaptureAsync(
        string providerRef,
        decimal amount,
        string currency,
        string iban,
        string swift,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            BuildUri("/auth/capture"))
        {
            Content = JsonContent.Create(new
            {
                providerRef,
                amount,
                currency,
                destination = new { iban, swift }
            })
        };
        request.Headers.Add("X-API-Key", apiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            return null;

        return await response.Content.ReadFromJsonAsync<ProviderCaptureResponse>(
            cancellationToken);
    }

    private Uri BuildUri(string path) =>
        new($"{baseUrl.TrimEnd('/')}{path}", UriKind.Absolute);
}

public sealed class ProviderAuthLookupResponse
{
    public string ProviderRef { get; set; } = string.Empty;
    public string AuthCode { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "USD";
    public string Status { get; set; } = string.Empty;
}

public sealed class ProviderCaptureResponse
{
    public string Status { get; set; } = string.Empty;
    public string SettlementId { get; set; } = string.Empty;
}
