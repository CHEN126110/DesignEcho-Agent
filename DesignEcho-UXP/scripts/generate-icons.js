/**
 * 生成 UXP 插件图标 - DesignEcho 回声波形设计
 * 运行: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * 创建 DesignEcho 风格的 PNG 图标
 * 设计元素：渐变背景 + 回声波形圆环
 */
function createDesignEchoPNG(width, height) {
    // PNG 签名
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    
    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // color type (RGBA)
    ihdrData[10] = 0; // compression method
    ihdrData[11] = 0; // filter method
    ihdrData[12] = 0; // interlace method
    const ihdr = createChunk('IHDR', ihdrData);
    
    // IDAT chunk (image data)
    const rawData = [];
    const centerX = width / 2;
    const centerY = height / 2;
    const cornerRadius = width * 0.2; // 圆角半径
    
    for (let y = 0; y < height; y++) {
        rawData.push(0); // filter byte
        for (let x = 0; x < width; x++) {
            // 检查是否在圆角矩形内
            const inRoundedRect = isInRoundedRect(x, y, width, height, cornerRadius);
            
            if (!inRoundedRect) {
                // 透明背景
                rawData.push(0, 0, 0, 0);
                continue;
            }
            
            // 渐变背景 (紫色 → 青色)
            const gradFactor = (x + y) / (width + height);
            let r = Math.round(79 + gradFactor * 40);   // #4F46E5 → #06B6D4
            let g = Math.round(70 + gradFactor * 112);
            let b = Math.round(229 - gradFactor * 17);
            let a = 255;
            
            // 计算到中心的距离
            const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
            const maxRadius = Math.min(width, height) * 0.45;
            
            // 中心实心圆
            const centerRadius = maxRadius * 0.18;
            if (dist < centerRadius) {
                r = 255; g = 255; b = 255; a = 255;
            }
            // 第一层波形环
            else if (Math.abs(dist - maxRadius * 0.4) < maxRadius * 0.08) {
                const ringAlpha = 1 - Math.abs(dist - maxRadius * 0.4) / (maxRadius * 0.08);
                r = Math.round(r + (255 - r) * ringAlpha * 0.9);
                g = Math.round(g + (255 - g) * ringAlpha * 0.9);
                b = Math.round(b + (255 - b) * ringAlpha * 0.9);
            }
            // 第二层波形环
            else if (Math.abs(dist - maxRadius * 0.7) < maxRadius * 0.06) {
                const ringAlpha = 1 - Math.abs(dist - maxRadius * 0.7) / (maxRadius * 0.06);
                r = Math.round(r + (255 - r) * ringAlpha * 0.6);
                g = Math.round(g + (255 - g) * ringAlpha * 0.6);
                b = Math.round(b + (255 - b) * ringAlpha * 0.6);
            }
            // 第三层波形环 (部分弧线 - 上下)
            else if (Math.abs(dist - maxRadius * 0.95) < maxRadius * 0.04) {
                const angle = Math.atan2(y - centerY, x - centerX);
                // 只绘制上下弧线
                if (Math.abs(Math.sin(angle)) > 0.5) {
                    const ringAlpha = (1 - Math.abs(dist - maxRadius * 0.95) / (maxRadius * 0.04)) * 0.4;
                    r = Math.round(r + (255 - r) * ringAlpha);
                    g = Math.round(g + (255 - g) * ringAlpha);
                    b = Math.round(b + (255 - b) * ringAlpha);
                }
            }
            
            rawData.push(r, g, b, a);
        }
    }
    
    const compressed = zlib.deflateSync(Buffer.from(rawData));
    const idat = createChunk('IDAT', compressed);
    
    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));
    
    return Buffer.concat([signature, ihdr, idat, iend]);
}

/**
 * 检查点是否在圆角矩形内
 */
function isInRoundedRect(x, y, width, height, radius) {
    // 四个角的圆心
    const corners = [
        { cx: radius, cy: radius },                    // 左上
        { cx: width - radius, cy: radius },            // 右上
        { cx: radius, cy: height - radius },           // 左下
        { cx: width - radius, cy: height - radius }    // 右下
    ];
    
    // 检查是否在角落区域
    if (x < radius && y < radius) {
        // 左上角
        return Math.sqrt(Math.pow(x - radius, 2) + Math.pow(y - radius, 2)) <= radius;
    }
    if (x > width - radius && y < radius) {
        // 右上角
        return Math.sqrt(Math.pow(x - (width - radius), 2) + Math.pow(y - radius, 2)) <= radius;
    }
    if (x < radius && y > height - radius) {
        // 左下角
        return Math.sqrt(Math.pow(x - radius, 2) + Math.pow(y - (height - radius), 2)) <= radius;
    }
    if (x > width - radius && y > height - radius) {
        // 右下角
        return Math.sqrt(Math.pow(x - (width - radius), 2) + Math.pow(y - (height - radius), 2)) <= radius;
    }
    
    // 在矩形内但不在角落
    return x >= 0 && x < width && y >= 0 && y < height;
}

function createChunk(type, data) {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcData);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc, 0);
    
    return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 计算
function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = getCRCTable();
    
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

let crcTable = null;
function getCRCTable() {
    if (crcTable) return crcTable;
    
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[i] = c;
    }
    return crcTable;
}

// 确保 icons 目录存在
const iconsDir = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

// 生成不同尺寸的图标
const sizes = [
    { name: 'icon@1x.png', width: 23, height: 23 },
    { name: 'icon@2x.png', width: 46, height: 46 },
    { name: 'plugin-icon.png', width: 48, height: 48 }
];

console.log('🎨 生成 DesignEcho 图标...\n');

sizes.forEach(({ name, width, height }) => {
    const png = createDesignEchoPNG(width, height);
    fs.writeFileSync(path.join(iconsDir, name), png);
    console.log(`✅ ${name} (${width}x${height})`);
});

console.log('\n🎉 图标生成完成！');
console.log('📌 请在 Photoshop 中重新加载插件以查看新图标。');
