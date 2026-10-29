using System.Net.Http.Json;

namespace Pos2013.Api.Services;

public sealed class BankPayoutClient
{
    private readonly HttpClient http;
    private readonly string baseUrl;
    private readonly string apiKey;

    public BankPayoutClient(HttpClient http, IConfiguration configuration)
    {
        this.http = http;
        baseUrl = configuration["PayoutApi:BaseUrl"] ?? "https://partner.example.com";
        apiKey = configuration["PayoutApi:ApiKey"] ?? "TEST_KEY";
    }

    public async Task<bool> SendSwiftAsync(
        string batchRef,
        decimal amount,
        string currency,
        string iban,
        string swift,
        string reference,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, BuildUri("/swift"))
        {
            Content = JsonContent.Create(new
            {
                batchRef,
                amount,
                currency,
                destination = new { iban, swift, reference }
            })
        };
        ApplyAuthentication(request);
        using var response = await http.SendAsync(request, cancellationToken);

        return response.IsSuccessStatusCode;
    }

    private Uri BuildUri(string path) =>
        new($"{baseUrl.TrimEnd('/')}{path}", UriKind.Absolute);

    public void ApplyAuthentication(HttpRequestMessage request) =>
        request.Headers.Add("X-API-Key", apiKey);
}
