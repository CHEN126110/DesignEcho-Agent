#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src', 'tools', 'sku', 'sku-auto-layout-plan.ts');
const toolPath = path.join(projectRoot, 'src', 'tools', 'layout', 'sku-layout-tool.ts');
const packagePath = path.join(projectRoot, 'package.json');

function loadTsModule(filePath) {
    assert(fs.existsSync(filePath), `Missing helper module: ${path.relative(projectRoot, filePath)}`);
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(transpiled, {
        module,
        exports: module.exports,
        require,
        console
    }, { filename: filePath });
    return module.exports;
}

function item(id, width = 320, height = 760) {
    return {
        id,
        layerId: Number(id.replace(/\D/g, '')) || undefined,
        name: id,
        bounds: {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
            width,
            height
        }
    };
}

function inset(rect, amount) {
    return {
        left: rect.left + amount,
        top: rect.top + amount,
        right: rect.right - amount,
        bottom: rect.bottom - amount,
        width: Math.max(0, rect.width - amount * 2),
        height: Math.max(0, rect.height - amount * 2)
    };
}

function shift(rect, dx, dy) {
    return {
        left: rect.left + dx,
        top: rect.top + dy,
        right: rect.right + dx,
        bottom: rect.bottom + dy,
        width: rect.width,
        height: rect.height
    };
}

function rect(left, top, right, bottom) {
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top)
    };
}

function actualFromPlan(plan, overrides = {}) {
    return plan.placements.map((placement, index) => {
        const override = overrides[index] || {};
        return {
            itemId: placement.itemId,
            layerId: placement.layerId,
            name: placement.name,
            destinationBox: placement.destinationBox,
            actualBounds: override.actualBounds || inset(placement.destinationBox, 2)
        };
    });
}

function main() {
    const auto = loadTsModule(helperPath);
    assert.strictEqual(typeof auto.buildSkuAutoLayoutPlan, 'function', 'buildSkuAutoLayoutPlan should be exported');
    assert.strictEqual(typeof auto.verifySkuAutoLayoutResult, 'function', 'verifySkuAutoLayoutResult should be exported');

    const plan = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: [item('sku-1'), item('sku-2'), item('sku-3')],
        obstacles: [],
        preset: 'sku-combo'
    });
    assert.strictEqual(plan.status, 'ready', `plan should be ready: ${plan.diagnostics.blockers.join('; ')}`);

    const readyQa = auto.verifySkuAutoLayoutResult({
        plan,
        actualPlacements: actualFromPlan(plan),
        obstacles: [],
        minSpacingPx: 8
    });
    assert.strictEqual(readyQa.schema, 'sku-auto-layout-qa/v0', 'QA schema changed');
    assert.strictEqual(readyQa.status, 'ready', `ready QA should pass: ${readyQa.blockers.join('; ')}`);
    assert.strictEqual(readyQa.actualPlacements.length, plan.placements.length, 'QA should keep actual placement readback');
    assert.strictEqual(readyQa.boundaries.usesActualBounds, true, 'QA must be based on Photoshop actual bounds');
    assert.strictEqual(readyQa.boundaries.writesPhotoshop, false, 'pure QA must not write Photoshop');
    assert.strictEqual(readyQa.boundaries.claimsDesignQuality, false, 'geometry QA must not claim design quality');

    const subjectPlan = {
        ...plan,
        placements: [
            {
                ...plan.placements[0],
                itemId: 'subject-1',
                layerId: 401,
                name: 'subject-1',
                destinationBox: rect(300, 220, 620, 780),
                cellBox: rect(260, 180, 660, 820)
            }
        ]
    };
    const subjectAlignedQa = auto.verifySkuAutoLayoutResult({
        plan: subjectPlan,
        actualPlacements: [
            {
                itemId: 'subject-1',
                layerId: 401,
                name: 'subject-1',
                destinationBox: subjectPlan.placements[0].destinationBox,
                actualBounds: rect(286, 206, 634, 794),
                actualSubjectBounds: rect(302, 222, 618, 778)
            }
        ],
        obstacles: [],
        tolerancePx: 10,
        minSpacingPx: 8
    });
    assert.strictEqual(
        subjectAlignedQa.status,
        'ready',
        `QA should use actualSubjectBounds for target alignment while retaining full actual bounds for safety: ${subjectAlignedQa.blockers.join('; ')}`
    );
    assert.strictEqual(
        subjectAlignedQa.actualPlacements[0].actualSubjectBounds.width,
        316,
        'QA should preserve actualSubjectBounds in readback diagnostics.'
    );

    const outsideQa = auto.verifySkuAutoLayoutResult({
        plan,
        actualPlacements: actualFromPlan(plan, {
            0: { actualBounds: shift(plan.placements[0].destinationBox, -1000, 0) }
        }),
        obstacles: [],
        minSpacingPx: 8
    });
    assert.strictEqual(outsideQa.status, 'blocked', 'actual bounds outside safe area should block export');
    assert(outsideQa.blockers.some((message) => message.includes('安全区')), `safe area blocker missing: ${outsideQa.blockers.join('; ')}`);

    const mismatchQa = auto.verifySkuAutoLayoutResult({
        plan,
        actualPlacements: actualFromPlan(plan, {
            0: { actualBounds: shift(plan.placements[0].destinationBox, 80, 0) }
        }),
        obstacles: [],
        tolerancePx: 12,
        minSpacingPx: 8
    });
    assert.strictEqual(mismatchQa.status, 'blocked', 'actual bounds far from destinationBox should block export');
    assert(mismatchQa.blockers.some((message) => message.includes('目标框')), `destination mismatch blocker missing: ${mismatchQa.blockers.join('; ')}`);

    const overlapQa = auto.verifySkuAutoLayoutResult({
        plan,
        actualPlacements: actualFromPlan(plan, {
            1: { actualBounds: inset(plan.placements[0].destinationBox, 1) }
        }),
        obstacles: [],
        minSpacingPx: 8
    });
    assert.strictEqual(overlapQa.status, 'blocked', 'SKU overlap should block export');
    assert(overlapQa.blockers.some((message) => message.includes('互相重叠')), `overlap blocker missing: ${overlapQa.blockers.join('; ')}`);

    const closeButNotOverlappingPlan = {
        ...plan,
        constraints: {
            ...(plan.constraints || {}),
            minSpacingPx: 80
        },
        placements: [
            {
                itemId: 'close-1',
                layerId: 101,
                name: 'close-1',
                destinationBox: rect(200, 200, 320, 520),
                cellBox: rect(180, 180, 340, 540),
                scalePercent: 100,
                row: 0,
                column: 0
            },
            {
                itemId: 'close-2',
                layerId: 102,
                name: 'close-2',
                destinationBox: rect(360, 200, 480, 520),
                cellBox: rect(340, 180, 500, 540),
                scalePercent: 100,
                row: 0,
                column: 1
            }
        ]
    };
    const closeSpacingQa = auto.verifySkuAutoLayoutResult({
        plan: closeButNotOverlappingPlan,
        actualPlacements: actualFromPlan(closeButNotOverlappingPlan),
        obstacles: []
    });
    assert.strictEqual(closeSpacingQa.status, 'blocked', 'QA should use plan spacing constraints even when caller does not pass minSpacingPx');
    assert(closeSpacingQa.blockers.some((message) => message.includes('间距不足')), `spacing blocker missing: ${closeSpacingQa.blockers.join('; ')}`);

    const obstacle = {
        id: 'template-title',
        role: 'text',
        bounds: inset(plan.placements[0].destinationBox, 4)
    };
    const obstacleQa = auto.verifySkuAutoLayoutResult({
        plan,
        actualPlacements: actualFromPlan(plan),
        obstacles: [obstacle],
        minSpacingPx: 8
    });
    assert.strictEqual(obstacleQa.status, 'blocked', 'actual bounds overlapping template obstacles should block export');
    assert(obstacleQa.blockers.some((message) => message.includes('模板元素')), `obstacle blocker missing: ${obstacleQa.blockers.join('; ')}`);

    const payload = JSON.stringify([readyQa, outsideQa, mismatchQa, overlapQa, obstacleQa]);
    assert(!payload.includes('confidence') && !payload.includes('置信'), 'QA payload must not contain confidence fields');
    assert(!payload.includes('base64') && !payload.includes('data:image'), 'QA payload must not expose raw image payloads');

    const toolSource = fs.readFileSync(toolPath, 'utf8');
    assert(toolSource.includes('verifySkuAutoLayoutResult'), 'skuLayout should call post-execution QA');
    assert(toolSource.includes('autoLayoutQa'), 'skuLayout should return autoLayoutQa diagnostics');
    assert(toolSource.includes('deleteCopiedSkuLayers'), 'skuLayout should have a shared copied-layer cleanup helper');
    assert(toolSource.includes('cleanupCopiedSkuLayersAfterModal'), 'skuLayout should clean copied layers after modal failures');
    assert(
        /catch\s*\(err[\s\S]{0,220}cleanupCopiedSkuLayersAfterModal\(comboLayerIdsForCleanup/.test(toolSource),
        'combo layout failures should clean copied SKU layers before continuing to the next combo'
    );
    assert(
        /catch\s*\(error[\s\S]{0,260}cleanupCopiedSkuLayersAfterModal\(noteLayerIdsForCleanup/.test(toolSource),
        'self-select note failures should clean copied SKU layers instead of leaving the template polluted'
    );
    assert(
        /autoLayoutQa\.status\s*===\s*'blocked'[\s\S]{0,260}throw new Error/.test(toolSource),
        'skuLayout should stop export when post-execution QA blocks'
    );

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert(packageJson.scripts['smoke:sku-auto-layout-post-qa'], 'package script should expose SKU post QA smoke');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'post-execution QA requires actual Photoshop bounds',
            'actual bounds outside safeBox block export',
            'actual bounds far from planned destinationBox block export',
            'SKU-to-SKU and SKU-to-template overlap block export',
            'post-execution QA preserves planner minimum spacing constraints',
            'skuLayout returns autoLayoutQa and stops before export when geometry is invalid',
            'combo and self-select note failures clean copied SKU layers before the next run'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
}
