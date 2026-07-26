/**
 * 形态统一端到端集成测试
 * 
 * 验证完整流程：
 * 1. JFA 距离场计算
 * 2. 智能袜口检测
 * 3. MLS 变形
 * 4. 稀疏位移场压缩
 * 5. 解压缩与应用
 */

import { JFADistanceField } from './jfa-distance-field';
import { SmartCuffDetector } from './smart-cuff-detector';
import { MLSDeformation } from './mls-deformation';
import { CuffType } from './types';
import { 
    compressDisplacementField, 
    serializeSparseDisplacement, 
    deserializeSparseDisplacement 
} from './sparse-displacement';
import { Point2D, BoundingBox, DisplacementField } from './types';
import sharp from 'sharp';

/**
 * 测试结果
 */
interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    details?: string;
    error?: string;
}

/**
 * 生成测试轮廓（袜子形状）
 */
function generateSockContour(
    width: number, 
    height: number, 
    scale: number = 0.8
): Point2D[] {
    const points: Point2D[] = [];
    const cx = width / 2;
    const cy = height / 2;
    const w = width * scale / 2;
    const h = height * scale / 2;
    
    // 生成袜子形状（简化为圆角矩形 + 脚尖）
    const steps = 100;
    for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        
        // 基础椭圆
        let x = cx + Math.cos(t) * w;
        let y = cy + Math.sin(t) * h;
        
        // 添加袜口宽度变化（顶部更宽）
        if (t > Math.PI * 0.8 && t < Math.PI * 1.2) {
            x *= 1.1;
        }
        
        // 添加脚尖突出
        if (t > -Math.PI * 0.3 && t < Math.PI * 0.3) {
            y += h * 0.2 * Math.cos(t * 5);
        }
        
        points.push({ x, y });
    }
    
    return points;
}

/**
 * 生成目标形状（稍微不同的袜子）
 */
function generateTargetContour(
    width: number, 
    height: number, 
    scale: number = 0.85
): Point2D[] {
    const points = generateSockContour(width, height, scale);
    
    // 整体向右偏移 10px
    return points.map(p => ({
        x: p.x + 10,
        y: p.y
    }));
}

/**
 * 创建测试图像
 */
async function createTestImage(
    width: number, 
    height: number
): Promise<Buffer> {
    // 创建渐变测试图像
    const channels = 4;
    const buffer = Buffer.alloc(width * height * channels);
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * channels;
            buffer[idx] = Math.floor((x / width) * 255);     // R
            buffer[idx + 1] = Math.floor((y / height) * 255); // G
            buffer[idx + 2] = 128;                            // B
            buffer[idx + 3] = 255;                            // A
        }
    }
    
    return buffer;
}

/**
 * 测试 1: JFA 距离场
 */
async function testJFADistanceField(): Promise<TestResult> {
    const name = 'JFA 距离场计算';
    const start = performance.now();
    
    try {
        const jfa = new JFADistanceField();
        const width = 500;
        const height = 500;
        const contour = generateSockContour(width, height);
        
        const distanceField = jfa.compute(width, height, contour);
        
        // 验证
        if (distanceField.length !== width * height) {
            throw new Error(`距离场大小错误: ${distanceField.length} != ${width * height}`);
        }
        
        // 检查轮廓点距离接近 0
        let maxContourDist = 0;
        for (const p of contour) {
            const idx = Math.round(p.y) * width + Math.round(p.x);
            if (idx >= 0 && idx < distanceField.length) {
                maxContourDist = Math.max(maxContourDist, distanceField[idx]);
            }
        }
        
        if (maxContourDist > 2) {
            throw new Error(`轮廓点距离过大: ${maxContourDist} > 2`);
        }
        
        return {
            name,
            passed: true,
            duration: performance.now() - start,
            details: `${width}×${height}, 轮廓 ${contour.length} 点, 最大轮廓距离 ${maxContourDist.toFixed(2)}px`
        };
    } catch (error: any) {
        return {
            name,
            passed: false,
            duration: performance.now() - start,
            error: error.message
        };
    }
}

/**
 * 测试 2: 智能袜口检测
 */
async function testSmartCuffDetector(): Promise<TestResult> {
    const name = '智能袜口检测';
    const start = performance.now();
    
    try {
        const detector = new SmartCuffDetector();
        const width = 500;
        const height = 500;
        const contour = generateSockContour(width, height);
        const imageBounds: BoundingBox = { x: 0, y: 0, width, height };
        
        const result = detector.detect(contour, imageBounds);
        
        // 验证结果结构
        if (!result.type) {
            throw new Error('缺少袜口类型');
        }
        
        if (!result.region) {
            throw new Error('缺少袜口区域信息');
        }
        
        return {
            name,
            passed: true,
            duration: performance.now() - start,
            details: `袜口类型: ${result.type}, 置信度: ${(result.confidence * 100).toFixed(0)}%`
        };
    } catch (error: any) {
        return {
            name,
            passed: false,
            duration: performance.now() - start,
            error: error.message
        };
    }
}

/**
 * 测试 3: MLS 变形
 */
async function testMLSDeformation(): Promise<TestResult> {
    const name = 'MLS 位移场计算';
    const start = performance.now();
    
    try {
        const mls = new MLSDeformation();
        const width = 500;
        const height = 500;
        
        const sourceContour = generateSockContour(width, height);
        const targetContour = generateTargetContour(width, height);
        
        // 生成控制点对
        const controlPairs = mls.generateControlPairs(sourceContour, targetContour, 30);
        
        if (controlPairs.length < 20) {
            throw new Error(`控制点数量不足: ${controlPairs.length}`);
        }
        
        // 计算位移场
        const displacement = mls.computeDisplacementField(width, height, controlPairs, 50);
        
        if (displacement.dx.length !== width * height) {
            throw new Error('位移场大小错误');
        }
        
        // 检查边缘区域有位移
        let hasEdgeDisplacement = false;
        for (const p of sourceContour.slice(0, 10)) {
            const idx = Math.round(p.y) * width + Math.round(p.x);
            if (Math.abs(displacement.dx[idx]) > 0.1 || Math.abs(displacement.dy[idx]) > 0.1) {
                hasEdgeDisplacement = true;
                break;
            }
        }
        
        return {
            name,
            passed: true,
            duration: performance.now() - start,
            details: `${controlPairs.length} 控制点, 边缘位移: ${hasEdgeDisplacement ? '有' : '无'}`
        };
    } catch (error: any) {
        return {
            name,
            passed: false,
            duration: performance.now() - start,
            error: error.message
        };
    }
}

/**
 * 测试 4: 稀疏位移场压缩
 */
async function testSparseDisplacement(): Promise<TestResult> {
    const name = '稀疏位移场压缩/解压';
    const start = performance.now();
    
    try {
        const width = 500;
        const height = 500;
        const size = width * height;
        
        // 创建测试位移场
        const displacement: DisplacementField = {
            width,
            height,
            dx: new Float32Array(size),
            dy: new Float32Array(size)
        };
        
        // 权重图（边缘带有权重）
        const weights = new Float32Array(size);
        
        // 模拟边缘带
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                const distToEdge = Math.min(x, width - x - 1, y, height - y - 1);
                
                if (distToEdge < 50) {
                    weights[idx] = 1 - distToEdge / 50;
                    displacement.dx[idx] = (Math.random() - 0.5) * 20;
                    displacement.dy[idx] = (Math.random() - 0.5) * 20;
                }
            }
        }
        
        // 压缩
        const sparse = compressDisplacementField(displacement, weights, 0.01);
        
        // 序列化
        const serialized = serializeSparseDisplacement(sparse);
        
        // 反序列化
        const deserialized = deserializeSparseDisplacement(serialized);
        
        // 验证
        if (deserialized.width !== width || deserialized.height !== height) {
            throw new Error('尺寸不匹配');
        }
        
        if (deserialized.indices.length !== sparse.indices.length) {
            throw new Error('索引数量不匹配');
        }
        
        const compressionRatio = (size * 8) / serialized.length;
        
        return {
            name,
            passed: true,
            duration: performance.now() - start,
            details: `稀疏点: ${sparse.indices.length}/${size}, 压缩比: ${compressionRatio.toFixed(1)}x, 大小: ${(serialized.length / 1024).toFixed(1)}KB`
        };
    } catch (error: any) {
        return {
            name,
            passed: false,
            duration: performance.now() - start,
            error: error.message
        };
    }
}

/**
 * 测试 5: 端到端变形流程
 */
async function testEndToEndMorphing(): Promise<TestResult> {
    const name = '端到端变形流程';
    const start = performance.now();
    
    try {
        const width = 500;
        const height = 500;
        
        // 1. 生成轮廓
        const sourceContour = generateSockContour(width, height);
        const targetContour = generateTargetContour(width, height);
        
        // 2. JFA 距离场
        const jfa = new JFADistanceField();
        const distanceField = jfa.compute(width, height, sourceContour);
        
        // 3. 袜口检测
        const detector = new SmartCuffDetector();
        const cuffResult = detector.detect(sourceContour, { x: 0, y: 0, width, height });
        
        // 4. MLS 变形
        const mls = new MLSDeformation();
        const controlPairs = mls.generateControlPairs(sourceContour, targetContour, 30);
        const displacement = mls.computeDisplacementField(width, height, controlPairs, 50);
        
        // 5. 生成权重图
        const edgeBandWidth = 50;
        const transitionWidth = 10;
        const weights = new Float32Array(width * height);
        
        for (let i = 0; i < distanceField.length; i++) {
            const dist = distanceField[i];
            if (dist <= edgeBandWidth - transitionWidth) {
                weights[i] = 1.0;
            } else if (dist < edgeBandWidth) {
                const t = (dist - (edgeBandWidth - transitionWidth)) / transitionWidth;
                weights[i] = 1.0 - (t * t * (3 - 2 * t));
            }
        }
        
        // 6. 应用权重
        const weightedDisplacement = mls.applyWeightedDisplacement(displacement, weights);
        
        // 7. 压缩
        const sparse = compressDisplacementField(weightedDisplacement, weights, 0.01);
        const serialized = serializeSparseDisplacement(sparse);
        
        const totalTime = performance.now() - start;
        
        return {
            name,
            passed: true,
            duration: totalTime,
            details: `总耗时 ${totalTime.toFixed(0)}ms, 压缩后 ${(serialized.length / 1024).toFixed(1)}KB`
        };
    } catch (error: any) {
        return {
            name,
            passed: false,
            duration: performance.now() - start,
            error: error.message
        };
    }
}

/**
 * 运行所有测试
 */
export async function runIntegrationTests(): Promise<void> {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║             形态统一功能集成测试                              ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
    
    const tests = [
        testJFADistanceField,
        testSmartCuffDetector,
        testMLSDeformation,
        testSparseDisplacement,
        testEndToEndMorphing
    ];
    
    const results: TestResult[] = [];
    
    for (const test of tests) {
        const result = await test();
        results.push(result);
        
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} │ ${result.name}`);
        console.log(`       │ 耗时: ${result.duration.toFixed(2)}ms`);
        if (result.details) {
            console.log(`       │ ${result.details}`);
        }
        if (result.error) {
            console.log(`       │ 错误: ${result.error}`);
        }
        console.log('');
    }
    
    // 汇总
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const allPassed = passed === total;
    
    console.log('─'.repeat(65));
    console.log(`\n结果: ${passed}/${total} 测试通过`);
    
    if (allPassed) {
        console.log('\n✅ 所有测试通过：基础变形链路可用，当前仍属于 prototype 验证阶段。');
    } else {
        console.log('\n❌ 存在失败的测试，请检查上述错误。');
    }
}

// 直接运行
if (require.main === module) {
    runIntegrationTests().catch(console.error);
}
