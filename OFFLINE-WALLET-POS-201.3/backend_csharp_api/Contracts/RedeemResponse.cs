namespace Pos2013.Api.Contracts;

public class RedeemResponse
{
    public bool Success { get; set; }
    public string Message { get; set; } = default!;
    public string? Reference { get; set; }
    public DateTime? Time { get; set; }
}
