#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

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

function loadToolClass() {
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            esModuleInterop: true
        },
        fileName: snapshotPath
    }).outputText;
    const module = { exports: {} };
    const sandbox = {
        module,
        exports: module.exports,
        console,
        require(request) {
            if (request === 'photoshop') {
                return {
                    app: {
                        documents: [],
                        activeDocument: null
                    }
                };
            }
            if (request === '../types') {
                return {};
            }
            if (request === '../../core/photoshop-document-observation') {
                return {
                    observeActiveDocumentAtHistoryState: async (_options, reader) => ({
                        value: await reader({}),
                        historyStateRef: { documentId: 1, historyStateId: 1 }
                    }),
                    PhotoshopDocumentObservationError: class PhotoshopDocumentObservationError extends Error {}
                };
            }
            return require(request);
        }
    };
    vm.runInNewContext(compiled, sandbox, { filename: snapshotPath });
    return module.exports.GetAcceptanceSnapshotTool;
}

function createStaleLayer() {
    return Object.defineProperties({}, {
        id: {
            get() {
                throw new Error('The 图层 with an id of 104 does not exist.');
            }
        },
        name: {
            get() {
                throw new Error('The 图层 with an id of 104 does not exist.');
            }
        }
    });
}

function assertStaleLayerBehavior() {
    const ToolClass = loadToolClass();
    const tool = new ToolClass();
    const warnings = [];
    const result = [];
    const groupLayer = {
        id: 20,
        name: '商品信息组',
        kind: 7,
        visible: true,
        locked: false,
        allLocked: false,
        opacity: 100,
        blendMode: 'normal'
    };
    Object.defineProperty(groupLayer, 'layers', {
        get() {
            throw new Error('The 图层 with an id of 104 does not exist.');
        }
    });

    tool.collectLayers({
        container: {
            layers: [
                createStaleLayer(),
                groupLayer
            ]
        },
        result,
        selectedIds: new Set(),
        includeHidden: true,
        includeBounds: false,
        includeText: false,
        maxLayers: 20,
        warnings,
        parentId: null,
        parentName: null,
        depth: 0,
        parentPath: []
    });

    assert(result.length === 1, 'valid sibling layers should still be returned after a stale layer is skipped', { result, warnings });
    assert(result[0].name === '商品信息组', 'the valid layer should keep its layer metadata', { result });
    assert(warnings.length >= 2, 'stale layer and stale child traversal should both be reported as warnings', { warnings });
    assert(warnings.every((warning) => warning.includes('跳过失效图层')), 'warnings should clearly identify stale layer skips', { warnings });
}

function main() {
    assertIncludes('readLayerList', 'getAcceptanceSnapshot should read layer collections through a guarded helper');
    assertIncludes('跳过失效图层', 'stale Photoshop layer references should be reported as warnings instead of failing the whole snapshot');
    assertIncludes('normalizeLayerReadError', 'layer read failures should be normalized before being returned to the Agent');
    assertRegex(/private readLayerList[\s\S]*try\s*{[\s\S]*container\?\.layers/, 'container.layers access should be guarded because Photoshop can expose stale layer references');
    assert(
        !source.includes('if (layer.layers && layer.layers.length > 0)'),
        'nested layer traversal should not directly touch layer.layers without guarded reading'
    );
    assertStaleLayerBehavior();

    console.log(JSON.stringify({
        success: true,
        checks: [
            'layer collection reads are guarded',
            'stale layer reads are downgraded to warnings',
            'nested traversal avoids direct layer.layers access',
            'stale layer behavior is covered with a direct collectLayers regression'
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
