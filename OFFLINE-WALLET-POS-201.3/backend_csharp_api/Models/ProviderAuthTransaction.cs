namespace Pos2013.Api.Models;

public class ProviderAuthTransaction
{
    public Guid Id { get; set; }
    public string ProviderRef { get; set; } = default!;
    public string AuthCode { get; set; } = default!;
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "USD";
    public string Status { get; set; } = "AUTHORIZED";
    public string SettlementStatus { get; set; } = "PENDING";
    public string? SettlementBatchId { get; set; }
    public DateTime? SettlementAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
