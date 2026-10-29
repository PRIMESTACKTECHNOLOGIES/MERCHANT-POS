namespace Pos2013.Api.Models;

public class SettlementBatch
{
    public Guid Id { get; set; }
    public string BatchRef { get; set; } = default!;
    public decimal TotalAmount { get; set; }
    public string Currency { get; set; } = "USD";
    public string Status { get; set; } = "PENDING";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ExecutedAt { get; set; }
}
