#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'src/core/image-generation-errors.ts');
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
    const sandbox = {
        module,
        exports: module.exports,
        require,
        console
    };
    vm.runInNewContext(transpiled, sandbox, { filename: filePath });
    return module.exports;
}

function main() {
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    assert(
        indexSource.includes("from './core/image-generation-errors'"),
        'src/index.ts must import image generation error helpers from src/core/image-generation-errors.ts'
    );
    assert(
        !/function\s+normalizeInpaintingError\s*\(/.test(indexSource),
        'normalizeInpaintingError must not remain as a local src/index.ts function'
    );
    assert(
        !/function\s+normalizeImageToImageError\s*\(/.test(indexSource),
        'normalizeImageToImageError must not remain as a local src/index.ts function'
    );

    const helpers = loadHelperModule(helperPath);
    assert(typeof helpers.normalizeInpaintingError === 'function', 'normalizeInpaintingError export missing');
    assert(typeof helpers.normalizeImageToImageError === 'function', 'normalizeImageToImageError export missing');

    const inpaintingAuth = helpers.normalizeInpaintingError({
        error: 'credentials are not configured',
        stage: 'provider-auth'
    });
    assert(inpaintingAuth.message === '未配置即梦AI密钥', 'inpainting credentials message changed');
    assert(inpaintingAuth.stage === 'provider-auth', 'inpainting stage must be preserved');

    const imageToImageTos = helpers.normalizeImageToImageError({
        error: '即梦图生图缺少 TOS 配置',
        stage: 'provider-validate'
    });
    assert(imageToImageTos.message === '未配置 TOS 图床', 'image-to-image TOS message changed');
    assert(imageToImageTos.stage === 'provider-validate', 'image-to-image stage must be preserved');

    const imageToImageProviderSize = helpers.normalizeImageToImageError({
        error: "Seedream request failed: The parameter `size` specified in the request are not valid: must be 'WIDTHxHEIGHT' or a supported size preset. Request id: test (code=InvalidParameter)",
        stage: 'validate-size-preset',
        detail: 'Seedream 5.0 Pro 仅支持 1K / 2K'
    });
    assert(imageToImageProviderSize.message === '当前模型不支持所选分辨率', 'provider size error should have a localized title');
    assert(imageToImageProviderSize.detail === 'Seedream 5.0 Pro 仅支持 1K / 2K', 'provider size error should preserve Agent detail');
    assert(imageToImageProviderSize.stage === 'validate-size-preset', 'provider size error stage must be preserved');

    const imageToImageLocalSize = helpers.normalizeImageToImageError({
        error: '当前模型 doubao-seedream-5-0-pro-260628 不支持分辨率档位 4K，支持：1K / 2K',
        stage: 'validate-size-preset'
    });
    assert(imageToImageLocalSize.message === '当前模型不支持所选分辨率', 'local size guard should have a localized title');

    console.log(JSON.stringify({
        success: true,
        checks: [
            'image generation error helpers live outside src/index.ts',
            'inpainting normalized error messages remain stable',
            'image-to-image normalized error messages remain stable',
            'image-to-image size errors remain localized across provider and local guards'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error.message || error);
    process.exit(1);
}
