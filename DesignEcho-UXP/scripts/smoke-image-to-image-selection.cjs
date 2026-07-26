#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src/core/image-to-image-selection.ts');
const indexPath = path.join(projectRoot, 'src/index.ts');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function loadHelperModule(filePath) {
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

function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/image-to-image-selection'"),
        'src/index.ts must import image-to-image selection helpers from src/core/image-to-image-selection.ts'
    );
    for (const localName of [
        'buildImageToImageSelectionPayload',
        'buildImageToImageSelectionSignature'
    ]) {
        assert(!new RegExp(`function\\s+${localName}\\b`).test(indexSource), `${localName} must not remain local in src/index.ts`);
    }

    const selection = loadHelperModule(helperPath);
    const noDocument = selection.buildImageToImageSelectionPayload(null);
    assert(noDocument.documentName === '当前文档', 'no-document name fallback changed');
    assert(noDocument.selectionState === 'none' && noDocument.hasSelectedLayer === false, 'no-document selection state changed');

    const multiple = selection.buildImageToImageSelectionPayload({
        title: 'Poster',
        width: 1200,
        height: 800,
        activeLayers: [{ id: 1 }, { id: 2 }]
    });
    assert(multiple.documentName === 'Poster', 'document title priority changed');
    assert(multiple.width === 1200 && multiple.height === 800, 'document dimensions changed');
    assert(multiple.selectionState === 'multiple', 'multiple-layer selection state changed');

    const single = selection.buildImageToImageSelectionPayload({
        name: 'File.psd',
        width: '900',
        height: '700',
        activeLayers: [{
            id: 9,
            name: 'Hero',
            boundsNoEffects: { left: 10, top: 20, right: 210, bottom: 320 }
        }]
    });
    assert(single.selectionState === 'single', 'single-layer selection state changed');
    assert(single.hasSelectedLayer === true, 'single-layer selected flag changed');
    assert(single.selectedLayerId === 9 && single.selectedLayerName === 'Hero', 'single-layer identity changed');
    assert(single.selectedLayerWidth === 200 && single.selectedLayerHeight === 300, 'single-layer dimensions changed');
    assert(selection.buildImageToImageSelectionSignature(single) === 'single|9|Hero|200|300', 'selection signature changed');

    const emptyBounds = selection.buildImageToImageSelectionPayload({
        activeLayers: [{ id: 3, name: 'Empty', bounds: { left: 50, top: 50, right: 20, bottom: 10 } }]
    });
    assert(emptyBounds.selectedLayerWidth === 0 && emptyBounds.selectedLayerHeight === 0, 'negative layer bounds should clamp to 0');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'image-to-image selection helpers live outside src/index.ts',
            'selection payload states remain stable',
            'selection signature remains stable'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
