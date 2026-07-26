#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src/core/webview-message-core.ts');
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
        indexSource.includes("from './core/webview-message-core'"),
        'src/index.ts must import WebView message helpers from src/core/webview-message-core.ts'
    );
    for (const localName of [
        'summarizeWebViewPayload',
        'shouldDropDuplicateWebViewMessage'
    ]) {
        assert(!new RegExp(`function\\s+${localName}\\b`).test(indexSource), `${localName} must not remain local in src/index.ts`);
    }

    const core = loadHelperModule(helperPath);
    assert(core.summarizeWebViewPayload(null) === '', 'null payload summary changed');
    assert(core.summarizeWebViewPayload('hello') === 's:5', 'string payload summary changed');
    assert(core.summarizeWebViewPayload(42) === '42', 'number payload summary changed');
    assert(core.summarizeWebViewPayload({ z: true, a: 'xx', n: null }) === 'a:s2,z:true', 'sorted primitive object summary changed');
    assert(
        core.summarizeWebViewPayload({
            droppedFiles: [
                { name: 'hero', extension: 'png', dataUrl: 'abc', textContent: 'xy' },
                { name: 'copy', extension: 'txt', textContent: 'abcd' }
            ]
        }) === 'droppedFiles:a2[hero.png:3:2|copy.txt:0:4]',
        'droppedFiles payload summary changed'
    );
    assert(
        core.summarizeWebViewPayload({ filePaths: ['a.psd', '', 'c.psb'] }) === 'filePaths:a3[a.psd||c.psb]',
        'filePaths payload summary changed'
    );
    assert(core.summarizeWebViewPayload({ meta: { a: 1, b: 2 } }) === 'meta:o2', 'object payload summary changed');
    assert(
        core.buildWebViewMessageSignature({ type: 'uxp-action', action: 'open', payload: { id: 7 } }) === 'uxp-action|open|id:7',
        'WebView message signature changed'
    );

    let now = 1000;
    const shouldDrop = core.createDuplicateWebViewMessageGuard(() => now);
    const message = { type: 'uxp-action', action: 'open', payload: { id: 7 } };
    assert(shouldDrop(message) === false, 'first message should not be dropped');
    now = 1299;
    assert(shouldDrop(message) === true, 'duplicate inside 300ms should be dropped');
    now = 1301;
    assert(shouldDrop(message) === false, 'duplicate outside 300ms should be accepted');
    now = 1302;
    assert(shouldDrop({ ...message, action: 'close' }) === false, 'different action should not be dropped');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'WebView message helpers live outside src/index.ts',
            'payload summaries and message signatures remain stable',
            'duplicate message guard preserves the 300ms drop window'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
