namespace Pos2013.Api.Contracts;

public class RedeemRequest
{
    public string Code { get; set; } = default!;
    public decimal Amount { get; set; }
    public string MerchantId { get; set; } = default!;
}
