namespace Pos2013.Api.Models;

public class Merchant
{
    public Guid Id { get; set; }
    public string MerchantId { get; set; } = default!;
    public string MerchantName { get; set; } = default!;
    public string Email { get; set; } = default!;
    public string Phone { get; set; } = default!;
    public string Address { get; set; } = default!;
    public bool LiveMode { get; set; }
    public string WebhookUrl { get; set; } = default!;
    public DateTime CreatedAt { get; set; }
}
