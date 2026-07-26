#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const toolPath = path.join(projectRoot, 'src', 'tools', 'layout', 'sku-layout-tool.ts');
const packagePath = path.join(projectRoot, 'package.json');

function main() {
    const source = fs.readFileSync(toolPath, 'utf8');

    assert(
        source.includes("buildSkuAutoLayoutPlan") && source.includes("sku-auto-layout-plan"),
        'skuLayout tool should import the pure SKU auto layout planner'
    );
    assert(
        source.includes('autoLayoutWithoutPlaceholders'),
        'skuLayout execute params should expose autoLayoutWithoutPlaceholders'
    );
    assert(
        source.includes("case 'getCapabilities'"),
        'skuLayout should expose a read-only getCapabilities action for Agent runtime preflight'
    );
    assert(
        source.includes("schema: 'sku-layout-capabilities/v0'") && source.includes('supportsNoPlaceholderAutoLayout'),
        'skuLayout getCapabilities should return explicit no-placeholder runtime support'
    );
    assert(
        source.includes("revision: 'sku-no-placeholder-auto-layout/v2'") &&
            source.includes('returnsActualSubjectBoundsQa: true'),
        'skuLayout getCapabilities should expose the current no-placeholder revision and actual subject-bounds QA contract'
    );
    assert(
        /config\.autoLayoutWithoutPlaceholders[\s\S]{0,600}name:\s*'画布'[\s\S]{0,900}:\s*orderedPlaceholderInfo/.test(source) &&
            /if\s*\(\s*config\.autoLayoutWithoutPlaceholders\s*\)[\s\S]{0,600}\}\s*else\s*\{[\s\S]{0,360}collectOrderedSkuReplacementPlaceholders\(templateDoc\)/.test(source),
        'auto layout compatibility mode should use a canvas fallback; ordered placeholder groups are collected only for the 6.3 placeholder path'
    );
    assert(
        source.includes('autoLayoutObstacles') && source.includes('buildSkuAutoLayoutPlan({'),
        'auto layout mode should turn template elements into obstacles and build a planner result'
    );
    assert(
        source.includes('collectVisibleSkuTemplateObstacles'),
        'auto layout mode should use a shared recursive visible obstacle collector'
    );
    assert(
        source.includes('isExplicitSkuPlaceholderTemplateLayerName') &&
        source.includes('产品位|图片位|颜色位|图位'),
        'no-placeholder obstacle collector should ignore explicit SKU placeholder aliases instead of treating them as obstacles'
    );
    assert(
        source.includes('isLegacyTopLevelSkuPlaceholderTemplateLayer') &&
        source.includes('isLegacySkuRegionGeometry'),
        'no-placeholder obstacle collector should share the Agent legacy rectangle placeholder boundary'
    );
    assert(
        /collectVisibleSkuTemplateObstacles\(getLayerChildren\(layer\), doc, visible, depth \+ 1\)/.test(source) &&
        /isAuxiliaryTemplateLayer\(layer, bounds, doc, depth\)/.test(source),
        'obstacle collector should pass layer depth so only top-level legacy rectangles are ignored as placeholders'
    );
    assert(
        (source.match(/collectVisibleSkuTemplateObstacles\(/g) || []).length >= 3,
        'combo and self-select note no-placeholder branches should both call the shared obstacle collector'
    );
    assert(
        !/autoLayoutObstacles\.push\(layer\)/.test(source),
        'auto layout obstacles must not be collected by a top-level raw layer push loop'
    );
    assert(
        source.includes('visible !== false') && source.includes('parentVisible') && source.includes('isFullCanvasTemplateLayer'),
        'obstacle collector should inherit group visibility and filter full-canvas/background helper layers'
    );
    assert(
        source.includes('collectSkuLayerGroups') &&
            source.includes('findSkuLayerGroupByName') &&
            source.includes('recursive: true') &&
            source.includes("sku-recursive-color-layer-groups/v1") &&
            source.includes('supportsRecursiveSkuLayerSets'),
        'skuLayout should recursively list and resolve nested SKU color layer groups'
    );
    assert(
        (source.match(/findSkuLayerGroupByName\(Array\.from\(/g) || []).length >= 4,
        'all SKU color-copy paths should use the shared recursive color group resolver'
    );
    assert(
        /if\s*\(\s*config\.autoLayoutWithoutPlaceholders\s*\)\s*\{[\s\S]{0,260}原始边界[\s\S]{0,120}\}\s*else\s*\{[\s\S]{0,500}缩放图层以适应目标区域/.test(source),
        'no-placeholder mode must preserve copied layer source bounds and avoid placeholder-style pre-scaling before planner placement'
    );
    assert(
        source.includes('applySkuAutoLayoutPlan') && source.includes('actualAutoLayoutPlan'),
        'skuLayout should apply planner placements and retain the plan for diagnostics'
    );
    assert(
        source.includes('getSkuAutoLayoutSubjectBounds') &&
            /const subjectBounds = getSkuAutoLayoutSubjectBounds\(layer\) \?\? undefined/.test(source) &&
            /subjectBounds\s*\n?\s*\}/.test(source),
        'no-placeholder planner items should pass subject bounds so shadows/effects do not distort visual scale'
    );
    assert(
        /const beforeSubjectBounds = getSkuAutoLayoutSubjectBounds\(layer\) \|\| beforeBounds/.test(source) &&
            /const afterScaleSubjectBounds = getSkuAutoLayoutSubjectBounds\(refreshedLayer\) \|\| afterScaleBounds/.test(source),
        'applying no-placeholder plans should scale and align by subject bounds, not only full layer bounds'
    );
    assert(
        source.includes('actualSubjectBounds'),
        'post-execution QA should receive actualSubjectBounds while still retaining full actualBounds for safety checks'
    );
    assert(
        source.includes('formatSkuAutoLayoutSummaryDiagnostic') &&
        /summary:\s*actualAutoLayoutPlan\.diagnostics\.summary/.test(source) &&
        /summary:\s*actualNoteAutoLayoutPlan\.diagnostics\.summary/.test(source),
        'skuLayout should preserve structured auto-layout diagnostics summaries for combo and self-select note paths'
    );
    assert(
        source.includes('buildSkuLayoutPrimaryFailureReason'),
        'skuLayout should build the top-level failure reason from structured layout errors and planner blockers'
    );
    assert(
        /error:[\s\S]{0,240}buildSkuLayoutPrimaryFailureReason\(/.test(source),
        'skuLayout execute failures must expose the real layout blocker instead of only "未导出任何文件"'
    );
    assert(
        source.includes('normalizePhotoshopToolError') &&
            source.includes('formatSkuLayoutCaughtError') &&
            /errors\.push\(`组合 \$\{comboIndex \+ 1\}: \$\{formatSkuLayoutCaughtError\(err\)\}`\)/.test(source),
        'skuLayout combo failures must normalize non-Error Photoshop exceptions instead of returning undefined'
    );
    assert(
        source.includes("revision: 'sku-layout-error-normalization/v1'") &&
            source.includes('normalizesNonErrorExceptions: true'),
        'skuLayout capabilities should expose the runtime error-normalization revision for live reload verification'
    );
    assert(
        /case 'arrangeDynamic'[\s\S]{0,900}autoLayoutWithoutPlaceholders:\s*params\.autoLayoutWithoutPlaceholders/.test(source),
        'arrangeDynamic should pass autoLayoutWithoutPlaceholders into note layout'
    );
    assert(
        source.includes('function normalizeSkuNoteColorRegions') &&
            /colorsByRegion:\s*normalizeSkuNoteColorRegions\(params\.combos\s*\|\|\s*\[\]\)/.test(source),
        'arrangeDynamic should pass the complete combo matrix into self-select note layout instead of only the first combo'
    );
    assert(
        !/case 'arrangeDynamic'[\s\S]{0,900}colors:\s*params\.combos\?\.\[0\]/.test(source),
        'arrangeDynamic must not reduce self-select note colors to params.combos?.[0]'
    );
    assert(
        /executeNoteWithDynamicArrange\(config:[\s\S]{0,700}autoLayoutWithoutPlaceholders\?: boolean/.test(source),
        'executeNoteWithDynamicArrange should accept autoLayoutWithoutPlaceholders'
    );
    assert(
        source.includes('actualNoteAutoLayoutPlan') && source.includes('noteAutoLayoutPlans'),
        'self-select note layout should build and retain no-placeholder planner diagnostics'
    );
    assert(
        /allNoteLayerIds\.push\(newLayerId\)[\s\S]{0,360}if\s*\(\s*config\.autoLayoutWithoutPlaceholders\s*\)[\s\S]{0,220}原始边界[\s\S]{0,120}continue/.test(source),
        'self-select note no-placeholder mode must preserve copied source bounds before planner placement'
    );
    assert(
        /if\s*\(\s*config\.autoLayoutWithoutPlaceholders\s*\)[\s\S]{0,220}跳过自选备注旧水平分布[\s\S]{0,140}else if\s*\(\s*regionLayerIds\.length\s*>=\s*3\s*\)/.test(source),
        'self-select note no-placeholder mode must skip legacy Photoshop distribution before planner placement'
    );
    assert(
        !source.includes('confidence') && !source.includes('置信'),
        'skuLayout auto layout integration must not introduce confidence fields'
    );
    assert(
        source.includes('function buildSkuComboExportFileName') &&
            source.includes('function normalizeSkuExportFileName') &&
            source.includes('const usedComboOutputFileNames = new Set<string>()'),
        'skuLayout should centralize combo export naming and track duplicate filenames per execution batch'
    );
    assert(
        source.includes("comboExportNaming:") &&
            source.includes("revision: 'sku-combo-export-naming/v1'") &&
            source.includes('keepsExecutionOrderOutOfFileName: true'),
        'skuLayout capabilities should expose the combo export naming contract for live reload verification'
    );
    assert(
        /outputFileName\s*=\s*buildSkuComboExportFileName\(combo,\s*comboIndex,\s*usedComboOutputFileNames\)/.test(source),
        'normal SKU combo export names should come from the color combo, not from execution order'
    );
    assert(
        !/outputFileName\s*=\s*`\$\{comboIndex \+ 1\}\$\{combo\.join\('\+'\)\}`/.test(source),
        'normal SKU combo export names must not prefix the internal combo index'
    );

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert(packageJson.scripts['smoke:sku-layout-auto-planner-integration'], 'package script should expose SKU auto layout integration smoke');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'skuLayout exposes explicit no-placeholder auto layout mode',
            'visible template decoration layers become recursive obstacles instead of fake placeholders',
            'explicit and legacy placeholder-like template layers are ignored consistently in no-placeholder obstacle collection',
            'no-placeholder mode avoids placeholder-style pre-scaling before planner placement',
            'nested SKU color groups are discovered and advertised through the shared recursive resolver',
            'self-select note no-placeholder mode skips legacy pre-scaling and distribution',
            'skuLayout calls and applies the pure planner',
            'skuLayout surfaces planner blockers as the primary failure reason',
            'skuLayout preserves structured planner summaries for failure diagnosis',
            'normal combo export names are decoupled from execution order',
            'integration keeps diagnostics without confidence fields'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
}
