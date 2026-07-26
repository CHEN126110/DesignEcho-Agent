#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const toolPath = path.join(projectRoot, 'src', 'tools', 'layout', 'sku-layout-tool.ts');
const configPath = path.join(projectRoot, 'src', 'tools', 'sku', 'sock-layout-config.ts');
const packagePath = path.join(projectRoot, 'package.json');

function main() {
    const toolSource = fs.readFileSync(toolPath, 'utf8');
    const configSource = fs.readFileSync(configPath, 'utf8');
    const noteFunctionStart = toolSource.indexOf('private async executeNoteWithDynamicArrange');
    const noteFunctionEnd = toolSource.indexOf('private async exportNoteTemplate');
    const noteFunctionSource = noteFunctionStart >= 0 && noteFunctionEnd > noteFunctionStart
        ? toolSource.slice(noteFunctionStart, noteFunctionEnd)
        : '';

    assert(
        toolSource.includes('collectOrderedSkuReplacementPlaceholders'),
        'skuLayout should collect ordered replacement placeholders from template layer groups.'
    );
    assert(
        toolSource.includes('isSkuPlaceholderContainerName') &&
            toolSource.includes('placeholders') &&
            toolSource.includes('holder'),
        'skuLayout should recognize placeholder containers named 占位/占位符/placeholders/holder.'
    );
    assert(
        /sku.*占位符|占位符.*\d+个/.test(toolSource),
        'skuLayout should recognize createSkuPlaceholders containers such as SKU占位符 (2个).'
    );
    assert(
        toolSource.includes('isSkuReplacementPlaceholderName') &&
            toolSource.includes('REPLACEMENT_PLACEHOLDER_KEYWORDS'),
        'skuLayout should recognize direct placeholder groups named 1/2/3, 占位1, placeholder, holder or #.'
    );
    assert(
        toolSource.includes('isSkuRectangleReplacementPlaceholderLayer') &&
            toolSource.includes('isLegacySkuRegionGeometry'),
        'skuLayout should also recognize legacy rectangle placeholder layers through the same geometry boundary used by Agent preflight.'
    );
    assert(
        toolSource.includes('isLegacySkuReferenceRegionName') &&
            toolSource.includes('solidcolor') &&
            toolSource.includes('形状'),
        'skuLayout should recognize C-1163 hidden 形状参考 solidColor layers as legacy reference regions.'
    );
    assert(
        toolSource.includes('isLegacyReferenceItemGroupLayer') &&
            toolSource.includes('hasReferenceSlotTextChild') &&
            toolSource.includes('hasReferenceSlotVisualChild'),
        'skuLayout should recognize C-1197 style filled reference item groups as legacy SKU slots.'
    );
    assert(
        toolSource.includes("revision: 'sku-ordered-placeholder-recognition/v4'") &&
            toolSource.includes('acceptsCreateSkuPlaceholdersShapeLayers: true') &&
            toolSource.includes('acceptsHiddenReferenceShapeRegions: true') &&
            toolSource.includes('supportsSingleLegacyReferenceRegion: true') &&
            toolSource.includes('acceptsLegacyReferenceItemGroups: true') &&
            toolSource.includes('returnsLayerSetBounds: true'),
        'skuLayout capabilities should expose ordered placeholder recognition and SKU source bounds for generated, hidden-reference, and filled-reference templates.'
    );
    assert(
        toolSource.includes("case 'inspectTemplateLayout'") &&
            toolSource.includes('private inspectTemplateLayout') &&
            toolSource.includes("schema: 'sku-template-layout-inspection/v2'"),
        'skuLayout should expose a read-only inspectTemplateLayout action so Agent does not duplicate Photoshop template recognition rules.'
    );
    assert(
        toolSource.includes("'inspectTemplateLayout'") &&
            /actions:\s*\[[\s\S]{0,260}'inspectTemplateLayout'/.test(toolSource),
        'skuLayout capabilities should advertise inspectTemplateLayout as part of the runtime contract.'
    );
    assert(
        toolSource.includes("revision: 'sku-note-placeholder-overflow/v2'") &&
            toolSource.includes('hidesUnusedPlaceholders: true'),
        'skuLayout capabilities should expose self-select note extra-placeholder handling for live verification.'
    );
    assert(
        /getLayerChildren\(container\)\.filter\(\(layer\) =>[\s\S]{0,240}isSkuOrderedPlaceholderLayer\(layer,\s*doc/.test(toolSource),
        'skuLayout should accept both layer-group and rectangle placeholder layers inside a placeholder container.'
    );
    assert(
        /collectNamedSkuReplacementPlaceholders\(rootLayers,\s*doc/.test(toolSource),
        'skuLayout should scan top-level legacy rectangle placeholders when no explicit placeholder container exists.'
    );
    assert(
        toolSource.includes('resolveSkuRegionCapacities') &&
            toolSource.includes("input.mode === 'legacy_single_region'") &&
            toolSource.includes('return [input.comboSize]'),
        'skuLayout should allow one legacy reference region to carry a multi-color combo through the shared capacity resolver.'
    );
    assert(
        /orderedPlaceholderInfo\.length\s*===\s*0/.test(toolSource) &&
            /inspectionMode\s*===\s*'ordered_slots'[\s\S]{0,180}orderedPlaceholderInfo\.length\s*!==\s*comboSize/.test(toolSource),
        'skuLayout should reject templates with no SKU region and ordered-slot templates with an incompatible slot count.'
    );
    assert(
        toolSource.includes('const regionColorAssignments = regionCapacities.map') &&
            toolSource.includes('const regionColors = regionColorAssignments[placeholderIdx] || []'),
        'skuLayout should execute both one-to-one and multi-color regions from one explicit assignment plan.'
    );
    assert(
        toolSource.includes("revision: 'sku-region-composition/v1'") &&
            toolSource.includes('acceptsExplicitRegionCapacities: true') &&
            toolSource.includes('supportsMultipleRectangleRegions: true'),
        'skuLayout capabilities should advertise explicit multi-region composition.'
    );
    assert(
        !toolSource.includes('MIN_COLORS_PER_REGION') &&
            !toolSource.includes('智能分配结果') &&
            !toolSource.includes('colorsPerPlaceholder'),
        'skuLayout should not keep old smart region distribution in the ordered placeholder path.'
    );
    assert(
        !/placeholderLayers[\s\S]{0,700}\.sort\(\(a, b\) => \(a\.bounds\?\.left/.test(toolSource),
        'skuLayout should not reorder placeholders by physical left coordinate.'
    );
    assert(
        !/rootLayers\.filter\(\(layer\) => isTemplateGroupLayer\(layer\)\)/.test(toolSource),
        'skuLayout must not fallback to treating all top-level groups as placeholders when no explicit placeholder marker exists.'
    );
    assert(
        toolSource.includes('hideSkuReplacementPlaceholder'),
        'skuLayout should hide each placeholder after replacing it with the copied color group.'
    );
    assert(
        noteFunctionSource.includes('await translateLayer(activeLayer, deltaX, deltaY);') &&
            noteFunctionSource.includes('hideSkuReplacementPlaceholder(placeholder.layer)'),
        'self-select note ordered placeholder replacement should hide the placeholder group after a copied color is placed.'
    );
    assert(
        /sortedPlaceholders\.length\s*>=\s*orderedNoteColors\.length/.test(noteFunctionSource) &&
            /sortedPlaceholders\.length\s*>=\s*1/.test(noteFunctionSource),
        'self-select note should allow extra placeholder slots when the template has more slots than available colors.'
    );
    assert(
        noteFunctionSource.includes('distributeNoteColorsIntoRegions(orderedNoteColors, sortedPlaceholders.length)'),
        'self-select note should distribute colors across one or more legacy reference regions.'
    );
    assert(
        /regionIdx >= numRegions[\s\S]{0,240}hideSkuReplacementPlaceholder\(placeholder\.layer\)/.test(noteFunctionSource),
        'self-select note should hide unused placeholder slots when there are more slots than colors.'
    );
    assert(
        !/collectVisibleSkuTemplateObstacles\(allLayers,\s*templateDoc\)/.test(toolSource),
        'skuLayout ordered placeholder path should not collect template obstacles for automatic avoidance.'
    );
    assert(
        configSource.includes('parseOrderedColorSlotSequence'),
        'sock layout config should parse 配色 as one ordered placeholder sequence.'
    );
    assert(
        !/\.split\('\|'\)[\s\S]{0,240}\.map\(\(region\)/.test(configSource),
        'sock layout config should not treat | as a separate region in 6.3 mode.'
    );

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert(packageJson.scripts['smoke:sku-ordered-placeholder-layout'], 'package script should expose ordered placeholder smoke.');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'skuLayout uses ordered placeholder layer groups instead of coordinate-sorted art layers',
            'new templates map one color to one slot, legacy templates can map one region to a whole combo',
            'filled reference item groups are accepted as legacy SKU slots',
            'templates without explicit placeholder markers fail instead of treating arbitrary top-level groups as placeholders',
            'old smart region distribution is not present in the ordered placeholder path',
            'template obstacle avoidance is not collected for ordered placeholder replacement',
            'sock layout config parses | and + as the same sequential separator'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
}
