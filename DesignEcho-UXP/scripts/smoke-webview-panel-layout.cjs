#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src/core/webview-panel-layout.ts');
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

function createElement(parentElement = null) {
    const removedAttributes = [];
    return {
        style: {},
        parentElement,
        removedAttributes,
        removeAttribute(name) {
            removedAttributes.push(name);
        }
    };
}

function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/webview-panel-layout'"),
        'src/index.ts must import WebView panel layout helpers from src/core/webview-panel-layout.ts'
    );
    for (const localName of [
        'preparePanelHostLayout',
        'applyEmbeddedWebViewElementLayout'
    ]) {
        assert(!new RegExp(`function\\s+${localName}\\b`).test(indexSource), `${localName} must not remain local in src/index.ts`);
    }

    const core = loadHelperModule(helperPath);

    const root = createElement();
    const body = createElement();
    const parent = createElement();
    const node = createElement(parent);
    core.preparePanelHostLayout(node, { root, body });

    for (const target of [root, body, parent]) {
        assert(target.style.width === '100%', 'host width style changed');
        assert(target.style.height === '100%', 'host height style changed');
        assert(target.style.margin === '0', 'host margin style changed');
        assert(target.style.background === '#0a0a0f', 'host background style changed');
        assert(target.style.overflow === 'hidden', 'host overflow style changed');
    }

    assert(parent.style.position === 'relative', 'parent position style changed');
    assert(node.style.position === 'relative', 'node position style changed');
    assert(node.style.minHeight === '100%', 'node minHeight style changed');
    assert(node.style.padding === '0', 'node padding style changed');
    assert(node.style.display === 'block', 'node display style changed');

    const webview = createElement();
    core.applyEmbeddedWebViewElementLayout(webview);
    assert(webview.style.position === 'absolute', 'webview position style changed');
    assert(webview.style.inset === '0', 'webview inset style changed');
    assert(webview.style.width === '100%', 'webview width style changed');
    assert(webview.style.height === '100%', 'webview height style changed');
    assert(webview.style.minWidth === '0', 'webview minWidth style changed');
    assert(webview.style.minHeight === '0', 'webview minHeight style changed');
    assert(webview.style.display === 'block', 'webview display style changed');
    assert(webview.removedAttributes.join(',') === 'width,height', 'webview size attributes should be removed');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'WebView panel layout helpers live outside src/index.ts',
            'host layout styles remain stable',
            'embedded WebView sizing styles remain stable'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
