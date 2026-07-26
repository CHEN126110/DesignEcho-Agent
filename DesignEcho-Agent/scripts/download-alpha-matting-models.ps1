# DesignEcho 专业 Alpha Matting 模型下载脚本
# 这些模型可以实现超越 Photoshop 的毛发抠图效果

$modelsDir = "$env:APPDATA\DesignEcho-Agent\models"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "DesignEcho 专业毛发抠图模型下载" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 模型列表
$models = @(
    @{
        Name = "ViTMatte"
        Dir = "vitmatte"
        File = "vitmatte-s.onnx"
        URL = "https://huggingface.co/niceholmes/vitmatte/resolve/main/vitmatte-s.onnx"
        Size = "~120MB"
        Desc = "Vision Transformer Matting - 毛发/透明边缘处理最佳，需 trimap 引导"
    },
    @{
        Name = "RobustVideoMatting (RVM)"
        Dir = "rvm"
        File = "rvm_resnet50_fp32.onnx"
        URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.onnx"
        Size = "~100MB"
        Desc = "实时视频 Alpha Matting - 毛发处理优秀，连续帧稳定"
    },
    @{
        Name = "InSPyReNet"
        Dir = "inspyrenet"
        File = "inspyrenet.onnx"
        URL = "https://github.com/plemeri/InSPyReNet/releases/download/v1.0/InSPyReNet_SwinB_Plus_Ultra.onnx"
        Size = "~380MB"
        Desc = "高分辨率显著性检测 - 边缘锐利，适合大图"
    }
)

Write-Host "可用模型:" -ForegroundColor Yellow
Write-Host ""

for ($i = 0; $i -lt $models.Count; $i++) {
    $m = $models[$i]
    $targetDir = Join-Path $modelsDir $m.Dir
    $targetFile = Join-Path $targetDir $m.File
    $status = if (Test-Path $targetFile) { "[已下载]" } else { "[未下载]" }
    $statusColor = if (Test-Path $targetFile) { "Green" } else { "Red" }
    
    Write-Host "  $($i + 1). $($m.Name) $status" -ForegroundColor $statusColor
    Write-Host "     大小: $($m.Size)" -ForegroundColor Gray
    Write-Host "     说明: $($m.Desc)" -ForegroundColor Gray
    Write-Host ""
}

Write-Host ""
$choice = Read-Host "请输入要下载的模型编号 (1-$($models.Count))，或输入 'all' 下载全部，'q' 退出"

if ($choice -eq 'q') {
    Write-Host "已取消" -ForegroundColor Yellow
    exit
}

$toDownload = @()
if ($choice -eq 'all') {
    $toDownload = $models
} else {
    $idx = [int]$choice - 1
    if ($idx -ge 0 -and $idx -lt $models.Count) {
        $toDownload = @($models[$idx])
    } else {
        Write-Host "无效选择" -ForegroundColor Red
        exit
    }
}

foreach ($m in $toDownload) {
    $targetDir = Join-Path $modelsDir $m.Dir
    $targetFile = Join-Path $targetDir $m.File
    
    if (Test-Path $targetFile) {
        Write-Host "✓ $($m.Name) 已存在，跳过" -ForegroundColor Green
        continue
    }
    
    # 创建目录
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    
    Write-Host ""
    Write-Host "正在下载 $($m.Name)..." -ForegroundColor Cyan
    Write-Host "URL: $($m.URL)" -ForegroundColor Gray
    Write-Host "目标: $targetFile" -ForegroundColor Gray
    
    try {
        # 使用 curl 下载（Windows 10+ 自带）
        $curlArgs = @(
            "-L",  # 跟随重定向
            "-#",  # 进度条
            "-o", $targetFile,
            $m.URL
        )
        & curl @curlArgs
        
        if (Test-Path $targetFile) {
            $size = (Get-Item $targetFile).Length / 1MB
            Write-Host "✓ $($m.Name) 下载完成 ($([math]::Round($size, 1)) MB)" -ForegroundColor Green
        } else {
            Write-Host "✗ $($m.Name) 下载失败" -ForegroundColor Red
        }
    } catch {
        Write-Host "✗ 下载失败: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "下载完成！重启 DesignEcho Agent 生效" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
