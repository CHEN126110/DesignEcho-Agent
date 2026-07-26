#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * smoke: 主体感知缩放（2026-07-07）
 *
 * 纯逻辑 computeSubjectFitToRegion：留白大图放大到主体饱满/主体过大缩小/主体偏心对齐/
 * 放大上限保护/无效输入诚实拒绝/告警如实。
 * 数学正确性：投影主体必须落在目标区域的 fillRatio 框内且居中；alignToReference 参数
 * 与其"subjectOffset 缩放前测量、内部按 k 缩放"语义一致。
 * 登记钉桩：执行器组合链（getSubjectBounds→getLayerBounds→求解→alignToReference）、
 * preflight 写分类、纪律三集合（放行/改后必看/暴露——指路工具必须可达）、schema/目录/显示名。
 */

const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const ROOT = path.resolve(__dirname, '..');
const { computeSubjectFitToRegion } = require(path.join(ROOT, 'src', 'shared', 'subject-fit.ts'));
const { classifyAgentToolExecution } = require(path.join(ROOT, 'src', 'shared', 'agent-tool-execution-preflight.ts'));
const { DESIGN_DISCIPLINE_MUTATION_TOOL_NAMES } = require(
    path.join(ROOT, 'src', 'shared', 'design-discipline-runtime.ts')
);

let failures = 0;
function check(name, ok, hint) {
    if (ok) { console.log(`  ok  ${name}`); }
    else { failures += 1; console.error(`  FAIL ${name}${hint ? ` — ${hint}` : ''}`); }
}
function approx(a, b, tol = 1.5) { return Math.abs(a - b) <= tol; }

// ── 场景1：留白大图（主体只占图框中间一小块）→ 放大到主体饱满 ──
{
    // 图框 800x800 居中于文档，主体仅中间 200x200；目标区域 (100,100,600,600)，fillRatio 0.9
    const plan = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 800, bottom: 800 },
        subjectBounds: { left: 300, top: 300, right: 500, bottom: 500 },
        targetRegion: { x: 100, y: 100, width: 600, height: 600 },
        subjectFillRatio: 0.9
    });
    check('场景1: 求解成功', plan.ok === true, plan.ok ? '' : plan.reason);
    // 期望 k = 600*0.9/200 = 2.7 → 270%
    check('场景1: 缩放比例=270%（主体驱动，非图框驱动）', plan.ok && approx(plan.alignParams.scalePercent, 270, 0.2), plan.ok ? String(plan.alignParams.scalePercent) : '');
    // 主体中心在图框中心（400,400）→ offset 0,0；目标中心 (400,400)
    check('场景1: 主体居中投影到区域中心', plan.ok
        && approx((plan.projectedSubject.left + plan.projectedSubject.right) / 2, 400)
        && approx((plan.projectedSubject.top + plan.projectedSubject.bottom) / 2, 400));
    // 投影主体尺寸 = 200*2.7 = 540 = 600*0.9
    check('场景1: 投影主体占区域 90%', plan.ok && approx(plan.projectedSubject.right - plan.projectedSubject.left, 540));
    // 图框投影 800*2.7=2160 溢出区域 → 告警
    check('场景1: 图框溢出区域如实告警', plan.ok && plan.warnings.some((w) => w.includes('溢出目标区域')));
}

// ── 场景2：主体偏心（主体在图框右下）→ subjectOffset 传给 alignToReference ──
{
    const plan = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 400, bottom: 400 },      // 层中心 (200,200)
        subjectBounds: { left: 240, top: 280, right: 360, bottom: 380 }, // 主体中心 (300,330)
        targetRegion: { x: 500, y: 500, width: 240, height: 200 },       // 区域中心 (620,600)
        subjectFillRatio: 1
    });
    // k = min(240/120, 200/100) = 2
    check('场景2: 偏心主体 offset 正确（缩放前测量）', plan.ok
        && approx(plan.alignParams.subjectOffsetX, 100) && approx(plan.alignParams.subjectOffsetY, 130)
        && approx(plan.alignParams.scalePercent, 200, 0.2), plan.ok ? JSON.stringify(plan.alignParams) : plan.reason);
    check('场景2: 目标中心=区域中心', plan.ok
        && plan.alignParams.targetCenterX === 620 && plan.alignParams.targetCenterY === 600);
    // 图框中心投影 = 目标中心 - offset*k = (620-200, 600-260) = (420,340)；框 800x800
    check('场景2: 图框投影反推正确', plan.ok
        && approx((plan.projectedFrame.left + plan.projectedFrame.right) / 2, 420)
        && approx((plan.projectedFrame.top + plan.projectedFrame.bottom) / 2, 340));
}

// ── 场景3：主体过大 → 缩小 ──
{
    const plan = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 2000, bottom: 2000 },
        subjectBounds: { left: 100, top: 100, right: 1900, bottom: 1900 },
        targetRegion: { x: 0, y: 0, width: 600, height: 600 },
        subjectFillRatio: 0.8
    });
    // k = 600*0.8/1800 ≈ 0.2667 → 26.7%
    check('场景3: 主体过大按比例缩小', plan.ok && approx(plan.alignParams.scalePercent, 26.7, 0.2), plan.ok ? String(plan.alignParams.scalePercent) : '');
}

// ── 边界与保护 ──
{
    const capped = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 100, bottom: 100 },
        subjectBounds: { left: 45, top: 45, right: 55, bottom: 55 },  // 10x10 小主体
        targetRegion: { x: 0, y: 0, width: 900, height: 900 },        // 需要 81x → 撞上限
        subjectFillRatio: 0.9
    });
    check('保护: 放大上限 300% 并告警画质', capped.ok && capped.alignParams.scalePercent === 300
        && capped.warnings.some((w) => w.includes('画质')), capped.ok ? JSON.stringify(capped.warnings) : capped.reason);

    const badSubject = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 100, bottom: 100 },
        subjectBounds: { left: 50, top: 50, right: 50, bottom: 50 },
        targetRegion: { x: 0, y: 0, width: 100, height: 100 }
    });
    check('拒绝: 主体边界无效指路 getSubjectBounds', badSubject.ok === false && badSubject.reason.includes('getSubjectBounds'));

    const badRegion = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 100, bottom: 100 },
        subjectBounds: { left: 10, top: 10, right: 90, bottom: 90 },
        targetRegion: { x: 0, y: 0, width: 0, height: 100 }
    });
    check('拒绝: targetRegion 无效明确报错', badRegion.ok === false && badRegion.reason.includes('targetRegion'));

    const offCanvas = computeSubjectFitToRegion({
        layerBounds: { left: 0, top: 0, right: 1000, bottom: 1000 },
        subjectBounds: { left: 400, top: 400, right: 600, bottom: 600 },
        targetRegion: { x: 700, y: 700, width: 280, height: 280 },
        subjectFillRatio: 1,
        canvas: { width: 800, height: 800 }
    });
    check('告警: 图框投影超出画布提示裁切', offCanvas.ok && offCanvas.warnings.some((w) => w.includes('画布')));
}

// ── 登记钉桩 ──
{
    check('登记: preflight 写分类（读后写纪律约束）', classifyAgentToolExecution('fitLayerSubjectToRegion') === 'photoshop_write');
    check('登记: 改后必看集', DESIGN_DISCIPLINE_MUTATION_TOOL_NAMES.has('fitLayerSubjectToRegion'));

    const executorSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
    check('接线: 组合链完整（主体→图框→求解→执行）', executorSrc.includes("toolName === 'fitLayerSubjectToRegion'")
        && /getSubjectBounds', \{ layerId: fitLayerId/.test(executorSrc)
        && /getLayerBounds', \{ layerId: fitLayerId/.test(executorSrc)
        && executorSrc.includes("executeToolCall('alignToReference', { layerId: fitLayerId, ...fitPlan.alignParams }"));
    check('接线: smart 不支持自动降级 alpha', executorSrc.includes("methodUsed = 'alpha'"));

    const schemaSrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
    check('登记: schema 定义并进暴露列表', schemaSrc.includes("name: 'fitLayerSubjectToRegion'")
        && /'alignToReference',\s*\n\s*'fitLayerSubjectToRegion',/.test(schemaSrc));
    check('知识: renderLayout 指路主体校准', /renderLayout[\s\S]{0,900}fitLayerSubjectToRegion/.test(schemaSrc));
    check('知识: alignToReference 指向声明式入口', schemaSrc.includes('优先改用 fitLayerSubjectToRegion'));

    const displaySrc = fs.readFileSync(path.join(ROOT, 'src/renderer/services/tool-display-info.ts'), 'utf8');
    check('登记: 显示名', displaySrc.includes('主体缩放对齐'));
}

if (failures > 0) { console.error(`[smoke-subject-fit] FAILED (${failures})`); process.exit(1); }
console.log('[smoke-subject-fit] passed');
