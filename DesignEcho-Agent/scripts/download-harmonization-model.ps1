# Download Image Harmonization Model Script
# IC-Light ONNX model for foreground-background harmonization

$modelDir = Join-Path $PSScriptRoot "..\models\harmonization"

if (-not (Test-Path $modelDir)) {
    New-Item -ItemType Directory -Path $modelDir -Force | Out-Null
    Write-Host "[+] Created directory: $modelDir" -ForegroundColor Green
}

# IC-Light 模型需要从 PyTorch 转换为 ONNX
# 官方仓库: https://github.com/lllyasviel/IC-Light
# 目前使用占位 URL，需要手动转换或使用第三方转换版本
$modelUrl = "https://huggingface.co/lllyasviel/ic-light-onnx/resolve/main/ic-light-fc-unet.onnx"
$modelFile = "ic-light-fc-unet.onnx"
$targetPath = Join-Path $modelDir $modelFile

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Image Harmonization Model Downloader" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $targetPath) {
    $fileSize = (Get-Item $targetPath).Length / 1MB
    Write-Host "[OK] Model already exists: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Yellow
    exit 0
}

Write-Host "[*] Downloading IC-Light model..." -ForegroundColor Cyan
Write-Host "    Size: ~1.3GB" -ForegroundColor Gray
Write-Host "    URL: $modelUrl" -ForegroundColor Gray
Write-Host ""

try {
    $curlPath = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curlPath) {
        Write-Host "[*] Using curl for download..." -ForegroundColor Gray
        & curl.exe -L --progress-bar -o $targetPath $modelUrl
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "curl failed with exit code $exitCode"
        }
    } else {
        Write-Host "[*] Using PowerShell for download (slower)..." -ForegroundColor Gray
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $modelUrl -OutFile $targetPath -UseBasicParsing
    }
    
    if (Test-Path $targetPath) {
        $fileSize = (Get-Item $targetPath).Length / 1MB
        Write-Host ""
        Write-Host "[OK] Download complete: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
    } else {
        throw "File not created"
    }
}
catch {
    Write-Host "[FAIL] Download failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual download instructions:" -ForegroundColor Yellow
    Write-Host "1. Visit: https://huggingface.co/lllyasviel/ic-light-onnx" -ForegroundColor Gray
    Write-Host "2. Download: ic-light-fc-unet.onnx" -ForegroundColor Gray
    Write-Host "3. Place in: $modelDir" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Model ready for use!" -ForegroundColor Green
