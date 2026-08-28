namespace Pos2013.Api.Contracts;

public class BatchDto
{
    public string ProtocolVersion { get; set; } = "201.3";
    public string MerchantId { get; set; } = default!;
    public string TerminalId { get; set; } = default!;
    public string BatchId { get; set; } = default!;
    public long Timestamp { get; set; }
    public string Nonce { get; set; } = default!;
    public List<TransactionDto> Transactions { get; set; } = new();
}

public class TransactionDto
{
    public string Id { get; set; } = default!;
    public long AmountMinor { get; set; }
    public string Currency { get; set; } = default!;
    public string PanMasked { get; set; } = default!;
    public string Stan { get; set; } = default!;
    public long Timestamp { get; set; }
    public string Expiry { get; set; } = default!;
}
