#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src/core/template-library-core.ts');
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
        console,
        btoa: (text) => Buffer.from(text, 'binary').toString('base64')
    }, { filename: filePath });
    return module.exports;
}

function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/template-library-core'"),
        'src/index.ts must import template library core helpers from src/core/template-library-core.ts'
    );
    for (const localName of [
        'normalizeTemplateLibraryRelativePath',
        'getTemplateLibraryParentRelativePath',
        'stripTemplateLibraryExtension',
        'isGenericTemplateLibraryLayerName',
        'getTemplateLibrarySelectionBaseName',
        'sanitizeTemplateLibraryAssetFileName',
        'getTemplateLibraryStatePayload',
        'getTemplateLibraryDisconnectedState',
        'hasUsableTemplateLibraryCachedState',
        'upsertTemplateLibraryAssetEntries',
        'collectTemplateLibraryMissingPreviewPaths',
        'getTemplateLibraryErrorMessage',
        'isTemplateLibrarySmartObjectLayer',
        'hasTemplateLibraryVisibleBounds',
        'getTemplateLibraryLayerBounds',
        'templateLibraryUint8ArrayToBase64',
        'buildOptimisticTemplateLibraryImportOverrides',
        'mergeTemplateLibraryStatePayload'
    ]) {
        assert(!new RegExp(`(?:const|function)\\s+${localName}\\b`).test(indexSource), `${localName} must not remain local in src/index.ts`);
    }

    const core = loadHelperModule(helperPath);
    assert(core.normalizeTemplateLibraryRelativePath('a/./b/../c\\\\d') === 'a/b/c/d', 'relative path normalization changed');
    assert(core.getTemplateLibraryParentRelativePath('a/b/c.psd') === 'a/b', 'parent relative path changed');
    assert(core.stripTemplateLibraryExtension(' hero.psd ') === 'hero', 'extension stripping changed');
    assert(core.isGenericTemplateLibraryLayerName('图层 副本 2') === true, 'generic Chinese layer name detection changed');
    assert(core.isGenericTemplateLibraryLayerName('hero product') === false, 'specific layer name should not be generic');
    assert(core.getTemplateLibrarySelectionBaseName({ name: 'doc.psb' }, [{ name: 'hero group' }]) === 'hero group', 'selection base name should prefer specific single layer');
    assert(core.getTemplateLibrarySelectionBaseName({ name: 'doc.psb' }, [{ name: '图层 1' }]) === 'doc', 'selection base name should fall back from generic layer');
    assert(core.sanitizeTemplateLibraryAssetFileName('a<>:"/\\\\|?* b...') === 'a b', 'asset file name sanitization changed');

    const state = core.getTemplateLibraryStatePayload({
        success: true,
        detailReady: true,
        activeLibraryId: 123,
        assets: [{ relativePath: 'a.psd' }],
        tags: ['hero']
    });
    assert(state.connected === true && state.activeLibraryId === '123', 'state payload connection or id changed');
    assert(Array.isArray(core.getTemplateLibraryDisconnectedState('offline').assets), 'disconnected state shape changed');
    assert(core.hasUsableTemplateLibraryCachedState({ libraries: [{ id: 'l1' }] }) === true, 'usable cached library state changed');
    assert(core.hasUsableTemplateLibraryCachedState({ connected: false, libraries: [{ id: 'l1' }] }) === false, 'disconnected cache should not be usable');

    const previousState = {
        activeLibraryId: 'lib-1',
        relativePath: 'folder',
        assets: [{ relativePath: 'old.psd' }, { relativePath: 'same.psd' }],
        tags: ['old-tag']
    };
    const optimistic = core.buildOptimisticTemplateLibraryImportOverrides(
        previousState,
        'lib-1',
        'folder/same.psb',
        { name: '', extension: '.psb', previewBase64: 'data:image/jpeg;base64,x' }
    );
    assert(optimistic && optimistic.assets.length === 3, 'optimistic import override asset count changed');
    assert(optimistic.assets[0].relativePath === 'folder/same.psb', 'optimistic import override ordering changed');
    assert(optimistic.assets[0].name === 'same', 'optimistic import override fallback name changed');
    assert(optimistic.assets[0].assetType === 'design-file', 'optimistic import override asset type changed');
    assert(
        core.buildOptimisticTemplateLibraryImportOverrides(previousState, 'other-lib', 'folder/a.psd', {}) === undefined,
        'optimistic import should ignore inactive library'
    );

    const mergedDetailPending = core.mergeTemplateLibraryStatePayload(previousState, {
        activeLibraryId: 'lib-1',
        relativePath: 'folder',
        detailReady: false,
        assets: [],
        tags: []
    });
    assert(mergedDetailPending.assets.length === 2 && mergedDetailPending.tags[0] === 'old-tag', 'detail-pending state should preserve previous assets and tags');
    const mergedOverride = core.mergeTemplateLibraryStatePayload(previousState, {
        activeLibraryId: 'lib-1',
        relativePath: 'folder',
        detailReady: true,
        assets: []
    }, { assets: [{ relativePath: 'override.psd' }] });
    assert(mergedOverride.assets[0].relativePath === 'override.psd', 'state payload overrides changed');

    const updated = core.upsertTemplateLibraryAssetEntries([{ relativePath: 'old.psd' }, { relativePath: 'same.psd' }], { relativePath: 'same.psd' });
    assert(updated.length === 2 && updated[0].relativePath === 'same.psd', 'asset upsert ordering changed');
    const missing = core.collectTemplateLibraryMissingPreviewPaths({
        assets: [
            { relativePath: 'a.psd', assetType: 'design-file' },
            { relativePath: 'a.psd', assetType: 'design-file' },
            { relativePath: 'b.txt', assetType: 'text' },
            { relativePath: 'c.png', thumbnailUrl: 'data:image/png;base64,x' }
        ]
    });
    assert(missing.length === 1 && missing[0] === 'a.psd', 'missing preview path collection changed');

    assert(core.getTemplateLibraryErrorMessage(new Error('boom'), 'fallback') === 'boom', 'Error message extraction changed');
    assert(core.isTemplateLibrarySmartObjectLayer({ kind: 17 }) === true, 'numeric smart object detection changed');
    assert(core.isTemplateLibrarySmartObjectLayer({ kind: 'smartObject' }) === true, 'string smart object detection changed');
    assert(core.hasTemplateLibraryVisibleBounds({ left: 0, top: 0, right: 10, bottom: 20 }) === true, 'visible bounds detection changed');
    assert(core.hasTemplateLibraryVisibleBounds({ left: 0, top: 0, right: 0, bottom: 20 }) === false, 'empty bounds should not be visible');
    assert(core.getTemplateLibraryLayerBounds({ kind: 17, bounds: { left: 1 }, boundsNoEffects: { left: 2 } }).left === 1, 'smart object bounds priority changed');
    assert(core.getTemplateLibraryLayerBounds({ kind: 'pixel', bounds: { left: 1 }, boundsNoEffects: { left: 2 } }).left === 2, 'normal layer bounds priority changed');
    assert(core.templateLibraryUint8ArrayToBase64(new Uint8Array([65, 66, 67])) === 'QUJD', 'uint8 base64 conversion changed');

    try {
        core.templateLibraryUint8ArrayToBase64(new Uint8Array([1, 2]), 1);
        throw new Error('expected oversized base64 conversion to fail');
    } catch (error) {
        assert(String(error?.message || error).includes('too large'), 'oversized base64 error changed');
    }

    console.log(JSON.stringify({
        success: true,
        checks: [
            'template library core helpers live outside src/index.ts',
            'template library path and state payload helpers remain stable',
            'template library bounds and base64 guards remain stable'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
