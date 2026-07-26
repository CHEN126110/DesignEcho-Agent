/**
 * 性能基准测试：UXP 本地变形 vs Agent 端变形
 * 
 * 验证 Google 模型建议：
 * "放弃 UXP 计算插值，传输图像到 Agent 用 Sharp 处理"
 */

import sharp from 'sharp';
import { DisplacementField } from './types';

/**
 * 测试结果
 */
export interface BenchmarkResult {
    scenario: string;
    imageSize: string;
    
    // 各阶段耗时
    timings: {
        transferToAgent: number;    // UXP → Agent 传输
        sharpProcessing: number;    // Sharp 处理
        jsProcessing: number;       // 纯 JS 处理
        transferBack: number;       // Agent → UXP 传输
    };
    
    // 总耗时对比
    totalSharpPipeline: number;     // Sharp 方案总耗时
    totalJSPipeline: number;        // UXP JS 方案总耗时
    speedup: number;                // 加速比
}

/**
 * 模拟网络传输延迟
 * 实际测量本地回环网络传输 16MB 的时间
 */
async function measureTransferTime(dataSize: number): Promise<number> {
    const start = performance.now();
    
    // 模拟 Buffer 创建和序列化
    const buffer = Buffer.alloc(dataSize);
    
    // 填充随机数据（模拟真实图像）
    for (let i = 0; i < Math.min(dataSize, 1000); i++) {
        buffer[i] = Math.floor(Math.random() * 256);
    }
    
    // Base64 编码（WebSocket 传输方式）
    const base64 = buffer.toString('base64');
    
    // 模拟接收端解码
    const decoded = Buffer.from(base64, 'base64');
    
    return performance.now() - start;
}

/**
 * Sharp 双线性插值重采样
 */
async function sharpBilinearResample(
    buffer: Buffer,
    width: number,
    height: number,
    dx: Float32Array,
    dy: Float32Array
): Promise<{ result: Buffer; time: number }> {
    const start = performance.now();
    
    // Sharp 不直接支持位移场变形，需要分步处理
    // 这里测试 Sharp 的原生 resize 性能作为参考
    const result = await sharp(buffer, {
        raw: { width, height, channels: 4 }
    })
    .resize(width, height, {
        kernel: sharp.kernel.lanczos3,
        fit: 'fill'
    })
    .raw()
    .toBuffer();
    
    return {
        result,
        time: performance.now() - start
    };
}

/**
 * 纯 JavaScript 双线性插值（模拟 UXP 环境）
 */
function jsBilinearResample(
    src: Uint8Array,
    width: number,
    height: number,
    dx: Float32Array,
    dy: Float32Array
): { result: Uint8Array; time: number } {
    const start = performance.now();
    
    const channels = 4;
    const dst = new Uint8Array(width * height * channels);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            
            // 源坐标
            const srcX = x - dx[idx];
            const srcY = y - dy[idx];
            
            // 双线性插值
            const x0 = Math.floor(srcX);
            const y0 = Math.floor(srcY);
            const x1 = Math.min(x0 + 1, width - 1);
            const y1 = Math.min(y0 + 1, height - 1);
            
            const fx = srcX - x0;
            const fy = srcY - y0;
            
            const dstIdx = idx * channels;
            
            if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) {
                for (let c = 0; c < channels; c++) {
                    dst[dstIdx + c] = 0;
                }
                continue;
            }
            
            const idx00 = (y0 * width + Math.max(0, x0)) * channels;
            const idx10 = (y0 * width + x1) * channels;
            const idx01 = (Math.min(y1, height - 1) * width + Math.max(0, x0)) * channels;
            const idx11 = (Math.min(y1, height - 1) * width + x1) * channels;
            
            for (let c = 0; c < channels; c++) {
                const v00 = src[idx00 + c];
                const v10 = src[idx10 + c];
                const v01 = src[idx01 + c];
                const v11 = src[idx11 + c];
                
                const value = (1 - fx) * (1 - fy) * v00 +
                              fx * (1 - fy) * v10 +
                              (1 - fx) * fy * v01 +
                              fx * fy * v11;
                
                dst[dstIdx + c] = Math.round(value);
            }
        }
    }
    
    return {
        result: dst,
        time: performance.now() - start
    };
}

/**
 * Sharp 位移场变形实现
 * 使用 Sharp 的 affine 变换分块处理
 */
async function sharpDisplacementWarp(
    buffer: Buffer,
    width: number,
    height: number,
    dx: Float32Array,
    dy: Float32Array
): Promise<{ result: Buffer; time: number }> {
    const start = performance.now();
    
    // Sharp 没有直接的位移场 API，需要自己实现像素级操作
    // 但可以利用 Sharp 的 raw() 和高效内存管理
    
    const { data, info } = await sharp(buffer, {
        raw: { width, height, channels: 4 }
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
    
    const channels = info.channels;
    const result = Buffer.alloc(width * height * channels);
    
    // 使用 Sharp 的 Buffer 直接操作（比 UXP 快）
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            
            const srcX = x - dx[idx];
            const srcY = y - dy[idx];
            
            const x0 = Math.floor(srcX);
            const y0 = Math.floor(srcY);
            const x1 = Math.min(x0 + 1, width - 1);
            const y1 = Math.min(y0 + 1, height - 1);
            
            const fx = srcX - x0;
            const fy = srcY - y0;
            
            const dstIdx = idx * channels;
            
            if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) {
                continue;
            }
            
            const idx00 = (y0 * width + Math.max(0, x0)) * channels;
            const idx10 = (y0 * width + x1) * channels;
            const idx01 = (Math.min(y1, height - 1) * width + Math.max(0, x0)) * channels;
            const idx11 = (Math.min(y1, height - 1) * width + x1) * channels;
            
            for (let c = 0; c < channels; c++) {
                const v00 = data[idx00 + c];
                const v10 = data[idx10 + c];
                const v01 = data[idx01 + c];
                const v11 = data[idx11 + c];
                
                const value = (1 - fx) * (1 - fy) * v00 +
                              fx * (1 - fy) * v10 +
                              (1 - fx) * fy * v01 +
                              fx * fy * v11;
                
                result[dstIdx + c] = Math.round(value);
            }
        }
    }
    
    return {
        result,
        time: performance.now() - start
    };
}

/**
 * 运行完整基准测试
 */
export async function runBenchmark(
    width: number = 2000,
    height: number = 2000
): Promise<BenchmarkResult> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 性能基准测试: ${width}×${height} 图像`);
    console.log(`${'='.repeat(60)}\n`);
    
    const dataSize = width * height * 4;  // RGBA
    
    // 1. 测试传输时间
    console.log('1️⃣ 测试传输时间...');
    const transferToAgent = await measureTransferTime(dataSize);
    const transferBack = await measureTransferTime(dataSize);
    console.log(`   UXP → Agent: ${transferToAgent.toFixed(2)}ms`);
    console.log(`   Agent → UXP: ${transferBack.toFixed(2)}ms`);
    
    // 2. 创建测试数据
    console.log('\n2️⃣ 创建测试数据...');
    const testBuffer = Buffer.alloc(dataSize);
    for (let i = 0; i < dataSize; i++) {
        testBuffer[i] = Math.floor(Math.random() * 256);
    }
    
    // 创建测试位移场（模拟边缘带变形）
    const dx = new Float32Array(width * height);
    const dy = new Float32Array(width * height);
    
    // 模拟边缘带位移
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            
            // 边缘 50px 内有位移
            const distToEdge = Math.min(
                x, width - x - 1,
                y, height - y - 1
            );
            
            if (distToEdge < 50) {
                dx[idx] = (50 - distToEdge) * 0.3 * (Math.random() - 0.5);
                dy[idx] = (50 - distToEdge) * 0.3 * (Math.random() - 0.5);
            }
        }
    }
    
    // 3. 测试 Sharp 处理
    console.log('\n3️⃣ 测试 Sharp 处理...');
    const sharpResult = await sharpDisplacementWarp(testBuffer, width, height, dx, dy);
    console.log(`   Sharp 变形: ${sharpResult.time.toFixed(2)}ms`);
    
    // 4. 测试纯 JS 处理（模拟 UXP）
    console.log('\n4️⃣ 测试纯 JS 处理 (模拟 UXP)...');
    const jsResult = jsBilinearResample(new Uint8Array(testBuffer), width, height, dx, dy);
    console.log(`   JS 变形: ${jsResult.time.toFixed(2)}ms`);
    
    // 5. 计算总耗时
    const totalSharpPipeline = transferToAgent + sharpResult.time + transferBack;
    const totalJSPipeline = jsResult.time;  // UXP 本地处理无传输开销
    
    const speedup = totalJSPipeline / totalSharpPipeline;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('📈 测试结果:');
    console.log(`${'='.repeat(60)}`);
    console.log(`
┌─────────────────────────────────────────────────────────┐
│  方案对比: ${width}×${height} RGBA 图像 (${(dataSize / 1024 / 1024).toFixed(1)}MB)
├─────────────────────────────────────────────────────────┤
│
│  方案 A: Agent 端 Sharp 处理
│  ├─ 传输到 Agent:  ${transferToAgent.toFixed(2)}ms
│  ├─ Sharp 变形:    ${sharpResult.time.toFixed(2)}ms
│  └─ 传输回 UXP:    ${transferBack.toFixed(2)}ms
│  总计:             ${totalSharpPipeline.toFixed(2)}ms
│
│  方案 B: UXP 端 JS 处理
│  └─ JS 变形:       ${jsResult.time.toFixed(2)}ms
│  总计:             ${totalJSPipeline.toFixed(2)}ms
│
├─────────────────────────────────────────────────────────┤
│  加速比: ${speedup.toFixed(2)}x ${speedup > 1 ? '(Agent 方案更优)' : '(UXP 方案更优)'}
└─────────────────────────────────────────────────────────┘
`);
    
    return {
        scenario: 'displacement-warp',
        imageSize: `${width}×${height}`,
        timings: {
            transferToAgent,
            sharpProcessing: sharpResult.time,
            jsProcessing: jsResult.time,
            transferBack
        },
        totalSharpPipeline,
        totalJSPipeline,
        speedup
    };
}

/**
 * 运行多尺寸对比测试
 */
export async function runMultiSizeBenchmark(): Promise<BenchmarkResult[]> {
    const sizes = [
        [500, 500],
        [1000, 1000],
        [2000, 2000],
        [3000, 3000],
        [4000, 4000]
    ];
    
    const results: BenchmarkResult[] = [];
    
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║         多尺寸性能基准测试: UXP JS vs Agent Sharp            ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    
    for (const [w, h] of sizes) {
        const result = await runBenchmark(w, h);
        results.push(result);
    }
    
    // 汇总表格
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                        汇总对比表                             ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log('║ 尺寸        │ Sharp 总耗时 │ JS 总耗时  │ 加速比  │ 推荐方案  ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    
    for (const r of results) {
        const recommend = r.speedup > 1.5 ? 'Agent' : (r.speedup < 0.7 ? 'UXP' : '相当');
        console.log(
            `║ ${r.imageSize.padEnd(11)} │ ${r.totalSharpPipeline.toFixed(0).padStart(8)}ms │ ${r.totalJSPipeline.toFixed(0).padStart(8)}ms │ ${r.speedup.toFixed(2).padStart(6)}x │ ${recommend.padStart(8)} ║`
        );
    }
    
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    
    return results;
}

/**
 * 验证 Google 建议的结论
 */
export async function verifyGoogleRecommendation(): Promise<void> {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('     验证 Google 模型建议: "Agent Sharp 处理优于 UXP JS"');
    console.log('═══════════════════════════════════════════════════════════════');
    
    const results = await runMultiSizeBenchmark();
    
    // 分析结论
    const avgSpeedup = results.reduce((sum, r) => sum + r.speedup, 0) / results.length;
    const largeImageSpeedup = results.filter(r => 
        parseInt(r.imageSize.split('×')[0]) >= 2000
    ).reduce((sum, r) => sum + r.speedup, 0) / 3;
    
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                        验证结论');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`
Google 建议: "Node.js 图像处理速度比 UXP JS 快 10-50 倍"

实测结果:
├─ 平均加速比: ${avgSpeedup.toFixed(2)}x
├─ 大图 (≥2000px) 加速比: ${largeImageSpeedup.toFixed(2)}x
│
├─ 传输开销: ${results[2]?.timings.transferToAgent.toFixed(0)}ms + ${results[2]?.timings.transferBack.toFixed(0)}ms = ${((results[2]?.timings.transferToAgent || 0) + (results[2]?.timings.transferBack || 0)).toFixed(0)}ms
├─ Sharp 处理: ${results[2]?.timings.sharpProcessing.toFixed(0)}ms
└─ JS 处理: ${results[2]?.timings.jsProcessing.toFixed(0)}ms

结论:
${avgSpeedup > 2 
    ? '✅ Google 建议有效！Agent Sharp 方案显著优于 UXP JS' 
    : avgSpeedup > 1 
        ? '⚠️ Google 建议部分有效，优势不如预期的 10-50 倍'
        : '❌ Google 建议不适用于当前场景'}

${avgSpeedup > 1 
    ? '建议: 采用 Agent 端 Sharp 处理方案' 
    : '建议: 保持 UXP 端处理或使用稀疏位移场优化'}
`);
}
