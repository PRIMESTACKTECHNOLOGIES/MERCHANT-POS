using System.Net.Http.Json;

namespace Pos2013.Api.Services;

public sealed class CardLoadClient
{
    private readonly HttpClient http;
    private readonly string baseUrl;
    private readonly string apiKey;

    public CardLoadClient(HttpClient http, IConfiguration configuration)
    {
        this.http = http;
        baseUrl = configuration["CardLoadApi:BaseUrl"] ?? "https://partner.example.com";
        apiKey = configuration["CardLoadApi:ApiKey"] ?? "TEST_KEY";
    }

    public async Task<bool> LoadCardAsync(
        string batchRef,
        decimal amount,
        string currency,
        string cardNumber,
        string reference,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"{baseUrl.TrimEnd('/')}/card-load", UriKind.Absolute))
        {
            Content = JsonContent.Create(new
            {
                batchRef,
                amount,
                currency,
                destination = new { cardNumber, reference }
            })
        };
        request.Headers.Add("X-API-Key", apiKey);

        using var response = await http.SendAsync(request, cancellationToken);
        return response.IsSuccessStatusCode;
    }
}
