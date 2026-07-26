#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const helperPath = path.join(projectRoot, 'src/core/image-generation-options.ts');
const indexPath = path.join(projectRoot, 'src/index.ts');
const agentServicePath = path.join(workspaceRoot, 'DesignEcho-Agent/src/main/services/volcengine-seedream-service.ts');
const webviewPath = path.join(workspaceRoot, 'DesignEcho-Agent/public/webview/index.html');

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

function readModelCapabilityBlock(source, modelId) {
    const escapedModelId = modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`['"]${escapedModelId}['"]\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm'));
    assert(match, `Missing capability block for ${modelId}`);
    return match[1];
}

function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/image-generation-options'"),
        'src/index.ts must import image generation options from src/core/image-generation-options.ts'
    );
    for (const localName of [
        'DEFAULT_IMAGE_TO_IMAGE_MODEL',
        'DEFAULT_IMAGE_TO_IMAGE_SIZE_PRESET',
        'JIMENG_IMAGE_TO_IMAGE_MODEL',
        'IMAGE_TO_IMAGE_MODEL_SIZE_CAPABILITIES',
        'normalizeImageToImageModel',
        'resolveImageToImageSizePreset',
        'resolveImageToImageSnapshotMaxEdge',
        'resolveInpaintingCaptureMaxSize'
    ]) {
        assert(!new RegExp(`(?:const|function)\\s+${localName}\\b`).test(indexSource), `${localName} must not remain local in src/index.ts`);
    }

    const options = loadHelperModule(helperPath);
    assert(options.DEFAULT_IMAGE_TO_IMAGE_MODEL === 'doubao-seedream-5-0-260128', 'default image-to-image model changed');
    assert(options.JIMENG_IMAGE_TO_IMAGE_MODEL === 'jimeng-seedream-4-6', 'jimeng model id changed');
    assert(options.normalizeImageToImageModel('') === options.DEFAULT_IMAGE_TO_IMAGE_MODEL, 'empty model should use default');
    assert(options.resolveImageToImageSizePreset(options.DEFAULT_IMAGE_TO_IMAGE_MODEL, '3k') === '3K', 'default model should support 3K');
    assert(options.resolveImageToImageSizePreset('doubao-seedream-5-0-pro-260628', '1K') === '1K', 'Seedream 5.0 Pro should support 1K');
    assert(options.resolveImageToImageSizePreset('doubao-seedream-5-0-pro-260628', '2K') === '2K', 'Seedream 5.0 Pro should support 2K');
    assert(options.resolveImageToImageSizePreset('doubao-seedream-5-0-pro-260628', '4K') === '2K', 'Seedream 5.0 Pro must normalize unsupported 4K to 2K');
    assert(options.resolveImageToImageSizePreset('doubao-seedream-5-0-lite-260128', '4K') === '4K', 'Seedream 5.0 lite should provide the supported 4K path');
    assert(options.resolveImageToImageSizePreset(options.JIMENG_IMAGE_TO_IMAGE_MODEL, '3K') === '2K', 'jimeng unsupported 3K should fall back to default 2K');
    assert(options.resolveImageToImageSnapshotMaxEdge(options.JIMENG_IMAGE_TO_IMAGE_MODEL, '1K') === 4096, 'jimeng capture max edge changed');
    assert(options.resolveImageToImageSnapshotMaxEdge(options.DEFAULT_IMAGE_TO_IMAGE_MODEL, '3K') === 3456, 'seedream 3K capture edge changed');
    assert(options.resolveInpaintingCaptureMaxSize('ultra') === 2048, 'inpainting ultra max size changed');
    assert(options.resolveInpaintingCaptureMaxSize(undefined, 'google/gemini-3-pro-image-preview') === 1536, 'gemini inpainting default capture size changed');

    const agentServiceSource = fs.readFileSync(agentServicePath, 'utf8');
    const agentProCapability = readModelCapabilityBlock(agentServiceSource, 'doubao-seedream-5-0-pro-260628');
    assert(agentProCapability.includes("supportedSizes: ['1K', '2K']"), 'Agent Seedream 5.0 Pro presets must be 1K / 2K');
    assert(!agentProCapability.includes("'4K'"), 'Agent Seedream 5.0 Pro must not advertise 4K');
    assert(agentProCapability.includes('supportsOutputFormat: true'), 'Agent Seedream 5.0 Pro should send supported output_format');
    const agentLiteCapability = readModelCapabilityBlock(agentServiceSource, 'doubao-seedream-5-0-lite-260128');
    assert(agentLiteCapability.includes("supportedSizes: ['2K', '3K', '4K']"), 'Agent Seedream 5.0 lite presets must include 4K');

    const webviewSource = fs.readFileSync(webviewPath, 'utf8');
    const webviewProCapability = readModelCapabilityBlock(webviewSource, 'doubao-seedream-5-0-pro-260628');
    assert(webviewProCapability.includes("supportedSizes: ['1K', '2K']"), 'WebView Seedream 5.0 Pro presets must be 1K / 2K');
    assert(!webviewProCapability.includes("'4K'"), 'WebView Seedream 5.0 Pro must not expose 4K');
    const webviewLiteCapability = readModelCapabilityBlock(webviewSource, 'doubao-seedream-5-0-lite-260128');
    assert(webviewLiteCapability.includes("supportedSizes: ['2K', '3K', '4K']"), 'WebView Seedream 5.0 lite presets must include 4K');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'image generation option helpers live outside src/index.ts',
            'image-to-image model and size defaults remain stable',
            'Seedream 5.0 Pro/lite size capabilities stay aligned across WebView, UXP, and Agent',
            'inpainting capture size defaults remain stable'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
