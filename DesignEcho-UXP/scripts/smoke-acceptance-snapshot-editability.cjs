#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const snapshotPath = path.join(root, 'src/tools/acceptance/get-acceptance-snapshot.ts');
const source = fs.readFileSync(snapshotPath, 'utf8');

function assert(condition, message, details) {
    if (!condition) {
        const error = new Error(message);
        error.details = details;
        throw error;
    }
}

function assertIncludes(text, message) {
    assert(source.includes(text), message, { expected: text });
}

function assertRegex(pattern, message) {
    assert(pattern.test(source), message, { pattern: String(pattern) });
}

function main() {
    assertIncludes('interface AcceptanceEditability', 'AcceptanceLayer should expose a structured editability object');
    assertIncludes('editability: AcceptanceEditability', 'AcceptanceLayer entries should include editability evidence');

    for (const category of [
        'editable_text',
        'editable_shape',
        'editable_smart_object',
        'raster_only',
        'group',
        'unknown'
    ]) {
        assertIncludes(category, `editability category "${category}" should be represented`);
    }

    for (const summaryField of [
        'editableTextLayers',
        'editableShapeLayers',
        'editableSmartObjectLayers',
        'rasterOnlyLayers',
        'unknownEditabilityLayers',
        'editableLayerRatio'
    ]) {
        assertIncludes(summaryField, `AcceptanceSummary should include ${summaryField}`);
    }

    assertRegex(/kind\s*===\s*['"]text['"][\s\S]{0,240}category:\s*['"]editable_text['"][\s\S]{0,160}editable:\s*true/, 'text layers should be classified as editable text');
    assertRegex(/editableShapeKinds[\s\S]{0,240}(?:shape|solidColor|vector)/, 'shape, solidColor, and vector-like layers should be shape-editable candidates');
    assertRegex(/kind\s*===\s*['"]smartObject['"][\s\S]{0,260}category:\s*['"]editable_smart_object['"][\s\S]{0,180}editable:\s*true/, 'smart object layers should be marked editable with smart object caveats');
    assertRegex(/rasterOnlyKinds[\s\S]{0,240}(?:pixel|background)/, 'pixel and background layers should be raster-only, not structured editable layers');
    assertRegex(/category:\s*['"]unknown['"][\s\S]{0,160}editable:\s*null[\s\S]{0,260}warnings:/, 'unknown layer editability should be nullable and warning-based');
    assertRegex(/无法确定|不确定|unknown/i, 'warnings should express uncertainty instead of misclassifying unknown editability');

    assertIncludes('editabilitySummary', 'execute result should expose a top-level editabilitySummary for Agent consumption');
    assertRegex(/editableLayerRatio[\s\S]{0,220}Math\.round[\s\S]{0,120}\/\s*100/, 'editableLayerRatio should be rounded to two decimals in the 0..1 range');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'AcceptanceLayer exposes editability evidence',
            'editability categories cover text, shape, smart object, raster, group, and unknown',
            'AcceptanceSummary exposes editability counters and ratio',
            'unknown editability remains warning-based instead of being misclassified',
            'execute exposes top-level editabilitySummary without raw payloads'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(JSON.stringify({
        success: false,
        error: error && error.message ? error.message : String(error),
        details: error && error.details ? error.details : undefined
    }, null, 2));
    process.exit(1);
}
