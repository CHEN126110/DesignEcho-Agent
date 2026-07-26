#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const coordinatorPath = path.join(projectRoot, 'src/core/template-library-state-coordinator.ts');
const indexPath = path.join(projectRoot, 'src/index.ts');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function loadTypeScriptModule(filePath) {
    assert(fs.existsSync(filePath), `Missing coordinator module: ${path.relative(projectRoot, filePath)}`);
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        }
    }).outputText;
    const module = { exports: {} };
    const localRequire = (request) => {
        if (request === './template-library-core') {
            return loadTypeScriptModule(path.join(projectRoot, 'src/core/template-library-core.ts'));
        }
        return require(request);
    };
    vm.runInNewContext(transpiled, {
        module,
        exports: module.exports,
        require: localRequire,
        console: { ...console, warn: () => {} },
        setTimeout
    }, { filename: filePath });
    return module.exports;
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function tick() {
    await Promise.resolve();
    await Promise.resolve();
}

function createHarness(options = {}) {
    const sent = [];
    const requests = [];
    const scheduled = [];
    const connected = options.connected !== false;
    const wsClient = {
        isConnected: () => connected,
        sendRequest: (method, payload, timeoutMs) => {
            requests.push({ method, payload, timeoutMs });
            const handler = options.handlers?.[method];
            if (!handler) {
                return Promise.resolve({ success: true, detailReady: false });
            }
            return handler(payload, timeoutMs);
        }
    };
    const coordinator = createTemplateLibraryStateCoordinator({
        getWsClient: () => (options.hasClient === false ? null : wsClient),
        sendToWebView: (type, payload) => sent.push({ type, payload }),
        schedule: (callback) => scheduled.push(callback)
    });
    return {
        coordinator,
        sent,
        requests,
        scheduled,
        async flushScheduled() {
            while (scheduled.length > 0) {
                const next = scheduled.shift();
                next();
                await tick();
            }
        }
    };
}

async function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/template-library-state-coordinator'"),
        'src/index.ts must import template library state coordinator from src/core/template-library-state-coordinator.ts'
    );
    for (const localName of [
        'templateLibraryDetailRefreshSeq',
        'templateLibraryPreviewWarmupInFlight',
        'templateLibraryPreviewWarmupLibraryId',
        'templateLibraryLastDetailStateForPreview',
        'templateLibraryPreviewWarmupRequested',
        'templateLibraryLoadPromise',
        'queueTemplateLibraryPreviewWarmup',
        'refreshTemplateLibraryDetailState'
    ]) {
        assert(!indexSource.includes(localName), `${localName} must not remain local in src/index.ts`);
    }

    const moduleExports = loadTypeScriptModule(coordinatorPath);
    assert(
        typeof moduleExports.createTemplateLibraryStateCoordinator === 'function',
        'createTemplateLibraryStateCoordinator must be exported'
    );
    global.createTemplateLibraryStateCoordinator = moduleExports.createTemplateLibraryStateCoordinator;

    {
        const harness = createHarness({ hasClient: false });
        await harness.coordinator.loadForWebView();
        assert(harness.sent.length === 1, 'disconnected load should emit one state');
        assert(harness.sent[0].type === 'templateLibraryState', 'disconnected load should emit templateLibraryState');
        assert(harness.sent[0].payload.connected === false, 'disconnected load should mark state as disconnected');
        assert(Array.isArray(harness.sent[0].payload.assets), 'disconnected state should keep the standard payload shape');
    }

    {
        const harness = createHarness({
            handlers: {
                'template-library:getState': () => Promise.resolve({
                    success: true,
                    detailReady: false,
                    activeLibraryId: 'lib-a',
                    relativePath: 'folder',
                    libraries: [{ id: 'lib-a' }]
                })
            }
        });
        await harness.coordinator.loadForWebView();
        assert(harness.requests[0].method === 'template-library:getState', 'load should request template-library:getState');
        assert(harness.sent.length >= 1, 'getState load should emit a state payload');
        assert(harness.sent[0].payload.connected === true, 'getState payload should be connected');
        assert(harness.sent[0].payload.activeLibraryId === 'lib-a', 'getState payload should include active library id');
    }

    {
        const browse = createDeferred();
        const harness = createHarness({
            handlers: {
                'template-library:browse': () => browse.promise
            }
        });
        harness.coordinator.queueDetailRefresh({ success: true, detailReady: false, activeLibraryId: 'lib-a', relativePath: 'old' });
        await tick();
        harness.coordinator.emitState({ success: true, detailReady: true, activeLibraryId: 'lib-a', relativePath: 'new', assets: [] });
        browse.resolve({ success: true, detailReady: true, activeLibraryId: 'lib-a', relativePath: 'old', assets: [{ relativePath: 'stale.psd' }] });
        await tick();
        const emittedPaths = harness.sent.map((item) => item.payload.relativePath);
        assert(emittedPaths.includes('new'), 'detailReady emit should publish the new state');
        assert(!emittedPaths.includes('old'), 'stale detail refresh must not overwrite newer detailReady state');
    }

    {
        const harness = createHarness({
            handlers: {
                'template-library:ensureAssetPreviews': () => Promise.resolve({
                    success: true,
                    detailReady: true,
                    activeLibraryId: 'lib-a',
                    assets: [{ relativePath: 'design.psd', thumbnailUrl: 'data:image/jpeg;base64,x' }]
                })
            }
        });
        harness.coordinator.emitState({
            success: true,
            detailReady: true,
            activeLibraryId: 'lib-a',
            assets: [
                { relativePath: 'design.psd', assetType: 'design-file' },
                { relativePath: 'copy.txt', assetType: 'text' },
                { relativePath: 'ready.png', assetType: 'image', thumbnailUrl: 'data:image/png;base64,x' }
            ]
        });
        await tick();
        const warmup = harness.requests.find((request) => request.method === 'template-library:ensureAssetPreviews');
        assert(warmup, 'detailReady state with missing previews should request preview warmup');
        assert(warmup.payload.libraryId === 'lib-a', 'preview warmup should include active library id');
        assert(JSON.stringify(warmup.payload.relativePaths) === JSON.stringify(['design.psd']), 'preview warmup should only include non-text assets without thumbnails');
    }

    {
        const firstWarmup = createDeferred();
        let warmupAttempts = 0;
        const harness = createHarness({
            handlers: {
                'template-library:ensureAssetPreviews': () => {
                    warmupAttempts += 1;
                    if (warmupAttempts === 1) {
                        return firstWarmup.promise;
                    }
                    return Promise.resolve({
                        success: true,
                        detailReady: true,
                        activeLibraryId: 'lib-a',
                        assets: [{ relativePath: 'retry.psd', thumbnailUrl: 'data:image/jpeg;base64,x' }]
                    });
                }
            }
        });
        const state = {
            success: true,
            detailReady: true,
            activeLibraryId: 'lib-a',
            assets: [{ relativePath: 'retry.psd', assetType: 'design-file' }]
        };
        harness.coordinator.emitState(state);
        harness.coordinator.emitState(state);
        await tick();
        assert(warmupAttempts === 1, 'preview warmup should not duplicate while a request is in-flight');
        firstWarmup.reject(new Error('preview generation failed'));
        await tick();
        await harness.flushScheduled();
        assert(warmupAttempts === 2, 'failed preview warmup should release in-flight state and allow retry');
    }

    console.log(JSON.stringify({
        success: true,
        checks: [
            'disconnected template library state is emitted',
            'getState payload is emitted to WebView',
            'detailReady state invalidates stale refresh responses',
            'preview warmup only requests missing non-text previews',
            'failed preview warmup can retry after in-flight cleanup'
        ]
    }, null, 2));
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
});
