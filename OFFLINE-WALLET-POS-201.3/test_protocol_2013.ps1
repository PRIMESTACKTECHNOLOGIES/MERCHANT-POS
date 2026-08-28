# Protocol 201.3 Test Script
# This script tests all the new endpoints

$baseUrl = "http://localhost:3000"
$merchantId = "MRC-1001"
$terminalId = "T2013-001"
$secretKey = "sk_test_mock_key_12345"

Write-Host "==============================================`n" -ForegroundColor Cyan
Write-Host "Protocol 201.3 - Test Suite`n" -ForegroundColor Cyan
Write-Host "==============================================`n" -ForegroundColor Cyan

# Test 1: Initialize Database
Write-Host "[TEST 1] Initializing Database..." -ForegroundColor Yellow
try {
    cd backend
    npx ts-node init_2013_db.ts
    Write-Host "✓ Database initialized successfully`n" -ForegroundColor Green
    cd ..
} catch {
    Write-Host "✗ Database initialization failed: $_`n" -ForegroundColor Red
}

# Test 2: Upload Offline Batch
Write-Host "[TEST 2] Uploading Offline Batch (Protocol 201.3)..." -ForegroundColor Yellow

$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$nonce = (Guid::NewGuid()).ToString()
$batchId = "BATCH-TEST-" + (Get-Random)

# Build signature string
$signatureData = "201.3|$merchantId|$terminalId|$batchId|$timestamp|$nonce|1"
$hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($secretKey))
$signatureBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signatureData))
$signature = [Convert]::ToBase64String($signatureBytes)

$body = @{
    protocolVersion = "201.3"
    merchantId = $merchantId
    terminalId = $terminalId
    batchId = $batchId
    timestamp = $timestamp
    nonce = $nonce
    transactions = @(
        @{
            id = "TXN-001"
            localTxnId = "LOCAL-001"
            stan = "123456"
            amountMinor = 15000
            currency = "USD"
            panMasked = "411111******1111"
            txnType = "SALE"
            authMode = "OFFLINE_APPROVED"
            entryMode = "CHIP"
            timestamp = (Get-Date).ToUniversalTime().ToString("o")
        }
    )
} | ConvertTo-Json -Depth 10

$headers = @{
    "Content-Type" = "application/json"
    "X-Merchant-Id" = $merchantId
    "X-Terminal-Id" = $terminalId
}

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/merchant/v1/pos/201.3/offline-batch" -Method POST -Headers $headers -Body $body
    Write-Host "✓ Batch uploaded successfully!" -ForegroundColor Green
    Write-Host "  Batch ID: $($response.batchId)" -ForegroundColor Gray
    Write-Host "  Settlement Code: $($response.settlementCode)" -ForegroundColor Gray
    Write-Host "  Transactions: $($response.txnCount)" -ForegroundColor Gray
    Write-Host "  Total Amount: `$$(($response.totalAmountMinor / 100).ToString('F2'))" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "✗ Batch upload failed: $_" -ForegroundColor Red
    Write-Host ""
}

# Test 3: Redeem Payment Code
Write-Host "[TEST 3] Redeeming Payment Code (Live Transaction)..." -ForegroundColor Yellow

$redeemBody = @{
    code = "123456"
    amount = 100.00
    merchantId = $merchantId
} | ConvertTo-Json

try {
    $redeemResponse = Invoke-RestMethod -Uri "$baseUrl/merchant/v1/pos/201.3/redeem" -Method POST -Body $redeemBody -ContentType "application/json"
    Write-Host "✓ Payment redeemed successfully!" -ForegroundColor Green
    Write-Host "  Reference: $($redeemResponse.reference)" -ForegroundColor Gray
    Write-Host "  Message: $($redeemResponse.message)" -ForegroundColor Gray
    if ($redeemResponse.time) {
        Write-Host "  Time: $($redeemResponse.time)" -ForegroundColor Gray
    }
    Write-Host ""
} catch {
    Write-Host "✗ Redemption failed: $_" -ForegroundColor Red
    Write-Host ""
}

# Test 4: Fetch Batches
Write-Host "[TEST 4] Fetching Batches..." -ForegroundColor Yellow

try {
    $batches = Invoke-RestMethod -Uri "$baseUrl/merchant/v1/pos/201.3/batches"
    Write-Host "✓ Retrieved $($batches.Count) batches" -ForegroundColor Green
    
    foreach ($batch in $batches) {
        Write-Host "`n  Batch: $($batch.id)" -ForegroundColor Cyan
        Write-Host "    Status: $($batch.status)" -ForegroundColor Gray
        Write-Host "    Transactions: $($batch.txnCount)" -ForegroundColor Gray
        Write-Host "    Total: `$$(($batch.totalAmountMinor / 100).ToString('F2'))" -ForegroundColor Gray
        if ($batch.settlementCode) {
            Write-Host "    Settlement Code: $($batch.settlementCode)" -ForegroundColor Gray
        }
    }
    Write-Host ""
} catch {
    Write-Host "✗ Failed to fetch batches: $_" -ForegroundColor Red
    Write-Host ""
}

# Test 5: Fetch Transactions
Write-Host "[TEST 5] Fetching Transactions..." -ForegroundColor Yellow

try {
    $transactions = Invoke-RestMethod -Uri "$baseUrl/merchant/v1/transactions"
    Write-Host "✓ Retrieved $($transactions.Count) transactions" -ForegroundColor Green
    
    # Show first 3 transactions
    $count = [Math]::Min(3, $transactions.Count)
    for ($i = 0; $i -lt $count; $i++) {
        $txn = $transactions[$i]
        Write-Host "`n  Transaction: $($txn.id)" -ForegroundColor Cyan
        Write-Host "    STAN: $($txn.stan)" -ForegroundColor Gray
        Write-Host "    Amount: `$$(($txn.amountMinor / 100).ToString('F2'))" -ForegroundColor Gray
        Write-Host "    Status: $($txn.status)" -ForegroundColor Gray
        Write-Host "    Type: $($txn.txnType)" -ForegroundColor Gray
        Write-Host "    Auth Mode: $($txn.authMode)" -ForegroundColor Gray
    }
    Write-Host ""
} catch {
    Write-Host "✗ Failed to fetch transactions: $_" -ForegroundColor Red
    Write-Host ""
}

Write-Host "==============================================`n" -ForegroundColor Cyan
Write-Host "Test Suite Complete!" -ForegroundColor Green
Write-Host "==============================================`n" -ForegroundColor Cyan

Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Open dashboard at http://localhost:5173" -ForegroundColor White
Write-Host "2. Navigate to 'Transactions' page" -ForegroundColor White
Write-Host "3. Verify uploaded batches and transactions" -ForegroundColor White
Write-Host "4. Check for 6-digit STAN codes" -ForegroundColor White
Write-Host "5. Test live redemption with codes: 123456, 999999, 888888`n" -ForegroundColor White
