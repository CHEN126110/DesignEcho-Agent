const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  fastDeterministicRoute
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'agent-orchestration', 'routing.ts'));
const {
  getSkillById
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skills', 'skill-declarations.ts'));
const {
  extractDocumentManagementRoutingParams
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'skill-routing.ts'));
const toolExecutorModule = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'tool-executor.service.ts'));

let mockExecuteToolCall = null;
const originalExecuteToolCall = toolExecutorModule.executeToolCall;
toolExecutorModule.executeToolCall = async (toolName, toolParams) => {
    if (mockExecuteToolCall) return mockExecuteToolCall(toolName, toolParams);
    return originalExecuteToolCall(toolName, toolParams);
};

const {
  documentManagementExecutor
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'document-management.executor.ts'));

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
    const outDir = path.join(__dirname, '..', 'tmp');
    ensureDir(outDir);
    const jsonPath = path.join(outDir, 'document-management-skill-smoke.json');
    const mdPath = path.join(outDir, 'document-management-skill-smoke.md');
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

    const lines = [
        '# Document Management Skill Smoke',
        '',
        `- success: ${payload.success}`,
        ''
    ];

    for (const testCase of payload.cases) {
        lines.push(`## ${testCase.name}`);
        lines.push(`- status: ${testCase.status}`);
        if (testCase.details) {
            lines.push(`- details: ${testCase.details}`);
        }
        lines.push('');
    }

    fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');
    return { json: jsonPath, md: mdPath };
}

const commonMojibakeFragments = [
    0xfffd,
    0x95ab,
    0x9359,
    0x6d93,
    0x9428,
    0x7ecb,
    0x93b6,
    0x9352,
    0x9365,
    0x20ac
].map((codePoint) => String.fromCodePoint(codePoint));

function hasCommonMojibake(text) {
    return commonMojibakeFragments.some((fragment) => text.includes(fragment));
}

async function run() {
    const cases = [];

    const input = '帮我关闭文档不保存';
    const route = fastDeterministicRoute(input);
    cases.push({
        name: 'route-document-close',
        status:
            route
            && route.skillId === 'document-management'
            && route.skillParams
            && route.skillParams.action === 'close'
            && route.skillParams.save === false
                ? 'pass'
                : 'fail',
        details: route ? JSON.stringify(route.skillParams) : 'no route'
    });

    const detailPageCreateInput = '帮我新建一个详情页文档 你需要知道详情页的尺寸规范';
    const detailPageCreateRoute = fastDeterministicRoute(detailPageCreateInput);
    const detailPageCreateParams = extractDocumentManagementRoutingParams(detailPageCreateInput, 'create');
    cases.push({
        name: 'route-detail-page-document-create-uses-detail-preset',
        status:
            detailPageCreateRoute
            && detailPageCreateRoute.skillId === 'document-management'
            && detailPageCreateRoute.skillParams?.action === 'create'
            && detailPageCreateRoute.skillParams?.preset === 'detail-page'
            && detailPageCreateRoute.skillParams?.name === '详情页'
            && detailPageCreateParams.preset === 'detail-page'
            && detailPageCreateParams.name === '详情页'
            && detailPageCreateParams.width === undefined
            && detailPageCreateParams.height === undefined
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            route: detailPageCreateRoute,
            extracted: detailPageCreateParams
        })
    });

    const detailPageNameRecognitionInput = '帮我新建一个详情页文档，详情页文档按名称识别，详情页就是详情页，SKU就是SKU';
    const detailPageNameRecognitionRoute = fastDeterministicRoute(detailPageNameRecognitionInput);
    const detailPageNameRecognitionParams = extractDocumentManagementRoutingParams(detailPageNameRecognitionInput, 'create');
    cases.push({
        name: 'route-detail-page-document-create-ignores-name-recognition-wording',
        status:
            detailPageNameRecognitionRoute
            && detailPageNameRecognitionRoute.skillId === 'document-management'
            && detailPageNameRecognitionRoute.skillParams?.action === 'create'
            && detailPageNameRecognitionRoute.skillParams?.preset === 'detail-page'
            && detailPageNameRecognitionRoute.skillParams?.name === '详情页'
            && detailPageNameRecognitionParams.preset === 'detail-page'
            && detailPageNameRecognitionParams.name === '详情页'
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            route: detailPageNameRecognitionRoute,
            extracted: detailPageNameRecognitionParams
        })
    });

    const skuDocumentCreateInput = '帮我新建一个 SKU 文档';
    const skuDocumentCreateRoute = fastDeterministicRoute(skuDocumentCreateInput);
    const skuDocumentCreateParams = extractDocumentManagementRoutingParams(skuDocumentCreateInput, 'create');
    cases.push({
        name: 'route-sku-document-create-uses-sku-name-without-inventing-size-preset',
        status:
            skuDocumentCreateRoute
            && skuDocumentCreateRoute.skillId === 'document-management'
            && skuDocumentCreateRoute.skillParams?.action === 'create'
            && skuDocumentCreateRoute.skillParams?.name === 'SKU'
            && skuDocumentCreateRoute.skillParams?.preset === undefined
            && skuDocumentCreateParams.name === 'SKU'
            && skuDocumentCreateParams.preset === undefined
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            route: skuDocumentCreateRoute,
            extracted: skuDocumentCreateParams
        })
    });

    const skill = getSkillById('document-management');
    cases.push({
        name: 'skill-declaration',
        status:
            skill
            && Array.isArray(skill.requiredTools)
            && skill.requiredTools.includes('closeDocument')
            && skill.requiredTools.includes('listDocuments')
                ? 'pass'
                : 'fail',
        details: skill ? JSON.stringify(skill.requiredTools) : 'missing skill'
    });

    const executorSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'document-management.executor.ts'),
        'utf8'
    );
    cases.push({
        name: 'document-executor-copy-is-readable',
        status:
            executorSource.includes('正在保存当前 Photoshop 文档。')
            && executorSource.includes('已关闭文档')
            && executorSource.includes('未知错误')
            && !hasCommonMojibake(executorSource)
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            hasSaveStatus: executorSource.includes('正在保存当前 Photoshop 文档。'),
            hasCloseMessage: executorSource.includes('已关闭文档'),
            hasUnknownError: executorSource.includes('未知错误'),
            hasCommonMojibake: hasCommonMojibake(executorSource)
        })
    });

    cases.push({
        name: 'document-create-verifies-readback-dimensions',
        status:
            executorSource.includes('verifyCreatedDocumentInfo')
            && executorSource.includes('created_document_dimension_mismatch')
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            hasVerifyHelper: executorSource.includes('verifyCreatedDocumentInfo'),
            hasDimensionMismatchCode: executorSource.includes('created_document_dimension_mismatch')
        })
    });

    const captureCreateRun = async (userIntent) => {
        const calls = [];
        mockExecuteToolCall = async (toolName, toolParams) => {
            calls.push({ toolName, toolParams });
            if (toolName === 'createDocument') {
                return {
                    success: true,
                    name: toolParams.name || '新建文档',
                    width: toolParams.preset === 'detail-page' ? 790 : toolParams.width || 800,
                    height: toolParams.preset === 'detail-page' ? 2000 : toolParams.height || 800
                };
            }
            if (toolName === 'getDocumentInfo') {
                const createCall = calls.find((call) => call.toolName === 'createDocument');
                const createParams = createCall?.toolParams || {};
                return {
                    success: true,
                    name: createParams.name || (createParams.preset === 'detail-page' ? '详情页' : '新建文档'),
                    width: createParams.preset === 'detail-page' ? 790 : createParams.width || 800,
                    height: createParams.preset === 'detail-page' ? 2000 : createParams.height || 800
                };
            }
            return { success: true };
        };
        try {
            const result = await documentManagementExecutor.execute({
                params: { action: 'create', userIntent },
                callbacks: {}
            });
            return { result, calls };
        } finally {
            mockExecuteToolCall = null;
        }
    };

    const detailCreateRun = await captureCreateRun('帮我新建一个详情页文档，按照文档名称区分：详情页文档就是详情页，SKU就是SKU');
    const detailCreateCall = detailCreateRun.calls.find((call) => call.toolName === 'createDocument');
    cases.push({
        name: 'executor-detail-page-document-create-normalizes-from-document-name-role',
        status:
            detailCreateRun.result?.success === true
            && detailCreateCall?.toolParams?.preset === 'detail-page'
            && detailCreateCall?.toolParams?.name === '详情页'
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            result: detailCreateRun.result,
            createParams: detailCreateCall?.toolParams
        })
    });

    const skuCreateRun = await captureCreateRun('帮我新建一个 SKU 文档，按照文档名称区分：详情页文档就是详情页，SKU就是SKU');
    const skuCreateCall = skuCreateRun.calls.find((call) => call.toolName === 'createDocument');
    cases.push({
        name: 'executor-sku-document-create-keeps-sku-role-despite-detail-page-boundary-text',
        status:
            skuCreateRun.result?.success === true
            && skuCreateCall?.toolParams?.preset === undefined
            && skuCreateCall?.toolParams?.name === 'SKU'
                ? 'pass'
                : 'fail',
        details: JSON.stringify({
            result: skuCreateRun.result,
            createParams: skuCreateCall?.toolParams
        })
    });

    const success = cases.every((item) => item.status === 'pass');
    const payload = { success, cases };
    const report = writeReport(payload);
    console.log(JSON.stringify({ ...payload, report }, null, 2));
    process.exit(success ? 0 : 1);
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
