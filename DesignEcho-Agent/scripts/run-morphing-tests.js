#!/usr/bin/env node
/**
 * 形态统一集成测试运行器
 */

try {
    require('ts-node').register({
        skipProject: true,
        transpileOnly: true,
        compilerOptions: {
            module: 'commonjs',
            moduleResolution: 'node',
            esModuleInterop: true
        }
    });
} catch (error) {
    console.error('[run-morphing-tests] 缺少 ts-node 依赖，请先安装后再执行测试。');
    console.error('[run-morphing-tests] 建议执行: npm install -D ts-node');
    process.exit(1);
}

const { runIntegrationTests } = require('../src/main/services/morphing/integration-test');

runIntegrationTests()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('测试运行失败:', err);
        process.exit(1);
    });
