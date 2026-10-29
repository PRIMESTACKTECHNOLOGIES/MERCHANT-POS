# Windows OCR via PowerShell
param(
    [string]$ImageDir = "f:\POS ORGINAL\_doc_images",
    [string]$OutputFile = "f:\POS ORGINAL\_ocr_results.json"
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

function AwaitSimple($WinRtTask) {
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 })[0]
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en"))
}
if (-not $engine) {
    Write-Error "Could not create OCR engine"
    exit 1
}
Write-Host "OCR Engine created: $($engine.RecognizerLanguage.LanguageTag)"

# Prioritize files: look for early pages + names suggesting credentials
$files = Get-ChildItem -Path $ImageDir -File | Sort-Object {
    # Priority: final 1 pages 1-20, final 2 slides 1-15, final 3 slides 1-15, then rest
    $name = $_.Name
    $prio = 999
    if ($name -match "final 1\.pdf_p(\d+)_") { [int]$n = $matches[1]; if ($n -le 30) { $prio = $n } else { $prio = 200 + $n } }
    elseif ($name -match "final 2\.pptx_image(\d+)\.") { [int]$n = $matches[1]; if ($n -le 25) { $prio = 100 + $n } else { $prio = 300 + $n } }
    elseif ($name -match "final 3\.pptx_image(\d+)\.") { [int]$n = $matches[1]; if ($n -le 20) { $prio = 50 + $n } else { $prio = 400 + $n } }
    $prio
}

$results = @{}
$processed = 0
$maxToProcess = [Math]::Min($files.Count, 80)  # First 80 priority images

foreach ($file in $files | Select-Object -First $maxToProcess) {
    $processed++
    Write-Host "[$processed/$maxToProcess] OCR: $($file.Name)"
    try {
        $storageFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
        $stream = Await ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        
        # Convert to BGRA8 if needed
        $convertible = [Windows.Graphics.Imaging.BitmapBuffer]::new()
        $bgra = [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8
        if ($bitmap.BitmapPixelFormat -ne $bgra) {
            $sbmp = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, $bgra)
            $bitmap = $sbmp
        }
        
        $ocrResult = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $text = $ocrResult.Text
        $results[$file.Name] = @{
            path = $file.FullName
            text = $text
            lines = @($ocrResult.Lines | ForEach-Object { $_.Text })
        }
        if ($text.Trim()) {
            Write-Host "  Text length: $($text.Length)"
            # Show preview
            $preview = ($text -split "`n" | Select-Object -First 5) -join " | "
            if ($preview.Length -gt 200) { $preview = $preview.Substring(0,200) + "..." }
            Write-Host "  Preview: $preview"
        } else {
            Write-Host "  (no text found)"
        }
    } catch {
        Write-Host "  ERR: $_"
        $results[$file.Name] = @{ error = $_.Exception.Message }
    }
}

# Save results
$results | ConvertTo-Json -Depth 5 -Compress | Out-File -FilePath $OutputFile -Encoding utf8
Write-Host "`nSaved results to: $OutputFile"
Write-Host "Processed $processed images"

# Quick credential scan on all extracted text
Write-Host "`n=== CREDENTIAL SCAN ==="
$allText = ($results.Values | ForEach-Object { if ($_.text) { $_.text } }) -join "`n"
$credPatterns = @(
    @{ name = "URL"; re = [regex]'https?://[^\s\"''<>)]+' },
    @{ name = "KEY_TOKEN"; re = [regex]'(?i)(api[_ -]?key|apikey|secret|token|password|pwd|bearer|client[_ -]?secret|private[_ -]?key|access[_ -]?key)\s*[:=]\s*["'']?([A-Za-z0-9_\-\.]{6,})[''']?' },
    @{ name = "ID"; re = [regex]'(?i)(client[_ -]?id|merchant[_ -]?id|mid|tid|terminal[_ -]?id|account[_ -]?id|username|user[_ -]?id|login)\s*[:=]\s*["'']?([A-Za-z0-9_\-\.@]{3,})[''']?' },
    @{ name = "ENDPOINT"; re = [regex]'(?i)(endpoint|url|host|base[_ -]?url|gateway|webhook|callback)\s*[:=]\s*([^\s;\"'']{5,})' },
    @{ name = "HASH"; re = [regex]'\b[A-Fa-f0-9]{32,64}\b' },
    @{ name = "CARDNUM"; re = [regex]'\b\d{13,19}\b' },
    @{ name = "APIKEY_STYLE"; re = [regex]'\b(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b' },
    @{ name = "KEY_FILE"; re = [regex]'\b[A-Za-z0-9_\-\.]{6,}\.(?:pem|crt|key|pfx)\b' },
)

foreach ($pat in $credPatterns) {
    $matches_found = $pat.re.Matches($allText)
    if ($matches_found.Count -gt 0) {
        Write-Host "`n[$($pat.name)] found $($matches_found.Count):"
        $unique = @{}
        foreach ($m in $matches_found) {
            $val = if ($m.Groups.Count -gt 2 -and $m.Groups[2].Success) { $m.Groups[1].Value.Trim() + " = " + $m.Groups[2].Value.Trim() } else { $m.Value }
            if (-not $unique.ContainsKey($val)) {
                $unique[$val] = $true
                Write-Host "  -> $val"
            }
            if ($unique.Count -ge 20) { break }
        }
    }
}

# Dump full text for review
$allText | Out-File -FilePath "f:\POS ORGINAL\_ocr_all_text.txt" -Encoding utf8
Write-Host "`nFull OCR text saved to: f:\POS ORGINAL\_ocr_all_text.txt"
