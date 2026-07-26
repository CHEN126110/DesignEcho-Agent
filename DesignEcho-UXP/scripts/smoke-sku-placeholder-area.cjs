#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const toolPath = path.join(projectRoot, 'src', 'tools', 'sku', 'sku-config-tools.ts');
const packagePath = path.join(projectRoot, 'package.json');

function main() {
    const source = fs.readFileSync(toolPath, 'utf8');

    assert(
        source.includes('area:') &&
            source.includes('占位区域左上角 X 坐标') &&
            source.includes('指定占位符排列的内容区域'),
        'createSkuPlaceholders should expose an explicit content area contract.'
    );
    assert(
        source.includes('columns:') &&
            source.includes('grid 布局列数'),
        'createSkuPlaceholders should expose a grid columns contract.'
    );
    assert(
        source.includes('centerLastRow') &&
            source.includes('最后一行居中'),
        'createSkuPlaceholders should expose a centerLastRow contract for balanced incomplete grid rows.'
    );
    assert(
        source.includes('slots:') &&
            source.includes('Agent 已经规划好的占位符槽位') &&
            source.includes('explicitSlots') &&
            source.includes('explicitSlots.length !== count'),
        'createSkuPlaceholders should accept explicit Agent-designed placeholder slots instead of always recalculating geometry.'
    );
    assert(
        source.includes('visible:') &&
            source.includes('隐藏定位槽') &&
            source.includes('activeLayer.visible = false'),
        'createSkuPlaceholders should support hidden locator placeholders that remain identifiable by bounds but do not export.'
    );
    assert(
        source.includes('const hasCustomArea') &&
            source.includes('const areaX') &&
            source.includes('const areaY') &&
            source.includes('const areaWidth') &&
            source.includes('const areaHeight'),
        'createSkuPlaceholders should normalize a custom area before layout calculation.'
    );
    assert(
        source.includes('areaX + i * (placeholderWidth + margin)') &&
            source.includes('areaY + row * (placeholderHeight + margin)'),
        'createSkuPlaceholders should place horizontal and grid slots relative to the custom area.'
    );
    assert(
        /const requestedColumns[\s\S]{0,220}Math\.round\(requestedColumns\)/.test(source),
        'createSkuPlaceholders should use explicit grid columns when provided.'
    );
    assert(
        /lastRowCount[\s\S]{0,500}rowOffsetX/.test(source),
        'createSkuPlaceholders should center the final incomplete grid row when requested.'
    );

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert(
        packageJson.scripts['smoke:sku-placeholder-area'],
        'package script should expose SKU placeholder area smoke.'
    );

    console.log(JSON.stringify({
        success: true,
        checks: [
            'createSkuPlaceholders exposes area and columns parameters',
            'createSkuPlaceholders can center the final incomplete grid row',
            'placeholder layout uses the explicit content area',
            'grid layout can be constrained to a requested column count',
            'explicit slots can be created as hidden locator layers'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
}
