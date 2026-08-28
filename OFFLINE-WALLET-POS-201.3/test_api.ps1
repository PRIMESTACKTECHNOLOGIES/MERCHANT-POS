# Windows PowerShell Script to test the offline batch API
$url = "http://localhost:3000/merchant/v1/pos/201.3/offline-batch"
$apiKey = "MERCHANT-SECRET-KEY-2013"
$terminalSecret = "s3cr3t-key-for-T2013-0001"

# Create a random batch ID to avoid "Already Processed" error on repeat runs
$randomId = Get-Random -Minimum 1000 -Maximum 9999
$batchId = "BATCH-20260224-$randomId"
$nonce = "f9c2a7b1e3"
$timestamp = "2026-02-24T18:05:00Z"

# 1. Create the data string to sign
$dataToSign = "201.3|MRC-1001|T2013-0001|$batchId|$timestamp|$nonce"

# 2. Compute HMAC-SHA256
$hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($terminalSecret))
$hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($dataToSign))
$signature = [Convert]::ToBase64String($hashBytes)

Write-Host "Generated Signature: $signature" -ForegroundColor Cyan

$body = @{
    protocolVersion = "201.3"
    merchantId = "MRC-1001"
    terminalId = "T2013-0001"
    batchId = $batchId
    batchCreatedAt = "2026-02-24T18:00:00Z"
    nonce = $nonce
    timestamp = $timestamp
    signature = $signature
    transactions = @(
        @{
            localTxnId = "TXN-0001"
            stan = "123456"
            amountMinor = 15000
            currency = "AED"
            panMasked = "411111******1111"
            txnType = "SALE"
            txnTimestamp = "2026-02-24T17:50:00Z"
            authMode = "OFFLINE_APPROVED"
            entryMode = "CHIP"
            rrn = $null
            authCode = $null
            emvData = @{
                tag_9F26 = "1122334455667788"
            }
        }
    )
} | ConvertTo-Json -Depth 4

# Send the request with API Key Header
try {
    $response = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Headers @{ "x-api-key" = $apiKey } -Body $body
    Write-Host "Success! Server Response:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 4)
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
         $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
         $errBody = $reader.ReadToEnd()
         Write-Host "Server Message: $errBody" -ForegroundColor Red
    }
}
