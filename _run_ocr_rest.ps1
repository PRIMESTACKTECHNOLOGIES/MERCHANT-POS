Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

$ImageDir = "f:\POS ORGINAL\_doc_images"
$OutputFile = "f:\POS ORGINAL\_ocr_results_full.json"
$AllTextFile = "f:\POS ORGINAL\_ocr_all_text_full.txt"
$ExistingFile = "f:\POS ORGINAL\_ocr_results.json"

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en"))
}
Write-Host "OCR Engine: $($engine.RecognizerLanguage.LanguageTag)"

# Load existing results
$existing = @{}
if (Test-Path $ExistingFile) {
    try {
        $raw = Get-Content $ExistingFile -Raw -Encoding UTF8
        $existing = $raw | ConvertFrom-Json -AsHashtable
        Write-Host "Loaded existing: $($existing.Count) results"
    } catch {}
}

$files = Get-ChildItem -Path $ImageDir -File
Write-Host "Total images: $($files.Count)"

# Process remaining files in natural order
$results = [System.Collections.Hashtable]::Synchronized(@{})
foreach ($k in $existing.Keys) { $results[$k] = $existing[$k] }

$allTextSb = New-Object System.Text.StringBuilder
$processed = 0
$already = 0
$total = $files.Count

foreach ($file in $files) {
    if ($results.ContainsKey($file.Name)) {
        $already++
        if ($results[$file.Name].text) {
            [void]$allTextSb.AppendLine($results[$file.Name].text)
        }
        continue
    }
    $processed++
    Write-Host "[$processed new / $total] OCR: $($file.Name)"
    try {
        $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
        $stream = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        
        $bgra = [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8
        if ($bitmap.BitmapPixelFormat -ne $bgra) {
            $bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, $bgra)
        }
        
        $ocrResult = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $text = $ocrResult.Text
        $lines = @()
        if ($ocrResult.Lines) {
            $lines = @($ocrResult.Lines | ForEach-Object { $_.Text })
        }
        $results[$file.Name] = [PSCustomObject]@{
            path = $file.FullName
            text = $text
            lines = $lines
        }
        [void]$allTextSb.AppendLine($text)
        $trimmed = $text.Trim()
        if ($trimmed) {
            Write-Host "  OK ($($trimmed.Length) chars)"
            $firstLines = ($lines | Select-Object -First 2) -join " | "
            if ($firstLines.Length -gt 160) { $firstLines = $firstLines.Substring(0,160) + "..." }
            Write-Host "  >> $firstLines"
        } else {
            Write-Host "  (blank)"
        }
    } catch {
        Write-Host "  ERR: $($_.Exception.Message)"
        $results[$file.Name] = [PSCustomObject]@{ error = $_.Exception.Message }
    }
}

Write-Host "`nProcessing done. New: $processed, Already: $already"

$results | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $OutputFile -Encoding utf8
$allTextSb.ToString() | Out-File -FilePath $AllTextFile -Encoding utf8
Write-Host "Saved: $OutputFile"
Write-Host "Saved: $AllTextFile"
