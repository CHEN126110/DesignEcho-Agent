# DesignEcho 抠图模型下载脚本
# 运行方式: .\scripts\download-matting-models.ps1

$ErrorActionPreference = "Stop"

# 模型存储目录
$ModelsDir = "$PSScriptRoot\..\models"

# 创建模型目录
if (-not (Test-Path $ModelsDir)) {
    New-Item -ItemType Directory -Path $ModelsDir -Force | Out-Null
    Write-Host "✓ 创建模型目录: $ModelsDir" -ForegroundColor Green
}

# 模型列表
$Models = @(
    @{
        Name = "u2net"
        Description = "U2Net 显著性检测模型"
        Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
        FileName = "u2net.onnx"
        Size = "176MB"
    },
    @{
        Name = "u2netp"
        Description = "U2Net-P 轻量版 (更快)"
        Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
        FileName = "u2netp.onnx"
        Size = "4.5MB"
    },
    @{
        Name = "isnet"
        Description = "IS-Net 高精度边缘检测"
        Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
        FileName = "isnet-general-use.onnx"
        Size = "180MB"
    },
    @{
        Name = "silueta"
        Description = "Silueta 人像优化模型"
        Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx"
        FileName = "silueta.onnx"
        Size = "44MB"
    },
    @{
        Name = "birefnet"
        Description = "BiRefNet 高精度模型 (最佳效果)"
        Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx"
        FileName = "BiRefNet-general-epoch_244.onnx"
        Size = "890MB"
    },
    @{
        Name = "isnet-anime"
        Description = "IS-Net 动漫风格优化"
        Url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx"
        FileName = "isnet-anime.onnx"
        Size = "180MB"
    }
)

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   DesignEcho 抠图模型下载工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "将下载以下模型到: $ModelsDir" -ForegroundColor Yellow
Write-Host ""

foreach ($model in $Models) {
    Write-Host "  - $($model.Name): $($model.Description) ($($model.Size))" -ForegroundColor White
}

Write-Host ""
$confirm = Read-Host "是否开始下载? (Y/N)"
if ($confirm -ne "Y" -and $confirm -ne "y") {
    Write-Host "已取消下载" -ForegroundColor Yellow
    exit
}

Write-Host ""

# 保存模型函数（使用批准的动词 Save-）
function Save-ModelFile {
    param($Model)
    
    $targetPath = Join-Path $ModelsDir $Model.Name
    $filePath = Join-Path $targetPath $Model.FileName
    
    # 创建模型子目录
    if (-not (Test-Path $targetPath)) {
        New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
    }
    
    # 检查是否已存在
    if (Test-Path $filePath) {
        Write-Host "  ✓ $($Model.Name) 已存在，跳过" -ForegroundColor Gray
        return $true
    }
    
    Write-Host "  ⏳ 下载 $($Model.Name) ($($Model.Size))..." -ForegroundColor Yellow
    
    try {
        # 使用 Invoke-WebRequest 下载
        $ProgressPreference = 'SilentlyContinue'  # 加快下载速度
        Invoke-WebRequest -Uri $Model.Url -OutFile $filePath -UseBasicParsing
        $ProgressPreference = 'Continue'
        
        Write-Host "  ✓ $($Model.Name) 下载完成" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "  ✗ $($Model.Name) 下载失败: $_" -ForegroundColor Red
        return $false
    }
}

# 开始下载
$successCount = 0
$failCount = 0

foreach ($model in $Models) {
    $result = Save-ModelFile -Model $model
    if ($result) {
        $successCount++
    } else {
        $failCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "下载完成！" -ForegroundColor Green
Write-Host "  成功: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "  失败: $failCount" -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 显示下一步
Write-Host "下一步:" -ForegroundColor Yellow
Write-Host "  1. 启动本地抠图服务 (需要 Python 环境)" -ForegroundColor White
Write-Host "  2. 运行: python scripts/matting-server.py" -ForegroundColor White
Write-Host ""
