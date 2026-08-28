using System.Security.Cryptography;
using System.Text;

namespace Pos2013.Api.Security;

public static class HmacHelper
{
    public static string ComputeHmac(string secretKey, string data)
    {
        var keyBytes = Encoding.UTF8.GetBytes(secretKey);
        var dataBytes = Encoding.UTF8.GetBytes(data);

        using var hmac = new HMACSHA256(keyBytes);
        var hash = hmac.ComputeHash(dataBytes);

        return Convert.ToBase64String(hash);
    }
}
