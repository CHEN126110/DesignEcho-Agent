#!/usr/bin/env node
/**
 * 静态检查：WebSocket handler 重复注册与别名冲突
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const targets = [
    path.join(projectRoot, 'src', 'main', 'index.ts'),
    path.join(projectRoot, 'src', 'main', 'uxp-handlers', 'webview-handlers.ts')
];

function extractHandlers(content) {
    const re = /registerHandler\(\s*'([^']+)'/g;
    const methods = [];
    let match;
    while ((match = re.exec(content))) {
        methods.push(match[1]);
    }
    return methods;
}

function main() {
    const methodToFiles = new Map();
    const methodCount = new Map();

    for (const file of targets) {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        const methods = extractHandlers(content);
        for (const method of methods) {
            methodCount.set(method, (methodCount.get(method) || 0) + 1);
            const files = methodToFiles.get(method) || [];
            files.push(path.relative(projectRoot, file));
            methodToFiles.set(method, files);
        }
    }

    const duplicated = [];
    for (const [method, count] of methodCount.entries()) {
        if (count > 1) {
            duplicated.push({ method, count, files: methodToFiles.get(method) || [] });
        }
    }

    // 允许的兼容别名（会和 canonical 同时存在）
    const allowedAliases = new Set([
        'layout-analyze',
        'analyze-layout',
        'inpainting.generate',
        'inpainting:generate',
        'inpaint'
    ]);

    const unexpected = duplicated.filter((item) => !allowedAliases.has(item.method));

    if (unexpected.length > 0) {
        console.error('[check-handler-aliases] 检测到非预期重复注册:');
        for (const item of unexpected) {
            console.error(`- ${item.method} x${item.count}`);
            for (const file of item.files) {
                console.error(`  - ${file}`);
            }
        }
        process.exit(1);
    }

    console.log('[check-handler-aliases] 通过');
    if (duplicated.length > 0) {
        console.log('[check-handler-aliases] 允许的兼容别名:');
        for (const item of duplicated) {
            if (allowedAliases.has(item.method)) {
                console.log(`- ${item.method} x${item.count}`);
            }
        }
    }
}

main();
