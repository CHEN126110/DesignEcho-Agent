/**
 * 生成 UXP 插件专业图标
 * 使用 sharp 从 SVG 渲染高质量 PNG
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// 专业的 DesignEcho 图标 SVG
const iconSVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <!-- 主渐变背景 -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6366F1"/>
      <stop offset="40%" style="stop-color:#8B5CF6"/>
      <stop offset="100%" style="stop-color:#06B6D4"/>
    </linearGradient>
    <!-- 光泽效果 -->
    <linearGradient id="shineGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.3"/>
      <stop offset="50%" style="stop-color:#ffffff;stop-opacity:0.05"/>
      <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0"/>
    </linearGradient>
    <!-- 阴影滤镜 -->
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
    <!-- 内发光 -->
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- 背景圆角矩形 -->
  <rect x="32" y="32" width="448" height="448" rx="96" fill="url(#bgGrad)" filter="url(#shadow)"/>
  
  <!-- 光泽层 -->
  <rect x="32" y="32" width="448" height="224" rx="96" fill="url(#shineGrad)"/>
  
  <!-- 回声波形图案 -->
  <g transform="translate(256, 256)" filter="url(#glow)">
    <!-- 中心圆点 -->
    <circle cx="0" cy="0" r="40" fill="white"/>
    
    <!-- 第一层波 -->
    <circle cx="0" cy="0" r="85" fill="none" stroke="white" stroke-width="20" opacity="0.9"/>
    
    <!-- 第二层波 -->
    <circle cx="0" cy="0" r="140" fill="none" stroke="white" stroke-width="16" opacity="0.6"/>
    
    <!-- 第三层波 (上下弧线) -->
    <path d="M -170 -80 A 190 190 0 0 1 170 -80" fill="none" stroke="white" stroke-width="12" opacity="0.35" stroke-linecap="round"/>
    <path d="M -170 80 A 190 190 0 0 0 170 80" fill="none" stroke="white" stroke-width="12" opacity="0.35" stroke-linecap="round"/>
  </g>
  
  <!-- 装饰小点 -->
  <circle cx="100" cy="100" r="12" fill="white" opacity="0.4"/>
  <circle cx="412" cy="412" r="12" fill="white" opacity="0.4"/>
</svg>
`;

// 目标路径
const targetDir = path.join(__dirname, '..', '..', 'DesignEcho-UXP', 'icons');

// 确保目录存在
if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
}

// 生成不同尺寸的图标
const sizes = [
    { name: 'icon@1x.png', size: 23 },
    { name: 'icon@2x.png', size: 46 },
    { name: 'plugin-icon.png', size: 48 },
    { name: 'icon-large.png', size: 128 }  // 额外生成一个大尺寸预览
];

async function generateIcons() {
    console.log('🎨 生成 DesignEcho 专业图标...\n');
    
    const svgBuffer = Buffer.from(iconSVG);
    
    for (const { name, size } of sizes) {
        try {
            await sharp(svgBuffer)
                .resize(size, size, {
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .png({
                    quality: 100,
                    compressionLevel: 9
                })
                .toFile(path.join(targetDir, name));
            
            console.log(`✅ ${name} (${size}x${size})`);
        } catch (error) {
            console.error(`❌ ${name} 生成失败:`, error.message);
        }
    }
    
    // 也保存 SVG 源文件
    fs.writeFileSync(path.join(targetDir, 'icon.svg'), iconSVG.trim());
    console.log(`✅ icon.svg (源文件)`);
    
    console.log('\n🎉 图标生成完成！');
    console.log('📂 输出目录:', targetDir);
    console.log('\n📌 请在 Photoshop 中重新加载插件以查看新图标。');
}

generateIcons().catch(console.error);
