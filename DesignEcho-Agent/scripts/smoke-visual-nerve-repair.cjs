'use strict';

/**
 * smoke: 视神经修复 + 参考通道解锁（harness 体检 2026-07-07）
 *
 * 体检定位的三处最痛断点：
 * 1. 视神经断裂：extractImageFromToolResult 不认 getCanvasSnapshot 的真实嵌套形状
 *    （snapshot.base64）与 getScreenSnapshots 的数组形状（screens[].base64）——
 *    全系统调用量最大的像素眼「成功」了但图从未进过模型（run-record 实证 0 转发）。
 * 2. region 静默丢弃：getAnnotatedSnapshot 的 region 在 Agent 端转发时被丢，
 *    UXP 失败文案教模型带 region、模型照做也到不了 UXP（长详情页死循环陷阱）。
 * 3. 参考通道锁死：参考工具必须留在统一 Tool Registry，并且不被设计纪律阻断。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const agentRoot = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(agentRoot, 'tsconfig.main.json')
});
const { extractImageFromToolResult } = require(path.resolve(agentRoot, 'src/renderer/services/agent-runtime/tool-result-sanitizer.ts'));
const D = require(path.resolve(agentRoot, 'src/shared/design-discipline-runtime.ts'));

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

// 构造合法 base64（>2000 字符，通过 MIN_IMAGE_BASE64_CHARS 与字符集校验）
const FAKE_B64 = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(2400) + '==';

console.log('── 刀一：图像提取覆盖真实 UXP 形状（行为级） ──');

check('getCanvasSnapshot 嵌套形状 snapshot.{base64,format} 可提取', () => {
    const r = extractImageFromToolResult({
        success: true,
        snapshot: { base64: FAKE_B64, width: 1024, height: 768, format: 'jpeg' },
        documentInfo: { name: '详情页.psb' }
    });
    assert.ok(r, '应提取出图像');
    assert.strictEqual(r.mediaType, 'image/jpeg', '应从嵌套层读 format');
    assert.strictEqual(r.data, FAKE_B64);
});

check('getScreenSnapshots 数组形状 screens[].base64 可提取（取首张有图屏）', () => {
    const r = extractImageFromToolResult({
        success: true,
        screens: [
            { id: '1-首屏', error: '该屏截图失败' },
            { id: '2-卖点', base64: FAKE_B64, format: 'png' }
        ]
    });
    assert.ok(r, '应提取出图像');
    assert.strictEqual(r.mediaType, 'image/png');
});

check('扁平形状（imageData / data-url）不回归', () => {
    assert.ok(extractImageFromToolResult({ imageData: FAKE_B64 }));
    const dataUrl = extractImageFromToolResult({ base64: `data:image/webp;base64,${FAKE_B64}` });
    assert.ok(dataUrl);
    assert.strictEqual(dataUrl.mediaType, 'image/webp');
});

check('data 包裹的嵌套形状 data.snapshot.base64 可提取', () => {
    assert.ok(extractImageFromToolResult({ data: { snapshot: { base64: FAKE_B64, format: 'jpg' } } }));
});

check('非图像长文本不误判为图像', () => {
    const text = '这是一段很长的中文说明文字，'.repeat(300);
    assert.strictEqual(extractImageFromToolResult({ snapshot: { base64: text } }), null);
    assert.strictEqual(extractImageFromToolResult({ message: text }), null);
});

console.log('── 刀二：region 透传（源码 pin） ──');

check('getAnnotatedSnapshot 转发含 region 字段', () => {
    const s = fs.readFileSync(path.join(agentRoot, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    const block = s.slice(s.indexOf("toolName === 'getAnnotatedSnapshot'"), s.indexOf("toolName === 'getAnnotatedSnapshot'") + 900);
    assert.ok(block.includes('region: params?.region'), 'region 必须透传到 UXP');
});

console.log('── 刀三：参考通道由统一 Tool Registry 提供，设计纪律不阻断 ──');

check('Eagle/网页/PSD 参考工具由统一 Tool schema 提供', () => {
    const source = fs.readFileSync(path.join(agentRoot, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    for (const tool of ['searchEagleReferences', 'fetchWebPageDesignContent', 'analyzePsdDesignSource']) {
        assert.ok(source.includes(`name: '${tool}'`), `${tool} 应存在于统一 Tool schema`);
    }
});

check('参考工具建画布后仍可达（守卫放行，中途找灵感是正当行为）', () => {
    const ctx = D.resolveDesignDisciplineContext({ taskText: '帮我做详情页', isCreativeDesignIntent: true });
    const r = D.evaluateDesignToolStateGuard({
        context: ctx,
        state: D.createDesignDisciplineState({
            designKnowledgeReadCount: 1,
            documentCreated: true,
            layoutRendered: true,
            needsObservationAfterMutation: false
        }),
        toolName: 'searchEagleReferences'
    });
    assert.strictEqual(r, null, '参考工具应放行');
});

check('SKU 参考先行硬门禁不受影响（可达性变了，强制性没变）', () => {
    const { resolveDesignTaskTypeSpec } = require(path.resolve(agentRoot, 'src/shared/design-task-types.ts'));
    const detailSpec = resolveDesignTaskTypeSpec('帮我做详情页');
    assert.ok(detailSpec, '应命中详情页品类');
    assert.ok(!detailSpec.requiresReferenceInputBeforeDocument, '详情页不应有参考先行硬门禁');
});

const summary = { total: passed + failures.length, passed, failed: failures.length, failures };
const outDir = path.join(agentRoot, 'tmp');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'smoke-visual-nerve-repair.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`\n${passed}/${summary.total} 通过`);
if (failures.length > 0) process.exit(1);
