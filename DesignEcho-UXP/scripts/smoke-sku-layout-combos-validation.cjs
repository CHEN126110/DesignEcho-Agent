#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..');
const toolPath = path.join(projectRoot, 'src', 'tools', 'layout', 'sku-layout-tool.ts');

const photoshopMock = {
    app: {
        documents: [],
        activeDocument: null
    },
    core: {
        executeAsModal: async (handler) => handler()
    },
    action: {
        batchPlay: async () => []
    }
};

const uxpMock = {
    storage: {
        formats: { utf8: 'utf8' },
        localFileSystem: {
            getTemporaryFolder: async () => ({
                createFile: async () => ({
                    write: async () => undefined,
                    delete: async () => undefined
                })
            }),
            createSessionToken: () => 'mock-token',
            getEntryWithUrl: async () => null
        }
    }
};

function loadTsModule(filePath, cache = new Map()) {
    const resolvedPath = path.resolve(filePath);
    if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports;

    assert(fs.existsSync(resolvedPath), `Missing TypeScript module: ${path.relative(projectRoot, resolvedPath)}`);

    const source = fs.readFileSync(resolvedPath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        }
    }).outputText;

    const module = { exports: {} };
    cache.set(resolvedPath, module);

    function localRequire(request) {
        if (request === 'photoshop') return photoshopMock;
        if (request === 'uxp') return uxpMock;
        if (request.startsWith('.')) {
            const candidate = path.resolve(path.dirname(resolvedPath), request);
            const tsPath = candidate.endsWith('.ts') ? candidate : `${candidate}.ts`;
            if (fs.existsSync(tsPath)) return loadTsModule(tsPath, cache);
        }
        return require(request);
    }

    vm.runInNewContext(transpiled, {
        module,
        exports: module.exports,
        require: localRequire,
        console,
        Set,
        Map,
        Promise
    }, { filename: resolvedPath });

    return module.exports;
}

function assertDiagnosticError(result, position) {
    assert.strictEqual(result.success, false, `invalid combos at ${position} should fail`);
    assert.strictEqual(result.data, null, `invalid combos at ${position} should not return data`);
    assert(result.error, `invalid combos at ${position} should include an error message`);
    assert(result.error.includes('combos'), `error should name combos: ${result.error}`);
    assert(result.error.includes(position), `error should point to ${position}: ${result.error}`);
    assert(
        result.error.includes('颜色名数组的数组') && result.error.includes('array of color name arrays'),
        `error should explain combos shape in Chinese and English: ${result.error}`
    );
}

async function main() {
    const { SKULayoutTool } = loadTsModule(toolPath);
    const tool = new SKULayoutTool();

    assertDiagnosticError(await tool.execute({
        action: 'execute',
        combos: ['红色', '黑色']
    }), 'combos[0]');

    assertDiagnosticError(await tool.execute({
        action: 'execute',
        combos: [['红色'], [123]]
    }), 'combos[1][0]');

    assertDiagnosticError(await tool.execute({
        action: 'arrangeDynamic',
        combos: ['红色', '黑色']
    }), 'combos[0]');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'skuLayout execute rejects non string[][] combos before layout work',
            'skuLayout arrangeDynamic rejects non string[][] combos before layout work',
            'skuLayout combos validation reports the invalid position',
            'skuLayout combos validation explains the expected color name array shape in Chinese and English'
        ]
    }, null, 2));
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
