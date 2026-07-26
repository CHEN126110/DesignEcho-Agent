#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src', 'tools', 'sku', 'sku-auto-layout-plan.ts');
const skuIndexPath = path.join(projectRoot, 'src', 'tools', 'sku', 'index.ts');
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

function item(id, width = 360, height = 900) {
    return {
        id,
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

function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function expandRect(rect, amount) {
    return {
        left: rect.left - amount,
        top: rect.top - amount,
        right: rect.right + amount,
        bottom: rect.bottom + amount,
        width: rect.width + amount * 2,
        height: rect.height + amount * 2
    };
}

function assertRectInside(inner, outer, message) {
    assert(inner.left >= outer.left - 0.01, `${message}: left overflows`);
    assert(inner.top >= outer.top - 0.01, `${message}: top overflows`);
    assert(inner.right <= outer.right + 0.01, `${message}: right overflows`);
    assert(inner.bottom <= outer.bottom + 0.01, `${message}: bottom overflows`);
}

function assertNoPlacementOverlap(plan, minSpacingPx = 0) {
    for (let i = 0; i < plan.placements.length; i++) {
        for (let j = i + 1; j < plan.placements.length; j++) {
            const first = expandRect(plan.placements[i].destinationBox, minSpacingPx / 2);
            const second = expandRect(plan.placements[j].destinationBox, minSpacingPx / 2);
            assert(
                !rectsOverlap(first, second),
                `placements ${i} and ${j} should not overlap or violate ${minSpacingPx}px spacing`
            );
        }
    }
}

function assertNoObstacleOverlap(plan, obstacles) {
    for (const placement of plan.placements) {
        for (const obstacle of obstacles) {
            assert(
                !rectsOverlap(placement.destinationBox, obstacle.bounds),
                `${placement.itemId} overlaps obstacle ${obstacle.id}`
            );
        }
    }
}

function assertSharedScale(plan, message) {
    const roundedScales = new Set(plan.placements.map((placement) => Math.round(placement.scalePercent * 100) / 100));
    assert.strictEqual(
        roundedScales.size,
        1,
        `${message}, got ${Array.from(roundedScales).join(', ')}`
    );
}

function assertRowsHaveAlignedTops(plan, tolerancePx, message) {
    const rows = new Map();
    for (const placement of plan.placements) {
        const row = placement.row || 0;
        const values = rows.get(row) || [];
        values.push(placement.destinationBox.top);
        rows.set(row, values);
    }

    for (const [row, values] of rows.entries()) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        assert(
            max - min <= tolerancePx,
            `${message}: row ${row} top variance ${Math.round((max - min) * 100) / 100}px exceeds ${tolerancePx}px`
        );
    }
}

function assertIncompleteRowsCentered(plan, tolerancePx, message) {
    const rows = new Map();
    for (const placement of plan.placements) {
        const row = placement.row || 0;
        const values = rows.get(row) || [];
        values.push(placement.destinationBox);
        rows.set(row, values);
    }

    const maxRowLength = Math.max(...Array.from(rows.values()).map((values) => values.length));
    const regionCenterX = plan.selectedRegion.left + plan.selectedRegion.width / 2;
    for (const [row, values] of rows.entries()) {
        if (values.length >= maxRowLength) continue;
        const rowLeft = Math.min(...values.map((rect) => rect.left));
        const rowRight = Math.max(...values.map((rect) => rect.right));
        const rowCenterX = (rowLeft + rowRight) / 2;
        assert(
            Math.abs(rowCenterX - regionCenterX) <= tolerancePx,
            `${message}: row ${row} center ${Math.round(rowCenterX)} should align to region center ${Math.round(regionCenterX)}`
        );
    }
}

function main() {
    const auto = loadTsModule(helperPath);
    assert.strictEqual(typeof auto.buildSkuAutoLayoutPlan, 'function', 'buildSkuAutoLayoutPlan should be exported');

    const two = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: [item('white'), item('black')],
        obstacles: [],
        preset: 'sku-combo'
    });
    assert.strictEqual(two.schema, 'sku-auto-layout-plan/v0', 'schema changed');
    assert.strictEqual(two.status, 'ready', `two-item plan should be ready: ${two.diagnostics.blockers.join('; ')}`);
    assert.strictEqual(two.strategy, 'single-row', 'two socks should prefer single-row');
    assert.strictEqual(two.placements.length, 2, 'two-item placement count changed');
    assertNoPlacementOverlap(two);
    two.placements.forEach((placement) => {
        assertRectInside(placement.destinationBox, two.safeBox, `${placement.itemId} should stay in safeBox`);
        assert(placement.scalePercent > 0, 'scalePercent should be positive');
    });

    for (const count of [1, 4, 5, 8, 10, 15]) {
        const quantityPlan = auto.buildSkuAutoLayoutPlan({
            canvas: { width: count >= 10 ? 1800 : 1600, height: count >= 10 ? 1200 : 1000 },
            items: Array.from({ length: count }, (_, index) => {
                const width = index % 3 === 0 ? 300 : index % 3 === 1 ? 380 : 460;
                const height = index % 2 === 0 ? 760 : 980;
                return item(`qty-${count}-${index + 1}`, width, height);
            }),
            obstacles: [],
            preset: 'sku-combo'
        });
        assert.strictEqual(quantityPlan.status, 'ready', `${count}-item quantity plan should be ready: ${quantityPlan.diagnostics.blockers.join('; ')}`);
        assert.strictEqual(quantityPlan.placements.length, count, `${count}-item placement count changed`);
        assertSharedScale(quantityPlan, `${count}-item SKU card should share one visual scale`);
        assertNoPlacementOverlap(quantityPlan, quantityPlan.constraints?.minSpacingPx || 0);
        quantityPlan.placements.forEach((placement) => {
            assertRectInside(placement.destinationBox, quantityPlan.safeBox, `${placement.itemId} should stay in safeBox`);
        });
    }

    const mixedSourceSizes = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: [
            item('short-crop', 300, 720),
            item('tall-crop', 420, 980),
            item('wide-crop', 500, 760)
        ],
        obstacles: [],
        preset: 'sku-combo'
    });
    assert.strictEqual(mixedSourceSizes.status, 'ready', `mixed-size plan should be ready: ${mixedSourceSizes.diagnostics.blockers.join('; ')}`);
    assertSharedScale(mixedSourceSizes, 'SKU items in one generated card should share one visual scale');
    assertNoPlacementOverlap(mixedSourceSizes);
    assertRowsHaveAlignedTops(mixedSourceSizes, 1, 'SKU combo rows should align sock tops instead of centering mixed crops independently');

    const subjectBoundsPlan = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: [
            {
                ...item('shadowed-white', 520, 980),
                subjectBounds: rect(60, 80, 360, 840)
            },
            {
                ...item('shadowed-black', 560, 1040),
                subjectBounds: rect(90, 120, 390, 880)
            }
        ],
        obstacles: [],
        preset: 'sku-combo'
    });
    assert.strictEqual(subjectBoundsPlan.status, 'ready', `subject-bounds plan should be ready: ${subjectBoundsPlan.diagnostics.blockers.join('; ')}`);
    assertSharedScale(subjectBoundsPlan, 'SKU planner should use subject bounds for visual scale, not shadow/effect bounds');
    assertNoPlacementOverlap(subjectBoundsPlan, subjectBoundsPlan.constraints?.minSpacingPx || 0);
    assert(
        subjectBoundsPlan.placements.every((placement) => placement.destinationBox.width < 420),
        'subject-bounds destination boxes should reflect the sock body instead of inflated shadow/effect bounds'
    );

    const spaced = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1400, height: 900 },
        items: ['a', 'b', 'c', 'd', 'e'].map((id) => item(id, 280, 500)),
        obstacles: [],
        preset: 'sku-combo',
        minSpacingPx: 160
    });
    assert.strictEqual(spaced.status, 'ready', `explicit spacing plan should be ready: ${spaced.diagnostics.blockers.join('; ')}`);
    assert(spaced.constraints && spaced.constraints.minSpacingPx >= 160, 'plan should retain the spacing constraint for post-execution QA');
    assertNoPlacementOverlap(spaced, 160);

    const six = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: ['1', '2', '3', '4', '5', '6'].map((id) => item(id)),
        obstacles: [],
        preset: 'sku-combo'
    });
    assert.strictEqual(six.status, 'ready', `six-item plan should be ready: ${six.diagnostics.blockers.join('; ')}`);
    assert(['single-row', 'grid'].includes(six.strategy), 'strategy should be explicit');
    assert.strictEqual(six.placements.length, 6, 'six-item placement count changed');
    assertNoPlacementOverlap(six);
    const sixRows = new Set(six.placements.map((p) => Math.round((p.destinationBox.top + p.destinationBox.bottom) / 100)));
    assert(sixRows.size >= 1, 'six-item plan should produce stable rows');

    const obstacles = [
        { id: 'title', role: 'text', bounds: { left: 0, top: 0, right: 1600, bottom: 260, width: 1600, height: 260 } },
        { id: 'badge', role: 'logo', bounds: { left: 60, top: 600, right: 340, bottom: 900, width: 280, height: 300 } }
    ];
    const avoided = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: [item('cream'), item('gray'), item('dark')],
        obstacles,
        preset: 'sku-note'
    });
    assert.strictEqual(avoided.status, 'ready', `obstacle plan should be ready: ${avoided.diagnostics.blockers.join('; ')}`);
    assertNoObstacleOverlap(avoided, obstacles);
    assert(avoided.selectedRegion.top >= 260, 'selected region should avoid the title band');

    const splitRegions = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: ['split-1', 'split-2', 'split-3', 'split-4', 'split-5', 'split-6'].map((id) => item(id, 420, 700)),
        obstacles: [
            { id: 'center-copy', role: 'text', bounds: { left: 700, top: 80, right: 900, bottom: 920, width: 200, height: 840 } }
        ],
        preset: 'sku-combo',
        minScalePercent: 40
    });
    assert.strictEqual(splitRegions.status, 'ready', `split-region plan should use multiple free regions: ${splitRegions.diagnostics.blockers.join('; ')}`);
    assert.strictEqual(splitRegions.placements.length, 6, 'split-region placement count changed');
    assertSharedScale(splitRegions, 'split-region SKU card should preserve one visual scale');
    assertNoPlacementOverlap(splitRegions, splitRegions.constraints?.minSpacingPx || 0);
    assertNoObstacleOverlap(splitRegions, [
        { id: 'center-copy', bounds: { left: 700, top: 80, right: 900, bottom: 920, width: 200, height: 840 } }
    ]);
    assert(
        splitRegions.placements.some((placement) => placement.destinationBox.right < 700)
          && splitRegions.placements.some((placement) => placement.destinationBox.left > 900),
        'split-region plan should distribute items on both sides of the center obstacle'
    );

    for (const count of [7, 11]) {
        const raggedGrid = auto.buildSkuAutoLayoutPlan({
            canvas: { width: 1600, height: 1000 },
            items: Array.from({ length: count }, (_, index) => item(`ragged-grid-${count}-${index + 1}`, 360, 900)),
            obstacles: [],
            preset: 'sku-combo'
        });
        assert.strictEqual(raggedGrid.status, 'ready', `${count}-item ragged grid plan should be ready: ${raggedGrid.diagnostics.blockers.join('; ')}`);
        assert.strictEqual(raggedGrid.strategy, 'grid', `${count}-item ragged grid should use grid layout`);
        assertIncompleteRowsCentered(raggedGrid, 2, `${count}-item ragged grid should center incomplete final rows`);
    }

    const denseTemplateItems = Array.from({ length: 15 }, (_, index) => {
        const width = index % 2 === 0 ? 420 : 360;
        const height = index % 3 === 0 ? 950 : 850;
        return item(`dense-template-${index + 1}`, width, height);
    });
    const denseTemplateBandObstacles = [
        { id: 'template-top-title', role: 'text', bounds: { left: 0, top: 0, right: 1600, bottom: 190, width: 1600, height: 190 } },
        { id: 'template-bottom-labels', role: 'text', bounds: { left: 0, top: 860, right: 1600, bottom: 1000, width: 1600, height: 140 } },
        { id: 'template-left-badge', role: 'decor', bounds: { left: 0, top: 430, right: 280, bottom: 760, width: 280, height: 330 } },
        { id: 'template-right-copy', role: 'text', bounds: { left: 1320, top: 360, right: 1600, bottom: 780, width: 280, height: 420 } }
    ];
    const denseTemplateBands = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: denseTemplateItems,
        obstacles: denseTemplateBandObstacles,
        preset: 'sku-combo'
    });
    assert.strictEqual(
        denseTemplateBands.status,
        'ready',
        `dense template band plan should use compact fallback instead of blocking: ${denseTemplateBands.diagnostics.blockers.join('; ')}`
    );
    assert.strictEqual(denseTemplateBands.placements.length, 15, 'dense template band placement count changed');
    assertSharedScale(denseTemplateBands, 'dense template band plan should preserve one visual scale');
    assertNoPlacementOverlap(denseTemplateBands, denseTemplateBands.constraints?.minSpacingPx || 0);
    assertNoObstacleOverlap(denseTemplateBands, denseTemplateBandObstacles.map((obstacle) => ({
        ...obstacle,
        bounds: expandRect(obstacle.bounds, denseTemplateBands.constraints?.clearancePx || 0)
    })));
    assert(
        denseTemplateBands.diagnostics.warnings.some((warning) => warning.includes('紧凑排版策略')),
        'dense template band plan should disclose compact layout strategy usage'
    );

    const denseTemplateIslandObstacles = [
        { id: 'template-title', role: 'text', bounds: { left: 0, top: 0, right: 1600, bottom: 170, width: 1600, height: 170 } },
        { id: 'template-center-copy', role: 'text', bounds: { left: 560, top: 360, right: 1040, bottom: 640, width: 480, height: 280 } },
        { id: 'template-bottom-labels', role: 'text', bounds: { left: 0, top: 850, right: 1600, bottom: 1000, width: 1600, height: 150 } }
    ];
    const denseTemplateIsland = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: denseTemplateItems,
        obstacles: denseTemplateIslandObstacles,
        preset: 'sku-combo'
    });
    assert.strictEqual(
        denseTemplateIsland.status,
        'ready',
        `dense template island plan should split side regions instead of blocking: ${denseTemplateIsland.diagnostics.blockers.join('; ')}`
    );
    assert.strictEqual(denseTemplateIsland.placements.length, 15, 'dense template island placement count changed');
    assertSharedScale(denseTemplateIsland, 'dense template island plan should preserve one visual scale');
    assertNoPlacementOverlap(denseTemplateIsland, denseTemplateIsland.constraints?.minSpacingPx || 0);
    assertNoObstacleOverlap(denseTemplateIsland, denseTemplateIslandObstacles.map((obstacle) => ({
        ...obstacle,
        bounds: expandRect(obstacle.bounds, denseTemplateIsland.constraints?.clearancePx || 0)
    })));
    assert(
        denseTemplateIsland.placements.some((placement) => placement.destinationBox.right < 560)
          && denseTemplateIsland.placements.some((placement) => placement.destinationBox.left > 1040),
        'dense template island plan should use both side regions around the center copy'
    );

    const denseNoteObstacles = [
        { id: 'dense-title', role: 'text', bounds: { left: 0, top: 0, right: 2400, bottom: 260, width: 2400, height: 260 } },
        { id: 'dense-footer', role: 'decor', bounds: { left: 0, top: 1600, right: 2400, bottom: 1800, width: 2400, height: 200 } }
    ];
    for (const count of [18, 24, 30]) {
        const denseNote = auto.buildSkuAutoLayoutPlan({
            canvas: { width: 2400, height: 1800 },
            items: Array.from({ length: count }, (_, index) => {
                const width = index % 3 === 0 ? 220 : index % 3 === 1 ? 260 : 300;
                const height = index % 2 === 0 ? 500 : 620;
                return item(`dense-note-${count}-${index + 1}`, width, height);
            }),
            obstacles: denseNoteObstacles,
            preset: 'sku-note',
            minSpacingPx: 30
        });
        assert.strictEqual(denseNote.status, 'ready', `${count}-item dense self-select note plan should be ready: ${denseNote.diagnostics.blockers.join('; ')}`);
        assert.strictEqual(denseNote.placements.length, count, `${count}-item dense self-select note placement count changed`);
        assert.strictEqual(denseNote.strategy, 'grid', `${count}-item dense self-select note should switch to grid layout`);
        assertSharedScale(denseNote, `${count}-item dense self-select note should preserve one visual scale`);
        assertNoPlacementOverlap(denseNote, denseNote.constraints?.minSpacingPx || 0);
        assertNoObstacleOverlap(denseNote, denseNoteObstacles.map((obstacle) => ({
            ...obstacle,
            bounds: expandRect(obstacle.bounds, denseNote.constraints?.clearancePx || 0)
        })));
        denseNote.placements.forEach((placement) => {
            assertRectInside(placement.destinationBox, denseNote.safeBox, `${placement.itemId} should stay in dense note safeBox`);
        });
    }

    const overcrowded = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 1600, height: 1000 },
        items: Array.from({ length: 50 }, (_, index) => item(`overcrowded-${index + 1}`, 420, 950)),
        obstacles: [],
        preset: 'sku-combo'
    });
    assert.strictEqual(overcrowded.status, 'blocked', 'physically overcrowded SKU card should still block');
    const overcrowdedWarning = overcrowded.diagnostics.warnings.join(' ');
    assert(overcrowdedWarning.includes('最大空闲区域约'), 'overcrowded blocked plan should expose largest free region size');
    assert(overcrowdedWarning.includes('SKU 数量 50'), 'overcrowded blocked plan should expose item count');
    assert(overcrowdedWarning.includes('最小缩放'), 'overcrowded blocked plan should expose min scale constraint');
    assert(overcrowdedWarning.includes('最小间距'), 'overcrowded blocked plan should expose spacing constraint');
    assert(overcrowded.diagnostics.summary, 'overcrowded blocked plan should expose structured diagnostics summary');
    assert.strictEqual(overcrowded.diagnostics.summary.itemCount, 50, 'diagnostics summary should expose item count');
    assert.strictEqual(overcrowded.diagnostics.summary.freeRegionCount, 1, 'diagnostics summary should expose free region count');
    assert(overcrowded.diagnostics.summary.largestFreeRegionAreaPx > 0, 'diagnostics summary should expose largest free-region area');
    assert(overcrowded.diagnostics.summary.largestItemAreaPx > 0, 'diagnostics summary should expose largest item area');
    assert(overcrowded.diagnostics.summary.totalItemAreaPx > overcrowded.diagnostics.summary.safeBoxAreaPx, 'diagnostics summary should expose total item area pressure');
    assert(
        overcrowded.diagnostics.summary.likelyBlockers.includes('high_item_count_needs_more_canvas_area'),
        'overcrowded diagnostics should classify high item count against canvas area'
    );

    const blocked = auto.buildSkuAutoLayoutPlan({
        canvas: { width: 360, height: 260 },
        items: [item('too-large-1'), item('too-large-2'), item('too-large-3')],
        obstacles: [
            { id: 'cover', bounds: { left: 0, top: 0, right: 360, bottom: 260, width: 360, height: 260 } }
        ],
        preset: 'sku-combo'
    });
    assert.strictEqual(blocked.status, 'blocked', 'fully occupied canvas should block');
    assert(blocked.diagnostics.blockers.some((msg) => msg.includes('没有可用排版区域')), 'blocked plan should explain missing free region');
    assert(blocked.diagnostics.summary, 'fully occupied blocked plan should expose structured diagnostics summary');
    assert.strictEqual(blocked.diagnostics.summary.freeRegionCount, 0, 'fully occupied diagnostics should expose zero free regions');
    assert.strictEqual(blocked.diagnostics.summary.expandedObstacleCount, 1, 'fully occupied diagnostics should expose clipped expanded obstacles');
    assert(
        blocked.diagnostics.summary.likelyBlockers.includes('no_free_region'),
        'fully occupied diagnostics should classify missing free region'
    );

    assert(two.diagnostics.summary, 'ready plans should expose structured diagnostics summary for UI and executor handoff');
    assert.strictEqual(two.diagnostics.summary.itemCount, 2, 'ready diagnostics summary should expose item count');
    assert.strictEqual(two.diagnostics.summary.obstacleCount, 0, 'ready diagnostics summary should expose obstacle count');
    assert.strictEqual(two.diagnostics.summary.freeRegionCount, 1, 'ready diagnostics summary should expose free region count');

    const payload = JSON.stringify([two, six, avoided, blocked, overcrowded]);
    assert(!payload.includes('confidence') && !payload.includes('置信'), 'auto layout plan must not contain confidence fields');
    assert(!payload.includes('base64') && !payload.includes('data:image'), 'auto layout plan must not expose raw image payloads');
    assert.strictEqual(two.boundaries.writesPhotoshop, false, 'pure planner must not write Photoshop');
    assert.strictEqual(two.boundaries.claimsDesignQuality, false, 'pure planner must not claim design quality');

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert(packageJson.scripts['smoke:sku-auto-layout-plan'], 'package script should expose SKU auto layout smoke');

    const skuIndexSource = fs.readFileSync(skuIndexPath, 'utf8');
    assert(skuIndexSource.includes("from './sku-auto-layout-plan'"), 'SKU module index should export sku auto layout planner');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'no-placeholder SKU auto layout emits stable pure planning contract',
            '1/2/4/5/6/8/10/15 SKU placements stay inside safeBox and do not overlap',
            'mixed source crops share one visual scale inside the same generated SKU card',
            'explicit minimum spacing is enforced during planning',
            'obstacles are avoided without treating template decoration as placeholders',
            'split free regions can be combined while preserving one visual scale',
            'incomplete final grid rows are centered inside the selected SKU layout region',
            'dense real-template obstacle bands and center copy islands use compact fallback instead of false blocking',
            'dense self-select notes up to 30 items keep grid spacing and avoid template bands',
            'physically overcrowded layouts block with actionable free-region and constraint diagnostics',
            'blocked and ready plans expose structured diagnostics summaries for executor/UI handoff',
            'fully occupied or too-small canvas blocks with a diagnostic message',
            'planner does not write Photoshop or claim design quality'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
}
