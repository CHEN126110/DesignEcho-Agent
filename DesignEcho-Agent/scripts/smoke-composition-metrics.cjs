'use strict';

/**
 * smoke: 参考构图测量纯逻辑（composition-metrics）
 * 守护"该多大"依据源的换算正确性：测量数值、应用建议、退化输入可诊断。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const agentRoot = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(agentRoot, 'tsconfig.main.json')
});
const { measureComposition } = require(path.resolve(agentRoot, 'src/shared/composition-metrics.ts'));

let passed = 0;
const failures = [];
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (e) {
        failures.push({ name, error: e.message });
        console.error(`  FAIL ${name}: ${e.message}`);
    }
}

check('典型主图：800x800 画布，主体 100,80 → 700,720（手算对照）', () => {
    const r = measureComposition({
        canvas: { width: 800, height: 800 },
        subjectBounds: { left: 100, top: 80, right: 700, bottom: 720 }
    });
    assert.ok(r.ok, r.error);
    // 宽 600/800=0.75，高 640/800=0.8，面积 0.6
    assert.strictEqual(r.metrics.subjectWidthRatio, 0.75);
    assert.strictEqual(r.metrics.subjectHeightRatio, 0.8);
    assert.strictEqual(r.metrics.subjectAreaRatio, 0.6);
    // 中心 (400, 400)/800 = (0.5, 0.5)
    assert.strictEqual(r.metrics.subjectCenter.x, 0.5);
    assert.strictEqual(r.metrics.subjectCenter.y, 0.5);
    // 留白：上 80/800=0.1，下 80/800=0.1，左 100/800=0.125，右 100/800=0.125
    assert.strictEqual(r.metrics.margins.top, 0.1);
    assert.strictEqual(r.metrics.margins.left, 0.125);
    // fillRatio = max(0.8, 0.75) = 0.8
    assert.strictEqual(r.application.subjectFillRatioForFullCanvas, 0.8);
});

check('应用建议：归一化目标区域按参考重心与占比', () => {
    const r = measureComposition({
        canvas: { width: 1000, height: 500 },
        subjectBounds: { left: 600, top: 100, right: 900, bottom: 400 }
    });
    assert.ok(r.ok, r.error);
    // 宽 300/1000=0.3，高 300/500=0.6，中心 (750/1000, 250/500)=(0.75, 0.5)
    const region = r.application.normalizedTargetRegion;
    assert.strictEqual(region.width, 0.3);
    assert.strictEqual(region.height, 0.6);
    assert.strictEqual(region.x, 0.6);   // 0.75 - 0.3/2
    assert.strictEqual(region.y, 0.2);   // 0.5 - 0.6/2
    assert.ok(r.application.usage.includes('fitLayerSubjectToRegion'), 'usage 应指向执行工具');
    assert.ok(r.application.usage.includes('参照起点'), 'usage 应声明数值是起点非教条');
});

check('越界 bbox：按画布内可见部分测量并告警（出血构图）', () => {
    const r = measureComposition({
        canvas: { width: 800, height: 800 },
        subjectBounds: { left: -100, top: 200, right: 500, bottom: 900 }
    });
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.metrics.subjectWidthRatio, 0.625);  // 可见 0..500
    assert.strictEqual(r.metrics.subjectHeightRatio, 0.75);  // 可见 200..800
    assert.ok(r.warnings.some((w) => w.includes('越出画布')));
});

check('主体极小：面积 <2% 提示确认参考类型', () => {
    const r = measureComposition({
        canvas: { width: 1000, height: 1000 },
        subjectBounds: { left: 480, top: 480, right: 560, bottom: 560 }
    });
    assert.ok(r.ok, r.error);
    assert.ok(r.warnings.some((w) => w.includes('主体极小') || w.includes('不足 2%')));
});

check('近满幅：占比 >95% 提示裁切构图不宜照搬', () => {
    const r = measureComposition({
        canvas: { width: 800, height: 800 },
        subjectBounds: { left: 2, top: 2, right: 798, bottom: 798 }
    });
    assert.ok(r.ok, r.error);
    assert.ok(r.warnings.some((w) => w.includes('95%')));
});

check('退化输入可诊断：bbox 反向', () => {
    const r = measureComposition({
        canvas: { width: 800, height: 800 },
        subjectBounds: { left: 500, top: 100, right: 300, bottom: 400 }
    });
    assert.ok(!r.ok);
    assert.ok(r.error.includes('退化'));
});

check('退化输入可诊断：画布非正', () => {
    const r = measureComposition({
        canvas: { width: 0, height: 800 },
        subjectBounds: { left: 0, top: 0, right: 100, bottom: 100 }
    });
    assert.ok(!r.ok);
    assert.ok(r.error.includes('画布尺寸不合法'));
});

check('退化输入可诊断：bbox 全在画布外', () => {
    const r = measureComposition({
        canvas: { width: 800, height: 800 },
        subjectBounds: { left: 900, top: 900, right: 1000, bottom: 1000 }
    });
    assert.ok(!r.ok);
    assert.ok(r.error.includes('画布之外'));
});

check('归一化输出与分辨率无关（同构图不同分辨率结果一致）', () => {
    const a = measureComposition({
        canvas: { width: 800, height: 800 },
        subjectBounds: { left: 100, top: 100, right: 700, bottom: 700 }
    });
    const b = measureComposition({
        canvas: { width: 1600, height: 1600 },
        subjectBounds: { left: 200, top: 200, right: 1400, bottom: 1400 }
    });
    assert.ok(a.ok && b.ok);
    assert.deepStrictEqual(a.metrics, b.metrics);
    assert.strictEqual(a.application.subjectFillRatioForFullCanvas, b.application.subjectFillRatioForFullCanvas);
});

console.log('── 全链登记（源码 pin）──');

function read(rel) {
    return fs.readFileSync(path.join(agentRoot, rel), 'utf8');
}

check('main 服务：measureReferenceComposition 方法（本地检测+纯逻辑）', () => {
    const s = read('src/main/services/resource-manager-service.ts');
    assert.ok(s.includes('async measureReferenceComposition(imagePath: string)'));
    assert.ok(s.includes("from '../../shared/composition-metrics'"));
    assert.ok(s.includes('detectSubjectBounds'), '应走本地主体检测而非视觉模型');
});
check('IPC：resource:measureComposition 已挂载', () => {
    const s = read('src/main/ipc-handlers/resource-handlers.ts');
    assert.ok(s.includes("ipcMain.handle('resource:measureComposition'"));
});
check('tool-schemas：schema + 暴露列表', () => {
    const s = read('src/renderer/services/agent-runtime/tool-schemas.ts');
    assert.ok(s.includes("name: 'measureReferenceComposition'"));
    assert.ok(/'analyzePsdDesignSource',\s*\n\s*'measureReferenceComposition',/.test(s));
});
check('tool-executor：分发 + 目录行', () => {
    const s = read('src/renderer/services/tool-executor.service.ts');
    assert.ok(s.includes("case 'measureReferenceComposition':"));
    assert.ok(s.includes("invoke('resource:measureComposition'"));
    assert.ok(s.includes('【参考构图测量】'));
});
check('preflight：只读上下文分类', () => {
    const s = read('src/shared/agent-tool-execution-preflight.ts');
    assert.ok(/CONTEXT_READ_TOOLS = new Set\(\[[\s\S]{0,1400}'measureReferenceComposition'/.test(s));
});
check('显示名', () => {
    const s = read('src/renderer/services/tool-display-info.ts');
    assert.ok(s.includes('measureReferenceComposition: {'));
});
check('依据源引导：fitLayerSubjectToRegion 描述接三个依据源', () => {
    const s = read('src/renderer/services/agent-runtime/tool-schemas.ts');
    const m = s.match(/name: 'fitLayerSubjectToRegion',[\s\S]{0,3200}?description: '((?:[^'\\]|\\.)*)'/);
    assert.ok(m, '应找到 fitLayerSubjectToRegion 描述');
    assert.ok(m[1].includes('measureReferenceComposition'));
    assert.ok(m[1].includes('getDesignPrinciples'));
    assert.ok(m[1].includes('不要无依据拍数字'));
});
check('依据源引导：placeImage 描述提示大小有参照', () => {
    const s = read('src/renderer/services/agent-runtime/tool-schemas.ts');
    const m = s.match(/name: 'placeImage',[\s\S]{0,4000}?description: '((?:[^'\\]|\\.)*)'/);
    assert.ok(m, '应找到 placeImage 描述');
    assert.ok(m[1].includes('measureReferenceComposition'));
});
check('设计原理构图节：参考测量优先方法论', () => {
    const s = read('src/shared/knowledge/design-principles.ts');
    assert.ok(s.includes('尺寸参照') && s.includes('measureReferenceComposition'));
    assert.ok(s.includes('数值是起点不是教条'));
});

const summary = { total: passed + failures.length, passed, failed: failures.length, failures };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-composition-metrics.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${passed}/${summary.total} 通过`);
if (failures.length > 0) process.exit(1);
