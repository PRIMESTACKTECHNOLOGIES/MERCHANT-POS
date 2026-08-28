namespace Pos2013.Api.Models;

public class Terminal
{
    public Guid Id { get; set; }
    public string TerminalId { get; set; } = default!;
    public string Name { get; set; } = default!;
    public string MerchantId { get; set; } = default!;
    public bool Active { get; set; }
    public string Status { get; set; } = "ONLINE"; // ONLINE, OFFLINE, SYNCING
    public DateTime CreatedAt { get; set; }
}
