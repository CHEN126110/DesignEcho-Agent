# 下载 BiRefNet ONNX 模型
# BiRefNet 是目前最好的开源抠图模型之一

$ModelsDir = "$PSScriptRoot\..\models"
$BiRefNetDir = "$ModelsDir\birefnet"

# 创建目录
if (-not (Test-Path $BiRefNetDir)) {
    New-Item -ItemType Directory -Path $BiRefNetDir -Force | Out-Null
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  BiRefNet ONNX 模型下载器" -ForegroundColor Cyan  
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# BiRefNet 模型下载地址
# 来源: https://huggingface.co/onnx-community/BiRefNet
$DownloadUrl = "https://huggingface.co/onnx-community/BiRefNet/resolve/main/onnx/model.onnx"
$OutputFile = "$BiRefNetDir\birefnet.onnx"

if (Test-Path $OutputFile) {
    Write-Host "[INFO] BiRefNet 模型已存在: $OutputFile" -ForegroundColor Yellow
    Write-Host "[INFO] 如需重新下载，请先删除现有文件" -ForegroundColor Yellow
} else {
    Write-Host "[下载] BiRefNet 模型 (~500MB)..." -ForegroundColor Green
    Write-Host "[URL] $DownloadUrl" -ForegroundColor Gray
    Write-Host ""
    
    try {
        # 使用 curl 下载（显示进度）
        curl.exe -L -o $OutputFile $DownloadUrl --progress-bar
        
        if (Test-Path $OutputFile) {
            $FileSize = (Get-Item $OutputFile).Length / 1MB
            Write-Host ""
            Write-Host "[完成] BiRefNet 下载成功!" -ForegroundColor Green
            Write-Host "[大小] $([math]::Round($FileSize, 1)) MB" -ForegroundColor Gray
            Write-Host "[路径] $OutputFile" -ForegroundColor Gray
        } else {
            Write-Host "[错误] 下载失败" -ForegroundColor Red
        }
    } catch {
        Write-Host "[错误] 下载失败: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

# 备选: RMBG-1.4 模型
$RmbgDir = "$ModelsDir\rmbg"
$RmbgUrl = "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx"
$RmbgFile = "$RmbgDir\rmbg-1.4.onnx"

Write-Host ""
Write-Host "是否也下载 RMBG-1.4 模型? (另一个高质量模型)" -ForegroundColor Yellow
$response = Read-Host "输入 y 下载，其他跳过"

if ($response -eq 'y' -or $response -eq 'Y') {
    if (-not (Test-Path $RmbgDir)) {
        New-Item -ItemType Directory -Path $RmbgDir -Force | Out-Null
    }
    
    if (Test-Path $RmbgFile) {
        Write-Host "[INFO] RMBG-1.4 模型已存在" -ForegroundColor Yellow
    } else {
        Write-Host "[下载] RMBG-1.4 模型 (~180MB)..." -ForegroundColor Green
        curl.exe -L -o $RmbgFile $RmbgUrl --progress-bar
        
        if (Test-Path $RmbgFile) {
            $FileSize = (Get-Item $RmbgFile).Length / 1MB
            Write-Host "[完成] RMBG-1.4 下载成功! ($([math]::Round($FileSize, 1)) MB)" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "模型下载完成！请重启应用以加载新模型。" -ForegroundColor Cyan
