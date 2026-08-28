namespace Pos2013.Api.Utils;

public static class Protocol2013Helper
{
    // ISO-8583 requires STAN to be 6 digits (000001 - 999999) and wrap around
    public static string GenerateStan(int lastStan)
    {
        int nextStan = (lastStan + 1) % 1000000;
        return nextStan.ToString("D6");
    }

    // Matches Android's Protocol2013Helper.buildSignatureString
    public static string BuildSignatureString(
        string protocolVersion,
        string merchantId,
        string terminalId,
        string batchId,
        string timestamp,
        string nonce,
        int transactionCount)
    {
        // protocolVersion|merchantId|terminalId|batchId|timestamp|nonce|transactionCount
        return $"{protocolVersion}|{merchantId}|{terminalId}|{batchId}|{timestamp}|{nonce}|{transactionCount}";
    }
}
