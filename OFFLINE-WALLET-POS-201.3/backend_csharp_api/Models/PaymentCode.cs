namespace Pos2013.Api.Models;

public class PaymentCode
{
    public Guid Id { get; set; }

    // For live code redemption
    public string Code { get; set; } = default!;
    public decimal Amount { get; set; }
    public bool Used { get; set; }
    public DateTime? UsedAt { get; set; }
    public string? UsedByMerchant { get; set; }
    public string Reference { get; set; } = default!;
    public DateTime CreatedAt { get; set; }

    // For offline batch ledger
    public string? Stan { get; set; }
    public string? Currency { get; set; }
    public string? PanMasked { get; set; }
    public string? MerchantId { get; set; }
    public string? TerminalId { get; set; }
}
