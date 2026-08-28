using Pos2013.Api.Models;

namespace Pos2013.Api.Store;

public static class PaymentStore
{
    public static List<PaymentCode> Codes { get; } = new()
    {
        new PaymentCode
        {
            Id = Guid.NewGuid(),
            Code = "123456",
            Amount = 201.30m,
            Used = false,
            Reference = Guid.NewGuid().ToString(),
            CreatedAt = DateTime.UtcNow
        }
    };
}
