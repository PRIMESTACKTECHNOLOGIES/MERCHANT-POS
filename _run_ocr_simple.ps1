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
$OutputFile = "f:\POS ORGINAL\_ocr_results.json"
$AllTextFile = "f:\POS ORGINAL\_ocr_all_text.txt"

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en"))
}
if (-not $engine) {
    Write-Host "ERROR: Could not create OCR engine"
    exit 1
}
Write-Host "OCR Engine: $($engine.RecognizerLanguage.LanguageTag)"

$files = Get-ChildItem -Path $ImageDir -File

# Sort with priority for credential-heavy pages
$sorted = @()
foreach ($f in $files) {
    $name = $f.Name
    $prio = 999
    if ($name -match "final 1\.pdf_p(\d+)_") {
        [int]$n = $matches[1]
        if ($n -le 30) { $prio = $n } else { $prio = 200 + $n }
    } elseif ($name -match "final 2\.pptx_image(\d+)\.") {
        [int]$n = $matches[1]
        if ($n -le 25) { $prio = 100 + $n } else { $prio = 300 + $n }
    } elseif ($name -match "final 3\.pptx_image(\d+)\.") {
        [int]$n = $matches[1]
        if ($n -le 20) { $prio = 50 + $n } else { $prio = 400 + $n }
    }
    $sorted += [PSCustomObject]@{ File = $f; Prio = $prio }
}
$sorted = $sorted | Sort-Object Prio

$results = @{}
$allTextSb = New-Object System.Text.StringBuilder
$processed = 0
$total = [Math]::Min($sorted.Count, 85)

foreach ($item in ($sorted | Select-Object -First $total)) {
    $file = $item.File
    $processed++
    Write-Host "[$processed/$total] OCR: $($file.Name)"
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
            $firstLines = ($lines | Select-Object -First 3) -join " | "
            if ($firstLines.Length -gt 180) { $firstLines = $firstLines.Substring(0,180) + "..." }
            Write-Host "  >> $firstLines"
        } else {
            Write-Host "  (blank)"
        }
    } catch {
        Write-Host "  ERR: $($_.Exception.Message)"
        $results[$file.Name] = [PSCustomObject]@{ error = $_.Exception.Message }
    }
}

# Save JSON
$results | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $OutputFile -Encoding utf8
Write-Host "JSON saved: $OutputFile"

# Save all text
$allTextSb.ToString() | Out-File -FilePath $AllTextFile -Encoding utf8
Write-Host "All text saved: $AllTextFile"
Write-Host "Done. Processed $processed images."
