using System.Security.Cryptography;

namespace Pos2013.Api.Security;

public static class CodeGenerator
{
    public static string Generate6DigitCode()
    {
        using var rng = RandomNumberGenerator.Create();
        var bytes = new byte[4];
        rng.GetBytes(bytes);

        int value = BitConverter.ToInt32(bytes, 0) & 0x7FFFFFFF;
        return (value % 1_000_000).ToString("D6");
    }
}
